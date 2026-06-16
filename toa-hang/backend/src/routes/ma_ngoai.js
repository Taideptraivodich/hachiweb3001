const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const XLSX     = require('xlsx');
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Chuẩn hóa mã để so sánh ─────────────────────────────────────────────────
function normalize(code) {
  if (!code) return '';
  return String(code).trim().toUpperCase().replace(/\s+/g, '');
}
function normalizeStrict(code) {
  return normalize(code).replace(/-/g, '');
}

// ── Fuzzy match mã file Excel → mã tồn kho ──────────────────────────────────
function findBestMatch(maExcel, dsMaHang) {
  const n  = normalize(maExcel);
  const ns = normalizeStrict(maExcel);

  const exact = dsMaHang.find(m => normalize(m) === n);
  if (exact) return { ma_hang: exact, score: 100 };

  const noHyphen = dsMaHang.find(m => normalizeStrict(m) === ns);
  if (noHyphen) return { ma_hang: noHyphen, score: 90 };

  const starts = dsMaHang.filter(m => normalize(m).startsWith(n) || n.startsWith(normalize(m)));
  if (starts.length === 1) return { ma_hang: starts[0], score: 70 };

  const contains = dsMaHang.filter(m => normalize(m).includes(ns) || ns.includes(normalizeStrict(m)));
  if (contains.length === 1) return { ma_hang: contains[0], score: 50 };
  if (contains.length > 1 && contains.length <= 5) return { suggestions: contains, score: 30 };

  return null;
}

