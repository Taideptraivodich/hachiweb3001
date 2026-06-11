import React, { useState, useEffect } from 'react';
import {
  Card, Row, Col, Table, DatePicker, Statistic,
  Typography, Tabs, Space
} from 'antd';
import {
  ShoppingOutlined, TeamOutlined, FileTextOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getReportSummary, getTopProducts, getDailyReport
} from '../api';
import { formatMoney } from '../utils';

const { RangePicker } = DatePicker;
const { Text } = Typography;

export default function Reports() {
  const [range, setRange] = useState([
    dayjs().startOf('month'), dayjs()
  ]);
  const [summary, setSummary]   = useState({});
  const [topProds, setTopProds] = useState([]);
  const [daily, setDaily]       = useState([]);

  useEffect(() => { loadAll(); }, [range]);

  async function loadAll() {
    const params = {
      from: range[0]?.format('YYYY-MM-DD'),
      to:   range[1]?.format('YYYY-MM-DD'),
    };
    const [s, t, d] = await Promise.all([
      getReportSummary(params),
      getTopProducts({ ...params, limit: 20 }),
      getDailyReport(params),
    ]);
    setSummary(s);
    setTopProds(t);
    setDaily(d);
  }

  const topColumns = [
    { title:'#', width:40, render:(_,__,i)=> i+1 },
    { title:'Tên hàng',   dataIndex:'ten_hang', ellipsis:true },
    { title:'Mã hàng',    dataIndex:'ma_hang',  width:120 },
    { title:'Số lượng',   dataIndex:'tong_so_luong', width:90,
      render: v => <b>{v}</b> },
    { title:'Doanh thu',  dataIndex:'tong_doanh_thu', width:120,
      render: v => formatMoney(v) + 'đ' },
    { title:'Số toa',     dataIndex:'so_toa', width:70 },
  ];

  const dailyColumns = [
    { title:'Ngày', dataIndex:'ngay_tao', width:110,
      render: v => dayjs(v).format('DD/MM/YYYY') },
    { title:'Số toa', dataIndex:'so_toa', width:80 },
    { title:'Doanh thu', dataIndex:'doanh_thu', width:130,
      render: v => formatMoney(v) + 'đ' },
  ];

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <RangePicker
          value={range}
          format="DD/MM/YYYY"
          onChange={v => v && setRange(v)}
          presets={[
            { label:'Hôm nay', value:[dayjs(),dayjs()] },
            { label:'Tuần này', value:[dayjs().startOf('week'),dayjs()] },
            { label:'Tháng này', value:[dayjs().startOf('month'),dayjs()] },
            { label:'Tháng trước',
              value:[dayjs().subtract(1,'month').startOf('month'),
                     dayjs().subtract(1,'month').endOf('month')] },
          ]}
        />
      </div>

      <Row gutter={16} style={{ marginBottom:16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="Tổng toa" value={summary.tong_toa || 0}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="Doanh thu" value={formatMoney(summary.tong_doanh_thu || 0)}
              suffix="đ" prefix={<ShoppingOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="Số khách" value={summary.tong_khach || 0}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Tabs items={[
        {
          key:'top',
          label:'Top mặt hàng bán nhiều',
          children:(
            <Table
              dataSource={topProds} columns={topColumns}
              rowKey="ma_hang" size="small" pagination={false}
            />
          ),
        },
        {
          key:'daily',
          label:'Theo ngày',
          children:(
            <Table
              dataSource={daily} columns={dailyColumns}
              rowKey="ngay_tao" size="small" pagination={false}
            />
          ),
        },
      ]} />
    </div>
  );
}
