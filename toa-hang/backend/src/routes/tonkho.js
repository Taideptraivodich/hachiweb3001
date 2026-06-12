const express = require('express');
const router  = express.Router();
const { getMisaPool, sql } = require('../db');

function parseDates(query) {
  const today    = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  return {
    fromDate: query.tu_ngay  || firstDay,
    toDate:   query.den_ngay || today,
  };
}

// ─── GET /tonkho/tong-hop ─────────────────────────────────────────────────────
router.get('/tong-hop', async (req, res) => {
  try {
    const { fromDate, toDate } = parseDates(req.query);
    const { q, kho } = req.query;

    const misa    = await getMisaPool();
    const request = misa.request();
    request.input('tu_ngay',  sql.Date, new Date(fromDate));
    request.input('den_ngay', sql.Date, new Date(toDate));

    // 2 CTE tách biệt theo range ngày → SQL Server có thể seek index trên PostedDate
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
        a.InventoryItemCode                    AS ma_hang,
        ISNULL(tk.ten_hang,
          (SELECT TOP 1 InventoryItemName FROM InventoryLedger
           WHERE InventoryItemCode = a.InventoryItemCode)) AS ten_hang,
        tk.kho, tk.dvt,
        ISNULL(dk.sl, 0)                       AS dau_ky_sl,
        ISNULL(dk.gt, 0)                       AS dau_ky_gt,
        ISNULL(tk.nhap_sl, 0)                  AS nhap_sl,
        ISNULL(tk.nhap_gt, 0)                  AS nhap_gt,
        ISNULL(tk.xuat_sl, 0)                  AS xuat_sl,
        ISNULL(tk.xuat_gt, 0)                  AS xuat_gt
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
    if (kho) {
      data = data.filter(r => (r.kho || '') === kho);
    }

    res.json({ success: true, data, danhSachKho, total: data.length });
  } catch (err) {
    console.error('❌ Tồn kho tổng hợp lỗi:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /tonkho/chi-tiet ─────────────────────────────────────────────────────
router.get('/chi-tiet', async (req, res) => {
  try {
    const { ma_hang } = req.query;
    if (!ma_hang) return res.status(400).json({ success: false, error: 'Thiếu ma_hang' });

    const { fromDate, toDate } = parseDates(req.query);

    const misa = await getMisaPool();

    // Đầu kỳ
    const req1 = misa.request();
    req1.input('ma_hang',  sql.NVarChar, ma_hang);
    req1.input('tu_ngay',  sql.Date, new Date(fromDate));
    const dauKyRes = await req1.query(`
      SELECT
        ISNULL(SUM(InwardQuantity),  0) AS nhap_sl,
        ISNULL(SUM(OutwardQuantity), 0) AS xuat_sl,
        ISNULL(SUM(InwardAmount),    0) AS nhap_gt,
        ISNULL(SUM(OutwardAmount),   0) AS xuat_gt,
        MAX(InventoryItemName)          AS ten_hang
      FROM InventoryLedger
      WHERE InventoryItemCode = @ma_hang
        AND PostedDate < @tu_ngay
    `);

    // Chi tiết trong kỳ — KHÔNG dùng MAX+GROUP BY, lấy thẳng từng dòng
    const req2 = misa.request();
    req2.input('ma_hang',  sql.NVarChar, ma_hang);
    req2.input('tu_ngay',  sql.Date, new Date(fromDate));
    req2.input('den_ngay', sql.Date, new Date(toDate));
    const chiTietRes = await req2.query(`
      SELECT
        il.PostedDate           AS ngay_hach_toan,
        il.RefDate              AS ngay_ct,
        il.RefNo                AS so_ct,
        il.JournalMemo          AS dien_giai,
        u.UnitName              AS dvt,
        il.UnitPrice            AS don_gia,
        il.InwardQuantity       AS nhap_sl,
        il.InwardAmount         AS nhap_gt,
        il.OutwardQuantity      AS xuat_sl,
        il.OutwardAmount        AS xuat_gt,
        il.StockName            AS kho,
        il.InventoryItemName    AS ten_hang
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

    let tonSL = dauKySL;
    let tonGT = dauKyGT;
    const rows = chiTietRes.recordset.map(r => {
      tonSL += Number(r.nhap_sl || 0) - Number(r.xuat_sl || 0);
      tonGT += Number(r.nhap_gt || 0) - Number(r.xuat_gt || 0);
      return { ...r, ton_sl: tonSL, ton_gt: tonGT };
    });

    const tenHang = dk?.ten_hang || rows[0]?.ten_hang || ma_hang;

    res.json({
      success: true,
      ma_hang,
      ten_hang: tenHang,
      dau_ky_sl: dauKySL,
      dau_ky_gt: dauKyGT,
      data: rows,
    });
  } catch (err) {
    console.error('❌ Tồn kho chi tiết lỗi:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
