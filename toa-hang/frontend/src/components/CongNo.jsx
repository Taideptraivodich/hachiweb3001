import React, { useState, useCallback } from 'react';
import {
  DatePicker, Button, Input, Spin, Empty, Tag, Typography,
  Space, Switch, Tooltip, message
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, ArrowLeftOutlined,
  UserOutlined, CalendarOutlined, FileTextOutlined,
  EyeInvisibleOutlined, EyeOutlined
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { formatMoney } from '../utils';

dayjs.locale('vi');

const { RangePicker } = DatePicker;
const { Text } = Typography;
const api = axios.create({ baseURL: '/api' });

// ─── Constants ───────────────────────────────────────────────────────────────
const COLOR_NO  = '#cf1322';
const COLOR_CO  = '#389e0d';
const COLOR_DU  = '#1677ff';
const COLOR_ROW_ODD  = '#ffffff';
const COLOR_ROW_EVEN = '#f9fafb';
const COLOR_ROW_HOVER = '#eff6ff';
const COLOR_HEADER_BG = '#f1f5f9';
const COLOR_GROUP_BG  = '#f8fafc';
const COLOR_BORDER    = '#e2e8f0';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtMoney = (v) => {
  const n = Number(v) || 0;
  if (n === 0) return <span style={{ color: '#94a3b8' }}>—</span>;
  return <span>{formatMoney(n)}&nbsp;đ</span>;
};

const fmtMoneyColored = (v, color) => {
  const n = Number(v) || 0;
  if (n === 0) return <span style={{ color: '#94a3b8' }}>—</span>;
  return <span style={{ color, fontWeight: 500 }}>{formatMoney(n)}&nbsp;đ</span>;
};

function fmtShort(v) {
  const n = Number(v) || 0;
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace('.0', '') + ' tỷ';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1).replace('.0', '') + 'tr';
  return formatMoney(n);
}

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// Gộp dòng thuế GTGT (tk_du 33311x) vào dòng hàng cùng RefNo
// Tính lại số dư lũy kế sau khi gộp
function mergeVatRows(rows, dauKyNet) {
  // Bước 1: với mỗi RefNo, cộng ps_no/ps_co của dòng thuế vào dòng hàng đầu tiên
  const grouped = {};
  const order = [];
  rows.forEach(r => {
    const key = r.so_ct || r.refno || '_';
    const isTax = (r.tk_du || '').startsWith('33311');
    if (!grouped[key]) {
      grouped[key] = [];
      order.push(key);
    }
    grouped[key].push({ ...r, _isTax: isTax });
  });

  const merged = [];
  order.forEach(key => {
    const group = grouped[key];
    const mainRows = group.filter(r => !r._isTax);
    const taxRows  = group.filter(r => r._isTax);

    if (taxRows.length === 0 || mainRows.length === 0) {
      group.forEach(r => merged.push(r));
      return;
    }

    // Cộng tổng thuế vào dòng đầu tiên của nhóm
    const taxNo = taxRows.reduce((s, r) => s + Number(r.ps_no || 0), 0);
    const taxCo = taxRows.reduce((s, r) => s + Number(r.ps_co || 0), 0);

    mainRows.forEach((r, i) => {
      if (i === 0) {
        merged.push({
          ...r,
          ps_no: Number(r.ps_no || 0) + taxNo,
          ps_co: Number(r.ps_co || 0) + taxCo,
          _vatMerged: taxRows.length,
        });
      } else {
        merged.push(r);
      }
    });
  });

  // Bước 2: tính lại số dư lũy kế
  let soDu = dauKyNet;
  return merged.map(r => {
    soDu += Number(r.ps_no || 0) - Number(r.ps_co || 0);
    return { ...r, so_du: soDu };
  });
}

