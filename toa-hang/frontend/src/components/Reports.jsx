import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Table, DatePicker, Statistic, Typography, Tabs, Tag, Tooltip
} from 'antd';
import {
  ShoppingOutlined, TeamOutlined, FileTextOutlined,
  RiseOutlined, FallOutlined, BarChartOutlined, AppstoreOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getReportSummary, getTopProducts, getTopCustomers,
  getDailyReport, getOrderDetailsReport
} from '../api';

const { RangePicker } = DatePicker;

// ─── Format tiền VND ──────────────────────────────────────────────────────────
function fmtMoney(val) {
  const n = Number(val) || 0;
  return n.toLocaleString('vi-VN') + 'đ';
}
function fmtNum(val) {
  return (Number(val) || 0).toLocaleString('vi-VN');
}
function fmtPct(val) {
  const n = Number(val) || 0;
  return n.toFixed(1) + '%';
}
function fmtDate(val) {
  if (!val) return '—';
  return dayjs(val).format('DD/MM/YYYY');
}

// ─── Màu lợi nhuận ───────────────────────────────────────────────────────────
function LNCell({ value }) {
  const n = Number(value) || 0;
  const color = n > 0 ? '#52c41a' : n < 0 ? '#ff4d4f' : '#666';
  return <span style={{ color, fontWeight: 600 }}>{fmtMoney(n)}</span>;
}

