const express = require('express');
const router  = express.Router();
const { getMisaPool, sql } = require('../db');

// ─── Tổng hợp công nợ theo kỳ ────────────────────────────────────────────────
// Trả về: số dư đầu kỳ + phát sinh trong kỳ + số dư cuối kỳ
router.get('/tong-hop', async (req, res) => {
  try {
    const { tu_ngay, den_ngay } = req.query;
    const misa = await getMisaPool();
    const request = misa.request();

    // Mặc định: đầu tháng → hôm nay
    const fromDate = tu_ngay  || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
    const toDate   = den_ngay || new Date().toISOString().slice(0,10);

    request.input('tu_ngay',  sql.Date, new Date(fromDate));
    request.input('den_ngay', sql.Date, new Date(toDate));

    // Số dư đầu kỳ = tất cả phát sinh TRƯỚC tu_ngay, nhóm theo KH
    // Số phát sinh trong kỳ = phát sinh từ tu_ngay đến den_ngay
    // Số dư cuối kỳ = đầu kỳ + phát sinh trong kỳ
    const query = `
      SELECT
        aol.AccountObjectCode                                            AS ma_kh,
        MAX(aol.AccountObjectName)                                       AS ten_kh,
        -- Số dư đầu kỳ
        ISNULL(SUM(CASE WHEN aol.PostedDate < @tu_ngay
          THEN aol.DebitAmountOC  ELSE 0 END), 0)                       AS dau_ky_no,
        ISNULL(SUM(CASE WHEN aol.PostedDate < @tu_ngay
          THEN aol.CreditAmountOC ELSE 0 END), 0)                       AS dau_ky_co,
        -- Phát sinh trong kỳ
        ISNULL(SUM(CASE WHEN aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN aol.DebitAmountOC  ELSE 0 END), 0)                       AS ps_no,
        ISNULL(SUM(CASE WHEN aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN aol.CreditAmountOC ELSE 0 END), 0)                       AS ps_co,
        -- Số phiếu trong kỳ
        COUNT(DISTINCT CASE WHEN aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN aol.RefNo END)                                            AS so_phieu
      FROM AccountObjectLedger aol
      WHERE aol.AccountNumber LIKE '131%'
        AND aol.AccountObjectCode IS NOT NULL
        AND aol.AccountObjectCode <> ''
      GROUP BY aol.AccountObjectCode
      HAVING
        -- Có dư đầu kỳ HOẶC có phát sinh trong kỳ
        SUM(CASE WHEN aol.PostedDate < @tu_ngay
              THEN aol.DebitAmountOC - aol.CreditAmountOC ELSE 0 END) <> 0
        OR SUM(CASE WHEN aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
              THEN aol.DebitAmountOC + aol.CreditAmountOC ELSE 0 END) > 0
      ORDER BY MAX(aol.AccountObjectName)
    `;

    const result = await request.query(query);
    // Tính cuối kỳ client-side để tránh tính lại
    const data = result.recordset.map(r => ({
      ...r,
      cuoi_ky_no: Math.max(0,  (r.dau_ky_no - r.dau_ky_co) + (r.ps_no - r.ps_co)),
      cuoi_ky_co: Math.max(0, -((r.dau_ky_no - r.dau_ky_co) + (r.ps_no - r.ps_co))),
      du_no_net:  (r.dau_ky_no - r.dau_ky_co) + (r.ps_no - r.ps_co),
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Công nợ tổng hợp lỗi:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Chi tiết công nợ 1 khách hàng theo kỳ ───────────────────────────────────
router.get('/chi-tiet', async (req, res) => {
  try {
    const { ma_kh, tu_ngay, den_ngay } = req.query;
    if (!ma_kh) return res.status(400).json({ success: false, error: 'Thiếu ma_kh' });

    const misa = await getMisaPool();
    const request = misa.request();

    const fromDate = tu_ngay  || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
    const toDate   = den_ngay || new Date().toISOString().slice(0,10);

    request.input('ma_kh',    sql.NVarChar, ma_kh);
    request.input('tu_ngay',  sql.Date, new Date(fromDate));
    request.input('den_ngay', sql.Date, new Date(toDate));

    // Số dư đầu kỳ (trước tu_ngay)
    const duDauKy = await request.query(`
      SELECT
        ISNULL(SUM(DebitAmountOC), 0)  AS no,
        ISNULL(SUM(CreditAmountOC), 0) AS co
      FROM AccountObjectLedger
      WHERE AccountNumber LIKE '131%'
        AND AccountObjectCode = @ma_kh
        AND PostedDate < @tu_ngay
    `);

    const request2 = misa.request();
    request2.input('ma_kh',    sql.NVarChar, ma_kh);
    request2.input('tu_ngay',  sql.Date, new Date(fromDate));
    request2.input('den_ngay', sql.Date, new Date(toDate));

    // Các dòng phát sinh trong kỳ
    const chiTiet = await request2.query(`
      SELECT
        aol.PostedDate                   AS ngay_ct,
        aol.RefDate                      AS ngay_hd,
        aol.RefNo                        AS so_ct,
        aol.Description                  AS dien_giai,
        aol.DebitAmountOC                AS ps_no,
        aol.CreditAmountOC               AS ps_co,
        aol.CorrespondingAccountNumber   AS tk_du
      FROM AccountObjectLedger aol
      WHERE aol.AccountNumber LIKE '131%'
        AND aol.AccountObjectCode = @ma_kh
        AND aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
        AND (aol.DebitAmountOC <> 0 OR aol.CreditAmountOC <> 0)
        AND aol.CorrespondingAccountNumber NOT LIKE '5211%'
        AND aol.CorrespondingAccountNumber NOT LIKE '5212%'
      ORDER BY aol.PostedDate ASC, aol.RefNo ASC, aol.SortOrder ASC, aol.DetailPostOrder ASC
    `);

    const dauKy = {
      no: Number(duDauKy.recordset[0]?.no || 0),
      co: Number(duDauKy.recordset[0]?.co || 0),
    };
    const duDauKyNet = dauKy.no - dauKy.co;

    // Gắn số dư lũy kế cho từng dòng
    let soDu = duDauKyNet;
    const rows = chiTiet.recordset.map(r => {
      soDu += Number(r.ps_no || 0) - Number(r.ps_co || 0);
      return { ...r, so_du: soDu };
    });

    res.json({
      success: true,
      dau_ky_net: duDauKyNet,
      dau_ky_no:  dauKy.no,
      dau_ky_co:  dauKy.co,
      data: rows,
    });
  } catch (err) {
    console.error('❌ Công nợ chi tiết lỗi:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
