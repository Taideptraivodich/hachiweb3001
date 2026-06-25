const express = require('express');
const router  = express.Router();
const { getDb, dbQuery, dbGet } = require('../sqlite');
const { syncProducts, syncCustomers } = require('../sync');

router.get('/', async (req, res) => {
  try {
    const db  = await getDb();
    const raw = (req.query.q || '').trim();
    if (!raw) { db.close(); return res.json([]); }
    const q     = `%${raw}%`;
    const qLow  = `%${raw.toLowerCase()}%`;
    // LIKE gốc: match byte-exact tiếng Việt có dấu (nước mắt → Nước Mắt)
    // LOWER(): match ASCII case-insensitive (4lg → 4LG, sp → SP...)
    // UNION dedupe, giữ LIMIT hợp lý
    const rows = dbQuery(db,
      `SELECT ma_hang, ten_hang, kho, dvt, ton_kho, gia_von
       FROM product_cache
       WHERE (ma_hang LIKE $q OR ten_hang LIKE $q)
          OR (LOWER(ma_hang) LIKE $qLow OR LOWER(ten_hang) LIKE $qLow)
       ORDER BY ten_hang LIMIT 50`,
      { $q: q, $qLow: qLow }
    );
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
    const db  = await getDb();
    const raw = (req.query.q || '').trim();
    if (!raw) { db.close(); return res.json([]); }
    const q    = `%${raw}%`;
    const qLow = `%${raw.toLowerCase()}%`;
    const rows = dbQuery(db,
      `SELECT ma_kh, ten_kh, dien_thoai, dia_chi
       FROM customer_cache
       WHERE (ten_kh LIKE $q OR ma_kh LIKE $q)
          OR (LOWER(ten_kh) LIKE $qLow OR LOWER(ma_kh) LIKE $qLow)
       ORDER BY ten_kh LIMIT 20`,
      { $q: q, $qLow: qLow }
    );
    db.close();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/customers/sync', async (req, res) => { res.json(await syncCustomers()); });

module.exports = router;
