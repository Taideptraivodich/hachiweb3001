const express = require('express');
const router  = express.Router();
const { getMisaPool, sql } = require('../db');
const { getDb, saveDb, dbQuery, dbGet } = require('../sqlite');

// ─── Helper: kiểm tra MISA online ────────────────────────────────────────────
async function checkMisaOnline() {
  try {
    const misa = await getMisaPool();
    await misa.request().query('SELECT 1 AS ping');
    return true;
  } catch {
    return false;
  }
}

async function getLastSync(key) {
  try {
    const db = await getDb();
    const row = dbGet(db, `SELECT value FROM sync_meta WHERE key = ?`, [key]);
    db.close();
    return row ? row.value : null;
  } catch {
    return null;
  }
}

// ─── GET /congno/tong-hop ─────────────────────────────────────────────────────
router.get('/tong-hop', async (req, res) => {
  const { tu_ngay, den_ngay } = req.query;
  const today    = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const fromDate = tu_ngay  || firstDay;
  const toDate   = den_ngay || today;

  const misaOnline = await checkMisaOnline();

  if (misaOnline) {
    try {
      const misa    = await getMisaPool();
      const request = misa.request();
      request.input('tu_ngay',  sql.Date, new Date(fromDate));
      request.input('den_ngay', sql.Date, new Date(toDate));

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

      const data = result.recordset.map(r => ({
        ...r,
        cuoi_ky_no: Math.max(0,  (r.dau_ky_no - r.dau_ky_co) + (r.ps_no - r.ps_co)),
        cuoi_ky_co: Math.max(0, -((r.dau_ky_no - r.dau_ky_co) + (r.ps_no - r.ps_co))),
        du_no_net:  (r.dau_ky_no - r.dau_ky_co) + (r.ps_no - r.ps_co),
      }));

      // Cập nhật cache
      _updateCongnoCache(data, fromDate, toDate).catch(() => {});

      return res.json({ success: true, data, from_cache: false });
    } catch (err) {
      console.error('❌ Công nợ tổng hợp MISA lỗi:', err.message);
      // fall through
    }
  }

  // Fallback cache
  console.log('⚠️  MISA offline — đọc công nợ từ cache SQLite');
  try {
    const db = await getDb();
    let rows = dbQuery(db, `
      SELECT ma_kh, ten_kh, dau_ky_no, dau_ky_co, ps_no, ps_co, so_phieu,
             cuoi_ky_no, cuoi_ky_co, du_no_net, updated_at
      FROM congno_cache
      WHERE tu_ngay = ? AND den_ngay = ?
      ORDER BY ten_kh
    `, [fromDate, toDate]);

    // Nếu không có cache đúng kỳ, lấy cache gần nhất
    if (!rows || rows.length === 0) {
      rows = dbQuery(db, `
        SELECT ma_kh, ten_kh, dau_ky_no, dau_ky_co, ps_no, ps_co, so_phieu,
               cuoi_ky_no, cuoi_ky_co, du_no_net, tu_ngay, den_ngay, updated_at
        FROM congno_cache
        ORDER BY updated_at DESC
        LIMIT 2000
      `, []);
    }

    db.close();

    const lastSync = await getLastSync('last_sync_congno');
    return res.json({
      success: true,
      data: rows,
      from_cache: true,
      cache_note: `⚠️ Dữ liệu offline — lần sync cuối: ${lastSync || 'chưa có'}`,
    });
  } catch (cacheErr) {
    console.error('❌ Đọc cache công nợ lỗi:', cacheErr.message);
    return res.status(503).json({ success: false, error: 'MISA offline và không có cache. Vui lòng thử lại sau.' });
  }
});

// ─── GET /congno/chi-tiet ─────────────────────────────────────────────────────
router.get('/chi-tiet', async (req, res) => {
  const { ma_kh, tu_ngay, den_ngay } = req.query;
  if (!ma_kh) return res.status(400).json({ success: false, error: 'Thiếu ma_kh' });

  const today    = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const fromDate = tu_ngay  || firstDay;
  const toDate   = den_ngay || today;

  const misaOnline = await checkMisaOnline();

  if (misaOnline) {
    try {
      const misa = await getMisaPool();
      const request = misa.request();
      request.input('ma_kh',    sql.NVarChar, ma_kh);
      request.input('tu_ngay',  sql.Date, new Date(fromDate));
      request.input('den_ngay', sql.Date, new Date(toDate));

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

      let soDu = duDauKyNet;
      const rows = chiTiet.recordset.map(r => {
        soDu += Number(r.ps_no || 0) - Number(r.ps_co || 0);
        return { ...r, so_du: soDu };
      });

      return res.json({
        success: true, dau_ky_net: duDauKyNet,
        dau_ky_no: dauKy.no, dau_ky_co: dauKy.co,
        data: rows, from_cache: false,
      });
    } catch (err) {
      console.error('❌ Công nợ chi tiết MISA lỗi:', err.message);
      // fall through
    }
  }

  // Fallback: chi tiết không cache — thông báo offline
  const lastSync = await getLastSync('last_sync_congno');
  return res.status(503).json({
    success: false,
    error: `MISA đang offline. Chi tiết công nợ không có sẵn trong cache. Lần sync cuối: ${lastSync || 'chưa có'}`,
    from_cache: true,
  });
});

// ─── Helper: cập nhật cache congno ───────────────────────────────────────────
async function _updateCongnoCache(data, tu_ngay, den_ngay) {
  const db  = await getDb();
  const now = new Date().toLocaleString('vi-VN');
  for (const row of data) {
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
      row.cuoi_ky_no||0, row.cuoi_ky_co||0, row.du_no_net||0,
      tu_ngay, den_ngay, now,
    ]);
  }
  db.run(`
    INSERT INTO sync_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `, ['last_sync_congno', now, now]);
  saveDb(db);
}

module.exports = router;
