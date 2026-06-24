import * as XLSX from 'xlsx';

/**
 * Format datetime string (SQLite "YYYY-MM-DD HH:MM:SS" or ISO) → "DD/MM/YYYY HH:MM"
 */
function fmtDatetime(val) {
  if (!val) return '';
  // Chuẩn hóa: SQLite trả "2026-06-24 08:18:00", có thể thiếu giây
  const s = String(val).replace('T', ' ').slice(0, 16); // "YYYY-MM-DD HH:MM"
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return val;
  const [, y, mo, d, h, min] = m;
  return `${d}/${mo}/${y} ${h}:${min}`;
}

/**
 * exportOrdersExcel
 * @param {Array}  rows     - flat rows từ GET /orders/export-data
 * @param {Object} filters  - { from, to } để đặt tên file
 */
export function exportOrdersExcel(rows, filters = {}) {
  const HEADERS = [
    'No.',
    'Mã Đơn Hàng',
    'Mã Khách Hàng',
    'Tên Khách Hàng',
    'Mã Sản Phẩm',
    'Tên Sản Phẩm',
    'Hãng Sản Xuất',
    'Nhà Cung Cấp',
    'Đơn Vị Tính',
    'Giá Vốn',
    'Đơn Giá',
    'Số Lượng',
    'Thành Tiền',
    'Tổng Giá Vốn',
    'Ghi Chú',
    'Ngày Tạo',
    'Ngày Cập Nhật',
    'Người Tạo',
    'Người Cập Nhật',
    'Updated',
  ];

  const dataRows = rows.map((r, idx) => {
    const tenSanPham = r.ten_hang_hien_thi || r.ten_hang || '';
    const ghiChu     = r.ghi_chu_dong || r.ghi_chu_phieu || '';
    const donGia     = Number(r.don_gia_ban)  || 0;
    const giaVon     = Number(r.gia_von)      || 0;
    const soLuong    = Number(r.so_luong)     || 0;
    const thanhTien  = donGia * soLuong;
    const tongGiaVon = giaVon * soLuong;

    return [
      idx + 1,
      r.ma_don          || '',
      r.ma_kh           || '',
      r.ten_kh          || '',
      r.ma_hang         || '',
      tenSanPham,
      r.hang_san_xuat   || '',
      r.nha_cung_cap    || '',
      r.dvt             || '',
      giaVon,
      donGia,
      soLuong,
      thanhTien,
      tongGiaVon,
      ghiChu,
      fmtDatetime(r.created_at),
      fmtDatetime(r.updated_at),
      '',  // Người Tạo — chưa có user system
      '',  // Người Cập Nhật
      '',  // Updated
    ];
  });

  const wsData = [HEADERS, ...dataRows];
  const ws     = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths (chars)
  ws['!cols'] = [
    { wch: 5  },  // No.
    { wch: 14 },  // Mã Đơn Hàng
    { wch: 12 },  // Mã Khách Hàng
    { wch: 22 },  // Tên Khách Hàng
    { wch: 16 },  // Mã Sản Phẩm
    { wch: 30 },  // Tên Sản Phẩm
    { wch: 14 },  // Hãng Sản Xuất
    { wch: 10 },  // Nhà Cung Cấp
    { wch: 10 },  // ĐVT
    { wch: 12 },  // Giá Vốn
    { wch: 12 },  // Đơn Giá
    { wch: 8  },  // Số Lượng
    { wch: 14 },  // Thành Tiền
    { wch: 14 },  // Tổng Giá Vốn
    { wch: 20 },  // Ghi Chú
    { wch: 18 },  // Ngày Tạo
    { wch: 18 },  // Ngày Cập Nhật
    { wch: 14 },  // Người Tạo
    { wch: 14 },  // Người Cập Nhật
    { wch: 10 },  // Updated
  ];

  // Freeze row 1
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');

  // Tên file theo filter ngày
  let fileSuffix = '';
  if (filters.from && filters.to) {
    fileSuffix = `_${filters.from.replace(/-/g,'')}_${filters.to.replace(/-/g,'')}`;
  } else {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    fileSuffix = `_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  }
  const fileName = `Danh_sach_phieu_xuat${fileSuffix}.xlsx`;

  XLSX.writeFile(wb, fileName);
}
