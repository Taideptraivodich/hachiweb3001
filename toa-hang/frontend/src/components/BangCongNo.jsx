import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas-pro';
import {
  Button, Select, DatePicker, Input, InputNumber, Space, Tag, Tooltip,
  message, Spin, Modal, Popconfirm, Empty, Badge, Alert, Divider, Typography,
  Table, Upload,
} from 'antd';
import {
  UploadOutlined, SaveOutlined, FolderOpenOutlined, PlusOutlined,
  DeleteOutlined, EditOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  CloseCircleOutlined, ReloadOutlined, FileExcelOutlined, HistoryOutlined,
  CameraOutlined, DownloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { formatMoney } from '../utils';

dayjs.locale('vi');

const api = axios.create({ baseURL: '/api' });

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtVND(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return <span>{formatMoney(n)}&nbsp;đ</span>;
}
function fmtVNDRaw(n) {
  n = Math.round(Number(n) || 0);
  return n === 0 ? '' : formatMoney(n);
}

// Normalize tên để so sánh fuzzy
function normName(s) {
  return (s || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D').replace(/đ/g, 'D')
    .trim();
}

// Parse ngày từ mã đơn "010626HC01" → "2026-06-01"
function parseDateFromCode(code) {
  if (!code || code.length < 6) return null;
  const dd = code.slice(0, 2), mm = code.slice(2, 4), yy = code.slice(4, 6);
  const year = parseInt(yy, 10) + 2000;
  const d = dayjs(`${year}-${mm}-${dd}`, 'YYYY-MM-DD');
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

// Parse ngày từ nhiều format
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return dayjs(v).format('YYYY-MM-DD');
  const s = String(v).trim();
  // "17/06/2026 09:23" hoặc "17/06/2026"
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function calcSummaryFromDraft(draft) {
  const dau_ky = (draft.dau_ky_rows || []).filter(r => !r.deleted)
    .reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);
  const tong_ps = (draft.phat_sinh_rows || []).filter(r => !r.deleted)
    .reduce((s, r) => s + Math.round(Number(r.final_amount) || 0), 0);
  const tong_tt = (draft.thanh_toan_rows || []).filter(r => !r.deleted)
    .reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);
  const tong_dieu_chinh_tang = (draft.dieu_chinh_rows || [])
    .filter(r => !r.deleted && r.direction === 'tang')
    .reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);
  const tong_dieu_chinh_giam = (draft.dieu_chinh_rows || [])
    .filter(r => !r.deleted && r.direction === 'giam')
    .reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);
  const cuoi_ky_app = dau_ky + tong_ps + tong_dieu_chinh_tang - tong_tt - tong_dieu_chinh_giam;
  return { dau_ky, tong_ps, tong_tt, tong_dieu_chinh_tang, tong_dieu_chinh_giam, cuoi_ky_app };
}

// "Công nợ tháng X mang sang" — tính theo tháng TRƯỚC tháng bắt đầu của kỳ.
// PHẢI khớp 100% với hàm getDauKyLabel ở backend (export_bang_cong_no.js).
function getDauKyLabel(tuNgay) {
  const m = tuNgay ? String(tuNgay).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (!m) return 'Công nợ kỳ trước mang sang';
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  let prevMonth = month - 1;
  let prevYear = year;
  if (prevMonth === 0) { prevMonth = 12; prevYear = year - 1; }
  return prevYear !== year
    ? `Công nợ tháng ${prevMonth}/${prevYear} mang sang`
    : `Công nợ tháng ${prevMonth} mang sang`;
}

// Build dữ liệu preview cho bảng gửi khách — cùng logic nhóm-theo-ngày/subtotal/tổng
// VÀ cùng logic áp đối trừ (accepted/manual) với backend (export_bang_cong_no.js)
// để ảnh chụp Zalo và file Excel khớp nhau.
function buildPreviewData(draft, meta) {
  const allocations = draft.allocations || [];
  const tuNgay = meta.tu_ngay || draft?.meta?.tu_ngay;

  const committedForTarget = (type, id) => allocations
    .filter(a => (a.status === 'accepted' || a.status === 'manual') && a.target_type === type && a.target_id === id)
    .reduce((s, a) => s + Math.round(Number(a.amount) || 0), 0);
  const committedForPayment = (paymentId) => allocations
    .filter(a => (a.status === 'accepted' || a.status === 'manual') && a.payment_id === paymentId)
    .reduce((s, a) => s + Math.round(Number(a.amount) || 0), 0);

  const phatSinh = (draft.phat_sinh_rows || [])
    .filter(r => !r.deleted && r.export_visible !== false)
    .map(r => {
      const original = Math.round(Number(r.sl) || 0) * Math.round(Number(r.don_gia) || 0);
      const remaining = Math.max(0, original - committedForTarget('phat_sinh', r.id));
      return { ...r, _remaining: remaining };
    })
    .filter(r => r._remaining > 0);

  const dauKy = (draft.dau_ky_rows || [])
    .filter(r => !r.deleted)
    .map(r => {
      const original = Math.round(Number(r.so_tien) || 0);
      const remaining = Math.max(0, original - committedForTarget('dau_ky', r.id));
      return { ...r, _remaining: remaining };
    })
    .filter(r => r._remaining > 0);

  const thanhToan = (draft.thanh_toan_rows || [])
    .filter(r => !r.deleted)
    .map(r => {
      const original = Math.round(Number(r.so_tien) || 0);
      const remaining = Math.max(0, original - committedForPayment(r.id));
      return { ...r, _remaining: remaining };
    })
    .filter(r => r._remaining > 0);

  const dieuChinh = (draft.dieu_chinh_rows || [])
    .filter(r => !r.deleted)
    .map(r => {
      const original = Math.round(Number(r.so_tien) || 0);
      if (r.direction === 'tang') {
        const remaining = Math.max(0, original - committedForTarget('dieu_chinh', r.id));
        return { ...r, _remaining: remaining };
      }
      return { ...r, _remaining: original };
    })
    .filter(r => r._remaining > 0);

  const byDate = {};
  const order = [];
  phatSinh.forEach(r => {
    const key = r.ngay || '';
    if (!byDate[key]) { byDate[key] = []; order.push(key); }
    byDate[key].push(r);
  });
  order.sort((a, b) => a.localeCompare(b));

  const groups = order.map(date => {
    const rows = byDate[date];
    const subtotal = rows.reduce((s, r) => s + r._remaining, 0);
    return { date, rows, subtotal };
  });

  const tongPhatSinh = groups.reduce((s, g) => s + g.subtotal, 0);

  const summaryLines = [];
  dauKy.forEach(r => summaryLines.push({ label: getDauKyLabel(tuNgay), amount: r._remaining, sign: 1 }));
  thanhToan.forEach(r => summaryLines.push({
    label: r.ngay ? `Thanh toán ngày ${dayjs(r.ngay).format('DD/MM/YYYY')}` : (r.mo_ta || 'Thanh toán'),
    amount: r._remaining, sign: -1,
  }));
  dieuChinh.forEach(r => {
    const isTang = r.direction === 'tang';
    summaryLines.push({
      label: `${isTang ? 'Điều chỉnh tăng' : 'Điều chỉnh giảm'}${r.mo_ta ? ' — ' + r.mo_ta : ''}`,
      amount: r._remaining, sign: isTang ? 1 : -1,
    });
  });

  const congNoConPhaiThanhToan = tongPhatSinh + summaryLines.reduce((s, l) => s + l.sign * l.amount, 0);

  return {
    tieuDe: meta.tieu_de || meta.ten_kh || 'BẢNG CÔNG NỢ',
    denNgay: meta.den_ngay || '',
    groups,
    tongPhatSinh,
    summaryLines,
    congNoConPhaiThanhToan,
  };
}



// ─── Phase 3: Gợi ý đối trừ thanh toán ──────────────────────────────────────
// Danh sách khoản nợ theo thứ tự ưu tiên FIFO: đầu kỳ → phát sinh (ngày tăng dần) → điều chỉnh tăng (ngày tăng dần)
function buildDebtQueue(draft) {
  const dauKy = (draft.dau_ky_rows || [])
    .filter(r => !r.deleted && Math.round(Number(r.so_tien) || 0) > 0)
    .map(r => ({ target_type: 'dau_ky', target_id: r.id, amount: Math.round(Number(r.so_tien) || 0) }));
  const phatSinh = (draft.phat_sinh_rows || [])
    .filter(r => !r.deleted && Math.round(Number(r.final_amount) || 0) > 0)
    .map(r => ({ target_type: 'phat_sinh', target_id: r.id, ngay: r.ngay || '', amount: Math.round(Number(r.final_amount) || 0) }))
    .sort((a, b) => (a.ngay || '').localeCompare(b.ngay || ''));
  const dieuChinhTang = (draft.dieu_chinh_rows || [])
    .filter(r => !r.deleted && r.direction === 'tang' && Math.round(Number(r.so_tien) || 0) > 0)
    .map(r => ({ target_type: 'dieu_chinh', target_id: r.id, ngay: r.ngay || '', amount: Math.round(Number(r.so_tien) || 0) }))
    .sort((a, b) => (a.ngay || '').localeCompare(b.ngay || ''));
  return [...dauKy, ...phatSinh, ...dieuChinhTang];
}

