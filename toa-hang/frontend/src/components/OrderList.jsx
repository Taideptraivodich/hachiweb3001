import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Select, DatePicker, Space,
  Tag, Typography, Popconfirm, message, Drawer,
  Descriptions, Divider, Modal
} from 'antd';
import {
  SearchOutlined, PlusOutlined, EditOutlined,
  StopOutlined, CheckOutlined, CopyOutlined, EyeOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getOrders, getOrder, updateOrderStatus, deleteOrder } from '../api';
import { formatMoney, STATUS_COLOR, generateTextToa, calcTotal } from '../utils';
import OrderForm from './OrderForm';

const { Text } = Typography;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

export default function OrderList() {
  const [orders, setOrders]     = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [filters, setFilters]   = useState({});
  const [drawerOpen, setDrawer] = useState(false);
  const [editData, setEditData] = useState(null);
  const [viewOrder, setView]    = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [createOpen, setCreate] = useState(false);

  useEffect(() => { loadOrders(); }, [page, filters]);

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await getOrders({ ...filters, page, limit: 20 });
      setOrders(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }

  async function handleView(ma_toa) {
    const data = await getOrder(ma_toa);
    setView(data);
    setViewOpen(true);
  }

  async function handleEdit(ma_toa) {
    const data = await getOrder(ma_toa);
    setEditData(data);
    setDrawer(true);
  }

  async function handleStatus(ma_toa, trang_thai) {
    await updateOrderStatus(ma_toa, trang_thai);
    message.success(`Đã chuyển trạng thái → ${trang_thai}`);
    loadOrders();
  }

  async function handleDelete(ma_toa) {
    try {
      await deleteOrder(ma_toa);
      message.success(`Đã xóa toa ${ma_toa}`);
      loadOrders();
    } catch(e) {
      message.error('Xóa thất bại: ' + e.message);
    }
  }

  function handleCopyText(order) {
    const text = generateTextToa(order);
    navigator.clipboard.writeText(text).then(() =>
      message.success('Đã copy — dán vào Zalo gửi khách')
    );
  }

  async function handleCopyFull(ma_toa) {
    const data = await getOrder(ma_toa);
    handleCopyText(data);
  }

  const columns = [
    {
      title: 'Mã toa', dataIndex: 'ma_toa', width: 100,
      render: (v, row) => (
        <Button type="link" size="small" onClick={() => handleView(row.ma_toa)}
          style={{ padding:0, fontWeight:600 }}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Ngày', dataIndex: 'ngay_tao', width: 95,
      render: v => dayjs(v).format('DD/MM/YYYY'),
    },
    { title: 'Khách hàng', dataIndex: 'ten_kh', ellipsis: true },
    {
      title: 'Số dòng', dataIndex: 'so_dong', width: 75,
      render: v => <Text>{v} mặt hàng</Text>,
    },
    {
      title: 'Tổng tiền', dataIndex: 'tong_tien', width: 120,
      render: v => <Text strong>{formatMoney(v)}đ</Text>,
    },
    {
      title: 'Trạng thái', dataIndex: 'trang_thai', width: 120,
      render: v => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
    },
    {
      title: '', width: 170,
      render: (_, row) => (
        <Space size={2}>
          <Button size="small" icon={<EyeOutlined />}
            onClick={() => handleView(row.ma_toa)} />
          <Button size="small" icon={<EditOutlined />}
            onClick={() => handleEdit(row.ma_toa)}
            disabled={row.trang_thai === 'Đã hủy'} />
          <Button size="small" icon={<CopyOutlined />}
            onClick={() => handleCopyFull(row.ma_toa)}
            title="Copy text gửi Zalo" />
          {row.trang_thai === 'Đang xử lý' && (
            <Popconfirm title="Hoàn thành toa này?"
              onConfirm={() => handleStatus(row.ma_toa, 'Đã hoàn thành')}>
              <Button size="small" icon={<CheckOutlined />} type="primary" ghost />
            </Popconfirm>
          )}
          <Popconfirm
            title="Xóa hẳn toa này?"
            description="Dữ liệu sẽ bị xóa vĩnh viễn, không thể khôi phục!"
            okText="Xóa hẳn"
            cancelText="Hủy"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row.ma_toa)}
          >
            <Button size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <Input.Search
          placeholder="Tìm mã toa, khách hàng..."
          style={{ width: 220 }}
          onSearch={v => { setFilters(f => ({ ...f, q: v })); setPage(1); }}
          allowClear
        />
        <Select
          placeholder="Trạng thái"
          style={{ width: 150 }} allowClear
          onChange={v => { setFilters(f => ({ ...f, status: v })); setPage(1); }}
          options={[
            { value: 'Đang xử lý',    label: 'Đang xử lý' },
            { value: 'Đã hoàn thành', label: 'Đã hoàn thành' },
            { value: 'Đã hủy',        label: 'Đã hủy' },
          ]}
        />
        <RangePicker format="DD/MM/YYYY"
          onChange={dates => {
            setFilters(f => ({
              ...f,
              from: dates?.[0]?.format('YYYY-MM-DD'),
              to:   dates?.[1]?.format('YYYY-MM-DD'),
            }));
            setPage(1);
          }}
        />
        <Button type="primary" icon={<PlusOutlined />}
          onClick={() => { setEditData(null); setCreate(true); }}>
          Tạo toa mới
        </Button>
      </div>

      <Table
        dataSource={orders}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 600 }}
        pagination={{
          current: page, total, pageSize: 20,
          onChange: setPage,
          showTotal: t => `${t} toa`,
        }}
      />

      {/* Drawer: tạo toa mới */}
      <Drawer
        title="Tạo toa hàng mới"
        open={createOpen}
        onClose={() => setCreate(false)}
        width="90vw"
        destroyOnClose
      >
        <OrderForm
          onSaved={() => { setCreate(false); loadOrders(); }}
          onCancel={() => setCreate(false)}
        />
      </Drawer>

      {/* Drawer: sửa toa */}
      <Drawer
        title={`Sửa toa ${editData?.ma_toa}`}
        open={drawerOpen}
        onClose={() => setDrawer(false)}
        width="90vw"
        destroyOnClose
      >
        <OrderForm
          initialData={editData}
          onSaved={() => { setDrawer(false); loadOrders(); }}
          onCancel={() => setDrawer(false)}
        />
      </Drawer>

      {/* Modal: xem chi tiết toa */}
      <Modal
        title={`Chi tiết toa ${viewOrder?.ma_toa}`}
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={[
          <Button key="copy" icon={<CopyOutlined />}
            onClick={() => { handleCopyText(viewOrder); }}>
            Copy text Zalo
          </Button>,
          <Button key="close" onClick={() => setViewOpen(false)}>Đóng</Button>,
        ]}
        width={700}
      >
        {viewOrder && <OrderDetail order={viewOrder} />}
      </Modal>
    </div>
  );
}

