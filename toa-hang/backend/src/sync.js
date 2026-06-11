const cron            = require('node-cron');
const { getMisaPool } = require('./db');
const { getDb, saveDb } = require('./sqlite');

async function syncProducts() {
  console.log('🔄 Sync hàng hóa từ MISA...');
  try {
    const misa   = await getMisaPool();
    const result = await misa.request().query(`
      SELECT
        InventoryItemCode                         AS ma_hang,
        InventoryItemName                         AS ten_hang,
        StockName                                 AS kho,
        SUM(InwardQuantity - OutwardQuantity)     AS ton_kho,
        MAX(MainUnitPrice)                        AS gia_von
      FROM InventoryLedger
      GROUP BY InventoryItemCode, InventoryItemName, StockName
      HAVING SUM(InwardQuantity - OutwardQuantity) > 0
      ORDER BY InventoryItemCode
    `);

    const db  = await getDb();
    const now = new Date().toLocaleString('vi-VN');
    let count = 0;

    for (const row of result.recordset) {
      if (!row.ma_hang) continue;
      db.run(`
        INSERT INTO product_cache (ma_hang, ten_hang, kho, ton_kho, gia_von, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(ma_hang) DO UPDATE SET
          ten_hang=excluded.ten_hang, kho=excluded.kho,
          ton_kho=excluded.ton_kho, gia_von=excluded.gia_von,
          updated_at=excluded.updated_at
      `, [row.ma_hang, row.ten_hang||'', row.kho||'', row.ton_kho||0, row.gia_von||0, now]);
      count++;
    }

    saveDb(db); // ghi file một lần duy nhất sau khi xong
    console.log(`✅ Sync hàng hóa: ${count} mặt hàng`);
    return { success: true, count };
  } catch (err) {
    console.error('❌ Sync hàng hóa lỗi:', err.message);
    return { success: false, error: err.message };
  }
}

async function syncCustomers() {
  console.log('🔄 Sync khách hàng từ MISA...');
  try {
    const misa   = await getMisaPool();
    const result = await misa.request().query(`
      SELECT TOP 2000
        AccountObjectCode AS ma_kh,
        AccountObjectName AS ten_kh,
        Tel               AS dien_thoai,
        Address           AS dia_chi
      FROM AccountObject
      WHERE (AccountObjectCode LIKE 'KH%' OR AccountObjectType = 0) AND Inactive = 0
      ORDER BY AccountObjectName
    `);

    const db  = await getDb();
    const now = new Date().toLocaleString('vi-VN');
    let count = 0;

    for (const row of result.recordset) {
      if (!row.ma_kh) continue;
      db.run(`
        INSERT INTO customer_cache (ma_kh, ten_kh, dien_thoai, dia_chi, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(ma_kh) DO UPDATE SET
          ten_kh=excluded.ten_kh, dien_thoai=excluded.dien_thoai,
          dia_chi=excluded.dia_chi, updated_at=excluded.updated_at
      `, [row.ma_kh, row.ten_kh||'', row.dien_thoai||'', row.dia_chi||'', now]);
      count++;
    }

    saveDb(db);
    console.log(`✅ Sync khách hàng: ${count} khách`);
    return { success: true, count };
  } catch (err) {
    console.error('❌ Sync khách hàng lỗi:', err.message);
    return { success: false, error: err.message };
  }
}

function startSyncScheduler() {
  const minutes  = parseInt(process.env.SYNC_INTERVAL_MINUTES) || 15;
  console.log(`⏰ Auto-sync MISA mỗi ${minutes} phút`);
  cron.schedule(`*/${minutes} * * * *`, async () => {
    await syncProducts();
    await syncCustomers();
  });
}

module.exports = { syncProducts, syncCustomers, startSyncScheduler };