// ─── Màu tỷ suất ─────────────────────────────────────────────────────────────
function TySuatCell({ value }) {
  const n = Number(value) || 0;
  const color = n >= 20 ? '#52c41a' : n >= 10 ? '#faad14' : n > 0 ? '#1677ff' : '#ff4d4f';
  return <span style={{ color, fontWeight: 600 }}>{fmtPct(n)}</span>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ title, value, suffix, icon, color, subtext }) {
  return (
    <Card size="small" style={{ height: '100%', borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#222', lineHeight: 1.2 }}>
            {value}{suffix && <span style={{ fontSize: 13, fontWeight: 400, color: '#555' }}>{suffix}</span>}
          </div>
          {subtext && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{subtext}</div>}
        </div>
        <div style={{ fontSize: 22, color, opacity: 0.8 }}>{icon}</div>
      </div>
    </Card>
  );
}

// ─── Columns ──────────────────────────────────────────────────────────────────
const topProdCols = [
  { title: '#', width: 40, render: (_, __, i) => <span style={{ color: '#aaa' }}>{i + 1}</span> },
  { title: 'Tên hàng', dataIndex: 'ten_hang', ellipsis: true,
    render: v => <span style={{ fontWeight: 500 }}>{v}</span> },
  { title: 'Mã hàng', dataIndex: 'ma_hang', width: 130, render: v => <code style={{ fontSize: 12 }}>{v}</code> },
  { title: 'SL', dataIndex: 'tong_so_luong', width: 70, align: 'right',
    render: v => <b>{fmtNum(v)}</b> },
  { title: 'Doanh thu', dataIndex: 'doanh_thu', width: 130, align: 'right',
    render: v => <span style={{ color: '#1677ff', fontWeight: 600 }}>{fmtMoney(v)}</span> },
  { title: 'Giá vốn', dataIndex: 'gia_von', width: 120, align: 'right',
    render: v => fmtMoney(v) },
  { title: 'Lợi nhuận', dataIndex: 'loi_nhuan', width: 130, align: 'right',
    render: v => <LNCell value={v} /> },
  { title: 'Số phiếu', dataIndex: 'so_phieu', width: 80, align: 'right' },
];

const topCusCols = [
  { title: '#', width: 40, render: (_, __, i) => <span style={{ color: '#aaa' }}>{i + 1}</span> },
  { title: 'Tên khách', dataIndex: 'ten_kh', ellipsis: true,
    render: v => <span style={{ fontWeight: 500 }}>{v || '—'}</span> },
  { title: 'Mã khách', dataIndex: 'ma_kh', width: 120, render: v => <code style={{ fontSize: 12 }}>{v || '—'}</code> },
  { title: 'Số phiếu', dataIndex: 'so_phieu', width: 80, align: 'right' },
  { title: 'SL hàng', dataIndex: 'tong_so_luong', width: 80, align: 'right', render: v => fmtNum(v) },
  { title: 'Doanh thu', dataIndex: 'doanh_thu', width: 130, align: 'right',
    render: v => <span style={{ color: '#1677ff', fontWeight: 600 }}>{fmtMoney(v)}</span> },
  { title: 'Giá vốn', dataIndex: 'gia_von', width: 120, align: 'right', render: v => fmtMoney(v) },
  { title: 'Lợi nhuận', dataIndex: 'loi_nhuan', width: 130, align: 'right',
    render: v => <LNCell value={v} /> },
  { title: 'Lần mua gần nhất', dataIndex: 'lan_mua_gan_nhat', width: 130, align: 'center',
    render: v => fmtDate(v) },
];

const dailyCols = [
  { title: 'Ngày', dataIndex: 'ngay', width: 110,
    render: v => <b>{fmtDate(v)}</b> },
  { title: 'Số phiếu', dataIndex: 'so_phieu', width: 80, align: 'right' },
  { title: 'Số khách', dataIndex: 'so_khach', width: 80, align: 'right' },
  { title: 'SL hàng', dataIndex: 'tong_so_luong', width: 80, align: 'right', render: v => fmtNum(v) },
  { title: 'Doanh thu', dataIndex: 'doanh_thu', width: 130, align: 'right',
    render: v => <span style={{ color: '#1677ff', fontWeight: 600 }}>{fmtMoney(v)}</span> },
  { title: 'Giá vốn', dataIndex: 'gia_von', width: 120, align: 'right', render: v => fmtMoney(v) },
  { title: 'Lợi nhuận', dataIndex: 'loi_nhuan', width: 130, align: 'right',
    render: v => <LNCell value={v} /> },
];

const orderDetailCols = [
  { title: 'Ngày', dataIndex: 'ngay_tao', width: 100, render: v => fmtDate(v) },
  { title: 'Mã đơn', dataIndex: 'ma_don', width: 120, render: v => <code style={{ fontSize: 12 }}>{v || '—'}</code> },
  { title: 'Mã toa', dataIndex: 'ma_toa', width: 80, render: v => <span style={{ fontSize: 12, color: '#888' }}>{v}</span> },
  { title: 'Khách hàng', dataIndex: 'ten_kh', ellipsis: true },
  { title: 'Dòng', dataIndex: 'so_dong', width: 60, align: 'right' },
  { title: 'SL', dataIndex: 'tong_so_luong', width: 70, align: 'right', render: v => fmtNum(v) },
  { title: 'Doanh thu', dataIndex: 'doanh_thu', width: 130, align: 'right',
    render: v => <span style={{ color: '#1677ff', fontWeight: 600 }}>{fmtMoney(v)}</span> },
  { title: 'Giá vốn', dataIndex: 'gia_von', width: 120, align: 'right', render: v => fmtMoney(v) },
  { title: 'Lợi nhuận', dataIndex: 'loi_nhuan', width: 130, align: 'right',
    render: v => <LNCell value={v} /> },
  { title: 'Trạng thái', dataIndex: 'trang_thai', width: 110, align: 'center',
    render: v => {
      const color = v === 'Đã hoàn thành' ? 'green' : v === 'Đã hủy' ? 'red' : 'blue';
      return <Tag color={color} style={{ fontSize: 11 }}>{v}</Tag>;
    }},
];

// ─── Main component ───────────────────────────────────────────────────────────
export default function Reports() {
  const [range, setRange] = useState([dayjs().startOf('month'), dayjs()]);
  const [summary,     setSummary]     = useState({});
  const [topProds,    setTopProds]    = useState([]);
  const [topCus,      setTopCus]      = useState([]);
  const [daily,       setDaily]       = useState([]);
  const [orderDetail, setOrderDetail] = useState([]);
  const [loading,     setLoading]     = useState(false);

  const loadAll = useCallback(async () => {
    if (!range?.[0] || !range?.[1]) return;
    setLoading(true);
    const params = {
      from: range[0].format('YYYY-MM-DD'),
      to:   range[1].format('YYYY-MM-DD'),
    };
    try {
      const [s, t, tc, d, od] = await Promise.all([
        getReportSummary(params),
        getTopProducts({ ...params, limit: 50 }),
        getTopCustomers({ ...params, limit: 50 }),
        getDailyReport(params),
        getOrderDetailsReport(params),
      ]);
      setSummary(s);
      setTopProds(Array.isArray(t) ? t : []);
      setTopCus(Array.isArray(tc) ? tc : []);
      setDaily(Array.isArray(d) ? d : []);
      setOrderDetail(Array.isArray(od) ? od : []);
    } catch (e) {
      console.error('Report load error:', e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const dt = summary.doanh_thu || 0;
  const gv = summary.gia_von   || 0;
  const ln = dt - gv;
  const ts = dt > 0 ? (ln / dt * 100) : 0;

  const kpiCards = [
    { title: 'Tổng phiếu',          value: fmtNum(summary.tong_toa),       icon: <FileTextOutlined />, color: '#1677ff' },
    { title: 'Doanh thu',            value: fmtMoney(dt),                    icon: <ShoppingOutlined />, color: '#13c2c2' },
    { title: 'Giá vốn',             value: fmtMoney(gv),                    icon: <FallOutlined />,     color: '#fa8c16' },
    { title: 'Lợi nhuận gộp',       value: fmtMoney(ln),                    icon: <RiseOutlined />,     color: '#52c41a' },
    { title: 'Tỷ suất LN',          value: fmtPct(ts),                      icon: <BarChartOutlined />, color: ts >= 20 ? '#52c41a' : ts >= 10 ? '#faad14' : '#ff4d4f' },
    { title: 'Số khách',            value: fmtNum(summary.tong_khach),      icon: <TeamOutlined />,     color: '#722ed1' },
    { title: 'Số lượng hàng bán',   value: fmtNum(summary.tong_so_luong),  icon: <AppstoreOutlined />, color: '#eb2f96' },
  ];

  const tableScroll = { x: 800 };

  const tabs = [
    {
      key: 'top',
      label: 'Top mặt hàng',
      children: (
        <Table
          dataSource={topProds}
          columns={topProdCols}
          rowKey={(r, i) => `${r.ma_hang}_${i}`}
          size="small"
          pagination={{ pageSize: 20, showTotal: t => `${t} mặt hàng` }}
          scroll={tableScroll}
          loading={loading}
        />
      ),
    },
    {
      key: 'customers',
      label: 'Top khách hàng',
      children: (
        <Table
          dataSource={topCus}
          columns={topCusCols}
          rowKey={(r, i) => `${r.ma_kh}_${r.ten_kh}_${i}`}
          size="small"
          pagination={{ pageSize: 20, showTotal: t => `${t} khách` }}
          scroll={tableScroll}
          loading={loading}
        />
      ),
    },
    {
      key: 'daily',
      label: 'Theo ngày',
      children: (
        <Table
          dataSource={daily}
          columns={dailyCols}
          rowKey="ngay"
          size="small"
          pagination={false}
          scroll={tableScroll}
          loading={loading}
          summary={rows => {
            const tot = rows.reduce((acc, r) => ({
              so_phieu:       acc.so_phieu       + (r.so_phieu       || 0),
              tong_so_luong:  acc.tong_so_luong  + (r.tong_so_luong  || 0),
              doanh_thu:      acc.doanh_thu      + (r.doanh_thu      || 0),
              gia_von:        acc.gia_von        + (r.gia_von        || 0),
              loi_nhuan:      acc.loi_nhuan      + (r.loi_nhuan      || 0),
            }), { so_phieu:0, tong_so_luong:0, doanh_thu:0, gia_von:0, loi_nhuan:0 });
            return (
              <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                <Table.Summary.Cell index={0}><b>Tổng</b></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">{fmtNum(tot.so_phieu)}</Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">—</Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">{fmtNum(tot.tong_so_luong)}</Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right" style={{ color: '#1677ff' }}>{fmtMoney(tot.doanh_thu)}</Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">{fmtMoney(tot.gia_von)}</Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right"><LNCell value={tot.loi_nhuan} /></Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      ),
    },
    {
      key: 'orders',
      label: 'Chi tiết phiếu',
      children: (
        <Table
          dataSource={orderDetail}
          columns={orderDetailCols}
          rowKey={(r, i) => `${r.ma_toa}_${i}`}
          size="small"
          pagination={{ pageSize: 20, showTotal: t => `${t} phiếu` }}
          scroll={{ x: 1000 }}
          loading={loading}
        />
      ),
    },
  ];

  return (
    <div>
      {/* Bộ lọc ngày */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 600, color: '#555' }}>Kỳ báo cáo:</span>
        <RangePicker
          value={range}
          format="DD/MM/YYYY"
          onChange={v => v && setRange(v)}
          presets={[
            { label: 'Hôm nay',    value: [dayjs(), dayjs()] },
            { label: 'Tuần này',   value: [dayjs().startOf('week'), dayjs()] },
            { label: 'Tháng này',  value: [dayjs().startOf('month'), dayjs()] },
            { label: 'Tháng trước',
              value: [dayjs().subtract(1,'month').startOf('month'),
                      dayjs().subtract(1,'month').endOf('month')] },
          ]}
        />
        {loading && <span style={{ color: '#888', fontSize: 13 }}>Đang tải...</span>}
      </div>

      {/* KPI Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {kpiCards.map(c => (
          <Col key={c.title} xs={12} sm={8} md={6} lg={24/7} xl={24/7}>
            <KpiCard {...c} />
          </Col>
        ))}
      </Row>

      {/* Tabs */}
      <Tabs items={tabs} />
    </div>
  );
}
