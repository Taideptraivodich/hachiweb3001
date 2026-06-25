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

// Normalize tiếng Việt: bỏ dấu, Đ→d, lowercase — dùng cho search/filter
const normalizeText = (v) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();

// Parse mã đơn từ mã toa dạng NN.DDMMYY → DDMMYYHCNN
const parseMaDonFromMaToa = (maToa) => {
  const m = String(maToa || '').trim().match(/^(\d{1,3})\.(\d{6})$/);
  if (!m) return '';
  return `${m[2]}HC${m[1].padStart(2, '0')}`;
};

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

// ─── Dropdown tìm kiếm hàng ngay trong 1 dòng bảng (giống MISA) ──────────────
// Dùng cho cả ô Mã hàng và ô Tên hàng hiển thị: gõ mã hoặc tên đều tìm được,
// chọn 1 item trong dropdown sẽ fill toàn bộ dòng (qua onSelectProduct), nhưng
// vẫn cho user gõ tự do nếu không chọn gì từ dropdown.
function RowProductSearch({ value, placeholder, onChangeText, onSelectProduct, style }) {
  const [options, setOptions] = useState([]);
  const timer = useRef(null);

  function handleSearch(text) {
    onChangeText(text);
    clearTimeout(timer.current);
    if (!text || !text.trim()) { setOptions([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await searchProducts(text);
        const q = normalizeText(text);
        const filtered = res.filter(p =>
          normalizeText(p.ma_hang).includes(q) ||
          normalizeText(p.ten_hang).includes(q)
        );
        setOptions(filtered.map(p => ({
          value: p.ma_hang,
          product: p,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>
                <Text code style={{ fontSize: 11 }}>{p.ma_hang}</Text>
                <Text style={{ marginLeft: 6, fontSize: 12 }}>{p.ten_hang}</Text>
              </span>
              {p.gia_von ? (
                <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  Vốn: {formatMoney(p.gia_von)}
                </Text>
              ) : null}
            </div>
          ),
        })));
      } catch { setOptions([]); }
    }, 280);
  }

  function handleSelect(_, opt) {
    if (opt?.product) onSelectProduct(opt.product);
    setOptions([]);
  }

  return (
    <AutoComplete
      value={value}
      options={options}
      onSearch={handleSearch}
      onSelect={handleSelect}
      onChange={onChangeText}
      placeholder={placeholder}
      size="small"
      style={style || { width: '100%' }}
      popupMatchSelectWidth={320}
    />
  );
}


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
  // Theo dõi mã toa đã lưu — null nếu chưa lưu lần nào (tạo mới), có giá trị nếu
  // đang sửa toa cũ HOẶC vừa tạo mới xong (để chuyển sang chế độ Cập nhật ngay,
  // không cần đóng form mở lại bằng nút Sửa).
  const [savedMaToa, setSavedMaToa] = useState(initialData?.ma_toa || null);

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
      const mappedDetails = (initialData.details || []).map((d, i) => ({
        ...d,
        key: i,
        ten_hang_hien_thi: d.ten_hang_hien_thi || d.ten_hang || '',
      }));
      setDetails(mappedDetails);
      // Hiện sẵn các nút In/Copy khi mở phiếu cũ để sửa
      const preloadedOrder = {
        ...initialData,
        details: mappedDetails,
      };
      setSavedOrder(preloadedOrder);
      setNdGuiKhach(generateNdGuiKhach(preloadedOrder));
    } else {
      form.setFieldsValue({ ngay_tao: dayjs() });
      fetchNextCode(dayjs());
      // Mở form tạo mới — có sẵn 2 dòng trống để nhập nhanh, không để bảng trống hoàn toàn
      setDetails([makeEmptyRow(), makeEmptyRow()]);
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
    const q = normalizeText(val);
    const filtered = items.filter(c =>
      normalizeText(c.ten_kh).includes(q) ||
      normalizeText(c.ma_kh).includes(q)
    );
    setCustomerOpts(filtered.map(c => ({
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

  // Dòng trống mẫu — dùng chung cho "Thêm dòng thủ công" và 2 dòng mặc định khi tạo mới
  function makeEmptyRow() {
    return {
      key: Date.now() + Math.random(), ma_hang: '', ten_hang: '', ten_hang_hien_thi: '',
      kho: '', ton_kho: null, gia_von: null, so_luong: 1, don_gia_ban: 0,
      hang_san_xuat: '', nha_cung_cap: '', dvt: '', ghi_chu: ''
    };
  }

  // Thêm dòng thủ công trống
  function addManualRow() {
    setDetails(prev => [...prev, makeEmptyRow()]);
  }

  // Dòng trống hoàn toàn: không có mã/tên/NSX/NCC/ĐVT/ghi chú, giá vốn = 0, đơn giá bán = 0.
  // SL mặc định (vd 1) KHÔNG được tính là "có dữ liệu" — chỉ là giá trị mặc định của dòng mẫu.
  // Dòng có bất kỳ text nào hoặc giá > 0 thì coi là dòng nhập dở, không được tự xóa.
  function isEmptyDetailRow(row) {
    const hasText =
      String(row.ma_hang || '').trim() ||
      String(row.ten_hang_hien_thi || '').trim() ||
      String(row.ten_hang || '').trim() ||
      String(row.hang_san_xuat || '').trim() ||
      String(row.nha_cung_cap || '').trim() ||
      String(row.dvt || '').trim() ||
      String(row.ghi_chu || '').trim();

    const giaVon = Number(row.gia_von || 0);
    const donGia = Number(row.don_gia_ban || 0);

    return !hasText && giaVon === 0 && donGia === 0;
  }

  // Dòng hàng "sạch" — bỏ các dòng trống hoàn toàn, dùng cho save / in / copy / tải ảnh
  function getCleanDetails() {
    return details.filter(row => !isEmptyDetailRow(row));
  }

  function removeRow(key) {
    setDetails(prev => prev.filter(d => d.key !== key));
  }

  function updateRow(key, field, val) {
    setDetails(prev => prev.map(d => d.key === key ? { ...d, [field]: val } : d));
  }

  // Chọn hàng từ dropdown tìm kiếm ở 1 dòng — tự fill các trường còn lại.
  // Map linh hoạt theo field cache hiện có; field nào cache chưa có thì giữ nguyên giá trị cũ của dòng.
  // Không ghi đè don_gia_ban (giá bán) — đó là giá user tự quyết định khi bán cho khách.
  function fillRowFromProduct(key, p) {
    setDetails(prev => prev.map(d => {
      if (d.key !== key) return d;
      const dvt = p.dvt || p.don_vi_tinh || p.unit || d.dvt;
      const nsx = p.hang_san_xuat || p.nsx || d.hang_san_xuat;
      const ncc = p.nha_cung_cap || p.ncc || d.nha_cung_cap;
      return {
        ...d,
        ma_hang:           p.ma_hang,
        ten_hang:          p.ten_hang,
        // Tên hiển thị: nếu user chưa tự sửa khác tên MISA gốc thì cập nhật theo hàng mới chọn;
        // nếu user đã gõ tên riêng rồi thì giữ nguyên (không ghi đè công sức đã nhập).
        ten_hang_hien_thi: (!d.ten_hang_hien_thi || d.ten_hang_hien_thi === d.ten_hang) ? p.ten_hang : d.ten_hang_hien_thi,
        kho:               p.kho ?? d.kho,
        ton_kho:           p.ton_kho ?? d.ton_kho,
        gia_von:           p.gia_von ?? d.gia_von,
        hang_san_xuat:     nsx || '',
        nha_cung_cap:      ncc || '',
        dvt:               dvt || '',
      };
    }));
  }

  async function handleSave() {
    try {
      const values = await form.validateFields();
      if (details.length === 0) { message.error('Chưa có mặt hàng nào'); return; }

      // Lọc dòng trống hoàn toàn (vd dòng mẫu mặc định chưa nhập) — không tính SL mặc định
      // là "có dữ liệu". Chỉ validate trên dòng đã có dữ liệu thật (dòng nhập dở vẫn báo lỗi).
      const cleanDetails = getCleanDetails();
      if (cleanDetails.length === 0) { message.error('Phiếu cần ít nhất 1 dòng hàng'); return; }
      const invalidRow = cleanDetails.find(d => {
        const ten = String(d.ten_hang_hien_thi || d.ten_hang || '').trim();
        const sl  = Number(d.so_luong || 0);
        return !ten || sl <= 0;
      });
      if (invalidRow) { message.error('Có dòng chưa điền đầy đủ tên hàng / số lượng'); return; }

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
        details: cleanDetails.map(d => ({
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
      if (savedMaToa) {
        // Đã từng lưu (đang sửa toa cũ, hoặc vừa tạo mới xong ở lượt Lưu trước) → Cập nhật
        const res = await updateOrder(savedMaToa, payload);
        maDon = res?.ma_don || maDon;
        message.success('Đã cập nhật phiếu');
      } else {
        // Lần lưu đầu tiên cho toa mới → Tạo mới, sau đó chuyển luôn sang chế độ Cập nhật
        const res = await createOrder(payload);
        maDon = res?.ma_don || maDon;
        setSavedMaToa(values.ma_toa);
        message.success(`Đã tạo phiếu ${values.ma_toa}`);
      }

      // Hiện khu vực actions — giữ đủ dữ liệu để in/copy ảnh
      const savedInfo = {
        ma_toa:       values.ma_toa,
        ma_don:       maDon || values.ma_don || '',
        ten_kh:       values.ten_kh       || '',
        ma_kh:        values.ma_kh        || '',
        sdt:          values.sdt          || '',
        dia_chi:      values.dia_chi      || '',
        noi_gui_hang: values.noi_gui_hang || '',
        ghi_chu:      values.ghi_chu      || '',
        ngay_tao:     values.ngay_tao?.format('YYYY-MM-DD'),
        details: cleanDetails,
      };
      setSavedOrder(savedInfo);
      setNdGuiKhach(generateNdGuiKhach(savedInfo));
      // Xóa dòng trống khỏi table sau khi lưu/cập nhật thành công
      setDetails(cleanDetails);

      // Chỉ refresh danh sách bên ngoài, KHÔNG đóng drawer
      onSaved?.(savedInfo);
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
      details:      getCleanDetails(),
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
      title: 'Mã hàng',
      width: 150,
      render: (_, row) => (
        <RowProductSearch
          value={row.ma_hang}
          placeholder="Mã hàng..."
          onChangeText={v => updateRow(row.key, 'ma_hang', v)}
          onSelectProduct={p => fillRowFromProduct(row.key, p)}
        />
      ),
    },
    {
      title: 'Tên hàng hiển thị',
      width: 220,
      render: (_, row) => (
        <div>
          <RowProductSearch
            value={row.ten_hang_hien_thi}
            placeholder="Tên hàng..."
            onChangeText={v => updateRow(row.key, 'ten_hang_hien_thi', v)}
            onSelectProduct={p => fillRowFromProduct(row.key, p)}
            style={{ width: '100%', fontWeight: 500 }}
          />
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
      title: (
        <span>
          Giá vốn
          <Tooltip title="Giá mua / giá nhà cung cấp — không in lên phiếu khách">
            <Text type="secondary" style={{ fontSize: 10, marginLeft: 3 }}>?</Text>
          </Tooltip>
        </span>
      ),
      width: 110,
      render: (_, row) => (
        <InputNumber
          min={0} step={1000} size="small" value={row.gia_von}
          formatter={v => v ? Number(v).toLocaleString('vi-VN') : ''}
          parser={v => v.replace(/[^\d]/g, '')}
          onChange={v => updateRow(row.key, 'gia_von', v)}
          style={{ width: '100%' }}
          placeholder="Giá vốn"
        />
      ),
    },
    {
      title: 'Đơn giá bán', width: 120,
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
                <Input
                  style={{ width: '100%' }}
                  onChange={e => {
                    const parsed = parseMaDonFromMaToa(e.target.value);
                    if (parsed) form.setFieldValue('ma_don', parsed);
                  }}
                />
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
                  filterOption={(input, opt) =>
                    normalizeText(opt?.label).includes(normalizeText(input))
                  }
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
        scroll={{ x: 1250 }}
        locale={{ emptyText: 'Gõ mã hàng hoặc tên hàng ngay trong dòng để tìm, hoặc nhấn "Thêm dòng thủ công"' }}
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
            {savedMaToa ? 'Cập nhật phiếu' : 'Lưu phiếu xuất'}
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
            <PhieuXuatActions order={savedOrder} />
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
