import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Input, Select, Space, Tag, Typography,
  message, Drawer, Form, Upload, Modal, Tooltip, Popconfirm
} from 'antd';
import {
  SearchOutlined, PlusOutlined, UploadOutlined,
  EditOutlined, DeleteOutlined, CheckOutlined,
  QuestionCircleOutlined, InboxOutlined
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { ChiTietPanel } from './TonKho';
import { formatMoney } from '../utils';

const { Text } = Typography;
const api = axios.create({ baseURL: '/api' });

// ── Màu nhà CC ───────────────────────────────────────────────────────────────
const NHA_CC_COLOR = {
  'TOKICO':     'blue',
  'CLUTCH SET': 'purple',
  'ADVICS':     'cyan',
  'MITSUBOSHI': 'orange',
  'WATERPUMP':  'green',
  'OIL FILTER': 'gold',
  'CYLINDER':   'volcano',
  'ROTUYN T10': 'geekblue',
};
function nhaCC_color(nha_cc) {
  return NHA_CC_COLOR[nha_cc?.toUpperCase()] || 'default';
}

// ── Component xác nhận mapping thủ công ─────────────────────────────────────
function ConfirmModal({ unmatched, onConfirm, onClose, dsMaHang }) {
  const [items, setItems] = useState(
    unmatched.map(u => ({ ...u, ma_hang_chon: u.candidates?.[0] || '' }))
  );

  function setChon(idx, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ma_hang_chon: val } : it));
  }

  function handleOk() {
    const toSave = items
      .filter(it => it.ma_hang_chon)
      .map(it => ({
        ma_hang:    it.ma_hang_chon,
        ma_ngoai:   it.ma_excel,
        nha_cc:     it.nha_cc,
        xe_ap_dung: it.xe_ap_dung,
        vi_tri:     it.vi_tri,
      }));
    onConfirm(toSave);
  }

  return (
    <Modal
      open title={`Xác nhận ${unmatched.length} mã chưa khớp tự động`}
      onCancel={onClose} onOk={handleOk}
      okText="Lưu các mã đã chọn" width={700}
    >
      <div style={{ fontSize: 13, marginBottom: 12, color: 'var(--color-text-secondary)' }}>
        Các mã dưới đây không tìm được hoặc có nhiều kết quả. Chọn mã tồn kho tương ứng hoặc bỏ qua.
      </div>
      <Table
        dataSource={items}
        rowKey={(_, i) => i}
        size="small"
        pagination={false}
        scroll={{ y: 400 }}
        columns={[
          {
            title: 'Mã trong file', dataIndex: 'ma_excel', width: 120,
            render: v => <Text code style={{ fontSize: 12 }}>{v}</Text>
          },
          { title: 'Nhà CC', dataIndex: 'nha_cc', width: 100,
            render: v => <Tag color={nhaCC_color(v)} style={{ fontSize: 11 }}>{v}</Tag> },
          { title: 'Xe áp dụng', dataIndex: 'xe_ap_dung', ellipsis: true },
          {
            title: 'Mã tồn kho tương ứng', width: 220,
            render: (_, row, idx) => (
              <Select
                showSearch size="small"
                value={row.ma_hang_chon || undefined}
                onChange={v => setChon(idx, v)}
                placeholder={row.candidates ? 'Chọn...' : 'Tìm mã...'}
                style={{ width: '100%' }}
                options={(row.candidates || dsMaHang.slice(0, 50)).map(m => ({ value: m, label: m }))}
                filterOption={(input, opt) => opt.value.toLowerCase().includes(input.toLowerCase())}
                allowClear
              />
            )
          }
        ]}
      />
    </Modal>
  );
}

