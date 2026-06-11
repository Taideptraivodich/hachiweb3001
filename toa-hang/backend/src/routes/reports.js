const express = require('express');
const router  = express.Router();
const { getDb, dbQuery, dbGet } = require('../sqlite');

router.get('/summary', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to } = req.query;
    let where = `trang_thai!='Đã hủy'`; const p = {};
    if (from) { where += ` AND ngay_tao>=$from`; p.$from=from; }
    if (to)   { where += ` AND ngay_tao<=$to`;   p.$to=to; }
    const row = dbGet(db, `SELECT COUNT(*) AS tong_toa, COUNT(DISTINCT ma_kh) AS tong_khach FROM orders o WHERE ${where}`, p);
    db.close(); res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/top-products', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to, limit=20 } = req.query;
    let where = `o.trang_thai!='Đã hủy'`; const p = {};
    if (from) { where += ` AND o.ngay_tao>=$from`; p.$from=from; }
    if (to)   { where += ` AND o.ngay_tao<=$to`;   p.$to=to; }
    p.$limit = parseInt(limit);
    const rows = dbQuery(db, `SELECT d.ma_hang,d.ten_hang,SUM(d.so_luong) AS tong_so_luong,SUM(d.so_luong*d.don_gia_ban) AS tong_doanh_thu,COUNT(DISTINCT d.order_id) AS so_toa FROM order_details d JOIN orders o ON o.id=d.order_id WHERE ${where} GROUP BY d.ma_hang,d.ten_hang ORDER BY tong_so_luong DESC LIMIT $limit`, p);
    db.close(); res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/daily', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to } = req.query;
    let where = `trang_thai!='Đã hủy'`; const p = {};
    if (from) { where += ` AND ngay_tao>=$from`; p.$from=from; }
    if (to)   { where += ` AND ngay_tao<=$to`;   p.$to=to; }
    const rows = dbQuery(db, `SELECT ngay_tao, COUNT(*) AS so_toa FROM orders o WHERE ${where} GROUP BY ngay_tao ORDER BY ngay_tao DESC`, p);
    db.close(); res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/product/:ma_hang', async (req, res) => {
  try {
    const db   = await getDb();
    const rows = dbQuery(db, `SELECT o.ma_toa,o.ngay_tao,o.ten_kh,d.so_luong,d.don_gia_ban,d.so_luong*d.don_gia_ban AS thanh_tien FROM order_details d JOIN orders o ON o.id=d.order_id WHERE d.ma_hang=$m AND o.trang_thai!='Đã hủy' ORDER BY o.ngay_tao DESC`, { $m: req.params.ma_hang });
    db.close(); res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/customer/:ma_kh', async (req, res) => {
  try {
    const db   = await getDb();
    const rows = dbQuery(db, `SELECT o.ma_toa,o.ngay_tao,o.trang_thai,o.ghi_chu,COALESCE(SUM(d.so_luong*d.don_gia_ban),0) AS tong_tien FROM orders o LEFT JOIN order_details d ON d.order_id=o.id WHERE o.ma_kh=$m GROUP BY o.id ORDER BY o.ngay_tao DESC`, { $m: req.params.ma_kh });
    db.close(); res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
