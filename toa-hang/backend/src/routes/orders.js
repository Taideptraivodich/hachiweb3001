const express = require('express');
const router  = express.Router();
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');

function generateOrderCode(db, dateStr) {
  const [y, m, d] = dateStr.split('-');
  const suffix = `${d}${m}${y.slice(-2)}`;
  const cnt = dbGet(db, `SELECT COUNT(*) AS cnt FROM orders WHERE ngay_tao = $d`, { $d: dateStr });
  return `${String((cnt?.cnt || 0) + 1).padStart(2,'0')}.${suffix}`;
}

// Mã đơn chuẩn (gửi khách / in phiếu / export Excel), suy từ ma_toa "NN.DDMMYY" → "DDMMYYHCNN"
// Ví dụ: "06.230626" → "230626HC06". Nếu ma_toa không theo pattern chuẩn (vd nhập tay tự do),
// trả về '' để user tự nhập/sửa tay — không đoán bừa.
function maDonFromMaToa(ma_toa) {
  const m = String(ma_toa || '').match(/^(\d{1,2})\.(\d{6})$/);
  if (!m) return '';
  const [, seq, ddmmyy] = m;
  return `${ddmmyy}HC${seq.padStart(2,'0')}`;
}

router.get('/next-code', async (req, res) => {
  try {
    const db   = await getDb();
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const code = generateOrderCode(db, date);
    db.close();
    res.json({ code, ma_don: maDonFromMaToa(code) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const { q, status, from, to, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    let where = ['1=1'], params = {};
    if (q)      { where.push(`(o.ma_toa LIKE $q OR o.ten_kh LIKE $q OR o.ma_kh LIKE $q)`); params.$q = `%${q}%`; }
    if (status) { where.push(`o.trang_thai = $status`); params.$status = status; }
    if (from)   { where.push(`o.ngay_tao >= $from`);   params.$from = from; }
    if (to)     { where.push(`o.ngay_tao <= $to`);     params.$to = to; }
    const whereStr = where.join(' AND ');
    const total = dbGet(db, `SELECT COUNT(*) AS cnt FROM orders o WHERE ${whereStr}`, params);
    const rows  = dbQuery(db, `SELECT o.id, o.ma_toa, o.ma_don, o.ngay_tao, o.ma_kh, o.ten_kh, o.sdt, o.dia_chi, o.noi_gui_hang, o.ghi_chu, o.trang_thai, o.created_at, (SELECT COUNT(*) FROM order_details d WHERE d.order_id=o.id) AS so_dong, (SELECT COALESCE(SUM(d.so_luong*d.don_gia_ban),0) FROM order_details d WHERE d.order_id=o.id) AS tong_tien FROM orders o WHERE ${whereStr} ORDER BY o.created_at DESC LIMIT $limit OFFSET $offset`,
      { ...params, $limit: parseInt(limit), $offset: offset });
    db.close();
    res.json({ data: rows, total: total?.cnt || 0, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Export: trả flat rows join orders + order_details, theo filter, không phân trang
router.get('/export-data', async (req, res) => {
  try {
    const db = await getDb();
    const { q, status, from, to } = req.query;
    let where = ['1=1'], params = {};
    if (q)      { where.push(`(o.ma_toa LIKE $q OR o.ten_kh LIKE $q OR o.ma_kh LIKE $q)`); params.$q = `%${q}%`; }
    if (status) { where.push(`o.trang_thai = $status`); params.$status = status; }
    if (from)   { where.push(`o.ngay_tao >= $from`);   params.$from = from; }
    if (to)     { where.push(`o.ngay_tao <= $to`);     params.$to = to; }
    const whereStr = where.join(' AND ');
    const rows = dbQuery(db,
      `SELECT
        o.ma_don, o.ma_kh, o.ten_kh,
        o.ghi_chu AS ghi_chu_phieu,
        o.created_at, o.updated_at,
        d.ma_hang, d.ten_hang, d.ten_hang_hien_thi,
        d.hang_san_xuat, d.nha_cung_cap, d.dvt,
        d.gia_von, d.don_gia_ban, d.so_luong,
        d.ghi_chu AS ghi_chu_dong
      FROM orders o
      JOIN order_details d ON d.order_id = o.id
      WHERE ${whereStr}
      ORDER BY o.created_at DESC, o.id, d.sort_order, d.id`,
      params
    );
    db.close();
    res.json({ data: rows, total: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:ma_toa', async (req, res) => {
  try {
    const db    = await getDb();
    const order = dbGet(db, `SELECT * FROM orders WHERE ma_toa = $m`, { $m: req.params.ma_toa });
    if (!order) { db.close(); return res.status(404).json({ error: 'Không tìm thấy toa' }); }
    const details = dbQuery(db, `SELECT * FROM order_details WHERE order_id = $id ORDER BY sort_order, id`, { $id: order.id });
    db.close();
    res.json({ ...order, details });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const db = await getDb();
    const { ma_toa, ma_don, ngay_tao, ma_kh, ten_kh, sdt, dia_chi, noi_gui_hang, ghi_chu, details = [] } = req.body;
    if (!details.length) { db.close(); return res.status(400).json({ error: 'Chưa có mặt hàng nào' }); }
    const date      = ngay_tao || new Date().toISOString().slice(0,10);
    const finalCode = ma_toa || generateOrderCode(db, date);
    if (dbGet(db, `SELECT id FROM orders WHERE ma_toa = $m`, { $m: finalCode })) { db.close(); return res.status(409).json({ error: 'Mã toa đã tồn tại' }); }
    const finalMaDon = (ma_don && ma_don.trim()) || maDonFromMaToa(finalCode);
    dbRun(db, `INSERT INTO orders (ma_toa,ma_don,ngay_tao,ma_kh,ten_kh,sdt,dia_chi,noi_gui_hang,ghi_chu) VALUES (?,?,?,?,?,?,?,?,?)`, [finalCode,finalMaDon,date,ma_kh||'',ten_kh||'',sdt||'',dia_chi||'',noi_gui_hang||'',ghi_chu||'']);
    const orderId = dbGet(db, `SELECT id FROM orders WHERE ma_toa = $m`, { $m: finalCode }).id;
    details.forEach((d,i) => dbRun(db, `INSERT INTO order_details (order_id,ma_hang,ten_hang,ten_hang_hien_thi,kho,ton_kho_luc,gia_von,so_luong,don_gia_ban,hang_san_xuat,nha_cung_cap,dvt,ghi_chu,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [orderId,d.ma_hang||'',d.ten_hang||'',d.ten_hang_hien_thi||d.ten_hang||'',d.kho||'',d.ton_kho||0,d.gia_von||0,d.so_luong,d.don_gia_ban||0,d.hang_san_xuat||'',d.nha_cung_cap||'',d.dvt||'',d.ghi_chu||'',i]));
    saveDb(db);
    res.json({ success: true, ma_toa: finalCode, ma_don: finalMaDon, id: orderId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:ma_toa', async (req, res) => {
  try {
    const db    = await getDb();
    const order = dbGet(db, `SELECT * FROM orders WHERE ma_toa = $m`, { $m: req.params.ma_toa });
    if (!order) { db.close(); return res.status(404).json({ error: 'Không tìm thấy toa' }); }
    if (order.trang_thai === 'Đã hủy') { db.close(); return res.status(400).json({ error: 'Không thể sửa toa đã hủy' }); }
    const { ma_kh, ten_kh, sdt, dia_chi, noi_gui_hang, ghi_chu, ma_don, details = [] } = req.body;
    const finalMaDon = (ma_don && ma_don.trim()) || order.ma_don || maDonFromMaToa(order.ma_toa);
    dbRun(db, `UPDATE orders SET ma_kh=?,ten_kh=?,sdt=?,dia_chi=?,noi_gui_hang=?,ghi_chu=?,ma_don=?,updated_at=datetime('now','localtime') WHERE id=?`, [ma_kh||'',ten_kh||'',sdt||'',dia_chi||'',noi_gui_hang||'',ghi_chu||'',finalMaDon,order.id]);
    dbRun(db, `DELETE FROM order_details WHERE order_id=?`, [order.id]);
    details.forEach((d,i) => dbRun(db, `INSERT INTO order_details (order_id,ma_hang,ten_hang,ten_hang_hien_thi,kho,ton_kho_luc,gia_von,so_luong,don_gia_ban,hang_san_xuat,nha_cung_cap,dvt,ghi_chu,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [order.id,d.ma_hang||'',d.ten_hang||'',d.ten_hang_hien_thi||d.ten_hang||'',d.kho||'',d.ton_kho||0,d.gia_von||0,d.so_luong,d.don_gia_ban||0,d.hang_san_xuat||'',d.nha_cung_cap||'',d.dvt||'',d.ghi_chu||'',i]));
    saveDb(db);
    res.json({ success: true, ma_don: finalMaDon });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:ma_toa/status', async (req, res) => {
  try {
    const db = await getDb();
    const { trang_thai } = req.body;
    if (!['Đang xử lý','Đã hoàn thành','Đã hủy'].includes(trang_thai)) { db.close(); return res.status(400).json({ error: 'Trạng thái không hợp lệ' }); }
    dbRun(db, `UPDATE orders SET trang_thai=?,updated_at=datetime('now','localtime') WHERE ma_toa=?`, [trang_thai,req.params.ma_toa]);
    saveDb(db);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:ma_toa', async (req, res) => {
  try {
    const db = await getDb();
    const order = dbGet(db, `SELECT * FROM orders WHERE ma_toa = $m`, { $m: req.params.ma_toa });
    if (!order) { db.close(); return res.status(404).json({ error: 'Không tìm thấy toa' }); }
    dbRun(db, `DELETE FROM order_details WHERE order_id=?`, [order.id]);
    dbRun(db, `DELETE FROM orders WHERE id=?`, [order.id]);
    saveDb(db);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
module.exports = router;
