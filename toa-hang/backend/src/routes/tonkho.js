const express = require('express');
const router  = express.Router();
const { getMisaPool, sql } = require('../db');
const { getDb, saveDb, dbQuery, dbGet } = require('../sqlite');

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

async function getLastSync(key) {
  try {
    const db  = await getDb();
    const row = dbGet(db, `SELECT value FROM sync_meta WHERE key = ?`, [key]);
    db.close();
    return row ? row.value : null;
  } catch {
    return null;
  }
}

// ─── Helper: parse date params ────────────────────────────────────────────────
function parseDates(query) {
  const today   = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  return {
    fromDate: query.tu_ngay  || firstDay,
    toDate:   query.den_ngay || today,
  };
}

// ─── GET /tonkho/tong-hop ─────────────────────────────────────────────────────
// Tổng hợp tồn kho theo mặt hàng (giống màn hình MISA "Tổng hợp tồn kho")
// Trả về: đầu kỳ, nhập kho, xuất kho, cuối kỳ (số lượng + giá trị)
router.get('/tong-hop', async (req, res) => {
  const { fromDate, toDate } = parseDates(req.query);
  const { q, kho } = req.query;

  const misaOnline = await checkMisaOnline();

  if (misaOnline) {
    try {
      const misa = await getMisaPool();
      const request = misa.request();
      request.input('tu_ngay',  sql.Date, new Date(fromDate));
      request.input('den_ngay', sql.Date, new Date(toDate));

      const result = await request.query(`
        SELECT
          il.InventoryItemCode                                              AS ma_hang,
          MAX(il.InventoryItemName)                                         AS ten_hang,
          il.StockName                                                      AS kho,
          MAX(u.UnitName)                                                   AS dvt,
          ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
            THEN il.InwardQuantity  ELSE 0 END), 0)
          - ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
            THEN il.OutwardQuantity ELSE 0 END), 0)                        AS dau_ky_sl,
          ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
            THEN il.InwardAmount    ELSE 0 END), 0)
          - ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
            THEN il.OutwardAmount   ELSE 0 END), 0)                        AS dau_ky_gt,
          ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
            THEN il.InwardQuantity  ELSE 0 END), 0)                        AS nhap_sl,
          ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
            THEN il.InwardAmount    ELSE 0 END), 0)                        AS nhap_gt,
          ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
            THEN il.OutwardQuantity ELSE 0 END), 0)                        AS xuat_sl,
          ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
            THEN il.OutwardAmount   ELSE 0 END), 0)                        AS xuat_gt
        FROM InventoryLedger il
        LEFT JOIN Unit u ON u.UnitID = il.UnitID
        WHERE il.InventoryItemCode IS NOT NULL
          AND il.InventoryItemCode <> ''
        GROUP BY il.InventoryItemCode, il.StockName
        HAVING
          (
            ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
              THEN il.InwardQuantity - il.OutwardQuantity ELSE 0 END), 0) <> 0
            OR ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
              THEN il.InwardQuantity + il.OutwardQuantity ELSE 0 END), 0) > 0
          )
        ORDER BY MAX(il.InventoryItemName), il.StockName
      `);

      let data = result.recordset.map(r => ({
        ...r,
        cuoi_ky_sl: Number(r.dau_ky_sl) + Number(r.nhap_sl) - Number(r.xuat_sl),
        cuoi_ky_gt: Number(r.dau_ky_gt) + Number(r.nhap_gt) - Number(r.xuat_gt),
      }));

      // Cập nhật cache (toàn bộ, không filter)
      _updateTonkhoCache(data, fromDate, toDate).catch(() => {});

      // Filter sau khi đã cache
      if (q) {
        const qLower = q.toLowerCase();
        data = data.filter(r =>
          (r.ma_hang || '').toLowerCase().includes(qLower) ||
          (r.ten_hang || '').toLowerCase().includes(qLower)
        );
      }
      if (kho) data = data.filter(r => (r.kho || '') === kho);

      const danhSachKho = [...new Set(result.recordset.map(r => r.kho).filter(Boolean))].sort();
      return res.json({ success: true, data, danhSachKho, total: data.length, from_cache: false });
    } catch (err) {
      console.error('❌ Tồn kho tổng hợp MISA lỗi:', err.message);
      // fall through
    }
  }

  // Fallback cache
  console.log('⚠️  MISA offline — đọc tồn kho tổng hợp từ cache SQLite');
  try {
    const db = await getDb();
    let rows = dbQuery(db, `
      SELECT ma_hang, ten_hang, kho, dvt,
             dau_ky_sl, dau_ky_gt, nhap_sl, nhap_gt,
             xuat_sl, xuat_gt, cuoi_ky_sl, cuoi_ky_gt, updated_at
      FROM tonkho_cache
      WHERE tu_ngay = ? AND den_ngay = ?
      ORDER BY ten_hang
    `, [fromDate, toDate]);

    if (!rows || rows.length === 0) {
      rows = dbQuery(db, `
        SELECT ma_hang, ten_hang, kho, dvt,
               dau_ky_sl, dau_ky_gt, nhap_sl, nhap_gt,
               xuat_sl, xuat_gt, cuoi_ky_sl, cuoi_ky_gt,
               tu_ngay, den_ngay, updated_at
        FROM tonkho_cache
        ORDER BY updated_at DESC
        LIMIT 5000
      `, []);
    }
    db.close();

    // Filter từ cache
    let data = rows;
    if (q) {
      const qLower = q.toLowerCase();
      data = data.filter(r =>
        (r.ma_hang || '').toLowerCase().includes(qLower) ||
        (r.ten_hang || '').toLowerCase().includes(qLower)
      );
    }
    if (kho) data = data.filter(r => (r.kho || '') === kho);

    const danhSachKho = [...new Set(rows.map(r => r.kho).filter(Boolean))].sort();
    const lastSync    = await getLastSync('last_sync_tonkho');
    return res.json({
      success: true,
      data,
      danhSachKho,
      total: data.length,
      from_cache: true,
      cache_note: `⚠️ Dữ liệu offline — lần sync cuối: ${lastSync || 'chưa có'}`,
    });
  } catch (cacheErr) {
    console.error('❌ Đọc cache tồn kho lỗi:', cacheErr.message);
    return res.status(503).json({ success: false, error: 'MISA offline và không có cache. Vui lòng thử lại sau.' });
  }
});

