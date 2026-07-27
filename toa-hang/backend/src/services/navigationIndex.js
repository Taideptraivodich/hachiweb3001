'use strict';

const fs = require('fs');
const path = require('path');
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');
const { cleanRaw, normalizeCode, scoreCode, splitCodeAliases, buildVariants } = require('../utils/codeSearch');
const {
  normalizeText,
  textTokens,
  extractEmbeddedCodes,
  looksLikeCodeQuery,
} = require('../utils/navigationText');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'toa-hang.db');

let memoryIndex = null;
let loadedDbMtimeMs = 0;
let rebuildPromise = null;

function safeJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function nowLocalSql() {
  return "datetime('now','localtime')";
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function addToken(map, token, id) {
  if (!token) return;
  if (!map.has(token)) map.set(token, new Set());
  map.get(token).add(id);
}

function addCode(map, code, id) {
  const norm = normalizeCode(code);
  if (!norm) return;
  if (!map.has(norm)) map.set(norm, new Set());
  map.get(norm).add(id);
}

function compactDocument(row) {
  const payload = safeJson(row.payload_json, {});
  const tokens = safeJson(row.tokens_json, []);
  const codeVariants = safeJson(row.code_variants_json, []);
  const visibleText = [row.primary_code, row.title, row.subtitle].filter(Boolean).join(' ');
  return {
    id: Number(row.id),
    document_key: row.document_key,
    source_type: row.source_type,
    source_name: row.source_name,
    record_type: row.record_type,
    record_id: row.record_id,
    primary_code: row.primary_code || '',
    primary_code_norm: row.primary_code_norm || '',
    title: row.title || '',
    subtitle: row.subtitle || '',
    search_text_norm: row.search_text_norm || '',
    tokens,
    visible_text_norm: normalizeText(visibleText),
    visible_tokens: textTokens(visibleText),
    code_variants: codeVariants,
    history_count: number(row.history_count),
    history_qty: number(row.history_qty),
    stock_company: number(row.stock_company),
    stock_win: number(row.stock_win),
    cost_hint: number(row.cost_hint),
    business_score: number(row.business_score),
    payload,
  };
}

function tableExists(db, name) {
  return Boolean(dbGet(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]));
}

function buildDocument({
  documentKey,
  sourceType,
  sourceName,
  recordType,
  recordId,
  primaryCode,
  title,
  subtitle = '',
  searchParts = [],
  codeVariants = [],
  historyCount = 0,
  historyQty = 0,
  stockCompany = 0,
  stockWin = 0,
  costHint = 0,
  businessScore = 0,
  payload = {},
}) {
  const codes = new Set();
  for (const code of [primaryCode, ...codeVariants]) {
    for (const alias of splitCodeAliases(code)) {
      const norm = normalizeCode(alias);
      if (norm.length >= 3) codes.add(norm);
    }
  }
  for (const code of extractEmbeddedCodes([title, subtitle, ...searchParts].join(' '))) {
    const norm = normalizeCode(code);
    if (norm.length >= 3) codes.add(norm);
  }

  const text = [primaryCode, title, subtitle, ...searchParts, ...codes].filter(Boolean).join(' ');
  const tokens = textTokens(text);

  return {
    document_key: documentKey,
    source_type: sourceType,
    source_name: sourceName,
    record_type: recordType,
    record_id: String(recordId ?? ''),
    primary_code: cleanRaw(primaryCode),
    primary_code_norm: normalizeCode(primaryCode),
    title: String(title || '').trim(),
    subtitle: String(subtitle || '').trim(),
    search_text_norm: normalizeText(text),
    tokens_json: JSON.stringify(tokens),
    code_variants_json: JSON.stringify([...codes]),
    history_count: number(historyCount),
    history_qty: number(historyQty),
    stock_company: number(stockCompany),
    stock_win: number(stockWin),
    cost_hint: number(costHint),
    business_score: number(businessScore),
    payload_json: JSON.stringify(payload),
  };
}

function insertDocument(db, doc) {
  dbRun(db, `
    INSERT INTO search_documents (
      document_key, source_type, source_name, record_type, record_id,
      primary_code, primary_code_norm, title, subtitle, search_text_norm,
      tokens_json, code_variants_json, history_count, history_qty,
      stock_company, stock_win, cost_hint, business_score, payload_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowLocalSql()})
    ON CONFLICT(document_key) DO UPDATE SET
      source_type=excluded.source_type,
      source_name=excluded.source_name,
      record_type=excluded.record_type,
      record_id=excluded.record_id,
      primary_code=excluded.primary_code,
      primary_code_norm=excluded.primary_code_norm,
      title=excluded.title,
      subtitle=excluded.subtitle,
      search_text_norm=excluded.search_text_norm,
      tokens_json=excluded.tokens_json,
      code_variants_json=excluded.code_variants_json,
      history_count=excluded.history_count,
      history_qty=excluded.history_qty,
      stock_company=excluded.stock_company,
      stock_win=excluded.stock_win,
      cost_hint=excluded.cost_hint,
      business_score=excluded.business_score,
      payload_json=excluded.payload_json,
      updated_at=${nowLocalSql()}
  `, [
    doc.document_key, doc.source_type, doc.source_name, doc.record_type, doc.record_id,
    doc.primary_code, doc.primary_code_norm, doc.title, doc.subtitle, doc.search_text_norm,
    doc.tokens_json, doc.code_variants_json, doc.history_count, doc.history_qty,
    doc.stock_company, doc.stock_win, doc.cost_hint, doc.business_score, doc.payload_json,
  ]);
}

