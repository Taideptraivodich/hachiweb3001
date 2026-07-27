import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Badge, Card, Col, Descriptions, Empty, Input, Row, Space,
  Statistic, Table, Tag, Typography, message,
} from 'antd';
import { AimOutlined, SearchOutlined } from '@ant-design/icons';
import { apiClient as api } from '../api';
import { formatMoney } from '../utils';

const { Text, Title } = Typography;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase();
}

function queryTerms(query) {
  return [...new Set(normalizeText(query).split(/[^A-Z0-9]+/).filter(token => token.length >= 2))];
}

function compactTextWithMap(value) {
  const text = String(value || '');
  let compact = '';
  const indexMap = [];
  for (let index = 0; index < text.length; index += 1) {
    const normalized = normalizeText(text[index]).replace(/[^A-Z0-9]/g, '');
    for (const char of normalized) {
      compact += char;
      indexMap.push(index);
    }
  }
  return { text, compact, indexMap };
}

function highlightRanges(value, terms) {
  const { text, compact, indexMap } = compactTextWithMap(value);
  if (!text || !compact) return [];
  const ranges = [];
  for (const rawTerm of terms) {
    const term = normalizeText(rawTerm).replace(/[^A-Z0-9]/g, '');
    if (term.length < 2) continue;
    let from = 0;
    while (from < compact.length) {
      const hit = compact.indexOf(term, from);
      if (hit < 0) break;
      const start = indexMap[hit];
      const end = indexMap[hit + term.length - 1] + 1;
      ranges.push([start, end]);
      from = hit + Math.max(1, term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1]) merged.push([...range]);
    else last[1] = Math.max(last[1], range[1]);
  }
  return merged;
}

function Highlight({ value, query, matchedTerms }) {
  const text = String(value || '');
  const terms = matchedTerms?.length ? matchedTerms : queryTerms(query);
  if (!text || !terms.length) return text || '—';
  const ranges = highlightRanges(text, terms);
  if (!ranges.length) return text;
  const nodes = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) nodes.push(<span key={`plain-${index}-${cursor}`}>{text.slice(cursor, start)}</span>);
    nodes.push(
      <mark key={`hit-${index}-${start}`} style={{ padding: '0 2px', background: '#fff1b8' }}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) nodes.push(<span key={`tail-${cursor}`}>{text.slice(cursor)}</span>);
  return nodes;
}

function MatchTag({ row }) {
  const matched = Number(row.matched_count || 0);
  const total = Number(row.query_token_count || 0);
  const full = total > 0 && matched === total;
  const color = full ? 'green' : matched >= 2 ? 'blue' : 'orange';
  const label = total ? `Khớp ${matched}/${total}` : row.match_group === 'exact' ? 'Khớp mã' : 'Liên quan';
  return <Tag color={color}>{label} · {row.score}%</Tag>;
}

function isCanceled(error) {
  return error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
}