// ── GET /api/ma-ngoai — lấy danh sách ───────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const { q, nha_cc, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = ['1=1'], params = {};
    if (q) {
      where.push('(mn.ma_hang LIKE $q OR mn.ma_ngoai LIKE $q OR p.ten_hang LIKE $q OR mn.xe_ap_dung LIKE $q OR mn.nha_cc LIKE $q)');
      params.$q = `%${q}%`;
    }
    if (nha_cc) { where.push('mn.nha_cc = $nha_cc'); params.$nha_cc = nha_cc; }

    const whereStr = where.join(' AND ');
    const total = dbGet(db, `
      SELECT COUNT(*) as cnt FROM ma_ngoai mn
      LEFT JOIN product_cache p ON p.ma_hang = mn.ma_hang
      WHERE ${whereStr}
    `, params);

    const rows = dbQuery(db, `
      SELECT mn.*, p.ten_hang, p.ton_kho, p.gia_von
      FROM ma_ngoai mn
      LEFT JOIN product_cache p ON p.ma_hang = mn.ma_hang
      WHERE ${whereStr}
      ORDER BY mn.nha_cc, mn.ma_hang
      LIMIT $limit OFFSET $offset
    `, { ...params, $limit: parseInt(limit), $offset: offset });

    const dsNhaCC = dbQuery(db, `SELECT DISTINCT nha_cc FROM ma_ngoai WHERE nha_cc != '' ORDER BY nha_cc`, {});

    db.close();
    res.json({ data: rows, total: total?.cnt || 0, dsNhaCC: dsNhaCC.map(r => r.nha_cc) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/ma-ngoai — thêm 1 dòng ────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const db = await getDb();
    const { ma_hang, ma_ngoai, nha_cc = '', xe_ap_dung = '', vi_tri = '', ghi_chu = '' } = req.body;
    if (!ma_hang || !ma_ngoai) { db.close(); return res.status(400).json({ error: 'Thiếu ma_hang hoặc ma_ngoai' }); }

    dbRun(db, `
      INSERT INTO ma_ngoai (ma_hang, ma_ngoai, nha_cc, xe_ap_dung, vi_tri, ghi_chu)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ma_hang, ma_ngoai) DO UPDATE SET
        nha_cc=excluded.nha_cc, xe_ap_dung=excluded.xe_ap_dung,
        vi_tri=excluded.vi_tri, ghi_chu=excluded.ghi_chu
    `, [ma_hang, ma_ngoai, nha_cc, xe_ap_dung, vi_tri, ghi_chu]);

    saveDb(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/ma-ngoai/:id — sửa ─────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { ma_hang, ma_ngoai, nha_cc = '', xe_ap_dung = '', vi_tri = '', ghi_chu = '' } = req.body;
    dbRun(db, `
      UPDATE ma_ngoai SET ma_hang=?, ma_ngoai=?, nha_cc=?, xe_ap_dung=?, vi_tri=?, ghi_chu=?
      WHERE id=?
    `, [ma_hang, ma_ngoai, nha_cc, xe_ap_dung, vi_tri, ghi_chu, req.params.id]);
    saveDb(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/ma-ngoai/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    dbRun(db, 'DELETE FROM ma_ngoai WHERE id=?', [req.params.id]);
    saveDb(db);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── Detect schema cho từng sheet ──────────────────────────────────────────────
function detectSchema(rows) {
  let headerIdx = 0, maxCols = 0;
  rows.forEach((r, i) => {
    if (i > 7) return;
    const filled = r.filter(c => String(c || '').trim() !== '').length;
    if (filled > maxCols) { maxCols = filled; headerIdx = i; }
  });

  const h = rows[headerIdx].map(c =>
    String(c || '').trim().toUpperCase().replace(/\n/g, ' ').replace(/\s+/g, ' ')
  );
  const fi = keywords => h.findIndex(col =>
    (Array.isArray(keywords) ? keywords : [keywords]).some(k => col.includes(k))
  );

  // Cột mã tồn kho MISA có sẵn trong file (ROTUYN=Mã Rotuyn, ADVICS=Type, CYLINDER=Type, OIL FILTER=Type, WATERPUMP=Mã SP)
  // Cột mã tồn kho MISA có sẵn trong file
  // ROTUYN → "Mã Rotuyn", ADVICS/CYLINDER/OIL FILTER → "Type"
  const colMaTonKho = fi(['MÃ ROTUYN','MA ROTUYN','TYPE']);

  // Cột mã ngoài nhà CC — MÃ MK ưu tiên hơn MÃ OEM
  // MÃ MK = mã nhà CC (dùng hàng ngày), MÃ OEM = mã nhà sản xuất xe (ít dùng hơn)
  let colMaNgoai = fi(['MÃ 555','MA 555','MÃ MK','MA MK','MÃ SAKURA','MA SAKURA','PART NO']);
  // Nếu chưa tìm được, thử MÃ OEM — nhưng chỉ khi không trùng colMaTonKho
  if (colMaNgoai < 0) {
    const colOem = fi(['MÃ OEM','MA OEM']);
    if (colOem >= 0 && colOem !== colMaTonKho) colMaNgoai = colOem;
  }

  // Fallback: cột đầu có data dạng mã (chuỗi, không phải số thuần)
  if (colMaNgoai < 0) {
    const dataRows = rows.slice(headerIdx + 1, headerIdx + 10)
      .filter(r => r.some(c => String(c || '').trim() !== ''));
    for (let ci = 0; ci < Math.min(h.length, 6); ci++) {
      const samples = dataRows
        .map(r => String(r[ci] || '').trim())
        .filter(v => v && isNaN(Number(v)) && v.length >= 3 && !/^(còn|hết|con|het)/i.test(v));
      if (samples.length >= 2) { colMaNgoai = ci; break; }
    }
  }
  if (colMaNgoai < 0) colMaNgoai = 0;

  const colViTri    = fi(['VỊ TRÍ','VI TRI','POSITION']);
  const colXeApDung = fi(['LOẠI XE','LOAI XE','MODEL','XE ÁP DỤNG']);

  return {
    headerIdx,
    colMaNgoai,
    colMaTonKho: colMaTonKho >= 0 && colMaTonKho !== colMaNgoai ? colMaTonKho : -1,
    colViTri,
    colXeApDung,
  };
}

// ── POST /api/ma-ngoai/import — import Excel ──────────────────────────────────
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const db = await getDb();
    if (!req.file) { db.close(); return res.status(400).json({ error: 'Chưa chọn file' }); }

    const wb       = XLSX.read(req.file.buffer, { type: 'buffer' });
    const dsMaHang = dbQuery(db, 'SELECT ma_hang FROM product_cache', {}).map(r => r.ma_hang);
    const results  = { matched: 0, unmatched: 0, skipped: 0, suggestions: [] };

    for (const sheetName of wb.SheetNames) {
      const ws   = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 3) continue;

      const { headerIdx, colMaNgoai, colMaTonKho, colViTri, colXeApDung } = detectSchema(rows);

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row    = rows[i];
        const filled = row.filter(c => String(c || '').trim() !== '').length;
        if (filled < 2) { results.skipped++; continue; }

        const maNgoai = String(row[colMaNgoai] || '').trim();
        if (!maNgoai || maNgoai.length < 2 || !isNaN(Number(maNgoai))) { results.skipped++; continue; }
        if (/^(còn|hết|con|het)\s*hàng/i.test(maNgoai)) { results.skipped++; continue; }

        const viTri    = colViTri    >= 0 ? String(row[colViTri]    || '').trim() : '';
        const xeApDung = colXeApDung >= 0 ? String(row[colXeApDung] || '').trim() : '';

        // Sheet có sẵn mã MISA (ROTUYN) → dùng thẳng, không cần fuzzy
        if (colMaTonKho >= 0) {
          const maTonKho = String(row[colMaTonKho] || '').trim();
          if (!maTonKho || maTonKho.length < 3) { results.skipped++; continue; }
          const inCache = dsMaHang.find(m =>
            m.toUpperCase().replace(/-/g,'') === maTonKho.toUpperCase().replace(/-/g,'')
          );
          dbRun(db, `
            INSERT INTO ma_ngoai (ma_hang, ma_ngoai, nha_cc, xe_ap_dung, vi_tri, ghi_chu)
            VALUES (?, ?, ?, ?, ?, '')
            ON CONFLICT(ma_hang, ma_ngoai) DO UPDATE SET
              nha_cc=excluded.nha_cc, xe_ap_dung=excluded.xe_ap_dung, vi_tri=excluded.vi_tri
          `, [inCache || maTonKho, maNgoai, sheetName, xeApDung, viTri]);
          results.matched++;
          continue;
        }

        // Fuzzy match mã ngoài → mã tồn kho
        const match = findBestMatch(maNgoai, dsMaHang);
        if (!match) {
          results.unmatched++;
          results.suggestions.push({ ma_excel: maNgoai, nha_cc: sheetName, xe_ap_dung: xeApDung, vi_tri: viTri, ma_hang: null });
          continue;
        }
        if (match.suggestions) {
          results.suggestions.push({ ma_excel: maNgoai, nha_cc: sheetName, xe_ap_dung: xeApDung, vi_tri: viTri, ma_hang: null, candidates: match.suggestions });
          results.unmatched++;
          continue;
        }
        dbRun(db, `
          INSERT INTO ma_ngoai (ma_hang, ma_ngoai, nha_cc, xe_ap_dung, vi_tri, ghi_chu)
          VALUES (?, ?, ?, ?, ?, '')
          ON CONFLICT(ma_hang, ma_ngoai) DO UPDATE SET
            nha_cc=excluded.nha_cc, xe_ap_dung=excluded.xe_ap_dung, vi_tri=excluded.vi_tri
        `, [match.ma_hang, maNgoai, sheetName, xeApDung, viTri]);
        results.matched++;
      }
    }

    saveDb(db);
    res.json({ success: true, ...results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/ma-ngoai/import/confirm — xác nhận mapping thủ công ───────────
router.post('/import/confirm', async (req, res) => {
  try {
    const db = await getDb();
    const { items } = req.body;
    let count = 0;
    for (const it of (items || [])) {
      if (!it.ma_hang || !it.ma_ngoai) continue;
      dbRun(db, `
        INSERT INTO ma_ngoai (ma_hang, ma_ngoai, nha_cc, xe_ap_dung, vi_tri, ghi_chu)
        VALUES (?, ?, ?, ?, ?, '')
        ON CONFLICT(ma_hang, ma_ngoai) DO UPDATE SET
          nha_cc=excluded.nha_cc, xe_ap_dung=excluded.xe_ap_dung, vi_tri=excluded.vi_tri
      `, [it.ma_hang, it.ma_ngoai, it.nha_cc || '', it.xe_ap_dung || '', it.vi_tri || '']);
      count++;
    }
    saveDb(db);
    res.json({ success: true, count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/ma-ngoai/by-hang/:ma_hang ──────────────────────────────────────
router.get('/by-hang/:ma_hang', async (req, res) => {
  try {
    const db = await getDb();
    const rows = dbQuery(db, 'SELECT * FROM ma_ngoai WHERE ma_hang = $m ORDER BY nha_cc', { $m: req.params.ma_hang });
    db.close();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