function upsertRelation(db, relation) {
  const fromCode = cleanRaw(relation.from_code);
  const toCode = cleanRaw(relation.to_code);
  const fromNorm = normalizeCode(fromCode);
  const toNorm = normalizeCode(toCode);
  if (!fromNorm || !toNorm || fromNorm === toNorm) return;
  dbRun(db, `
    INSERT INTO part_relations (
      from_code, from_code_norm, from_type, to_code, to_code_norm, to_type,
      relation_type, source_name, source_record_id, confirmed, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowLocalSql()})
    ON CONFLICT(from_code_norm, to_code_norm, relation_type, source_name) DO UPDATE SET
      from_code=excluded.from_code,
      from_type=excluded.from_type,
      to_code=excluded.to_code,
      to_type=excluded.to_type,
      source_record_id=excluded.source_record_id,
      confirmed=MAX(part_relations.confirmed, excluded.confirmed),
      updated_at=${nowLocalSql()}
  `, [
    fromCode, fromNorm, cleanRaw(relation.from_type || 'KHAC'),
    toCode, toNorm, cleanRaw(relation.to_type || 'KHAC'),
    cleanRaw(relation.relation_type || 'RELATED'),
    String(relation.source_name || '').trim(),
    String(relation.source_record_id || '').trim(),
    relation.confirmed === false ? 0 : 1,
  ]);
}

/**
 * Tạo SearchDocument từ các bảng raw. Đây là bước nặng và chỉ chạy sau import/sync,
 * không chạy ở mỗi request tìm kiếm.
 */
