const express  = require('express');
const ExcelJS  = require('exceljs');
const router   = express.Router();
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');
const { isTokenValid, ensureActiveToken } = require('../services/attendance_qr');

function requireAdmin(req, res, next) {
  if (req.user && req.user.employeeId) {
    return res.status(403).json({ error: 'Chỉ admin mới có quyền này' });
  }
  next();
}
async function requireEmployee(req, res, next) {
  if (!req.user || !req.user.employeeId) {
    return res.status(403).json({ error: 'Chỉ tài khoản nhân viên mới quét được' });
  }
  // Token nhân viên có hạn rất dài nên phải kiểm tra tài khoản còn hoạt động
  // (admin khoá/xoá nhân viên là có hiệu lực ngay).
  try {
    const db = await getDb();
    const emp = dbGet(db, `SELECT id, active FROM employees WHERE id = ?`, [req.user.employeeId]);
    db.close();
    if (!emp || !emp.active) {
      return res.status(403).json({ error: 'Tài khoản đã bị khoá hoặc không còn tồn tại, liên hệ quản trị viên' });
    }
    next();
  } catch (err) {
    console.error('❌ Lỗi kiểm tra tài khoản nhân viên:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Lần chấm đầu trong ngày = giờ vào, lần thứ 2 = giờ ra. Lần thứ 2 phải cách
// giờ vào tối thiểu MIN_GAP_PHUT để tránh bấm đúp nhầm thành giờ ra.
const MIN_GAP_PHUT = 30;
function recordCheckin(db, employeeId, source, extra = {}) {
  const ngay = todayStr();
  const now  = nowStr();
  const row = dbGet(db, `SELECT * FROM attendance_logs WHERE employee_id = ? AND ngay = ?`, [employeeId, ngay]);

  if (!row) {
    dbRun(db, `INSERT INTO attendance_logs (employee_id, ngay, gio_vao, token_vao) VALUES (?, ?, ?, ?)`,
      [employeeId, ngay, now, source]);
    saveDb(db);
    return { status: 200, body: { ok: true, type: 'vao', time: now, ...extra } };
  }
  if (!row.gio_vao) {
    dbRun(db, `UPDATE attendance_logs SET gio_vao = ?, token_vao = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [now, source, row.id]);
    saveDb(db);
    return { status: 200, body: { ok: true, type: 'vao', time: now, ...extra } };
  }
  if (!row.gio_ra) {
    const gapMin = (new Date(now.replace(' ', 'T')) - new Date(row.gio_vao.replace(' ', 'T'))) / 60000;
    if (gapMin < MIN_GAP_PHUT) {
      db.close();
      return { status: 409, body: { error: `Bạn vừa chấm công vào lúc ${row.gio_vao.slice(11, 16)}. Giờ ra chỉ chấm được sau ${MIN_GAP_PHUT} phút.` } };
    }
    dbRun(db, `UPDATE attendance_logs SET gio_ra = ?, token_ra = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [now, source, row.id]);
    saveDb(db);
    return { status: 200, body: { ok: true, type: 'ra', time: now, ...extra } };
  }
  db.close();
  return { status: 409, body: { error: `Hôm nay đã chấm công đủ: vào ${row.gio_vao.slice(11, 16)}, ra ${row.gio_ra.slice(11, 16)}` } };
}

// ─── POST /attendance/scan — nhân viên quét QR chấm công ─────────────────────
router.post('/scan', requireEmployee, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Thiếu mã QR' });

    const db = await getDb();
    if (!isTokenValid(db, token)) {
      db.close();
      return res.status(400).json({ error: 'Mã QR đã hết hạn, vui lòng quét lại mã đang hiển thị' });
    }

    const out = recordCheckin(db, req.user.employeeId, token);
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('❌ Lỗi chấm công:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── POST /attendance/checkin-gps — nhân viên chấm công bằng định vị GPS ─────
// Cấu hình trong backend/.env:
//   COMPANY_LAT=..  COMPANY_LNG=..  COMPANY_RADIUS_M=150 (mét, mặc định 150)
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

router.post('/checkin-gps', requireEmployee, async (req, res) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: 'Không đọc được vị trí, thử lại' });
    }

    const cLat = Number(process.env.COMPANY_LAT);
    const cLng = Number(process.env.COMPANY_LNG);
    const radius = Number(process.env.COMPANY_RADIUS_M) || 150;
    if (!process.env.COMPANY_LAT || !process.env.COMPANY_LNG || !Number.isFinite(cLat) || !Number.isFinite(cLng)) {
      console.error('❌ Chưa cấu hình COMPANY_LAT / COMPANY_LNG trong .env');
      return res.status(500).json({ error: 'Server chưa cấu hình vị trí công ty, báo quản trị viên' });
    }

    const dist = Math.round(distanceMeters(lat, lng, cLat, cLng));
    if (dist > radius) {
      return res.status(403).json({ error: `Bạn đang cách công ty khoảng ${dist}m (cho phép trong ${radius}m). Hãy đến công ty rồi chấm công.` });
    }

    const db = await getDb();
    const out = recordCheckin(db, req.user.employeeId, 'gps', { distance: dist });
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('❌ Lỗi chấm công GPS:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── GET /attendance/qr/current — admin xem token hiện tại (màn hình kiosk khi đã đăng nhập admin) ──
router.get('/qr/current', requireAdmin, async (req, res) => {
  try {
    const current = await ensureActiveToken();
    res.json(current);
  } catch (err) {
    console.error('❌ Lỗi lấy QR token:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

function hoursBetween(vao, ra) {
  if (!vao || !ra) return 0;
  const a = new Date(vao.replace(' ', 'T'));
  const b = new Date(ra.replace(' ', 'T'));
  const diff = (b - a) / 1000 / 3600;
  return diff > 0 ? diff : 0;
}

// Giờ hành chính dạng "HH:mm" (mặc định 08:00)
function parseGioHC(v) {
  return /^\d{1,2}:\d{2}$/.test(v || '') ? v : '08:00';
}
// Số phút vào trễ so với giờ hành chính (0 nếu đúng giờ/sớm hoặc chưa chấm)
function lateMinutes(gioVao, gioHC) {
  if (!gioVao) return 0;
  const [ngay, gio] = gioVao.split(' ');
  const [h, m] = (gio || '').split(':').map(Number);
  const [hh, hm] = gioHC.split(':').map(Number);
  if ([h, m, hh, hm].some(Number.isNaN)) return 0;
  const diff = (h * 60 + m) - (hh * 60 + hm);
  return diff > 0 ? diff : 0;
}
// Số phút ra sớm so với giờ ra tiêu chuẩn (0 nếu ra đúng giờ/muộn hoặc chưa chấm ra)
function earlyMinutes(gioRa, gioRaHC) {
  if (!gioRa) return 0;
  const [, gio] = gioRa.split(' ');
  const [h, m] = (gio || '').split(':').map(Number);
  const [hh, hm] = gioRaHC.split(':').map(Number);
  if ([h, m, hh, hm].some(Number.isNaN)) return 0;
  const diff = (hh * 60 + hm) - (h * 60 + m);
  return diff > 0 ? diff : 0;
}
function parseGioRaHC(v) {
  return /^\d{1,2}:\d{2}$/.test(v || '') ? v : '17:00';
}
function addLate(rows, gioHC, gioRaHC = '17:00') {
  return rows.map((r) => ({
    ...r,
    phut_tre: lateMinutes(r.gio_vao, gioHC),
    phut_ra_som: earlyMinutes(r.gio_ra, gioRaHC),
  }));
}

function buildSummary(rows, gioHC = '08:00', gioRaHC = '17:00') {
  const byEmployee = new Map();
  for (const r of rows) {
    if (!byEmployee.has(r.employee_id)) {
      byEmployee.set(r.employee_id, {
        employee_id: r.employee_id, ma_nv: r.ma_nv, ho_ten: r.ho_ten,
        so_ngay_cong: 0,
        so_lan_tre: 0, tong_phut_tre: 0,
        so_lan_ra_som: 0, tong_phut_ra_som: 0,
      });
    }
    const s = byEmployee.get(r.employee_id);
    const tre = lateMinutes(r.gio_vao, gioHC);
    if (tre > 0) { s.so_lan_tre += 1; s.tong_phut_tre += tre; }
    const som = earlyMinutes(r.gio_ra, gioRaHC);
    if (som > 0) { s.so_lan_ra_som += 1; s.tong_phut_ra_som += som; }
    if (r.gio_vao) s.so_ngay_cong += 1;
  }
  return Array.from(byEmployee.values());
}

async function queryLogs(db, { tu_ngay, den_ngay, employee_id }) {
  const conditions = [];
  const params = [];
  if (tu_ngay)  { conditions.push('al.ngay >= ?'); params.push(tu_ngay); }
  if (den_ngay) { conditions.push('al.ngay <= ?'); params.push(den_ngay); }
  if (employee_id) { conditions.push('al.employee_id = ?'); params.push(employee_id); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return dbQuery(db, `
    SELECT al.*, e.ma_nv, e.ho_ten
    FROM attendance_logs al
    JOIN employees e ON e.id = al.employee_id
    ${where}
    ORDER BY al.ngay, e.ho_ten
  `, params);
}

// ─── GET /attendance/summary — bảng tổng hợp theo từng nhân viên ─────────────
router.get('/summary', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryLogs(db, req.query);
    db.close();
    res.json(buildSummary(rows, parseGioHC(req.query.gio_hc), parseGioRaHC(req.query.gio_ra_hc)));
  } catch (err) {
    console.error('❌ Lỗi thống kê chấm công:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── GET /attendance/detail — log chi tiết (lọc theo employee_id nếu có) ─────
router.get('/detail', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await queryLogs(db, req.query);
    db.close();
    res.json(addLate(rows, parseGioHC(req.query.gio_hc), parseGioRaHC(req.query.gio_ra_hc)));
  } catch (err) {
    console.error('❌ Lỗi chi tiết chấm công:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── GET /attendance/export?type=summary|detail — xuất Excel ────────────────
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const { type = 'summary' } = req.query;
    const gioHC = parseGioHC(req.query.gio_hc);
    const gioRaHC = parseGioRaHC(req.query.gio_ra_hc);
    const db = await getDb();
    const rows = await queryLogs(db, req.query);
    db.close();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(type === 'detail' ? 'Chi tiết chấm công' : 'Tổng hợp chấm công');

    if (type === 'detail') {
      ws.columns = [
        { header: 'Ngày', key: 'ngay', width: 12 },
        { header: 'Mã NV', key: 'ma_nv', width: 12 },
        { header: 'Họ tên', key: 'ho_ten', width: 24 },
        { header: 'Giờ vào', key: 'gio_vao', width: 10 },
        { header: 'Phút vào trễ', key: 'phut_tre', width: 14 },
        { header: 'Giờ ra', key: 'gio_ra', width: 10 },
        { header: 'Phút ra sớm', key: 'phut_ra_som', width: 14 },
      ];
      const hm = (v) => (v ? v.split(' ')[1].slice(0, 5) : '');
      addLate(rows, gioHC, gioRaHC).forEach((r) => ws.addRow({
        ngay: r.ngay, ma_nv: r.ma_nv, ho_ten: r.ho_ten,
        gio_vao: hm(r.gio_vao), phut_tre: r.phut_tre,
        gio_ra: hm(r.gio_ra), phut_ra_som: r.phut_ra_som,
      }));
    } else {
      const summary = buildSummary(rows, gioHC, gioRaHC);
      ws.columns = [
        { header: 'Mã NV', key: 'ma_nv', width: 12 },
        { header: 'Họ tên', key: 'ho_ten', width: 24 },
        { header: 'Số ngày công', key: 'so_ngay_cong', width: 14 },
        { header: 'Số lần đi trễ', key: 'so_lan_tre', width: 14 },
        { header: 'Tổng phút trễ', key: 'tong_phut_tre', width: 14 },
        { header: 'Số lần ra sớm', key: 'so_lan_ra_som', width: 14 },
        { header: 'Tổng phút ra sớm', key: 'tong_phut_ra_som', width: 16 },
      ];
      summary.forEach((s) => ws.addRow(s));
    }
    ws.getRow(1).font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `Cham cong ${type === 'detail' ? 'chi tiet' : 'tong hop'} ${todayStr()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('❌ Lỗi xuất Excel chấm công:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;