// Danh sách thanh toán theo ngày tăng dần
function buildPaymentQueue(draft) {
  return (draft.thanh_toan_rows || [])
    .filter(r => !r.deleted && Math.round(Number(r.so_tien) || 0) > 0)
    .map(r => ({ id: r.id, ngay: r.ngay || '', amount: Math.round(Number(r.so_tien) || 0) }))
    .sort((a, b) => (a.ngay || '').localeCompare(b.ngay || ''));
}

// Tạo gợi ý đối trừ mới cho phần CHƯA được đối trừ (accepted/manual),
// giữ nguyên các allocation đã accepted/ignored/manual.
function generateAllocationSuggestions(draft) {
  const existing  = draft.allocations || [];
  const kept      = existing.filter(a => a.status !== 'suggested');
  const committed = existing.filter(a => a.status === 'accepted' || a.status === 'manual');

  const debts = buildDebtQueue(draft).map(d => {
    const used = committed
      .filter(a => a.target_type === d.target_type && a.target_id === d.target_id)
      .reduce((s, a) => s + Math.round(Number(a.amount) || 0), 0);
    return { ...d, remaining: Math.max(0, d.amount - used) };
  });
  const payments = buildPaymentQueue(draft).map(p => {
    const used = committed
      .filter(a => a.payment_id === p.id)
      .reduce((s, a) => s + Math.round(Number(a.amount) || 0), 0);
    return { ...p, remaining: Math.max(0, p.amount - used) };
  });

  const suggestions = [];
  let di = 0;
  for (const p of payments) {
    let left = p.remaining;
    while (left > 0 && di < debts.length) {
      const d = debts[di];
      if (d.remaining <= 0) { di++; continue; }
      const amt = Math.min(left, d.remaining);
      suggestions.push({
        id: 'al_' + genId(),
        payment_id: p.id,
        target_type: d.target_type,
        target_id: d.target_id,
        amount: amt,
        status: 'suggested',
      });
      d.remaining -= amt;
      left -= amt;
      if (d.remaining <= 0) di++;
    }
  }
  return [...kept, ...suggestions];
}

// Tổng số tiền đã "chốt" (accepted/manual) cho 1 khoản nợ cụ thể
function getCommittedAmountForTarget(allocations, target_type, target_id) {
  return (allocations || [])
    .filter(a => (a.status === 'accepted' || a.status === 'manual') && a.target_type === target_type && a.target_id === target_id)
    .reduce((s, a) => s + Math.round(Number(a.amount) || 0), 0);
}
// Tổng số tiền đã "chốt" (accepted/manual) cho 1 khoản thanh toán cụ thể
function getCommittedAmountForPayment(allocations, payment_id) {
  return (allocations || [])
    .filter(a => (a.status === 'accepted' || a.status === 'manual') && a.payment_id === payment_id)
    .reduce((s, a) => s + Math.round(Number(a.amount) || 0), 0);
}
// Có allocation đang active (suggested/accepted/manual) liên quan tới khoản nợ này không (để highlight)
function hasActiveAllocationForTarget(allocations, target_type, target_id) {
  return (allocations || []).some(a => a.status !== 'ignored' && a.target_type === target_type && a.target_id === target_id);
}
function hasActiveAllocationForPayment(allocations, payment_id) {
  return (allocations || []).some(a => a.status !== 'ignored' && a.payment_id === payment_id);
}

function getDebtLabel(draft, target_type, target_id) {
  if (target_type === 'dau_ky') {
    const r = (draft.dau_ky_rows || []).find(x => x.id === target_id);
    return r ? `Đầu kỳ — ${r.mo_ta || ''}` : '(đã xoá)';
  }
  if (target_type === 'phat_sinh') {
    const r = (draft.phat_sinh_rows || []).find(x => x.id === target_id);
    return r ? `${r.ngay ? dayjs(r.ngay).format('DD/MM/YY') + ' · ' : ''}${r.ten_sp || ''}` : '(đã xoá)';
  }
  if (target_type === 'dieu_chinh') {
    const r = (draft.dieu_chinh_rows || []).find(x => x.id === target_id);
    return r ? `${r.ngay ? dayjs(r.ngay).format('DD/MM/YY') + ' · ' : ''}Điều chỉnh tăng — ${r.mo_ta || ''}` : '(đã xoá)';
  }
  return '—';
}
function getPaymentLabel(draft, payment_id) {
  const r = (draft.thanh_toan_rows || []).find(x => x.id === payment_id);
  if (!r) return '(đã xoá)';
  return `${r.ngay ? dayjs(r.ngay).format('DD/MM/YY') + ' · ' : ''}${r.mo_ta || 'Thanh toán'}`;
}

// ─── Editable cell ───────────────────────────────────────────────────────────
function EditableCell({ value, onChange, type = 'text', style }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        style={{ cursor: 'text', minHeight: 22, padding: '0 4px', ...style }}
        title="Nhấn để chỉnh sửa"
      >
        {type === 'number'
          ? (val ? formatMoney(Math.round(Number(val))) : <span style={{ color: '#bbb' }}>0</span>)
          : (val || <span style={{ color: '#bbb' }}>—</span>)}
      </div>
    );
  }

  const commit = (v) => {
    setEditing(false);
    const parsed = type === 'number' ? Math.round(Number(String(v).replace(/[^0-9.-]/g, '')) || 0) : v;
    setVal(parsed);
    onChange(parsed);
  };

  return type === 'number'
    ? <InputNumber
        size="small" autoFocus style={{ width: '100%' }}
        value={val} min={0}
        formatter={v => formatMoney(Number(v) || 0)}
        parser={v => v.replace(/[^0-9]/g, '')}
        onChange={v => setVal(v)}
        onBlur={() => commit(val)}
        onPressEnter={() => commit(val)}
      />
    : <Input
        size="small" autoFocus style={{ width: '100%' }}
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => commit(val)}
        onPressEnter={() => commit(val)}
      />;
}