function rebuildSearchDocuments(db) {
  if (!tableExists(db, 'search_documents')) return { documents: 0, relations: 0 };

  dbRun(db, 'DELETE FROM search_documents');

  // Quan hệ 555/AISIN hiện có là dữ liệu đã xác nhận. Giữ quan hệ do generic source import tạo.
  dbRun(db, `DELETE FROM part_relations WHERE source_name IN ('LEGACY_MA_NGOAI', 'PRODUCT_ALIAS')`);

  const history = dbQuery(db, `
    SELECT ma_hang,
           MAX(COALESCE(mo_ta,'')) AS mo_ta,
           MAX(COALESCE(hang_sx,'')) AS hang_sx,
           COUNT(*) AS so_dong,
           SUM(COALESCE(so_luong,0)) AS tong_sl,
           MAX(COALESCE(don_gia,0)) AS gia_max,
           MAX(COALESCE(gia_von,0)) AS gia_von_max,
           GROUP_CONCAT(DISTINCT COALESCE(ten_kh,'')) AS customers,
           GROUP_CONCAT(DISTINCT COALESCE(nha_cc,'')) AS suppliers
    FROM sales_history
    WHERE TRIM(COALESCE(ma_hang,'')) != ''
    GROUP BY ma_hang
  `, {});

  const historyMap = new Map();
  for (const row of history) {
    historyMap.set(normalizeCode(row.ma_hang), row);
    insertDocument(db, buildDocument({
      documentKey: `QLDH:${cleanRaw(row.ma_hang)}`,
      sourceType: 'sales_history',
      sourceName: 'QLĐH',
      recordType: 'sales_code',
      recordId: row.ma_hang,
      primaryCode: row.ma_hang,
      title: row.mo_ta || row.ma_hang,
      subtitle: [row.hang_sx, `${row.so_dong} lần bán`].filter(Boolean).join(' · '),
      searchParts: [row.hang_sx, row.customers, row.suppliers],
      historyCount: row.so_dong,
      historyQty: row.tong_sl,
      costHint: row.gia_von_max,
      businessScore: 35 + Math.min(25, Math.log2(1 + number(row.so_dong)) * 5),
      payload: {
        history_codes: [row.ma_hang],
        hang_sx: row.hang_sx || '',
        suppliers: row.suppliers || '',
      },
    }));
  }

  const products = dbQuery(db, `SELECT * FROM product_cache`, {});
  for (const row of products) {
    const h = historyMap.get(normalizeCode(row.ma_hang));
    insertDocument(db, buildDocument({
      documentKey: `MISA:${cleanRaw(row.ma_hang)}`,
      sourceType: 'product',
      sourceName: 'MISA',
      recordType: 'product',
      recordId: row.ma_hang,
      primaryCode: row.ma_hang,
      title: row.ten_hang || row.ma_hang,
      subtitle: [row.kho, row.dvt].filter(Boolean).join(' · '),
      searchParts: [h?.mo_ta, h?.hang_sx],
      historyCount: h?.so_dong || 0,
      historyQty: h?.tong_sl || 0,
      stockCompany: row.ton_kho,
      costHint: row.gia_von,
      businessScore: 20 + (number(row.ton_kho) > 0 ? 20 : 0) + (h ? 15 : 0),
      payload: {
        history_codes: h ? [h.ma_hang] : [row.ma_hang],
        kho: row.kho || '', dvt: row.dvt || '',
      },
    }));
  }

  const external = dbQuery(db, `
    SELECT mn.*, p.ten_hang, p.ton_kho, p.gia_von, p.kho, p.dvt
    FROM ma_ngoai mn
    LEFT JOIN product_cache p ON p.ma_hang=mn.ma_hang
    WHERE COALESCE(mn.trang_thai,'da_xac_nhan') != 'vo_hieu'
  `, {});
  for (const row of external) {
    const historyRow = historyMap.get(normalizeCode(row.ma_hang));
    const type = cleanRaw(row.loai_ma || 'KHAC') || 'KHAC';
    const title = row.ten_hang || row.xe_ap_dung || row.ma_hang;
    insertDocument(db, buildDocument({
      documentKey: `MAP:${row.id}`,
      sourceType: 'supplier_mapping',
      sourceName: row.nha_cc || 'MÃ NGOÀI',
      recordType: 'mapping',
      recordId: row.id,
      primaryCode: row.ma_hang || row.ma_ngoai,
      title,
      subtitle: [type, row.ma_ngoai, row.vi_tri, row.xe_ap_dung].filter(Boolean).join(' · '),
      searchParts: [row.ma_ngoai, row.ma_hang, row.xe_ap_dung, row.vi_tri, row.nha_cc, row.ghi_chu],
      codeVariants: [row.ma_ngoai, row.ma_hang],
      historyCount: historyRow?.so_dong || 0,
      historyQty: historyRow?.tong_sl || 0,
      stockCompany: row.ton_kho,
      costHint: row.gia_dai_ly || row.gia_von,
      businessScore: 12 + (historyRow ? 20 : 0) + (number(row.ton_kho) > 0 ? 15 : 0),
      payload: {
        history_codes: historyRow ? [historyRow.ma_hang] : [row.ma_hang].filter(Boolean),
        external_ref: row,
        code_type: type,
        external_code: row.ma_ngoai,
        inventory_code: row.ma_hang,
      },
    }));

    if (row.ma_ngoai && row.ma_hang && normalizeCode(row.ma_ngoai) !== normalizeCode(row.ma_hang)) {
      upsertRelation(db, {
        from_code: row.ma_ngoai,
        from_type: type,
        to_code: row.ma_hang,
        to_type: type === '555' ? 'AISIN' : 'INTERNAL',
        relation_type: type === '555' ? 'EQUIVALENT' : 'MAPPED_REFERENCE',
        source_name: 'LEGACY_MA_NGOAI',
        source_record_id: row.id,
        confirmed: true,
      });
    }
  }

  const aliases = dbQuery(db, `
    SELECT pa.*, p.ten_hang, p.ton_kho, p.gia_von, p.kho
    FROM product_aliases pa LEFT JOIN product_cache p ON p.ma_hang=pa.ma_hang
    WHERE COALESCE(pa.trang_thai,'da_xac_nhan')='da_xac_nhan'
  `, {});
  for (const row of aliases) {
    upsertRelation(db, {
      from_code: row.alias_raw,
      from_type: 'ALIAS',
      to_code: row.ma_hang,
      to_type: 'INTERNAL',
      relation_type: 'ALIAS',
      source_name: 'PRODUCT_ALIAS',
      source_record_id: row.id,
      confirmed: true,
    });
  }

  const wins = dbQuery(db, `SELECT * FROM win_inventory`, {});
  for (const row of wins) {
    const aliasesArray = safeJson(row.aliases_json, []);
    insertDocument(db, buildDocument({
      documentKey: `WIN:${row.id}`,
      sourceType: 'win_inventory',
      sourceName: 'WIN',
      recordType: 'win_item',
      recordId: row.id,
      primaryCode: row.ma_win,
      title: row.ten_hang || row.ma_win,
      subtitle: `Còn lại ${number(row.con_lai)} ${row.dvt || ''}`.trim(),
      searchParts: aliasesArray,
      codeVariants: aliasesArray,
      stockWin: row.con_lai,
      costHint: row.gia_hachi,
      businessScore: 15 + (number(row.con_lai) > 0 ? 25 : 0),
      payload: { win_id: row.id, aliases: aliasesArray, win_row: row },
    }));
  }

  if (tableExists(db, 'source_records')) {
    const generic = dbQuery(db, `
      SELECT sr.*, ds.name AS source_name
      FROM source_records sr JOIN data_sources ds ON ds.id=sr.source_id
      WHERE COALESCE(ds.active,1)=1
    `, {});
    for (const row of generic) {
      const relatedCodes = safeJson(row.related_codes_json, []);
      insertDocument(db, buildDocument({
        documentKey: `SOURCE:${row.id}`,
        sourceType: 'generic_source',
        sourceName: row.source_name || 'Nguồn khác',
        recordType: 'source_record',
        recordId: row.id,
        primaryCode: row.part_number,
        title: row.name || row.description || row.part_number,
        subtitle: [row.brand, row.vehicle, row.position].filter(Boolean).join(' · '),
        searchParts: [row.description, row.brand, row.vehicle, row.position, row.remark, ...relatedCodes.map(x => x.code)],
        codeVariants: relatedCodes.map(x => x.code),
        stockWin: 0,
        costHint: row.cost,
        businessScore: 10 + (number(row.stock) > 0 ? 18 : 0),
        payload: {
          source_record_id: row.id,
          source_id: row.source_id,
          related_codes: relatedCodes,
          supplier_record: row,
          history_codes: [row.part_number].filter(Boolean),
        },
      }));
    }
  }

  const count = dbGet(db, `SELECT COUNT(*) AS cnt FROM search_documents`, {})?.cnt || 0;
  const relationCount = dbGet(db, `SELECT COUNT(*) AS cnt FROM part_relations`, {})?.cnt || 0;
  invalidateNavigationIndex();
  return { documents: Number(count), relations: Number(relationCount) };
}

