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
function requireEmployee(req, res, next) {
  if (!req.user || !req.user.employeeId) {
    return res.status(403).json({ error: 'Chỉ tài khoản nhân viên mới quét được' });
  }
  next();
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

// ─── POST /attendance/scan — nhân viên quét QR chấm công ─────────────────────
// Lần quét đầu trong ngày = giờ vào, lần quét thứ 2 cùng ngày = giờ ra.
router.post('/scan', requireEmployee, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Thiếu mã QR' });

    const db = await getDb();
    if (!isTokenValid(db, token)) {
      db.close();
      return res.status(400).json({ error: 'Mã QR đã hết hạn, vui lòng quét lại mã đang hiển thị' });
    }

    const employeeId = req.user.employeeId;
    const ngay = todayStr();
    const now  = nowStr();
    const row = dbGet(db, `SELECT * FROM attendance_logs WHERE employee_id = ? AND ngay = ?`, [employeeId, ngay]);

    if (!row) {
      dbRun(db, `INSERT INTO attendance_logs (employee_id, ngay, gio_vao, token_vao) VALUES (?, ?, ?, ?)`,
        [employeeId, ngay, now, token]);
      saveDb(db);
      return res.json({ ok: true, type: 'vao', time: now });
    }

    if (!row.gio_vao) {
      dbRun(db, `UPDATE attendance_logs SET gio_vao = ?, token_vao = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [now, token, row.id]);
      saveDb(db);
      return res.json({ ok: true, type: 'vao', time: now });
    }

    if (!row.gio_ra) {
      dbRun(db, `UPDATE attendance_logs SET gio_ra = ?, token_ra = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
        [now, token, row.id]);
      saveDb(db);
      return res.json({ ok: true, type: 'ra', time: now });
    }

    db.close();
    return res.status(409).json({ error: `Hôm nay đã chấm công đủ giờ vào (${row.gio_vao}) và giờ ra (${row.gio_ra})` });
  } catch (err) {
    console.error('❌ Lỗi chấm công:', err.message);
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

function buildSummary(rows) {
  const byEmployee = new Map();
  for (const r of rows) {
    if (!byEmployee.has(r.employee_id)) {
      byEmployee.set(r.employee_id, {
        employee_id: r.employee_id, ma_nv: r.ma_nv, ho_ten: r.ho_ten,
        so_ngay_cong: 0, so_ngay_thieu_cham: 0, tong_gio: 0,
      });
    }
    const s = byEmployee.get(r.employee_id);
    if (r.gio_vao && r.gio_ra) {
      s.so_ngay_cong += 1;
      s.tong_gio += hoursBetween(r.gio_vao, r.gio_ra);
    } else if (r.gio_vao || r.gio_ra) {
      s.so_ngay_thieu_cham += 1;
    }
  }
  return Array.from(byEmployee.values()).map((s) => ({ ...s, tong_gio: Math.round(s.tong_gio * 100) / 100 }));
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
    res.json(buildSummary(rows));
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
    res.json(rows);
  } catch (err) {
    console.error('❌ Lỗi chi tiết chấm công:', err.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── GET /attendance/export?type=summary|detail — xuất Excel ────────────────
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const { type = 'summary' } = req.query;
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
        { header: 'Giờ vào', key: 'gio_vao', width: 20 },
        { header: 'Giờ ra', key: 'gio_ra', width: 20 },
      ];
      rows.forEach((r) => ws.addRow({ ngay: r.ngay, ma_nv: r.ma_nv, ho_ten: r.ho_ten, gio_vao: r.gio_vao || '', gio_ra: r.gio_ra || '' }));
    } else {
      const summary = buildSummary(rows);
      ws.columns = [
        { header: 'Mã NV', key: 'ma_nv', width: 12 },
        { header: 'Họ tên', key: 'ho_ten', width: 24 },
        { header: 'Số ngày công', key: 'so_ngay_cong', width: 14 },
        { header: 'Số ngày thiếu chấm', key: 'so_ngay_thieu_cham', width: 18 },
        { header: 'Tổng giờ', key: 'tong_gio', width: 12 },
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