// ─── GET /tonkho/chi-tiet ─────────────────────────────────────────────────────
// Sổ chi tiết vật tư hàng hóa cho 1 mặt hàng (giống màn hình MISA "Sổ chi tiết VTHH")
// Trả về: từng dòng nhập/xuất theo ngày, số dư lũy kế
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
      req1.input('den_ngay', sql.Date, new Date(toDate));

      // Số dư đầu kỳ
      const dauKyRes = await req1.query(`
        SELECT
          ISNULL(SUM(InwardQuantity),  0) AS nhap_sl,
          ISNULL(SUM(OutwardQuantity), 0) AS xuat_sl,
          ISNULL(SUM(InwardAmount),    0) AS nhap_gt,
          ISNULL(SUM(OutwardAmount),   0) AS xuat_gt
        FROM InventoryLedger
        WHERE InventoryItemCode = @ma_hang
          AND PostedDate < @tu_ngay
      `);

      const req2 = misa.request();
      req2.input('ma_hang',  sql.NVarChar, ma_hang);
      req2.input('tu_ngay',  sql.Date, new Date(fromDate));
      req2.input('den_ngay', sql.Date, new Date(toDate));

      // Các dòng phát sinh trong kỳ
      const chiTietRes = await req2.query(`
        SELECT
          il.PostedDate                 AS ngay_hach_toan,
          il.RefDate                    AS ngay_ct,
          il.RefNo                      AS so_ct,
          il.JournalMemo                AS dien_giai,
          il.UnitPrice                  AS don_gia,
          il.InwardQuantity             AS nhap_sl,
          il.InwardAmount               AS nhap_gt,
          il.OutwardQuantity            AS xuat_sl,
          il.OutwardAmount              AS xuat_gt,
          il.StockName                  AS kho,
          MAX(il.InventoryItemName)     AS ten_hang
        FROM InventoryLedger il
        WHERE il.InventoryItemCode = @ma_hang
          AND il.PostedDate BETWEEN @tu_ngay AND @den_ngay
          AND (il.InwardQuantity <> 0 OR il.OutwardQuantity <> 0)
        GROUP BY
          il.PostedDate, il.RefDate, il.RefNo, il.JournalMemo,
          il.UnitPrice, il.InwardQuantity, il.InwardAmount,
          il.OutwardQuantity, il.OutwardAmount, il.StockName
        ORDER BY il.PostedDate ASC, il.RefNo ASC
      `);

      const dk     = dauKyRes.recordset[0];
      const dauKySL = Number(dk.nhap_sl) - Number(dk.xuat_sl);
      const dauKyGT = Number(dk.nhap_gt) - Number(dk.xuat_gt);
      const dauKyDonGia = dauKySL !== 0 ? Math.abs(dauKyGT / dauKySL) : 0;

      let tonSL = dauKySL, tonGT = dauKyGT;
      const rows = chiTietRes.recordset.map(r => {
        tonSL += Number(r.nhap_sl || 0) - Number(r.xuat_sl || 0);
        tonGT += Number(r.nhap_gt || 0) - Number(r.xuat_gt || 0);
        return { ...r, ton_sl: tonSL, ton_gt: tonGT };
      });

      // Lưu cache chi tiết
      _updateTonkhoChiTietCache(ma_hang, fromDate, toDate, dauKySL, dauKyGT, dauKyDonGia, rows).catch(() => {});

      return res.json({
        success: true, ma_hang,
        ten_hang: rows[0]?.ten_hang || ma_hang,
        dau_ky_sl: dauKySL,
        dau_ky_gt: dauKyGT,
        dau_ky_don_gia: dauKyDonGia,
        data: rows,
        from_cache: false,
      });
    } catch (err) {
      console.error('❌ Tồn kho chi tiết MISA lỗi:', err.message);
      // fall through
    }
  }

  // Fallback cache chi tiết
  console.log('⚠️  MISA offline — đọc tồn kho chi tiết từ cache SQLite');
  try {
    const db = await getDb();

    // Tìm đúng kỳ trước, nếu không có thì lấy kỳ gần nhất
    const header = dbGet(db, `
      SELECT dau_ky_sl, dau_ky_gt, dau_ky_don_gia, ten_hang, tu_ngay, den_ngay, updated_at
      FROM tonkho_chitiet_cache
      WHERE ma_hang = ? AND tu_ngay = ? AND den_ngay = ?
      LIMIT 1
    `, [ma_hang, fromDate, toDate]);

    let rows = [], usedFrom = fromDate, usedTo = toDate, cachedAt = null, tenHang = ma_hang;

    if (header) {
      rows = dbQuery(db, `
        SELECT ngay_hach_toan, ngay_ct, so_ct, dien_giai, dvt, don_gia,
               nhap_sl, nhap_gt, xuat_sl, xuat_gt, kho, ton_sl, ton_gt
        FROM tonkho_chitiet_cache
        WHERE ma_hang = ? AND tu_ngay = ? AND den_ngay = ?
        ORDER BY id ASC
      `, [ma_hang, fromDate, toDate]);
      cachedAt = header.updated_at;
      tenHang  = header.ten_hang || ma_hang;
    } else {
      const nearest = dbGet(db, `
        SELECT tu_ngay, den_ngay, dau_ky_sl, dau_ky_gt, dau_ky_don_gia, ten_hang, updated_at
        FROM tonkho_chitiet_cache
        WHERE ma_hang = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `, [ma_hang]);

      if (nearest) {
        usedFrom = nearest.tu_ngay;
        usedTo   = nearest.den_ngay;
        cachedAt = nearest.updated_at;
        tenHang  = nearest.ten_hang || ma_hang;
        rows = dbQuery(db, `
          SELECT ngay_hach_toan, ngay_ct, so_ct, dien_giai, dvt, don_gia,
                 nhap_sl, nhap_gt, xuat_sl, xuat_gt, kho, ton_sl, ton_gt
          FROM tonkho_chitiet_cache
          WHERE ma_hang = ? AND tu_ngay = ? AND den_ngay = ?
          ORDER BY id ASC
        `, [ma_hang, usedFrom, usedTo]);
      }
    }

    db.close();

    if (!header && rows.length === 0) {
      const lastSync = await getLastSync('last_sync_tonkho');
      return res.status(503).json({
        success: false,
        error: `MISA đang offline và chưa có cache cho mặt hàng này. Lần sync cuối: ${lastSync || 'chưa có'}`,
        from_cache: true,
      });
    }

    const h = header || { dau_ky_sl: 0, dau_ky_gt: 0, dau_ky_don_gia: 0 };
    return res.json({
      success: true,
      ma_hang,
      ten_hang: tenHang,
      dau_ky_sl: h.dau_ky_sl,
      dau_ky_gt: h.dau_ky_gt,
      dau_ky_don_gia: h.dau_ky_don_gia,
      data: rows,
      from_cache: true,
      cache_note: `⚠️ Dữ liệu offline — lần sync cuối: ${cachedAt || 'chưa có'}${usedFrom !== fromDate ? ` (kỳ ${usedFrom} → ${usedTo})` : ''}`,
    });
  } catch (cacheErr) {
    console.error('❌ Đọc cache tồn kho chi tiết lỗi:', cacheErr.message);
    const lastSync = await getLastSync('last_sync_tonkho');
    return res.status(503).json({
      success: false,
      error: `MISA đang offline và không đọc được cache. Lần sync cuối: ${lastSync || 'chưa có'}`,
      from_cache: true,
    });
  }
});