function buildMemoryFromRows(documentRows, relationRows, interactionRows) {
  const documents = new Map();
  const tokenIndex = new Map();
  const codeIndex = new Map();
  const relationMap = new Map();
  const clickMap = new Map();
  const tokenLexicon = new Set();
  const codeLexicon = new Set();

  for (const row of documentRows) {
    const doc = compactDocument(row);
    documents.set(doc.id, doc);
    for (const token of doc.tokens) {
      addToken(tokenIndex, token, doc.id);
      tokenLexicon.add(token);
    }
    for (const code of [doc.primary_code, ...doc.code_variants]) {
      const norm = normalizeCode(code);
      if (!norm) continue;
      addCode(codeIndex, norm, doc.id);
      codeLexicon.add(norm);
      // Cho phép tìm theo phần số nhưng không tạo kết quả rác với số quá ngắn.
      const numeric = norm.match(/\d{3,}/g) || [];
      for (const part of numeric) addCode(codeIndex, part, doc.id);
    }
  }

  for (const row of relationRows) {
    const rel = {
      id: Number(row.id),
      from_code: row.from_code,
      from_code_norm: row.from_code_norm,
      from_type: row.from_type,
      to_code: row.to_code,
      to_code_norm: row.to_code_norm,
      to_type: row.to_type,
      relation_type: row.relation_type,
      source_name: row.source_name,
      confirmed: Number(row.confirmed || 0) === 1,
    };
    for (const key of [rel.from_code_norm, rel.to_code_norm]) {
      if (!relationMap.has(key)) relationMap.set(key, []);
      relationMap.get(key).push(rel);
    }
  }

  for (const row of interactionRows) {
    clickMap.set(`${row.query_norm}|${row.document_key}`, number(row.click_count));
  }

  return {
    documents, tokenIndex, codeIndex, relationMap, clickMap,
    tokenLexicon: [...tokenLexicon], codeLexicon: [...codeLexicon],
    loadedAt: Date.now(),
  };
}

async function loadMemoryIndex(force = false) {
  // Chỉ rebuild khi module nghiệp vụ chủ động invalidate/force. Dùng mtime của
  // toàn DB làm tín hiệu khiến các thao tác không liên quan (click, cache tồn)
  // vô tình reload hàng chục nghìn SearchDocument và tạo spike 1–2 giây.
  if (!force && memoryIndex) return memoryIndex;
  if (rebuildPromise) return rebuildPromise;

  rebuildPromise = (async () => {
    const db = await getDb();
    let count = tableExists(db, 'search_documents')
      ? number(dbGet(db, `SELECT COUNT(*) AS cnt FROM search_documents`, {})?.cnt)
      : 0;
    if (count === 0 && tableExists(db, 'search_documents')) {
      rebuildSearchDocuments(db);
      count = number(dbGet(db, `SELECT COUNT(*) AS cnt FROM search_documents`, {})?.cnt);
    }
    const docs = count ? dbQuery(db, `SELECT * FROM search_documents`, {}) : [];
    const relations = tableExists(db, 'part_relations') ? dbQuery(db, `SELECT * FROM part_relations WHERE confirmed=1`, {}) : [];
    const interactions = tableExists(db, 'search_interactions')
      ? dbQuery(db, `SELECT query_norm, document_key, SUM(click_count) AS click_count FROM search_interactions GROUP BY query_norm, document_key`, {})
      : [];
    db.close();
    memoryIndex = buildMemoryFromRows(docs, relations, interactions);
    loadedDbMtimeMs = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).mtimeMs : Date.now();
    return memoryIndex;
  })().finally(() => { rebuildPromise = null; });

  return rebuildPromise;
}

