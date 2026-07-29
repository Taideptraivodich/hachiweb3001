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
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_hang        TEXT NOT NULL,
      ma_ngoai       TEXT NOT NULL,
      ma_hang_norm   TEXT DEFAULT '',
      ma_ngoai_norm  TEXT DEFAULT '',
      loai_ma        TEXT DEFAULT 'KHAC',
      nha_cc         TEXT DEFAULT '',
      xe_ap_dung     TEXT DEFAULT '',
      vi_tri         TEXT DEFAULT '',
      gia_dai_ly     REAL DEFAULT 0,
      gia_thung      REAL DEFAULT 0,
      sl_thung       REAL DEFAULT 0,
      stock_ncc      TEXT DEFAULT '',
      trang_thai     TEXT DEFAULT 'da_xac_nhan',
      ghi_chu        TEXT DEFAULT '',
      created_at     TEXT DEFAULT (datetime('now','localtime')),
      updated_at     TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(ma_hang, ma_ngoai)
    )`,

    `CREATE TABLE IF NOT EXISTS win_inventory (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_win       TEXT NOT NULL UNIQUE,
      ma_win_norm  TEXT DEFAULT '',
      ten_hang     TEXT DEFAULT '',
      gia_thung    REAL DEFAULT 0,
      gia_le       REAL DEFAULT 0,
      gia_hachi    REAL DEFAULT 0,
      dvt          TEXT DEFAULT '',
      sl_ban_dau   REAL DEFAULT 0,
      so_luong     REAL DEFAULT 0,
      nhap_them    REAL DEFAULT 0,
      tong_ban     REAL DEFAULT 0,
      con_lai      REAL DEFAULT 0,
      aliases_json TEXT DEFAULT '[]',
      imported_at  TEXT DEFAULT (datetime('now','localtime')),
      updated_at   TEXT DEFAULT (datetime('now','localtime'))
    )`,

    `CREATE TABLE IF NOT EXISTS product_aliases (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_hang      TEXT NOT NULL,
      alias_raw    TEXT NOT NULL,
      alias_norm   TEXT NOT NULL,
      loai_alias   TEXT DEFAULT 'ten_cu',
      nguon        TEXT DEFAULT 'nguoi_dung',
      trang_thai   TEXT DEFAULT 'da_xac_nhan',
      ghi_chu      TEXT DEFAULT '',
      created_by   TEXT DEFAULT '',
      created_at   TEXT DEFAULT (datetime('now','localtime')),
      updated_at   TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(ma_hang, alias_norm)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_ma_ngoai_ma_hang  ON ma_ngoai(ma_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_ma_ngoai_ma_ngoai ON ma_ngoai(ma_ngoai)`,
    `CREATE INDEX IF NOT EXISTS idx_win_ma_norm       ON win_inventory(ma_win_norm)`,
    `CREATE INDEX IF NOT EXISTS idx_alias_norm        ON product_aliases(alias_norm)`,
    `CREATE INDEX IF NOT EXISTS idx_alias_ma_hang     ON product_aliases(ma_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_history_ma_hang   ON sales_history(ma_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_history_ma_kh     ON sales_history(ma_kh)`,
    `CREATE INDEX IF NOT EXISTS idx_history_ngay      ON sales_history(ngay_xuat)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_ngay       ON orders(ngay_tao)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_ma_kh      ON orders(ma_kh)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_trang_thai ON orders(trang_thai)`,
    `CREATE INDEX IF NOT EXISTS idx_detail_ma_hang    ON order_details(ma_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_product_ten       ON product_cache(ten_hang)`,
    `CREATE INDEX IF NOT EXISTS idx_customer_ten      ON customer_cache(ten_kh)`,

    // ── Hachi Navigation Engine V3 ─────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS data_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      source_type TEXT DEFAULT 'supplier',
      description TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 100,
      last_file_name TEXT DEFAULT '',
      last_import_at TEXT,
      last_import_rows INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS import_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_id INTEGER REFERENCES data_sources(id) ON DELETE SET NULL,
      sheet_name TEXT DEFAULT '',
      header_signature TEXT NOT NULL,
      header_row INTEGER DEFAULT 0,
      mapping_json TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(source_id, sheet_name, header_signature)
    )`,
    `CREATE TABLE IF NOT EXISTS source_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
      sheet_name TEXT DEFAULT '',
      source_row INTEGER DEFAULT 0,
      part_number TEXT DEFAULT '',
      part_number_norm TEXT DEFAULT '',
      name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      cost REAL DEFAULT 0,
      retail_price REAL DEFAULT 0,
      stock REAL DEFAULT 0,
      brand TEXT DEFAULT '',
      vehicle TEXT DEFAULT '',
      position TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      related_codes_json TEXT DEFAULT '[]',
      raw_json TEXT DEFAULT '{}',
      imported_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS part_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_code TEXT NOT NULL,
      from_code_norm TEXT NOT NULL,
      from_type TEXT DEFAULT 'KHAC',
      to_code TEXT NOT NULL,
      to_code_norm TEXT NOT NULL,
      to_type TEXT DEFAULT 'KHAC',
      relation_type TEXT DEFAULT 'RELATED',
      source_name TEXT DEFAULT '',
      source_record_id TEXT DEFAULT '',
      confirmed INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(from_code_norm, to_code_norm, relation_type, source_name)
    )`,
    `CREATE TABLE IF NOT EXISTS search_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_key TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_name TEXT DEFAULT '',
      record_type TEXT DEFAULT '',
      record_id TEXT DEFAULT '',
      primary_code TEXT DEFAULT '',
      primary_code_norm TEXT DEFAULT '',
      title TEXT DEFAULT '',
      subtitle TEXT DEFAULT '',
      search_text_norm TEXT DEFAULT '',
      tokens_json TEXT DEFAULT '[]',
      code_variants_json TEXT DEFAULT '[]',
      history_count INTEGER DEFAULT 0,
      history_qty REAL DEFAULT 0,
      stock_company REAL DEFAULT 0,
      stock_win REAL DEFAULT 0,
      cost_hint REAL DEFAULT 0,
      business_score REAL DEFAULT 0,
      payload_json TEXT DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS search_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_norm TEXT NOT NULL,
      document_key TEXT NOT NULL,
      document_id INTEGER DEFAULT 0,
      user_id TEXT DEFAULT '',
      click_count INTEGER DEFAULT 0,
      last_clicked_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(query_norm, document_key, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_source_records_part ON source_records(part_number_norm)`,
    `CREATE INDEX IF NOT EXISTS idx_source_records_source ON source_records(source_id)`,
    `CREATE INDEX IF NOT EXISTS idx_part_rel_from ON part_relations(from_code_norm)`,
    `CREATE INDEX IF NOT EXISTS idx_part_rel_to ON part_relations(to_code_norm)`,
    `CREATE INDEX IF NOT EXISTS idx_search_doc_code ON search_documents(primary_code_norm)`,
    `CREATE INDEX IF NOT EXISTS idx_search_doc_source ON search_documents(source_type, source_name)`,
    `CREATE INDEX IF NOT EXISTS idx_search_click_query ON search_interactions(query_norm)`,

    // ── Cache tồn kho tổng hợp ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS tonkho_cache (
      ma_hang     TEXT NOT NULL,
      ten_hang    TEXT DEFAULT '',
      kho         TEXT DEFAULT '',
      dvt         TEXT DEFAULT '',
      don_gia     REAL DEFAULT 0,
      don_gia_goc REAL DEFAULT 0,
      don_gia_vat_rate REAL DEFAULT 0,
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

    // ── Chấm công: tài khoản nhân viên (đăng nhập app mobile) ──────────────
    `CREATE TABLE IF NOT EXISTS employees (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_nv         TEXT UNIQUE NOT NULL,
      ho_ten        TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      chuc_vu       TEXT DEFAULT '',
      active        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now','localtime')),
      updated_at    TEXT DEFAULT (datetime('now','localtime'))
    )`,

    // ── Chấm công: token QR đang hiệu lực (random, đổi lúc 0h & 12h) ───────
    `CREATE TABLE IF NOT EXISTS attendance_qr_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token      TEXT UNIQUE NOT NULL,
      active     INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      expires_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_qr_tokens_active ON attendance_qr_tokens(active)`,

    // ── Chấm công: log giờ vào / giờ ra mỗi nhân viên mỗi ngày ─────────────
    `CREATE TABLE IF NOT EXISTS attendance_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      ngay        TEXT NOT NULL,
      gio_vao     TEXT,
      gio_ra      TEXT,
      token_vao   TEXT,
      token_ra    TEXT,
      created_at  TEXT DEFAULT (datetime('now','localtime')),
      updated_at  TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(employee_id, ngay)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_attendance_ngay ON attendance_logs(ngay)`,
    `CREATE INDEX IF NOT EXISTS idx_attendance_emp  ON attendance_logs(employee_id)`,
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
  // product_cache: bổ sung ĐVT (lấy từ MISA Unit.UnitName qua InventoryLedger.UnitID)
  // để OrderForm tự fill ĐVT khi chọn hàng từ dropdown — chỉ là cache SQLite của app.
  addColumnIfMissing('product_cache', 'dvt', "TEXT DEFAULT ''");
  // tonkho_cache: bổ sung đơn giá giao dịch mới nhất (đã cộng 8% VAT) để cột "Đơn giá"
  // ở Tồn kho tổng vẫn hiển thị đúng khi fallback sang cache lúc MISA offline.
  // CREATE TABLE mới đã có sẵn cột này, migration chỉ cần cho DB đang chạy trên VPS.
  addColumnIfMissing('tonkho_cache', 'don_gia', 'REAL DEFAULT 0');
  addColumnIfMissing('tonkho_cache', 'don_gia_goc', 'REAL DEFAULT 0');
  addColumnIfMissing('tonkho_cache', 'don_gia_vat_rate', 'REAL DEFAULT 0');

  // Mã ngoài: chuẩn hóa tìm kiếm, phân loại mã và lưu giá NCC hiện hành.
  addColumnIfMissing('ma_ngoai', 'ma_hang_norm', "TEXT DEFAULT ''");
  addColumnIfMissing('ma_ngoai', 'ma_ngoai_norm', "TEXT DEFAULT ''");
  addColumnIfMissing('ma_ngoai', 'loai_ma', "TEXT DEFAULT 'KHAC'");
  addColumnIfMissing('ma_ngoai', 'gia_dai_ly', 'REAL DEFAULT 0');
  addColumnIfMissing('ma_ngoai', 'gia_thung', 'REAL DEFAULT 0');
  addColumnIfMissing('ma_ngoai', 'sl_thung', 'REAL DEFAULT 0');
  addColumnIfMissing('ma_ngoai', 'stock_ncc', "TEXT DEFAULT ''");
  addColumnIfMissing('ma_ngoai', 'trang_thai', "TEXT DEFAULT 'da_xac_nhan'");
  addColumnIfMissing('ma_ngoai', 'updated_at', "TEXT DEFAULT ''");

  // Backfill trường chuẩn hóa cho dữ liệu cũ. SQLite không có regex nên chỉ
  // xử lý các ký tự phân cách phổ biến; API vẫn chuẩn hóa đầy đủ ở runtime.
  db.run(`UPDATE ma_ngoai SET
    ma_hang_norm = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ma_hang, '-', ''), '_', ''), '/', ''), '.', ''), ' ', '')),
    ma_ngoai_norm = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ma_ngoai, '-', ''), '_', ''), '/', ''), '.', ''), ' ', '')),
    loai_ma = CASE
      WHEN (loai_ma IS NULL OR loai_ma = '' OR loai_ma = 'KHAC') AND UPPER(nha_cc) LIKE '%ROTUYN%' THEN '555'
      WHEN loai_ma IS NULL OR loai_ma = '' THEN 'KHAC'
      ELSE loai_ma
    END,
    updated_at = CASE WHEN updated_at IS NULL OR updated_at = '' THEN datetime('now','localtime') ELSE updated_at END
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_ma_ngoai_norm ON ma_ngoai(ma_ngoai_norm)`);

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

  // Build navigation index persisted documents after migrations. Nếu dữ liệu raw chưa
  // được import thì bảng index vẫn hợp lệ nhưng rỗng.
  try {
    const { rebuildSearchDocuments } = require('./services/navigationIndex');
    rebuildSearchDocuments(db);
  } catch (error) {
    console.warn('⚠️ Navigation index chưa build được:', error.message);
  }

  saveDb(db);
  console.log('✅ SQLite database ready:', require('path').join(__dirname,'..','data','toa-hang.db'));
}

module.exports = { setupDatabase };
