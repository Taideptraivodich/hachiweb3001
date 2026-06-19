const express = require('express');
const router  = express.Router();
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');

// ─── Helpers ────────────────────────────────────────────────────────────────
function calcSummary(draft) {
  const dau_ky = (draft.dau_ky_rows || [])
    .filter(r => !r.deleted)
    .reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);

  const tong_ps = (draft.phat_sinh_rows || [])
    .filter(r => !r.deleted)
    .reduce((s, r) => s + Math.round(Number(r.final_amount) || 0), 0);

  const tong_tt = (draft.thanh_toan_rows || [])
    .filter(r => !r.deleted)
    .reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);

  const tong_dieu_chinh_tang = (draft.dieu_chinh_rows || [])
    .filter(r => !r.deleted && r.direction === 'tang')
    .reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);

  const tong_dieu_chinh_giam = (draft.dieu_chinh_rows || [])
    .filter(r => !r.deleted && r.direction === 'giam')
    .reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);

  const cuoi_ky_app = dau_ky + tong_ps + tong_dieu_chinh_tang - tong_tt - tong_dieu_chinh_giam;

  return { dau_ky, tong_ps, tong_tt, tong_dieu_chinh_tang, tong_dieu_chinh_giam, cuoi_ky_app };
}

// ─── Phase 2: Reconcile helper ──────────────────────────────────────────────
function calcReconcile(cuoi_ky_app, cuoi_ky_misa, misaIsSet) {
  const cuoi_ky_misa_int = Math.round(Number(cuoi_ky_misa) || 0);
  if (!misaIsSet) {
    return { cuoi_ky_misa_int, chenh_lech: 0, reconcile_status: 'chua_doi_chieu' };
  }
  const chenh_lech = cuoi_ky_app - cuoi_ky_misa_int;
  return { cuoi_ky_misa_int, chenh_lech, reconcile_status: chenh_lech === 0 ? 'khop' : 'lech' };
}

// ─── GET /bang-cong-no ── Danh sách draft ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { ma_kh, status } = req.query;
    const db = await getDb();
    let sql = `
      SELECT id, ma_kh, ten_kh, tu_ngay, den_ngay, tieu_de, source_file_name,
             dau_ky, tong_ps, tong_tt, cuoi_ky_app, cuoi_ky_misa, chenh_lech,
             reconcile_status, status, created_at, updated_at
      FROM bang_cong_no_draft
      WHERE 1=1
    `;
    const params = [];
    if (ma_kh)  { sql += ' AND ma_kh = ?';  params.push(ma_kh); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY updated_at DESC LIMIT 200';
    const rows = dbQuery(db, sql, params);
    db.close();
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('❌ GET /bang-cong-no:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /bang-cong-no/:id ── Load 1 draft ─────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const db  = await getDb();
    const row = dbGet(db, 'SELECT * FROM bang_cong_no_draft WHERE id = ?', [req.params.id]);
    db.close();
    if (!row) return res.status(404).json({ success: false, error: 'Không tìm thấy' });
    row.draft_json = JSON.parse(row.draft_json || '{}');
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error('❌ GET /bang-cong-no/:id:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /bang-cong-no ── Tạo draft mới ────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { ma_kh, ten_kh, tu_ngay, den_ngay, tieu_de, source_file_name, draft_json, cuoi_ky_misa, misa_is_set } = req.body;
    if (!ten_kh) return res.status(400).json({ success: false, error: 'Thiếu ten_kh' });
    if (!draft_json) return res.status(400).json({ success: false, error: 'Thiếu draft_json' });

    const summary = calcSummary(draft_json);
    const misaIsSet = Boolean(misa_is_set);
    const { cuoi_ky_misa_int, chenh_lech, reconcile_status } = calcReconcile(summary.cuoi_ky_app, cuoi_ky_misa, misaIsSet);

    draft_json.reconcile = {
      cuoi_ky_app:  summary.cuoi_ky_app,
      cuoi_ky_misa: cuoi_ky_misa_int,
      chenh_lech,
      status: reconcile_status,
      misa_is_set: misaIsSet,
    };

    const db  = await getDb();
    const now = new Date().toLocaleString('vi-VN');
    dbRun(db, `
      INSERT INTO bang_cong_no_draft
        (ma_kh, ten_kh, tu_ngay, den_ngay, tieu_de, source_file_name,
         dau_ky, tong_ps, tong_tt, tong_dieu_chinh_tang, tong_dieu_chinh_giam,
         cuoi_ky_app, cuoi_ky_misa, chenh_lech,
         reconcile_status, status, draft_json, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      ma_kh || '', ten_kh, tu_ngay || '', den_ngay || '', tieu_de || '', source_file_name || '',
      summary.dau_ky, summary.tong_ps, summary.tong_tt,
      summary.tong_dieu_chinh_tang, summary.tong_dieu_chinh_giam,
      summary.cuoi_ky_app, cuoi_ky_misa_int, chenh_lech,
      reconcile_status, 'draft', JSON.stringify(draft_json), now, now,
    ]);

    // Lấy id vừa insert
    const inserted = dbGet(db, 'SELECT last_insert_rowid() AS id', []);
    saveDb(db);
    return res.json({ success: true, id: inserted?.id });
  } catch (err) {
    console.error('❌ POST /bang-cong-no:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /bang-cong-no/:id ── Cập nhật draft ────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { ma_kh, ten_kh, tu_ngay, den_ngay, tieu_de, source_file_name,
            draft_json, cuoi_ky_misa, misa_is_set, status } = req.body;

    const db = await getDb();
    const existing = dbGet(db, 'SELECT id FROM bang_cong_no_draft WHERE id = ?', [req.params.id]);
    if (!existing) { db.close(); return res.status(404).json({ success: false, error: 'Không tìm thấy' }); }

    const summary = calcSummary(draft_json);
    const misaIsSet = Boolean(misa_is_set);
    const { cuoi_ky_misa_int, chenh_lech, reconcile_status } = calcReconcile(summary.cuoi_ky_app, cuoi_ky_misa, misaIsSet);

    draft_json.reconcile = {
      cuoi_ky_app:  summary.cuoi_ky_app,
      cuoi_ky_misa: cuoi_ky_misa_int,
      chenh_lech,
      status: reconcile_status,
      misa_is_set: misaIsSet,
    };

    const now = new Date().toLocaleString('vi-VN');
    dbRun(db, `
      UPDATE bang_cong_no_draft SET
        ma_kh=?, ten_kh=?, tu_ngay=?, den_ngay=?, tieu_de=?, source_file_name=?,
        dau_ky=?, tong_ps=?, tong_tt=?, tong_dieu_chinh_tang=?, tong_dieu_chinh_giam=?,
        cuoi_ky_app=?, cuoi_ky_misa=?, chenh_lech=?,
        reconcile_status=?, status=?, draft_json=?, updated_at=?
      WHERE id=?
    `, [
      ma_kh || '', ten_kh || '', tu_ngay || '', den_ngay || '', tieu_de || '', source_file_name || '',
      summary.dau_ky, summary.tong_ps, summary.tong_tt,
      summary.tong_dieu_chinh_tang, summary.tong_dieu_chinh_giam,
      summary.cuoi_ky_app, cuoi_ky_misa_int, chenh_lech,
      reconcile_status, status || 'draft', JSON.stringify(draft_json), now,
      req.params.id,
    ]);
    saveDb(db);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ PUT /bang-cong-no/:id:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /bang-cong-no/:id ────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    dbRun(db, 'DELETE FROM bang_cong_no_draft WHERE id = ?', [req.params.id]);
    saveDb(db);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ DELETE /bang-cong-no:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
