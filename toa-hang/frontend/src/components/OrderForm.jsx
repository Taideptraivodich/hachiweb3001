import React, { useState, useEffect, useRef } from 'react';
import {
  Form, Input, DatePicker, Button, Table, AutoComplete,
  InputNumber, Space, Typography, Divider, message,
  Popconfirm, Tooltip, Tag, Row, Col, Card
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined,
  CopyOutlined, HistoryOutlined, UploadOutlined,
  SearchOutlined, ShoppingCartOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  searchProducts, searchCustomers,
  createOrder, updateOrder, getNextCode,
  importHistoryFile, getHistoryStats
} from '../api';
import { formatMoney, calcTotal, generateTextToa } from '../utils';
import HistoryModal from './HistoryModal';

const { Text } = Typography;

// ─── Catalog: tìm kiếm & danh sách hàng MISA ────────────────────────────────
function ProductCatalog({ onAddToToa }) {
  const [query, setQuery]       = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [qty, setQty]           = useState({});   // { ma_hang: so_luong }
  const [price, setPrice]       = useState({});   // { ma_hang: don_gia }
  const timer = useRef(null);

  const doSearch = (q) => {
    setQuery(q);
    clearTimeout(timer.current);
    if (!q.trim()) { setProducts([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchProducts(q);
        setProducts(res);
        // khởi tạo qty = 1 cho hàng mới
        setQty(prev => {
          const next = { ...prev };
          res.forEach(p => { if (!next[p.ma_hang]) next[p.ma_hang] = 1; });
          return next;
        });
        setPrice(prev => {
          const next = { ...prev };
          res.forEach(p => { if (!next[p.ma_hang]) next[p.ma_hang] = 0; });
          return next;
        });
      } finally {
        setLoading(false);
      }
    }, 280);
  };

  const handleAdd = (p) => {
    const sl = qty[p.ma_hang] || 1;
    const gia = price[p.ma_hang] || 0;
    onAddToToa({ ...p, so_luong: sl, don_gia_ban: gia });
  };

  const columns = [
    {
      title: 'Mã hàng',
      dataIndex: 'ma_hang',
      width: 130,
      render: v => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Tên hàng',
      dataIndex: 'ten_hang',
      ellipsis: true,
    },
    {
      title: 'Tồn kho',
      dataIndex: 'ton_kho',
      width: 80,
      align: 'right',
      render: v => (
        <Text strong style={{ color: v <= 0 ? '#ff4d4f' : v <= 5 ? '#fa8c16' : '#52c41a' }}>
          {v ?? 0}
        </Text>
      ),
    },
    {
      title: 'Giá vốn',
      dataIndex: 'gia_von',
      width: 110,
      align: 'right',
      render: v => <Text type="secondary" style={{ fontSize: 12 }}>{v ? formatMoney(v) : '—'}</Text>,
    },
    {
      title: 'SL',
      width: 75,
      align: 'center',
      render: (_, p) => (
        <InputNumber
          min={0.001} step={1} size="small"
          value={qty[p.ma_hang] ?? 1}
          onChange={v => setQty(prev => ({ ...prev, [p.ma_hang]: v }))}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Đơn giá bán',
      width: 130,
      align: 'right',
      render: (_, p) => (
        <InputNumber
          min={0} step={1000} size="small"
          value={price[p.ma_hang] ?? 0}
          formatter={v => v ? Number(v).toLocaleString('vi-VN') : ''}
          parser={v => v.replace(/[^\d]/g, '')}
          onChange={v => setPrice(prev => ({ ...prev, [p.ma_hang]: v }))}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: '',
      width: 90,
      render: (_, p) => (
        <Button
          type="primary" size="small"
          icon={<ShoppingCartOutlined />}
          onClick={() => handleAdd(p)}
        >
          Thêm
        </Button>
      ),
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, background: '#fafafa' }}
      bodyStyle={{ padding: '10px 12px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: products.length ? 10 : 0 }}>
        <SearchOutlined style={{ color: '#1677ff', fontSize: 16 }} />
        <Input
          placeholder="Tìm mã hoặc tên hàng MISA để thêm vào toa..."
          value={query}
          onChange={e => doSearch(e.target.value)}
          allowClear
          style={{ flex: 1 }}
          size="middle"
        />
        {loading && <Text type="secondary" style={{ fontSize: 12 }}>Đang tìm...</Text>}
      </div>

      {products.length > 0 && (
        <Table
          dataSource={products}
          columns={columns}
          rowKey="ma_hang"
          size="small"
          pagination={products.length > 10 ? { pageSize: 10, size: 'small' } : false}
          scroll={{ x: 700 }}
          style={{ marginTop: 4 }}
        />
      )}

      {query && !loading && products.length === 0 && (
        <Text type="secondary" style={{ display: 'block', padding: '8px 0', fontSize: 13 }}>
          Không tìm thấy hàng nào khớp với "{query}"
        </Text>
      )}
    </Card>
  );
}

// ─── OrderForm chính ──────────────────────────────────────────────────────────
export default function OrderForm({ initialData, onSaved, onCancel }) {
  const [form] = Form.useForm();
  const [details, setDetails]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [customerOpts, setCustomerOpts] = useState([]);
  const [historyItem, setHistoryItem]   = useState(null);
  const [historyStats, setHistoryStats] = useState(null);
  const [importing, setImporting]       = useState(false);
  const fileRef = useRef();
  const isEdit  = !!initialData;

  useEffect(() => {
    getHistoryStats().then(setHistoryStats).catch(() => {});
  }, []);

  useEffect(() => {
    if (initialData) {
      form.setFieldsValue({
        ma_toa:       initialData.ma_toa,
        ngay_tao:     dayjs(initialData.ngay_tao),
        ten_kh:       initialData.ten_kh,
        noi_gui_hang: initialData.noi_gui_hang,
        ghi_chu:      initialData.ghi_chu,
      });
      setDetails((initialData.details || []).map((d, i) => ({ ...d, key: i })));
    } else {
      form.setFieldsValue({ ngay_tao: dayjs() });
      fetchNextCode(dayjs());
    }
  }, [initialData]);

  async function fetchNextCode(date) {
    try {
      const { code } = await getNextCode(date.format('YYYY-MM-DD'));
      form.setFieldValue('ma_toa', code);
    } catch {}
  }

  async function handleCustomerSearch(val) {
    if (!val || val.length < 1) return;
    const items = await searchCustomers(val);
    setCustomerOpts(items.map(c => ({
      value: c.ten_kh,
      label: `${c.ten_kh} (${c.ma_kh})`,
      customer: c,
    })));
  }

  function handleCustomerSelect(_, opt) {
    form.setFieldsValue({ ten_kh: opt.customer.ten_kh, ma_kh: opt.customer.ma_kh });
  }

  // Thêm từ catalog MISA
  function addFromCatalog(p) {
    setDetails(prev => {
      const exists = prev.find(d => d.ma_hang === p.ma_hang);
      if (exists) {
        // cộng thêm SL nếu đã có
        message.info(`${p.ma_hang} đã có trong toa — cộng thêm ${p.so_luong} SL`);
        return prev.map(d =>
          d.ma_hang === p.ma_hang
            ? { ...d, so_luong: (d.so_luong || 0) + p.so_luong }
            : d
        );
      }
      return [...prev, {
        key:        Date.now(),
        ma_hang:    p.ma_hang,
        ten_hang:   p.ten_hang,
        kho:        p.kho || '',
        ton_kho:    p.ton_kho,
        gia_von:    p.gia_von,
        so_luong:   p.so_luong,
        don_gia_ban: p.don_gia_ban,
        ghi_chu:    '',
      }];
    });
    message.success(`Đã thêm: ${p.ten_hang}`);
  }

  // Thêm dòng thủ công trống
  function addManualRow() {
    setDetails(prev => [...prev, {
      key: Date.now(), ma_hang: '', ten_hang: '', kho: '',
      ton_kho: null, gia_von: null, so_luong: 1, don_gia_ban: 0, ghi_chu: ''
    }]);
  }

  function removeRow(key) {
    setDetails(prev => prev.filter(d => d.key !== key));
  }

  function updateRow(key, field, val) {
    setDetails(prev => prev.map(d =>
      d.key === key ? { ...d, [field]: val } : d
    ));
  }

  async function handleSave() {
    try {
      const values = await form.validateFields();
      if (details.length === 0) { message.error('Chưa có mặt hàng nào'); return; }
      const emptyRows = details.filter(d => !d.ten_hang || !d.so_luong);
      if (emptyRows.length > 0) { message.error('Có dòng chưa điền đầy đủ'); return; }

      setLoading(true);
      const payload = {
        ma_toa:       values.ma_toa,
        ngay_tao:     values.ngay_tao.format('YYYY-MM-DD'),
        ma_kh:        values.ma_kh || '',
        ten_kh:       values.ten_kh || '',
        noi_gui_hang: values.noi_gui_hang || '',
        ghi_chu:      values.ghi_chu || '',
        details: details.map(d => ({
          ma_hang: d.ma_hang, ten_hang: d.ten_hang, kho: d.kho,
          ton_kho: d.ton_kho, gia_von: d.gia_von,
          so_luong: d.so_luong, don_gia_ban: d.don_gia_ban, ghi_chu: d.ghi_chu,
        })),
      };

      if (isEdit) {
        await updateOrder(initialData.ma_toa, payload);
        message.success('Đã cập nhật toa');
      } else {
        await createOrder(payload);
        message.success(`Đã tạo toa ${values.ma_toa}`);
      }
      onSaved?.();
    } catch (err) {
      if (err?.response?.data?.error) message.error(err.response.data.error);
    } finally {
      setLoading(false);
    }
  }

  function handleCopyText() {
    const values = form.getFieldsValue();
    const text = generateTextToa({
      ma_toa: values.ma_toa, ten_kh: values.ten_kh || '',
      noi_gui_hang: values.noi_gui_hang || '',
      ghi_chu: values.ghi_chu || '', details,
    });
    navigator.clipboard.writeText(text).then(() =>
      message.success('Đã copy text — dán vào Zalo gửi khách')
    );
  }

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const res = await importHistoryFile(file);
      message.success(res.message);
      const stats = await getHistoryStats();
      setHistoryStats(stats);
    } catch (err) {
      message.error('Import lỗi: ' + (err.response?.data?.error || err.message));
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  const total = calcTotal(details);

  // Columns cho bảng toa hàng (dòng đã thêm)
  const toaColumns = [
    {
      title: 'Tên hàng / Mã hàng',
      width: 260,
      render: (_, row) => (
        <div>
          {row.ma_hang ? (
            <>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{row.ten_hang}</div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {row.ma_hang}
                {row.ton_kho != null && (
                  <span style={{ marginLeft: 8 }}>
                    | Tồn: <b style={{ color: row.ton_kho <= 0 ? '#ff4d4f' : undefined }}>{row.ton_kho}</b>
                  </span>
                )}
                {row.gia_von ? (
                  <span style={{ marginLeft: 8 }}>| Vốn: {formatMoney(row.gia_von)}</span>
                ) : null}
              </Text>
            </>
          ) : (
            // Dòng thủ công: cho nhập tên + mã
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Input
                size="small" value={row.ten_hang}
                placeholder="Tên hàng..."
                onChange={e => updateRow(row.key, 'ten_hang', e.target.value)}
              />
              <Input
                size="small" value={row.ma_hang}
                placeholder="Mã hàng (nếu có)..."
                onChange={e => updateRow(row.key, 'ma_hang', e.target.value)}
              />
            </Space>
          )}
        </div>
      ),
    },
    {
      title: 'SL', width: 75,
      render: (_, row) => (
        <InputNumber
          min={0.001} step={1} size="small" value={row.so_luong}
          onChange={v => updateRow(row.key, 'so_luong', v)}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Đơn giá bán', width: 130,
      render: (_, row) => (
        <InputNumber
          min={0} step={1000} size="small" value={row.don_gia_ban}
          formatter={v => v ? Number(v).toLocaleString('vi-VN') : ''}
          parser={v => v.replace(/[^\d]/g, '')}
          onChange={v => updateRow(row.key, 'don_gia_ban', v)}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Thành tiền', width: 115,
      render: (_, row) => (
        <Text strong style={{ fontSize: 13 }}>
          {formatMoney(row.so_luong * row.don_gia_ban)}
        </Text>
      ),
    },
    {
      title: 'Ghi chú',
      render: (_, row) => (
        <Input
          size="small" value={row.ghi_chu}
          placeholder="Ghi chú dòng..."
          onChange={e => updateRow(row.key, 'ghi_chu', e.target.value)}
        />
      ),
    },
    {
      width: 70,
      render: (_, row) => (
        <Space size={2}>
          <Tooltip title={row.ma_hang ? `Lịch sử: ${row.ma_hang}` : 'Chưa có mã hàng'}>
            <Button
              size="small" icon={<HistoryOutlined />}
              disabled={!row.ma_hang}
              onClick={() => setHistoryItem({ ma_hang: row.ma_hang, ten_hang: row.ten_hang })}
            />
          </Tooltip>
          <Popconfirm title="Xóa dòng này?" onConfirm={() => removeRow(row.key)}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Thông tin toa */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Form form={form} layout="inline" size="middle">
          <Form.Item name="ma_toa" label="Mã toa"
            rules={[{ required: true, message: 'Cần mã toa' }]}>
            <Input style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="ngay_tao" label="Ngày" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY"
              onChange={date => date && fetchNextCode(date)} />
          </Form.Item>
          <Form.Item name="ten_kh" label="Khách hàng">
            <AutoComplete
              options={customerOpts}
              onSearch={handleCustomerSearch}
              onSelect={handleCustomerSelect}
              placeholder="Tìm khách hàng..."
              style={{ width: 200 }}
            />
          </Form.Item>
          <Form.Item name="ma_kh" hidden><Input /></Form.Item>
          <Form.Item name="noi_gui_hang" label="Nơi gửi">
            <Input placeholder="SPX / GHTK / Garo..." style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="ghi_chu" label="Ghi chú">
            <Input placeholder="Ghi chú chung..." style={{ width: 180 }} />
          </Form.Item>
        </Form>
      </Card>

      {/* Catalog tìm kiếm hàng MISA */}
      <ProductCatalog onAddToToa={addFromCatalog} />

      {/* Bảng toa hàng (các dòng đã thêm) */}
      <Table
        dataSource={details}
        columns={toaColumns}
        pagination={false}
        size="small"
        rowKey="key"
        locale={{ emptyText: 'Tìm hàng ở trên hoặc nhấn "Thêm mặt hàng" để thêm thủ công' }}
        style={{ marginBottom: 8 }}
        footer={() => (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button icon={<PlusOutlined />} onClick={addManualRow} type="dashed">
              Thêm mặt hàng thủ công
            </Button>
            <Text strong style={{ fontSize: 15 }}>
              Tổng: {formatMoney(total)} đ
            </Text>
          </div>
        )}
      />

      <Divider />

      {/* Nút hành động */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button type="primary" icon={<SaveOutlined />}
            loading={loading} onClick={handleSave}>
            {isEdit ? 'Cập nhật toa' : 'Lưu toa hàng'}
          </Button>
          <Button icon={<CopyOutlined />} onClick={handleCopyText}>
            Copy text gửi Zalo
          </Button>
          {onCancel && <Button onClick={onCancel}>Hủy</Button>}
        </Space>

        <Space>
          {historyStats && historyStats.tong_dong > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Lịch sử: {historyStats.tong_dong} dòng
              {historyStats.ngay_cu_nhat && ` (${historyStats.ngay_cu_nhat} → ${historyStats.ngay_moi_nhat})`}
            </Text>
          )}
          <Button
            icon={<UploadOutlined />}
            loading={importing}
            onClick={() => fileRef.current?.click()}
            size="small"
          >
            Import lịch sử Excel
          </Button>
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls"
            style={{ display: 'none' }} onChange={handleImportFile}
          />
        </Space>
      </div>

      {/* Modal lịch sử */}
      <HistoryModal
        open={!!historyItem}
        maHang={historyItem?.ma_hang}
        tenHang={historyItem?.ten_hang}
        onClose={() => setHistoryItem(null)}
      />
    </div>
  );
}