function HeaderFilter({ title, value, onChange, placeholder }) {
  return (
    <div onClick={event => event.stopPropagation()} style={{ minWidth: 120 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <Input
        size="small"
        value={value}
        placeholder={placeholder || 'Lọc...'}
        allowClear
        onChange={event => onChange(event.target.value)}
      />
    </div>
  );
}

function SalesDetail({ payload, loading, error }) {
  const [filters, setFilters] = useState({ code: '', description: '', customer: '', supplier: '', price: '' });
  const filtered = useMemo(() => {
    const rows = payload?.sales || [];
    const includes = (value, q) => !q || normalizeText(value).includes(normalizeText(q));
    const price = Number(String(filters.price || '').replace(/[^0-9]/g, ''));
    return rows.filter(row =>
      includes(row.ma_hang, filters.code) &&
      includes(row.mo_ta, filters.description) &&
      includes(row.ten_kh, filters.customer) &&
      includes(row.nha_cc, filters.supplier) &&
      (!price || Number(row.don_gia || 0) === price)
    );
  }, [payload, filters]);

  const prices = filtered.map(row => Number(row.don_gia || 0)).filter(value => value > 0);
  const stats = {
    rows: filtered.length,
    qty: filtered.reduce((sum, row) => sum + Number(row.so_luong || 0), 0),
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
  };

  const columns = [
    {
      title: <HeaderFilter title="Mã hàng" value={filters.code} onChange={value => setFilters(old => ({ ...old, code: value }))} />,
      dataIndex: 'ma_hang', width: 150, fixed: 'left', render: value => <Text code>{value}</Text>,
    },
    {
      title: <HeaderFilter title="Mô tả" value={filters.description} onChange={value => setFilters(old => ({ ...old, description: value }))} />,
      dataIndex: 'mo_ta', width: 290,
      render: (value, row) => <div>{value || '—'}{row.hang_sx && <div><Text type="secondary">{row.hang_sx}</Text></div>}</div>,
    },
    {
      title: <HeaderFilter title="Khách hàng" value={filters.customer} onChange={value => setFilters(old => ({ ...old, customer: value }))} />,
      dataIndex: 'ten_kh', width: 220,
    },
    { title: 'SL', dataIndex: 'so_luong', width: 70, align: 'right' },
    {
      title: <HeaderFilter title="Giá bán" value={filters.price} onChange={value => setFilters(old => ({ ...old, price: value }))} placeholder="VD 250000" />,
      dataIndex: 'don_gia', width: 140, align: 'right', render: value => Number(value || 0) ? <Text strong>{formatMoney(value)}</Text> : '—',
    },
    {
      title: 'Giá vốn cũ', dataIndex: 'gia_von', width: 130, align: 'right',
      render: (value, row) => Number(value || 0) ? formatMoney(value) : row.nha_cc === 'B11' ? <Tag color="blue">Kho B11</Tag> : '—',
    },
    {
      title: <HeaderFilter title="Nhà CC" value={filters.supplier} onChange={value => setFilters(old => ({ ...old, supplier: value }))} />,
      dataIndex: 'nha_cc', width: 140, render: value => value ? <Tag>{value}</Tag> : '—',
    },
    { title: 'Ghi chú', dataIndex: 'ghi_chu', width: 160, ellipsis: true },
  ];

  return (
    <Card title="Lịch sử mua bán QLĐH" size="small" loading={loading}>
      {error && <Alert type="warning" showIcon message={error} style={{ marginBottom: 10 }} />}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}><Statistic title="Dòng đang xem" value={stats.rows} /></Col>
        <Col xs={12} md={6}><Statistic title="Tổng SL" value={stats.qty} precision={2} /></Col>
        <Col xs={12} md={6}><Statistic title="Giá thấp nhất" value={stats.min} formatter={value => value ? formatMoney(value) : '—'} /></Col>
        <Col xs={12} md={6}><Statistic title="Giá cao nhất" value={stats.max} formatter={value => value ? formatMoney(value) : '—'} /></Col>
      </Row>
      {filters.customer && filtered.length === 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message={`Chưa từng bán mã này cho “${filters.customer}”`}
          description="Xóa lọc khách hàng để xem giá của các khách khác."
        />
      )}
      <Table
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        size="small"
        scroll={{ x: 1300, y: 500 }}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200] }}
        locale={{ emptyText: 'Chưa có lịch sử bán cho mã đã chọn' }}
      />
    </Card>
  );
}

