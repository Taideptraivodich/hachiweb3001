const crypto = require('crypto');
const cron   = require('node-cron');
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');

// Token đổi lúc 0h và 12h mỗi ngày. Token hiện tại luôn hết hạn đúng vào
// mốc rotate kế tiếp — nếu server restart giữa chừng, hàm ensureActiveToken
// sẽ tự phát hiện "chưa có token active" hoặc "token đã hết hạn" và tạo lại,
// nên không phụ thuộc hoàn toàn vào cron còn sống liên tục.

function nextRotationBoundary(now = new Date()) {
  const d = new Date(now);
  const hour = d.getHours();
  if (hour < 12) {
    d.setHours(12, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function toSqliteLocal(date) {
  // Lưu dạng "YYYY-MM-DD HH:MM:SS" theo giờ local, khớp định dạng
  // datetime('now','localtime') đã dùng trong toàn bộ schema hiện có.
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} `
       + `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

async function rotateToken() {
  const db = await getDb();
  db.run('UPDATE attendance_qr_tokens SET active = 0 WHERE active = 1');

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = toSqliteLocal(nextRotationBoundary());

  dbRun(db, `INSERT INTO attendance_qr_tokens (token, active, expires_at) VALUES (?, 1, ?)`, [token, expiresAt]);
  saveDb(db);

  console.log(`🔑 Đã tạo QR token chấm công mới, hết hạn lúc ${expiresAt}`);
  return { token, expires_at: expiresAt };
}

// Trả về token đang active; nếu chưa có hoặc đã hết hạn thì tạo mới ngay.
async function ensureActiveToken() {
  const db = await getDb();
  const row = dbGet(db, `SELECT * FROM attendance_qr_tokens WHERE active = 1 ORDER BY id DESC LIMIT 1`);

  if (row && new Date(row.expires_at.replace(' ', 'T')) > new Date()) {
    return { token: row.token, expires_at: row.expires_at };
  }
  return rotateToken();
}

function isTokenValid(db, token) {
  const row = dbGet(db, `SELECT * FROM attendance_qr_tokens WHERE token = ? AND active = 1`, [token]);
  if (!row) return false;
  return new Date(row.expires_at.replace(' ', 'T')) > new Date();
}

function startQrScheduler() {
  // 0h và 12h mỗi ngày
  cron.schedule('0 0,12 * * *', async () => {
    try {
      await rotateToken();
    } catch (err) {
      console.error('❌ Lỗi rotate QR chấm công:', err.message);
    }
  });
  console.log('⏰ Lịch đổi QR chấm công: 00:00 và 12:00 mỗi ngày');
}

module.exports = { rotateToken, ensureActiveToken, isTokenValid, startQrScheduler };
