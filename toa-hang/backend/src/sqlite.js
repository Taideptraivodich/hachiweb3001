const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'toa-hang.db');
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

function saveDb(db) {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
}

// Dùng db.each — hoạt động đúng với named params trong sql.js
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

module.exports = { getDb, saveDb, dbQuery, dbGet, dbRun };
