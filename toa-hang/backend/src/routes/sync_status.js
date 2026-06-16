const express = require('express');
const router  = express.Router();
const { getMisaPool } = require('../db');
const { getDb, dbGet } = require('../sqlite');
const { syncProducts, syncCustomers, syncTonkho, syncCongno } = require('../sync');

// ─── GET /api/sync/status ─────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  // Kiểm tra MISA
  let misaOnline = false;
  try {
    const misa = await getMisaPool();
    await misa.request().query('SELECT 1 AS ping');
    misaOnline = true;
  } catch {}

  // Lấy thời gian sync cuối
  let lastSync = {};
  try {
    const db = await getDb();
    const keys = ['last_sync_products', 'last_sync_customers', 'last_sync_tonkho', 'last_sync_congno'];
    for (const key of keys) {
      const row = dbGet(db, `SELECT value FROM sync_meta WHERE key = ?`, [key]);
      lastSync[key] = row ? row.value : null;
    }
    db.close();
  } catch {}

  res.json({
    success: true,
    misa_online: misaOnline,
    last_sync: lastSync,
  });
});

// ─── POST /api/sync/manual ────────────────────────────────────────────────────
router.post('/manual', async (req, res) => {
  try {
    const results = await Promise.allSettled([
      syncProducts(),
      syncCustomers(),
      syncTonkho(),
      syncCongno(),
    ]);

    const [products, customers, tonkho, congno] = results.map(r =>
      r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message }
    );

    res.json({ success: true, products, customers, tonkho, congno });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