// ─── Section: Đầu kỳ ─────────────────────────────────────────────────────────
function DauKySection({ rows, onChange, allocations = [] }) {
  function updateRow(id, field, value) {
    onChange(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  }
  function deleteRow(id) {
    onChange(rows.map(r => r.id === id ? { ...r, deleted: true } : r));
  }
  function addRow() {
    onChange([...rows, { id: genId(), mo_ta: 'Công nợ mang sang', so_tien: 0, note: '', deleted: false }]);
  }

  const visible = rows.filter(r => !r.deleted);
  const total   = visible.reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Typography.Text strong style={{ color: '#1677ff' }}>📋 Đầu kỳ mang sang</Typography.Text>
        <Button size="small" icon={<PlusOutlined />} onClick={addRow}>Thêm dòng</Button>
      </div>
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#e6f4ff' }}>
              <th style={thStyle}>Mô tả</th>
              <th style={{ ...thStyle, width: 140, textAlign: 'right' }}>Số tiền</th>
              <th style={{ ...thStyle, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', padding: 12, color: '#999' }}>Chưa có dữ liệu đầu kỳ</td></tr>
            )}
            {visible.map(r => {
              const active = hasActiveAllocationForTarget(allocations, 'dau_ky', r.id);
              const committed = getCommittedAmountForTarget(allocations, 'dau_ky', r.id);
              const soTien = Math.round(Number(r.so_tien) || 0);
              const remaining = soTien - committed;
              return (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0', background: active ? '#fffbe6' : undefined }}>
                <td style={tdStyle}>
                  <EditableCell value={r.mo_ta} onChange={v => updateRow(r.id, 'mo_ta', v)} />
                  {committed > 0 && (
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      Đã đối trừ: {formatMoney(committed)}đ · Còn lại: {formatMoney(remaining)}đ
                      {remaining <= 0 && <Tag color="success" style={{ marginLeft: 4, fontSize: 10, lineHeight: '14px', padding: '0 4px' }}>Đã thanh toán đủ</Tag>}
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <EditableCell value={r.so_tien} type="number" onChange={v => updateRow(r.id, 'so_tien', v)} />
                </td>
                <td style={tdStyle}>
                  <DeleteOutlined
                    style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 13 }}
                    onClick={() => deleteRow(r.id)}
                  />
                </td>
              </tr>
              );
            })}
            <tr style={{ background: '#fafafa', borderTop: '1px solid #d9d9d9' }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>Tổng đầu kỳ</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#1677ff' }}>
                {fmtVND(total)}
              </td>
              <td style={tdStyle}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section: Phát sinh ──────────────────────────────────────────────────────
function PhatSinhSection({ rows, onChange, allocations = [] }) {
  function updateRow(id, field, value) {
    onChange(rows.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      // Tự tính lại final_amount khi sửa sl/don_gia/vat
      if (['sl', 'don_gia', 'vat_rate'].includes(field)) {
        const sl  = field === 'sl'       ? Number(value) : Number(updated.sl);
        const dg  = field === 'don_gia'  ? Number(value) : Number(updated.don_gia);
        const vat = field === 'vat_rate' ? Number(value) : Number(updated.vat_rate || 0);
        const before_tax  = Math.round(sl * dg);
        const vat_amount  = Math.round(before_tax * vat / 100);
        const after_tax   = before_tax + vat_amount;
        updated.amount_before_tax = before_tax;
        updated.vat_amount        = vat_amount;
        updated.amount_after_tax  = after_tax;
        updated.final_amount      = after_tax;
      }
      // Nếu sửa trực tiếp final_amount
      if (field === 'final_amount') {
        updated.final_amount = Math.round(Number(value));
      }
      return updated;
    }));
  }
  function deleteRow(id) {
    onChange(rows.map(r => r.id === id ? { ...r, deleted: true } : r));
  }
  function addRow() {
    const newRow = {
      id: genId(), source_order_code: '', ngay: dayjs().format('YYYY-MM-DD'),
      ma_sp: '', ten_sp: 'Sản phẩm mới', dvt: 'CÁI',
      sl: 1, don_gia: 0, vat_rate: 0,
      amount_before_tax: 0, vat_amount: 0, amount_after_tax: 0,
      original_amount: 0, final_amount: 0,
      export_visible: true, note: '', deleted: false,
    };
    onChange([...rows, newRow]);
  }

  const visible = rows.filter(r => !r.deleted);

  // Nhóm theo ngày, tính subtotal từng ngày
  const byDate = {};
  visible.forEach(r => {
    const d = r.ngay || '???';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  const totalAll = visible.reduce((s, r) => s + Math.round(Number(r.final_amount) || 0), 0);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Typography.Text strong style={{ color: '#52c41a' }}>📦 Phát sinh trong kỳ</Typography.Text>
        <Button size="small" icon={<PlusOutlined />} onClick={addRow}>Thêm dòng</Button>
      </div>
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f6ffed' }}>
              <th style={{ ...thStyle, width: 90 }}>Ngày</th>
              <th style={{ ...thStyle, width: 110 }}>Mã SP</th>
              <th style={thStyle}>Tên sản phẩm</th>
              <th style={{ ...thStyle, width: 50 }}>ĐVT</th>
              <th style={{ ...thStyle, width: 50, textAlign: 'right' }}>SL</th>
              <th style={{ ...thStyle, width: 100, textAlign: 'right' }}>Đơn giá</th>
              <th style={{ ...thStyle, width: 50, textAlign: 'right' }}>VAT%</th>
              <th style={{ ...thStyle, width: 110, textAlign: 'right' }}>Thành tiền</th>
              <th style={{ ...thStyle, width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 12, color: '#999' }}>
                Chưa có phát sinh. Import file nguồn hoặc thêm dòng tay.
              </td></tr>
            )}
            {Object.entries(byDate).map(([date, dateRows]) => {
              const subtotal = dateRows.reduce((s, r) => s + Math.round(Number(r.final_amount) || 0), 0);
              return (
                <React.Fragment key={date}>
                  {dateRows.map((r, idx) => {
                    const active = hasActiveAllocationForTarget(allocations, 'phat_sinh', r.id);
                    const committed = getCommittedAmountForTarget(allocations, 'phat_sinh', r.id);
                    const finalAmt = Math.round(Number(r.final_amount) || 0);
                    const remaining = finalAmt - committed;
                    return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f5f5f5', background: active ? '#fffbe6' : (idx % 2 === 0 ? '#fff' : '#fafafa') }}>
                      <td style={{ ...tdStyle, borderLeft: idx === 0 ? '3px solid #52c41a' : '3px solid transparent' }}>
                        {idx === 0
                          ? <EditableCell
                              value={r.ngay ? dayjs(r.ngay).format('DD/MM/YY') : ''}
                              onChange={v => {
                                // Khi sửa ngày của dòng đầu → apply cho cả nhóm
                                const parsed = parseDate(v) || r.ngay;
                                const ids = dateRows.map(x => x.id);
                                onChange(rows.map(x => ids.includes(x.id) ? { ...x, ngay: parsed } : x));
                              }}
                            />
                          : ''}
                      </td>
                      <td style={tdStyle}><EditableCell value={r.ma_sp} onChange={v => updateRow(r.id, 'ma_sp', v)} /></td>
                      <td style={tdStyle}>
                        <EditableCell value={r.ten_sp} onChange={v => updateRow(r.id, 'ten_sp', v)} />
                        {committed > 0 && (
                          <div style={{ fontSize: 11, color: '#888' }}>
                            Đã đối trừ: {formatMoney(committed)}đ · Còn lại: {formatMoney(remaining)}đ
                            {remaining <= 0 && <Tag color="success" style={{ marginLeft: 4, fontSize: 10, lineHeight: '14px', padding: '0 4px' }}>Đã thanh toán đủ</Tag>}
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}><EditableCell value={r.dvt} onChange={v => updateRow(r.id, 'dvt', v)} /></td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <EditableCell value={r.sl} type="number" onChange={v => updateRow(r.id, 'sl', v)} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <EditableCell value={r.don_gia} type="number" onChange={v => updateRow(r.id, 'don_gia', v)} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <EditableCell value={r.vat_rate || 0} type="number" onChange={v => updateRow(r.id, 'vat_rate', v)} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>
                        <EditableCell value={r.final_amount} type="number" onChange={v => updateRow(r.id, 'final_amount', v)} />
                      </td>
                      <td style={tdStyle}>
                        <DeleteOutlined
                          style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 13 }}
                          onClick={() => deleteRow(r.id)}
                        />
                      </td>
                    </tr>
                    );
                  })}
                  {/* Subtotal ngày */}
                  <tr style={{ background: '#f9fff4', borderTop: '1px dashed #b7eb8f' }}>
                    <td colSpan={7} style={{ ...tdStyle, textAlign: 'right', color: '#389e0d', fontSize: 12 }}>
                      Subtotal {dayjs(date).isValid() ? dayjs(date).format('DD/MM/YYYY') : date}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#389e0d' }}>
                      {fmtVND(subtotal)}
                    </td>
                    <td style={tdStyle}></td>
                  </tr>
                </React.Fragment>
              );
            })}
            {visible.length > 0 && (
              <tr style={{ background: '#f6ffed', borderTop: '2px solid #b7eb8f' }}>
                <td colSpan={7} style={{ ...tdStyle, fontWeight: 700, color: '#237804', textAlign: 'right' }}>
                  Tổng phát sinh
                </td>
                <td style={{ ...tdStyle, fontWeight: 700, color: '#237804', textAlign: 'right' }}>
                  {fmtVND(totalAll)}
                </td>
                <td style={tdStyle}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section: Thanh toán ─────────────────────────────────────────────────────
function ThanhToanSection({ rows, onChange, allocations = [] }) {
  function updateRow(id, field, value) {
    onChange(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  }
  function deleteRow(id) {
    onChange(rows.map(r => r.id === id ? { ...r, deleted: true } : r));
  }
  function addRow() {
    onChange([...rows, {
      id: genId(), ngay: dayjs().format('YYYY-MM-DD'),
      mo_ta: 'Thanh toán', so_tien: 0,
      source: 'manual', note: '', deleted: false,
    }]);
  }

  const visible = rows.filter(r => !r.deleted);
  const total   = visible.reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Space>
          <Typography.Text strong style={{ color: '#fa8c16' }}>💳 Thanh toán</Typography.Text>
          {rows.some(r => !r.deleted && r.source === 'misa') && (
            <Tag color="blue" style={{ fontSize: 11 }}>Lấy từ MISA</Tag>
          )}
        </Space>
        <Button size="small" icon={<PlusOutlined />} onClick={addRow}>Thêm dòng</Button>
      </div>
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fff7e6' }}>
              <th style={{ ...thStyle, width: 100 }}>Ngày</th>
              <th style={thStyle}>Mô tả</th>
              <th style={{ ...thStyle, width: 140, textAlign: 'right' }}>Số tiền</th>
              <th style={{ ...thStyle, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 12, color: '#999' }}>
                Chưa có thanh toán. Sẽ tự điền từ MISA khi nhấn "Lấy dữ liệu MISA".
              </td></tr>
            )}
            {visible.map(r => {
              const active = hasActiveAllocationForPayment(allocations, r.id);
              const committed = getCommittedAmountForPayment(allocations, r.id);
              return (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0', background: active ? '#fffbe6' : undefined }}>
                <td style={{ ...tdStyle, borderLeft: '3px solid #fa8c16' }}>
                  <EditableCell
                    value={r.ngay ? dayjs(r.ngay).format('DD/MM/YYYY') : ''}
                    onChange={v => updateRow(r.id, 'ngay', parseDate(v) || r.ngay)}
                  />
                </td>
                <td style={tdStyle}>
                  <EditableCell value={r.mo_ta} onChange={v => updateRow(r.id, 'mo_ta', v)} />
                  {committed > 0 && (
                    <div style={{ fontSize: 11, color: '#888' }}>Đã đối trừ: {formatMoney(committed)}đ</div>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <EditableCell value={r.so_tien} type="number" onChange={v => updateRow(r.id, 'so_tien', v)} />
                </td>
                <td style={tdStyle}>
                  <DeleteOutlined
                    style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 13 }}
                    onClick={() => deleteRow(r.id)}
                  />
                </td>
              </tr>
              );
            })}
            {visible.length > 0 && (
              <tr style={{ background: '#fff7e6', borderTop: '1px solid #ffd591' }}>
                <td colSpan={2} style={{ ...tdStyle, fontWeight: 600 }}>Tổng thanh toán</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#d46b08' }}>
                  {fmtVND(total)}
                </td>
                <td style={tdStyle}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section: Điều chỉnh ─────────────────────────────────────────────────────
function DieuChinhSection({ rows, onChange }) {
  function updateRow(id, field, value) {
    onChange(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  }
  function deleteRow(id) {
    onChange(rows.map(r => r.id === id ? { ...r, deleted: true } : r));
  }
  function addRow(direction) {
    onChange([...rows, {
      id: genId(), ngay: dayjs().format('YYYY-MM-DD'),
      loai: 'khac', mo_ta: direction === 'tang' ? 'Điều chỉnh tăng' : 'Hoàn hàng / Giảm trừ',
      so_tien: 0, direction, note: '', deleted: false,
    }]);
  }

  const visible   = rows.filter(r => !r.deleted);
  const totalTang = visible.filter(r => r.direction === 'tang').reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);
  const totalGiam = visible.filter(r => r.direction === 'giam').reduce((s, r) => s + Math.round(Number(r.so_tien) || 0), 0);

  if (visible.length === 0) return (
    <div style={{ marginBottom: 12 }}>
      <Space>
        <Typography.Text strong style={{ color: '#722ed1' }}>⚙️ Điều chỉnh</Typography.Text>
        <Button size="small" icon={<PlusOutlined />} onClick={() => addRow('giam')}>Hoàn hàng / Giảm trừ</Button>
        <Button size="small" icon={<PlusOutlined />} onClick={() => addRow('tang')}>Điều chỉnh tăng</Button>
      </Space>
    </div>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Typography.Text strong style={{ color: '#722ed1' }}>⚙️ Điều chỉnh</Typography.Text>
        <Space>
          <Button size="small" icon={<PlusOutlined />} onClick={() => addRow('giam')}>Giảm trừ</Button>
          <Button size="small" icon={<PlusOutlined />} onClick={() => addRow('tang')}>Tăng</Button>
        </Space>
      </div>
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9f0ff' }}>
              <th style={{ ...thStyle, width: 100 }}>Ngày</th>
              <th style={{ ...thStyle, width: 80 }}>Loại</th>
              <th style={thStyle}>Mô tả</th>
              <th style={{ ...thStyle, width: 140, textAlign: 'right' }}>Số tiền</th>
              <th style={{ ...thStyle, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ ...tdStyle, borderLeft: `3px solid ${r.direction === 'tang' ? '#52c41a' : '#ff4d4f'}` }}>
                  <EditableCell
                    value={r.ngay ? dayjs(r.ngay).format('DD/MM/YY') : ''}
                    onChange={v => updateRow(r.id, 'ngay', parseDate(v) || r.ngay)}
                  />
                </td>
                <td style={tdStyle}>
                  <Tag color={r.direction === 'tang' ? 'green' : 'red'} style={{ fontSize: 11 }}>
                    {r.direction === 'tang' ? 'Tăng' : 'Giảm'}
                  </Tag>
                </td>
                <td style={tdStyle}>
                  <EditableCell value={r.mo_ta} onChange={v => updateRow(r.id, 'mo_ta', v)} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <EditableCell value={r.so_tien} type="number" onChange={v => updateRow(r.id, 'so_tien', v)} />
                </td>
                <td style={tdStyle}>
                  <DeleteOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} onClick={() => deleteRow(r.id)} />
                </td>
              </tr>
            ))}
            <tr style={{ background: '#f9f0ff', borderTop: '1px solid #d3adf7' }}>
              <td colSpan={3} style={{ ...tdStyle, textAlign: 'right', fontSize: 12 }}>
                <span style={{ color: '#389e0d' }}>Tăng: {fmtVNDRaw(totalTang) || '0'} đ</span>
                {'  |  '}
                <span style={{ color: '#cf1322' }}>Giảm: {fmtVNDRaw(totalGiam) || '0'} đ</span>
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#722ed1' }}>
                {fmtVND(totalTang - totalGiam)}
              </td>
              <td style={tdStyle}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section: Gợi ý đối trừ thanh toán (Phase 3) ────────────────────────────
function DoiTruSection({ draft, onChange }) {
  const allocations = draft.allocations || [];
  const [editing, setEditing] = useState(null); // { id, target_type, target_id, amount }

  function regenerate() {
    onChange(generateAllocationSuggestions(draft));
  }
  function setStatus(id, status) {
    onChange(allocations.map(a => a.id === id ? { ...a, status } : a));
  }
  function startManualEdit(a) {
    setEditing({ id: a.id, target_type: a.target_type, target_id: a.target_id, amount: a.amount });
  }
  function saveManualEdit() {
    if (!editing) return;
    onChange(allocations.map(a => a.id === editing.id
      ? { ...a, target_type: editing.target_type, target_id: editing.target_id, amount: Math.round(Number(editing.amount) || 0), status: 'manual' }
      : a));
    setEditing(null);
  }

  const debtOptions = buildDebtQueue(draft).map(d => ({
    value: `${d.target_type}::${d.target_id}`,
    label: getDebtLabel(draft, d.target_type, d.target_id),
  }));

  const statusTag = {
    suggested: <Tag color="default">Gợi ý</Tag>,
    accepted:  <Tag color="success">Đã chấp nhận</Tag>,
    ignored:   <Tag color="default" style={{ opacity: 0.6 }}>Đã bỏ qua</Tag>,
    manual:    <Tag color="purple">Chỉnh tay</Tag>,
  };
  const orderKey = { suggested: 0, manual: 0, accepted: 1, ignored: 2 };
  const sorted = allocations.slice().sort((a, b) => (orderKey[a.status] ?? 9) - (orderKey[b.status] ?? 9));

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Typography.Text strong style={{ color: '#13c2c2' }}>🔗 Gợi ý đối trừ thanh toán</Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={regenerate}>Tạo gợi ý đối trừ</Button>
      </div>
      <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#e6fffb' }}>
              <th style={thStyle}>Khoản thanh toán</th>
              <th style={thStyle}>Gợi ý cấn vào</th>
              <th style={{ ...thStyle, width: 130, textAlign: 'right' }}>Số tiền</th>
              <th style={{ ...thStyle, width: 110 }}>Trạng thái</th>
              <th style={{ ...thStyle, width: 190 }}>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 12, color: '#999' }}>
                Chưa có gợi ý. Nhấn "Tạo gợi ý đối trừ" để hệ thống tự gợi ý cấn trừ theo FIFO.
              </td></tr>
            )}
            {sorted.map(a => {
              const isEditing = editing && editing.id === a.id;
              return (
                <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: a.status === 'ignored' ? 0.55 : 1 }}>
                  <td style={tdStyle}>{getPaymentLabel(draft, a.payment_id)}</td>
                  <td style={tdStyle}>
                    {isEditing
                      ? <Select
                          size="small" style={{ width: '100%' }}
                          value={`${editing.target_type}::${editing.target_id}`}
                          options={debtOptions}
                          onChange={v => {
                            const [target_type, target_id] = v.split('::');
                            setEditing(e => ({ ...e, target_type, target_id }));
                          }}
                        />
                      : getDebtLabel(draft, a.target_type, a.target_id)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {isEditing
                      ? <InputNumber
                          size="small" style={{ width: '100%' }} min={0}
                          value={editing.amount}
                          formatter={v => formatMoney(Number(v) || 0)}
                          parser={v => v.replace(/[^0-9]/g, '')}
                          onChange={v => setEditing(e => ({ ...e, amount: v }))}
                        />
                      : <b>{formatMoney(a.amount)}đ</b>}
                  </td>
                  <td style={tdStyle}>{statusTag[a.status] || a.status}</td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <Space size={4}>
                        <Button size="small" type="primary" onClick={saveManualEdit}>Lưu</Button>
                        <Button size="small" onClick={() => setEditing(null)}>Huỷ</Button>
                      </Space>
                    ) : (
                      <Space size={4}>
                        {a.status !== 'accepted' && (
                          <Button size="small" onClick={() => setStatus(a.id, 'accepted')}>Chấp nhận</Button>
                        )}
                        {a.status !== 'ignored' && (
                          <Button size="small" onClick={() => setStatus(a.id, 'ignored')}>Bỏ qua</Button>
                        )}
                        <Button size="small" onClick={() => startManualEdit(a)}>Chỉnh tay</Button>
                      </Space>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Preview: Bảng gửi khách (dùng để chụp ảnh / copy clipboard Zalo) ───────
// Render giống layout file Excel export. Component này được mount luôn trong
// DOM (vị trí cố định ngoài màn hình) để html2canvas có thể chụp bất kỳ lúc nào,
// không cần mở modal.
const PreviewKhachHang = React.forwardRef(function PreviewKhachHang({ draft, meta }, ref) {
  const data = buildPreviewData(draft, meta);
  // cellStyle cho dữ liệu thường — gridline rất nhạt, mắt tập trung vào dữ liệu
  const cellStyle = { border: '1px solid #B7B7B7', padding: '4px 6px', fontFamily: 'Times New Roman, serif' };
  // headerCellStyle cho header — border đen, bottom đậm để phân biệt rõ
  const headerCellStyle = { border: '1px solid #000000', borderBottom: '2px solid #000000', padding: '4px 6px', fontFamily: 'Times New Roman, serif' };
  const labelRowStyle = { ...cellStyle, textAlign: 'right', fontFamily: 'Times New Roman, serif' };

  return (
    <div
      ref={ref}
      data-export-preview="bang-cong-no"
      style={{
        position: 'fixed', left: -99999, top: 0, width: 760,
        backgroundColor: '#ffffff', color: '#000000', padding: 16,
        fontFamily: 'Times New Roman, serif',
      }}
    >
      <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 22, marginBottom: 10 }}>
        {data.tieuDe}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...headerCellStyle, fontWeight: 'bold' }}>NGÀY</th>
            <th style={{ ...headerCellStyle, fontWeight: 'bold' }}>MÃ SP</th>
            <th style={{ ...headerCellStyle, fontWeight: 'bold' }}>TÊN SẢN PHẨM</th>
            <th style={{ ...headerCellStyle, fontWeight: 'bold' }}>ĐVT</th>
            <th style={{ ...headerCellStyle, fontWeight: 'bold', textAlign: 'right' }}>SL</th>
            <th style={{ ...headerCellStyle, fontWeight: 'bold', textAlign: 'right' }}>ĐƠN GIÁ</th>
            <th style={{ ...headerCellStyle, fontWeight: 'bold', textAlign: 'right' }}>THÀNH TIỀN</th>
          </tr>
        </thead>
        <tbody>
          {data.groups.length === 0 && (
            <tr><td colSpan={7} style={{ ...cellStyle, textAlign: 'center', color: '#999' }}>Chưa có phát sinh</td></tr>
          )}
          {data.groups.map((g, gi) => (
            <React.Fragment key={g.date + gi}>
              {g.rows.map((r, idx) => (
                <tr key={r.id}>
                  {/* Cột NGÀY: rowSpan theo nhóm, chỉ render ở dòng đầu tiên */}
                  {idx === 0 && (
                    <td
                      rowSpan={g.rows.length}
                      style={{ ...cellStyle, textAlign: 'center', verticalAlign: 'top', paddingTop: 6 }}
                    >
                      {g.date ? dayjs(g.date).format('DD/MM/YYYY') : ''}
                    </td>
                  )}
                  <td style={cellStyle}>{r.ma_sp}</td>
                  <td style={cellStyle}>{r.ten_sp}</td>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>{r.dvt}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{r.sl}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{formatMoney(r.don_gia)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{formatMoney(r._remaining)}</td>
                </tr>
              ))}
              {/* Dòng Cộng ngày — separator mềm, chỉ đường kẻ bottom, không đóng khung */}
              <tr>
                <td colSpan={2} style={{ borderBottom: '2px solid #000000', padding: '5px 0' }}></td>
                <td colSpan={4} style={{
                  borderBottom: '2px solid #000000',
                  textAlign: 'right',
                  padding: '5px 8px',
                  fontFamily: 'Times New Roman, serif',
                  fontSize: 13,
                }}>
                  {g.date && dayjs(g.date).isValid() ? `Cộng ngày ${dayjs(g.date).format('DD/MM/YYYY')}` : 'Cộng ngày'}
                </td>
                <td style={{
                  borderBottom: '2px solid #000000',
                  textAlign: 'right',
                  fontWeight: 700,
                  padding: '5px 6px',
                  fontFamily: 'Times New Roman, serif',
                  fontSize: 13,
                }}>
                  {formatMoney(g.subtotal)}
                </td>
              </tr>
            </React.Fragment>
          ))}
          <tr style={{ borderTop: '2px solid #000000' }}>
            <td style={{ ...labelRowStyle, fontWeight: 'bold', borderTop: '2px solid #000000' }} colSpan={6}>TỔNG</td>
            <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 'bold', borderTop: '2px solid #000000' }}>{formatMoney(data.tongPhatSinh)}</td>
          </tr>
          {data.summaryLines.map((l, i) => (
            <tr key={i}>
              <td style={labelRowStyle} colSpan={6}>{l.label}</td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>{formatMoney(l.amount)}</td>
            </tr>
          ))}
          <tr style={{ background: '#ffe699', borderTop: '2px solid #000000', borderBottom: '2px solid #000000' }}>
            <td style={{ ...labelRowStyle, fontWeight: 'bold', borderTop: '2px solid #000000', borderBottom: '2px solid #000000' }} colSpan={6}>
              CÔNG NỢ CÒN PHẢI THANH TOÁN{data.denNgay ? ` ĐẾN ${dayjs(data.denNgay).format('DD/MM/YYYY')}` : ''}
            </td>
            <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 'bold', background: '#ffe699', borderTop: '2px solid #000000', borderBottom: '2px solid #000000' }}>{formatMoney(data.congNoConPhaiThanhToan)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
});

