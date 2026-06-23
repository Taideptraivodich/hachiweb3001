import React, { useState, useEffect, useRef } from 'react';
import {
  Form, Input, DatePicker, Button, Table, AutoComplete,
  InputNumber, Space, Typography, Divider, message,
  Popconfirm, Tooltip, Row, Col, Card, Alert
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined,
  CopyOutlined, HistoryOutlined, UploadOutlined,
  SearchOutlined, ShoppingCartOutlined, CheckCircleOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  searchProducts, searchCustomers,
  createOrder, updateOrder, getNextCode,
  importHistoryFile, getHistoryStats
} from '../api';
import { formatMoney, calcTotal, generateTextToa, generateNdGuiKhach } from '../utils';
import HistoryModal from './HistoryModal';
import PhieuXuatActions from './PhieuXuatPrint';

const { Text, Title } = Typography;
const { TextArea } = Input;

// ─── Catalog: tìm kiếm hàng MISA ─────────────────────────────────────────────
function ProductCatalog({ onAddToToa }) {
  const [query, setQuery]       = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [qty, setQty]           = useState({});
  const [price, setPrice]       = useState({});
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
      } finally { setLoading(false); }
    }, 280);
  };

  const handleAdd = (p) => {
    const sl = qty[p.ma_hang] || 1;
    const gia = price[p.ma_hang] || 0;
    onAddToToa({ ...p, so_luong: sl, don_gia_ban: gia });
  };

  const columns = [
    {
      title: 'Mã hàng', dataIndex: 'ma_hang', width: 130,
      render: v => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: 'Tên hàng MISA', dataIndex: 'ten_hang', ellipsis: true },
    {
      title: 'Tồn', dataIndex: 'ton_kho', width: 70, align: 'right',
      render: v => (
        <Text strong style={{ color: v <= 0 ? '#ff4d4f' : v <= 5 ? '#fa8c16' : '#52c41a' }}>
          {v ?? 0}
        </Text>
      ),
    },
    {
      title: 'Giá vốn', dataIndex: 'gia_von', width: 110, align: 'right',
      render: v => <Text type="secondary" style={{ fontSize: 12 }}>{v ? formatMoney(v) : '—'}</Text>,
    },
    {
      title: 'SL', width: 75, align: 'center',
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
      title: 'Đơn giá bán', width: 130, align: 'right',
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
      title: '', width: 90,
      render: (_, p) => (
        <Button type="primary" size="small" icon={<ShoppingCartOutlined />} onClick={() => handleAdd(p)}>
          Thêm
        </Button>
      ),
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, background: '#fafafa', border: '1px dashed #d9d9d9' }}
      bodyStyle={{ padding: '10px 12px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: products.length ? 10 : 0 }}>
        <SearchOutlined style={{ color: '#1677ff', fontSize: 16 }} />
        <Input
          placeholder="Tìm mã hoặc tên hàng MISA để thêm vào phiếu..."
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
          dataSource={products} columns={columns} rowKey="ma_hang"
          size="small" pagination={products.length > 10 ? { pageSize: 10, size: 'small' } : false}
          scroll={{ x: 700 }} style={{ marginTop: 4 }}
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
  // Sau khi lưu: hiện khu vực actions
  const [savedOrder, setSavedOrder]     = useState(null);
  const [ndGuiKhach, setNdGuiKhach]     = useState('');
  const fileRef = useRef();
  const isEdit  = !!initialData;

  useEffect(() => {
    getHistoryStats().then(setHistoryStats).catch(() => {});
  }, []);

  useEffect(() => {
    if (initialData) {
      form.setFieldsValue({
        ma_toa:       initialData.ma_toa,
        ma_don:       initialData.ma_don,
        ngay_tao:     dayjs(initialData.ngay_tao),
        ten_kh:       initialData.ten_kh,
        ma_kh:        initialData.ma_kh,
        sdt:          initialData.sdt || '',
        dia_chi:      initialData.dia_chi || '',
        noi_gui_hang: initialData.noi_gui_hang,
        ghi_chu:      initialData.ghi_chu,
      });
      setDetails((initialData.details || []).map((d, i) => ({
        ...d,
        key: i,
        ten_hang_hien_thi: d.ten_hang_hien_thi || d.ten_hang || '',
      })));
    } else {
      form.setFieldsValue({ ngay_tao: dayjs() });
      fetchNextCode(dayjs());
    }
  }, [initialData]);

  async function fetchNextCode(date) {
    try {
      const { code, ma_don } = await getNextCode(date.format('YYYY-MM-DD'));
      form.setFieldValue('ma_toa', code);
      form.setFieldValue('ma_don', ma_don);
    } catch {}
  }

  // Tự update preview nội dung gửi khách khi form thay đổi
  function refreshNdGuiKhach() {
    const v = form.getFieldsValue();
    setNdGuiKhach(generateNdGuiKhach({
      ma_don: v.ma_don || '',
      ten_kh: v.ten_kh || '',
      ma_kh:  v.ma_kh  || '',
    }));
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
    form.setFieldsValue({
      ten_kh:  opt.customer.ten_kh,
      ma_kh:   opt.customer.ma_kh,
      sdt:     opt.customer.sdt     || '',
      dia_chi: opt.customer.dia_chi || '',
    });
    setTimeout(refreshNdGuiKhach, 50);
  }

  // Thêm từ catalog MISA — ten_hang_hien_thi = ten_hang MISA ban đầu, user có thể sửa tự do
  function addFromCatalog(p) {
    setDetails(prev => {
      const exists = prev.find(d => d.ma_hang === p.ma_hang);
      if (exists) {
        message.info(`${p.ma_hang} đã có trong phiếu — cộng thêm ${p.so_luong} SL`);
        return prev.map(d =>
          d.ma_hang === p.ma_hang
            ? { ...d, so_luong: (d.so_luong || 0) + p.so_luong }
            : d
        );
      }
      return [...prev, {
        key:               Date.now(),
        ma_hang:           p.ma_hang,
        ten_hang:          p.ten_hang,        // tên MISA gốc — chỉ để tham khảo
        ten_hang_hien_thi: p.ten_hang,        // tên hiển thị — user sửa tự do
        kho:               p.kho || '',
        ton_kho:           p.ton_kho,
        gia_von:           p.gia_von,
        so_luong:          p.so_luong,
        don_gia_ban:       p.don_gia_ban,
        hang_san_xuat:     p.hang_san_xuat || '',
        nha_cung_cap:      p.nha_cung_cap  || '',
        dvt:               p.dvt           || '',
        ghi_chu:           '',
      }];
    });
    message.success(`Đã thêm: ${p.ten_hang}`);
  }

  // Thêm dòng thủ công trống
  function addManualRow() {
    setDetails(prev => [...prev, {
      key: Date.now(), ma_hang: '', ten_hang: '', ten_hang_hien_thi: '',
      kho: '', ton_kho: null, gia_von: null, so_luong: 1, don_gia_ban: 0,
      hang_san_xuat: '', nha_cung_cap: '', dvt: '', ghi_chu: ''
    }]);
  }

  function removeRow(key) {
    setDetails(prev => prev.filter(d => d.key !== key));
  }

  function updateRow(key, field, val) {
    setDetails(prev => prev.map(d => d.key === key ? { ...d, [field]: val } : d));
  }

  async function handleSave() {
    try {
      const values = await form.validateFields();
      if (details.length === 0) { message.error('Chưa có mặt hàng nào'); return; }
      const emptyRows = details.filter(d => !(d.ten_hang_hien_thi || d.ten_hang) || !d.so_luong);
      if (emptyRows.length > 0) { message.error('Có dòng chưa điền đầy đủ tên hàng / số lượng'); return; }

      setLoading(true);
      const payload = {
        ma_toa:       values.ma_toa,
        ma_don:       values.ma_don || '',
        ngay_tao:     values.ngay_tao.format('YYYY-MM-DD'),
        ma_kh:        values.ma_kh        || '',
        ten_kh:       values.ten_kh       || '',
        sdt:          values.sdt          || '',
        dia_chi:      values.dia_chi      || '',
        noi_gui_hang: values.noi_gui_hang || '',
        ghi_chu:      values.ghi_chu      || '',
        details: details.map(d => ({
          ma_hang:           d.ma_hang,
          ten_hang:          d.ten_hang,
          ten_hang_hien_thi: d.ten_hang_hien_thi || d.ten_hang,
          kho:               d.kho,
          ton_kho:           d.ton_kho,
          gia_von:           d.gia_von,
          so_luong:          d.so_luong,
          don_gia_ban:       d.don_gia_ban || 0,
          hang_san_xuat:     d.hang_san_xuat || '',
          nha_cung_cap:      d.nha_cung_cap  || '',
          dvt:               d.dvt           || '',
          ghi_chu:           d.ghi_chu       || '',
        })),
      };

      let maDon = values.ma_don;
      if (isEdit) {
        const res = await updateOrder(initialData.ma_toa, payload);
        maDon = res?.ma_don || maDon;
        message.success('Đã cập nhật phiếu');
      } else {
        const res = await createOrder(payload);
        maDon = res?.ma_don || maDon;
        message.success(`Đã tạo phiếu ${values.ma_toa}`);
      }

      // Hiện khu vực actions
      const savedInfo = {
        ma_toa: values.ma_toa,
        ma_don: maDon || values.ma_don || '',
        ten_kh: values.ten_kh || '',
        ma_kh:  values.ma_kh  || '',
        details,
      };
      setSavedOrder(savedInfo);
      setNdGuiKhach(generateNdGuiKhach(savedInfo));

      onSaved?.();
    } catch (err) {
      if (err?.response?.data?.error) message.error(err.response.data.error);
    } finally {
      setLoading(false);
    }
  }

  function handleCopyNdGuiKhach() {
    navigator.clipboard.writeText(ndGuiKhach).then(() =>
      message.success('Đã copy nội dung gửi khách!')
    );
  }

  function handleCopyToaText() {
    const values = form.getFieldsValue();
    const text = generateTextToa({
      ma_toa:       values.ma_toa,
      ten_kh:       values.ten_kh || '',
      noi_gui_hang: values.noi_gui_hang || '',
      ghi_chu:      values.ghi_chu || '',
      details,
    });
    navigator.clipboard.writeText(text).then(() =>
      message.success('Đã copy toa hàng text')
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

  // Columns editable table
  const toaColumns = [
    {
      title: 'Tên hàng hiển thị',
      width: 220,
      render: (_, row) => (
        <div>
          <Input
            size="small"
            value={row.ten_hang_hien_thi}
            placeholder="Tên hàng..."
            onChange={e => updateRow(row.key, 'ten_hang_hien_thi', e.target.value)}
            style={{ fontWeight: 500 }}
          />
          {row.ma_hang && (
            <div style={{ marginTop: 2 }}>
              <Input
                size="small"
                value={row.ma_hang}
                placeholder="Mã hàng..."
                onChange={e => updateRow(row.key, 'ma_hang', e.target.value)}
                style={{ fontSize: 11, color: '#888' }}
              />
            </div>
          )}
          {!row.ma_hang && (
            <div style={{ marginTop: 2 }}>
              <Input
                size="small"
                value={row.ma_hang}
                placeholder="Mã hàng (nếu có)..."
                onChange={e => updateRow(row.key, 'ma_hang', e.target.value)}
                style={{ fontSize: 11 }}
              />
            </div>
          )}
          {row.ten_hang && row.ten_hang !== row.ten_hang_hien_thi && (
            <Text type="secondary" style={{ fontSize: 10, display: 'block', marginTop: 1 }}>
              MISA: {row.ten_hang}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'NSX', width: 90,
      render: (_, row) => (
        <Input
          size="small" value={row.hang_san_xuat}
          placeholder="NSX"
          onChange={e => updateRow(row.key, 'hang_san_xuat', e.target.value)}
        />
      ),
    },
    {
      title: 'NCC', width: 80,
      render: (_, row) => (
        <Input
          size="small" value={row.nha_cung_cap}
          placeholder="NCC"
          onChange={e => updateRow(row.key, 'nha_cung_cap', e.target.value)}
        />
      ),
    },
    {
      title: 'ĐVT', width: 72,
      render: (_, row) => (
        <Input
          size="small" value={row.dvt}
          placeholder="ĐVT"
          onChange={e => updateRow(row.key, 'dvt', e.target.value)}
        />
      ),
    },
    {
      title: 'SL', width: 72,
      render: (_, row) => (
        <InputNumber
          min={0.001} step={1} size="small" value={row.so_luong}
          onChange={v => updateRow(row.key, 'so_luong', v)}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Đơn giá', width: 120,
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
      title: 'Thành tiền', width: 110,
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
          placeholder="Ghi chú..."
          onChange={e => updateRow(row.key, 'ghi_chu', e.target.value)}
        />
      ),
    },
    {
      width: 65,
      render: (_, row) => (
        <Space size={2}>
          <Tooltip title={row.ma_hang ? `Lịch sử: ${row.ma_hang}` : 'Chưa có mã hàng'}>
            <Button
              size="small" icon={<HistoryOutlined />}
              disabled={!row.ma_hang}
              onClick={() => setHistoryItem({ ma_hang: row.ma_hang, ten_hang: row.ten_hang_hien_thi || row.ten_hang })}
            />
          </Tooltip>
          <Popconfirm title="Xóa dòng này?" onConfirm={() => removeRow(row.key)}>
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const isMobile = window.innerWidth < 768;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* ── THÔNG TIN PHIẾU ─────────────────────────────── */}
      <Card
        size="small"
        title={<Text strong style={{ color: '#1677ff' }}>Thông tin phiếu xuất</Text>}
        style={{ marginBottom: 12 }}
      >
        <Form form={form} layout="vertical" size="middle">
          <Row gutter={[12, 0]}>
            {/* Mã đơn — nổi bật */}
            <Col xs={24} sm={6}>
              <Form.Item
                name="ma_don"
                label={
                  <span>
                    <Text strong style={{ color: '#1677ff' }}>Mã đơn</Text>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>(gửi khách / in phiếu)</Text>
                  </span>
                }
              >
                <Input
                  placeholder="DDMMYYHCNN"
                  style={{ fontWeight: 700, fontSize: 15, letterSpacing: 1 }}
                  onChange={refreshNdGuiKhach}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={4}>
              <Form.Item name="ma_toa" label="Mã toa (nội bộ)"
                rules={[{ required: true, message: 'Cần mã toa' }]}>
                <Input style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={4}>
              <Form.Item name="ngay_tao" label="Ngày" rules={[{ required: true }]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }}
                  onChange={date => date && fetchNextCode(date)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item name="ten_kh" label="Khách hàng">
                <AutoComplete
                  options={customerOpts}
                  onSearch={handleCustomerSearch}
                  onSelect={handleCustomerSelect}
                  placeholder="Tìm khách hàng..."
                  style={{ width: '100%' }}
                  onChange={refreshNdGuiKhach}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={4}>
              <Form.Item name="ma_kh" label="Mã khách">
                <Input placeholder="KH00..." onChange={refreshNdGuiKhach} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={4}>
              <Form.Item name="sdt" label="SĐT">
                <Input placeholder="09..." />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="dia_chi" label="Địa chỉ">
                <Input placeholder="Địa chỉ khách..." />
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item name="noi_gui_hang" label="Nơi gửi">
                <Input placeholder="SPX / GHTK / Bus số 2..." />
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item name="ghi_chu" label="Ghi chú chung">
                <Input placeholder="Ghi chú..." />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* ── CATALOG TÌM KIẾM HÀNG MISA ──────────────────── */}
      <ProductCatalog onAddToToa={addFromCatalog} />

      {/* ── BẢNG HÀNG HÓA (EDITABLE) ────────────────────── */}
      <Table
        dataSource={details}
        columns={toaColumns}
        pagination={false}
        size="small"
        rowKey="key"
        scroll={{ x: 1100 }}
        locale={{ emptyText: 'Tìm hàng ở trên hoặc nhấn "Thêm dòng" để nhập thủ công' }}
        style={{ marginBottom: 8 }}
        footer={() => (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button icon={<PlusOutlined />} onClick={addManualRow} type="dashed">
              Thêm dòng thủ công
            </Button>
            <Text strong style={{ fontSize: 16 }}>
              Tổng: <span style={{ color: '#1677ff' }}>{formatMoney(total)} đ</span>
            </Text>
          </div>
        )}
      />

      <Divider style={{ margin: '12px 0' }} />

      {/* ── NÚT LƯU ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSave} size="large">
            {isEdit ? 'Cập nhật phiếu' : 'Lưu phiếu xuất'}
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
          <Button icon={<UploadOutlined />} loading={importing} onClick={() => fileRef.current?.click()} size="small">
            Import lịch sử Excel
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImportFile} />
        </Space>
      </div>

      {/* ── SAU KHI LƯU: KHU VỰC ACTIONS ───────────────── */}
      {savedOrder && (
        <Card
          style={{ marginTop: 16, border: '1.5px solid #52c41a', background: '#f6ffed' }}
          bodyStyle={{ padding: '16px 20px' }}
        >
          <Space align="center" style={{ marginBottom: 12 }}>
            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />
            <Text strong style={{ fontSize: 15 }}>
              Đã lưu phiếu:{' '}
              <Text code style={{ fontSize: 15, color: '#1677ff' }}>{savedOrder.ma_don || savedOrder.ma_toa}</Text>
            </Text>
          </Space>

          <div style={{ marginBottom: 10 }}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Nội dung gửi khách:</Text>
            <TextArea
              value={ndGuiKhach}
              onChange={e => setNdGuiKhach(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 5 }}
              style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 14 }}
            />
          </div>

          <Space wrap>
            <Button
              type="primary"
              icon={<CopyOutlined />}
              onClick={handleCopyNdGuiKhach}
              size="middle"
            >
              Copy nội dung gửi khách
            </Button>
            <Button
              icon={<CopyOutlined />}
              onClick={handleCopyToaText}
              size="middle"
            >
              Copy toa hàng text
            </Button>
          </Space>

          <div style={{ marginTop: 10 }}>
            <PhieuXuatActions order={{
              ...savedOrder,
              ngay_tao: form.getFieldValue('ngay_tao')?.format('YYYY-MM-DD'),
              noi_gui_hang: form.getFieldValue('noi_gui_hang') || '',
              sdt:          form.getFieldValue('sdt')     || '',
              dia_chi:      form.getFieldValue('dia_chi') || '',
            }} />
          </div>

          <div style={{ marginTop: 8 }}>
            <Button disabled size="middle" title="Sắp có">Export Excel danh sách</Button>
          </div>
        </Card>
      )}

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
