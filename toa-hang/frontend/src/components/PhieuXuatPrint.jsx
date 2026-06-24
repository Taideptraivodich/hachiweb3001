/**
 * PhieuXuatPrint.jsx
 * Template phiếu xuất kho bán hàng — dùng cho:
 *   1. In phiếu giấy (window.print())
 *   2. Copy ảnh phiếu (html2canvas-pro → clipboard)
 *   3. Tải ảnh phiếu (html2canvas-pro → download PNG)
 *
 * Layout bám sát PDF mẫu công ty (A4 ngang). Không phụ thuộc layout màn app —
 * render riêng biệt trong hidden div, dùng cùng 1 component nguồn cho cả 3 chức năng.
 * Màu sắc: hex/rgb thuần, không dùng oklab/oklch/color-mix.
 */

import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Space, message, Spin } from 'antd';
import { PrinterOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
// html2canvas-pro: đã có sẵn trong package.json/package-lock.json (dùng chung với
// BangCongNo.jsx). Hỗ trợ oklab/oklch/color-mix nên không bị lỗi
// "Attempting to parse an unsupported color function" như html2canvas thường (CDN).
import html2canvas from 'html2canvas-pro';
import dayjs from 'dayjs';
import { formatMoney, calcTotal } from '../utils';
import hachiLogo from '../assets/hachi-logo.png';

// ── Bảng màu lấy đúng từ PDF mẫu ───────────────────────────────────────────
const DARK_SLATE = '#2c3e50';  // tên công ty + title "PHIẾU XUẤT KHO BÁN HÀNG"
const ACCENT_BLUE = '#0070c0'; // label các dòng (Địa chỉ:, SĐT:, Tên khách hàng:...)
const HEADER_BG = '#dbe9f4';   // nền header bảng
const BORDER_GRAY = '#aaaaaa';
const TOTAL_BG = '#f5f5f5';

// ── Styles nhúng thẳng vào component (tránh bị Ant Design override) ──────────
const styles = {
  wrapper: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '13px',
    color: '#111',
    background: '#fff',
    width: '297mm',
    minHeight: '210mm',
    padding: '12mm 16mm',
    boxSizing: 'border-box',
    position: 'relative',
    fontSynthesis: 'none',
    WebkitFontSmoothing: 'antialiased',
    textRendering: 'optimizeLegibility',
  },
  companyName: {
    fontSize: '20px',
    fontWeight: '700',
    color: DARK_SLATE,
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: '0',
    marginBottom: '10px',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    marginBottom: '14px',
  },
  logoImg: {
    width: '88px',
    height: '88px',
    objectFit: 'contain',
    flexShrink: 0,
  },
  companyMeta: {
    fontSize: '12px',
    color: '#222',
    lineHeight: '1.7',
    paddingTop: '4px',
  },
  companyMetaLabel: {
    fontWeight: '700',
    color: ACCENT_BLUE,
  },
  titleBlock: {
    textAlign: 'center',
    margin: '4px 0 14px 0',
  },
  titleMain: {
    fontSize: '24px',
    fontWeight: '700',
    letterSpacing: '0',
    textTransform: 'uppercase',
    color: DARK_SLATE,
  },
  titleSub: {
    fontSize: '13px',
    color: '#000',
    marginTop: '8px',
  },
  titleMaDon: {
    fontSize: '13px',
    color: '#000',
    marginTop: '2px',
  },
  customerBlock: {
    marginBottom: '14px',
    lineHeight: '1.7',
  },
  customerLine: {
    fontSize: '13px',
  },
  customerLabel: {
    color: ACCENT_BLUE,
    fontWeight: '700',
  },
  customerValueStrong: {
    color: '#111',
    fontWeight: '700',
  },
  customerValue: {
    color: '#111',
    fontWeight: '400',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '10px',
    fontSize: '12.5px',
  },
  thCell: {
    background: HEADER_BG,
    color: '#111',
    fontWeight: '700',
    border: `1px solid ${BORDER_GRAY}`,
    padding: '6px 8px',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  },
  tdCell: {
    border: `1px solid ${BORDER_GRAY}`,
    padding: '6px 8px',
    verticalAlign: 'middle',
  },
  tdCenter: {
    border: `1px solid ${BORDER_GRAY}`,
    padding: '6px 8px',
    textAlign: 'center',
    verticalAlign: 'middle',
  },
  tdRight: {
    border: `1px solid ${BORDER_GRAY}`,
    padding: '6px 8px',
    textAlign: 'right',
    verticalAlign: 'middle',
  },
  totalLabelCell: {
    border: `1px solid ${BORDER_GRAY}`,
    background: TOTAL_BG,
    padding: '7px 8px',
    textAlign: 'right',
    fontWeight: '700',
    fontSize: '12.5px',
    color: '#111',
  },
  totalValueCell: {
    border: `1px solid ${BORDER_GRAY}`,
    background: TOTAL_BG,
    padding: '7px 8px',
    textAlign: 'right',
    fontWeight: '700',
    fontSize: '12.5px',
    color: '#111',
  },
  note: {
    fontSize: '12px',
    color: '#111',
    fontStyle: 'normal',
    marginBottom: '30px',
    marginTop: '6px',
  },
  signatureRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '6px',
    textAlign: 'center',
  },
  signatureCell: {
    flex: 1,
    fontSize: '13px',
    color: '#111',
  },
  signatureLabel: {
    fontWeight: '700',
    marginBottom: '2px',
  },
  signatureNote: {
    fontSize: '12px',
    color: '#333',
    fontStyle: 'normal',
  },
  signatureSpace: {
    height: '50px',
  },
};

