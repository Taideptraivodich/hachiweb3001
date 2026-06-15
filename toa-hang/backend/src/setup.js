const { getDb, saveDb } = require('./sqlite');

async function setupDatabase() {
  const db = await getDb();
  const tables = [
    `CREATE TABLE IF NOT EXISTS product_cache (
      ma_hang TEXT PRIMARY KEY, ten_hang TEXT NOT NULL, kho TEXT,
      ton_kho REAL DEFAULT 0, gia_von REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS customer_cache (
      ma_kh TEXT PRIMARY KEY, ten_kh TEXT NOT NULL,
      dien_thoai TEXT, dia_chi TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ma_toa TEXT UNIQUE NOT NULL,
      ngay_tao TEXT NOT NULL, ma_kh TEXT DEFAULT '', ten_kh TEXT DEFAULT '',
      noi_gui_hang TEXT DEFAULT '', ghi_chu TEXT DEFAULT '',
      trang_thai TEXT DEFAULT 'Đang xử lý',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS order_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      ma_hang TEXT NOT NULL, ten_hang TEXT NOT NULL, kho TEXT DEFAULT '',
      ton_kho_luc REAL DEFAULT 0, gia_von REAL DEFAULT 0,
      so_luong REAL NOT NULL, don_gia_ban REAL DEFAULT 0,
      ghi_chu TEXT DEFAULT '', sort_order INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS sales_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, stt INTEGER,
      ma_hang TEXT NOT NULL, hang_sx TEXT, mo_ta TEXT, dvt TEXT,
      so_luong REAL, don_gia REAL, thanh_tien REAL,
      ten_kh TEXT, ma_kh TEXT, ngay_xuat TEXT, gia_von REAL,
      nha_cc TEXT, ghi_chu TEXT,
      imported_at TEXT DEFAULT (datetime('now','localtime')))`,

    `CREATE TABLE IF NOT EXISTS ma_ngoai (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_hang     TEXT NOT NULL,
      ma_ngoai    TEXT NOT NULL,
      nha_cc      TEXT DEFAULT '',
      xe_ap_dung  TEXT DEFAULT '',
      vi_tri      TEXT DEFAULT '',
      ghi_chu     TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(ma_hang, ma_ngoai)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_ma_ngoai_ma_hang  ON ma_ngoai(ma_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_ma_ngoai_ma_ngoai ON ma_ngoai(ma_ngoai)`,
    `CREATE INDEX IF NOT EXISTS idx_history_ma_hang   ON sales_history(ma_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_history_ma_kh     ON sales_history(ma_kh)`,
    `CREATE INDEX IF NOT EXISTS idx_history_ngay      ON sales_history(ngay_xuat)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_ngay       ON orders(ngay_tao)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_ma_kh      ON orders(ma_kh)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_trang_thai ON orders(trang_thai)`,
    `CREATE INDEX IF NOT EXISTS idx_detail_ma_hang    ON order_details(ma_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_product_ten       ON product_cache(ten_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_customer_ten      ON customer_cache(ten_kh)`,
  ];
  for (const sql of tables) db.run(sql);
  saveDb(db);
  console.log('✅ SQLite database ready:', require('path').join(__dirname,'..','data','toa-hang.db'));
}

module.exports = { setupDatabase };
