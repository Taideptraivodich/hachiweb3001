import React, { useState, useCallback, useMemo } from 'react';
import {
  DatePicker, Button, Input, Select, Spin, Empty,
  Tag, Typography, Tooltip, message
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, ArrowLeftOutlined,
  InboxOutlined, CalendarOutlined, FileTextOutlined,
  WarningOutlined, BulbOutlined
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';
dayjs.extend(quarterOfYear);
import { formatMoney } from '../utils';

dayjs.locale('vi');

const { RangePicker } = DatePicker;
const { Text } = Typography;
const api = axios.create({ baseURL: '/api' });

// ─── Design tokens via CSS variables (dark/light tự động theo body.dark) ─────
const C = {
  bg:      'transparent',
  cardBg:  'var(--surface-2)',
  border:  'var(--border)',
  headerBg:'var(--header-bg)',
  rowOdd:  'var(--row-odd)',
  rowEven: 'var(--row-even)',
  rowHover:'var(--row-hover)',
  groupBg: 'var(--group-bg)',
  nhap:    '#16a34a',
  xuat:    '#dc2626',
  ton:     '#1677ff',
  warn:    '#d97706',
  muted:   'var(--text-muted)',
  text:    'var(--text)',
  sub:     'var(--text-sub)',
};
// Dark overrides cho màu accent (CSS variables không cover được dynamic)
function getC() {
  const isDark = document.body.classList.contains('dark');
  return isDark ? { ...C, nhap:'#4ade80', xuat:'#f87171', ton:'#60a5fa', warn:'#fbbf24' } : C;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt      = v => formatMoney(Number(v) || 0);
const fmtShort = v => {
  const n = Number(v) || 0;
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return (n / 1e9).toFixed(1).replace('.0', '') + ' tỷ';
  return formatMoney(n);
};

function groupBy(arr, fn) {
  return arr.reduce((acc, item) => {
    const k = fn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

const thS = (C, align = 'right') => ({
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
const tdS = (C, align = 'right', extra = {}) => ({
  padding: '8px 12px',
  textAlign: align,
  borderBottom: `1px solid ${C.border}`,
  borderRight:  `1px solid ${C.border}`,
  fontSize: 13,
  whiteSpace: 'nowrap',
  color: C.text,
  ...extra,
});

// ─── Bảng tổng hợp ───────────────────────────────────────────────────────────
function TongHopTableInner({ data, danhSachKho, loading, onSelect, onFilter, filters }) {
  const ROW_H  = 40;
  const OVERSCAN = 5;

  // ROOT CAUSE (Lỗi 3 - "panel tổng không đổi theo search"): trước đây totals
  // luôn tính từ `allData` (= dữ liệu đã lọc theo KHO nhưng CHƯA lọc theo từ khoá
  // tìm kiếm), nên khi gõ search, bảng đổi nhưng panel tổng phía trên im re.
  // Sửa: tính totals từ `data` (đã lọc đủ kho + search) để panel tổng luôn khớp
  // với số liệu đang hiển thị trong bảng.
  const totals = useMemo(() => data.reduce((acc, r) => ({
    dau_ky_sl:  acc.dau_ky_sl  + Number(r.dau_ky_sl  || 0),
    nhap_sl:    acc.nhap_sl    + Number(r.nhap_sl    || 0),
    xuat_sl:    acc.xuat_sl    + Number(r.xuat_sl    || 0),
    cuoi_ky_sl: acc.cuoi_ky_sl + Number(r.cuoi_ky_sl || 0),
    nhap_gt:    acc.nhap_gt    + Number(r.nhap_gt    || 0),
    xuat_gt:    acc.xuat_gt    + Number(r.xuat_gt    || 0),
    cuoi_ky_gt: acc.cuoi_ky_gt + Number(r.cuoi_ky_gt || 0),
  }), { dau_ky_sl:0, nhap_sl:0, xuat_sl:0, cuoi_ky_sl:0, nhap_gt:0, xuat_gt:0, cuoi_ky_gt:0 }), [data]);

  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewH, setViewH]         = React.useState(600);

  const scrollElRef = React.useRef(null);
  const cleanupRef  = React.useRef(null);
  const scrollRef = React.useCallback(el => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    scrollElRef.current = el;
    if (!el) return;
    setViewH(el.clientHeight || window.innerHeight - 380);
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    cleanupRef.current = () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);

  // ROOT CAUSE (Lỗi 1/3 - "vùng đen", "bảng vẫn render dữ liệu cũ" khi search/filter):
  // trước đây scrollTop chỉ được reset về 0 trong useEffect, useEffect chạy SAU
  // khi React đã render xong 1 lần với scrollTop CŨ + data MỚI → có 1 khung hình
  // virtual-scroll tính sai startIdx/endIdx (lệch dữ liệu) trước khi tự sửa lại.
  // Sửa: phát hiện data đổi NGAY trong lúc render (mẫu "adjust state while
  // rendering" của React) để scrollTop=0 áp dụng từ khung hình đầu tiên, không
  // còn khung hình trung gian hiển thị sai.
  const [prevData, setPrevData] = React.useState(data);
  if (data !== prevData) {
    setPrevData(data);
    setScrollTop(0);
  }

  React.useEffect(() => {
    if (scrollElRef.current) scrollElRef.current.scrollTop = 0;
  }, [data]);

  const [sort, setSort] = React.useState({ key: 'ten_hang', dir: 1 });
  const sortedData = React.useMemo(() => {
    const d = [...data];
    d.sort((a, b) => {
      const va = a[sort.key] ?? 0, vb = b[sort.key] ?? 0;
      if (typeof va === 'string') return sort.dir * va.localeCompare(vb, 'vi');
      return sort.dir * (Number(vb) - Number(va));
    });
    return d;
  }, [data, sort]);

  const toggleSort = k => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : -1 }));
  const sortIcon   = k => {
    if (sort.key !== k) return <span style={{ opacity:0.3, marginLeft:3, fontSize:10 }}>↕</span>;
    return <span style={{ color: C.ton, marginLeft:3, fontSize:10 }}>{sort.dir === -1 ? '↓' : '↑'}</span>;
  };
  const thSort = (k, align = 'right') => ({
    ...thS(C, align), cursor:'pointer', position:'sticky', top:0, zIndex:2,
  });

  const totalH       = sortedData.length * ROW_H;
  const safeScrollTop = scrollTop > totalH ? 0 : scrollTop;
  const startIdx    = Math.max(0, Math.floor(safeScrollTop / ROW_H) - OVERSCAN);
  const endIdx      = Math.min(sortedData.length, Math.ceil((safeScrollTop + viewH) / ROW_H) + OVERSCAN + 2);
  const visibleRows = sortedData.slice(startIdx, endIdx);
  const paddingTop    = startIdx * ROW_H;
  const paddingBottom = (sortedData.length - endIdx) * ROW_H;

  return (
    <div>
      {/* Toolbar */}
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
        display:'grid', gridTemplateColumns:'repeat(4, 1fr)',
        gap:1, marginBottom:16,
        border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden',
      }}>
        {[
          { label:'Tồn đầu kỳ',   sl:totals.dau_ky_sl,  gt:null,              color:C.text },
          { label:'Nhập trong kỳ', sl:totals.nhap_sl,    gt:totals.nhap_gt,    color:C.nhap },
          { label:'Xuất trong kỳ', sl:totals.xuat_sl,    gt:totals.xuat_gt,    color:C.xuat },
          { label:'Tồn cuối kỳ',  sl:totals.cuoi_ky_sl, gt:totals.cuoi_ky_gt, color:C.ton  },
        ].map(item => (
          <div key={item.label} style={{ padding:'12px 16px', background:C.cardBg, borderRight:`1px solid ${C.border}` }}>
            <div style={{ fontSize:11, color:C.sub, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>
              {item.label}
            </div>
            <div style={{ fontSize:20, fontWeight:700, color:item.color, fontVariantNumeric:'tabular-nums' }}>
              {item.sl.toLocaleString('vi-VN')}
            </div>
            {item.gt != null && (
              <div style={{ fontSize:12, color:C.sub, marginTop:2 }}>{fmtShort(item.gt)}&nbsp;đ</div>
            )}
          </div>
        ))}
      </div>

      <Spin spinning={loading}>
        {data.length === 0 && !loading
          ? <Empty description="Không có dữ liệu tồn kho trong kỳ" style={{ padding:'40px 0' }} />
          : (
            <div style={{ border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
              <div ref={scrollRef} style={{ overflowY:'auto', overflowX:'auto', maxHeight:'calc(100vh - 370px)', overscrollBehavior:'none' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed', minWidth:1050 }}>
                  <colgroup>
                    <col style={{width:130}}/><col style={{minWidth:220}}/><col style={{width:52}}/>
                    <col style={{width:75}}/><col style={{width:85}}/><col style={{width:125}}/>
                    <col style={{width:85}}/><col style={{width:125}}/><col style={{width:85}}/>
                    <col style={{width:130}}/><col style={{width:68}}/>
                  </colgroup>
                  <thead>
                    <tr>
                      <th onClick={() => toggleSort('ma_hang')}   style={thSort('ma_hang','left')}>Mã hàng {sortIcon('ma_hang')}</th>
                      <th onClick={() => toggleSort('ten_hang')}  style={thSort('ten_hang','left')}>Tên hàng {sortIcon('ten_hang')}</th>
                      <th style={{ ...thS(C,'center'), position:'sticky', top:0, zIndex:2 }}>ĐVT</th>
                      <th onClick={() => toggleSort('dau_ky_sl')} style={thSort('dau_ky_sl')}>Đầu kỳ (SL) {sortIcon('dau_ky_sl')}</th>
                      <th onClick={() => toggleSort('nhap_sl')}   style={{ ...thSort('nhap_sl'), color:C.nhap }}>Nhập SL {sortIcon('nhap_sl')}</th>
                      <th onClick={() => toggleSort('nhap_gt')}   style={{ ...thSort('nhap_gt'), color:C.nhap }}>Nhập GT {sortIcon('nhap_gt')}</th>
                      <th onClick={() => toggleSort('xuat_sl')}   style={{ ...thSort('xuat_sl'), color:C.xuat }}>Xuất SL {sortIcon('xuat_sl')}</th>
                      <th onClick={() => toggleSort('xuat_gt')}   style={{ ...thSort('xuat_gt'), color:C.xuat }}>Xuất GT {sortIcon('xuat_gt')}</th>
                      <th onClick={() => toggleSort('cuoi_ky_sl')} style={{ ...thSort('cuoi_ky_sl'), color:C.ton }}>Tồn SL {sortIcon('cuoi_ky_sl')}</th>
                      <th onClick={() => toggleSort('cuoi_ky_gt')} style={{ ...thSort('cuoi_ky_gt'), color:C.ton }}>Tồn GT {sortIcon('cuoi_ky_gt')}</th>
                      <th style={{ ...thS(C,'center'), position:'sticky', top:0, zIndex:2, borderRight:'none', cursor:'default' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paddingTop > 0 && <tr><td colSpan={11} style={{ height:paddingTop, padding:0, border:'none' }} /></tr>}
                    {visibleRows.map((r, _i) => {
                      const i = startIdx + _i;
                      const isCanhBao = Number(r.cuoi_ky_sl) <= 0;
                      return (
                        <tr key={`${r.ma_hang}__${r.kho || ''}`}
                          style={{ height:ROW_H, background:i%2===0?C.rowOdd:C.rowEven, cursor:'pointer' }}
                          onClick={() => onSelect(r)}
                          onMouseEnter={e => e.currentTarget.style.background = C.rowHover}
                          onMouseLeave={e => e.currentTarget.style.background = i%2===0?C.rowOdd:C.rowEven}
                        >
                          <td style={{ ...tdS(C,'left'), overflow:'hidden', textOverflow:'ellipsis', maxWidth:0 }}>
                            <Text code style={{ fontSize:13, whiteSpace:'nowrap' }} title={r.ma_hang}>{r.ma_hang}</Text>
                          </td>
                          <td style={tdS(C,'left', { overflow:'hidden', textOverflow:'ellipsis' })}>
                            <span title={r.ten_hang} style={{ fontWeight:500 }}>{r.ten_hang}</span>
                          </td>
                          <td style={{ ...tdS(C,'center'), color:C.sub }}>{r.dvt || '—'}</td>
                          <td style={tdS(C)}>
                            {Number(r.dau_ky_sl)!==0
                              ? <span style={{ fontVariantNumeric:'tabular-nums' }}>{Number(r.dau_ky_sl).toLocaleString('vi-VN')}</span>
                              : <span style={{ color:C.muted }}>—</span>}
                          </td>
                          <td style={tdS(C)}>
                            {Number(r.nhap_sl)>0
                              ? <span style={{ color:C.nhap, fontWeight:500 }}>{Number(r.nhap_sl).toLocaleString('vi-VN')}</span>
                              : <span style={{ color:C.muted }}>—</span>}
                          </td>
                          <td style={tdS(C)}>
                            {Number(r.nhap_gt)>0 ? <span style={{ color:C.nhap }}>{fmt(r.nhap_gt)}</span> : <span style={{ color:C.muted }}>—</span>}
                          </td>
                          <td style={tdS(C)}>
                            {Number(r.xuat_sl)>0
                              ? <span style={{ color:C.xuat, fontWeight:500 }}>{Number(r.xuat_sl).toLocaleString('vi-VN')}</span>
                              : <span style={{ color:C.muted }}>—</span>}
                          </td>
                          <td style={tdS(C)}>
                            {Number(r.xuat_gt)>0 ? <span style={{ color:C.xuat }}>{fmt(r.xuat_gt)}</span> : <span style={{ color:C.muted }}>—</span>}
                          </td>
                          <td style={tdS(C)}>
                            {isCanhBao
                              ? <Tooltip title="Tồn kho bằng 0 hoặc âm">
                                  <span style={{ color:C.warn, fontWeight:700, display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end' }}>
                                    <WarningOutlined style={{ fontSize:12 }} />
                                    {Number(r.cuoi_ky_sl).toLocaleString('vi-VN')}
                                  </span>
                                </Tooltip>
                              : <span style={{ color:C.ton, fontWeight:700 }}>{Number(r.cuoi_ky_sl).toLocaleString('vi-VN')}</span>
                            }
                          </td>
                          <td style={tdS(C)}>
                            {Number(r.cuoi_ky_gt)!==0 ? <span style={{ color:C.ton }}>{fmt(r.cuoi_ky_gt)}</span> : <span style={{ color:C.muted }}>—</span>}
                          </td>
                          <td style={{ ...tdS(C,'center'), borderRight:'none' }}>
                            <Button size="small" type="link" icon={<FileTextOutlined />} style={{ padding:0, fontSize:12 }}>Chi tiết</Button>
                          </td>
                        </tr>
                      );
                    })}
                    {paddingBottom > 0 && <tr><td colSpan={11} style={{ height:paddingBottom, padding:0, border:'none' }} /></tr>}

                  </tbody>
                  <tfoot>
                    <tr style={{ background:C.headerBg, fontWeight:700 }}>
                      <td colSpan={3} style={{ ...tdS(C,'left'), borderTop:`2px solid ${C.border}`, fontSize:12, color:C.sub }}>
                        Tổng cộng ({data.length} mặt hàng)
                      </td>
                      <td style={{ ...tdS(C), borderTop:`2px solid ${C.border}` }}>{totals.dau_ky_sl.toLocaleString('vi-VN')}</td>
                      <td style={{ ...tdS(C), borderTop:`2px solid ${C.border}`, color:C.nhap }}>{totals.nhap_sl.toLocaleString('vi-VN')}</td>
                      <td style={{ ...tdS(C), borderTop:`2px solid ${C.border}`, color:C.nhap }}>{fmt(totals.nhap_gt)}</td>
                      <td style={{ ...tdS(C), borderTop:`2px solid ${C.border}`, color:C.xuat }}>{totals.xuat_sl.toLocaleString('vi-VN')}</td>
                      <td style={{ ...tdS(C), borderTop:`2px solid ${C.border}`, color:C.xuat }}>{fmt(totals.xuat_gt)}</td>
                      <td style={{ ...tdS(C), borderTop:`2px solid ${C.border}`, color:C.ton }}>{totals.cuoi_ky_sl.toLocaleString('vi-VN')}</td>
                      <td style={{ ...tdS(C), borderTop:`2px solid ${C.border}`, color:C.ton }}>{fmt(totals.cuoi_ky_gt)}</td>
                      <td style={{ ...tdS(C), borderTop:`2px solid ${C.border}`, borderRight:'none' }}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )
        }
      </Spin>
    </div>
  );
}

const TongHopTable = React.memo(TongHopTableInner, (prev, next) =>
  prev.data === next.data &&
  prev.loading === next.loading &&
  prev.filters === next.filters &&
  prev.danhSachKho === next.danhSachKho
);

// ─── Panel chi tiết ───────────────────────────────────────────────────────────
export function ChiTietPanel({ hang, initialRange, onBack }) {
  const [range, setRange]     = useState(initialRange);
  const [data, setData]       = useState(null);
  const [loading, setLoad]    = useState(false);

  const load = useCallback(async (r) => {
    setLoad(true);
    try {
      const res = await api.get('/tonkho/chi-tiet', {
        params: {
          ma_hang:  hang.ma_hang,
          tu_ngay:  r[0]?.format('YYYY-MM-DD'),
          den_ngay: r[1]?.format('YYYY-MM-DD'),
        },
      });
      setData(res.data);
    } catch (e) {
      message.error('Lỗi tải chi tiết: ' + e.message);
    } finally {
      setLoad(false);
    }
  }, [hang.ma_hang]);

  React.useEffect(() => { load(range); }, []);

  const handleRangeChange = v => {
    if (!v) return;
    setRange(v);
    load(v);
  };

  const grouped  = data ? groupBy(data.data, r => dayjs(r.ngay_hach_toan).format('YYYY-MM-DD')) : {};
  const ngayList = Object.keys(grouped).sort();
  const tongNhap = data?.data.reduce((s, r) => s + Number(r.nhap_sl || 0), 0) || 0;
  const tongXuat = data?.data.reduce((s, r) => s + Number(r.xuat_sl || 0), 0) || 0;
  const dauKySL  = Number(data?.dau_ky_sl || 0);
  const dauKyDonGia = Number(data?.dau_ky_don_gia || 0);

  return (
    <div>
      {/* Header */}
      <div style={{
        display:'flex', alignItems:'center', gap:12,
        marginBottom:16, paddingBottom:14,
        borderBottom:`1px solid ${C.border}`,
        flexWrap:'wrap',
      }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack} size="small">Quay lại</Button>
        <div style={{
          width:36, height:36, borderRadius:8, flexShrink:0,
          background:'#dbeafe', color:'#1d4ed8',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700,
        }}>
          <InboxOutlined />
        </div>
        <div>
          <div style={{ fontWeight:600, fontSize:15, color:C.text }}>{data?.ten_hang || hang.ten_hang}</div>
          <div style={{ fontSize:12, color:C.sub, marginTop:2 }}>
            <Text code style={{ fontSize:11 }}>{hang.ma_hang}</Text>
            &nbsp;·&nbsp;{hang.kho}
          </div>
        </div>

        {/* Lọc ngày ngay trong chi tiết */}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginLeft:8 }}>
          <RangePicker
            value={range}
            onChange={handleRangeChange}
            format="DD/MM/YYYY"
            size="small"
            presets={[
              { label:'Tháng này',   value:[dayjs().startOf('month'), dayjs()] },
              { label:'Tháng trước', value:[dayjs().subtract(1,'month').startOf('month'), dayjs().subtract(1,'month').endOf('month')] },
              { label:'Quý này',     value:[dayjs().startOf('quarter'), dayjs()] },
              { label:'Năm nay',     value:[dayjs().startOf('year'), dayjs()] },
            ]}
          />
          <Button size="small" icon={<ReloadOutlined />} onClick={() => load(range)} />
        </div>

        {/* Mini summary */}
        {data && (
          <div style={{ marginLeft:'auto', display:'flex', gap:20, fontSize:13 }}>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:C.sub, textTransform:'uppercase', letterSpacing:'0.04em' }}>Tồn đầu kỳ</div>
              <div style={{ fontWeight:700, color:C.text }}>{dauKySL.toLocaleString('vi-VN')}</div>
              {dauKyDonGia > 0 && <div style={{ fontSize:11, color:C.muted }}>{fmt(dauKyDonGia)}/cái</div>}
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:C.nhap, textTransform:'uppercase', letterSpacing:'0.04em' }}>Nhập kỳ</div>
              <div style={{ fontWeight:700, color:C.nhap }}>+{tongNhap.toLocaleString('vi-VN')}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:C.xuat, textTransform:'uppercase', letterSpacing:'0.04em' }}>Xuất kỳ</div>
              <div style={{ fontWeight:700, color:C.xuat }}>-{tongXuat.toLocaleString('vi-VN')}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:C.ton, textTransform:'uppercase', letterSpacing:'0.04em' }}>Tồn cuối kỳ</div>
              <div style={{ fontWeight:700, color:C.ton, fontSize:16 }}>
                {(dauKySL + tongNhap - tongXuat).toLocaleString('vi-VN')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* [DEBUG/FIX phiên 2026-06-17] Trước đây ChiTietPanel không hiển thị
          from_cache/cache_note ở đâu cả — user không biết đang xem dữ liệu
          online hay cache của một kỳ khác. Thêm banner để lộ rõ điều này,
          tương tự cách đã làm ở bảng Tổng hợp tồn kho. */}
      {data?.from_cache && (
        <div style={{
          display:'flex', alignItems:'flex-start', gap:8,
          padding:'10px 14px', marginBottom:14,
          background:'rgba(217,119,6,0.12)', border:'1px solid #d97706',
          borderRadius:6, fontSize:13, color:C.text,
        }}>
          <WarningOutlined style={{ color:'#d97706', marginTop:2 }} />
          <div>
            <div style={{ fontWeight:600 }}>Đang xem dữ liệu cache offline (MISA không kết nối được)</div>
            <div style={{ color:C.sub, marginTop:2 }}>{data.cache_note}</div>
          </div>
        </div>
      )}

      <Spin spinning={loading}>
        {!data ? null : (
          <>
            {/* Badge đầu kỳ */}
            <div style={{
              display:'inline-flex', alignItems:'center', gap:8,
              padding:'7px 14px', marginBottom:16,
              background:C.cardBg, border:`1px solid ${C.border}`,
              borderRadius:6, fontSize:14,
            }}>
              <span style={{ color:C.sub }}>Tồn đầu kỳ:</span>
              <span style={{ fontWeight:600, color:C.text }}>{dauKySL.toLocaleString('vi-VN')}</span>
              {dauKyDonGia > 0 && (
                <Tag color="blue" style={{ margin:0, fontSize:14 }}>
                  Đơn giá: {fmt(dauKyDonGia)}
                </Tag>
              )}
              <span style={{ color:C.muted, fontSize:12 }}>· {data.data.length} dòng phát sinh</span>
            </div>

            {ngayList.length === 0
              ? <Empty description="Không có phát sinh trong kỳ" style={{ padding:'32px 0' }} />
              : ngayList.map(ngay => {
                  const rows    = grouped[ngay];
                  const tNhap   = rows.reduce((s, r) => s + Number(r.nhap_sl || 0), 0);
                  const tXuat   = rows.reduce((s, r) => s + Number(r.xuat_sl || 0), 0);
                  const tonCuoi = rows[rows.length - 1]?.ton_sl ?? 0;

                  return (
                    <div key={ngay} style={{ marginBottom:14 }}>
                      <div style={{
                        display:'flex', alignItems:'center', gap:8,
                        padding:'7px 12px',
                        background:C.groupBg,
                        border:`1px solid ${C.border}`,
                        borderBottom:'none',
                        borderRadius:'8px 8px 0 0',
                      }}>
                        <CalendarOutlined style={{ color:C.sub, fontSize:12 }} />
                        <span style={{ fontWeight:600, fontSize:13, color:C.text }}>
                          {dayjs(ngay).format('dddd, DD/MM/YYYY').replace(/^\w/, c => c.toUpperCase())}
                        </span>
                        <div style={{ marginLeft:'auto', display:'flex', gap:16, fontSize:12 }}>
                          {tNhap > 0 && <span style={{ color:C.text }}>Nhập: <span style={{ color:C.nhap, fontWeight:600 }}>+{tNhap.toLocaleString('vi-VN')}</span></span>}
                          {tXuat > 0 && <span style={{ color:C.text }}>Xuất: <span style={{ color:C.xuat, fontWeight:600 }}>-{tXuat.toLocaleString('vi-VN')}</span></span>}
                          <span style={{ color:C.sub }}>Tồn: <span style={{ color:C.ton, fontWeight:600 }}>{Number(tonCuoi).toLocaleString('vi-VN')}</span></span>
                        </div>
                      </div>

                      <div style={{ border:`1px solid ${C.border}`, borderRadius:'0 0 8px 8px', overflow:'hidden' }}>
                        <table style={{ width:'100%', borderCollapse:'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ ...thS(C,'left'), width:140 }}>Số chứng từ</th>
                              <th style={{ ...thS(C,'left'), width:100 }}>Ngày CT</th>
                              <th style={{ ...thS(C,'left'), minWidth:200 }}>Diễn giải</th>
                              <th style={{ ...thS(C,'left'), width:120 }}>Tên kho</th>
                              <th style={{ ...thS(C,'center'), width:55 }}>ĐVT</th>
                              <th style={{ ...thS(C,'right'), width:100 }}>Đơn giá</th>
                              <th style={{ ...thS(C,'right'), width:90, color:C.nhap }}>Nhập SL</th>
                              <th style={{ ...thS(C,'right'), width:110, color:C.nhap }}>Nhập GT</th>
                              <th style={{ ...thS(C,'right'), width:90, color:C.xuat }}>Xuất SL</th>
                              <th style={{ ...thS(C,'right'), width:110, color:C.xuat }}>Xuất GT</th>
                              <th style={{ ...thS(C,'right'), width:90, color:C.ton, borderRight:'none' }}>Tồn SL</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={i} style={{ background:i%2===0?C.rowOdd:C.rowEven }}>
                                <td style={tdS(C,'left')}><Text code style={{ fontSize:11 }}>{r.so_ct}</Text></td>
                                <td style={{ ...tdS(C,'left'), color:C.sub }}>{dayjs(r.ngay_ct||r.ngay_hach_toan).format('DD/MM/YYYY')}</td>
                                <td style={{ ...tdS(C,'left'), maxWidth:260, overflow:'hidden', textOverflow:'ellipsis' }}>
                                  <span title={r.dien_giai}>{r.dien_giai || <span style={{ color:C.muted }}>—</span>}</span>
                                </td>
                                <td style={{ ...tdS(C,'left'), color:C.sub }}>{r.kho || <span style={{ color:C.muted }}>—</span>}</td>
                                <td style={{ ...tdS(C,'center'), color:C.sub }}>{r.dvt || '—'}</td>
                                <td style={tdS(C)}>
                                  {Number(r.don_gia)>0 ? <span style={{ color:C.sub }}>{fmt(r.don_gia)}</span> : <span style={{ color:C.muted }}>—</span>}
                                </td>
                                <td style={tdS(C)}>
                                  {Number(r.nhap_sl)>0 ? <span style={{ color:C.nhap, fontWeight:500 }}>+{Number(r.nhap_sl).toLocaleString('vi-VN')}</span> : <span style={{ color:C.muted }}>—</span>}
                                </td>
                                <td style={tdS(C)}>
                                  {Number(r.nhap_gt)>0 ? <span style={{ color:C.nhap }}>{fmt(r.nhap_gt)}</span> : <span style={{ color:C.muted }}>—</span>}
                                </td>
                                <td style={tdS(C)}>
                                  {Number(r.xuat_sl)>0 ? <span style={{ color:C.xuat, fontWeight:500 }}>-{Number(r.xuat_sl).toLocaleString('vi-VN')}</span> : <span style={{ color:C.muted }}>—</span>}
                                </td>
                                <td style={tdS(C)}>
                                  {Number(r.xuat_gt)>0 ? <span style={{ color:C.xuat }}>{fmt(r.xuat_gt)}</span> : <span style={{ color:C.muted }}>—</span>}
                                </td>
                                <td style={{ ...tdS(C), borderRight:'none' }}>
                                  <span style={{ fontWeight:600, color:Number(r.ton_sl)<=0?C.warn:C.ton }}>
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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TonKho() {
  const C = React.useMemo(() => getC(), []);

  const [range, setRange]         = useState([dayjs().startOf('month'), dayjs()]);
  const [rawData, setRawData]     = useState([]);
  const [danhSachKho, setKhoList] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const [selectedHang, setHang]   = useState(null);
  const [filters, setFilters]     = useState({ q:'', kho:'' });

  const handleSelect = useCallback(r => setHang(r), []);
  const handleFilter = useCallback(patch => setFilters(f => ({ ...f, ...patch })), []);

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
      setFilters({ q:'', kho:'' });
    } catch (e) {
      message.error('Lỗi tải tồn kho: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  const khoFilteredData = useMemo(() => {
    if (!filters.kho) return rawData;
    return rawData.filter(r => r.kho === filters.kho);
  }, [rawData, filters.kho]);

  const filteredData = useMemo(() => {
    let d = khoFilteredData;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      d = d.filter(r => (r.ma_hang||'').toLowerCase().includes(q) || (r.ten_hang||'').toLowerCase().includes(q));
    }
    return d;
  }, [khoFilteredData, filters.q]);

  return (
    <div style={{ minHeight:'100%', color:C.text }}>
      {selectedHang ? (
        <ChiTietPanel
          hang={selectedHang}
          initialRange={range}
          onBack={() => setHang(null)}
        />
      ) : (
        <>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:20, flexWrap:'wrap' }}>
            <RangePicker
              value={range}
              onChange={(v, s) => { if (v?.[0] && v?.[1]) { setRange(v); setTimeout(loadData, 0); } else if (v) { setRange(v); } }}
              format="DD/MM/YYYY"
              presets={[
                { label:'Tháng này',   value:[dayjs().startOf('month'), dayjs()] },
                { label:'Tháng trước', value:[dayjs().subtract(1,'month').startOf('month'), dayjs().subtract(1,'month').endOf('month')] },
                { label:'Quý này',     value:[dayjs().startOf('quarter'), dayjs()] },
                { label:'Năm nay',     value:[dayjs().startOf('year'), dayjs()] },
              ]}
            />
            <Button id="btn-xem-tonkho" type="primary" icon={<SearchOutlined />} onClick={loadData} loading={loading}>
              Xem tồn kho
            </Button>
            {loaded && <Button icon={<ReloadOutlined />} onClick={loadData}>Làm mới</Button>}
            {loaded && (
              <Text style={{ color:C.sub, fontSize:12 }}>
                Từ {range[0]?.format('DD/MM/YYYY')} đến {range[1]?.format('DD/MM/YYYY')}
              </Text>
            )}
          </div>

          {!loaded && !loading && (
            <div style={{ textAlign:'center', padding:'60px 0', color:C.muted }}>
              <InboxOutlined style={{ fontSize:40, marginBottom:12, opacity:0.3 }} />
              <div style={{ fontSize:14 }}>Chọn kỳ và nhấn <b>Xem tồn kho</b></div>
            </div>
          )}

          {(loaded || loading) && (
            <TongHopTable
              data={filteredData}
              danhSachKho={danhSachKho}
              loading={loading}
              onSelect={handleSelect}
              onFilter={handleFilter}
              filters={filters}
            />
          )}
        </>
      )}
    </div>
  );
}
