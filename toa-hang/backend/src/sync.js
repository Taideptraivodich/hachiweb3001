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
        il.InventoryItemCode                         AS ma_hang,
        il.InventoryItemName                         AS ten_hang,
        il.StockName                                 AS kho,
        MAX(u.UnitName)                              AS dvt,
        SUM(il.InwardQuantity - il.OutwardQuantity)  AS ton_kho,
        MAX(il.MainUnitPrice)                        AS gia_von
      FROM InventoryLedger il
      LEFT JOIN Unit u ON u.UnitID = il.UnitID
      GROUP BY il.InventoryItemCode, il.InventoryItemName, il.StockName
      HAVING SUM(il.InwardQuantity - il.OutwardQuantity) > 0
      ORDER BY il.InventoryItemCode
    `);

    const db  = await getDb();
    const now = new Date().toLocaleString('vi-VN');
    let count = 0;

    for (const row of result.recordset) {
      if (!row.ma_hang) continue;
      db.run(`
        INSERT INTO product_cache (ma_hang, ten_hang, kho, dvt, ton_kho, gia_von, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ma_hang) DO UPDATE SET
          ten_hang=excluded.ten_hang, kho=excluded.kho, dvt=excluded.dvt,
          ton_kho=excluded.ton_kho, gia_von=excluded.gia_von,
          updated_at=excluded.updated_at
      `, [row.ma_hang, row.ten_hang||'', row.kho||'', row.dvt||'', row.ton_kho||0, row.gia_von||0, now]);
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
          il.StockName,
          SUM(il.InwardQuantity)  - SUM(il.OutwardQuantity) AS sl,
          SUM(il.InwardAmount)    - SUM(il.OutwardAmount)   AS gt
        FROM InventoryLedger il
        WHERE il.InventoryItemCode IS NOT NULL
          AND il.InventoryItemCode <> ''
          AND il.PostedDate < @tu_ngay
        GROUP BY il.InventoryItemCode, il.StockName
      ),
      trong_ky AS (
        SELECT
          il.InventoryItemCode,
          il.StockName,
          MAX(il.InventoryItemName)  AS ten_hang,
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
        GROUP BY il.InventoryItemCode, il.StockName
      ),
      all_hang AS (
        SELECT InventoryItemCode, StockName FROM dau_ky WHERE sl <> 0
        UNION
        SELECT InventoryItemCode, StockName FROM trong_ky
      )
      SELECT
        a.InventoryItemCode AS ma_hang,
        a.StockName         AS kho,
        (SELECT TOP 1 UnitPrice FROM InventoryLedger
         WHERE InventoryItemCode = a.InventoryItemCode
           AND InwardQuantity > 0 AND UnitPrice > 0
         ORDER BY PostedDate DESC, SortOrder DESC) AS don_gia,
        ISNULL(tk.ten_hang,
          (SELECT TOP 1 InventoryItemName FROM InventoryLedger
           WHERE InventoryItemCode = a.InventoryItemCode)) AS ten_hang,
        tk.dvt,
        ISNULL(dk.sl, 0) AS dau_ky_sl,
        ISNULL(dk.gt, 0) AS dau_ky_gt,
        ISNULL(tk.nhap_sl, 0) AS nhap_sl,
        ISNULL(tk.nhap_gt, 0) AS nhap_gt,
        ISNULL(tk.xuat_sl, 0) AS xuat_sl,
        ISNULL(tk.xuat_gt, 0) AS xuat_gt
      FROM all_hang a
      LEFT JOIN dau_ky  dk ON dk.InventoryItemCode = a.InventoryItemCode AND dk.StockName = a.StockName
      LEFT JOIN trong_ky tk ON tk.InventoryItemCode = a.InventoryItemCode AND tk.StockName = a.StockName
      ORDER BY ten_hang, a.StockName
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
        ON CONFLICT(ma_hang, kho, tu_ngay, den_ngay) DO UPDATE SET
          ten_hang=excluded.ten_hang, dvt=excluded.dvt,
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

// ─── Sync chi tiết công nợ (6 tháng gần nhất, theo từng khách hàng) ──────────
async function syncCongnoChiTiet() {
  console.log('🔄 Sync công nợ chi tiết (6 tháng gần nhất)...');
  try {
    const misa = await getMisaPool();
    const today     = new Date().toISOString().slice(0, 10);
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() - 6);
    const fromDate  = sixMonths.toISOString().slice(0, 10);

    // Lấy danh sách khách hàng có phát sinh trong 6 tháng gần nhất
    const listReq = misa.request();
    listReq.input('tu_ngay', sql.Date, new Date(fromDate));
    const listResult = await listReq.query(`
      SELECT DISTINCT aol.AccountObjectCode AS ma_kh
      FROM AccountObjectLedger aol
      WHERE aol.AccountNumber LIKE '131%'
        AND aol.AccountObjectCode IS NOT NULL
        AND aol.AccountObjectCode <> ''
        AND aol.PostedDate >= @tu_ngay
    `);

    const maKhList = listResult.recordset.map(r => r.ma_kh).filter(Boolean);
    console.log(`   → ${maKhList.length} khách hàng có giao dịch trong 6 tháng`);

    const db  = await getDb();
    const now = new Date().toLocaleString('vi-VN');
    let count = 0;

    for (const ma_kh of maKhList) {
      try {
        const req1 = misa.request();
        req1.input('ma_kh',    sql.NVarChar, ma_kh);
        req1.input('tu_ngay',  sql.Date, new Date(fromDate));
        req1.input('den_ngay', sql.Date, new Date(today));

        const duDauKy = await req1.query(`
          SELECT
            ISNULL(SUM(DebitAmountOC), 0)  AS no,
            ISNULL(SUM(CreditAmountOC), 0) AS co
          FROM AccountObjectLedger
          WHERE AccountNumber LIKE '131%'
            AND AccountObjectCode = @ma_kh
            AND PostedDate < @tu_ngay
        `);

        const req2 = misa.request();
        req2.input('ma_kh',    sql.NVarChar, ma_kh);
        req2.input('tu_ngay',  sql.Date, new Date(fromDate));
        req2.input('den_ngay', sql.Date, new Date(today));

        const chiTiet = await req2.query(`
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

        let soDu = duDauKyNet;
        const rows = chiTiet.recordset.map(r => {
          soDu += Number(r.ps_no || 0) - Number(r.ps_co || 0);
          return { ...r, so_du: soDu };
        });

        db.run(`DELETE FROM congno_chitiet_cache WHERE ma_kh = ? AND tu_ngay = ? AND den_ngay = ?`,
          [ma_kh, fromDate, today]);

        for (const r of rows) {
          db.run(`
            INSERT INTO congno_chitiet_cache
              (ma_kh, tu_ngay, den_ngay, dau_ky_net, dau_ky_no, dau_ky_co,
               ngay_ct, ngay_hd, so_ct, dien_giai, ps_no, ps_co, tk_du, so_du, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          `, [
            ma_kh, fromDate, today, duDauKyNet, dauKy.no, dauKy.co,
            r.ngay_ct ? new Date(r.ngay_ct).toISOString().slice(0, 10) : null,
            r.ngay_hd ? new Date(r.ngay_hd).toISOString().slice(0, 10) : null,
            r.so_ct || '', r.dien_giai || '',
            r.ps_no || 0, r.ps_co || 0,
            r.tk_du || '', r.so_du || 0,
            now,
          ]);
        }
        count++;
      } catch (innerErr) {
        console.error(`   ⚠️  Lỗi cache công nợ chi tiết KH ${ma_kh}:`, innerErr.message);
      }
    }

    saveSyncMeta(db, 'last_sync_congno_chitiet');
    saveDb(db);
    console.log(`✅ Sync công nợ chi tiết: ${count}/${maKhList.length} khách hàng`);
    return { success: true, count };
  } catch (err) {
    console.error('❌ Sync công nợ chi tiết lỗi:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Sync chi tiết tồn kho (6 tháng gần nhất, theo từng mặt hàng) ────────────
async function syncTonkhoChiTiet() {
  console.log('🔄 Sync tồn kho chi tiết (6 tháng gần nhất)...');
  try {
    const misa = await getMisaPool();
    const today     = new Date().toISOString().slice(0, 10);
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() - 6);
    const fromDate  = sixMonths.toISOString().slice(0, 10);

    // Lấy danh sách mặt hàng có biến động trong 6 tháng gần nhất
    const listReq = misa.request();
    listReq.input('tu_ngay', sql.Date, new Date(fromDate));
    const listResult = await listReq.query(`
      SELECT DISTINCT il.InventoryItemCode AS ma_hang
      FROM InventoryLedger il
      WHERE il.InventoryItemCode IS NOT NULL
        AND il.InventoryItemCode <> ''
        AND il.PostedDate >= @tu_ngay
        AND (il.InwardQuantity <> 0 OR il.OutwardQuantity <> 0)
    `);

    const maHangList = listResult.recordset.map(r => r.ma_hang).filter(Boolean);
    console.log(`   → ${maHangList.length} mặt hàng có biến động trong 6 tháng`);

    const db  = await getDb();
    const now = new Date().toLocaleString('vi-VN');
    let count = 0;

    for (const ma_hang of maHangList) {
      try {
        const req1 = misa.request();
        req1.input('ma_hang',  sql.NVarChar, ma_hang);
        req1.input('tu_ngay',  sql.Date, new Date(fromDate));
        req1.input('den_ngay', sql.Date, new Date(today));

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
        req2.input('den_ngay', sql.Date, new Date(today));

        const chiTietRes = await req2.query(`
          SELECT
            il.PostedDate                 AS ngay_hach_toan,
            il.RefDate                    AS ngay_ct,
            il.RefNo                      AS so_ct,
            il.JournalMemo                AS dien_giai,
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
            il.PostedDate, il.RefDate, il.RefNo, il.JournalMemo,
            il.UnitPrice, il.InwardQuantity, il.InwardAmount,
            il.OutwardQuantity, il.OutwardAmount, il.StockName
          ORDER BY il.PostedDate ASC, il.RefNo ASC
        `);

        const dk      = dauKyRes.recordset[0];
        const dauKySL = Number(dk.nhap_sl) - Number(dk.xuat_sl);
        const dauKyGT = Number(dk.nhap_gt) - Number(dk.xuat_gt);
        const dauKyDonGia = dauKySL !== 0 ? Math.abs(dauKyGT / dauKySL) : 0;

        let tonSL = dauKySL, tonGT = dauKyGT;
        const rows = chiTietRes.recordset.map(r => {
          tonSL += Number(r.nhap_sl || 0) - Number(r.xuat_sl || 0);
          tonGT += Number(r.nhap_gt || 0) - Number(r.xuat_gt || 0);
          return { ...r, ton_sl: tonSL, ton_gt: tonGT };
        });

        db.run(`DELETE FROM tonkho_chitiet_cache WHERE ma_hang = ? AND tu_ngay = ? AND den_ngay = ?`,
          [ma_hang, fromDate, today]);

        if (rows.length === 0) {
          db.run(`
            INSERT INTO tonkho_chitiet_cache
              (ma_hang, tu_ngay, den_ngay, ten_hang, dau_ky_sl, dau_ky_gt, dau_ky_don_gia, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
          `, [ma_hang, fromDate, today, '', dauKySL, dauKyGT, dauKyDonGia, now]);
        } else {
          for (const r of rows) {
            db.run(`
              INSERT INTO tonkho_chitiet_cache
                (ma_hang, tu_ngay, den_ngay, ten_hang, dau_ky_sl, dau_ky_gt, dau_ky_don_gia,
                 ngay_hach_toan, ngay_ct, so_ct, dien_giai, dvt, don_gia,
                 nhap_sl, nhap_gt, xuat_sl, xuat_gt, kho, ton_sl, ton_gt, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            `, [
              ma_hang, fromDate, today, r.ten_hang || '', dauKySL, dauKyGT, dauKyDonGia,
              r.ngay_hach_toan ? new Date(r.ngay_hach_toan).toISOString().slice(0, 10) : null,
              r.ngay_ct        ? new Date(r.ngay_ct).toISOString().slice(0, 10)        : null,
              r.so_ct || '', r.dien_giai || '', r.dvt || '',
              r.don_gia || 0,
              r.nhap_sl || 0, r.nhap_gt || 0,
              r.xuat_sl || 0, r.xuat_gt || 0,
              r.kho || '',
              r.ton_sl || 0, r.ton_gt || 0,
              now,
            ]);
          }
        }
        count++;
      } catch (innerErr) {
        console.error(`   ⚠️  Lỗi cache tồn kho chi tiết MH ${ma_hang}:`, innerErr.message);
      }
    }

    saveSyncMeta(db, 'last_sync_tonkho_chitiet');
    saveDb(db);
    console.log(`✅ Sync tồn kho chi tiết: ${count}/${maHangList.length} mặt hàng`);
    return { success: true, count };
  } catch (err) {
    console.error('❌ Sync tồn kho chi tiết lỗi:', err.message);
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

  // Pre-cache chi tiết (nặng hơn) — chạy 1 lần/ngày lúc 2h sáng
  const chiTietCron = process.env.SYNC_CHITIET_CRON || '0 2 * * *';
  console.log(`⏰ Auto pre-cache chi tiết theo lịch: ${chiTietCron}`);
  cron.schedule(chiTietCron, async () => {
    const online = await isMisaOnline();
    if (!online) {
      console.log('⚠️  MISA offline — bỏ qua pre-cache chi tiết lần này');
      return;
    }
    await syncCongnoChiTiet();
    await syncTonkhoChiTiet();
  });
}

module.exports = {
  syncProducts, syncCustomers, syncTonkho, syncCongno,
  syncCongnoChiTiet, syncTonkhoChiTiet,
  startSyncScheduler,
};
