const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { requireAuth } = require('../middleware/auth');
const { getDb, dbGet } = require('../sqlite');

const router = express.Router();

const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h
// Hash hợp lệ nhưng không khớp mật khẩu nào — dùng khi ma_nv không tồn tại,
// để bcrypt.compare vẫn chạy đủ thời gian như khi so khớp thật.
const DUMMY_HASH = bcrypt.hashSync('__no_such_account__', 10);

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Thiếu tài khoản hoặc mật khẩu' });
    }

    const expectedUser = process.env.ADMIN_USERNAME || '';
    const expectedHash = process.env.ADMIN_PASSWORD_HASH || '';

    if (!expectedUser || !expectedHash) {
      console.error('❌ Thiếu ADMIN_USERNAME / ADMIN_PASSWORD_HASH trong .env');
      return res.status(500).json({ error: 'Server chưa cấu hình tài khoản đăng nhập' });
    }

    const userOk = username === expectedUser;
    // Luôn chạy bcrypt.compare kể cả khi user sai, để tránh lộ thông tin qua thời gian phản hồi
    const passOk = await bcrypt.compare(password, expectedHash);

    if (!userOk || !passOk) {
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    }

    const token = jwt.sign({ username }, process.env.JWT_SECRET, {
      expiresIn: TOKEN_TTL_SECONDS,
    });

    res.json({ token, username, expiresIn: TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error('❌ Lỗi đăng nhập:', err.message);
    res.status(500).json({ error: 'Lỗi server khi đăng nhập' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, employeeId: req.user.employeeId || null });
});

// ─── Đăng nhập nhân viên (app mobile chấm công) ──────────────────────────────
router.post('/employee-login', async (req, res) => {
  try {
    const { ma_nv, password } = req.body || {};
    if (!ma_nv || !password) {
      return res.status(400).json({ error: 'Thiếu mã nhân viên hoặc mật khẩu' });
    }

    const db = await getDb();
    const emp = dbGet(db, `SELECT * FROM employees WHERE ma_nv = ?`, [ma_nv]);
    db.close();

    // Luôn chạy bcrypt.compare kể cả khi không tìm thấy tài khoản, tránh lộ
    // thông tin qua thời gian phản hồi (giống luồng đăng nhập admin ở trên).
    const passOk = await bcrypt.compare(password, emp ? emp.password_hash : DUMMY_HASH);

    if (!emp || !emp.active || !passOk) {
      return res.status(401).json({ error: 'Sai mã nhân viên hoặc mật khẩu' });
    }

    const token = jwt.sign(
      { username: emp.ma_nv, employeeId: emp.id, hoTen: emp.ho_ten },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_TTL_SECONDS }
    );

    res.json({ token, employeeId: emp.id, hoTen: emp.ho_ten, expiresIn: TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error('❌ Lỗi đăng nhập nhân viên:', err.message);
    res.status(500).json({ error: 'Lỗi server khi đăng nhập' });
  }
});

module.exports = router;
