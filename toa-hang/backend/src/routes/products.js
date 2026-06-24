const express = require('express');
const router  = express.Router();
const { getDb, dbQuery, dbGet } = require('../sqlite');
const { syncProducts, syncCustomers } = require('../sync');

router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const q  = `%${req.query.q || ''}%`;
    const rows = dbQuery(db, `SELECT ma_hang, ten_hang, kho, dvt, ton_kho, gia_von FROM product_cache WHERE (ma_hang LIKE $q OR ten_hang LIKE $q) ORDER BY ten_hang LIMIT 30`, { $q: q });
    db.close();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all', async (req, res) => {
  try {
    const db   = await getDb();
    const rows = dbQuery(db, `SELECT ma_hang, ten_hang, kho, dvt, ton_kho, gia_von FROM product_cache ORDER BY ten_hang`);
    db.close();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync', async (req, res) => { res.json(await syncProducts()); });

router.get('/customers', async (req, res) => {
  try {
    const db = await getDb();
    const q  = `%${req.query.q || ''}%`;
    const rows = dbQuery(db, `SELECT ma_kh, ten_kh, dien_thoai, dia_chi FROM customer_cache WHERE ten_kh LIKE $q OR ma_kh LIKE $q ORDER BY ten_kh LIMIT 20`, { $q: q });
    db.close();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/customers/sync', async (req, res) => { res.json(await syncCustomers()); });

module.exports = router;
