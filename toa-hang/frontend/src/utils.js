import dayjs from 'dayjs';

// Format tiền VND
export function formatMoney(n) {
  if (!n) return '0';
  return Number(n).toLocaleString('vi-VN');
}

// Format số lượng
export function formatQty(n) {
  const num = parseFloat(n);
  return Number.isInteger(num) ? String(num) : String(num);
}

// Generate nội dung gửi khách (template mới)
// MĐ: {ma_don} EM GỬI ĐƠN HÀNG {ten_kh}, {ma_kh}
export function generateNdGuiKhach(order) {
  const maDon  = (order.ma_don  || '').trim();
  const tenKh  = (order.ten_kh  || '').trim().toUpperCase();
  const maKh   = (order.ma_kh   || '').trim();
  return `MĐ: ${maDon} EM GỬI ĐƠN HÀNG ${tenKh}, ${maKh}`;
}

// Sinh text toa hàng cũ (giữ lại để dùng phụ)
export function generateTextToa(order) {
  const lines = [];
  const tenKh = (order.ten_kh || '').toUpperCase();
  lines.push(`TOA HÀNG ${tenKh} số ${order.ma_toa}`);
  if (order.so_khung) lines.push(`${order.so_khung}:`);
  (order.details || []).forEach(d => {
    const ma   = d.ma_hang  ? `${d.ma_hang} ` : '';
    const ten  = d.ten_hang_hien_thi || d.ten_hang || '';
    const sl   = d.so_luong || '';
    const dvt  = d.dvt ? ` ${d.dvt}` : '';
    const gia  = d.don_gia_ban ? ` x ${Number(d.don_gia_ban).toLocaleString('vi-VN')}` : '';
    const ghichudong = d.ghi_chu ? ` ${d.ghi_chu}` : '';
    lines.push(`(${ma}) ${ten} x ${sl}${dvt}${gia}${ghichudong}`);
  });
  if (order.nha_cc)      lines.push(`hàng ${order.nha_cc},`);
  if (order.noi_gui_hang) lines.push(`${order.noi_gui_hang}`);
  if (order.ghi_chu)     lines.push(order.ghi_chu);
  return lines.filter(Boolean).join('\n');
}

// Tính tổng tiền
export function calcTotal(details) {
  if (!details) return 0;
  return details.reduce((sum, d) => {
    return sum + (parseFloat(d.so_luong || 0) * parseFloat(d.don_gia_ban || 0));
  }, 0);
}

// Màu trạng thái
export const STATUS_COLOR = {
  'Đang xử lý':    'processing',
  'Đã hoàn thành': 'success',
  'Đã hủy':        'error',
};
