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

// Sinh text toa hàng để gửi Zalo
// Format:
// TOA HÀNG (TÊN KH) số (SỐ TOA)
// (SỐ KHUNG NẾU CÓ):
// (MÃ) (TÊN) x (SL) x (ĐƠN GIÁ)
// hàng (NHÀ CC),
// chành (NƠI GỬI)
export function generateTextToa(order) {
  const lines = [];

  // Dòng tiêu đề
  const tenKh = (order.ten_kh || '').toUpperCase();
  lines.push(`TOA HÀNG ${tenKh} số ${order.ma_toa}`);

  // Số khung xe nếu có (lấy từ ghi_chu nếu có tiền tố "khung:" hoặc "xe:")
  // Hoặc dùng field riêng nếu có
  if (order.so_khung) {
    lines.push(`${order.so_khung}:`);
  }

  // Từng mặt hàng
  (order.details || []).forEach(d => {
    const ma   = d.ma_hang  ? `${d.ma_hang} ` : '';
    const ten  = d.ten_hang || '';
    const sl   = d.so_luong || '';
    const dvt  = d.don_vi   ? ` ${d.don_vi}` : '';
    const ghichudong   = d.ghi_chu ? `${d.ghi_chu}` : '';
    const gia  = d.don_gia_ban
      ? ` x ${Number(d.don_gia_ban).toLocaleString('vi-VN')}`
      : '';
    lines.push(`(${ma}) ${ten} x ${sl}${dvt}${gia} ${ghichudong}`);
  });

  // Nhà cung cấp / ghi chú hàng
  if (order.nha_cc) {
    lines.push(`hàng ${order.nha_cc},`);
  }

  // Nơi gửi
  if (order.noi_gui_hang) {
    lines.push(`${order.noi_gui_hang}`);
  }

  // Ghi chú chung
  if (order.ghi_chu) {
    lines.push(order.ghi_chu);
  }

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
  'Đang xử lý':   'processing',
  'Đã hoàn thành': 'success',
  'Đã hủy':       'error',
};
