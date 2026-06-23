/**
 * PhieuXuatPrint.jsx
 * Template phiếu xuất kho bán hàng — dùng cho:
 *   1. In phiếu giấy (window.print())
 *   2. Copy ảnh phiếu (html2canvas → clipboard)
 *   3. Tải ảnh phiếu (html2canvas → download PNG)
 *
 * Không phụ thuộc vào layout màn app — render riêng biệt trong hidden div.
 * Màu sắc: hex/rgb thuần, không dùng oklab/oklch/color-mix.
 */

import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Space, message, Spin } from 'antd';
import { PrinterOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { formatMoney, calcTotal } from '../utils';

// ── Logo HACHI dạng SVG inline (tránh phụ thuộc file) ──────────────────────
const HachiLogo = () => (
  <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="26" cy="26" r="24" stroke="#1565c0" strokeWidth="2.5" fill="#e3f0ff"/>
    <text x="26" y="32" textAnchor="middle" fontSize="16" fontWeight="800"
      fontFamily="Arial,sans-serif" fill="#1565c0">HC</text>
  </svg>
);

// ── Styles nhúng thẳng vào component (tránh bị Ant Design override) ──────────
const styles = {
  wrapper: {
    fontFamily: 'Arial, "Times New Roman", sans-serif',
    fontSize: '13px',
    color: '#111',
    background: '#fff',
    width: '210mm',
    minHeight: '148mm',
    padding: '14mm 16mm 12mm 16mm',
    boxSizing: 'border-box',
    position: 'relative',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '14px',
    marginBottom: '10px',
  },
  companyBlock: {
    flex: 1,
  },
  companyName: {
    fontSize: '15px',
    fontWeight: '800',
    color: '#1565c0',
    textTransform: 'uppercase',
    marginBottom: '4px',
    letterSpacing: '0.3px',
  },
  companyMeta: {
    fontSize: '11px',
    color: '#444',
    lineHeight: '1.6',
  },
  companyMetaLabel: {
    fontWeight: '700',
    color: '#1565c0',
  },
  titleBlock: {
    textAlign: 'center',
    margin: '10px 0 8px 0',
    borderTop: '2px solid #1565c0',
    borderBottom: '1px solid #ccc',
    padding: '8px 0',
  },
  titleMain: {
    fontSize: '18px',
    fontWeight: '900',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    color: '#111',
  },
  titleSub: {
    fontSize: '12px',
    color: '#555',
    marginTop: '3px',
  },
  titleMaDon: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#1565c0',
    marginTop: '2px',
  },
  customerBlock: {
    marginBottom: '10px',
    lineHeight: '1.65',
  },
  customerLabel: {
    color: '#1565c0',
    fontWeight: '700',
    fontSize: '12px',
    marginRight: '4px',
  },
  customerValue: {
    fontWeight: '700',
    fontSize: '14px',
  },
  customerMeta: {
    fontSize: '12px',
    color: '#1565c0',
  },
  customerMetaVal: {
    color: '#111',
    fontWeight: '500',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '6px',
    fontSize: '12px',
  },
  thCell: {
    background: '#c8d8f0',
    color: '#1a1a1a',
    fontWeight: '700',
    border: '1px solid #aaa',
    padding: '5px 6px',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  },
  tdCell: {
    border: '1px solid #ccc',
    padding: '5px 6px',
    verticalAlign: 'middle',
  },
  tdCenter: {
    border: '1px solid #ccc',
    padding: '5px 6px',
    textAlign: 'center',
    verticalAlign: 'middle',
  },
  tdRight: {
    border: '1px solid #ccc',
    padding: '5px 6px',
    textAlign: 'right',
    verticalAlign: 'middle',
  },
  totalRow: {
    background: '#f0f5ff',
  },
  totalLabelCell: {
    border: '1px solid #ccc',
    padding: '6px',
    textAlign: 'right',
    fontWeight: '700',
    fontSize: '12px',
    color: '#333',
  },
  totalValueCell: {
    border: '1px solid #ccc',
    padding: '6px',
    textAlign: 'right',
    fontWeight: '800',
    fontSize: '13px',
    color: '#1565c0',
  },
  note: {
    fontSize: '11px',
    color: '#555',
    fontStyle: 'italic',
    marginBottom: '14px',
    marginTop: '4px',
  },
  signatureRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '16px',
    textAlign: 'center',
  },
  signatureCell: {
    flex: 1,
    fontSize: '12px',
    color: '#222',
  },
  signatureLabel: {
    fontWeight: '700',
    marginBottom: '2px',
  },
  signatureNote: {
    fontSize: '11px',
    color: '#777',
    fontStyle: 'italic',
  },
  signatureSpace: {
    height: '40px',
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
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        <HachiLogo />
        <div style={styles.companyBlock}>
          <div style={styles.companyName}>Công ty TNHH Phụ Tùng Hachi Việt Nam</div>
          <div style={styles.companyMeta}>
            <span style={styles.companyMetaLabel}>Địa chỉ:</span> Số 139C Đường Nguyễn Bá Học, KP2, Phường Tam Hiệp, Thành phố Đồng Nai, Việt Nam<br />
            <span style={styles.companyMetaLabel}>SĐT:</span> 0901629777
            &nbsp;&nbsp;
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

      {/* Thông tin khách */}
      <div style={styles.customerBlock}>
        <div>
          <span style={styles.customerLabel}>Tên khách hàng:</span>
          <span style={styles.customerValue}>{order.ten_kh || '—'}</span>
        </div>
        <div style={styles.customerMeta}>
          <span style={styles.customerLabel}>Mã khách hàng:</span>
          <span style={styles.customerMetaVal}>{order.ma_kh || '—'}</span>
          {order.sdt && (
            <>
              &nbsp;&nbsp;
              <span style={styles.customerLabel}>SĐT:</span>
              <span style={styles.customerMetaVal}>{order.sdt}</span>
            </>
          )}
        </div>
        {order.dia_chi && (
          <div style={styles.customerMeta}>
            <span style={styles.customerLabel}>Địa chỉ:</span>
            <span style={styles.customerMetaVal}>{order.dia_chi}</span>
          </div>
        )}
        <div style={styles.customerMeta}>
          <span style={styles.customerLabel}>Giao hàng tại:</span>
          <span style={styles.customerMetaVal}>{order.noi_gui_hang || ''}</span>
        </div>
      </div>

      {/* Bảng hàng hóa */}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.thCell, width: '32px' }}>STT</th>
            <th style={{ ...styles.thCell, width: '100px' }}>Mã</th>
            <th style={{ ...styles.thCell, width: '70px' }}>NSX</th>
            <th style={styles.thCell}>Mô tả</th>
            <th style={{ ...styles.thCell, width: '42px' }}>ĐVT</th>
            <th style={{ ...styles.thCell, width: '72px' }}>Đơn giá</th>
            <th style={{ ...styles.thCell, width: '52px' }}>Số lượng</th>
            <th style={{ ...styles.thCell, width: '85px' }}>Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {details.map((d, i) => {
            const tenHien = d.ten_hang_hien_thi || d.ten_hang || '';
            return (
              <tr key={d.id || i} style={i % 2 === 1 ? { background: '#f8faff' } : {}}>
                <td style={styles.tdCenter}>{i + 1}</td>
                <td style={{ ...styles.tdCell, fontSize: '11px', fontFamily: 'monospace' }}>
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
          <tr style={styles.totalRow}>
            <td colSpan={6} style={styles.totalLabelCell}>Tổng cộng</td>
            <td style={{ ...styles.tdCenter, fontWeight: '700' }}>
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
      @page { margin: 0; size: A4; }
    }
  `;
  document.head.appendChild(style);
}

// ── Load html2canvas lazy ─────────────────────────────────────────────────────
let html2canvasCache = null;
async function loadHtml2Canvas() {
  if (html2canvasCache) return html2canvasCache;
  const mod = await import('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.esm.min.js');
  html2canvasCache = mod.default || mod;
  return html2canvasCache;
}

// ── Hàm render phiếu vào hidden div rồi chụp canvas ─────────────────────────
async function renderPhieuToCanvas(order) {
  // Tạo/tái dùng hidden container
  let container = document.getElementById('phieu-xuat-canvas-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'phieu-xuat-canvas-container';
    container.style.cssText = `
      position:fixed; left:-9999px; top:0; z-index:-1;
      background:white; width:794px;
    `;
    document.body.appendChild(container);
  }

  // Render React vào container (dùng createRoot)
  // createRoot imported statically at top
  const root = createRoot(container);

  await new Promise(resolve => {
    root.render(
      React.createElement(PhieuXuatTemplate, { order }),
    );
    // Đợi paint
    setTimeout(resolve, 350);
  });

  const h2c = await loadHtml2Canvas();
  const canvas = await h2c(container, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
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
