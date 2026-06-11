import React, { useState, useCallback } from 'react';
import {
  DatePicker, Button, Input, Spin, Empty, Tag, Typography,
  Space, Row, Col, Tooltip, message
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, ArrowLeftOutlined,
  UserOutlined, CalendarOutlined, FileTextOutlined
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { formatMoney } from '../utils';

const { RangePicker } = DatePicker;
const { Text } = Typography;
const api = axios.create({ baseURL: '/api' });

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtMoney = (v) => {
  const n = Number(v) || 0;
  if (n === 0) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  return formatMoney(n) + ' đ';
};

const fmtMoneyColored = (v, color) => {
  const n = Number(v) || 0;
  if (n === 0) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
  return <span style={{ color, fontWeight: 500 }}>{formatMoney(n)} đ</span>;
};

const COLOR_NO = '#cf1322';
const COLOR_CO = '#389e0d';
const COLOR_DU = '#1677ff';

// Compact số tiền: 32.804.000 → 32.8tr
function fmtShort(v) {
  const n = Number(v) || 0;
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace('.0','') + ' tỷ';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1).replace('.0','') + 'tr';
  return formatMoney(n);
}

// Nhóm array theo key
function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

// ─── Bảng tổng hợp ──────────────────────────────────────────────────────────
function TongHopTable({ data, onSelect, loading }) {
  const [search, setSearch] = useState('');
  const [sort, setSort]     = useState({ key: 'ten_kh', dir: 1 });

  const filtered = data
    .filter(r => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (r.ma_kh||'').toLowerCase().includes(s) || (r.ten_kh||'').toLowerCase().includes(s);
    })
    .sort((a, b) => {
      let va = a[sort.key] || 0, vb = b[sort.key] || 0;
      if (typeof va === 'string') return sort.dir * va.localeCompare(vb);
      return sort.dir * (vb - va);
    });

  const totals = filtered.reduce((acc, r) => ({
    dau_ky_no: acc.dau_ky_no + Number(r.dau_ky_no||0),
    ps_no:     acc.ps_no     + Number(r.ps_no||0),
    ps_co:     acc.ps_co     + Number(r.ps_co||0),
    cuoi_ky:   acc.cuoi_ky   + Number(r.du_no_net||0),
  }), { dau_ky_no: 0, ps_no: 0, ps_co: 0, cuoi_ky: 0 });

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: -s.dir } : { key, dir: -1 });
  }
  function SortIcon({ k }) {
    if (sort.key !== k) return <span style={{ opacity: 0.25, marginLeft: 4 }}>↕</span>;
    return <span style={{ color: COLOR_DU, marginLeft: 4 }}>{sort.dir === 1 ? '↑' : '↓'}</span>;
  }

  return (
    <div>
      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <Input
          placeholder="Tìm mã KH hoặc tên khách hàng..."
          prefix={<SearchOutlined style={{ color: 'var(--color-text-tertiary)' }} />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          allowClear
          style={{ maxWidth: 320 }}
        />
        <Text style={{ marginLeft: 12, color: 'var(--color-text-secondary)', fontSize: 13 }}>
          {filtered.length} khách hàng
        </Text>
      </div>

      {/* Totals bar */}
      {filtered.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          marginBottom: 12,
          padding: '10px 14px',
          background: 'var(--color-background-secondary)',
          borderRadius: 8,
          fontSize: 13,
        }}>
          <div>
            <div style={{ color: 'var(--color-text-secondary)', marginBottom: 2 }}>Dư đầu kỳ</div>
            <div style={{ fontWeight: 500 }}>{fmtShort(totals.dau_ky_no)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--color-text-secondary)', marginBottom: 2 }}>Phát sinh nợ</div>
            <div style={{ fontWeight: 500, color: COLOR_NO }}>{fmtShort(totals.ps_no)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--color-text-secondary)', marginBottom: 2 }}>Phát sinh có</div>
            <div style={{ fontWeight: 500, color: COLOR_CO }}>{fmtShort(totals.ps_co)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--color-text-secondary)', marginBottom: 2 }}>Còn phải thu</div>
            <div style={{ fontWeight: 500, color: COLOR_DU }}>{fmtShort(totals.cuoi_ky)}</div>
          </div>
        </div>
      )}

      <Spin spinning={loading}>
        {filtered.length === 0 && !loading
          ? <Empty description="Không có công nợ trong kỳ" style={{ padding: '40px 0' }} />
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--color-background-secondary)' }}>
                    <th style={thStyle()} onClick={() => toggleSort('ma_kh')}>
                      Mã KH <SortIcon k="ma_kh" />
                    </th>
                    <th style={thStyle('left')} onClick={() => toggleSort('ten_kh')}>
                      Tên khách hàng <SortIcon k="ten_kh" />
                    </th>
                    {/* Đầu kỳ */}
                    <th colSpan={2} style={{ ...thStyle(), borderBottom: '1px solid var(--color-border-tertiary)', paddingBottom: 4, color: 'var(--color-text-secondary)' }}>
                      Số dư đầu kỳ
                    </th>
                    {/* Phát sinh */}
                    <th colSpan={2} style={{ ...thStyle(), borderBottom: '1px solid var(--color-border-tertiary)', paddingBottom: 4, color: 'var(--color-text-secondary)' }}>
                      Phát sinh
                    </th>
                    {/* Cuối kỳ */}
                    <th style={thStyle()} onClick={() => toggleSort('du_no_net')}>
                      Cuối kỳ (Nợ) <SortIcon k="du_no_net" />
                    </th>
                    <th style={thStyle()}></th>
                  </tr>
                  <tr style={{ background: 'var(--color-background-secondary)' }}>
                    <th style={thStyle()}></th>
                    <th style={thStyle('left')}></th>
                    <th style={thStyle()} onClick={() => toggleSort('dau_ky_no')}>
                      Nợ <SortIcon k="dau_ky_no" />
                    </th>
                    <th style={thStyle()}>Có</th>
                    <th style={thStyle()} onClick={() => toggleSort('ps_no')}>
                      Nợ <SortIcon k="ps_no" />
                    </th>
                    <th style={thStyle()} onClick={() => toggleSort('ps_co')}>
                      Có <SortIcon k="ps_co" />
                    </th>
                    <th style={thStyle()}></th>
                    <th style={thStyle()}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr
                      key={r.ma_kh}
                      style={{
                        borderBottom: '0.5px solid var(--color-border-tertiary)',
                        background: i % 2 === 0 ? 'var(--color-background-primary)' : 'var(--color-background-secondary)',
                        cursor: 'pointer',
                        transition: 'background 0.12s',
                      }}
                      onClick={() => onSelect(r)}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-background-info)'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'var(--color-background-primary)' : 'var(--color-background-secondary)'}
                    >
                      <td style={tdStyle('center')}>
                        <Text code style={{ fontSize: 11 }}>{r.ma_kh}</Text>
                      </td>
                      <td style={{ ...tdStyle('left'), fontWeight: 500, maxWidth: 180 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                            background: 'var(--color-background-info)',
                            color: 'var(--color-text-info)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 500,
                          }}>
                            {(r.ten_kh||r.ma_kh||'?')[0].toUpperCase()}
                          </div>
                          <span style={{ fontSize: 13 }}>{r.ten_kh || r.ma_kh}</span>
                        </div>
                      </td>
                      <td style={tdStyle()}>{fmtMoney(r.dau_ky_no)}</td>
                      <td style={tdStyle()}>{fmtMoney(r.dau_ky_co)}</td>
                      <td style={tdStyle()}>
                        {Number(r.ps_no) > 0 ? fmtMoneyColored(r.ps_no, COLOR_NO) : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                      </td>
                      <td style={tdStyle()}>
                        {Number(r.ps_co) > 0 ? fmtMoneyColored(r.ps_co, COLOR_CO) : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                      </td>
                      <td style={tdStyle()}>
                        {Number(r.du_no_net) > 0
                          ? <span style={{ color: COLOR_DU, fontWeight: 600 }}>{formatMoney(r.du_no_net)} đ</span>
                          : <Tag color="success" style={{ margin: 0 }}>Đã thu</Tag>
                        }
                      </td>
                      <td style={{ ...tdStyle(), paddingRight: 12 }}>
                        <Button size="small" type="link" icon={<FileTextOutlined />}
                          style={{ padding: 0 }}>
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

function thStyle(align = 'right') {
  return {
    padding: '8px 10px',
    textAlign: align,
    fontWeight: 500,
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--color-border-secondary)',
  };
}
function tdStyle(align = 'right') {
  return { padding: '8px 10px', textAlign: align, whiteSpace: 'nowrap' };
}
function tdTextStyle() {
  return { padding: '8px 10px', textAlign: 'left' };
}

// ─── Panel chi tiết 1 KH ────────────────────────────────────────────────────
function ChiTietPanel({ kh, range, onBack }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        ma_kh:    kh.ma_kh,
        tu_ngay:  range[0]?.format('YYYY-MM-DD'),
        den_ngay: range[1]?.format('YYYY-MM-DD'),
      };
      const r = await api.get('/congno/chi-tiet', { params });
      setData(r.data);
    } catch (e) {
      message.error('Lỗi tải chi tiết: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [kh.ma_kh, range]);

  React.useEffect(() => { load(); }, [load]);

  // Nhóm theo ngày
  const grouped = data ? groupBy(data.data, r => dayjs(r.ngay_ct).format('YYYY-MM-DD')) : {};
  const ngayList = Object.keys(grouped).sort();

  const duNoNet = Number(kh.du_no_net || 0);

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 16, paddingBottom: 14,
        borderBottom: '0.5px solid var(--color-border-tertiary)',
      }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack} type="text" size="small">
          Quay lại
        </Button>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'var(--color-background-info)',
          color: 'var(--color-text-info)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 500,
        }}>
          {(kh.ten_kh||kh.ma_kh||'?')[0].toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 500, fontSize: 15 }}>{kh.ten_kh || kh.ma_kh}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <Text code style={{ fontSize: 11 }}>{kh.ma_kh}</Text>
            &nbsp;·&nbsp;TK 131
            &nbsp;·&nbsp;{range[0]?.format('DD/MM/YYYY')} – {range[1]?.format('DD/MM/YYYY')}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Còn phải thu</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: duNoNet > 0 ? COLOR_DU : COLOR_CO }}>
            {formatMoney(Math.abs(duNoNet))} đ
          </div>
        </div>
        <Button size="small" icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>
      </div>

      <Spin spinning={loading}>
        {!data ? null : (
          <>
            {/* Số dư đầu kỳ */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', marginBottom: 12,
              background: 'var(--color-background-secondary)',
              borderRadius: 6, fontSize: 13,
            }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Số dư đầu kỳ:</span>
              <span style={{ fontWeight: 500 }}>
                {formatMoney(Math.abs(data.dau_ky_net))} đ
                {' '}
                <Tag style={{ margin: 0, fontSize: 11 }} color={data.dau_ky_net >= 0 ? 'blue' : 'green'}>
                  {data.dau_ky_net >= 0 ? 'Nợ' : 'Có'}
                </Tag>
              </span>
              <span style={{ marginLeft: 'auto', color: 'var(--color-text-secondary)' }}>
                {data.data.length} dòng phát sinh trong kỳ
              </span>
            </div>

            {/* Nhóm theo ngày */}
            {ngayList.length === 0
              ? <Empty description="Không có phát sinh trong kỳ" style={{ padding: '32px 0' }} />
              : ngayList.map(ngay => {
                const rows = grouped[ngay];
                const tongNo = rows.reduce((s, r) => s + Number(r.ps_no||0), 0);
                const tongCo = rows.reduce((s, r) => s + Number(r.ps_co||0), 0);
                const soDuCuoi = rows[rows.length - 1]?.so_du || 0;

                return (
                  <div key={ngay} style={{ marginBottom: 12 }}>
                    {/* Ngày header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px',
                      background: 'var(--color-background-secondary)',
                      borderRadius: '6px 6px 0 0',
                      borderBottom: '0.5px solid var(--color-border-secondary)',
                    }}>
                      <CalendarOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 13 }} />
                      <span style={{ fontWeight: 500, fontSize: 13 }}>
                        {dayjs(ngay).format('dddd, DD/MM/YYYY').replace(/^\w/, c => c.toUpperCase())}
                      </span>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 12 }}>
                        {tongNo > 0 && (
                          <span>PS Nợ: <span style={{ color: COLOR_NO, fontWeight: 500 }}>{fmtShort(tongNo)}</span></span>
                        )}
                        {tongCo > 0 && (
                          <span>PS Có: <span style={{ color: COLOR_CO, fontWeight: 500 }}>{fmtShort(tongCo)}</span></span>
                        )}
                        <span style={{ color: 'var(--color-text-secondary)' }}>
                          Dư: <span style={{ color: COLOR_DU, fontWeight: 500 }}>{fmtShort(soDuCuoi)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Bảng dòng chứng từ */}
                    <div style={{
                      border: '0.5px solid var(--color-border-tertiary)',
                      borderTop: 'none',
                      borderRadius: '0 0 6px 6px',
                      overflow: 'hidden',
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ background: 'var(--color-background-secondary)' }}>
                            <th style={{ ...tdStyle('left'), padding: '5px 10px', color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: 11.5 }}>Số chứng từ</th>
                            <th style={{ ...tdStyle('left'), padding: '5px 10px', color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: 11.5 }}>Diễn giải</th>
                            <th style={{ ...tdStyle(), padding: '5px 10px', color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: 11.5 }}>TK đối ứng</th>
                            <th style={{ ...tdStyle(), padding: '5px 10px', color: COLOR_NO, fontWeight: 500, fontSize: 11.5 }}>Phát sinh Nợ</th>
                            <th style={{ ...tdStyle(), padding: '5px 10px', color: COLOR_CO, fontWeight: 500, fontSize: 11.5 }}>Phát sinh Có</th>
                            <th style={{ ...tdStyle(), padding: '5px 10px', color: COLOR_DU, fontWeight: 500, fontSize: 11.5 }}>Số dư</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={i} style={{
                              borderTop: '0.5px solid var(--color-border-tertiary)',
                              background: i % 2 === 0 ? 'var(--color-background-primary)' : 'var(--color-background-secondary)',
                            }}>
                              <td style={{ ...tdStyle('left'), padding: '6px 10px' }}>
                                <Text code style={{ fontSize: 11 }}>{r.so_ct}</Text>
                              </td>
                              <td style={{ ...tdTextStyle(), padding: '6px 10px' }}>
                                {r.dien_giai || <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                              </td>
                              <td style={{ ...tdStyle(), padding: '6px 10px' }}>
                                <Tag style={{ margin: 0, fontSize: 11 }}>{r.tk_du}</Tag>
                              </td>
                              <td style={{ ...tdStyle(), padding: '6px 10px' }}>
                                {Number(r.ps_no) > 0
                                  ? <span style={{ color: COLOR_NO }}>{formatMoney(r.ps_no)} đ</span>
                                  : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                              </td>
                              <td style={{ ...tdStyle(), padding: '6px 10px' }}>
                                {Number(r.ps_co) > 0
                                  ? <span style={{ color: COLOR_CO }}>{formatMoney(r.ps_co)} đ</span>
                                  : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                              </td>
                              <td style={{ ...tdStyle(), padding: '6px 10px' }}>
                                <span style={{ fontWeight: 500, color: Number(r.so_du) >= 0 ? COLOR_DU : COLOR_CO }}>
                                  {formatMoney(Math.abs(r.so_du))} đ
                                  {' '}
                                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
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

// ─── Main component ──────────────────────────────────────────────────────────
export default function CongNo() {
  const [range, setRange]     = useState([dayjs().startOf('month'), dayjs()]);
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);
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
      {selectedKH
        ? (
          <ChiTietPanel
            kh={selectedKH}
            range={range}
            onBack={() => setSelectedKH(null)}
          />
        )
        : (
          <>
            {/* Bộ lọc */}
            <div style={{
              display: 'flex', gap: 8, alignItems: 'center',
              marginBottom: 16, flexWrap: 'wrap',
            }}>
              <RangePicker
                value={range}
                onChange={v => v && setRange(v)}
                format="DD/MM/YYYY"
                presets={[
                  { label: 'Tháng này',    value: [dayjs().startOf('month'), dayjs()] },
                  { label: 'Tháng trước',  value: [dayjs().subtract(1,'month').startOf('month'), dayjs().subtract(1,'month').endOf('month')] },
                  { label: 'Quý này',      value: [dayjs().startOf('quarter'), dayjs()] },
                  { label: 'Năm nay',      value: [dayjs().startOf('year'), dayjs()] },
                ]}
              />
              <Button
                type="primary" icon={<SearchOutlined />}
                onClick={loadData} loading={loading}
              >
                Xem công nợ
              </Button>
              {loaded && (
                <Button icon={<ReloadOutlined />} onClick={loadData}>Làm mới</Button>
              )}
              {loaded && (
                <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                  Từ {range[0]?.format('DD/MM/YYYY')} đến {range[1]?.format('DD/MM/YYYY')}
                </Text>
              )}
            </div>

            {!loaded && !loading && (
              <div style={{
                textAlign: 'center', padding: '60px 0',
                color: 'var(--color-text-secondary)',
              }}>
                <UserOutlined style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }} />
                <div>Chọn kỳ và nhấn <b>Xem công nợ</b></div>
              </div>
            )}

            {(loaded || loading) && (
              <TongHopTable
                data={data}
                loading={loading}
                onSelect={setSelectedKH}
              />
            )}
          </>
        )
      }
    </div>
  );
}