function invalidateNavigationIndex() {
  memoryIndex = null;
  loadedDbMtimeMs = 0;
}

function interactionBoost(index, queryNorm, doc) {
  const count = index.clickMap.get(`${queryNorm}|${doc.document_key}`) || 0;
  return Math.min(18, Math.log2(1 + count) * 3.5);
}

function businessBoost(doc) {
  let score = Math.min(12, doc.business_score / 5);
  if (doc.history_count > 0) score += Math.min(8, Math.log2(1 + doc.history_count) * 1.5);
  if (doc.stock_company > 0) score += 5;
  if (doc.stock_win > 0) score += 3;
  return score;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function evidenceFieldLabel(field) {
  return ({
    code: 'mã',
    title: 'tên',
    subtitle: 'mô tả',
    hidden: 'dữ liệu liên quan',
  })[field] || field;
}

/**
 * Chấm nội dung theo từng token truy vấn. Điểm hiển thị chỉ phản ánh độ khớp
 * văn bản; điểm bán hàng, tồn và click chỉ dùng làm tie-breaker khi sắp xếp.
 */
function evaluateContentMatch(doc, queryTokens, queryTextNorm, fuzzyTokenMap = new Map()) {
  const codeTokens = new Set(textTokens(doc.primary_code));
  const titleTokens = new Set(textTokens(doc.title));
  const subtitleTokens = new Set(textTokens(doc.subtitle));
  const allTokens = new Set(doc.tokens || []);
  const evidence = [];
  const missing = [];

  function locate(token) {
    if (codeTokens.has(token)) return { token, field: 'code', type: 'exact' };
    if (titleTokens.has(token)) return { token, field: 'title', type: 'exact' };
    if (subtitleTokens.has(token)) return { token, field: 'subtitle', type: 'exact' };
    if (allTokens.has(token)) return { token, field: 'hidden', type: 'exact' };

    for (const alias of fuzzyTokenMap.get(token) || []) {
      if (codeTokens.has(alias)) return { token: alias, field: 'code', type: 'fuzzy' };
      if (titleTokens.has(alias)) return { token: alias, field: 'title', type: 'fuzzy' };
      if (subtitleTokens.has(alias)) return { token: alias, field: 'subtitle', type: 'fuzzy' };
      if (allTokens.has(alias)) return { token: alias, field: 'hidden', type: 'fuzzy' };
    }
    return null;
  }

  for (const queryToken of queryTokens) {
    const hit = locate(queryToken);
    if (!hit) {
      missing.push(queryToken);
      continue;
    }
    evidence.push({
      query_token: queryToken,
      matched_token: hit.token,
      field: hit.field,
      field_label: evidenceFieldLabel(hit.field),
      match_type: hit.type,
    });
  }

  const matchedCount = evidence.length;
  if (!matchedCount) return null;

  const queryCount = Math.max(1, queryTokens.length);
  const exactCount = evidence.filter(item => item.match_type === 'exact').length;
  const visibleCount = evidence.filter(item => item.field !== 'hidden').length;
  const fuzzyCount = matchedCount - exactCount;
  const coverage = matchedCount / queryCount;
  const exactRatio = exactCount / matchedCount;
  const visibleRatio = visibleCount / matchedCount;
  const phraseVisible = Boolean(queryTextNorm && doc.visible_text_norm.includes(queryTextNorm));
  const phraseAnywhere = Boolean(queryTextNorm && doc.search_text_norm.includes(queryTextNorm));

  let score = (
    coverage * 85
    + exactRatio * 8
    + visibleRatio * 4
    + (phraseVisible ? 3 : phraseAnywhere ? 1 : 0)
    - fuzzyCount * 4
  );
  if (matchedCount < queryCount) {
    // Giữ các dải điểm dễ hiểu: 2/3 tối đa 69, 1/3 tối đa 36, 1/2 tối đa 53.
    score = Math.min(score, Math.floor(coverage * 100) + 3);
  }
  score = Math.max(1, Math.min(100, Math.round(score)));

  const matchedTokens = evidence.map(item => item.query_token);
  const evidenceText = evidence
    .map(item => `${item.query_token} (${item.field_label}${item.match_type === 'fuzzy' ? ', gần đúng' : ''})`)
    .join(', ');
  const missingText = missing.length ? ` · Thiếu: ${missing.join(', ')}` : '';

  return {
    score,
    matched_count: matchedCount,
    query_token_count: queryCount,
    exact_count: exactCount,
    visible_match_count: visibleCount,
    fuzzy_count: fuzzyCount,
    phrase_match: phraseVisible,
    phrase_anywhere: phraseAnywhere,
    matched_tokens: matchedTokens,
    missing_terms: missing,
    match_evidence: evidence,
    match_group: matchedCount === queryCount && fuzzyCount === 0
      ? 'exact'
      : coverage >= 0.66
        ? 'alias'
        : 'fuzzy',
    reason: `Khớp ${matchedCount}/${queryCount}: ${evidenceText}${missingText}`,
  };
}

function resultFromDoc(doc, score, meta = {}) {
  return {
    document_id: doc.id,
    document_key: doc.document_key,
    source_type: doc.source_type,
    source_name: doc.source_name,
    record_type: doc.record_type,
    primary_code: doc.primary_code,
    canonical_code: doc.primary_code_norm || normalizeCode(doc.primary_code),
    title: doc.title,
    subtitle: doc.subtitle,
    score: Math.max(0, Math.min(100, Math.round(score))),
    match_group: meta.match_group || (score >= 92 ? 'exact' : score >= 72 ? 'alias' : 'fuzzy'),
    matched_terms: meta.matched_terms || [],
    matched_tokens: meta.matched_tokens || meta.matched_terms || [],
    missing_terms: meta.missing_terms || [],
    match_evidence: meta.match_evidence || [],
    matched_count: number(meta.matched_count),
    query_token_count: number(meta.query_token_count),
    exact_count: number(meta.exact_count),
    visible_match_count: number(meta.visible_match_count),
    phrase_match: Boolean(meta.phrase_match),
    reason: meta.reason || '',
    related_via: meta.related_via || null,
    source_names: [doc.source_name].filter(Boolean),
    business_rank: number(meta.business_rank),
    interaction_rank: number(meta.interaction_rank),
    history_count: doc.history_count,
    history_qty: doc.history_qty,
    stock_company: doc.stock_company,
    stock_win: doc.stock_win,
    cost_hint: doc.cost_hint,
    payload_hint: {
      code_type: doc.payload.code_type || '',
      external_code: doc.payload.external_code || '',
      inventory_code: doc.payload.inventory_code || '',
    },
  };
}

function candidateCodeIds(index, queryNorm, rawQuery = queryNorm) {
  const ids = new Set();
  const variants = buildVariants(rawQuery).map(item => item.normalized).filter(Boolean);
  for (const variant of [queryNorm, ...variants]) {
    for (const id of index.codeIndex.get(variant) || []) ids.add(id);
  }
  if (ids.size) return ids;

  // Chỉ fuzzy trên tập mã có cùng phần đầu/độ dài gần nhau, tránh quét toàn bộ corpus.
  const prefix = queryNorm.slice(0, Math.min(3, queryNorm.length));
  const candidates = index.codeLexicon
    .filter(code => Math.abs(code.length - queryNorm.length) <= 3 && (code.startsWith(prefix) || queryNorm.startsWith(code.slice(0, Math.min(3, code.length)))))
    .slice(0, 250);
  for (const code of candidates) {
    const match = scoreCode(queryNorm, code);
    if (match?.score >= 48) {
      for (const id of index.codeIndex.get(code) || []) ids.add(id);
    }
  }
  return ids;
}

function relatedResults(index, queryNorm, seenIds, queryText) {
  const rows = [];
  for (const rel of index.relationMap.get(queryNorm) || []) {
    const forward = rel.from_code_norm === queryNorm;
    const relatedNorm = forward ? rel.to_code_norm : rel.from_code_norm;
    const relatedCode = forward ? rel.to_code : rel.from_code;
    const sourceType = forward ? rel.from_type : rel.to_type;
    const targetType = forward ? rel.to_type : rel.from_type;
    for (const id of index.codeIndex.get(relatedNorm) || []) {
      if (seenIds.has(id)) continue;
      const doc = index.documents.get(id);
      if (!doc) continue;
      const auto555 = cleanRaw(sourceType) === '555' && cleanRaw(targetType) === 'AISIN';
      const base = auto555 ? 94 : rel.relation_type === 'ALIAS' ? 91 : 78;
      const interactionRank = interactionBoost(index, normalizeText(queryText), doc);
      const businessRank = businessBoost(doc);
      const score = base;
      rows.push(resultFromDoc(doc, score, {
        match_group: auto555 ? 'exact' : 'alias',
        reason: auto555
          ? `Quy đổi mã 555 ${queryText} → AISIN ${relatedCode}`
          : `Mã liên quan ${queryText} ↔ ${relatedCode} (${rel.relation_type})`,
        related_via: rel,
        matched_terms: [queryText],
        matched_tokens: [normalizeText(queryText)],
        matched_count: 1,
        query_token_count: 1,
        exact_count: 1,
        visible_match_count: 0,
        business_rank: businessRank,
        interaction_rank: interactionRank,
      }));
      seenIds.add(id);
    }
  }
  return rows;
}

function compareNavigationResults(a, b, mode) {
  if (mode === 'content') {
    return (
      b.matched_count - a.matched_count
      || b.exact_count - a.exact_count
      || b.visible_match_count - a.visible_match_count
      || Number(b.phrase_match) - Number(a.phrase_match)
      || b.score - a.score
      || b.business_rank - a.business_rank
      || b.interaction_rank - a.interaction_rank
      || b.history_count - a.history_count
      || (b.stock_company + b.stock_win) - (a.stock_company + a.stock_win)
      || String(a.primary_code).localeCompare(String(b.primary_code))
    );
  }
  return (
    b.score - a.score
    || b.business_rank - a.business_rank
    || b.interaction_rank - a.interaction_rank
    || b.history_count - a.history_count
    || (b.stock_company + b.stock_win) - (a.stock_company + a.stock_win)
    || String(a.primary_code).localeCompare(String(b.primary_code))
  );
}

function mergeNavigationResults(results, mode) {
  const groups = new Map();
  for (const row of results) {
    const key = row.canonical_code || row.document_key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const merged = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => compareNavigationResults(a, b, mode));
    const representative = { ...rows[0] };
    const sourceNames = uniqueStrings(rows.flatMap(row => row.source_names || [row.source_name]));
    representative.source_names = sourceNames;
    representative.source_name = sourceNames.join(' + ');
    representative.merged_document_ids = rows.map(row => row.document_id);
    representative.history_count = Math.max(...rows.map(row => number(row.history_count)), 0);
    representative.history_qty = Math.max(...rows.map(row => number(row.history_qty)), 0);
    representative.stock_company = Math.max(...rows.map(row => number(row.stock_company)), 0);
    representative.stock_win = Math.max(...rows.map(row => number(row.stock_win)), 0);
    representative.cost_hint = Math.max(...rows.map(row => number(row.cost_hint)), 0);
    representative.business_rank = Math.max(...rows.map(row => number(row.business_rank)), 0);
    representative.interaction_rank = Math.max(...rows.map(row => number(row.interaction_rank)), 0);
    merged.push(representative);
  }

  merged.sort((a, b) => compareNavigationResults(a, b, mode));
  return merged;
}