// ── Form thêm/sửa 1 dòng ────────────────────────────────────────────────────
function FormDrawer({ open, initial, dsMaHang, dsNhaCC, onSave, onClose }) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      form.setFieldsValue(initial || { ma_hang: '', ma_ngoai: '', nha_cc: '', xe_ap_dung: '', vi_tri: '', ghi_chu: '' });
    }
  }, [open, initial]);

  async function handleSave() {
    const vals = await form.validateFields();
    onSave(vals);
  }

  return (
    <Drawer
      title={initial?.id ? 'Sửa mã ngoài' : 'Thêm mã ngoài'}
      open={open} onClose={onClose} width={440}
      footer={
        <Space>
          <Button type="primary" onClick={handleSave}>Lưu</Button>
          <Button onClick={onClose}>Hủy</Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" size="middle">
        <Form.Item name="ma_hang" label="Mã tồn kho (MISA)" rules={[{ required: true }]}>
          <Select showSearch placeholder="Chọn hoặc gõ mã..."
            options={dsMaHang.map(m => ({ value: m, label: m }))}
            filterOption={(input, opt) => opt.value.toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Form.Item name="ma_ngoai" label="Mã ngoài (555 / MK / OEM...)" rules={[{ required: true }]}>
          <Input placeholder="VD: SPB2413, DT-124VA, 45503-39145" />
        </Form.Item>
        <Form.Item name="nha_cc" label="Nhà cung cấp">
          <Select showSearch allowClear placeholder="Chọn hoặc nhập mới..."
            options={dsNhaCC.map(n => ({ value: n, label: n }))}
            filterOption={(input, opt) => opt.value.toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Form.Item name="xe_ap_dung" label="Xe áp dụng">
          <Input placeholder="VD: YARIS, VIOS 13-22" />
        </Form.Item>
        <Form.Item name="vi_tri" label="Vị trí">
          <Input placeholder="VD: Trước phải, Sau trái..." />
        </Form.Item>
        <Form.Item name="ghi_chu" label="Ghi chú">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function MaNgoai() {
  const [data, setData]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [filters, setFilters]   = useState({ q: '', nha_cc: '' });
  const [dsNhaCC, setDsNhaCC]   = useState([]);
  const [dsMaHang, setDsMaHang] = useState([]);

  const [drawerOpen, setDrawer]     = useState(false);
  const [editItem, setEdit]         = useState(null);
  const [importing, setImporting]   = useState(false);
  const [confirmData, setConfirm]   = useState(null);
  const [chiTietHang, setChiTietHang] = useState(null); // drill-down tồn kho

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/ma-ngoai', { params: { ...filters, page, limit: 50 } });
      setData(r.data.data);
      setTotal(r.data.total);
      setDsNhaCC(r.data.dsNhaCC || []);
    } catch (e) { message.error(e.message); }
    finally { setLoading(false); }
  }, [filters, page]);

  // Load danh sách mã hàng để dùng trong form
  useEffect(() => {
    api.get('/products/all').then(r => setDsMaHang((r.data || []).map(p => p.ma_hang)));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(vals) {
    try {
      if (editItem?.id) {
        await api.put(`/ma-ngoai/${editItem.id}`, vals);
        message.success('Đã cập nhật');
      } else {
        await api.post('/ma-ngoai', vals);
        message.success('Đã thêm');
      }
      setDrawer(false);
      load();
    } catch (e) { message.error(e.message); }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/ma-ngoai/${id}`);
      message.success('Đã xóa');
      load();
    } catch (e) { message.error(e.message); }
  }

  async function handleImport(file) {
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api.post('/ma-ngoai/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const { matched, unmatched, suggestions } = r.data;
      message.success(`Khớp tự động: ${matched} mã`);
      if (suggestions?.length > 0) {
        setConfirm(suggestions);
      }
      load();
    } catch (e) { message.error('Import lỗi: ' + e.message); }
    finally { setImporting(false); }
    return false;
  }

  async function handleConfirm(items) {
    try {
      await api.post('/ma-ngoai/import/confirm', { items });
      message.success(`Đã lưu ${items.length} mã được chọn thủ công`);
      setConfirm(null);
      load();
    } catch (e) { message.error(e.message); }
  }

  const columns = [
    {
      title: 'Mã tồn kho', dataIndex: 'ma_hang', width: 140,
      render: v => <Text code style={{ fontSize: 12 }}>{v}</Text>
    },
    {
      title: 'Tên hàng', dataIndex: 'ten_hang', ellipsis: true,
      render: (v, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v || <span style={{ color: 'var(--color-text-tertiary)' }}>Chưa sync</span>}</div>
          {row.xe_ap_dung && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{row.xe_ap_dung}</div>}
        </div>
      )
    },
    {
      title: 'Mã ngoài', dataIndex: 'ma_ngoai', width: 160,
      render: v => <Text code style={{ fontSize: 13, color: '#1677ff' }}>{v}</Text>
    },
    {
      title: 'Nhà CC', dataIndex: 'nha_cc', width: 120,
      render: v => v ? <Tag color={nhaCC_color(v)} style={{ fontSize: 11 }}>{v}</Tag> : '—'
    },
    {
      title: 'Vị trí', dataIndex: 'vi_tri', width: 110,
      render: v => v || <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
    },
    {
      title: 'Đơn giá', dataIndex: 'gia_von', width: 110, align: 'right',
      render: v => Number(v) > 0
        ? <span style={{ color: '#475569', fontSize: 12 }}>{formatMoney(v)}</span>
        : <span style={{ color: '#94a3b8' }}>—</span>
    },
    {
      title: 'Tồn kho', dataIndex: 'ton_kho', width: 80, align: 'center',
      render: (v, row) => {
        const n = Number(v || 0);
        const color = n > 5 ? '#16a34a' : n > 0 ? '#d97706' : '#dc2626';
        return (
          <Tooltip title="Xem chi tiết tồn kho">
            <span
              style={{ fontWeight: 700, color, cursor: 'pointer', textDecoration: 'underline dotted' }}
              onClick={e => { e.stopPropagation(); setChiTietHang(row); }}
            >{n}</span>
          </Tooltip>
        );
      }
    },
    {
      title: '', width: 80,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} type="text"
            onClick={e => { e.stopPropagation(); setEdit(row); setDrawer(true); }} />
          <Popconfirm title="Xóa mã này?" onConfirm={() => handleDelete(row.id)}
            okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }}>
            <Button size="small" icon={<DeleteOutlined />} type="text" danger
              onClick={e => e.stopPropagation()} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input.Search
          placeholder="Tìm mã tồn kho, mã ngoài, tên hàng..."
          style={{ width: 280 }}
          onSearch={q => { setFilters(f => ({ ...f, q })); setPage(1); }}
          allowClear
        />
        <Select
          placeholder="Tất cả nhà CC" allowClear style={{ width: 160 }}
          onChange={v => { setFilters(f => ({ ...f, nha_cc: v || '' })); setPage(1); }}
          options={dsNhaCC.map(n => ({ value: n, label: n }))}
        />
        <Button icon={<PlusOutlined />}
          onClick={() => { setEdit(null); setDrawer(true); }}>
          Thêm mã
        </Button>
        <Upload
          accept=".xlsx,.xls"
          beforeUpload={handleImport}
          showUploadList={false}
        >
          <Button icon={<UploadOutlined />} loading={importing}>
            Import Excel nhà CC
          </Button>
        </Upload>
        <Text style={{ color: 'var(--color-text-secondary)', fontSize: 12, marginLeft: 4 }}>
          {total} mã ngoài
        </Text>
      </div>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        onRow={row => ({
          onClick: () => setChiTietHang(row),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page, total, pageSize: 50,
          onChange: setPage,
          showTotal: t => `${t} mã`,
        }}
      />

      {/* Form thêm/sửa */}
      <FormDrawer
        open={drawerOpen}
        initial={editItem}
        dsMaHang={dsMaHang}
        dsNhaCC={dsNhaCC}
        onSave={handleSave}
        onClose={() => setDrawer(false)}
      />

      {/* Modal xác nhận mapping thủ công */}
      {confirmData && (
        <ConfirmModal
          unmatched={confirmData}
          dsMaHang={dsMaHang}
          onConfirm={handleConfirm}
          onClose={() => setConfirm(null)}
        />
      )}

      {/* Modal chi tiết tồn kho */}
      <Modal
        open={!!chiTietHang}
        onCancel={() => setChiTietHang(null)}
        footer={null}
        width="90vw"
        styles={{ body: { padding: '20px 24px', maxHeight: '80vh', overflowY: 'auto' } }}
        title={null}
        destroyOnClose
      >
        {chiTietHang && (
          <ChiTietPanel
            hang={chiTietHang}
            initialRange={[dayjs().startOf('month'), dayjs()]}
            onBack={() => setChiTietHang(null)}
          />
        )}
      </Modal>
    </div>
  );
}
