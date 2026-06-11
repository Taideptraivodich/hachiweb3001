require('dotenv').config();
const sql = require('mssql');

const misaConfig = {
  server:   process.env.MISA_HOST,
  database: process.env.MISA_DATABASE,
  user:     process.env.MISA_USER,
  password: process.env.MISA_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    instanceName: process.env.MISA_INSTANCE,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let misaPool = null;

async function getMisaPool() {
  if (!misaPool) misaPool = await new sql.ConnectionPool(misaConfig).connect();
  return misaPool;
}

async function getAppPool() { return null; }

module.exports = { sql, getMisaPool, getAppPool };