// ─── Modal: Danh sách draft đã lưu ──────────────────────────────────────────
function DraftListModal({ open, onClose, onLoad }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get('/bang-cong-no').then(r => {
      setDrafts(r.data.data || []);
    }).catch(() => message.error('Lỗi tải danh sách'))
      .finally(() => setLoading(false));
  }, [open]);

  function handleDelete(id) {
    api.delete(`/bang-cong-no/${id}`)
      .then(() => setDrafts(d => d.filter(x => x.id !== id)))
      .catch(() => message.error('Lỗi xóa'));
  }

  const statusColor = { draft: 'default', ready: 'blue', exported: 'green', cancelled: 'red' };
  const reconcileColor = { chua_doi_chieu: 'default', khop: 'success', lech: 'warning' };

  return (
    <Modal
      title={<Space><HistoryOutlined /> Lịch sử bảng công nợ đã lưu</Space>}
      open={open} onCancel={onClose} footer={null} width={780}
    >
      <Spin spinning={loading}>
        {drafts.length === 0 && !loading && <Empty description="Chưa có bản nháp nào được lưu" />}
        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
          {drafts.map(d => (
            <div key={d.id} style={{
              border: '1px solid #f0f0f0', borderRadius: 6,
              padding: '10px 12px', marginBottom: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{d.tieu_de || d.ten_kh}</div>
                <Space size={4} style={{ marginTop: 2 }}>
                  <span style={{ fontSize: 12, color: '#888' }}>
                    {d.tu_ngay} → {d.den_ngay}
                  </span>
                  <Tag color={statusColor[d.status]} style={{ fontSize: 11 }}>
                    {d.status === 'draft' ? 'Nháp' : d.status === 'ready' ? 'Sẵn sàng' : d.status === 'exported' ? 'Đã export' : 'Huỷ'}
                  </Tag>
                  <Tag color={reconcileColor[d.reconcile_status]} style={{ fontSize: 11 }}>
                    {d.reconcile_status === 'khop' ? '✓ Khớp MISA' : d.reconcile_status === 'lech' ? '⚠ Lệch MISA' : 'Chưa đối chiếu'}
                  </Tag>
                </Space>
                <div style={{ fontSize: 12, marginTop: 2, color: '#555' }}>
                  Đầu kỳ: {formatMoney(d.dau_ky)}đ &nbsp;|&nbsp;
                  Phát sinh: {formatMoney(d.tong_ps)}đ &nbsp;|&nbsp;
                  Cuối kỳ: {formatMoney(d.cuoi_ky_app)}đ
                </div>
                {d.source_file_name && (
                  <div style={{ fontSize: 11, color: '#aaa' }}>📎 {d.source_file_name}</div>
                )}
              </div>
              <Space>
                <Button size="small" icon={<FolderOpenOutlined />} type="primary"
                  onClick={() => { onLoad(d.id); onClose(); }}>
                  Mở
                </Button>
                <Popconfirm title="Xóa bản nháp này?" onConfirm={() => handleDelete(d.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            </div>
          ))}
        </div>
      </Spin>
    </Modal>
  );
}

// ─── Reconcile box ────────────────────────────────────────────────────────────
function ReconcileBox({ summary, cuoiKyMisa, onChange }) {
  const { cuoi_ky_app } = summary;
  const misa = Math.round(Number(cuoiKyMisa) || 0);
  const diff = cuoi_ky_app - misa;
  const isSet = misa > 0;
  const isMatch = isSet && diff === 0;

  return (
    <div style={{
      border: `2px solid ${!isSet ? '#d9d9d9' : isMatch ? '#52c41a' : '#fa8c16'}`,
      borderRadius: 8, padding: '12px 16px', marginTop: 8,
      background: !isSet ? '#fafafa' : isMatch ? '#f6ffed' : '#fff7e6',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Typography.Text strong>⚖️ Đối chiếu MISA</Typography.Text>
          <div style={{ fontSize: 13, marginTop: 6, lineHeight: 2 }}>
            <div>Cuối kỳ app tính: <b style={{ color: '#1677ff' }}>{formatMoney(cuoi_ky_app)} đ</b></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Cuối kỳ MISA:
              <InputNumber
                size="small"
                value={misa || undefined}
                placeholder="Nhập cuối kỳ MISA"
                style={{ width: 160 }}
                formatter={v => formatMoney(Number(v) || 0)}
                parser={v => v.replace(/[^0-9]/g, '')}
                onChange={v => onChange(Math.round(Number(v) || 0))}
              />
            </div>
            {isSet && (
              <div style={{ color: isMatch ? '#389e0d' : '#d46b08', fontWeight: 600 }}>
                Chênh lệch: {diff > 0 ? '+' : ''}{formatMoney(diff)} đ
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          {!isSet && <Tag color="default" style={{ fontSize: 13, padding: '4px 12px' }}>Chưa đối chiếu</Tag>}
          {isSet && isMatch && <Tag color="success" icon={<CheckCircleOutlined />} style={{ fontSize: 13, padding: '4px 12px' }}>Đã khớp MISA ✓</Tag>}
          {isSet && !isMatch && <Tag color="warning" icon={<ExclamationCircleOutlined />} style={{ fontSize: 13, padding: '4px 12px' }}>Lệch MISA ⚠</Tag>}
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
        Công thức: Đầu kỳ ({formatMoney(summary.dau_ky)}) + Phát sinh ({formatMoney(summary.tong_ps)})
        {summary.tong_dieu_chinh_tang > 0 && ` + Tăng (${formatMoney(summary.tong_dieu_chinh_tang)})`}
        {' '}- Thanh toán ({formatMoney(summary.tong_tt)})
        {summary.tong_dieu_chinh_giam > 0 && ` - Giảm (${formatMoney(summary.tong_dieu_chinh_giam)})`}
        {' '}= <b>{formatMoney(cuoi_ky_app)}</b> đ
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
const EMPTY_DRAFT = {
  meta: { customer_name: '', period_from: '', period_to: '', title: '', source_file_name: '' },
  settings: { source_price_include_vat: false, default_vat_rate: 0 },
  dau_ky_rows: [],
  phat_sinh_rows: [],
  thanh_toan_rows: [],
  dieu_chinh_rows: [],
  allocations: [],
  reconcile: { cuoi_ky_app: 0, cuoi_ky_misa: 0, chenh_lech: 0, status: 'chua_doi_chieu' },
};

export default function BangCongNo() {
  const [step, setStep] = useState('list'); // 'list' | 'customerList' | 'edit'
  const [draftId, setDraftId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [meta, setMeta] = useState({ ten_kh: '', ma_kh: '', tu_ngay: '', den_ngay: '', tieu_de: '', source_file_name: '' });
  const [cuoiKyMisa, setCuoiKyMisa] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingMisa, setLoadingMisa] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Import state
  const [importFile, setImportFile]     = useState(null);
  const [importParsed, setImportParsed] = useState([]); // Toàn bộ rows đã parse
  const [importRows, setImportRows]     = useState([]); // Danh sách KH đã group

  function startNew() {
    setDraftId(null);
    setDraft({ ...EMPTY_DRAFT, dau_ky_rows: [], phat_sinh_rows: [], thanh_toan_rows: [], dieu_chinh_rows: [], allocations: [] });
    setMeta({ ten_kh: '', ma_kh: '', tu_ngay: '', den_ngay: '', tieu_de: '', source_file_name: '' });
    setCuoiKyMisa(0);
    setStep('edit');
  }

  async function loadDraft(id) {
    try {
      const r = await api.get(`/bang-cong-no/${id}`);
      const d = r.data.data;
      setDraftId(id);
      setDraft(d.draft_json);
      setMeta({
        ten_kh: d.ten_kh, ma_kh: d.ma_kh || '',
        tu_ngay: d.tu_ngay, den_ngay: d.den_ngay,
        tieu_de: d.tieu_de || '', source_file_name: d.source_file_name || '',
      });
      setCuoiKyMisa(d.cuoi_ky_misa || 0);
      setStep('edit');
    } catch {
      message.error('Lỗi tải bản nháp');
    }
  }

  // ─── Parse Excel ───────────────────────────────────────────────────────────
  function handleFileSelect(file) {
    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const allRows = [];

        wb.SheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName];
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

          // Tìm header row: dòng có "TÊN KHÁCH HÀNG" hoặc "TÊN SP"
          let headerIdx = -1;
          for (let i = 0; i < Math.min(raw.length, 5); i++) {
            const rowStr = (raw[i] || []).join('|').toUpperCase();
            if (rowStr.includes('TÊN KHÁCH') || rowStr.includes('TEN KHACH') || rowStr.includes('MÃ ĐH') || rowStr.includes('MA DH')) {
              headerIdx = i;
              break;
            }
          }
          if (headerIdx < 0) return;

          const headers = (raw[headerIdx] || []).map(h => (h || '').toString().toUpperCase().trim());
          const colOf = (name) => headers.findIndex(h => h.includes(name));

          const colMaDH   = colOf('MÃ ĐH');
          const colMaKH   = colOf('MÃ KH');
          const colTenKH  = colOf('TÊN KHÁCH');
          const colMaSP   = colOf('MÃ SP');
          const colTenSP  = colOf('TÊN SẢN');
          const colDVT    = colOf('ĐVT');
          const colDG     = colOf('ĐƠN GIÁ');
          const colSL     = colOf('SL');
          const colTT     = colOf('THÀNH TIỀN');
          const colNgay   = colOf('NGÀY');

          for (let i = headerIdx + 1; i < raw.length; i++) {
            const row = raw[i];
            if (!row || !row[colTenKH]) continue;
            const maDH   = row[colMaDH]   ? String(row[colMaDH]) : '';
            const tenKH  = row[colTenKH]  ? String(row[colTenKH]).trim() : '';
            const maSP   = row[colMaSP]   ? String(row[colMaSP]) : '';
            const tenSP  = row[colTenSP]  ? String(row[colTenSP]) : '';
            const dvt    = row[colDVT]    ? String(row[colDVT]) : '';
            const dg     = Number(row[colDG])  || 0;
            const sl     = Number(row[colSL])  || 1;
            const tt     = Number(row[colTT])  || Math.round(sl * dg);

            // Ngày: ưu tiên cột NGÀY tường minh, fallback parse từ mã đơn
            let ngay = null;
            if (colNgay >= 0 && row[colNgay]) {
              ngay = parseDate(row[colNgay]);
            }
            if (!ngay && maDH) {
              ngay = parseDateFromCode(maDH);
            }

            const maKH = row[colMaKH] ? String(row[colMaKH]).trim() : '';
            if (!tenKH || !tenSP) continue;
            allRows.push({ maDH, maKH, tenKH, maSP, tenSP, dvt, dg, sl, tt, ngay });
          }
        });

        setImportParsed(allRows);

        // Group theo maKH (ưu tiên) hoặc tenKH
        const khMap = {};
        allRows.forEach(r => {
          const key = r.maKH || normName(r.tenKH);
          if (!khMap[key]) {
            khMap[key] = { maKH: r.maKH, tenKH: r.tenKH, rows: [], tongPS: 0, ngayArr: [] };
          }
          khMap[key].rows.push(r);
          khMap[key].tongPS += Math.round(Number(r.tt) || 0);
          if (r.ngay) khMap[key].ngayArr.push(r.ngay);
        });

        const khList = Object.values(khMap).map(kh => {
          const sorted = kh.ngayArr.sort();
          return {
            maKH: kh.maKH,
            tenKH: kh.tenKH,
            soDong: kh.rows.length,
            tongPS: kh.tongPS,
            tuNgay: sorted[0] || '',
            denNgay: sorted[sorted.length - 1] || '',
          };
        }).sort((a, b) => a.tenKH.localeCompare(b.tenKH));

        setImportRows(khList);
        setStep('customerList');
      } catch (err) {
        message.error('Lỗi đọc file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    return false; // Prevent auto-upload
  }

  function openCustomer(khInfo) {
    // Lọc rows cho đúng khách này
    const key = khInfo.maKH || normName(khInfo.tenKH);
    const filtered = importParsed.filter(r => {
      const rKey = r.maKH || normName(r.tenKH);
      return rKey === key;
    });
    if (filtered.length === 0) { message.warning('Không tìm thấy đơn hàng cho khách này'); return; }

    const phatSinhRows = filtered.map(r => ({
      id: genId(),
      source_order_code: r.maDH,
      ngay: r.ngay || '',
      ma_sp: r.maSP,
      ten_sp: r.tenSP,
      dvt: r.dvt,
      sl: r.sl,
      don_gia: r.dg,
      vat_rate: 0,
      amount_before_tax: Math.round(r.sl * r.dg),
      vat_amount: 0,
      amount_after_tax: r.tt,
      original_amount: r.tt,
      final_amount: r.tt,
      export_visible: true,
      note: '',
      deleted: false,
    }));

    const tu_ngay  = khInfo.tuNgay  || '';
    const den_ngay = khInfo.denNgay || '';
    const month    = tu_ngay ? dayjs(tu_ngay).format('M') : '';
    const year     = tu_ngay ? dayjs(tu_ngay).format('YYYY') : '';
    const tieu_de  = month ? `${khInfo.tenKH} - T${month}/${year}` : khInfo.tenKH;

    setDraftId(null);
    setMeta({
      ten_kh: khInfo.tenKH,
      ma_kh:  khInfo.maKH || '',
      tu_ngay, den_ngay, tieu_de,
      source_file_name: importFile?.name || '',
    });
    setDraft(d => ({
      ...EMPTY_DRAFT,
      dau_ky_rows: [], thanh_toan_rows: [], dieu_chinh_rows: [], allocations: [],
      phat_sinh_rows: phatSinhRows,
    }));
    setCuoiKyMisa(0);
    setStep('edit');
  }

  // ─── Lấy dữ liệu MISA ─────────────────────────────────────────────────────
  async function fetchMisaData() {
    if (!meta.ma_kh && !meta.ten_kh) { message.warning('Chưa chọn khách hàng'); return; }
    setLoadingMisa(true);
    try {
      const maKh = meta.ma_kh || '';
      if (!maKh) { message.warning('Chưa xác định được mã KH trong MISA'); setLoadingMisa(false); return; }

      const params = {};
      if (meta.tu_ngay)  params.tu_ngay  = meta.tu_ngay;
      if (meta.den_ngay) params.den_ngay = meta.den_ngay;

      const r = await api.get(`/congno/chi-tiet`, { params: { ma_kh: maKh, ...params } });
      const { dau_ky_net, data: chiTiet } = r.data;

      // Đầu kỳ từ MISA
      const dauKyRows = dau_ky_net > 0
        ? [{ id: genId(), mo_ta: `Công nợ mang sang (MISA)`, so_tien: Math.round(dau_ky_net), note: 'misa', deleted: false }]
        : [];

      // Thanh toán: lọc dòng ps_co (tiền vào) từ chi tiết
      const thanhToanRows = (chiTiet || [])
        .filter(row => Number(row.ps_co) > 0)
        .map(row => ({
          id: genId(),
          ngay: row.ngay_ct ? String(row.ngay_ct).slice(0, 10) : '',
          mo_ta: row.dien_giai || 'Thanh toán',
          so_tien: Math.round(Number(row.ps_co) || 0),
          source: 'misa',
          note: row.so_ct || '',
          deleted: false,
        }));

      // Cuối kỳ MISA từ tổng hợp
      const tongHopR = await api.get('/congno/tong-hop', { params });
      const khRow = (tongHopR.data.data || []).find(x => x.ma_kh === maKh);
      const cuoiKyMisaVal = Math.round(Number(khRow?.cuoi_ky_no || 0));
      setCuoiKyMisa(cuoiKyMisaVal);

      setDraft(d => ({
        ...d,
        dau_ky_rows:    dauKyRows,
        thanh_toan_rows: thanhToanRows,
      }));
      message.success(`Đã lấy dữ liệu MISA: đầu kỳ ${formatMoney(dau_ky_net)}đ, ${thanhToanRows.length} khoản thanh toán`);
    } catch (err) {
      message.error('Lỗi lấy dữ liệu MISA: ' + err.message);
    } finally {
      setLoadingMisa(false);
    }
  }

  // ─── Lưu draft ────────────────────────────────────────────────────────────
  // Trả về id của draft (vừa tạo hoặc đã có) để các luồng export/copy ảnh
  // có thể gọi ngay sau khi lưu mà không cần chờ setState re-render.
  async function saveDraft() {
    if (!meta.ten_kh) { message.warning('Chưa có tên khách hàng'); return null; }
    setSaving(true);
    try {
      const payload = {
        ma_kh: meta.ma_kh,
        ten_kh: meta.ten_kh,
        tu_ngay: meta.tu_ngay,
        den_ngay: meta.den_ngay,
        tieu_de: meta.tieu_de || `${meta.ten_kh} - ${meta.tu_ngay}`,
        source_file_name: meta.source_file_name,
        draft_json: { ...draft, meta: { ...draft.meta, ...meta } },
        cuoi_ky_misa: cuoiKyMisa,
      };
      if (draftId) {
        await api.put(`/bang-cong-no/${draftId}`, payload);
        message.success('Đã cập nhật bản nháp');
        return draftId;
      } else {
        const r = await api.post('/bang-cong-no', payload);
        setDraftId(r.data.id);
        message.success('Đã lưu bản nháp');
        return r.data.id;
      }
    } catch (err) {
      message.error('Lỗi lưu: ' + err.message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  // Đảm bảo draft đã có id trước khi gọi các API cần draft id (export...)
  async function ensureSaved() {
    if (draftId) return draftId;
    return await saveDraft();
  }

  // ─── Export Excel gửi khách ─────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  async function exportExcel() {
    setExporting(true);
    try {
      const id = await ensureSaved();
      if (!id) return;
      const res = await api.get(`/bang-cong-no/${id}/export`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${meta.ten_kh || 'bang-cong-no'} - ${meta.tieu_de || ''}`.trim().replace(/\s+/g, ' ') + '.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success('Đã tải file Excel gửi khách');
    } catch (err) {
      message.error('Lỗi export Excel: ' + (err?.response?.data?.error || err.message));
    } finally {
      setExporting(false);
    }
  }

  // ─── Copy ảnh / tải PNG (chụp vùng preview gửi khách) ───────────────────
  const previewRef = useRef(null);
  const [capturing, setCapturing] = useState(false);

  async function capturePreviewCanvas() {
    if (!previewRef.current) throw new Error('Chưa có vùng preview');
    // html2canvas-pro hỗ trợ oklab/oklch/color-mix (CSS màu hiện đại của AntD theme/dark mode).
    // Vẫn ép thêm style an toàn (hex) lên bản clone để chắc chắn không dính theme ngoài.
    return html2canvas(previewRef.current, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      onclone: (doc) => {
        const el = doc.querySelector('[data-export-preview="bang-cong-no"]');
        if (el) {
          el.style.backgroundColor = '#ffffff';
          el.style.color = '#000000';
        }
      },
    });
  }

  async function copyImageToClipboard() {
    setCapturing(true);
    try {
      const canvas = await capturePreviewCanvas();
      await new Promise((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) { reject(new Error('Không tạo được ảnh')); return; }
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            message.success('Đã copy ảnh — dán vào Zalo để gửi khách');
            resolve();
          } catch (err) {
            reject(err);
          }
        }, 'image/png');
      });
    } catch (err) {
      message.warning('Không copy được ảnh, đang tải PNG thay thế...');
      await downloadImagePng();
    } finally {
      setCapturing(false);
    }
  }

  async function downloadImagePng() {
    setCapturing(true);
    try {
      const canvas = await capturePreviewCanvas();
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${meta.ten_kh || 'bang-cong-no'} - ${meta.tieu_de || ''}`.trim().replace(/\s+/g, ' ') + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      message.success('Đã tải ảnh PNG');
    } catch (err) {
      message.error('Lỗi tạo ảnh: ' + err.message);
    } finally {
      setCapturing(false);
    }
  }


  const summary = calcSummaryFromDraft(draft);

  // ─── Render: Màn chính (list) ─────────────────────────────────────────────
  if (step === 'list') {
    return (
      <div style={{ maxWidth: 700, margin: '40px auto', padding: '0 16px' }}>
        <Typography.Title level={4} style={{ marginBottom: 20 }}>
          📄 Bảng công nợ gửi khách
        </Typography.Title>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleFileSelect}>
            <Button type="primary" size="large" icon={<UploadOutlined />} style={{ width: '100%' }}>
              Import file nguồn Excel (Tháng 6.xlsx...)
            </Button>
          </Upload>
          <Button size="large" icon={<PlusOutlined />} style={{ width: '100%' }} onClick={startNew}>
            Tạo bảng trống (nhập tay)
          </Button>
          <Button size="large" icon={<HistoryOutlined />} style={{ width: '100%' }} onClick={() => setShowHistory(true)}>
            Mở bản nháp đã lưu
          </Button>
        </Space>
        <DraftListModal open={showHistory} onClose={() => setShowHistory(false)} onLoad={loadDraft} />
      </div>
    );
  }

  // ─── Render: Màn danh sách khách trong file ───────────────────────────────
  if (step === 'customerList') {
    return (
      <div style={{ padding: '0 4px' }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 12, padding: '8px 12px',
          background: 'var(--header-bg, #fafafa)', borderRadius: 8, border: '1px solid #f0f0f0',
        }}>
          <Space>
            <Button size="small" onClick={() => setStep('list')}>← Quay lại</Button>
            <span style={{ fontSize: 13, color: '#888' }}>
              📎 {importFile?.name} &nbsp;·&nbsp;
              <b>{importRows.length}</b> khách hàng &nbsp;·&nbsp;
              <b>{importParsed.length}</b> dòng phát sinh
            </span>
          </Space>
          <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleFileSelect}>
            <Button size="small" icon={<UploadOutlined />}>Import file khác</Button>
          </Upload>
        </div>

        {/* Bảng danh sách khách */}
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#e6f4ff' }}>
                <th style={thStyle}>Mã KH</th>
                <th style={thStyle}>Tên khách hàng</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Số dòng</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Tổng phát sinh</th>
                <th style={{ ...thStyle }}>Từ ngày</th>
                <th style={{ ...thStyle }}>Đến ngày</th>
                <th style={{ ...thStyle, textAlign: 'center', width: 100 }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {importRows.map((kh, idx) => (
                <tr key={kh.maKH || kh.tenKH}
                  style={{ borderBottom: '1px solid #f0f0f0', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}
                >
                  <td style={tdStyle}>
                    <Tag color={kh.maKH ? 'blue' : 'default'} style={{ fontSize: 11 }}>
                      {kh.maKH || '—'}
                    </Tag>
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{kh.tenKH}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#888' }}>{kh.soDong}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#1677ff' }}>
                    {formatMoney(kh.tongPS)} đ
                  </td>
                  <td style={tdStyle}>{kh.tuNgay ? dayjs(kh.tuNgay).format('DD/MM/YY') : '—'}</td>
                  <td style={tdStyle}>{kh.denNgay ? dayjs(kh.denNgay).format('DD/MM/YY') : '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <Button
                      type="primary" size="small"
                      icon={<FileExcelOutlined />}
                      onClick={() => openCustomer(kh)}
                    >
                      Mở bảng
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DraftListModal open={showHistory} onClose={() => setShowHistory(false)} onLoad={loadDraft} />
      </div>
    );
  }

  // ─── Render: Màn soạn bảng ────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 4px' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12, flexWrap: 'wrap', gap: 8,
        background: 'var(--header-bg, #fafafa)', padding: '8px 12px',
        borderRadius: 8, border: '1px solid #f0f0f0',
      }}>
        <Space wrap>
          <Button size="small" onClick={() => setStep(importParsed.length > 0 ? 'customerList' : 'list')}>
            ← {importParsed.length > 0 ? 'Danh sách khách' : 'Quay lại'}
          </Button>
          <Tag color={draftId ? 'blue' : 'default'} style={{ margin: 0 }}>
            {draftId ? `#${draftId}` : 'Chưa lưu'}
          </Tag>
          {meta.source_file_name && (
            <span style={{ fontSize: 12, color: '#888' }}>📎 {meta.source_file_name}</span>
          )}
        </Space>
        <Space wrap>
          <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleFileSelect}>
            <Button size="small" icon={<FileExcelOutlined />}>Import thêm</Button>
          </Upload>
          <Button size="small" icon={<ReloadOutlined />} loading={loadingMisa}
            onClick={fetchMisaData} disabled={!meta.ma_kh}
            title={!meta.ma_kh ? 'Cần có Mã KH để lấy dữ liệu MISA' : ''}>
            Lấy dữ liệu MISA
          </Button>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setShowHistory(true)}>
            Mở bản khác
          </Button>
          <Button type="primary" size="small" icon={<SaveOutlined />}
            loading={saving} onClick={saveDraft}>
            {draftId ? 'Cập nhật nháp' : 'Lưu nháp'}
          </Button>
          <Divider type="vertical" style={{ margin: '0 4px' }} />
          <Button size="small" icon={<FileExcelOutlined />} loading={exporting}
            onClick={exportExcel} title="Tải file Excel gửi khách theo form mẫu">
            Export Excel
          </Button>
          <Button size="small" icon={<CameraOutlined />} loading={capturing}
            onClick={copyImageToClipboard} title="Chụp bảng gửi khách và copy vào clipboard để dán Zalo">
            Copy ảnh gửi Zalo
          </Button>
          <Button size="small" icon={<DownloadOutlined />} loading={capturing}
            onClick={downloadImagePng} title="Tải ảnh PNG bảng gửi khách">
            Tải PNG
          </Button>
        </Space>
      </div>

      {/* Meta info */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Input
          placeholder="Tên khách hàng *"
          value={meta.ten_kh}
          onChange={e => setMeta(m => ({ ...m, ten_kh: e.target.value }))}
          style={{ flex: 2, minWidth: 180 }}
          size="small"
        />
        <Input
          placeholder="Mã KH (vd: KH00299)"
          value={meta.ma_kh}
          onChange={e => setMeta(m => ({ ...m, ma_kh: e.target.value.trim() }))}
          style={{ width: 130 }}
          size="small"
          suffix={meta.ma_kh
            ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
            : <Tooltip title="Cần mã KH để lấy dữ liệu MISA"><ExclamationCircleOutlined style={{ color: '#faad14' }} /></Tooltip>
          }
        />
        <Input
          placeholder="Tiêu đề bảng (vd: Ô TÔ CHÚ TÁM - T6.2026)"
          value={meta.tieu_de}
          onChange={e => setMeta(m => ({ ...m, tieu_de: e.target.value }))}
          style={{ flex: 3, minWidth: 200 }}
          size="small"
        />
        <DatePicker.RangePicker
          size="small"
          value={[
            meta.tu_ngay  ? dayjs(meta.tu_ngay)  : null,
            meta.den_ngay ? dayjs(meta.den_ngay) : null,
          ]}
          onChange={(dates) => setMeta(m => ({
            ...m,
            tu_ngay:  dates?.[0]?.format('YYYY-MM-DD') || '',
            den_ngay: dates?.[1]?.format('YYYY-MM-DD') || '',
          }))}
          format="DD/MM/YYYY"
          style={{ minWidth: 220 }}
        />
      </div>

      {/* Sections */}
      <DauKySection
        rows={draft.dau_ky_rows}
        allocations={draft.allocations}
        onChange={rows => setDraft(d => ({ ...d, dau_ky_rows: rows }))}
      />
      <PhatSinhSection
        rows={draft.phat_sinh_rows}
        allocations={draft.allocations}
        onChange={rows => setDraft(d => ({ ...d, phat_sinh_rows: rows }))}
      />
      <ThanhToanSection
        rows={draft.thanh_toan_rows}
        allocations={draft.allocations}
        onChange={rows => setDraft(d => ({ ...d, thanh_toan_rows: rows }))}
      />
      <DieuChinhSection
        rows={draft.dieu_chinh_rows}
        onChange={rows => setDraft(d => ({ ...d, dieu_chinh_rows: rows }))}
      />

      {/* Phase 3: Gợi ý đối trừ thanh toán */}
      <DoiTruSection
        draft={draft}
        onChange={allocations => setDraft(d => ({ ...d, allocations }))}
      />

      {/* Reconcile */}
      <ReconcileBox
        summary={summary}
        cuoiKyMisa={cuoiKyMisa}
        onChange={setCuoiKyMisa}
      />

      <DraftListModal open={showHistory} onClose={() => setShowHistory(false)} onLoad={loadDraft} />
      <PreviewKhachHang ref={previewRef} draft={draft} meta={meta} />
    </div>
  );
}

// ─── Style constants ──────────────────────────────────────────────────────────
const thStyle = {
  padding: '6px 8px', textAlign: 'left',
  fontWeight: 600, fontSize: 12, borderBottom: '1px solid #d9d9d9',
};
const tdStyle = {
  padding: '3px 6px', fontSize: 13, verticalAlign: 'middle',
};
