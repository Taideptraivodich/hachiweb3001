const express = require('express');
const router  = express.Router();
const { getDb, dbQuery, dbGet } = require('../sqlite');

// Helper: build WHERE cho orders, loại 'Đã hủy'
function buildWhere(from, to, alias = 'o') {
  let where = `${alias}.trang_thai != 'Đã hủy'`;
  const p = {};
  if (from) { where += ` AND ${alias}.ngay_tao >= $from`; p.$from = from; }
  if (to)   { where += ` AND ${alias}.ngay_tao <= $to`;   p.$to   = to;   }
  return { where, p };
}

// GET /reports/summary — KPI tổng hợp
router.get('/summary', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to } = req.query;
    const { where, p } = buildWhere(from, to);
    const row = dbGet(db, `
      SELECT
        COUNT(DISTINCT o.id)                                    AS tong_toa,
        COUNT(DISTINCT NULLIF(o.ma_kh,''))                      AS tong_khach,
        COALESCE(SUM(d.so_luong * d.don_gia_ban), 0)           AS doanh_thu,
        COALESCE(SUM(d.so_luong * d.gia_von),     0)           AS gia_von,
        COALESCE(SUM(d.so_luong),                 0)           AS tong_so_luong
      FROM orders o
      LEFT JOIN order_details d ON d.order_id = o.id
      WHERE ${where}
    `, p);
    db.close();
    res.json({
      tong_toa:       row.tong_toa      || 0,
      tong_khach:     row.tong_khach    || 0,
      doanh_thu:      row.doanh_thu     || 0,
      gia_von:        row.gia_von       || 0,
      loi_nhuan:      (row.doanh_thu    || 0) - (row.gia_von || 0),
      ty_suat_ln:     row.doanh_thu > 0
        ? ((row.doanh_thu - row.gia_von) / row.doanh_thu * 100)
        : 0,
      tong_so_luong:  row.tong_so_luong || 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /reports/top-products — top mặt hàng
router.get('/top-products', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to, limit = 50 } = req.query;
    const { where, p } = buildWhere(from, to);
    p.$limit = parseInt(limit);
    const rows = dbQuery(db, `
      SELECT
        d.ma_hang,
        COALESCE(NULLIF(d.ten_hang_hien_thi,''), d.ten_hang)   AS ten_hang,
        SUM(d.so_luong)                                         AS tong_so_luong,
        SUM(d.so_luong * d.don_gia_ban)                        AS doanh_thu,
        SUM(d.so_luong * d.gia_von)                            AS gia_von,
        SUM(d.so_luong * d.don_gia_ban)
          - SUM(d.so_luong * d.gia_von)                        AS loi_nhuan,
        COUNT(DISTINCT o.id)                                    AS so_phieu
      FROM orders o
      JOIN order_details d ON d.order_id = o.id
      WHERE ${where}
      GROUP BY d.ma_hang, COALESCE(NULLIF(d.ten_hang_hien_thi,''), d.ten_hang)
      ORDER BY doanh_thu DESC
      LIMIT $limit
    `, p);
    db.close();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /reports/top-customers — top khách hàng
router.get('/top-customers', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to, limit = 50 } = req.query;
    const { where, p } = buildWhere(from, to);
    p.$limit = parseInt(limit);
    const rows = dbQuery(db, `
      SELECT
        o.ma_kh,
        o.ten_kh,
        COUNT(DISTINCT o.id)                                    AS so_phieu,
        SUM(d.so_luong)                                         AS tong_so_luong,
        SUM(d.so_luong * d.don_gia_ban)                        AS doanh_thu,
        SUM(d.so_luong * d.gia_von)                            AS gia_von,
        SUM(d.so_luong * d.don_gia_ban)
          - SUM(d.so_luong * d.gia_von)                        AS loi_nhuan,
        MAX(o.ngay_tao)                                         AS lan_mua_gan_nhat
      FROM orders o
      LEFT JOIN order_details d ON d.order_id = o.id
      WHERE ${where}
      GROUP BY o.ma_kh, o.ten_kh
      ORDER BY doanh_thu DESC
      LIMIT $limit
    `, p);
    db.close();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /reports/daily — theo ngày
router.get('/daily', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to } = req.query;
    const { where, p } = buildWhere(from, to);
    const rows = dbQuery(db, `
      SELECT
        o.ngay_tao                                              AS ngay,
        COUNT(DISTINCT o.id)                                    AS so_phieu,
        COUNT(DISTINCT NULLIF(o.ma_kh,''))                      AS so_khach,
        COALESCE(SUM(d.so_luong), 0)                           AS tong_so_luong,
        COALESCE(SUM(d.so_luong * d.don_gia_ban), 0)           AS doanh_thu,
        COALESCE(SUM(d.so_luong * d.gia_von),     0)           AS gia_von,
        COALESCE(SUM(d.so_luong * d.don_gia_ban)
          - SUM(d.so_luong * d.gia_von),          0)           AS loi_nhuan
      FROM orders o
      LEFT JOIN order_details d ON d.order_id = o.id
      WHERE ${where}
      GROUP BY o.ngay_tao
      ORDER BY o.ngay_tao ASC
    `, p);
    db.close();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /reports/order-details — chi tiết phiếu
router.get('/order-details', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to } = req.query;
    const { where, p } = buildWhere(from, to);
    const rows = dbQuery(db, `
      SELECT
        o.ngay_tao,
        o.ma_don,
        o.ma_toa,
        o.ten_kh,
        o.trang_thai,
        COUNT(d.id)                                             AS so_dong,
        COALESCE(SUM(d.so_luong), 0)                           AS tong_so_luong,
        COALESCE(SUM(d.so_luong * d.don_gia_ban), 0)           AS doanh_thu,
        COALESCE(SUM(d.so_luong * d.gia_von),     0)           AS gia_von,
        COALESCE(SUM(d.so_luong * d.don_gia_ban)
          - SUM(d.so_luong * d.gia_von),          0)           AS loi_nhuan
      FROM orders o
      LEFT JOIN order_details d ON d.order_id = o.id
      WHERE ${where}
      GROUP BY o.id
      ORDER BY o.ngay_tao DESC, o.created_at DESC
    `, p);
    db.close();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Giữ lại các route cũ
router.get('/product/:ma_hang', async (req, res) => {
  try {
    const db   = await getDb();
    const rows = dbQuery(db,
      `SELECT o.ma_toa,o.ngay_tao,o.ten_kh,d.so_luong,d.don_gia_ban,
              d.so_luong*d.don_gia_ban AS thanh_tien
       FROM order_details d
       JOIN orders o ON o.id=d.order_id
       WHERE d.ma_hang=$m AND o.trang_thai!='Đã hủy'
       ORDER BY o.ngay_tao DESC`,
      { $m: req.params.ma_hang });
    db.close(); res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/customer/:ma_kh', async (req, res) => {
  try {
    const db   = await getDb();
    const rows = dbQuery(db,
      `SELECT o.ma_toa,o.ngay_tao,o.trang_thai,o.ghi_chu,
              COALESCE(SUM(d.so_luong*d.don_gia_ban),0) AS tong_tien
       FROM orders o
       LEFT JOIN order_details d ON d.order_id=o.id
       WHERE o.ma_kh=$m
       GROUP BY o.id
       ORDER BY o.ngay_tao DESC`,
      { $m: req.params.ma_kh });
    db.close(); res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
