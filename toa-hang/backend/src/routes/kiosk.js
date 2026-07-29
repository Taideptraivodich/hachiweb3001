const express = require('express');
const router  = express.Router();
const { ensureActiveToken } = require('../services/attendance_qr');

// Public — dùng cho màn hình kiosk đặt tại cổng công ty, không yêu cầu đăng nhập.
// Lưu ý bảo mật: vì QR này vốn hiển thị công khai (ai đi ngang cũng thấy và
// có thể chụp/quét), việc endpoint không cần JWT không làm giảm thêm mức an
// toàn — nhân viên vẫn phải đăng nhập app bằng tài khoản riêng để chấm công.
router.get('/qr', async (req, res) => {
  try {
    const current = await ensureActiveToken();
    res.json(current);
  } catch (err) {
    console.error('❌ Lỗi lấy QR kiosk:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;
