const express = require('express');
const router  = express.Router();
const { getMisaPool, sql } = require('../db');

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
  try {
    const { fromDate, toDate } = parseDates(req.query);
    const { q, kho } = req.query;

    const misa = await getMisaPool();
    const request = misa.request();
    request.input('tu_ngay',  sql.Date, new Date(fromDate));
    request.input('den_ngay', sql.Date, new Date(toDate));

    const result = await request.query(`
      SELECT
        il.InventoryItemCode                                              AS ma_hang,
        MAX(il.InventoryItemName)                                         AS ten_hang,
        MAX(il.StockName)                                                 AS kho,
        MAX(il.Unit)                                                      AS dvt,
        -- Đầu kỳ (trước tu_ngay)
        ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
          THEN il.InwardQuantity  ELSE 0 END), 0)
        - ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
          THEN il.OutwardQuantity ELSE 0 END), 0)                        AS dau_ky_sl,
        ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
          THEN il.InwardAmount    ELSE 0 END), 0)
        - ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
          THEN il.OutwardAmount   ELSE 0 END), 0)                        AS dau_ky_gt,
        -- Nhập trong kỳ
        ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN il.InwardQuantity  ELSE 0 END), 0)                        AS nhap_sl,
        ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN il.InwardAmount    ELSE 0 END), 0)                        AS nhap_gt,
        -- Xuất trong kỳ
        ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN il.OutwardQuantity ELSE 0 END), 0)                        AS xuat_sl,
        ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN il.OutwardAmount   ELSE 0 END), 0)                        AS xuat_gt
      FROM InventoryLedger il
      WHERE il.InventoryItemCode IS NOT NULL
        AND il.InventoryItemCode <> ''
      GROUP BY il.InventoryItemCode
      HAVING
        -- Có tồn đầu kỳ HOẶC có phát sinh trong kỳ
        (
          ISNULL(SUM(CASE WHEN il.PostedDate < @tu_ngay
            THEN il.InwardQuantity - il.OutwardQuantity ELSE 0 END), 0) <> 0
          OR ISNULL(SUM(CASE WHEN il.PostedDate BETWEEN @tu_ngay AND @den_ngay
            THEN il.InwardQuantity + il.OutwardQuantity ELSE 0 END), 0) > 0
        )
      ORDER BY MAX(il.InventoryItemName)
    `);

    // Tính cuối kỳ + filter phía app (nhanh hơn WHERE trong SQL cho search)
    let data = result.recordset.map(r => ({
      ...r,
      cuoi_ky_sl: Number(r.dau_ky_sl) + Number(r.nhap_sl) - Number(r.xuat_sl),
      cuoi_ky_gt: Number(r.dau_ky_gt) + Number(r.nhap_gt) - Number(r.xuat_gt),
    }));

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

    // Danh sách kho để filter dropdown
    const danhSachKho = [...new Set(result.recordset.map(r => r.kho).filter(Boolean))].sort();

    res.json({ success: true, data, danhSachKho, total: data.length });
  } catch (err) {
    console.error('❌ Tồn kho tổng hợp lỗi:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /tonkho/chi-tiet ─────────────────────────────────────────────────────
// Sổ chi tiết vật tư hàng hóa cho 1 mặt hàng (giống màn hình MISA "Sổ chi tiết VTHH")
// Trả về: từng dòng nhập/xuất theo ngày, số dư lũy kế
router.get('/chi-tiet', async (req, res) => {
  try {
    const { ma_hang } = req.query;
    if (!ma_hang) return res.status(400).json({ success: false, error: 'Thiếu ma_hang' });

    const { fromDate, toDate } = parseDates(req.query);

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
        il.Description                AS dien_giai,
        il.Unit                       AS dvt,
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
        il.PostedDate, il.RefDate, il.RefNo, il.Description,
        il.Unit, il.UnitPrice, il.InwardQuantity, il.InwardAmount,
        il.OutwardQuantity, il.OutwardAmount, il.StockName
      ORDER BY il.PostedDate ASC, il.RefNo ASC
    `);

    const dk = dauKyRes.recordset[0];
    const dauKySL = Number(dk.nhap_sl) - Number(dk.xuat_sl);
    const dauKyGT = Number(dk.nhap_gt) - Number(dk.xuat_gt);

    // Tính số dư lũy kế
    let tonSL = dauKySL;
    let tonGT = dauKyGT;
    const rows = chiTietRes.recordset.map(r => {
      tonSL += Number(r.nhap_sl || 0) - Number(r.xuat_sl || 0);
      tonGT += Number(r.nhap_gt || 0) - Number(r.xuat_gt || 0);
      return { ...r, ton_sl: tonSL, ton_gt: tonGT };
    });

    res.json({
      success: true,
      ma_hang,
      ten_hang: rows[0]?.ten_hang || ma_hang,
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