// ── Component phiếu (dùng để render hidden + print) ──────────────────────────
export function PhieuXuatTemplate({ order }) {
  const details  = order.details || [];
  const total    = calcTotal(details);
  const ngayText = order.ngay_tao
    ? dayjs(order.ngay_tao).format('DD [tháng] MM [năm] YYYY')
    : dayjs().format('DD [tháng] MM [năm] YYYY');

  return (
    <div style={styles.wrapper} data-export-preview="phieu-xuat">
      {/* Tên công ty — canh giữa toàn trang, trên cùng */}
      <div style={styles.companyName}>Công ty TNHH Phụ Tùng Hachi Việt Nam</div>

      {/* Logo + thông tin công ty */}
      <div style={styles.headerRow}>
        <img src={hachiLogo} alt="HACHI" style={styles.logoImg} crossOrigin="anonymous" />
        <div style={styles.companyMeta}>
          <div>
            <span style={styles.companyMetaLabel}>Địa chỉ:</span> Số 139C Đường Nguyễn Bá Học, KP2, Phường Tam Hiệp, Thành phố Đồng Nai, Việt Nam
          </div>
          <div>
            <span style={styles.companyMetaLabel}>SĐT:</span> 0901629777
          </div>
          <div>
            <span style={styles.companyMetaLabel}>MST:</span> 3603812751
          </div>
        </div>
      </div>

      {/* Title */}
      <div style={styles.titleBlock}>
        <div style={styles.titleMain}>Phiếu xuất kho bán hàng</div>
        <div style={styles.titleSub}>Ngày {ngayText}</div>
        <div style={styles.titleMaDon}>Mã đơn: {order.ma_don || order.ma_toa}</div>
      </div>

      {/* Thông tin khách — mỗi dòng riêng */}
      <div style={styles.customerBlock}>
        <div style={styles.customerLine}>
          <span style={styles.customerLabel}>Tên khách hàng: </span>
          <span style={styles.customerValueStrong}>{order.ten_kh || '—'}</span>
        </div>
        <div style={styles.customerLine}>
          <span style={styles.customerLabel}>Mã khách hàng: </span>
          <span style={styles.customerValue}>{order.ma_kh || '—'}</span>
        </div>
        <div style={styles.customerLine}>
          <span style={styles.customerLabel}>SĐT: </span>
          <span style={styles.customerValue}>{order.sdt || ''}</span>
        </div>
        <div style={styles.customerLine}>
          <span style={styles.customerLabel}>Địa chỉ: </span>
          <span style={styles.customerValue}>{order.dia_chi || ''}</span>
        </div>
        <div style={styles.customerLine}>
          <span style={styles.customerLabel}>Giao hàng tại: </span>
          <span style={styles.customerValue}>{order.noi_gui_hang || ''}</span>
        </div>
        {order.ghi_chu && (
          <div style={styles.customerLine}>
            <span style={styles.customerLabel}>Ghi chú: </span>
            <span style={styles.customerValue}>{order.ghi_chu}</span>
          </div>
        )}
      </div>

      {/* Bảng hàng hóa */}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.thCell, width: '36px' }}>STT</th>
            <th style={{ ...styles.thCell, width: '110px' }}>Mã</th>
            <th style={{ ...styles.thCell, width: '70px' }}>NSX</th>
            <th style={styles.thCell}>Mô tả</th>
            <th style={{ ...styles.thCell, width: '48px' }}>ĐVT</th>
            <th style={{ ...styles.thCell, width: '90px' }}>Đơn giá</th>
            <th style={{ ...styles.thCell, width: '70px' }}>Số lượng</th>
            <th style={{ ...styles.thCell, width: '100px' }}>Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {details.map((d, i) => {
            const tenHien = d.ten_hang_hien_thi || d.ten_hang || '';
            return (
              <tr key={d.id || i}>
                <td style={styles.tdCenter}>{i + 1}</td>
                <td style={{ ...styles.tdCell, fontSize: '12px', fontFamily: 'monospace' }}>
                  {d.ma_hang || ''}
                </td>
                <td style={styles.tdCenter}>{d.hang_san_xuat || ''}</td>
                <td style={styles.tdCell}>{tenHien}</td>
                <td style={styles.tdCenter}>{d.dvt || ''}</td>
                <td style={styles.tdRight}>{d.don_gia_ban ? formatMoney(d.don_gia_ban) : ''}</td>
                <td style={styles.tdCenter}>{d.so_luong}</td>
                <td style={styles.tdRight}>
                  {formatMoney(d.so_luong * d.don_gia_ban)}
                </td>
              </tr>
            );
          })}
          {/* Dòng tổng cộng */}
          <tr>
            <td colSpan={6} style={styles.totalLabelCell}>Tổng cộng</td>
            <td style={{ ...styles.totalLabelCell, textAlign: 'center' }}>
              {details.reduce((s, d) => s + parseFloat(d.so_luong || 0), 0)}
            </td>
            <td style={styles.totalValueCell}>{formatMoney(total)}</td>
          </tr>
        </tbody>
      </table>

      <div style={styles.note}>
        Khách nhận hàng kiểm tra kỹ: số lượng, chủng loại theo đơn hàng
      </div>

      {/* Chữ ký */}
      <div style={styles.signatureRow}>
        {['Người lập phiếu', 'Người giao hàng', 'Người nhận hàng'].map(label => (
          <div key={label} style={styles.signatureCell}>
            <div style={styles.signatureLabel}>{label}</div>
            <div style={styles.signatureNote}>(Ký tên)</div>
            <div style={styles.signatureSpace} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CSS print (inject 1 lần) ──────────────────────────────────────────────────
const PRINT_STYLE_ID = 'phieu-xuat-print-style';
function injectPrintStyle() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body > *:not(#phieu-xuat-print-root) { display: none !important; }
      #phieu-xuat-print-root {
        display: block !important;
        position: fixed !important;
        inset: 0 !important;
        z-index: 99999 !important;
        background: white !important;
      }
      @page { margin: 0; size: A4 landscape; }
    }
  `;
  document.head.appendChild(style);
}

// ── Hàm render phiếu vào hidden div rồi chụp canvas ─────────────────────────
// Dùng html2canvas-pro (đã có trong dependencies) thay cho html2canvas tải qua CDN —
// html2canvas-pro parse được oklab/oklch/color-mix nên không còn lỗi
// "Attempting to parse an unsupported color function" khi AntD/theme inject CSS màu hiện đại.
async function renderPhieuToCanvas(order) {
  // Tạo/tái dùng hidden container — chỉ chứa đúng node phiếu, không dính
  // modal/toolbar/app shell (đáp ứng acceptance "ảnh xuất ra chỉ chứa phiếu").
  let container = document.getElementById('phieu-xuat-canvas-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'phieu-xuat-canvas-container';
    container.style.cssText = `
      position:fixed; left:-9999px; top:0; z-index:-1;
      background:white; width:1123px;
    `;
    document.body.appendChild(container);
  }

  const root = createRoot(container);

  await new Promise(resolve => {
    root.render(
      React.createElement(PhieuXuatTemplate, { order }),
    );
    // Đợi paint + ảnh logo load xong
    setTimeout(resolve, 350);
  });

  const canvas = await html2canvas(container, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    onclone: (doc) => {
      // Ép thêm style an toàn (hex) lên bản clone để chắc chắn không dính theme/dark mode ngoài.
      const el = doc.querySelector('[data-export-preview="phieu-xuat"]');
      if (el) {
        el.style.backgroundColor = '#ffffff';
        el.style.color = '#111111';
      }
    },
  });

  // Cleanup
  root.unmount();
  return canvas;
}

// ── Component nút actions ─────────────────────────────────────────────────────
export default function PhieuXuatActions({ order }) {
  const printRef = useRef(null);
  const [loadingImg, setLoadingImg] = useState(false);

  // --- In phiếu giấy ---
  function handlePrint() {
    injectPrintStyle();

    let printRoot = document.getElementById('phieu-xuat-print-root');
    if (!printRoot) {
      printRoot = document.createElement('div');
      printRoot.id = 'phieu-xuat-print-root';
      printRoot.style.cssText = 'display:none; position:fixed; inset:0; background:white; z-index:99999;';
      document.body.appendChild(printRoot);
    }

    const root = createRoot(printRoot);
    root.render(React.createElement(PhieuXuatTemplate, { order }));
    setTimeout(() => {
      printRoot.style.display = 'block';
      window.print();
      setTimeout(() => {
        printRoot.style.display = 'none';
        root.unmount();
      }, 1200);
    }, 200);
  }

  // --- Copy ảnh phiếu ---
  async function handleCopyImage() {
    setLoadingImg(true);
    try {
      const canvas = await renderPhieuToCanvas(order);
      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          message.success('Đã copy ảnh phiếu vào clipboard!');
        } catch {
          // Clipboard API không được phép → fallback tải xuống
          message.warning('Trình duyệt không cho phép copy ảnh — đang tải xuống thay thế...');
          downloadBlob(blob, `phieu-${order.ma_don || order.ma_toa}.png`);
        }
      }, 'image/png');
    } catch (err) {
      message.error('Lỗi tạo ảnh: ' + err.message);
    } finally {
      setLoadingImg(false);
    }
  }

  // --- Tải ảnh phiếu ---
  async function handleDownloadImage() {
    setLoadingImg(true);
    try {
      const canvas = await renderPhieuToCanvas(order);
      canvas.toBlob((blob) => {
        downloadBlob(blob, `phieu-${order.ma_don || order.ma_toa}.png`);
        message.success('Đã tải ảnh phiếu!');
      }, 'image/png');
    } catch (err) {
      message.error('Lỗi tạo ảnh: ' + err.message);
    } finally {
      setLoadingImg(false);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <Spin spinning={loadingImg} tip="Đang tạo ảnh phiếu...">
      <Space wrap>
        <Button
          icon={<PrinterOutlined />}
          onClick={handlePrint}
          size="middle"
        >
          In phiếu giấy
        </Button>
        <Button
          icon={<CopyOutlined />}
          onClick={handleCopyImage}
          loading={loadingImg}
          size="middle"
        >
          Copy ảnh phiếu
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={handleDownloadImage}
          loading={loadingImg}
          size="middle"
        >
          Tải ảnh phiếu
        </Button>
      </Space>
    </Spin>
  );
}