async function searchNavigation(query, limit = 50) {
  const q = String(query || '').trim();
  const qTextNorm = normalizeText(q);
  const qCodeNorm = normalizeCode(q);
  const index = await loadMemoryIndex();
  const results = [];
  const seenIds = new Set();

  if (looksLikeCodeQuery(q)) {
    const ids = candidateCodeIds(index, qCodeNorm, q);
    for (const id of ids) {
      const doc = index.documents.get(id);
      if (!doc) continue;
      let best = null;
      for (const code of [doc.primary_code, ...doc.code_variants]) {
        const match = scoreCode(q, code);
        if (match && (!best || match.score > best.score)) best = match;
      }
      if (!best) continue;
      const businessRank = businessBoost(doc);
      const interactionRank = interactionBoost(index, qTextNorm, doc);
      const score = best.score;
      results.push(resultFromDoc(doc, score, {
        match_group: best.group,
        reason: best.reason,
        matched_terms: [best.matched_target],
        matched_tokens: [normalizeText(q)],
        matched_count: 1,
        query_token_count: 1,
        exact_count: best.group === 'exact' ? 1 : 0,
        visible_match_count: 1,
        business_rank: businessRank,
        interaction_rank: interactionRank,
      }));
      seenIds.add(id);
    }
    results.push(...relatedResults(index, qCodeNorm, seenIds, q));
  } else {
    const queryTokens = textTokens(q);
    const candidateIds = new Set();
    const fuzzyTokenMap = new Map();

    for (const token of queryTokens) {
      const exact = index.tokenIndex.get(token);
      if (exact?.size) {
        for (const id of exact) candidateIds.add(id);
        continue;
      }
      // Typo nhẹ: chỉ tìm token cùng ký tự đầu và độ dài gần, tối đa 30 token.
      const nearby = index.tokenLexicon
        .filter(candidate => candidate[0] === token[0] && Math.abs(candidate.length - token.length) <= 2)
        .slice(0, 100)
        .map(candidate => ({ candidate, match: scoreCode(token, candidate) }))
        .filter(item => item.match?.score >= 50)
        .sort((a, b) => b.match.score - a.match.score)
        .slice(0, 3);
      fuzzyTokenMap.set(token, nearby.map(x => x.candidate));
      for (const item of nearby) for (const id of index.tokenIndex.get(item.candidate) || []) candidateIds.add(id);
    }

    // Query nội dung có thể chứa mã viết cách: "C 2337".
    if (qCodeNorm.length >= 3 && /\d/.test(qCodeNorm)) {
      for (const id of index.codeIndex.get(qCodeNorm) || []) candidateIds.add(id);
    }

    for (const id of candidateIds) {
      const doc = index.documents.get(id);
      if (!doc) continue;
      const match = evaluateContentMatch(doc, queryTokens, qTextNorm, fuzzyTokenMap);
      if (!match) continue;
      const businessRank = businessBoost(doc);
      const interactionRank = interactionBoost(index, qTextNorm, doc);
      results.push(resultFromDoc(doc, match.score, {
        ...match,
        matched_terms: match.matched_tokens,
        business_rank: businessRank,
        interaction_rank: interactionRank,
      }));
      seenIds.add(id);
    }
  }

  const mode = looksLikeCodeQuery(q) ? 'code' : 'content';
  const grouped = mergeNavigationResults(results, mode);
  const deduped = grouped.slice(0, Math.min(100, Math.max(1, Number(limit || 50))));

  return {
    query: q,
    mode,
    elapsed_ms: 0,
    total: deduped.length,
    data: deduped,
  };
}