// ─── Helper: cập nhật cache tồn kho tổng hợp ─────────────────────────────────
async function _updateTonkhoCache(data, tu_ngay, den_ngay) {
  const db  = await getDb();
  const now = new Date().toLocaleString('vi-VN');
  for (const row of data) {
    db.run(`
      INSERT INTO tonkho_cache
        (ma_hang, ten_hang, kho, dvt, dau_ky_sl, dau_ky_gt,
         nhap_sl, nhap_gt, xuat_sl, xuat_gt, cuoi_ky_sl, cuoi_ky_gt,
         tu_ngay, den_ngay, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ma_hang, kho, tu_ngay, den_ngay) DO UPDATE SET
        ten_hang=excluded.ten_hang, dvt=excluded.dvt,
        dau_ky_sl=excluded.dau_ky_sl, dau_ky_gt=excluded.dau_ky_gt,
        nhap_sl=excluded.nhap_sl,     nhap_gt=excluded.nhap_gt,
        xuat_sl=excluded.xuat_sl,     xuat_gt=excluded.xuat_gt,
        cuoi_ky_sl=excluded.cuoi_ky_sl, cuoi_ky_gt=excluded.cuoi_ky_gt,
        updated_at=excluded.updated_at
    `, [
      row.ma_hang, row.ten_hang || '', row.kho || '', row.dvt || '',
      row.dau_ky_sl || 0, row.dau_ky_gt || 0,
      row.nhap_sl || 0,   row.nhap_gt || 0,
      row.xuat_sl || 0,   row.xuat_gt || 0,
      row.cuoi_ky_sl || 0, row.cuoi_ky_gt || 0,
      tu_ngay, den_ngay, now,
    ]);
  }
  db.run(`
    INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `, ['last_sync_tonkho', now, now]);
  saveDb(db);
}

