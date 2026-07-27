const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chưa chọn file' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.find(name => /^(QLĐH|QLDH)$/i.test(String(name).trim())) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    if (!rows.length) return res.status(400).json({ error: 'File trống' });
    const db = await getDb();
    dbRun(db, `DELETE FROM sales_history`);
    let count = 0;
    for (const r of rows) {
      const ma_hang = String(r['MÃ HÀNG']||r['MA HANG']||r['Mã hàng']||'').trim();
      if (!ma_hang) continue;
      dbRun(db, `INSERT INTO sales_history (stt,ma_hang,hang_sx,mo_ta,dvt,so_luong,don_gia,thanh_tien,ten_kh,ma_kh,ngay_xuat,gia_von,nha_cc,ghi_chu) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r['STT']||0, ma_hang, r['HÃNG  SẢN XUẤT']||r['HÃNG SẢN XUẤT']||'', r['MÔ TẢ']||'', r['ĐVT']||'', parseFloat(r['SL'])||0, parseFloat(r['ĐƠN GIÁ'])||0, parseFloat(r['THÀNH TIỀN'])||0, r['TÊN KH']||'', r['MÃ KH']||'', r['NGÀY XUẤT HÀNG']||'', parseFloat(r['GIÁ VỐN'])||0, r['NHÀ CC']||'', r['GHI CHÚ']||'']);
      count++;
    }
    saveDb(db);
    res.json({ success: true, count, message: `Đã import ${count} dòng` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stats', async (req, res) => {
  try {
    const db  = await getDb();
    const row = dbGet(db, `SELECT COUNT(*) AS tong_dong, MAX(ngay_xuat) AS ngay_moi_nhat, MIN(ngay_xuat) AS ngay_cu_nhat FROM sales_history`);
    db.close();
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:ma_hang', async (req, res) => {
  try {
    const db  = await getDb();
    const ma  = req.params.ma_hang;
    const ban   = dbQuery(db, `SELECT ngay_xuat,ten_kh,ma_kh,so_luong,don_gia,thanh_tien,gia_von,nha_cc,ghi_chu FROM sales_history WHERE ma_hang=$m ORDER BY ngay_xuat DESC,stt DESC LIMIT 100`, { $m: ma });
    const stats = dbGet(db,  `SELECT COUNT(*) AS so_lan_ban, SUM(so_luong) AS tong_so_luong, AVG(don_gia) AS gia_tb, MAX(don_gia) AS gia_cao_nhat, MAX(ngay_xuat) AS lan_ban_cuoi FROM sales_history WHERE ma_hang=$m`, { $m: ma });
    const toa   = dbQuery(db, `SELECT o.ngay_tao,o.ten_kh,o.ma_toa,d.so_luong,d.don_gia_ban,d.so_luong*d.don_gia_ban AS thanh_tien FROM order_details d JOIN orders o ON o.id=d.order_id WHERE d.ma_hang=$m AND o.trang_thai!='Đã hủy' ORDER BY o.ngay_tao DESC LIMIT 50`, { $m: ma });
    db.close();
    res.json({ ban, stats, toa });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