async function getNavigationDetail(documentId) {
  const index = await loadMemoryIndex();
  const doc = index.documents.get(Number(documentId));
  if (!doc) return null;

  const db = await getDb();
  const relations = dbQuery(db, `
    SELECT * FROM part_relations
    WHERE confirmed=1 AND (from_code_norm=? OR to_code_norm=?)
    ORDER BY relation_type, source_name
  `, [doc.primary_code_norm, doc.primary_code_norm]);

  const historyCodes = new Set(doc.payload.history_codes || []);
  historyCodes.add(doc.primary_code);
  for (const rel of relations) {
    historyCodes.add(rel.from_code);
    historyCodes.add(rel.to_code);
  }

  const externalRefs = [];
  if (doc.payload.external_ref) externalRefs.push(doc.payload.external_ref);
  if (doc.record_type !== 'mapping' && doc.primary_code) {
    externalRefs.push(...dbQuery(db, `SELECT * FROM ma_ngoai WHERE ma_hang=? OR ma_ngoai=?`, [doc.primary_code, doc.primary_code]));
  }

  let winMatches = [];
  if (doc.payload.win_row) {
    winMatches = [{ ...doc.payload.win_row, score: 100, match_group: 'exact', matched_target: doc.primary_code, reason: 'Đúng bản ghi WIN' }];
  } else {
    const codes = [...historyCodes].map(normalizeCode).filter(Boolean);
    const wins = dbQuery(db, `SELECT * FROM win_inventory ORDER BY con_lai DESC`, {});
    for (const row of wins) {
      const aliases = safeJson(row.aliases_json, []);
      let best = null;
      for (const code of codes) {
        for (const target of [row.ma_win, ...aliases]) {
          const match = scoreCode(code, target);
          if (match && (!best || match.score > best.score)) best = match;
        }
      }
      if (best?.score >= 82) {
        winMatches.push({ ...row, score: best.score, match_group: best.group, matched_target: best.matched_target, reason: best.reason });
      }
    }
    winMatches = winMatches.slice(0, 12);
  }

  let supplierRecords = [];
  if (tableExists(db, 'source_records')) {
    const norms = [...historyCodes].map(normalizeCode).filter(Boolean);
    if (norms.length) {
      const placeholders = norms.map(() => '?').join(',');
      supplierRecords = dbQuery(db, `
        SELECT sr.*, ds.name AS source_name
        FROM source_records sr JOIN data_sources ds ON ds.id=sr.source_id
        WHERE sr.part_number_norm IN (${placeholders})
        ORDER BY sr.stock DESC, sr.cost ASC
      `, norms);
    }
  }
  db.close();

  return {
    document: doc,
    candidate: {
      key: doc.document_key,
      document_id: doc.id,
      ma_hang: doc.payload.inventory_code || doc.primary_code,
      direct_code: doc.primary_code,
      ten_hang: doc.title,
      history_codes: [...historyCodes].filter(Boolean),
      external_refs: externalRefs,
      win_matches: winMatches,
      reference_ma_hang: doc.payload.inventory_code || '',
      source_kind: doc.source_type,
      score: 100,
      match_group: 'exact',
      reasons: [],
    },
    relations,
    supplier_records: supplierRecords,
  };
}

