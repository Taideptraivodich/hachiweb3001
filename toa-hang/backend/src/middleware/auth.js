const jwt = require('jsonwebtoken');

// Kiểm tra JWT trong header Authorization: "Bearer <token>"
// Gắn vào các route cần đăng nhập. Không dùng cho /api/auth và /api/health.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' });
  }
}

module.exports = { requireAuth };
