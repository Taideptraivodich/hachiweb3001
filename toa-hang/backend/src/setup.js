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

    // ── Cache tồn kho tổng hợp ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS tonkho_cache (
      ma_hang     TEXT NOT NULL,
      ten_hang    TEXT DEFAULT '',
      kho         TEXT DEFAULT '',
      dvt         TEXT DEFAULT '',
      don_gia     REAL DEFAULT 0,
      dau_ky_sl   REAL DEFAULT 0,
      dau_ky_gt   REAL DEFAULT 0,
      nhap_sl     REAL DEFAULT 0,
      nhap_gt     REAL DEFAULT 0,
      xuat_sl     REAL DEFAULT 0,
      xuat_gt     REAL DEFAULT 0,
      cuoi_ky_sl  REAL DEFAULT 0,
      cuoi_ky_gt  REAL DEFAULT 0,
      tu_ngay     TEXT NOT NULL,
      den_ngay    TEXT NOT NULL,
      updated_at  TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (ma_hang, kho, tu_ngay, den_ngay)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tonkho_cache_ngay ON tonkho_cache(tu_ngay, den_ngay)`,

    // ── Cache công nợ tổng hợp ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS congno_cache (
      ma_kh       TEXT NOT NULL,
      ten_kh      TEXT DEFAULT '',
      dau_ky_no   REAL DEFAULT 0,
      dau_ky_co   REAL DEFAULT 0,
      ps_no       REAL DEFAULT 0,
      ps_co       REAL DEFAULT 0,
      so_phieu    INTEGER DEFAULT 0,
      cuoi_ky_no  REAL DEFAULT 0,
      cuoi_ky_co  REAL DEFAULT 0,
      du_no_net   REAL DEFAULT 0,
      tu_ngay     TEXT NOT NULL,
      den_ngay    TEXT NOT NULL,
      updated_at  TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (ma_kh, tu_ngay, den_ngay)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_congno_cache_ngay ON congno_cache(tu_ngay, den_ngay)`,

    // ── Cache công nợ chi tiết ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS congno_chitiet_cache (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_kh       TEXT NOT NULL,
      tu_ngay     TEXT NOT NULL,
      den_ngay    TEXT NOT NULL,
      dau_ky_net  REAL DEFAULT 0,
      dau_ky_no   REAL DEFAULT 0,
      dau_ky_co   REAL DEFAULT 0,
      ngay_ct     TEXT,
      ngay_hd     TEXT,
      so_ct       TEXT,
      dien_giai   TEXT,
      ps_no       REAL DEFAULT 0,
      ps_co       REAL DEFAULT 0,
      tk_du       TEXT,
      so_du       REAL DEFAULT 0,
      updated_at  TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_congno_ct_cache ON congno_chitiet_cache(ma_kh, tu_ngay, den_ngay)`,

    // ── Cache tồn kho chi tiết ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS tonkho_chitiet_cache (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_hang     TEXT NOT NULL,
      tu_ngay     TEXT NOT NULL,
      den_ngay    TEXT NOT NULL,
      ten_hang    TEXT DEFAULT '',
      dau_ky_sl   REAL DEFAULT 0,
      dau_ky_gt   REAL DEFAULT 0,
      dau_ky_don_gia REAL DEFAULT 0,
      ngay_hach_toan TEXT,
      ngay_ct     TEXT,
      so_ct       TEXT,
      dien_giai   TEXT,
      dvt         TEXT,
      don_gia     REAL DEFAULT 0,
      nhap_sl     REAL DEFAULT 0,
      nhap_gt     REAL DEFAULT 0,
      xuat_sl     REAL DEFAULT 0,
      xuat_gt     REAL DEFAULT 0,
      kho         TEXT,
      ton_sl      REAL DEFAULT 0,
      ton_gt      REAL DEFAULT 0,
      updated_at  TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tonkho_ct_cache ON tonkho_chitiet_cache(ma_hang, tu_ngay, den_ngay)`,

    // ── Bảng công nợ gửi khách ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS bang_cong_no_draft (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_kh                 TEXT,
      ten_kh                TEXT NOT NULL,
      tu_ngay               TEXT,
      den_ngay              TEXT,
      tieu_de               TEXT,
      source_file_name      TEXT,
      dau_ky                INTEGER DEFAULT 0,
      tong_ps               INTEGER DEFAULT 0,
      tong_tt               INTEGER DEFAULT 0,
      tong_dieu_chinh_tang  INTEGER DEFAULT 0,
      tong_dieu_chinh_giam  INTEGER DEFAULT 0,
      cuoi_ky_app           INTEGER DEFAULT 0,
      cuoi_ky_misa          INTEGER DEFAULT 0,
      chenh_lech            INTEGER DEFAULT 0,
      reconcile_status      TEXT DEFAULT 'chua_doi_chieu',
      status                TEXT DEFAULT 'draft',
      draft_json            TEXT NOT NULL,
      export_excel_path     TEXT,
      export_image_path     TEXT,
      created_at            TEXT DEFAULT (datetime('now','localtime')),
      updated_at            TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bcn_draft_ma_kh   ON bang_cong_no_draft(ma_kh)`,
    `CREATE INDEX IF NOT EXISTS idx_bcn_draft_status  ON bang_cong_no_draft(status)`,
    `CREATE INDEX IF NOT EXISTS idx_bcn_draft_ten_kh  ON bang_cong_no_draft(ten_kh)`,

    // ── Meta: lưu thời điểm sync cuối ──────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS sync_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
  ];
  for (const sql of tables) db.run(sql);

  // ── Migration: thêm cột mới vào DB cũ (chạy an toàn mỗi lần khởi động) ──
  function columnExists(table, column) {
    const cols = [];
    db.each(`PRAGMA table_info(${table})`, {}, (row) => cols.push(row.name));
    return cols.includes(column);
  }
  function addColumnIfMissing(table, column, definition) {
    if (!columnExists(table, column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`🛠️  Migration: đã thêm cột "${column}" vào bảng "${table}"`);
    }
  }

  // orders.ma_don: mã đơn chuẩn gửi khách/in phiếu/export, dạng DDMMYYHCNN (vd 230626HC07)
  addColumnIfMissing('orders', 'ma_don', "TEXT DEFAULT ''");
  // order_details: bổ sung Hãng SX / Nhà cung cấp / ĐVT để khớp mẫu Excel Flowex
  addColumnIfMissing('order_details', 'hang_san_xuat', "TEXT DEFAULT ''");
  addColumnIfMissing('order_details', 'nha_cung_cap',  "TEXT DEFAULT ''");
  addColumnIfMissing('order_details', 'dvt',           "TEXT DEFAULT ''");
  addColumnIfMissing('order_details', 'ten_hang_hien_thi', "TEXT DEFAULT ''");
  // orders: bổ sung SĐT và địa chỉ khách để điền vào phiếu xuất
  addColumnIfMissing('orders', 'sdt',     "TEXT DEFAULT ''");
  addColumnIfMissing('orders', 'dia_chi', "TEXT DEFAULT ''");

  // Backfill ma_don cho các toa cũ đã có, suy từ ma_toa dạng "NN.DDMMYY" → "DDMMYYHCNN"
  const oldOrders = [];
  db.each(`SELECT id, ma_toa, ma_don FROM orders`, {}, (row) => oldOrders.push(row));
  const reMaToa = /^(\d{1,2})\.(\d{6})$/;
  for (const o of oldOrders) {
    if (o.ma_don) continue;
    const m = String(o.ma_toa || '').match(reMaToa);
    if (!m) continue; // ma_toa không theo pattern chuẩn → để trống, user tự nhập tay
    const [, seq, ddmmyy] = m;
    db.run(`UPDATE orders SET ma_don=? WHERE id=?`, [`${ddmmyy}HC${seq.padStart(2,'0')}`, o.id]);
  }

  saveDb(db);
  console.log('✅ SQLite database ready:', require('path').join(__dirname,'..','data','toa-hang.db'));
}

module.exports = { setupDatabase };