// ─── Helper: cập nhật cache tồn kho chi tiết ─────────────────────────────────
async function _updateTonkhoChiTietCache(ma_hang, tu_ngay, den_ngay, dau_ky_sl, dau_ky_gt, dau_ky_don_gia, rows) {
  const db  = await getDb();
  const now = new Date().toLocaleString('vi-VN');

  db.run(`DELETE FROM tonkho_chitiet_cache WHERE ma_hang = ? AND tu_ngay = ? AND den_ngay = ?`,
    [ma_hang, tu_ngay, den_ngay]);

  if (rows.length === 0) {
    // Không có dòng phát sinh — vẫn lưu 1 dòng header để giữ đầu kỳ + đơn giá
    db.run(`
      INSERT INTO tonkho_chitiet_cache
        (ma_hang, tu_ngay, den_ngay, ten_hang, dau_ky_sl, dau_ky_gt, dau_ky_don_gia, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `, [ma_hang, tu_ngay, den_ngay, '', dau_ky_sl, dau_ky_gt, dau_ky_don_gia, now]);
  } else {
    for (const r of rows) {
      db.run(`
        INSERT INTO tonkho_chitiet_cache
          (ma_hang, tu_ngay, den_ngay, ten_hang, dau_ky_sl, dau_ky_gt, dau_ky_don_gia,
           ngay_hach_toan, ngay_ct, so_ct, dien_giai, dvt, don_gia,
           nhap_sl, nhap_gt, xuat_sl, xuat_gt, kho, ton_sl, ton_gt, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        ma_hang, tu_ngay, den_ngay, r.ten_hang || '', dau_ky_sl, dau_ky_gt, dau_ky_don_gia,
        r.ngay_hach_toan ? new Date(r.ngay_hach_toan).toISOString().slice(0, 10) : null,
        r.ngay_ct        ? new Date(r.ngay_ct).toISOString().slice(0, 10)        : null,
        r.so_ct || '', r.dien_giai || '', r.dvt || '',
        r.don_gia || 0,
        r.nhap_sl || 0, r.nhap_gt || 0,
        r.xuat_sl || 0, r.xuat_gt || 0,
        r.kho || '',
        r.ton_sl || 0, r.ton_gt || 0,
        now,
      ]);
    }
  }

  db.run(`
    INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `, ['last_sync_tonkho_chitiet', now, now]);

  saveDb(db);
}

module.exports = router;
