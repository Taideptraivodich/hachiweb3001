const express = require('express');
const router  = express.Router();
const { getMisaPool, sql } = require('../db');
const { getDb, saveDb, dbQuery, dbGet } = require('../sqlite');

function parseDates(query) {
  const today    = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  return {
    fromDate: query.tu_ngay  || firstDay,
    toDate:   query.den_ngay || today,
  };
}

// ─── Helper: kiểm tra MISA online ────────────────────────────────────────────
async function checkMisaOnline() {
  try {
    const misa = await getMisaPool();
    await misa.request().query('SELECT 1 AS ping');
    return true;
  } catch {
    return false;
  }
}

// ─── Helper: đọc thời điểm sync cuối từ SQLite ───────────────────────────────
async function getLastSync(key) {
  try {
    const db = await getDb();
    const row = dbGet(db, `SELECT value FROM sync_meta WHERE key = ?`, [key]);
    db.close();
    return row ? row.value : null;
  } catch {
    return null;
  }
}

// ─── GET /tonkho/tong-hop ─────────────────────────────────────────────────────
router.get('/tong-hop', async (req, res) => {
  const { fromDate, toDate } = parseDates(req.query);
  const { q, kho } = req.query;

  // 1) Thử MISA trực tiếp
  const misaOnline = await checkMisaOnline();

  if (misaOnline) {
    try {
      const misa    = await getMisaPool();
      const request = misa.request();
      request.input('tu_ngay',  sql.Date, new Date(fromDate));
      request.input('den_ngay', sql.Date, new Date(toDate));

      const result = await request.query(`
        WITH dau_ky AS (
          SELECT
            il.InventoryItemCode,
            SUM(il.InwardQuantity)  - SUM(il.OutwardQuantity) AS sl,
            SUM(il.InwardAmount)    - SUM(il.OutwardAmount)   AS gt
          FROM InventoryLedger il
          WHERE il.InventoryItemCode IS NOT NULL
            AND il.InventoryItemCode <> ''
            AND il.PostedDate < @tu_ngay
          GROUP BY il.InventoryItemCode
        ),
        trong_ky AS (
          SELECT
            il.InventoryItemCode,
            MAX(il.InventoryItemName)  AS ten_hang,
            MAX(il.StockName)          AS kho,
            MAX(u.UnitName)            AS dvt,
            SUM(il.InwardQuantity)     AS nhap_sl,
            SUM(il.InwardAmount)       AS nhap_gt,
            SUM(il.OutwardQuantity)    AS xuat_sl,
            SUM(il.OutwardAmount)      AS xuat_gt
          FROM InventoryLedger il
          LEFT JOIN Unit u ON u.UnitID = il.UnitID
          WHERE il.InventoryItemCode IS NOT NULL
            AND il.InventoryItemCode <> ''
            AND il.PostedDate BETWEEN @tu_ngay AND @den_ngay
          GROUP BY il.InventoryItemCode
        ),
        all_hang AS (
          SELECT InventoryItemCode FROM dau_ky WHERE sl <> 0
          UNION
          SELECT InventoryItemCode FROM trong_ky
        )
        SELECT
          a.InventoryItemCode AS ma_hang,
          (SELECT TOP 1 UnitPrice FROM InventoryLedger
           WHERE InventoryItemCode = a.InventoryItemCode
             AND InwardQuantity > 0 AND UnitPrice > 0
           ORDER BY PostedDate DESC, SortOrder DESC) AS don_gia,
          ISNULL(tk.ten_hang,
            (SELECT TOP 1 InventoryItemName FROM InventoryLedger
             WHERE InventoryItemCode = a.InventoryItemCode)) AS ten_hang,
          tk.kho, tk.dvt,
          ISNULL(dk.sl, 0) AS dau_ky_sl,
          ISNULL(dk.gt, 0) AS dau_ky_gt,
          ISNULL(tk.nhap_sl, 0) AS nhap_sl,
          ISNULL(tk.nhap_gt, 0) AS nhap_gt,
          ISNULL(tk.xuat_sl, 0) AS xuat_sl,
          ISNULL(tk.xuat_gt, 0) AS xuat_gt
        FROM all_hang a
        LEFT JOIN dau_ky  dk ON dk.InventoryItemCode = a.InventoryItemCode
        LEFT JOIN trong_ky tk ON tk.InventoryItemCode = a.InventoryItemCode
        ORDER BY ten_hang
      `);

      let data = result.recordset.map(r => ({
        ...r,
        cuoi_ky_sl: Number(r.dau_ky_sl) + Number(r.nhap_sl) - Number(r.xuat_sl),
        cuoi_ky_gt: Number(r.dau_ky_gt) + Number(r.nhap_gt) - Number(r.xuat_gt),
      }));

      const danhSachKho = [...new Set(result.recordset.map(r => r.kho).filter(Boolean))].sort();

      if (q) {
        const qLower = q.toLowerCase();
        data = data.filter(r =>
          (r.ma_hang || '').toLowerCase().includes(qLower) ||
          (r.ten_hang || '').toLowerCase().includes(qLower)
        );
      }
      if (kho) data = data.filter(r => (r.kho || '') === kho);

      // Cập nhật cache sau khi lấy live thành công
      _updateTonkhoCache(data, fromDate, toDate).catch(() => {});

      return res.json({ success: true, data, danhSachKho, total: data.length, from_cache: false });
    } catch (err) {
      console.error('❌ Tồn kho tổng hợp MISA lỗi:', err.message);
      // fall through to cache
    }
  }

  // 2) Fallback: đọc từ SQLite cache
  console.log('⚠️  MISA offline — đọc tồn kho từ cache SQLite');
  try {
    const db = await getDb();
    let rows = dbQuery(db, `
      SELECT ma_hang, ten_hang, kho, dvt, don_gia,
             dau_ky_sl, dau_ky_gt, nhap_sl, nhap_gt, xuat_sl, xuat_gt,
             cuoi_ky_sl, cuoi_ky_gt, updated_at
      FROM tonkho_cache
      WHERE tu_ngay = ? AND den_ngay = ?
      ORDER BY ten_hang
    `, [fromDate, toDate]);

    // Nếu không có cache đúng kỳ, lấy cache gần nhất
    if (!rows || rows.length === 0) {
      rows = dbQuery(db, `
        SELECT ma_hang, ten_hang, kho, dvt, don_gia,
               dau_ky_sl, dau_ky_gt, nhap_sl, nhap_gt, xuat_sl, xuat_gt,
               cuoi_ky_sl, cuoi_ky_gt, tu_ngay, den_ngay, updated_at
        FROM tonkho_cache
        ORDER BY updated_at DESC
        LIMIT 5000
      `, []);
    }

    db.close();

    const danhSachKho = [...new Set(rows.map(r => r.kho).filter(Boolean))].sort();
    let data = rows;
    if (q) {
      const qLower = q.toLowerCase();
      data = data.filter(r =>
        (r.ma_hang || '').toLowerCase().includes(qLower) ||
        (r.ten_hang || '').toLowerCase().includes(qLower)
      );
    }
    if (kho) data = data.filter(r => (r.kho || '') === kho);

    const lastSync = await getLastSync('last_sync_tonkho');
    return res.json({
      success: true, data, danhSachKho, total: data.length,
      from_cache: true,
      cache_note: `⚠️ Dữ liệu offline — lần sync cuối: ${lastSync || 'chưa có'}`,
    });
  } catch (cacheErr) {
    console.error('❌ Đọc cache tồn kho lỗi:', cacheErr.message);
    return res.status(503).json({ success: false, error: 'MISA offline và không có cache. Vui lòng thử lại sau.' });
  }
});

