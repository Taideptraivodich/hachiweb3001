const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'toa-hang.db');
const LAST_GOOD_PATH = `${DB_PATH}.last-good`;
let SQL = null;

async function getSqlJs() {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

async function getDb() {
  const sql = await getSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const buf = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  const db  = buf ? new sql.Database(buf) : new sql.Database();
  db.run('PRAGMA foreign_keys=ON;');
  return db;
}

function atomicWriteFile(targetPath, buffer) {
  const dir = path.dirname(targetPath);
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, buffer);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, targetPath);
  try {
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch { /* some filesystems do not support fsync on directories */ }
}

function saveDb(db) {
  const data = Buffer.from(db.export());
  const sql = SQL;
  if (!sql) throw new Error('SQLite engine chưa sẵn sàng');

  // Validate the exact bytes before replacing the live DB.
  const verify = new sql.Database(data);
  const check = verify.exec('PRAGMA quick_check;');
  verify.close();
  const status = check?.[0]?.values?.[0]?.[0];
  if (status !== 'ok') throw new Error(`SQLite quick_check thất bại: ${status || 'unknown'}`);

  // Keep one automatically verified snapshot for emergency recovery.
  if (fs.existsSync(DB_PATH)) {
    try {
      const current = fs.readFileSync(DB_PATH);
      const currentDb = new sql.Database(current);
      const currentCheck = currentDb.exec('PRAGMA quick_check;');
      currentDb.close();
      if (currentCheck?.[0]?.values?.[0]?.[0] === 'ok') atomicWriteFile(LAST_GOOD_PATH, current);
    } catch { /* Never replace last-good with a corrupt file. */ }
  }

  atomicWriteFile(DB_PATH, data);
  db.close();
}

function dbQuery(db, sql, params = {}) {
  const rows = [];
  db.each(sql, params, (row) => rows.push(row));
  return rows;
}

function dbGet(db, sql, params = {}) {
  return dbQuery(db, sql, params)[0] || null;
}

function dbRun(db, sql, params = []) {
  db.run(sql, params);
}

module.exports = { getDb, saveDb, dbQuery, dbGet, dbRun, DB_PATH, LAST_GOOD_PATH };
