import React, { useState, useEffect } from 'react';
import {
  Modal, Tabs, Table, Statistic, Row, Col,
  Card, Tag, Typography, Spin, Empty
} from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getProductHistory2 } from '../api';
import { formatMoney } from '../utils';

const { Text } = Typography;

export default function HistoryModal({ maHang, tenHang, open, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && maHang) {
      setLoading(true);
      getProductHistory2(maHang)
        .then(setData)
        .finally(() => setLoading(false));
    }
  }, [open, maHang]);

  const colsBan = [
    { title: 'Ngày xuất',  dataIndex: 'ngay_xuat',  width: 110 },
    { title: 'Khách hàng', dataIndex: 'ten_kh',      ellipsis: true },
    { title: 'SL',         dataIndex: 'so_luong',    width: 55 },
    {
      title: 'Đơn giá', dataIndex: 'don_gia', width: 110,
      render: v => <Text>{formatMoney(v)}</Text>
    },
    {
      title: 'Thành tiền', dataIndex: 'thanh_tien', width: 120,
      render: v => <Text strong>{formatMoney(v)}</Text>
    },
    {
      title: 'Giá vốn', dataIndex: 'gia_von', width: 110,
      render: v => v > 0
        ? <Text type="secondary">{formatMoney(v)}</Text>
        : <Text type="secondary">—</Text>
    },
    { title: 'Nhà CC',  dataIndex: 'nha_cc',  width: 80 },
    { title: 'Ghi chú', dataIndex: 'ghi_chu', ellipsis: true },
  ];

  const colsToa = [
    {
      title: 'Ngày', dataIndex: 'ngay_tao', width: 100,
      render: v => dayjs(v).format('DD/MM/YYYY')
    },
    { title: 'Mã toa',     dataIndex: 'ma_toa',      width: 100 },
    { title: 'Khách hàng', dataIndex: 'ten_kh',       ellipsis: true },
    { title: 'SL',         dataIndex: 'so_luong',     width: 55 },
    {
      title: 'Đơn giá', dataIndex: 'don_gia_ban', width: 110,
      render: v => formatMoney(v)
    },
    {
      title: 'Thành tiền', width: 120,
      render: (_, r) => <Text strong>{formatMoney(r.thanh_tien)}</Text>
    },
  ];

  const stats = data?.stats;

  return (
    <Modal
      title={
        <span>
          <HistoryOutlined style={{ marginRight: 8, color: '#1677ff' }} />
          Lịch sử bán — <Text code>{maHang}</Text> {tenHang}
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={900}
      styles={{ body: { padding: '12px 16px' } }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
        </div>
      ) : !data ? null : (
        <>
          {/* Thống kê nhanh */}
          {stats && stats.so_lan_ban > 0 && (
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="Số lần bán" value={stats.so_lan_ban} />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="Tổng SL" value={stats.tong_so_luong} />
                </Card>
              </Col>
              <Col span={5}>
                <Card size="small">
                  <Statistic
                    title="Giá TB"
                    value={formatMoney(Math.round(stats.gia_tb))}
                    suffix="đ"
                  />
                </Card>
              </Col>
              <Col span={5}>
                <Card size="small">
                  <Statistic
                    title="Giá cao nhất"
                    value={formatMoney(stats.gia_cao_nhat)}
                    suffix="đ"
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="Lần bán cuối"
                    value={stats.lan_ban_cuoi || '—'}
                    valueStyle={{ fontSize: 14 }}
                  />
                </Card>
              </Col>
            </Row>
          )}

          <Tabs
            size="small"
            items={[
              {
                key: 'excel',
                label: `Lịch sử Excel (${data.ban?.length || 0})`,
                children: data.ban?.length ? (
                  <Table
                    dataSource={data.ban}
                    columns={colsBan}
                    rowKey={(_, i) => i}
                    size="small"
                    pagination={{ pageSize: 10, showTotal: t => `${t} dòng` }}
                    scroll={{ x: 800 }}
                  />
                ) : (
                  <Empty description="Chưa có dữ liệu — cần import file Excel" />
                ),
              },
              {
                key: 'toa',
                label: `Toa hàng app (${data.toa?.length || 0})`,
                children: data.toa?.length ? (
                  <Table
                    dataSource={data.toa}
                    columns={colsToa}
                    rowKey={(_, i) => i}
                    size="small"
                    pagination={{ pageSize: 10 }}
                  />
                ) : (
                  <Empty description="Chưa có toa hàng nào chứa mặt hàng này" />
                ),
              },
            ]}
          />
        </>
      )}
    </Modal>
  );
}
