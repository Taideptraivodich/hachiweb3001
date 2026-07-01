const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h

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
  res.json({ username: req.user.username });
});

module.exports = router;
