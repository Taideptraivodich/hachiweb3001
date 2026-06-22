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

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']; // NGÀY,MÃ SP,TÊN SP,ĐVT,SL,ĐƠN GIÁ,THÀNH TIỀN
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const MEDIUM = { style: 'medium', color: { argb: 'FF000000' } };

function setBorder(row, style) {
  COLS.forEach(c => {
    row.getCell(c).border = { top: style.top, left: THIN, right: THIN, bottom: style.bottom };
  });
}

function setFullThinBorder(row) {
  COLS.forEach(c => { row.getCell(c).border = { top: THIN, left: THIN, right: THIN, bottom: THIN }; });
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

  const dauKyRows    = (draft.dau_ky_rows || []).filter(r => !r.deleted && round(r.so_tien) !== 0);
  const phatSinhRows = (draft.phat_sinh_rows || []).filter(r => !r.deleted && r.export_visible !== false);
  const thanhToanRows = (draft.thanh_toan_rows || []).filter(r => !r.deleted && round(r.so_tien) !== 0);
  const dieuChinhRows = (draft.dieu_chinh_rows || []).filter(r => !r.deleted && round(r.so_tien) !== 0);

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
  setFullThinBorder(headerRow);
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
      if (idx === 0) {
        xr.getCell('A').value = dateKey ? new Date(dateKey) : '';
        xr.getCell('A').numFmt = 'dd/mm/yyyy';
      }
      xr.getCell('B').value = row.ma_sp || '';
      xr.getCell('C').value = row.ten_sp || '';
      xr.getCell('D').value = row.dvt || '';
      xr.getCell('E').value = round(row.sl);
      xr.getCell('F').value = round(row.don_gia);
      xr.getCell('F').numFmt = MONEY_FMT;
      xr.getCell('G').value = { formula: `E${r}*F${r}` };
      xr.getCell('G').numFmt = MONEY_FMT;

      xr.font = FONT_DATA;
      xr.getCell('A').alignment = { horizontal: 'center' };
      xr.getCell('D').alignment = { horizontal: 'center' };
      xr.getCell('E').alignment = { horizontal: 'right' };
      xr.getCell('F').alignment = { horizontal: 'right' };
      xr.getCell('G').alignment = { horizontal: 'right' };
      setFullThinBorder(xr);
      r++;
    });

    // Subtotal row (chỉ có giá trị ở cột G)
    const subtotalRow = ws.getRow(r);
    subtotalRow.getCell('G').value = { formula: `SUM(G${groupStartRow}:G${r - 1})` };
    subtotalRow.getCell('G').numFmt = MONEY_FMT;
    subtotalRow.getCell('G').font = FONT_DATA_B;
    subtotalRow.getCell('G').alignment = { horizontal: 'right' };
    setBorder(subtotalRow, { top: MEDIUM, bottom: MEDIUM });
    subtotalCells.push(`G${r}`);
    r++;
  });

  if (order.length === 0) {
    // Không có phát sinh: vẫn để 1 dòng trống để TỔNG không lỗi
    const emptyRow = ws.getRow(r);
    setFullThinBorder(emptyRow);
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
  setFullThinBorder(tongRow);
  const tongRowNum = r;
  r++;

  // ── Đầu kỳ / Thanh toán / Điều chỉnh ─────────────────────────────────────
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
    const cellRef = addSummaryLine(row.mo_ta || 'Công nợ kỳ trước mang sang');
    ws.getCell(cellRef).value = round(row.so_tien);
    summaryRefs.plus.push(cellRef);
  });

  thanhToanRows.forEach(row => {
    const label = row.ngay ? `Thanh toán ngày ${fmtDateVN(row.ngay)}` : (row.mo_ta || 'Thanh toán');
    const cellRef = addSummaryLine(label);
    ws.getCell(cellRef).value = round(row.so_tien);
    summaryRefs.minus.push(cellRef);
  });

  dieuChinhRows.forEach(row => {
    const isTang = row.direction === 'tang';
    const label = `${isTang ? 'Điều chỉnh tăng' : 'Điều chỉnh giảm'}${row.mo_ta ? ' — ' + row.mo_ta : ''}${row.ngay ? ' ' + fmtDateVN(row.ngay) : ''}`;
    const cellRef = addSummaryLine(label);
    ws.getCell(cellRef).value = round(row.so_tien);
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
  setFullThinBorder(finalRow);

  return wb;
}

module.exports = { buildBangCongNoWorkbook };