function OrderDetail({ order }) {
  const [toaText, setToaText] = useState(generateTextToa(order));
  return (
    <div>
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label="Mã toa">{order.ma_toa}</Descriptions.Item>
        <Descriptions.Item label="Ngày">
          {dayjs(order.ngay_tao).format('DD/MM/YYYY')}
        </Descriptions.Item>
        <Descriptions.Item label="Khách hàng">{order.ten_kh}</Descriptions.Item>
        <Descriptions.Item label="Trạng thái">
          <Tag color={STATUS_COLOR[order.trang_thai]}>{order.trang_thai}</Tag>
        </Descriptions.Item>
        {order.noi_gui_hang && (
          <Descriptions.Item label="Nơi gửi" span={2}>
            {order.noi_gui_hang}
          </Descriptions.Item>
        )}
        {order.ghi_chu && (
          <Descriptions.Item label="Ghi chú" span={2}>
            {order.ghi_chu}
          </Descriptions.Item>
        )}
      </Descriptions>

      <Divider style={{ margin:'12px 0' }} />

      <Table
        dataSource={order.details || []}
        rowKey="id"
        size="small"
        pagination={false}
        columns={[
          { title:'Tên hàng', dataIndex:'ten_hang', ellipsis:true },
          { title:'Mã', dataIndex:'ma_hang', width:120 },
          { title:'SL', dataIndex:'so_luong', width:60 },
          {
            title:'Đơn giá', dataIndex:'don_gia_ban', width:110,
            render: v => formatMoney(v)
          },
          {
            title:'Thành tiền', width:110,
            render: (_, r) => <b>{formatMoney(r.so_luong * r.don_gia_ban)}</b>
          },
          { title:'Ghi chú', dataIndex:'ghi_chu', ellipsis:true },
        ]}
        footer={() => (
          <div style={{ textAlign:'right' }}>
            <Text strong>Tổng: {formatMoney(calcTotal(order.details))} đ</Text>
          </div>
        )}
      />

      <Divider style={{ margin:'12px 0' }} />

      <TextArea
        value={toaText}
        onChange={(e) => setToaText(e.target.value)}
        autoSize={{ minRows: 6, maxRows: 20 }}
      />
    </div>
  );
}
