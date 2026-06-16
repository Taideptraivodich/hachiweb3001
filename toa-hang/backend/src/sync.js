const cron            = require('node-cron');
const { getMisaPool, sql } = require('./db');
const { getDb, saveDb } = require('./sqlite');

// ─── Helper: kiểm tra MISA có online không ───────────────────────────────────
async function isMisaOnline() {
  try {
    const misa = await getMisaPool();
    await misa.request().query('SELECT 1 AS ping');
    return true;
  } catch {
    return false;
  }
}

// ─── Helper: lưu meta thời điểm sync ─────────────────────────────────────────
function saveSyncMeta(db, key) {
  const now = new Date().toLocaleString('vi-VN');
  db.run(`
    INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `, [key, now, now]);
}

// ─── Sync hàng hóa (product_cache) ───────────────────────────────────────────
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

    saveSyncMeta(db, 'last_sync_products');
    saveDb(db);
    console.log(`✅ Sync hàng hóa: ${count} mặt hàng`);
    return { success: true, count };
  } catch (err) {
    console.error('❌ Sync hàng hóa lỗi:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Sync khách hàng (customer_cache) ────────────────────────────────────────
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

    saveSyncMeta(db, 'last_sync_customers');
    saveDb(db);
    console.log(`✅ Sync khách hàng: ${count} khách`);
    return { success: true, count };
  } catch (err) {
    console.error('❌ Sync khách hàng lỗi:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Sync tồn kho tổng hợp (tonkho_cache) ────────────────────────────────────
// Cache theo kỳ: đầu tháng → hôm nay
async function syncTonkho() {
  console.log('🔄 Sync tồn kho từ MISA...');
  try {
    const misa = await getMisaPool();
    const today    = new Date().toISOString().slice(0, 10);
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

    const request = misa.request();
    request.input('tu_ngay',  sql.Date, new Date(firstDay));
    request.input('den_ngay', sql.Date, new Date(today));

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
        a.InventoryItemCode AS ma_hang,
        (SELECT TOP 1 UnitPrice FROM InventoryLedger
         WHERE InventoryItemCode = a.InventoryItemCode
           AND InwardQuantity > 0 AND UnitPrice > 0
         ORDER BY PostedDate DESC, SortOrder DESC) AS don_gia,
        ISNULL(tk.ten_hang,
          (SELECT TOP 1 InventoryItemName FROM InventoryLedger
           WHERE InventoryItemCode = a.InventoryItemCode)) AS ten_hang,
        tk.kho, tk.dvt,
        ISNULL(dk.sl, 0) AS dau_ky_sl,
        ISNULL(dk.gt, 0) AS dau_ky_gt,
        ISNULL(tk.nhap_sl, 0) AS nhap_sl,
        ISNULL(tk.nhap_gt, 0) AS nhap_gt,
        ISNULL(tk.xuat_sl, 0) AS xuat_sl,
        ISNULL(tk.xuat_gt, 0) AS xuat_gt
      FROM all_hang a
      LEFT JOIN dau_ky  dk ON dk.InventoryItemCode = a.InventoryItemCode
      LEFT JOIN trong_ky tk ON tk.InventoryItemCode = a.InventoryItemCode
      ORDER BY ten_hang
    `);

    const db  = await getDb();
    const now = new Date().toLocaleString('vi-VN');
    let count = 0;

    for (const row of result.recordset) {
      if (!row.ma_hang) continue;
      const cuoi_ky_sl = Number(row.dau_ky_sl) + Number(row.nhap_sl) - Number(row.xuat_sl);
      const cuoi_ky_gt = Number(row.dau_ky_gt) + Number(row.nhap_gt) - Number(row.xuat_gt);
      db.run(`
        INSERT INTO tonkho_cache
          (ma_hang, ten_hang, kho, dvt, don_gia,
           dau_ky_sl, dau_ky_gt, nhap_sl, nhap_gt, xuat_sl, xuat_gt,
           cuoi_ky_sl, cuoi_ky_gt, tu_ngay, den_ngay, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(ma_hang, tu_ngay, den_ngay) DO UPDATE SET
          ten_hang=excluded.ten_hang, kho=excluded.kho, dvt=excluded.dvt,
          don_gia=excluded.don_gia,
          dau_ky_sl=excluded.dau_ky_sl, dau_ky_gt=excluded.dau_ky_gt,
          nhap_sl=excluded.nhap_sl,     nhap_gt=excluded.nhap_gt,
          xuat_sl=excluded.xuat_sl,     xuat_gt=excluded.xuat_gt,
          cuoi_ky_sl=excluded.cuoi_ky_sl, cuoi_ky_gt=excluded.cuoi_ky_gt,
          updated_at=excluded.updated_at
      `, [
        row.ma_hang, row.ten_hang||'', row.kho||'', row.dvt||'', row.don_gia||0,
        row.dau_ky_sl||0, row.dau_ky_gt||0,
        row.nhap_sl||0, row.nhap_gt||0,
        row.xuat_sl||0, row.xuat_gt||0,
        cuoi_ky_sl, cuoi_ky_gt,
        firstDay, today, now
      ]);
      count++;
    }

    saveSyncMeta(db, 'last_sync_tonkho');
    saveDb(db);
    console.log(`✅ Sync tồn kho: ${count} mặt hàng`);
    return { success: true, count };
  } catch (err) {
    console.error('❌ Sync tồn kho lỗi:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Sync công nợ tổng hợp (congno_cache) ────────────────────────────────────
// Cache theo kỳ: đầu tháng → hôm nay
async function syncCongno() {
  console.log('🔄 Sync công nợ từ MISA...');
  try {
    const misa = await getMisaPool();
    const today    = new Date().toISOString().slice(0, 10);
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

    const request = misa.request();
    request.input('tu_ngay',  sql.Date, new Date(firstDay));
    request.input('den_ngay', sql.Date, new Date(today));

    const result = await request.query(`
      SELECT
        aol.AccountObjectCode AS ma_kh,
        MAX(aol.AccountObjectName) AS ten_kh,
        ISNULL(SUM(CASE WHEN aol.PostedDate < @tu_ngay
          THEN aol.DebitAmountOC  ELSE 0 END), 0) AS dau_ky_no,
        ISNULL(SUM(CASE WHEN aol.PostedDate < @tu_ngay
          THEN aol.CreditAmountOC ELSE 0 END), 0) AS dau_ky_co,
        ISNULL(SUM(CASE WHEN aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN aol.DebitAmountOC  ELSE 0 END), 0) AS ps_no,
        ISNULL(SUM(CASE WHEN aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN aol.CreditAmountOC ELSE 0 END), 0) AS ps_co,
        COUNT(DISTINCT CASE WHEN aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
          THEN aol.RefNo END) AS so_phieu
      FROM AccountObjectLedger aol
      WHERE aol.AccountNumber LIKE '131%'
        AND aol.AccountObjectCode IS NOT NULL
        AND aol.AccountObjectCode <> ''
      GROUP BY aol.AccountObjectCode
      HAVING
        SUM(CASE WHEN aol.PostedDate < @tu_ngay
              THEN aol.DebitAmountOC - aol.CreditAmountOC ELSE 0 END) <> 0
        OR SUM(CASE WHEN aol.PostedDate BETWEEN @tu_ngay AND @den_ngay
              THEN aol.DebitAmountOC + aol.CreditAmountOC ELSE 0 END) > 0
      ORDER BY MAX(aol.AccountObjectName)
    `);

    const db  = await getDb();
    const now = new Date().toLocaleString('vi-VN');
    let count = 0;

    for (const row of result.recordset) {
      if (!row.ma_kh) continue;
      const du_no_net = (Number(row.dau_ky_no) - Number(row.dau_ky_co))
                      + (Number(row.ps_no)      - Number(row.ps_co));
      const cuoi_ky_no = Math.max(0,  du_no_net);
      const cuoi_ky_co = Math.max(0, -du_no_net);

      db.run(`
        INSERT INTO congno_cache
          (ma_kh, ten_kh, dau_ky_no, dau_ky_co, ps_no, ps_co, so_phieu,
           cuoi_ky_no, cuoi_ky_co, du_no_net, tu_ngay, den_ngay, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(ma_kh, tu_ngay, den_ngay) DO UPDATE SET
          ten_kh=excluded.ten_kh,
          dau_ky_no=excluded.dau_ky_no, dau_ky_co=excluded.dau_ky_co,
          ps_no=excluded.ps_no,         ps_co=excluded.ps_co,
          so_phieu=excluded.so_phieu,
          cuoi_ky_no=excluded.cuoi_ky_no, cuoi_ky_co=excluded.cuoi_ky_co,
          du_no_net=excluded.du_no_net,
          updated_at=excluded.updated_at
      `, [
        row.ma_kh, row.ten_kh||'',
        row.dau_ky_no||0, row.dau_ky_co||0,
        row.ps_no||0, row.ps_co||0, row.so_phieu||0,
        cuoi_ky_no, cuoi_ky_co, du_no_net,
        firstDay, today, now
      ]);
      count++;
    }

    saveSyncMeta(db, 'last_sync_congno');
    saveDb(db);
    console.log(`✅ Sync công nợ: ${count} khách`);
    return { success: true, count };
  } catch (err) {
    console.error('❌ Sync công nợ lỗi:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────
function startSyncScheduler() {
  const minutes = parseInt(process.env.SYNC_INTERVAL_MINUTES) || 15;
  console.log(`⏰ Auto-sync MISA mỗi ${minutes} phút`);
  cron.schedule(`*/${minutes} * * * *`, async () => {
    const online = await isMisaOnline();
    if (!online) {
      console.log('⚠️  MISA offline — bỏ qua sync lần này');
      return;
    }
    await syncProducts();
    await syncCustomers();
    await syncTonkho();
    await syncCongno();
  });
}

module.exports = { syncProducts, syncCustomers, syncTonkho, syncCongno, startSyncScheduler };
