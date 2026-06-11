import React, { useState, useCallback, useMemo } from 'react';
import {
  DatePicker, Button, Input, Select, Spin, Empty,
  Tag, Typography, Tooltip, message
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, ArrowLeftOutlined,
  InboxOutlined, CalendarOutlined, FileTextOutlined,
  WarningOutlined
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { formatMoney } from '../utils';

dayjs.locale('vi');

const { RangePicker } = DatePicker;
const { Text } = Typography;
const api = axios.create({ baseURL: '/api' });

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  border:     '#e2e8f0',
  headerBg:   '#f1f5f9',
  rowOdd:     '#ffffff',
  rowEven:    '#f9fafb',
  rowHover:   '#eff6ff',
  groupBg:    '#f8fafc',
  nhap:       '#16a34a',   // xanh lá — nhập kho
  xuat:       '#dc2626',   // đỏ — xuất kho
  ton:        '#1d4ed8',   // xanh đậm — tồn
  warn:       '#d97706',   // cam — tồn thấp
  muted:      '#94a3b8',
  text:       '#1e293b',
  sub:        '#64748b',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = v => formatMoney(Number(v) || 0);
const dash = v => (Number(v) === 0 ? <span style={{ color: C.muted }}>—</span> : null);

function fmtShort(v) {
  const n = Number(v) || 0;
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return (n / 1e9).toFixed(1).replace('.0','') + ' tỷ';
  if (n >= 1_000_000)     return (n / 1e6).toFixed(1).replace('.0','') + 'tr';
  return formatMoney(n);
}

function groupBy(arr, fn) {
  return arr.reduce((acc, item) => {
    const k = fn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// ─── Shared table styles ──────────────────────────────────────────────────────
const thS = (align = 'right') => ({
  padding: '9px 12px',
  textAlign: align,
  fontWeight: 600, fontSize: 12,
  color: C.sub,
  background: C.headerBg,
  borderBottom: `2px solid ${C.border}`,
  borderRight:  `1px solid ${C.border}`,
  whiteSpace: 'nowrap',
  userSelect: 'none',
});
const tdS = (align = 'right', extra = {}) => ({
  padding: '8px 12px',
  textAlign: align,
  borderBottom: `1px solid ${C.border}`,
  borderRight:  `1px solid ${C.border}`,
  fontSize: 13,
  whiteSpace: 'nowrap',
  ...extra,
});

// ─── Bảng tổng hợp tồn kho ───────────────────────────────────────────────────
function TongHopTable({ data, danhSachKho, loading, onSelect, onFilter, filters }) {
  // Tổng dòng cuối
  const totals = useMemo(() => data.reduce((acc, r) => ({
    dau_ky_sl: acc.dau_ky_sl + Number(r.dau_ky_sl || 0),
    nhap_sl:   acc.nhap_sl   + Number(r.nhap_sl   || 0),
    xuat_sl:   acc.xuat_sl   + Number(r.xuat_sl   || 0),
    cuoi_ky_sl:acc.cuoi_ky_sl+ Number(r.cuoi_ky_sl|| 0),
    nhap_gt:   acc.nhap_gt   + Number(r.nhap_gt   || 0),
    xuat_gt:   acc.xuat_gt   + Number(r.xuat_gt   || 0),
    cuoi_ky_gt:acc.cuoi_ky_gt+ Number(r.cuoi_ky_gt|| 0),
  }), { dau_ky_sl:0, nhap_sl:0, xuat_sl:0, cuoi_ky_sl:0, nhap_gt:0, xuat_gt:0, cuoi_ky_gt:0 }), [data]);

  return (
    <div>
      {/* Toolbar filter */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <Input
          prefix={<SearchOutlined style={{ color: C.muted }} />}
          placeholder="Tìm mã hoặc tên hàng..."
          value={filters.q}
          onChange={e => onFilter({ q: e.target.value })}
          allowClear style={{ width: 260 }}
        />
        <Select
          placeholder="Tất cả kho"
          value={filters.kho || undefined}
          onChange={v => onFilter({ kho: v || '' })}
          allowClear style={{ width: 180 }}
          options={danhSachKho.map(k => ({ value: k, label: k }))}
        />
        <Text style={{ color: C.sub, fontSize: 13, marginLeft: 4 }}>
          {data.length} mặt hàng
        </Text>
      </div>

      {/* Summary cards */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1, marginBottom: 16,
        border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden',
      }}>
        {[
          { label: 'Tồn đầu kỳ',  sl: totals.dau_ky_sl,  gt: null,             color: C.text  },
          { label: 'Nhập trong kỳ',sl: totals.nhap_sl,    gt: totals.nhap_gt,   color: C.nhap  },
          { label: 'Xuất trong kỳ',sl: totals.xuat_sl,    gt: totals.xuat_gt,   color: C.xuat  },
          { label: 'Tồn cuối kỳ', sl: totals.cuoi_ky_sl, gt: totals.cuoi_ky_gt,color: C.ton   },
        ].map(item => (
          <div key={item.label} style={{
            padding: '12px 16px', background: '#fff',
            borderRight: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 4, textTransform:'uppercase', letterSpacing:'0.05em' }}>
              {item.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: item.color, fontVariantNumeric:'tabular-nums' }}>
              {item.sl.toLocaleString('vi-VN')}
            </div>
            {item.gt != null && (
              <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
                {fmtShort(item.gt)}&nbsp;đ
              </div>
            )}
          </div>
        ))}
      </div>

      <Spin spinning={loading}>
        {data.length === 0 && !loading
          ? <Empty description="Không có dữ liệu tồn kho trong kỳ" style={{ padding:'40px 0' }} />
          : (
            <div style={{ overflowX:'auto', border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...thS('left'), width:120, verticalAlign:'middle' }}>Mã hàng</th>
                    <th rowSpan={2} style={{ ...thS('left'), minWidth:200, verticalAlign:'middle' }}>Tên hàng</th>
                    <th rowSpan={2} style={{ ...thS('center'), width:50,  verticalAlign:'middle' }}>ĐVT</th>
                    <th rowSpan={2} style={{ ...thS('right'), width:80,  verticalAlign:'middle' }}>Đầu kỳ (SL)</th>
                    <th colSpan={2} style={{ ...thS('center'), borderBottom:`1px solid ${C.border}`, color: C.nhap }}>Nhập kho</th>
                    <th colSpan={2} style={{ ...thS('center'), borderBottom:`1px solid ${C.border}`, color: C.xuat }}>Xuất kho</th>
                    <th colSpan={2} style={{ ...thS('center'), borderBottom:`1px solid ${C.border}`, color: C.ton }}>Tồn cuối kỳ</th>
                    <th rowSpan={2} style={{ ...thS('center'), width:70, borderRight:'none', verticalAlign:'middle' }}></th>
                  </tr>
                  <tr>
                    <th style={{ ...thS('right'), width:80 }}>Số lượng</th>
                    <th style={{ ...thS('right'), width:120 }}>Giá trị</th>
                    <th style={{ ...thS('right'), width:80 }}>Số lượng</th>
                    <th style={{ ...thS('right'), width:120 }}>Giá trị</th>
                    <th style={{ ...thS('right'), width:80 }}>Số lượng</th>
                    <th style={{ ...thS('right'), width:130 }}>Giá trị</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r, i) => {
                    const isCanhBao = Number(r.cuoi_ky_sl) <= 0;
                    return (
                      <tr
                        key={r.ma_hang}
                        style={{ background: i % 2 === 0 ? C.rowOdd : C.rowEven, cursor:'pointer', transition:'background 0.1s' }}
                        onClick={() => onSelect(r)}
                        onMouseEnter={e => e.currentTarget.style.background = C.rowHover}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.rowOdd : C.rowEven}
                      >
                        <td style={tdS('left')}>
                          <Text code style={{ fontSize:11 }}>{r.ma_hang}</Text>
                        </td>
                        <td style={tdS('left', { maxWidth:240, overflow:'hidden', textOverflow:'ellipsis' })}>
                          <span title={r.ten_hang} style={{ fontWeight:500 }}>{r.ten_hang}</span>
                        </td>
                        <td style={{ ...tdS('center'), color: C.sub }}>{r.dvt || '—'}</td>
                        <td style={tdS()}>
                          {Number(r.dau_ky_sl) !== 0
                            ? <span style={{ fontVariantNumeric:'tabular-nums' }}>{Number(r.dau_ky_sl).toLocaleString('vi-VN')}</span>
                            : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={tdS()}>
                          {Number(r.nhap_sl) > 0
                            ? <span style={{ color: C.nhap, fontWeight:500 }}>{Number(r.nhap_sl).toLocaleString('vi-VN')}</span>
                            : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={tdS()}>
                          {Number(r.nhap_gt) > 0
                            ? <span style={{ color: C.nhap }}>{fmt(r.nhap_gt)}</span>
                            : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={tdS()}>
                          {Number(r.xuat_sl) > 0
                            ? <span style={{ color: C.xuat, fontWeight:500 }}>{Number(r.xuat_sl).toLocaleString('vi-VN')}</span>
                            : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={tdS()}>
                          {Number(r.xuat_gt) > 0
                            ? <span style={{ color: C.xuat }}>{fmt(r.xuat_gt)}</span>
                            : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={tdS()}>
                          {isCanhBao
                            ? (
                              <Tooltip title="Tồn kho bằng 0 hoặc âm">
                                <span style={{ color: C.warn, fontWeight:700, display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end' }}>
                                  <WarningOutlined style={{ fontSize:12 }} />
                                  {Number(r.cuoi_ky_sl).toLocaleString('vi-VN')}
                                </span>
                              </Tooltip>
                            ) : (
                              <span style={{ color: C.ton, fontWeight:700 }}>
                                {Number(r.cuoi_ky_sl).toLocaleString('vi-VN')}
                              </span>
                            )
                          }
                        </td>
                        <td style={tdS()}>
                          {Number(r.cuoi_ky_gt) !== 0
                            ? <span style={{ color: C.ton }}>{fmt(r.cuoi_ky_gt)}</span>
                            : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={{ ...tdS('center'), borderRight:'none' }}>
                          <Button size="small" type="link" icon={<FileTextOutlined />} style={{ padding:0, fontSize:12 }}>
                            Chi tiết
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Dòng tổng */}
                <tfoot>
                  <tr style={{ background: C.headerBg, fontWeight:700 }}>
                    <td colSpan={3} style={{ ...tdS('left'), borderTop:`2px solid ${C.border}`, color: C.sub, fontSize:12 }}>
                      Tổng cộng ({data.length} mặt hàng)
                    </td>
                    <td style={{ ...tdS(), borderTop:`2px solid ${C.border}` }}>
                      {totals.dau_ky_sl.toLocaleString('vi-VN')}
                    </td>
                    <td style={{ ...tdS(), borderTop:`2px solid ${C.border}`, color: C.nhap }}>
                      {totals.nhap_sl.toLocaleString('vi-VN')}
                    </td>
                    <td style={{ ...tdS(), borderTop:`2px solid ${C.border}`, color: C.nhap }}>
                      {fmt(totals.nhap_gt)}
                    </td>
                    <td style={{ ...tdS(), borderTop:`2px solid ${C.border}`, color: C.xuat }}>
                      {totals.xuat_sl.toLocaleString('vi-VN')}
                    </td>
                    <td style={{ ...tdS(), borderTop:`2px solid ${C.border}`, color: C.xuat }}>
                      {fmt(totals.xuat_gt)}
                    </td>
                    <td style={{ ...tdS(), borderTop:`2px solid ${C.border}`, color: C.ton }}>
                      {totals.cuoi_ky_sl.toLocaleString('vi-VN')}
                    </td>
                    <td style={{ ...tdS(), borderTop:`2px solid ${C.border}`, color: C.ton }}>
                      {fmt(totals.cuoi_ky_gt)}
                    </td>
                    <td style={{ ...tdS(), borderTop:`2px solid ${C.border}`, borderRight:'none' }}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        }
      </Spin>
    </div>
  );
}

// ─── Panel chi tiết 1 mặt hàng ───────────────────────────────────────────────
function ChiTietPanel({ hang, range, onBack }) {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(false);

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const r = await api.get('/tonkho/chi-tiet', {
        params: {
          ma_hang:  hang.ma_hang,
          tu_ngay:  range[0]?.format('YYYY-MM-DD'),
          den_ngay: range[1]?.format('YYYY-MM-DD'),
        },
      });
      setData(r.data);
    } catch (e) {
      message.error('Lỗi tải chi tiết: ' + e.message);
    } finally {
      setLoad(false);
    }
  }, [hang.ma_hang, range]);

  React.useEffect(() => { load(); }, [load]);

  const grouped  = data ? groupBy(data.data, r => dayjs(r.ngay_hach_toan).format('YYYY-MM-DD')) : {};
  const ngayList = Object.keys(grouped).sort();

  // Tổng kỳ
  const tongNhap = data?.data.reduce((s, r) => s + Number(r.nhap_sl || 0), 0) || 0;
  const tongXuat = data?.data.reduce((s, r) => s + Number(r.xuat_sl || 0), 0) || 0;

  return (
    <div>
      {/* Header */}
      <div style={{
        display:'flex', alignItems:'center', gap:12,
        marginBottom:16, paddingBottom:14,
        borderBottom:`1px solid ${C.border}`,
      }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack} size="small">Quay lại</Button>
        <div style={{
          width:36, height:36, borderRadius:8, flexShrink:0,
          background:'#dbeafe', color:'#1d4ed8',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:12, fontWeight:700,
        }}>
          <InboxOutlined />
        </div>
        <div>
          <div style={{ fontWeight:600, fontSize:15 }}>{data?.ten_hang || hang.ten_hang}</div>
          <div style={{ fontSize:12, color: C.sub, marginTop:2 }}>
            <Text code style={{ fontSize:11 }}>{hang.ma_hang}</Text>
            &nbsp;·&nbsp;{hang.kho}
            &nbsp;·&nbsp;{range[0]?.format('DD/MM/YYYY')} – {range[1]?.format('DD/MM/YYYY')}
          </div>
        </div>

        {/* Mini summary */}
        {data && (
          <div style={{ marginLeft:'auto', display:'flex', gap:20, fontSize:13 }}>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color: C.sub, textTransform:'uppercase', letterSpacing:'0.04em' }}>Tồn đầu kỳ</div>
              <div style={{ fontWeight:700, color: C.text }}>{Number(data.dau_ky_sl).toLocaleString('vi-VN')}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color: C.nhap, textTransform:'uppercase', letterSpacing:'0.04em' }}>Nhập kỳ</div>
              <div style={{ fontWeight:700, color: C.nhap }}>+{tongNhap.toLocaleString('vi-VN')}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color: C.xuat, textTransform:'uppercase', letterSpacing:'0.04em' }}>Xuất kỳ</div>
              <div style={{ fontWeight:700, color: C.xuat }}>-{tongXuat.toLocaleString('vi-VN')}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color: C.ton, textTransform:'uppercase', letterSpacing:'0.04em' }}>Tồn cuối kỳ</div>
              <div style={{ fontWeight:700, color: C.ton, fontSize:16 }}>
                {(Number(data.dau_ky_sl) + tongNhap - tongXuat).toLocaleString('vi-VN')}
              </div>
            </div>
          </div>
        )}
        <Button size="small" icon={<ReloadOutlined />} onClick={load} style={{ marginLeft: data ? 0 : 'auto' }} />
      </div>

      <Spin spinning={loading}>
        {!data ? null : (
          <>
            {/* Số dư đầu kỳ badge */}
            <div style={{
              display:'inline-flex', alignItems:'center', gap:8,
              padding:'7px 14px', marginBottom:16,
              background:'#f8fafc', border:`1px solid ${C.border}`,
              borderRadius:6, fontSize:13,
            }}>
              <span style={{ color: C.sub }}>Tồn đầu kỳ:</span>
              <span style={{ fontWeight:600 }}>{Number(data.dau_ky_sl).toLocaleString('vi-VN')}</span>
              <span style={{ color: C.muted, fontSize:12 }}>· {data.data.length} dòng phát sinh</span>
            </div>

            {ngayList.length === 0
              ? <Empty description="Không có phát sinh trong kỳ" style={{ padding:'32px 0' }} />
              : ngayList.map(ngay => {
                const rows     = grouped[ngay];
                const tNhap    = rows.reduce((s, r) => s + Number(r.nhap_sl || 0), 0);
                const tXuat    = rows.reduce((s, r) => s + Number(r.xuat_sl || 0), 0);
                const tonCuoi  = rows[rows.length - 1]?.ton_sl ?? 0;

                return (
                  <div key={ngay} style={{ marginBottom:14 }}>
                    {/* Header ngày */}
                    <div style={{
                      display:'flex', alignItems:'center', gap:8,
                      padding:'7px 12px',
                      background: C.groupBg,
                      border:`1px solid ${C.border}`,
                      borderBottom:'none',
                      borderRadius:'8px 8px 0 0',
                    }}>
                      <CalendarOutlined style={{ color: C.sub, fontSize:12 }} />
                      <span style={{ fontWeight:600, fontSize:13, color: C.text }}>
                        {dayjs(ngay).format('dddd, DD/MM/YYYY').replace(/^\w/, c => c.toUpperCase())}
                      </span>
                      <div style={{ marginLeft:'auto', display:'flex', gap:16, fontSize:12 }}>
                        {tNhap > 0 && (
                          <span>Nhập: <span style={{ color: C.nhap, fontWeight:600 }}>+{tNhap.toLocaleString('vi-VN')}</span></span>
                        )}
                        {tXuat > 0 && (
                          <span>Xuất: <span style={{ color: C.xuat, fontWeight:600 }}>-{tXuat.toLocaleString('vi-VN')}</span></span>
                        )}
                        <span style={{ color: C.sub }}>
                          Tồn: <span style={{ color: C.ton, fontWeight:600 }}>{Number(tonCuoi).toLocaleString('vi-VN')}</span>
                        </span>
                      </div>
                    </div>

                    {/* Bảng dòng chứng từ */}
                    <div style={{ border:`1px solid ${C.border}`, borderRadius:'0 0 8px 8px', overflow:'hidden' }}>
                      <table style={{ width:'100%', borderCollapse:'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...thS('left'), width:140 }}>Số chứng từ</th>
                            <th style={{ ...thS('left'), width:100 }}>Ngày CT</th>
                            <th style={{ ...thS('left'), minWidth:200 }}>Diễn giải</th>
                            <th style={{ ...thS('center'), width:55 }}>ĐVT</th>
                            <th style={{ ...thS('right'), width:100 }}>Đơn giá</th>
                            <th style={{ ...thS('right'), width:90, color: C.nhap }}>Nhập SL</th>
                            <th style={{ ...thS('right'), width:110, color: C.nhap }}>Nhập GT</th>
                            <th style={{ ...thS('right'), width:90, color: C.xuat }}>Xuất SL</th>
                            <th style={{ ...thS('right'), width:110, color: C.xuat }}>Xuất GT</th>
                            <th style={{ ...thS('right'), width:90, color: C.ton, borderRight:'none' }}>Tồn SL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr
                              key={i}
                              style={{ background: i % 2 === 0 ? C.rowOdd : C.rowEven }}
                            >
                              <td style={tdS('left')}>
                                <Text code style={{ fontSize:11 }}>{r.so_ct}</Text>
                              </td>
                              <td style={{ ...tdS('left'), color: C.sub }}>
                                {dayjs(r.ngay_ct || r.ngay_hach_toan).format('DD/MM/YYYY')}
                              </td>
                              <td style={{ ...tdS('left'), maxWidth:260, overflow:'hidden', textOverflow:'ellipsis' }}>
                                <span title={r.dien_giai}>{r.dien_giai || <span style={{ color: C.muted }}>—</span>}</span>
                              </td>
                              <td style={{ ...tdS('center'), color: C.sub }}>{r.dvt || '—'}</td>
                              <td style={tdS()}>
                                {Number(r.don_gia) > 0
                                  ? <span style={{ color: C.sub }}>{fmt(r.don_gia)}</span>
                                  : <span style={{ color: C.muted }}>—</span>}
                              </td>
                              <td style={tdS()}>
                                {Number(r.nhap_sl) > 0
                                  ? <span style={{ color: C.nhap, fontWeight:500 }}>+{Number(r.nhap_sl).toLocaleString('vi-VN')}</span>
                                  : <span style={{ color: C.muted }}>—</span>}
                              </td>
                              <td style={tdS()}>
                                {Number(r.nhap_gt) > 0
                                  ? <span style={{ color: C.nhap }}>{fmt(r.nhap_gt)}</span>
                                  : <span style={{ color: C.muted }}>—</span>}
                              </td>
                              <td style={tdS()}>
                                {Number(r.xuat_sl) > 0
                                  ? <span style={{ color: C.xuat, fontWeight:500 }}>-{Number(r.xuat_sl).toLocaleString('vi-VN')}</span>
                                  : <span style={{ color: C.muted }}>—</span>}
                              </td>
                              <td style={tdS()}>
                                {Number(r.xuat_gt) > 0
                                  ? <span style={{ color: C.xuat }}>{fmt(r.xuat_gt)}</span>
                                  : <span style={{ color: C.muted }}>—</span>}
                              </td>
                              <td style={{ ...tdS(), borderRight:'none' }}>
                                <span style={{
                                  fontWeight:600,
                                  color: Number(r.ton_sl) <= 0 ? C.warn : C.ton,
                                }}>
                                  {Number(r.ton_sl).toLocaleString('vi-VN')}
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function TonKho() {
  const [range, setRange]         = useState([dayjs().startOf('month'), dayjs()]);
  const [rawData, setRawData]     = useState([]);
  const [danhSachKho, setKhoList] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const [selectedHang, setHang]   = useState(null);
  const [filters, setFilters]     = useState({ q: '', kho: '' });

  async function loadData() {
    setLoading(true);
    try {
      const r = await api.get('/tonkho/tong-hop', {
        params: {
          tu_ngay:  range[0]?.format('YYYY-MM-DD'),
          den_ngay: range[1]?.format('YYYY-MM-DD'),
        },
      });
      setRawData(r.data.data || []);
      setKhoList(r.data.danhSachKho || []);
      setLoaded(true);
      setFilters({ q: '', kho: '' });
    } catch (e) {
      message.error('Lỗi tải tồn kho: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  // Filter phía client (tìm kiếm nhanh không cần gọi lại API)
  const filteredData = useMemo(() => {
    let d = rawData;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      d = d.filter(r =>
        (r.ma_hang || '').toLowerCase().includes(q) ||
        (r.ten_hang || '').toLowerCase().includes(q)
      );
    }
    if (filters.kho) {
      d = d.filter(r => r.kho === filters.kho);
    }
    return d;
  }, [rawData, filters]);

  return (
    <div>
      {selectedHang ? (
        <ChiTietPanel
          hang={selectedHang}
          range={range}
          onBack={() => setHang(null)}
        />
      ) : (
        <>
          {/* Bộ lọc kỳ */}
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:20, flexWrap:'wrap' }}>
            <RangePicker
              value={range}
              onChange={v => v && setRange(v)}
              format="DD/MM/YYYY"
              presets={[
                { label:'Tháng này',   value:[dayjs().startOf('month'), dayjs()] },
                { label:'Tháng trước', value:[dayjs().subtract(1,'month').startOf('month'), dayjs().subtract(1,'month').endOf('month')] },
                { label:'Quý này',     value:[dayjs().startOf('quarter'), dayjs()] },
                { label:'Năm nay',     value:[dayjs().startOf('year'), dayjs()] },
              ]}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={loadData} loading={loading}>
              Xem tồn kho
            </Button>
            {loaded && <Button icon={<ReloadOutlined />} onClick={loadData}>Làm mới</Button>}
            {loaded && (
              <Text style={{ color: C.sub, fontSize:12 }}>
                Từ {range[0]?.format('DD/MM/YYYY')} đến {range[1]?.format('DD/MM/YYYY')}
              </Text>
            )}
          </div>

          {!loaded && !loading && (
            <div style={{ textAlign:'center', padding:'60px 0', color: C.muted }}>
              <InboxOutlined style={{ fontSize:40, marginBottom:12, opacity:0.3 }} />
              <div style={{ fontSize:14 }}>Chọn kỳ và nhấn <b>Xem tồn kho</b></div>
            </div>
          )}

          {(loaded || loading) && (
            <TongHopTable
              data={filteredData}
              danhSachKho={danhSachKho}
              loading={loading}
              onSelect={setHang}
              onFilter={patch => setFilters(f => ({ ...f, ...patch }))}
              filters={filters}
            />
          )}
        </>
      )}
    </div>
  );
}