async function recordNavigationClick({ query, documentKey, documentId, userId = '' }) {
  const qNorm = normalizeText(query);
  if (!qNorm || !documentKey) return;
  const db = await getDb();
  dbRun(db, `
    INSERT INTO search_interactions (query_norm, document_key, document_id, user_id, click_count, last_clicked_at)
    VALUES (?, ?, ?, ?, 1, ${nowLocalSql()})
    ON CONFLICT(query_norm, document_key, user_id) DO UPDATE SET
      click_count=search_interactions.click_count+1,
      document_id=excluded.document_id,
      last_clicked_at=${nowLocalSql()}
  `, [qNorm, documentKey, Number(documentId || 0), String(userId || '')]);
  const clickRow = dbGet(db, `SELECT click_count FROM search_interactions WHERE query_norm=? AND document_key=? AND user_id=?`, [qNorm, documentKey, String(userId || '')]);
  saveDb(db);
  if (memoryIndex) memoryIndex.clickMap.set(`${qNorm}|${documentKey}`, number(clickRow?.click_count));
  loadedDbMtimeMs = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).mtimeMs : loadedDbMtimeMs;
}

module.exports = {
  rebuildSearchDocuments,
  loadMemoryIndex,
  invalidateNavigationIndex,
  searchNavigation,
  getNavigationDetail,
  recordNavigationClick,
  upsertRelation,
  __test: {
    evaluateContentMatch,
    compareNavigationResults,
    mergeNavigationResults,
  },
};