function InventoryDetail({ inventory, inventoryLoading, candidate, relations, supplierRecords }) {
  const rows = inventory?.data || [];
  const total = rows.reduce((sum, row) => sum + Number(row.ton_kho || 0), 0);
  const winRows = candidate?.win_matches || [];
  const externalRefs = candidate?.external_refs || [];
  const suppliers = [
    ...externalRefs.map(row => ({
      source_name: row.nha_cc,
      part_number: row.ma_hang,
      related_code: row.ma_ngoai,
      cost: row.gia_dai_ly,
      retail_price: row.gia_thung,
      stock: row.stock_ncc,
      vehicle: row.xe_ap_dung,
      position: row.vi_tri,
    })),
    ...(supplierRecords || []),
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card title="Tồn kho công ty & giá nhập" size="small" loading={inventoryLoading}>
        {inventory?.from_cache && (
          <Alert
            type={inventory?.last_sync ? 'info' : 'warning'}
            showIcon
            message={inventory?.cache_note || 'Chưa có snapshot tồn kho đã đồng bộ'}
            style={{ marginBottom: 8 }}
          />
        )}
        {inventory?.error && <Alert type="error" showIcon message={inventory.error} style={{ marginBottom: 8 }} />}
        <Statistic title="Tổng tồn các kho" value={total} valueStyle={{ color: total > 0 ? '#389e0d' : '#cf1322' }} />
        <Space direction="vertical" style={{ width: '100%', marginTop: 10 }}>
          {rows.map((row, index) => (
            <Card key={`${row.kho}-${index}`} size="small">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span><Badge status={Number(row.ton_kho || 0) > 0 ? 'success' : 'error'} /> {row.kho || 'Không rõ kho'}</span>
                <Text strong>{Number(row.ton_kho || 0).toLocaleString('vi-VN')} {row.dvt || ''}</Text>
              </div>
              <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                <Descriptions.Item label="Giá nhập + VAT"><Text strong>{Number(row.don_gia || 0) ? formatMoney(row.don_gia) : '—'}</Text></Descriptions.Item>
                <Descriptions.Item label="Giá gốc">{Number(row.don_gia_goc || 0) ? formatMoney(row.don_gia_goc) : '—'}</Descriptions.Item>
                <Descriptions.Item label="VAT">{Number(row.don_gia_vat_rate || 0)}%</Descriptions.Item>
              </Descriptions>
            </Card>
          ))}
          {!rows.length && !inventoryLoading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có tồn đúng mã này" />}
        </Space>
      </Card>

      <Card title="Kho WIN" size="small">
        {winRows.length ? winRows.map((row, index) => (
          <Card key={`${row.ma_win}-${index}`} size="small" style={{ marginBottom: 8, background: Number(row.con_lai || 0) > 0 ? '#f9f0ff' : '#fafafa' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div><Text code>{row.ma_win}</Text><div>{row.ten_hang}</div></div>
              <div style={{ textAlign: 'right' }}><Text strong style={{ fontSize: 18 }}>{Number(row.con_lai || 0).toLocaleString('vi-VN')}</Text><div>{row.dvt || ''}</div></div>
            </div>
            <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
              <Descriptions.Item label="Giá Hachi">{Number(row.gia_hachi || 0) ? formatMoney(row.gia_hachi) : '—'}</Descriptions.Item>
              <Descriptions.Item label="Giá lẻ">{Number(row.gia_le || 0) ? formatMoney(row.gia_le) : '—'}</Descriptions.Item>
              <Descriptions.Item label="Giá thùng">{Number(row.gia_thung || 0) ? formatMoney(row.gia_thung) : '—'}</Descriptions.Item>
            </Descriptions>
          </Card>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có mã khớp trong WIN" />}
      </Card>

      <Card title="Nguồn nhà cung cấp" size="small">
        {suppliers.length ? (
          <Table
            rowKey={(row, index) => `${row.source_name}-${row.part_number}-${index}`}
            dataSource={suppliers}
            size="small"
            pagination={false}
            scroll={{ x: 700 }}
            columns={[
              { title: 'Nguồn', dataIndex: 'source_name', width: 120, render: value => <Tag>{value || '—'}</Tag> },
              { title: 'Mã', dataIndex: 'part_number', width: 140, render: value => <Text code>{value || '—'}</Text> },
              { title: 'Mã liên quan', dataIndex: 'related_code', width: 140, render: value => value ? <Text code>{value}</Text> : '—' },
              { title: 'Giá', dataIndex: 'cost', width: 120, align: 'right', render: value => Number(value || 0) ? formatMoney(value) : '—' },
              { title: 'Tồn NCC', dataIndex: 'stock', width: 100 },
              { title: 'Xe / vị trí', render: (_, row) => [row.vehicle, row.position].filter(Boolean).join(' · ') || '—' },
            ]}
          />
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu nhà cung cấp" />}
      </Card>

      <Card title="Mã liên quan" size="small">
        {relations?.length ? (
          <Table
            rowKey="id"
            dataSource={relations}
            size="small"
            pagination={false}
            columns={[
              { title: 'Mã A', dataIndex: 'from_code', render: value => <Text code>{value}</Text> },
              { title: 'Loại', dataIndex: 'from_type', render: value => <Tag>{value}</Tag> },
              { title: 'Quan hệ', dataIndex: 'relation_type', render: value => <Tag color="blue">{value}</Tag> },
              { title: 'Mã B', dataIndex: 'to_code', render: value => <Text code>{value}</Text> },
              { title: 'Loại', dataIndex: 'to_type', render: value => <Tag>{value}</Tag> },
              { title: 'Nguồn', dataIndex: 'source_name' },
            ]}
          />
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có mã liên quan" />}
      </Card>
    </Space>
  );
}

export default function NavigationSearch() {
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultPayload, setResultPayload] = useState({ data: [], total: 0, mode: '', elapsed_ms: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [sales, setSales] = useState(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState('');
  const [inventory, setInventory] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const detailRef = useRef(null);
  const searchTimerRef = useRef(null);
  const searchAbortRef = useRef(null);
  const detailAbortRef = useRef(null);
  const latestSearchRef = useRef(0);
  const latestDetailRef = useRef(0);
  const detailCacheRef = useRef(new Map());

  const clearDetail = useCallback(() => {
    detailAbortRef.current?.abort();
    latestDetailRef.current += 1;
    setSelectedId(null);
    setDetailLoading(false);
    setDetail(null);
    setSales(null);
    setSalesLoading(false);
    setSalesError('');
    setInventory(null);
    setInventoryLoading(false);
  }, []);

  const search = useCallback(async (value, { silent = false } = {}) => {
    const q = String(value || '').trim();
    if (q.length < 2) {
      if (!silent && q) message.warning('Nhập ít nhất 2 ký tự');
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const requestId = ++latestSearchRef.current;

    setLoading(true);
    setSearchedQuery(q);
    clearDetail();
    try {
      const response = await api.get('/navigation/search', {
        params: { q, limit: 60 },
        signal: controller.signal,
      });
      if (requestId !== latestSearchRef.current) return;
      setResultPayload(response.data);
      if (!silent && !response.data.data?.length) message.info('Không tìm thấy dữ liệu phù hợp');
    } catch (error) {
      if (isCanceled(error) || requestId !== latestSearchRef.current) return;
      message.error(error.response?.data?.error || error.message);
    } finally {
      if (requestId === latestSearchRef.current) setLoading(false);
    }
  }, [clearDetail]);

  useEffect(() => {
    window.clearTimeout(searchTimerRef.current);
    const q = query.trim();
    if (q.length < 2) return undefined;
    searchTimerRef.current = window.setTimeout(() => search(q, { silent: true }), 220);
    return () => window.clearTimeout(searchTimerRef.current);
  }, [query, search]);

  const handleQueryChange = useCallback(event => {
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    if (nextQuery.trim().length >= 2) return;
    window.clearTimeout(searchTimerRef.current);
    searchAbortRef.current?.abort();
    latestSearchRef.current += 1;
    setLoading(false);
    setSearchedQuery('');
    setResultPayload({ data: [], total: 0, mode: '', elapsed_ms: 0 });
    clearDetail();
  }, [clearDetail]);

  useEffect(() => () => {
    window.clearTimeout(searchTimerRef.current);
    searchAbortRef.current?.abort();
    detailAbortRef.current?.abort();
  }, []);

  const selectResult = useCallback(async row => {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    const requestId = ++latestDetailRef.current;
    const cacheKey = row.canonical_code || row.document_key;
    const cached = detailCacheRef.current.get(cacheKey);

    setSelectedId(row.document_id);
    setSalesError('');
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

    if (cached && Date.now() - cached.cachedAt < 60_000) {
      setDetail(cached.detail);
      setSales(cached.sales);
      setInventory(cached.inventory);
      setDetailLoading(false);
      setSalesLoading(false);
      setInventoryLoading(false);
      api.post('/navigation/click', {
        query: searchedQuery,
        document_key: row.document_key,
        document_id: row.document_id,
      }).catch(() => {});
      return;
    }

    setDetailLoading(true);
    setDetail(null);
    setSales(null);
    setSalesLoading(false);
    setInventory(null);
    setInventoryLoading(false);

    try {
      const response = await api.get(`/navigation/documents/${row.document_id}`, {
        signal: controller.signal,
      });
      if (requestId !== latestDetailRef.current) return;

      const nextDetail = response.data;
      setDetail(nextDetail);
      setDetailLoading(false);

      api.post('/navigation/click', {
        query: searchedQuery,
        document_key: row.document_key,
        document_id: row.document_id,
      }).catch(() => {});

      const candidate = nextDetail.candidate;
      const inventoryCode = candidate.reference_ma_hang || candidate.ma_hang;
      setSalesLoading(true);
      setInventoryLoading(true);

      let nextSales = null;
      let nextInventory = null;

      const salesTask = api.post('/ma-ngoai/lookup/detail', {
        ma_hang: candidate.ma_hang,
        history_codes: candidate.history_codes || [],
      }, { signal: controller.signal })
        .then(salesResponse => {
          if (requestId !== latestDetailRef.current) return;
          nextSales = salesResponse.data;
          setSales(salesResponse.data);
        })
        .catch(error => {
          if (isCanceled(error) || requestId !== latestDetailRef.current) return;
          setSalesError('Không tải được lịch sử QLĐH');
          setSales({ sales: [] });
        })
        .finally(() => {
          if (requestId === latestDetailRef.current) setSalesLoading(false);
        });

      // Tra mã chỉ đọc snapshot tồn kho dùng chung đã được đồng bộ định kỳ.
      // Không gọi MISA riêng cho từng lần click, tránh chậm và tránh lệch số giữa các màn hình.
      const inventoryTask = inventoryCode
        ? api.get('/tonkho/lookup', {
          params: { ma_hang: inventoryCode, mode: 'cache' },
          signal: controller.signal,
        })
          .then(cacheResponse => {
            if (requestId !== latestDetailRef.current) return;
            nextInventory = cacheResponse.data;
            setInventory(cacheResponse.data);
          })
          .catch(error => {
            if (isCanceled(error) || requestId !== latestDetailRef.current) return;
            nextInventory = { data: [], error: error.response?.data?.error || error.message };
            setInventory(nextInventory);
          })
          .finally(() => {
            if (requestId === latestDetailRef.current) setInventoryLoading(false);
          })
        : Promise.resolve().then(() => {
          nextInventory = { data: [] };
          setInventory(nextInventory);
          setInventoryLoading(false);
        });

      await Promise.allSettled([salesTask, inventoryTask]);
      if (requestId !== latestDetailRef.current) return;
      detailCacheRef.current.set(cacheKey, {
        detail: nextDetail,
        sales: nextSales || { sales: [] },
        inventory: nextInventory || { data: [] },
        cachedAt: Date.now(),
      });
    } catch (error) {
      if (isCanceled(error) || requestId !== latestDetailRef.current) return;
      setDetailLoading(false);
      message.error(error.response?.data?.error || error.message);
    } finally {
      if (requestId === latestDetailRef.current) {
        setDetailLoading(false);
      }
    }
  }, [searchedQuery]);

  const resultColumns = [
    {
      title: 'Nguồn', dataIndex: 'source_names', width: 150,
      render: (values, row) => (
        <Space size={[4, 4]} wrap>
          {(values?.length ? values : [row.source_name]).map(value => <Tag key={value}>{value}</Tag>)}
        </Space>
      ),
    },
    {
      title: 'Mã', dataIndex: 'primary_code', width: 160,
      render: (value, row) => <Text code><Highlight value={value} query={searchedQuery} matchedTerms={row.matched_tokens} /></Text>,
    },
    {
      title: 'Tên / mô tả', dataIndex: 'title', width: 420,
      render: (value, row) => (
        <div>
          <div><Highlight value={value} query={searchedQuery} matchedTerms={row.matched_tokens} /></div>
          {row.subtitle && <Text type="secondary"><Highlight value={row.subtitle} query={searchedQuery} matchedTerms={row.matched_tokens} /></Text>}
        </div>
      ),
    },
    { title: 'Khớp', width: 145, render: (_, row) => <MatchTag row={row} /> },
    {
      title: 'Lý do', dataIndex: 'reason', width: 330,
      render: value => <Text title={value}>{value || '—'}</Text>,
    },
    { title: 'Đã bán', dataIndex: 'history_count', width: 90, align: 'right', render: value => Number(value || 0).toLocaleString('vi-VN') },
    {
      title: 'Gợi ý tồn', width: 130,
      render: (_, row) => (
        <Space size={4} wrap>
          {Number(row.stock_company || 0) > 0 && <Tag color="green">Cty {row.stock_company}</Tag>}
          {Number(row.stock_win || 0) > 0 && <Tag color="purple">WIN {row.stock_win}</Tag>}
          {!Number(row.stock_company || 0) && !Number(row.stock_win || 0) && <Text type="secondary">—</Text>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 12 }}>
        <Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>Tra cứu để báo hàng</Title>
        <Text type="secondary">Gõ mã hoặc nội dung nhớ mang máng. Kết quả tự cập nhật sau khi dừng gõ khoảng 0,2 giây.</Text>
        <Input.Search
          autoFocus
          size="large"
          value={query}
          onChange={handleQueryChange}
          onSearch={value => {
            window.clearTimeout(searchTimerRef.current);
            search(value);
          }}
          loading={loading}
          enterButton={<><SearchOutlined /> Tìm</>}
          placeholder="VD: SR3880, C2237, rotuyn trụ ranger, phuộc trước trái..."
          allowClear
          style={{ marginTop: 14 }}
        />
      </Card>

      {searchedQuery && (
        <Card
          size="small"
          title={<Space><AimOutlined />Kết quả điều hướng cho <Text code>{searchedQuery}</Text></Space>}
          extra={<Text type="secondary">{resultPayload.total || 0} kết quả · {Number(resultPayload.elapsed_ms || 0).toFixed(1)} ms · {resultPayload.mode === 'code' ? 'tìm mã' : 'tìm nội dung'}</Text>}
          style={{ marginBottom: 14 }}
        >
          <Table
            rowKey={row => row.canonical_code || row.document_id}
            dataSource={resultPayload.data || []}
            columns={resultColumns}
            loading={loading}
            size="small"
            scroll={{ x: 1450, y: 430 }}
            pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100] }}
            rowClassName={row => row.document_id === selectedId ? 'navigation-selected-row' : ''}
            onRow={row => ({
              onClick: () => selectResult(row),
              style: { cursor: 'pointer' },
            })}
            locale={{ emptyText: 'Không có kết quả phù hợp' }}
          />
        </Card>
      )}

      <div ref={detailRef} style={{ scrollMarginTop: 74 }}>
        {detailLoading && <Card loading style={{ minHeight: 180 }} />}
        {detail && (
          <>
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={<Space>Đang xem <Text code>{detail.candidate.ma_hang}</Text> — {detail.candidate.ten_hang}</Space>}
              description="Bảng dưới là dữ liệu chi tiết để báo giá: lịch sử khách, tồn công ty, WIN, nhà cung cấp và mã liên quan."
            />
            <Row gutter={[12, 12]} align="top">
              <Col xs={24} xl={17}>
                <SalesDetail payload={sales} loading={salesLoading} error={salesError} />
              </Col>
              <Col xs={24} xl={7}>
                <InventoryDetail
                  inventory={inventory}
                  inventoryLoading={inventoryLoading}
                  candidate={detail.candidate}
                  relations={detail.relations}
                  supplierRecords={detail.supplier_records}
                />
              </Col>
            </Row>
          </>
        )}
      </div>
    </div>
  );
}
