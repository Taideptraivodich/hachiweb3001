'use strict';

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');
const { cleanRaw, normalizeCode, splitCodeAliases } = require('../utils/codeSearch');
const { normalizeText, headerSignature } = require('../utils/navigationText');
const { rebuildSearchDocuments, upsertRelation, loadMemoryIndex } = require('../services/navigationIndex');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function numberOrZero(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function findHeaderRow(matrix) {
  const limit = Math.min(20, matrix.length);
  let best = { index: 0, score: -1 };
  for (let index = 0; index < limit; index++) {
    const row = matrix[index] || [];
    const filled = row.filter(value => String(value ?? '').trim() !== '').length;
    const textCells = row.filter(value => typeof value === 'string' && value.trim()).length;
    const unique = new Set(row.map(value => normalizeText(value)).filter(Boolean)).size;
    const score = filled * 4 + textCells * 3 + unique;
    if (score > best.score) best = { index, score };
  }
  return best.index;
}

function suggestRole(header, samples = []) {
  const h = normalizeText(header);
  const compact = normalizeCode(header);
  if (/\b(MA HANG|PART NO|PART NUMBER|SKU|ITEM CODE|MA SP|CODE)\b/.test(h)) return 'PRIMARY_CODE:INTERNAL';
  if (compact.includes('555')) return 'CODE:555';
  if (compact.includes('AISIN')) return 'CODE:AISIN';
  if (compact.includes('OEM') || h.includes('CHINH HANG')) return 'CODE:OEM';
  if (compact.includes('KYB')) return 'CODE:KYB';
  if (compact.includes('TOKICO')) return 'CODE:TOKICO';
  if (/\b(TEN HANG|TEN SAN PHAM|PRODUCT NAME|ITEM NAME|NAME)\b/.test(h)) return 'NAME';
  if (/\b(MO TA|DESCRIPTION|APPLICATION|AP DUNG)\b/.test(h)) return 'DESCRIPTION';
  if (/\b(GIA VON|GIA NHAP|DEALER PRICE|COST|WHOLESALE)\b/.test(h)) return 'COST';
  if (/\b(GIA LE|GIA BAN|RETAIL PRICE|RETAIL)\b/.test(h)) return 'RETAIL_PRICE';
  if (/\b(CON LAI|TON KHO|TON|STOCK|QTY|QUANTITY|SO LUONG)\b/.test(h)) return 'STOCK';
  if (/\b(HANG SX|BRAND|HANG SAN XUAT)\b/.test(h)) return 'BRAND';
  if (/\b(LOAI XE|TEN XE|VEHICLE|MODEL|XE AP DUNG)\b/.test(h)) return 'VEHICLE';
  if (/\b(VI TRI|POSITION)\b/.test(h)) return 'POSITION';
  if (/\b(GHI CHU|REMARK|NOTE)\b/.test(h)) return 'REMARK';

  const nonEmpty = samples.filter(value => String(value ?? '').trim() !== '');
  if (nonEmpty.length && nonEmpty.every(value => typeof value === 'number')) return 'IGNORE';
  return 'IGNORE';
}

function sheetPreview(workbook, sheetName) {
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
  const headerRow = findHeaderRow(matrix);
  const headers = (matrix[headerRow] || []).map((value, index) => String(value || `Cột ${index + 1}`).trim() || `Cột ${index + 1}`);
  const samples = headers.map((_, col) => matrix.slice(headerRow + 1, headerRow + 6).map(row => row[col] ?? ''));
  return {
    sheet_name: sheetName,
    header_row: headerRow,
    signature: headerSignature(headers),
    headers: headers.map((header, index) => ({
      index,
      header,
      samples: samples[index],
      suggested_role: suggestRole(header, samples[index]),
    })),
    row_count: Math.max(0, matrix.length - headerRow - 1),
  };
}

function getOrCreateSource(db, config, fileName) {
  const sourceId = Number(config.id || 0);
  if (sourceId) {
    const existing = dbGet(db, `SELECT * FROM data_sources WHERE id=?`, [sourceId]);
    if (!existing) throw new Error('Nguồn dữ liệu không tồn tại');
    dbRun(db, `UPDATE data_sources SET name=?, source_type=?, description=?, priority=?, active=1, last_file_name=?, updated_at=datetime('now','localtime') WHERE id=?`, [
      String(config.name || existing.name).trim(), config.source_type || existing.source_type || 'supplier',
      String(config.description || existing.description || '').trim(), Number(config.priority ?? existing.priority ?? 100), fileName, sourceId,
    ]);
    return sourceId;
  }

  const name = String(config.name || '').trim();
  if (!name) throw new Error('Thiếu tên nguồn dữ liệu');
  dbRun(db, `
    INSERT INTO data_sources (name, source_type, description, priority, active, last_file_name, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, datetime('now','localtime'))
    ON CONFLICT(name) DO UPDATE SET
      source_type=excluded.source_type,
      description=excluded.description,
      priority=excluded.priority,
      active=1,
      last_file_name=excluded.last_file_name,
      updated_at=datetime('now','localtime')
  `, [name, config.source_type || 'supplier', String(config.description || '').trim(), Number(config.priority || 100), fileName]);
  return Number(dbGet(db, `SELECT id FROM data_sources WHERE name=?`, [name]).id);
}

function roleValue(row, mapping, role) {
  const entry = Object.entries(mapping || {}).find(([, mapped]) => mapped === role);
  return entry ? row[Number(entry[0])] : '';
}

function codeColumns(mapping) {
  return Object.entries(mapping || {})
    .filter(([, role]) => String(role).startsWith('PRIMARY_CODE') || String(role).startsWith('CODE:'))
    .map(([index, role]) => {
      const value = String(role);
      const primary = value.startsWith('PRIMARY_CODE');
      const type = primary ? (value.split(':')[1] || 'INTERNAL') : (value.slice(5) || 'KHAC');
      return { index: Number(index), role: value, type, primary };
    });
}

router.get('/', async (_req, res) => {
  try {
    const db = await getDb();
    const rows = dbQuery(db, `
      SELECT ds.*,
             (SELECT COUNT(*) FROM source_records sr WHERE sr.source_id=ds.id) AS record_count,
             (SELECT COUNT(*) FROM import_templates it WHERE it.source_id=ds.id AND it.active=1) AS template_count
      FROM data_sources ds ORDER BY ds.priority, ds.name
    `, {});
    db.close();
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chưa chọn file Excel' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const previews = wb.SheetNames.map(name => sheetPreview(wb, name));
    const db = await getDb();
    const sourceId = Number(req.body.source_id || 0);
    const templates = sourceId
      ? dbQuery(db, `SELECT * FROM import_templates WHERE source_id=? AND active=1`, [sourceId])
      : [];
    db.close();
    for (const preview of previews) {
      const template = templates.find(item => item.sheet_name === preview.sheet_name && item.header_signature === preview.signature);
      preview.saved_template = template ? {
        id: template.id,
        name: template.name,
        header_row: template.header_row,
        mapping: JSON.parse(template.mapping_json || '{}'),
      } : null;
    }
    res.json({ file_name: req.file.originalname, sheets: previews });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/import', upload.single('file'), async (req, res) => {
  let db;
  try {
    if (!req.file) return res.status(400).json({ error: 'Chưa chọn file Excel' });
    const config = JSON.parse(req.body.config || '{}');
    if (!Array.isArray(config.sheets) || !config.sheets.length) return res.status(400).json({ error: 'Chưa cấu hình sheet cần import' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    db = await getDb();
    dbRun(db, 'BEGIN TRANSACTION');
    const sourceId = getOrCreateSource(db, config.source || {}, req.file.originalname);
    const source = dbGet(db, `SELECT * FROM data_sources WHERE id=?`, [sourceId]);

    dbRun(db, `DELETE FROM source_records WHERE source_id=?`, [sourceId]);
    dbRun(db, `DELETE FROM part_relations WHERE source_name=?`, [source.name]);

    let imported = 0;
    const sheetResults = [];
    for (const sheetConfig of config.sheets) {
      if (!sheetConfig.enabled) continue;
      const sheetName = sheetConfig.sheet_name;
      if (!wb.Sheets[sheetName]) continue;
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
      const headerRow = Number(sheetConfig.header_row || 0);
      const mapping = sheetConfig.mapping || {};
      const codes = codeColumns(mapping);
      if (!codes.length) throw new Error(`Sheet ${sheetName}: cần map ít nhất một cột mã`);
      let sheetImported = 0;

      for (let index = headerRow + 1; index < matrix.length; index++) {
        const row = matrix[index] || [];
        const rawCodes = [];
        for (const spec of codes) {
          const rawValue = cleanRaw(row[spec.index]);
          for (const alias of splitCodeAliases(rawValue)) {
            if (normalizeCode(alias).length >= 3) rawCodes.push({ code: alias, type: spec.type, primary: spec.primary });
          }
        }
        if (!rawCodes.length) continue;
        const primary = rawCodes.find(item => item.primary) || rawCodes[0];
        const related = rawCodes.filter(item => normalizeCode(item.code) !== normalizeCode(primary.code));
        const name = String(roleValue(row, mapping, 'NAME') || '').trim();
        const description = String(roleValue(row, mapping, 'DESCRIPTION') || '').trim();
        const brand = cleanRaw(roleValue(row, mapping, 'BRAND'));
        const vehicle = String(roleValue(row, mapping, 'VEHICLE') || '').trim();
        const position = String(roleValue(row, mapping, 'POSITION') || '').trim();
        const remark = String(roleValue(row, mapping, 'REMARK') || '').trim();
        const cost = numberOrZero(roleValue(row, mapping, 'COST'));
        const retail = numberOrZero(roleValue(row, mapping, 'RETAIL_PRICE'));
        const stock = numberOrZero(roleValue(row, mapping, 'STOCK'));

        dbRun(db, `
          INSERT INTO source_records (
            source_id, sheet_name, source_row, part_number, part_number_norm,
            name, description, cost, retail_price, stock, brand, vehicle,
            position, remark, related_codes_json, raw_json, imported_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
        `, [
          sourceId, sheetName, index + 1, primary.code, normalizeCode(primary.code),
          name, description, cost, retail, stock, brand, vehicle, position, remark,
          JSON.stringify(rawCodes), JSON.stringify(row),
        ]);
        const recordId = Number(dbGet(db, `SELECT last_insert_rowid() AS id`, {}).id);
        for (const item of related) {
          const relationType = primary.type === '555' && item.type === 'AISIN'
            ? 'EQUIVALENT'
            : item.type === 'OEM' || primary.type === 'OEM' ? 'OEM'
              : 'CROSS_REFERENCE';
          upsertRelation(db, {
            from_code: primary.code,
            from_type: primary.type,
            to_code: item.code,
            to_type: item.type,
            relation_type: relationType,
            source_name: source.name,
            source_record_id: recordId,
            confirmed: true,
          });
        }
        imported++;
        sheetImported++;
      }

      if (sheetConfig.save_template !== false) {
        const headers = (matrix[headerRow] || []).map((value, index) => String(value || `Cột ${index + 1}`).trim() || `Cột ${index + 1}`);
        const signature = sheetConfig.signature || headerSignature(headers);
        dbRun(db, `
          INSERT INTO import_templates (name, source_id, sheet_name, header_signature, header_row, mapping_json, active, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'))
          ON CONFLICT(source_id, sheet_name, header_signature) DO UPDATE SET
            name=excluded.name, header_row=excluded.header_row, mapping_json=excluded.mapping_json,
            active=1, updated_at=datetime('now','localtime')
        `, [sheetConfig.template_name || `${source.name} - ${sheetName}`, sourceId, sheetName, signature, headerRow, JSON.stringify(mapping)]);
      }
      sheetResults.push({ sheet_name: sheetName, imported: sheetImported });
    }

    dbRun(db, `UPDATE data_sources SET last_import_at=datetime('now','localtime'), last_import_rows=?, last_file_name=?, updated_at=datetime('now','localtime') WHERE id=?`, [imported, req.file.originalname, sourceId]);
    const indexResult = rebuildSearchDocuments(db);
    dbRun(db, 'COMMIT');
    saveDb(db);
    db = null;
    await loadMemoryIndex(true);
    res.json({ success: true, source_id: sourceId, source_name: source.name, imported, sheets: sheetResults, index: indexResult });
  } catch (error) {
    if (db) {
      try { dbRun(db, 'ROLLBACK'); } catch { /* no-op */ }
      try { db.close(); } catch { /* no-op */ }
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const source = dbGet(db, `SELECT * FROM data_sources WHERE id=?`, [req.params.id]);
    if (!source) { db.close(); return res.status(404).json({ error: 'Không tìm thấy nguồn dữ liệu' }); }
    dbRun(db, 'BEGIN TRANSACTION');
    dbRun(db, `DELETE FROM part_relations WHERE source_name=?`, [source.name]);
    dbRun(db, `DELETE FROM data_sources WHERE id=?`, [req.params.id]);
    rebuildSearchDocuments(db);
    dbRun(db, 'COMMIT');
    saveDb(db);
    await loadMemoryIndex(true);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;
