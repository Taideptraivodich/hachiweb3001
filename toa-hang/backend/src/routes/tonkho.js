const express = require('express');
const router  = express.Router();
const { getMisaPool, sql } = require('../db');
const { getDb, saveDb, dbQuery, dbGet } = require('../sqlite');
const { lookupInventoryCache: lookupInventoryCacheIndex, loadInventoryCacheIndex } = require('../services/inventoryCacheIndex');

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

// ─── Helpers: tra tồn đúng một mã ─────────────────────────────────────────────
async function lookupInventoryOnline(maHang) {
  const misaOnline = await checkMisaOnline();
  if (!misaOnline) {
    const error = new Error('MISA đang offline');
    error.code = 'MISA_OFFLINE';
    throw error;
  }

  const misa = await getMisaPool();
  const request = misa.request();
  request.input('ma_hang', sql.NVarChar, maHang);

  const result = await request.query(`
    WITH LatestPrice AS (
      SELECT
        il.InventoryItemCode,
        il.StockName,
        il.UnitPrice,
        pvd.VATRate,
        il.PostedDate,
        il.RefDate,
        il.RefNo,
        ROW_NUMBER() OVER (
          PARTITION BY il.InventoryItemCode, il.StockName
          ORDER BY il.PostedDate DESC, il.RefDate DESC, il.RefNo DESC
        ) AS rn
      FROM InventoryLedger il
      LEFT JOIN PUVoucherDetail pvd ON pvd.RefDetailID = il.RefDetailID
      WHERE il.InventoryItemCode = @ma_hang
        AND ISNULL(il.UnitPrice, 0) > 0
        AND ISNULL(il.InwardQuantity, 0) > 0
    )
    SELECT
      il.InventoryItemCode AS ma_hang,
      MAX(il.InventoryItemName) AS ten_hang,
      il.StockName AS kho,
      MAX(u.UnitName) AS dvt,
      ISNULL(SUM(il.InwardQuantity), 0) - ISNULL(SUM(il.OutwardQuantity), 0) AS ton_kho,
      CASE WHEN ISNULL(lp.VATRate, 0) > 0
        THEN ISNULL(ROUND(lp.UnitPrice * (1 + lp.VATRate / 100.0), 0), 0)
        ELSE ISNULL(ROUND(lp.UnitPrice, 0), 0)
      END AS don_gia,
      ISNULL(lp.UnitPrice, 0) AS don_gia_goc,
      ISNULL(lp.VATRate, 0) AS don_gia_vat_rate,
      lp.PostedDate AS ngay_gia_gan_nhat,
      lp.RefNo AS so_ct_gia_gan_nhat
    FROM InventoryLedger il
    LEFT JOIN Unit u ON u.UnitID = il.UnitID
    LEFT JOIN LatestPrice lp
      ON lp.InventoryItemCode = il.InventoryItemCode
      AND lp.StockName = il.StockName
      AND lp.rn = 1
    WHERE il.InventoryItemCode = @ma_hang
    GROUP BY il.InventoryItemCode, il.StockName,
             lp.UnitPrice, lp.VATRate, lp.PostedDate, lp.RefNo
    ORDER BY il.StockName
  `);

  const rows = result.recordset.map(row => ({
    ...row,
    ton_kho: Number(row.ton_kho || 0),
    don_gia: Number(row.don_gia || 0),
    don_gia_goc: Number(row.don_gia_goc || 0),
    don_gia_vat_rate: Number(row.don_gia_vat_rate || 0),
  }));

  return {
    success: true,
    ma_hang: maHang,
    data: rows,
    tong_ton: rows.reduce((sum, row) => sum + Number(row.ton_kho || 0), 0),
    from_cache: false,
    price_definition: 'Giá nhập gần nhất đã cộng VAT theo PUVoucherDetail',
  };
}