// ─── Bảng tổng hợp ───────────────────────────────────────────────────────────
function TongHopTable({ data, onSelect, loading }) {
  const [search, setSearch] = useState('');
  const [sort, setSort]     = useState({ key: 'ten_kh', dir: 1 });

  const filtered = data
    .filter(r => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (r.ma_kh || '').toLowerCase().includes(s) ||
             (r.ten_kh || '').toLowerCase().includes(s);
    })
    .sort((a, b) => {
      let va = a[sort.key] || 0, vb = b[sort.key] || 0;
      if (typeof va === 'string') return sort.dir * va.localeCompare(vb);
      return sort.dir * (vb - va);
    });

  const totals = filtered.reduce((acc, r) => ({
    dau_ky_no: acc.dau_ky_no + Number(r.dau_ky_no || 0),
    ps_no:     acc.ps_no     + Number(r.ps_no || 0),
    ps_co:     acc.ps_co     + Number(r.ps_co || 0),
    cuoi_ky:   acc.cuoi_ky   + Number(r.du_no_net || 0),
  }), { dau_ky_no: 0, ps_no: 0, ps_co: 0, cuoi_ky: 0 });

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: -s.dir } : { key, dir: -1 });
  }

  function SortIcon({ k }) {
    if (sort.key !== k) return <span style={{ opacity: 0.3, marginLeft: 3, fontSize: 10 }}>↕</span>;
    return <span style={{ color: COLOR_DU, marginLeft: 3, fontSize: 10 }}>{sort.dir === 1 ? '↑' : '↓'}</span>;
  }

  const thS = (align = 'right') => ({
    padding: '9px 12px',
    textAlign: align,
    fontWeight: 600,
    fontSize: 12,
    color: '#475569',
    background: COLOR_HEADER_BG,
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    borderBottom: `2px solid ${COLOR_BORDER}`,
    borderRight: `1px solid ${COLOR_BORDER}`,
  });

  const tdS = (align = 'right') => ({
    padding: '9px 12px',
    textAlign: align,
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${COLOR_BORDER}`,
    borderRight: `1px solid ${COLOR_BORDER}`,
    fontSize: 13,
  });

  return (
    <div>
      {/* Search + count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Input
          placeholder="Tìm theo mã KH hoặc tên khách hàng..."
          prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          allowClear
          style={{ maxWidth: 320 }}
        />
        <Text style={{ color: '#64748b', fontSize: 13 }}>
          {filtered.length} khách hàng
        </Text>
      </div>

      {/* Tổng bar */}
      {filtered.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
          gap: 1, marginBottom: 16,
          border: `1px solid ${COLOR_BORDER}`, borderRadius: 8, overflow: 'hidden',
        }}>
          {[
            { label: 'Dư đầu kỳ',      value: fmtShort(totals.dau_ky_no), color: '#1e293b' },
            { label: 'Phát sinh nợ',    value: fmtShort(totals.ps_no),     color: COLOR_NO  },
            { label: 'Phát sinh có',    value: fmtShort(totals.ps_co),     color: COLOR_CO  },
            { label: 'Còn phải thu',    value: fmtShort(totals.cuoi_ky),   color: COLOR_DU  },
          ].map(item => (
            <div key={item.label} style={{
              padding: '12px 16px', background: '#fff',
              borderRight: `1px solid ${COLOR_BORDER}`,
            }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {item.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: item.color, fontVariantNumeric: 'tabular-nums' }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <Spin spinning={loading}>
        {filtered.length === 0 && !loading
          ? <Empty description="Không có công nợ trong kỳ" style={{ padding: '40px 0' }} />
          : (
            <div style={{ overflowX: 'auto', border: `1px solid ${COLOR_BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...thS('center'), width: 100 }} onClick={() => toggleSort('ma_kh')}>
                      Mã KH <SortIcon k="ma_kh" />
                    </th>
                    <th style={{ ...thS('left'), minWidth: 180 }} onClick={() => toggleSort('ten_kh')}>
                      Tên khách hàng <SortIcon k="ten_kh" />
                    </th>
                    <th style={{ ...thS(), width: 130 }} onClick={() => toggleSort('dau_ky_no')}>
                      Dư đầu kỳ <SortIcon k="dau_ky_no" />
                    </th>
                    <th style={{ ...thS(), width: 130 }} onClick={() => toggleSort('ps_no')}>
                      Phát sinh Nợ <SortIcon k="ps_no" />
                    </th>
                    <th style={{ ...thS(), width: 130 }} onClick={() => toggleSort('ps_co')}>
                      Phát sinh Có <SortIcon k="ps_co" />
                    </th>
                    <th style={{ ...thS(), width: 140 }} onClick={() => toggleSort('du_no_net')}>
                      Còn phải thu <SortIcon k="du_no_net" />
                    </th>
                    <th style={{ ...thS('center'), width: 70, borderRight: 'none' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr
                      key={r.ma_kh}
                      style={{
                        background: i % 2 === 0 ? COLOR_ROW_ODD : COLOR_ROW_EVEN,
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                      onClick={() => onSelect(r)}
                      onMouseEnter={e => e.currentTarget.style.background = COLOR_ROW_HOVER}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? COLOR_ROW_ODD : COLOR_ROW_EVEN}
                    >
                      <td style={{ ...tdS('center') }}>
                        <Text code style={{ fontSize: 11 }}>{r.ma_kh}</Text>
                      </td>
                      <td style={{ ...tdS('left'), fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                            background: '#dbeafe', color: '#1d4ed8',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700,
                          }}>
                            {(r.ten_kh || r.ma_kh || '?')[0].toUpperCase()}
                          </div>
                          {r.ten_kh || r.ma_kh}
                        </div>
                      </td>
                      <td style={tdS()}>
                        {Number(r.dau_ky_no) - Number(r.dau_ky_co) > 0
                          ? fmtMoney(Number(r.dau_ky_no) - Number(r.dau_ky_co))
                          : <span style={{ color: '#94a3b8' }}>—</span>}
                      </td>
                      <td style={tdS()}>
                        {Number(r.ps_no) > 0 ? fmtMoneyColored(r.ps_no, COLOR_NO) : <span style={{ color: '#94a3b8' }}>—</span>}
                      </td>
                      <td style={tdS()}>
                        {Number(r.ps_co) > 0 ? fmtMoneyColored(r.ps_co, COLOR_CO) : <span style={{ color: '#94a3b8' }}>—</span>}
                      </td>
                      <td style={tdS()}>
                        {Number(r.du_no_net) > 0
                          ? <span style={{ color: COLOR_DU, fontWeight: 700 }}>{formatMoney(r.du_no_net)}&nbsp;đ</span>
                          : <Tag color="success" style={{ margin: 0 }}>Đã thu</Tag>
                        }
                      </td>
                      <td style={{ ...tdS('center'), borderRight: 'none' }}>
                        <Button size="small" type="link" icon={<FileTextOutlined />} style={{ padding: 0, fontSize: 12 }}>
                          Chi tiết
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Spin>
    </div>
  );
}

// ─── Panel chi tiết 1 KH ─────────────────────────────────────────────────────
function ChiTietPanel({ kh, range, onBack }) {
  const [rawData, setRawData]   = useState(null);
  const [dauKyNet, setDauKyNet] = useState(0);
  const [loading, setLoading]   = useState(false);
  const [hideVat, setHideVat]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        ma_kh:    kh.ma_kh,
        tu_ngay:  range[0]?.format('YYYY-MM-DD'),
        den_ngay: range[1]?.format('YYYY-MM-DD'),
      };
      const r = await api.get('/congno/chi-tiet', { params });
      setRawData(r.data.data || []);
      setDauKyNet(r.data.dau_ky_net || 0);
    } catch (e) {
      message.error('Lỗi tải chi tiết: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [kh.ma_kh, range]);

  React.useEffect(() => { load(); }, [load]);

  // Áp dụng gộp thuế hoặc giữ nguyên
  const displayRows = React.useMemo(() => {
    if (!rawData) return [];
    if (hideVat) return mergeVatRows(rawData, dauKyNet);
    // Không gộp: tính lại số dư từ đầu
    let soDu = dauKyNet;
    return rawData.map(r => {
      soDu += Number(r.ps_no || 0) - Number(r.ps_co || 0);
      return { ...r, so_du: soDu };
    });
  }, [rawData, dauKyNet, hideVat]);

  const vatCount = rawData
    ? rawData.filter(r => (r.tk_du || '').startsWith('33311')).length
    : 0;

  const grouped  = groupBy(displayRows, r => dayjs(r.ngay_ct).format('YYYY-MM-DD'));
  const ngayList = Object.keys(grouped).sort();
  const duNoNet  = Number(kh.du_no_net || 0);

  const thS = (align = 'right') => ({
    padding: '7px 12px', textAlign: align,
    fontWeight: 600, fontSize: 11.5,
    color: '#475569', background: COLOR_HEADER_BG,
    borderBottom: `1px solid ${COLOR_BORDER}`,
    borderRight: `1px solid ${COLOR_BORDER}`,
    whiteSpace: 'nowrap',
  });
  const tdS = (align = 'left') => ({
    padding: '8px 12px', textAlign: align,
    borderBottom: `1px solid ${COLOR_BORDER}`,
    borderRight: `1px solid ${COLOR_BORDER}`,
    fontSize: 13, whiteSpace: 'nowrap',
  });

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 16, paddingBottom: 14,
        borderBottom: `1px solid ${COLOR_BORDER}`,
      }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack} size="small">
          Quay lại
        </Button>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: '#dbeafe', color: '#1d4ed8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, flexShrink: 0,
        }}>
          {(kh.ten_kh || kh.ma_kh || '?')[0].toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{kh.ten_kh || kh.ma_kh}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            <Text code style={{ fontSize: 11 }}>{kh.ma_kh}</Text>
            &nbsp;·&nbsp;TK 131
            &nbsp;·&nbsp;{range[0]?.format('DD/MM/YYYY')} – {range[1]?.format('DD/MM/YYYY')}
          </div>
        </div>

        {/* Toggle ẩn thuế */}
        {vatCount > 0 && (
          <Tooltip title={
            hideVat
              ? `Đang gộp ${vatCount} dòng thuế GTGT vào tiền hàng — số dư chính xác`
              : `Hiển thị ${vatCount} dòng thuế GTGT tách biệt`
          }>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 6,
              background: hideVat ? '#eff6ff' : '#f8fafc',
              border: `1px solid ${hideVat ? '#bfdbfe' : COLOR_BORDER}`,
              cursor: 'pointer',
            }} onClick={() => setHideVat(v => !v)}>
              {hideVat ? <EyeInvisibleOutlined style={{ color: '#3b82f6', fontSize: 13 }} /> : <EyeOutlined style={{ color: '#64748b', fontSize: 13 }} />}
              <span style={{ fontSize: 12, color: hideVat ? '#1d4ed8' : '#64748b', fontWeight: hideVat ? 500 : 400 }}>
                {hideVat ? `Thuế gộp vào hàng (${vatCount} dòng)` : `Hiện thuế riêng (${vatCount} dòng)`}
              </span>
            </div>
          </Tooltip>
        )}

        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Còn phải thu</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: duNoNet > 0 ? COLOR_DU : COLOR_CO }}>
            {formatMoney(Math.abs(duNoNet))}&nbsp;đ
          </div>
        </div>
        <Button size="small" icon={<ReloadOutlined />} onClick={load} />
      </div>

      <Spin spinning={loading}>
        {!rawData ? null : (
          <>
            {/* Số dư đầu kỳ */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '7px 14px', marginBottom: 16,
              background: '#f8fafc', border: `1px solid ${COLOR_BORDER}`,
              borderRadius: 6, fontSize: 13,
            }}>
              <span style={{ color: '#64748b' }}>Số dư đầu kỳ:</span>
              <span style={{ fontWeight: 600 }}>{formatMoney(Math.abs(dauKyNet))}&nbsp;đ</span>
              <Tag style={{ margin: 0, fontSize: 11 }} color={dauKyNet >= 0 ? 'blue' : 'green'}>
                {dauKyNet >= 0 ? 'Nợ' : 'Có'}
              </Tag>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                · {displayRows.length} dòng phát sinh
              </span>
            </div>

            {/* Nhóm theo ngày */}
            {ngayList.length === 0
              ? <Empty description="Không có phát sinh trong kỳ" style={{ padding: '32px 0' }} />
              : ngayList.map(ngay => {
                const rows    = grouped[ngay];
                const tongNo  = rows.reduce((s, r) => s + Number(r.ps_no || 0), 0);
                const tongCo  = rows.reduce((s, r) => s + Number(r.ps_co || 0), 0);
                const soDuCuoi = rows[rows.length - 1]?.so_du || 0;

                return (
                  <div key={ngay} style={{ marginBottom: 16 }}>
                    {/* Header ngày */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px',
                      background: COLOR_GROUP_BG,
                      border: `1px solid ${COLOR_BORDER}`,
                      borderBottom: 'none',
                      borderRadius: '8px 8px 0 0',
                    }}>
                      <CalendarOutlined style={{ color: '#64748b', fontSize: 12 }} />
                      <span style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>
                        {dayjs(ngay).format('dddd, DD/MM/YYYY').replace(/^\w/, c => c.toUpperCase())}
                      </span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12 }}>
                        {tongNo > 0 && (
                          <span style={{ color: '#64748b' }}>
                            Nợ:&nbsp;<span style={{ color: COLOR_NO, fontWeight: 600 }}>{fmtShort(tongNo)}</span>
                          </span>
                        )}
                        {tongCo > 0 && (
                          <span style={{ color: '#64748b' }}>
                            Có:&nbsp;<span style={{ color: COLOR_CO, fontWeight: 600 }}>{fmtShort(tongCo)}</span>
                          </span>
                        )}
                        <span style={{ color: '#64748b' }}>
                          Số dư:&nbsp;<span style={{ color: COLOR_DU, fontWeight: 600 }}>{fmtShort(soDuCuoi)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Bảng dòng chứng từ */}
                    <div style={{ border: `1px solid ${COLOR_BORDER}`, borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...thS('left'), width: 140 }}>Số chứng từ</th>
                            <th style={{ ...thS('left'), minWidth: 200 }}>Diễn giải</th>
                            <th style={{ ...thS('center'), width: 80 }}>TK đối ứng</th>
                            <th style={{ ...thS('right'), width: 130, color: COLOR_NO }}>Phát sinh Nợ</th>
                            <th style={{ ...thS('right'), width: 130, color: COLOR_CO }}>Phát sinh Có</th>
                            <th style={{ ...thS('right'), width: 140, borderRight: 'none', color: COLOR_DU }}>Số dư</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr
                              key={i}
                              style={{ background: i % 2 === 0 ? COLOR_ROW_ODD : COLOR_ROW_EVEN }}
                            >
                              <td style={tdS('left')}>
                                <Text code style={{ fontSize: 11 }}>{r.so_ct}</Text>
                              </td>
                              <td style={{ ...tdS('left'), maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <span title={r.dien_giai}>
                                  {r.dien_giai || <span style={{ color: '#94a3b8' }}>—</span>}
                                </span>
                                {r._vatMerged > 0 && (
                                  <Tooltip title={`Đã gộp ${r._vatMerged} dòng thuế GTGT vào đây`}>
                                    <Tag color="orange" style={{ marginLeft: 6, fontSize: 10, padding: '0 4px' }}>
                                      +VAT
                                    </Tag>
                                  </Tooltip>
                                )}
                              </td>
                              <td style={{ ...tdS('center') }}>
                                <Tag style={{ margin: 0, fontSize: 11 }}>{r.tk_du}</Tag>
                              </td>
                              <td style={{ ...tdS('right') }}>
                                {Number(r.ps_no) > 0
                                  ? <span style={{ color: COLOR_NO, fontWeight: 500 }}>{formatMoney(r.ps_no)}&nbsp;đ</span>
                                  : <span style={{ color: '#94a3b8' }}>—</span>}
                              </td>
                              <td style={{ ...tdS('right') }}>
                                {Number(r.ps_co) > 0
                                  ? <span style={{ color: COLOR_CO, fontWeight: 500 }}>{formatMoney(r.ps_co)}&nbsp;đ</span>
                                  : <span style={{ color: '#94a3b8' }}>—</span>}
                              </td>
                              <td style={{ ...tdS('right'), borderRight: 'none' }}>
                                <span style={{ fontWeight: 600, color: Number(r.so_du) >= 0 ? COLOR_DU : COLOR_CO }}>
                                  {formatMoney(Math.abs(r.so_du))}&nbsp;đ
                                  <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 3 }}>
                                    {Number(r.so_du) >= 0 ? 'Nợ' : 'Có'}
                                  </span>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            }
          </>
        )}
      </Spin>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function CongNo() {
  const [range, setRange]         = useState([dayjs().startOf('month'), dayjs()]);
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const [selectedKH, setSelectedKH] = useState(null);

  async function loadData() {
    setLoading(true);
    try {
      const r = await api.get('/congno/tong-hop', {
        params: {
          tu_ngay:  range[0]?.format('YYYY-MM-DD'),
          den_ngay: range[1]?.format('YYYY-MM-DD'),
        },
      });
      setData(r.data.data || []);
      setLoaded(true);
    } catch (e) {
      message.error('Lỗi tải công nợ: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {selectedKH ? (
        <ChiTietPanel
          kh={selectedKH}
          range={range}
          onBack={() => setSelectedKH(null)}
        />
      ) : (
        <>
          {/* Bộ lọc */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <RangePicker
              value={range}
              onChange={v => v && setRange(v)}
              format="DD/MM/YYYY"
              presets={[
                { label: 'Tháng này',   value: [dayjs().startOf('month'), dayjs()] },
                { label: 'Tháng trước', value: [dayjs().subtract(1,'month').startOf('month'), dayjs().subtract(1,'month').endOf('month')] },
                { label: 'Quý này',     value: [dayjs().startOf('quarter'), dayjs()] },
                { label: 'Năm nay',     value: [dayjs().startOf('year'), dayjs()] },
              ]}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={loadData} loading={loading}>
              Xem công nợ
            </Button>
            {loaded && <Button icon={<ReloadOutlined />} onClick={loadData}>Làm mới</Button>}
            {loaded && (
              <Text style={{ color: '#64748b', fontSize: 12 }}>
                Từ {range[0]?.format('DD/MM/YYYY')} đến {range[1]?.format('DD/MM/YYYY')}
              </Text>
            )}
          </div>

          {!loaded && !loading && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
              <UserOutlined style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontSize: 14 }}>Chọn kỳ và nhấn <b>Xem công nợ</b></div>
            </div>
          )}

          {(loaded || loading) && (
            <TongHopTable data={data} loading={loading} onSelect={setSelectedKH} />
          )}
        </>
      )}
    </div>
  );
}
