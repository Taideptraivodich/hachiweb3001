const ExcelJS = require('exceljs');

// ─── Helpers ────────────────────────────────────────────────────────────────
function round(n) { return Math.round(Number(n) || 0); }

function fmtDateVN(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// "Công nợ tháng X mang sang" — tính theo tháng TRƯỚC tháng bắt đầu của kỳ.
// Không bao giờ ghi nguồn nội bộ (MISA...) ra file gửi khách.
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

// ─── Đối trừ (allocations) ──────────────────────────────────────────────────
// Chỉ allocation status = accepted hoặc manual mới được áp dụng vào export.
// suggested/ignored KHÔNG ảnh hưởng số liệu hiển thị cho khách.
function getCommittedForTarget(allocations, target_type, target_id) {
  return (allocations || [])
    .filter(a => (a.status === 'accepted' || a.status === 'manual')
      && a.target_type === target_type && a.target_id === target_id)
    .reduce((s, a) => s + round(a.amount), 0);
}
function getCommittedForPayment(allocations, payment_id) {
  return (allocations || [])
    .filter(a => (a.status === 'accepted' || a.status === 'manual') && a.payment_id === payment_id)
    .reduce((s, a) => s + round(a.amount), 0);
}

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']; // NGÀY,MÃ SP,TÊN SP,ĐVT,SL,ĐƠN GIÁ,THÀNH TIỀN
// Border đen — dùng cho header, tổng, cuối kỳ
const THIN   = { style: 'thin',   color: { argb: 'FF000000' } };
const MEDIUM = { style: 'medium', color: { argb: 'FF000000' } };
// Border rất nhạt — gridline dữ liệu thường, mắt không bị hút vào đường kẻ
const LIGHT_GRID = { style: 'thin', color: { argb: 'FFB7B7B7' } };

// Gridline dòng dữ liệu thường — nhạt, không gây nặng mắt
function setDataBorder(row) {
  COLS.forEach(c => { row.getCell(c).border = { top: LIGHT_GRID, left: LIGHT_GRID, right: LIGHT_GRID, bottom: LIGHT_GRID }; });
}

// Header — thin đen, border bottom medium để phân biệt rõ với data
function setHeaderBorder(row) {
  COLS.forEach(c => { row.getCell(c).border = { top: THIN, left: THIN, right: THIN, bottom: MEDIUM }; });
}

const FONT_TITLE  = { name: 'Times New Roman', size: 16, bold: true };
const FONT_HEADER = { name: 'Times New Roman', size: 10, bold: true };
const FONT_DATA   = { name: 'Times New Roman', size: 9 };
const FONT_DATA_B = { name: 'Times New Roman', size: 9, bold: true };
const MONEY_FMT = '#,##0';

// ─── Main builder ───────────────────────────────────────────────────────────
function buildBangCongNoWorkbook(draftRow) {
  const draft = typeof draftRow.draft_json === 'string'
    ? JSON.parse(draftRow.draft_json || '{}')
    : (draftRow.draft_json || {});

  const tieuDe = draftRow.tieu_de || draft?.meta?.title || draftRow.ten_kh || 'BẢNG CÔNG NỢ';
  const allocations = draft.allocations || [];
  const tuNgay = draftRow.tu_ngay || draft?.meta?.tu_ngay;

  // ── Áp đối trừ (chỉ accepted/manual) lên từng nguồn khoản nợ/thanh toán ───
  // Đầu kỳ: ẩn nếu đã đối trừ hết, hiện phần còn lại nếu đối trừ 1 phần.
  const dauKyRows = (draft.dau_ky_rows || [])
    .filter(r => !r.deleted)
    .map(r => {
      const original = round(r.so_tien);
      const committed = getCommittedForTarget(allocations, 'dau_ky', r.id);
      return { ...r, _remaining: Math.max(0, original - committed) };
    })
    .filter(r => r._remaining > 0);

  // Phát sinh: ẩn dòng đã đối trừ hết, THÀNH TIỀN = phần còn lại nếu đối trừ 1 phần.
  const phatSinhRows = (draft.phat_sinh_rows || [])
    .filter(r => !r.deleted && r.export_visible !== false)
    .map(r => {
      const original = round(r.sl) * round(r.don_gia);
      const committed = getCommittedForTarget(allocations, 'phat_sinh', r.id);
      return { ...r, _remaining: Math.max(0, original - committed) };
    })
    .filter(r => r._remaining > 0);

  // Thanh toán: chỉ hiện phần CÒN DƯ chưa dùng để đối trừ.
  const thanhToanRows = (draft.thanh_toan_rows || [])
    .filter(r => !r.deleted)
    .map(r => {
      const original = round(r.so_tien);
      const committed = getCommittedForPayment(allocations, r.id);
      return { ...r, _remaining: Math.max(0, original - committed) };
    })
    .filter(r => r._remaining > 0);

  // Điều chỉnh tăng: tham gia đối trừ giống khoản nợ khác.
  // Điều chỉnh giảm: không tham gia đối trừ, giữ nguyên.
  const dieuChinhRows = (draft.dieu_chinh_rows || [])
    .filter(r => !r.deleted)
    .map(r => {
      const original = round(r.so_tien);
      if (r.direction === 'tang') {
        const committed = getCommittedForTarget(allocations, 'dieu_chinh', r.id);
        return { ...r, _remaining: Math.max(0, original - committed) };
      }
      return { ...r, _remaining: original };
    })
    .filter(r => r._remaining > 0);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bảng CN', { properties: { defaultRowHeight: 16 } });

  ws.columns = [
    { width: 12 },  // NGÀY
    { width: 16 },  // MÃ SP
    { width: 40 },  // TÊN SẢN PHẨM
    { width: 8 },   // ĐVT
    { width: 7 },   // SL
    { width: 13 },  // ĐƠN GIÁ
    { width: 14 },  // THÀNH TIỀN
  ];

  let r = 1;

  // ── Row 1: Tiêu đề ──────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:G${r}`);
  const titleCell = ws.getCell(`A${r}`);
  titleCell.value = tieuDe;
  titleCell.font = FONT_TITLE;
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 24;
  r++;

  // ── Row 2: Header ───────────────────────────────────────────────────────
  const headerRow = ws.getRow(r);
  const headers = ['NGÀY', 'MÃ SP', 'TÊN SẢN PHẨM', 'ĐVT', 'SL', 'ĐƠN GIÁ', 'THÀNH TIỀN'];
  headers.forEach((h, i) => { headerRow.getCell(COLS[i]).value = h; });
  headerRow.eachCell(cell => {
    cell.font = FONT_HEADER;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  setHeaderBorder(headerRow);
  r++;

  // ── Nhóm phát sinh theo ngày ─────────────────────────────────────────────
  const byDate = new Map();
  const order = [];
  phatSinhRows.forEach(row => {
    const key = row.ngay || '';
    if (!byDate.has(key)) { byDate.set(key, []); order.push(key); }
    byDate.get(key).push(row);
  });
  order.sort((a, b) => a.localeCompare(b));

  const subtotalCells = [];

  order.forEach(dateKey => {
    const rows = byDate.get(dateKey);
    const groupStartRow = r;

    rows.forEach((row, idx) => {
      const xr = ws.getRow(r);

      // Cột A: chỉ set ở dòng đầu tiên — các dòng còn lại để trống,
      // sau vòng lặp sẽ merge A[groupStartRow]:A[groupStartRow+len-1]
      if (idx === 0) {
        xr.getCell('A').value = dateKey ? new Date(dateKey) : '';
        xr.getCell('A').numFmt = 'dd/mm/yyyy';
        xr.getCell('A').alignment = { horizontal: 'center', vertical: 'top' };
      }

      // Set từng cell riêng — KHÔNG dùng row.font để tránh side effect
      xr.getCell('B').value = row.ma_sp || '';
      xr.getCell('C').value = row.ten_sp || '';
      xr.getCell('D').value = row.dvt || '';
      xr.getCell('E').value = round(row.sl);
      xr.getCell('F').value = round(row.don_gia);
      xr.getCell('F').numFmt = MONEY_FMT;
      xr.getCell('G').value = row._remaining;
      xr.getCell('G').numFmt = MONEY_FMT;

      // Font từng cell
      ['A','B','C','D','E','F','G'].forEach(c => { xr.getCell(c).font = FONT_DATA; });
      xr.getCell('D').alignment = { horizontal: 'center' };
      xr.getCell('E').alignment = { horizontal: 'right' };
      xr.getCell('F').alignment = { horizontal: 'right' };
      xr.getCell('G').alignment = { horizontal: 'right' };

      setDataBorder(xr);
      r++;
    });

    // Merge cột NGÀY theo nhóm (nếu > 1 dòng)
    if (rows.length > 1) {
      ws.mergeCells(`A${groupStartRow}:A${r - 1}`);
      ws.getCell(`A${groupStartRow}`).alignment = { horizontal: 'center', vertical: 'top' };
    }

    // ── Dòng Cộng ngày ──────────────────────────────────────────────────
    // QUAN TRỌNG: phải set value cell C TRƯỚC khi gọi mergeCells,
    // nếu không ExcelJS sẽ broadcast value sang D:F khi đọc lại.
    const subtotalRowNum = r;
    const dateLabel = dateKey
      ? `Cộng ngày ${dateKey.slice(8,10)}/${dateKey.slice(5,7)}/${dateKey.slice(0,4)}`
      : 'Cộng ngày';

    // Để A:B trống hoàn toàn — không set value, không set font row-level
    ws.getCell(`A${subtotalRowNum}`).value = null;
    ws.getCell(`B${subtotalRowNum}`).value = null;

    // Set giá trị C trước, rồi mới merge C:F
    ws.getCell(`C${subtotalRowNum}`).value = dateLabel;
    ws.mergeCells(`C${subtotalRowNum}:F${subtotalRowNum}`);
    ws.getCell(`C${subtotalRowNum}`).font = FONT_DATA;
    ws.getCell(`C${subtotalRowNum}`).alignment = { horizontal: 'right', vertical: 'middle' };

    // G — số tiền cộng ngày
    ws.getCell(`G${subtotalRowNum}`).value = { formula: `SUM(G${groupStartRow}:G${r - 1})` };
    ws.getCell(`G${subtotalRowNum}`).numFmt = MONEY_FMT;
    ws.getCell(`G${subtotalRowNum}`).font = FONT_DATA_B;
    ws.getCell(`G${subtotalRowNum}`).alignment = { horizontal: 'right' };

    // Border: chỉ bottom medium — không đóng khung, dòng thoáng như separator
    ['A','B','C','D','E','F','G'].forEach(c => {
      ws.getCell(`${c}${subtotalRowNum}`).border = { bottom: MEDIUM };
    });

    subtotalCells.push(`G${subtotalRowNum}`);
    r++;
  });

  if (order.length === 0) {
    // Không có phát sinh: vẫn để 1 dòng trống để TỔNG không lỗi
    const emptyRow = ws.getRow(r);
    setDataBorder(emptyRow);
    r++;
  }

  // ── TỔNG phát sinh ───────────────────────────────────────────────────────
  const tongRow = ws.getRow(r);
  ws.mergeCells(`A${r}:F${r}`);
  tongRow.getCell('A').value = 'TỔNG';
  tongRow.getCell('A').alignment = { horizontal: 'right' };
  tongRow.getCell('G').value = subtotalCells.length
    ? { formula: subtotalCells.join('+') }
    : 0;
  tongRow.getCell('G').numFmt = MONEY_FMT;
  tongRow.font = FONT_DATA_B;
  tongRow.getCell('G').alignment = { horizontal: 'right' };
  // Dòng TỔNG: top+bottom medium — nổi bật rõ hơn subtotal
  COLS.forEach(c => {
    tongRow.getCell(c).border = { top: MEDIUM, left: THIN, right: THIN, bottom: MEDIUM };
  });
  const tongRowNum = r;
  r++;

  // ── Đầu kỳ / Thanh toán / Điều chỉnh (đã áp đối trừ) ─────────────────────
  const summaryRefs = { plus: [`G${tongRowNum}`], minus: [] };

  function addSummaryLine(label) {
    const row = ws.getRow(r);
    ws.mergeCells(`A${r}:F${r}`);
    row.getCell('A').value = label;
    row.getCell('A').alignment = { horizontal: 'right' };
    row.font = FONT_DATA;
    row.getCell('G').numFmt = MONEY_FMT;
    row.getCell('G').alignment = { horizontal: 'right' };
    const cellRef = `G${r}`;
    r++;
    return cellRef;
  }

  dauKyRows.forEach(row => {
    const cellRef = addSummaryLine(getDauKyLabel(tuNgay));
    ws.getCell(cellRef).value = row._remaining;
    summaryRefs.plus.push(cellRef);
  });

  thanhToanRows.forEach(row => {
    const label = row.ngay ? `Thanh toán ngày ${fmtDateVN(row.ngay)}` : (row.mo_ta || 'Thanh toán');
    const cellRef = addSummaryLine(label);
    ws.getCell(cellRef).value = row._remaining;
    summaryRefs.minus.push(cellRef);
  });

  dieuChinhRows.forEach(row => {
    const isTang = row.direction === 'tang';
    const label = `${isTang ? 'Điều chỉnh tăng' : 'Điều chỉnh giảm'}${row.mo_ta ? ' — ' + row.mo_ta : ''}${row.ngay ? ' ' + fmtDateVN(row.ngay) : ''}`;
    const cellRef = addSummaryLine(label);
    ws.getCell(cellRef).value = row._remaining;
    if (isTang) summaryRefs.plus.push(cellRef); else summaryRefs.minus.push(cellRef);
  });

  // ── Dòng cuối: CÔNG NỢ CÒN PHẢI THANH TOÁN ───────────────────────────────
  const denNgay = draftRow.den_ngay || draft?.meta?.den_ngay || draft?.meta?.period_to;
  const finalLabel = `CÔNG NỢ CÒN PHẢI THANH TOÁN${denNgay ? ' ĐẾN ' + fmtDateVN(denNgay) : ''}`;
  const finalRow = ws.getRow(r);
  ws.mergeCells(`A${r}:F${r}`);
  finalRow.getCell('A').value = finalLabel;
  finalRow.getCell('A').alignment = { horizontal: 'right' };
  const formulaParts = [
    ...summaryRefs.plus,
    ...summaryRefs.minus.map(c => `-${c}`),
  ];
  finalRow.getCell('G').value = { formula: formulaParts.join('+').replace(/\+-/g, '-') };
  finalRow.getCell('G').numFmt = MONEY_FMT;
  finalRow.font = { name: 'Times New Roman', size: 10, bold: true };
  finalRow.getCell('G').alignment = { horizontal: 'right' };
  finalRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
  });
  // Dòng cuối nổi bật nhất: border top+bottom medium
  COLS.forEach(c => {
    finalRow.getCell(c).border = { top: MEDIUM, left: THIN, right: THIN, bottom: MEDIUM };
  });

  return wb;
}

module.exports = { buildBangCongNoWorkbook, getDauKyLabel };