async function lookupInventoryCache(maHang) {
  const { rows, lastSync, indexLoadedAt } = await lookupInventoryCacheIndex(maHang);
  return {
    success: true,
    ma_hang: maHang,
    data: rows,
    tong_ton: rows.reduce((sum, row) => sum + Number(row.ton_kho || 0), 0),
    from_cache: true,
    cache_mode: 'scheduled_snapshot',
    last_sync: lastSync,
    index_loaded_at: indexLoadedAt,
    cache_note: `Dữ liệu tồn kho đồng bộ lúc: ${lastSync || 'chưa có'}`,
    price_definition: 'Giá nhập gần nhất đã cộng VAT từ snapshot tồn kho dùng chung',
  };
}

// ─── GET /tonkho/lookup ───────────────────────────────────────────────────────
// Mặc định giữ nguyên hành vi cũ cho các màn hình khác: ưu tiên MISA, lỗi thì fallback cache.
// Màn hình Tra mã dùng mode=cache để đọc snapshot tồn kho dùng chung, không gọi MISA riêng.
// mode=online vẫn giữ lại để tương thích, nhưng Tra mã không sử dụng.
router.get('/lookup', async (req, res) => {
  const maHang = String(req.query.ma_hang || '').trim();
  const mode = String(req.query.mode || '').trim().toLowerCase();
  if (!maHang) return res.status(400).json({ success: false, error: 'Thiếu ma_hang' });

  if (mode === 'cache') {
    try {
      return res.json(await lookupInventoryCache(maHang));
    } catch (error) {
      return res.status(503).json({ success: false, error: `Không đọc được cache tồn kho: ${error.message}` });
    }
  }

  if (mode === 'online') {
    try {
      return res.json(await lookupInventoryOnline(maHang));
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message || 'Không lấy được tồn MISA online' });
    }
  }

  try {
    return res.json(await lookupInventoryOnline(maHang));
  } catch (error) {
    console.error('❌ Tra tồn kho theo mã MISA lỗi:', error.message);
  }

  try {
    return res.json(await lookupInventoryCache(maHang));
  } catch (cacheErr) {
    return res.status(503).json({
      success: false,
      error: `MISA offline và không đọc được cache: ${cacheErr.message}`,
    });
  }
});

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
        WITH LatestPrice AS (
          SELECT
            il.InventoryItemCode,
            il.StockName,
            il.UnitPrice,
            pvd.VATRate,
            ROW_NUMBER() OVER (
              PARTITION BY il.InventoryItemCode, il.StockName
              ORDER BY il.PostedDate DESC, il.RefDate DESC, il.RefNo DESC
            ) AS rn
          FROM InventoryLedger il
          LEFT JOIN PUVoucherDetail pvd ON pvd.RefDetailID = il.RefDetailID
          WHERE il.PostedDate <= @den_ngay
            AND ISNULL(il.UnitPrice, 0) > 0
            AND ISNULL(il.InwardQuantity, 0) > 0
            -- Chỉ xét dòng NHẬP (mua hàng): VAT chỉ có ý nghĩa với giá mua.
            -- Dòng XUẤT mang giá vốn (COGS), không phải giá mua, và không có
            -- PUVoucherDetail tương ứng nên luôn bị hiểu nhầm là "không thuế".
        ),
        -- Ngày mua / bán gần nhất theo MÃ HÀNG (gộp mọi kho), tính trên toàn bộ lịch sử
        -- tới hết kỳ xem. Chỉ tính chứng từ mua/bán thật của MISA 2026:
        --   RefType 302  = Mua hàng trong nước nhập kho
        --   RefType 2020 = Xuất kho bán hàng
        -- KHÔNG tính: 611 (tồn đầu kỳ), 2013 (khách trả hàng), 3030 (trả NCC), 2014 (nhập khác).
        -- NULL = không có phát sinh trong 2026 (hàng từ phần mềm cũ).
        LastTx AS (
          SELECT
            il.InventoryItemCode,
            MAX(CASE WHEN il.RefType = 302  AND ISNULL(il.InwardQuantity, 0)  > 0 THEN il.PostedDate END) AS ngay_mua,
            MAX(CASE WHEN il.RefType = 2020 AND ISNULL(il.OutwardQuantity, 0) > 0 THEN il.PostedDate END) AS ngay_ban
          FROM InventoryLedger il
          WHERE il.InventoryItemCode IS NOT NULL
            AND il.InventoryItemCode <> ''
            AND il.PostedDate <= @den_ngay
          GROUP BY il.InventoryItemCode
        )
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
            THEN il.OutwardAmount   ELSE 0 END), 0)                        AS xuat_gt,
          CASE WHEN ISNULL(lp.VATRate, 0) > 0
            THEN ISNULL(ROUND(lp.UnitPrice * (1 + lp.VATRate / 100.0), 0), 0)
            ELSE ISNULL(ROUND(lp.UnitPrice, 0), 0)
          END                                                              AS don_gia,
          ISNULL(lp.UnitPrice, 0)                                          AS don_gia_goc,
          ISNULL(lp.VATRate, 0)                                           AS don_gia_vat_rate,
          CONVERT(VARCHAR(10), MAX(lt.ngay_mua), 23)                      AS ngay_mua_gan_nhat,
          CONVERT(VARCHAR(10), MAX(lt.ngay_ban), 23)                      AS ngay_ban_gan_nhat
        FROM InventoryLedger il
        LEFT JOIN Unit u ON u.UnitID = il.UnitID
        LEFT JOIN LatestPrice lp
          ON lp.InventoryItemCode = il.InventoryItemCode
          AND lp.StockName = il.StockName
          AND lp.rn = 1
        LEFT JOIN LastTx lt
          ON lt.InventoryItemCode = il.InventoryItemCode
        WHERE il.InventoryItemCode IS NOT NULL
          AND il.InventoryItemCode <> ''
        GROUP BY il.InventoryItemCode, il.StockName, lp.UnitPrice, lp.VATRate
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
      SELECT ma_hang, ten_hang, kho, dvt, don_gia, don_gia_goc, don_gia_vat_rate,
             dau_ky_sl, dau_ky_gt, nhap_sl, nhap_gt,
             xuat_sl, xuat_gt, cuoi_ky_sl, cuoi_ky_gt, updated_at,
             ngay_mua_gan_nhat, ngay_ban_gan_nhat
      FROM tonkho_cache
      WHERE tu_ngay = ? AND den_ngay = ?
      ORDER BY ten_hang
    `, [fromDate, toDate]);

    if (!rows || rows.length === 0) {
      // Không có cache đúng kỳ user chọn -> lấy snapshot gần nhất, NHƯNG chỉ đúng 1 dòng
      // mới nhất cho mỗi (ma_hang, kho) — tránh trộn nhiều kỳ lịch sử khác nhau vào cùng 1
      // response (root cause đã xác nhận bằng screenshot thật: cùng ma_hang+kho xuất hiện
      // nhiều lần với đầu kỳ/nhập/xuất khác nhau do mỗi lần sync 1 kỳ ngày khác lại ghi
      // thêm 1 dòng mới, PRIMARY KEY là (ma_hang, kho, tu_ngay, den_ngay)).
      rows = dbQuery(db, `
        SELECT t.ma_hang, t.ten_hang, t.kho, t.dvt, t.don_gia, t.don_gia_goc, t.don_gia_vat_rate,
               t.dau_ky_sl, t.dau_ky_gt, t.nhap_sl, t.nhap_gt,
               t.xuat_sl, t.xuat_gt, t.cuoi_ky_sl, t.cuoi_ky_gt,
               t.tu_ngay, t.den_ngay, t.updated_at,
               t.ngay_mua_gan_nhat, t.ngay_ban_gan_nhat
        FROM tonkho_cache t
        WHERE t.rowid = (
          SELECT t2.rowid FROM tonkho_cache t2
          WHERE t2.ma_hang = t.ma_hang AND t2.kho = t.kho
          ORDER BY t2.updated_at DESC, t2.rowid DESC
          LIMIT 1
        )
        ORDER BY t.ten_hang
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
  const { ma_hang, kho } = req.query;
  if (!ma_hang) return res.status(400).json({ success: false, error: 'Thiếu ma_hang' });
  if (!kho) return res.status(400).json({ success: false, error: 'Thiếu kho' });

  const { fromDate, toDate } = parseDates(req.query);

  const misaOnline = await checkMisaOnline();

  if (misaOnline) {
    try {
      const misa = await getMisaPool();
      const req1 = misa.request();
      req1.input('ma_hang',  sql.NVarChar, ma_hang);
      req1.input('kho',      sql.NVarChar, kho);
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
          AND StockName = @kho
          AND PostedDate < @tu_ngay
      `);

      const req2 = misa.request();
      req2.input('ma_hang',  sql.NVarChar, ma_hang);
      req2.input('kho',      sql.NVarChar, kho);
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
          il.RefID                      AS ref_id,
          il.RefType                    AS ref_type,
          MAX(il.InventoryItemName)     AS ten_hang
        FROM InventoryLedger il
        WHERE il.InventoryItemCode = @ma_hang
          AND il.StockName = @kho
          AND il.PostedDate BETWEEN @tu_ngay AND @den_ngay
          AND (il.InwardQuantity <> 0 OR il.OutwardQuantity <> 0)
        GROUP BY
          il.RefID, il.RefType,
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
      _updateTonkhoChiTietCache(ma_hang, kho, fromDate, toDate, dauKySL, dauKyGT, dauKyDonGia, rows).catch(() => {});

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

    // Tìm đúng kỳ trước, nếu không có thì lấy kỳ gần nhất (cùng kho)
    const header = dbGet(db, `
      SELECT dau_ky_sl, dau_ky_gt, dau_ky_don_gia, ten_hang, tu_ngay, den_ngay, updated_at
      FROM tonkho_chitiet_cache
      WHERE ma_hang = ? AND kho = ? AND tu_ngay = ? AND den_ngay = ?
      LIMIT 1
    `, [ma_hang, kho, fromDate, toDate]);

    let rows = [], usedFrom = fromDate, usedTo = toDate, cachedAt = null, tenHang = ma_hang;

    if (header) {
      rows = dbQuery(db, `
        SELECT ngay_hach_toan, ngay_ct, so_ct, dien_giai, dvt, don_gia,
               nhap_sl, nhap_gt, xuat_sl, xuat_gt, kho, ton_sl, ton_gt
        FROM tonkho_chitiet_cache
        WHERE ma_hang = ? AND kho = ? AND tu_ngay = ? AND den_ngay = ?
        ORDER BY id ASC
      `, [ma_hang, kho, fromDate, toDate]);
      cachedAt = header.updated_at;
      tenHang  = header.ten_hang || ma_hang;
    } else {
      const nearest = dbGet(db, `
        SELECT tu_ngay, den_ngay, dau_ky_sl, dau_ky_gt, dau_ky_don_gia, ten_hang, updated_at
        FROM tonkho_chitiet_cache
        WHERE ma_hang = ? AND kho = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `, [ma_hang, kho]);

      if (nearest) {
        usedFrom = nearest.tu_ngay;
        usedTo   = nearest.den_ngay;
        cachedAt = nearest.updated_at;
        tenHang  = nearest.ten_hang || ma_hang;
        rows = dbQuery(db, `
          SELECT ngay_hach_toan, ngay_ct, so_ct, dien_giai, dvt, don_gia,
                 nhap_sl, nhap_gt, xuat_sl, xuat_gt, kho, ton_sl, ton_gt
          FROM tonkho_chitiet_cache
          WHERE ma_hang = ? AND kho = ? AND tu_ngay = ? AND den_ngay = ?
          ORDER BY id ASC
        `, [ma_hang, kho, usedFrom, usedTo]);
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

// ─── GET /tonkho/chung-tu ─────────────────────────────────────────────────────
// Xem chứng từ nhập/xuất kho (giống bấm vào số chứng từ trong Sổ chi tiết VTHH của MISA).
// Dựng từ chính InventoryLedger theo RefID — một chứng từ có thể có nhiều dòng hàng.
// Chỉ đọc (SELECT), cần MISA online.
router.get('/chung-tu', async (req, res) => {
  const refId = String(req.query.ref_id || '').trim();
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(refId)) {
    return res.status(400).json({ success: false, error: 'ref_id không hợp lệ' });
  }
  if (!(await checkMisaOnline())) {
    return res.status(503).json({ success: false, error: 'MISA đang offline — không mở được chứng từ' });
  }
  try {
    const misa = await getMisaPool();
    const request = misa.request();
    request.input('ref_id', sql.UniqueIdentifier, refId);
    const result = await request.query(`
      SELECT
        il.RefType, il.RefTypeName, il.RefNo, il.RefDate, il.PostedDate,
        il.InventoryItemCode AS ma_hang, il.InventoryItemName AS ten_hang,
        il.StockName AS kho, u.UnitName AS dvt,
        il.UnitPrice AS don_gia,
        il.InwardQuantity AS nhap_sl, il.OutwardQuantity AS xuat_sl,
        il.InwardAmount AS nhap_gt, il.OutwardAmount AS xuat_gt,
        il.CorrespondingAccountNumber AS tk_doi_ung,
        il.JournalMemo AS dien_giai, il.Description AS ghi_chu,
        il.AccountObjectCode AS ma_doi_tuong, il.AccountObjectName AS ten_doi_tuong,
        il.AccountObjectAddress AS dia_chi, il.EmployeeName AS nhan_vien,
        pvd.VATRate AS vat_rate
      FROM InventoryLedger il
      LEFT JOIN Unit u ON u.UnitID = il.UnitID
      LEFT JOIN PUVoucherDetail pvd ON pvd.RefDetailID = il.RefDetailID
      WHERE il.RefID = @ref_id
      ORDER BY il.SortOrder, il.RefOrder
    `);
    const rows = result.recordset;
    if (!rows.length) return res.status(404).json({ success: false, error: 'Không tìm thấy chứng từ' });

    const h = rows[0];
    const isNhap = rows.some(r => Number(r.nhap_sl) > 0);
    const TEN_LOAI = { 302: 'Phiếu nhập kho — Mua hàng trong nước', 2020: 'Phiếu xuất kho — Bán hàng' };
    const lines = rows.map(r => {
      const sl = Number(isNhap ? r.nhap_sl : r.xuat_sl) || 0;
      const gt = Number(isNhap ? r.nhap_gt : r.xuat_gt) || 0;
      return {
        ma_hang: r.ma_hang, ten_hang: r.ten_hang, kho: r.kho, dvt: r.dvt,
        so_luong: sl, don_gia: Number(r.don_gia) || 0, thanh_tien: gt,
        vat_rate: r.vat_rate == null ? null : Number(r.vat_rate),
        tk_doi_ung: r.tk_doi_ung, ghi_chu: r.ghi_chu,
      };
    });
    // Phiếu XUẤT bán hàng: lấy GIÁ BÁN từ chứng từ bán hàng (SAVoucher) liên kết qua
    // SaleOutwardReference (INOutwardRefID → SAVoucherRefID), giống ô "Tham chiếu" của MISA.
    // Sổ kho chỉ có giá vốn nên không dùng được để hiện giá bán.
    let banHang = [];
    let banHangLoi = null;
    if (!isNhap) {
      try {
        const subQ = `SELECT SAVoucherRefID FROM SaleOutwardReference WHERE INOutwardRefID = @ref_id`;
        const r1 = misa.request();
        r1.input('ref_id', sql.UniqueIdentifier, refId);
        const hdrRes = await r1.query(`
          SELECT s.RefID AS sa_ref_id,
                 ISNULL(s.RefNoFinance, s.RefNoManagement) AS so_ct,
                 s.RefDate, s.PostedDate,
                 s.AccountObjectName AS khach_hang, s.AccountObjectAddress AS dia_chi,
                 s.JournalMemo AS dien_giai,
                 s.TotalSaleAmount AS tien_hang, s.TotalDiscountAmount AS chiet_khau,
                 s.TotalVATAmount AS thue_gtgt, s.TotalAmount AS thanh_toan
          FROM SAVoucher s
          WHERE s.RefID IN (${subQ})
          ORDER BY s.PostedDate, ISNULL(s.RefNoFinance, s.RefNoManagement)
        `);
        if (hdrRes.recordset.length) {
          const r2 = misa.request();
          r2.input('ref_id', sql.UniqueIdentifier, refId);
          const detRes = await r2.query(`
            SELECT d.RefID AS sa_ref_id, d.SortOrder, d.Quantity, d.UnitPrice, d.Amount,
                   d.DiscountAmount, d.VATRate, d.VATAmount, d.Description,
                   u.UnitName AS dvt,
                   x.InventoryItemCode AS ma_hang, x.InventoryItemName AS ten_hang, x.StockName AS kho
            FROM SAVoucherDetail d
            LEFT JOIN Unit u ON u.UnitID = d.UnitID
            OUTER APPLY (
              SELECT TOP 1 il.InventoryItemCode, il.InventoryItemName, il.StockName
              FROM InventoryLedger il
              WHERE il.InventoryItemID = d.InventoryItemID
              ORDER BY CASE WHEN il.RefID = @ref_id THEN 0 ELSE 1 END, il.PostedDate DESC
            ) x
            WHERE d.RefID IN (${subQ})
            ORDER BY d.SortOrder
          `);
          banHang = hdrRes.recordset.map(b => {
            const lns = detRes.recordset
              .filter(d => String(d.sa_ref_id).toLowerCase() === String(b.sa_ref_id).toLowerCase())
              .map(d => ({
                ma_hang: d.ma_hang || '', ten_hang: d.ten_hang || d.Description || '',
                kho: d.kho || '', dvt: d.dvt || '',
                so_luong: Number(d.Quantity) || 0, don_gia: Number(d.UnitPrice) || 0,
                thanh_tien: Number(d.Amount) || 0,
                vat_rate: d.VATRate == null ? null : Number(d.VATRate),
              }));
            return {
              so_ct: b.so_ct, ngay_ct: b.RefDate, ngay_hach_toan: b.PostedDate,
              khach_hang: b.khach_hang, dia_chi: b.dia_chi, dien_giai: b.dien_giai,
              lines: lns, tong_sl: lns.reduce((t, l) => t + l.so_luong, 0),
              tien_hang: Number(b.tien_hang) || 0, chiet_khau: Number(b.chiet_khau) || 0,
              thue_gtgt: Number(b.thue_gtgt) || 0, thanh_toan: Number(b.thanh_toan) || 0,
            };
          });
        }
      } catch (e) {
        console.error('⚠️ Không đọc được chứng từ bán hàng liên kết:', e.message);
        banHangLoi = e.message;
      }
    }

    return res.json({
      success: true,
      header: {
        loai: TEN_LOAI[h.RefType] || h.RefTypeName || ('Chứng từ ' + h.RefType),
        ref_type: h.RefType, huong: isNhap ? 'nhap' : 'xuat',
        so_ct: h.RefNo, ngay_ct: h.RefDate, ngay_hach_toan: h.PostedDate,
        ma_doi_tuong: h.ma_doi_tuong, ten_doi_tuong: h.ten_doi_tuong, dia_chi: h.dia_chi,
        nhan_vien: h.nhan_vien, dien_giai: h.dien_giai,
      },
      lines,
      tong_sl: lines.reduce((s, l) => s + l.so_luong, 0),
      tong_tien: lines.reduce((s, l) => s + l.thanh_tien, 0),
      ban_hang: banHang,
      ban_hang_loi: banHangLoi,
    });
  } catch (err) {
    console.error('❌ Đọc chứng từ MISA lỗi:', err.message);
    return res.status(500).json({ success: false, error: 'Không đọc được chứng từ: ' + err.message });
  }
});

// ─── Helper: cập nhật cache tồn kho tổng hợp ─────────────────────────────────
async function _updateTonkhoCache(data, tu_ngay, den_ngay) {
  const db  = await getDb();
  const now = new Date().toLocaleString('vi-VN');
  for (const row of data) {
    db.run(`
      INSERT INTO tonkho_cache
        (ma_hang, ten_hang, kho, dvt, don_gia, don_gia_goc, don_gia_vat_rate,
         dau_ky_sl, dau_ky_gt, nhap_sl, nhap_gt, xuat_sl, xuat_gt,
         cuoi_ky_sl, cuoi_ky_gt, tu_ngay, den_ngay, updated_at,
         ngay_mua_gan_nhat, ngay_ban_gan_nhat)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(ma_hang, kho, tu_ngay, den_ngay) DO UPDATE SET
        ngay_mua_gan_nhat=excluded.ngay_mua_gan_nhat,
        ngay_ban_gan_nhat=excluded.ngay_ban_gan_nhat,
        ten_hang=excluded.ten_hang, dvt=excluded.dvt, don_gia=excluded.don_gia,
        don_gia_goc=excluded.don_gia_goc, don_gia_vat_rate=excluded.don_gia_vat_rate,
        dau_ky_sl=excluded.dau_ky_sl, dau_ky_gt=excluded.dau_ky_gt,
        nhap_sl=excluded.nhap_sl,     nhap_gt=excluded.nhap_gt,
        xuat_sl=excluded.xuat_sl,     xuat_gt=excluded.xuat_gt,
        cuoi_ky_sl=excluded.cuoi_ky_sl, cuoi_ky_gt=excluded.cuoi_ky_gt,
        updated_at=excluded.updated_at
    `, [
      row.ma_hang, row.ten_hang || '', row.kho || '', row.dvt || '', row.don_gia || 0,
      row.don_gia_goc || 0, row.don_gia_vat_rate || 0,
      row.dau_ky_sl || 0, row.dau_ky_gt || 0,
      row.nhap_sl || 0,   row.nhap_gt || 0,
      row.xuat_sl || 0,   row.xuat_gt || 0,
      row.cuoi_ky_sl || 0, row.cuoi_ky_gt || 0,
      tu_ngay, den_ngay, now,
      row.ngay_mua_gan_nhat || null, row.ngay_ban_gan_nhat || null,
    ]);
  }
  db.run(`
    INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `, ['last_sync_tonkho', now, now]);
  saveDb(db);

  // Màn hình Tra mã đọc index RAM của chính snapshot này.
  // Rebuild sau khi ghi xong để lần click kế tiếp thấy dữ liệu mới ngay.
  await loadInventoryCacheIndex(true);
}

// ─── Helper: cập nhật cache tồn kho chi tiết ─────────────────────────────────
async function _updateTonkhoChiTietCache(ma_hang, kho, tu_ngay, den_ngay, dau_ky_sl, dau_ky_gt, dau_ky_don_gia, rows) {
  const db  = await getDb();
  const now = new Date().toLocaleString('vi-VN');

  // Chỉ xoá cache của ĐÚNG kho + đúng kỳ — tránh xoá nhầm cache của kho khác cùng mã hàng/kỳ
  db.run(`DELETE FROM tonkho_chitiet_cache WHERE ma_hang = ? AND kho = ? AND tu_ngay = ? AND den_ngay = ?`,
    [ma_hang, kho, tu_ngay, den_ngay]);

  if (rows.length === 0) {
    // Không có dòng phát sinh — vẫn lưu 1 dòng header để giữ đầu kỳ + đơn giá, gắn đúng kho
    db.run(`
      INSERT INTO tonkho_chitiet_cache
        (ma_hang, kho, tu_ngay, den_ngay, ten_hang, dau_ky_sl, dau_ky_gt, dau_ky_don_gia, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [ma_hang, kho, tu_ngay, den_ngay, '', dau_ky_sl, dau_ky_gt, dau_ky_don_gia, now]);
  } else {
    for (const r of rows) {
      db.run(`
        INSERT INTO tonkho_chitiet_cache
          (ma_hang, kho, tu_ngay, den_ngay, ten_hang, dau_ky_sl, dau_ky_gt, dau_ky_don_gia,
           ngay_hach_toan, ngay_ct, so_ct, dien_giai, dvt, don_gia,
           nhap_sl, nhap_gt, xuat_sl, xuat_gt, ton_sl, ton_gt, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        ma_hang, kho, tu_ngay, den_ngay, r.ten_hang || '', dau_ky_sl, dau_ky_gt, dau_ky_don_gia,
        r.ngay_hach_toan ? new Date(r.ngay_hach_toan).toISOString().slice(0, 10) : null,
        r.ngay_ct        ? new Date(r.ngay_ct).toISOString().slice(0, 10)        : null,
        r.so_ct || '', r.dien_giai || '', r.dvt || '',
        r.don_gia || 0,
        r.nhap_sl || 0, r.nhap_gt || 0,
        r.xuat_sl || 0, r.xuat_gt || 0,
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