// ─── GET /tonkho/chi-tiet ─────────────────────────────────────────────────────
router.get('/chi-tiet', async (req, res) => {
  const { ma_hang } = req.query;
  if (!ma_hang) return res.status(400).json({ success: false, error: 'Thiếu ma_hang' });

  const { fromDate, toDate } = parseDates(req.query);

  const misaOnline = await checkMisaOnline();

  if (misaOnline) {
    try {
      const misa = await getMisaPool();

      const req1 = misa.request();
      req1.input('ma_hang',  sql.NVarChar, ma_hang);
      req1.input('tu_ngay',  sql.Date, new Date(fromDate));
      const dauKyRes = await req1.query(`
        SELECT
          ISNULL(SUM(InwardQuantity),  0) AS nhap_sl,
          ISNULL(SUM(OutwardQuantity), 0) AS xuat_sl,
          ISNULL(SUM(InwardAmount),    0) AS nhap_gt,
          ISNULL(SUM(OutwardAmount),   0) AS xuat_gt,
          MAX(InventoryItemName)          AS ten_hang,
          (SELECT TOP 1 UnitPrice FROM InventoryLedger
           WHERE InventoryItemCode = @ma_hang
             AND PostedDate < @tu_ngay
             AND InwardQuantity > 0 AND UnitPrice > 0
           ORDER BY PostedDate DESC, SortOrder DESC) AS don_gia
        FROM InventoryLedger
        WHERE InventoryItemCode = @ma_hang AND PostedDate < @tu_ngay
      `);

      const req2 = misa.request();
      req2.input('ma_hang',  sql.NVarChar, ma_hang);
      req2.input('tu_ngay',  sql.Date, new Date(fromDate));
      req2.input('den_ngay', sql.Date, new Date(toDate));
      const chiTietRes = await req2.query(`
        SELECT
          il.PostedDate        AS ngay_hach_toan,
          il.RefDate           AS ngay_ct,
          il.RefNo             AS so_ct,
          il.JournalMemo       AS dien_giai,
          u.UnitName           AS dvt,
          il.UnitPrice         AS don_gia,
          il.InwardQuantity    AS nhap_sl,
          il.InwardAmount      AS nhap_gt,
          il.OutwardQuantity   AS xuat_sl,
          il.OutwardAmount     AS xuat_gt,
          il.StockName         AS kho,
          il.InventoryItemName AS ten_hang
        FROM InventoryLedger il
        LEFT JOIN Unit u ON u.UnitID = il.UnitID
        WHERE il.InventoryItemCode = @ma_hang
          AND il.PostedDate BETWEEN @tu_ngay AND @den_ngay
          AND (il.InwardQuantity <> 0 OR il.OutwardQuantity <> 0)
        ORDER BY il.PostedDate ASC, il.SortOrder ASC
      `);

      const dk      = dauKyRes.recordset[0];
      const dauKySL = Number(dk?.nhap_sl || 0) - Number(dk?.xuat_sl || 0);
      const dauKyGT = Number(dk?.nhap_gt || 0) - Number(dk?.xuat_gt || 0);

      let tonSL = dauKySL, tonGT = dauKyGT;
      const rows = chiTietRes.recordset.map(r => {
        tonSL += Number(r.nhap_sl || 0) - Number(r.xuat_sl || 0);
        tonGT += Number(r.nhap_gt || 0) - Number(r.xuat_gt || 0);
        return { ...r, ton_sl: tonSL, ton_gt: tonGT };
      });

      return res.json({
        success: true, ma_hang,
        ten_hang: dk?.ten_hang || rows[0]?.ten_hang || ma_hang,
        dau_ky_sl: dauKySL, dau_ky_gt: dauKyGT,
        dau_ky_don_gia: Number(dk?.don_gia || 0),
        data: rows, from_cache: false,
      });
    } catch (err) {
      console.error('❌ Tồn kho chi tiết MISA lỗi:', err.message);
      // fall through
    }
  }

  // Fallback cache — chi tiết chỉ có tổng hợp, thông báo offline
  const lastSync = await getLastSync('last_sync_tonkho');
  return res.status(503).json({
    success: false,
    error: `MISA đang offline. Chi tiết tồn kho không có sẵn trong cache. Lần sync cuối: ${lastSync || 'chưa có'}`,
    from_cache: true,
  });
});

