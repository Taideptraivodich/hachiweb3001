const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');

// Chỉ admin (token không có employeeId) mới được quản lý nhân viên.
function requireAdmin(req, res, next) {
  if (req.user && req.user.employeeId) {
    return res.status(403).json({ error: 'Chỉ admin mới có quyền này' });
  }
  next();
}
router.use(requireAdmin);

// ─── GET /employees — danh sách nhân viên ────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const rows = dbQuery(db, `SELECT id, ma_nv, ho_ten, chuc_vu, active, created_at FROM employees ORDER BY ho_ten`);
    db.close();
    res.json(rows);
  } catch (err) {
    console.error('❌ Lỗi lấy danh sách nhân viên:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── POST /employees — tạo tài khoản nhân viên mới ───────────────────────────
router.post('/', async (req, res) => {
  try {
    const { ma_nv, ho_ten, password, chuc_vu } = req.body || {};
    if (!ma_nv || !ho_ten || !password) {
      return res.status(400).json({ error: 'Thiếu mã nhân viên, họ tên hoặc mật khẩu' });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Mật khẩu quá ngắn (tối thiểu 4 ký tự)' });
    }

    const db = await getDb();
    const existed = dbGet(db, `SELECT id FROM employees WHERE ma_nv = ?`, [ma_nv]);
    if (existed) {
      db.close();
      return res.status(409).json({ error: 'Mã nhân viên đã tồn tại' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    dbRun(db, `INSERT INTO employees (ma_nv, ho_ten, password_hash, chuc_vu) VALUES (?, ?, ?, ?)`,
      [ma_nv, ho_ten, passwordHash, chuc_vu || '']);
    saveDb(db);

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('❌ Lỗi tạo nhân viên:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── PUT /employees/:id — sửa thông tin / đổi mật khẩu / khoá tài khoản ──────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ho_ten, chuc_vu, active, password } = req.body || {};

    const db = await getDb();
    const row = dbGet(db, `SELECT * FROM employees WHERE id = ?`, [id]);
    if (!row) {
      db.close();
      return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    }

    const newHoTen  = ho_ten !== undefined ? ho_ten : row.ho_ten;
    const newChucVu = chuc_vu !== undefined ? chuc_vu : row.chuc_vu;
    const newActive = active !== undefined ? (active ? 1 : 0) : row.active;
    const newHash   = password ? await bcrypt.hash(password, 10) : row.password_hash;

    dbRun(db, `UPDATE employees SET ho_ten = ?, chuc_vu = ?, active = ?, password_hash = ?,
      updated_at = datetime('now','localtime') WHERE id = ?`,
      [newHoTen, newChucVu, newActive, newHash, id]);
    saveDb(db);

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Lỗi cập nhật nhân viên:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── DELETE /employees/:id — xoá tài khoản nhân viên ─────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    dbRun(db, `DELETE FROM employees WHERE id = ?`, [id]);
    saveDb(db);
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Lỗi xoá nhân viên:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;
