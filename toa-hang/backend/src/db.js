require('dotenv').config();
const sql = require('mssql');
const misaConfig = {
  server:   process.env.MISA_HOST,
  port:     parseInt(process.env.MISA_PORT) || 1433,
  database: process.env.MISA_DATABASE,
  user:     process.env.MISA_USER,
  password: process.env.MISA_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
 },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let misaPool   = null;
let connecting = null;

function createMisaPool() {
  const pool = new sql.ConnectionPool(misaConfig);

  // Nếu pool gặp lỗi nghiêm trọng (MISA tắt, mất mạng, mất kết nối...),
  // bỏ pool này đi — lần gọi getMisaPool() tiếp theo sẽ tự tạo pool mới
  // thay vì giữ mãi 1 pool đã chết (trước đây bị kẹt vĩnh viễn cho tới khi restart server).
  pool.on('error', (err) => {
    console.error('❌ MISA pool lỗi, sẽ kết nối lại ở lần gọi tiếp theo:', err.message);
    if (misaPool === pool) misaPool = null;
  });

  return pool.connect();
}

async function getMisaPool() {
  if (misaPool && misaPool.connected) return misaPool;

  // Gộp các lần gọi đồng thời lại thành 1 lần connect, tránh mở dồn nhiều pool
  // khi nhiều request/cron job cùng lúc thấy misaPool chưa sẵn sàng.
  if (!connecting) {
    connecting = createMisaPool()
      .then((pool) => { misaPool = pool; return pool; })
      .catch((err)  => { misaPool = null; throw err; })
      .finally(()   => { connecting = null; });
  }
  return connecting;
}

async function getAppPool() { return null; }

module.exports = { sql, getMisaPool, getAppPool };