// ─── Helper: cập nhật cache tonkho sau khi đọc live thành công ───────────────
async function _updateTonkhoCache(data, tu_ngay, den_ngay) {
  const db  = await getDb();
  const now = new Date().toLocaleString('vi-VN');
  for (const row of data) {
    db.run(`
      INSERT INTO tonkho_cache
        (ma_hang, ten_hang, kho, dvt, don_gia,
         dau_ky_sl, dau_ky_gt, nhap_sl, nhap_gt, xuat_sl, xuat_gt,
         cuoi_ky_sl, cuoi_ky_gt, tu_ngay, den_ngay, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ma_hang, tu_ngay, den_ngay) DO UPDATE SET
        ten_hang=excluded.ten_hang, kho=excluded.kho, dvt=excluded.dvt,
        don_gia=excluded.don_gia,
        dau_ky_sl=excluded.dau_ky_sl, dau_ky_gt=excluded.dau_ky_gt,
        nhap_sl=excluded.nhap_sl,     nhap_gt=excluded.nhap_gt,
        xuat_sl=excluded.xuat_sl,     xuat_gt=excluded.xuat_gt,
        cuoi_ky_sl=excluded.cuoi_ky_sl, cuoi_ky_gt=excluded.cuoi_ky_gt,
        updated_at=excluded.updated_at
    `, [
      row.ma_hang, row.ten_hang||'', row.kho||'', row.dvt||'', row.don_gia||0,
      row.dau_ky_sl||0, row.dau_ky_gt||0,
      row.nhap_sl||0, row.nhap_gt||0,
      row.xuat_sl||0, row.xuat_gt||0,
      row.cuoi_ky_sl||0, row.cuoi_ky_gt||0,
      tu_ngay, den_ngay, now,
    ]);
  }
  db.run(`
    INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `, ['last_sync_tonkho', now, now]);
  saveDb(db);
}

module.exports = router;
