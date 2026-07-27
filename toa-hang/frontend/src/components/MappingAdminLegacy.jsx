/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable no-unused-vars */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Alert, Badge, Button, Card, Col, Descriptions, Divider, Drawer, Empty,
  Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic,
  Table, Tabs, Tag, Tooltip, Typography, Upload, message,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, InboxOutlined,
  LinkOutlined, PlusOutlined, SearchOutlined, UploadOutlined,
} from '@ant-design/icons';
import { apiClient as api } from '../api';
import { formatMoney } from '../utils';

const { Text, Title } = Typography;

const CODE_TYPE_OPTIONS = ['555', 'MK', 'KYB', 'OEM', 'SAKURA', 'TOKICO', 'PART_NO', 'KHAC']
  .map(value => ({ value, label: value }));

const NHA_CC_COLOR = {
  TOKICO: 'blue',
  'CLUTCH SET': 'purple',
  ADVICS: 'cyan',
  MITSUBOSHI: 'orange',
  WATERPUMP: 'green',
  'OIL FILTER': 'gold',
  CYLINDER: 'volcano',
  'ROTUYN T10': 'geekblue',
  WIN: 'magenta',
};

function nhaCCColor(value) {
  return NHA_CC_COLOR[String(value || '').toUpperCase()] || 'default';
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function median(values) {
  const sorted = values.map(Number).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mode(values) {
  const counts = new Map();
  let best = 0;
  let bestCount = 0;
  for (const raw of values) {
    const value = Number(raw || 0);
    if (!value) continue;
    const count = (counts.get(value) || 0) + 1;
    counts.set(value, count);
    if (count > bestCount || (count === bestCount && value > best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function MatchTag({ group, score }) {
  const config = {
    exact: { color: 'success', text: 'Đúng mã' },
    alias: { color: 'processing', text: 'Bí danh / tên cũ' },
    fuzzy: { color: 'warning', text: 'Gần giống — cần kiểm tra' },
  }[group] || { color: 'default', text: group };
  return <Tag color={config.color}>{config.text} · {score}%</Tag>;
}

function HeaderFilter({ label, value, onChange, placeholder, width = 130 }) {
  return (
    <div onClick={event => event.stopPropagation()} style={{ minWidth: width }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <Input
        size="small"
        value={value}
        allowClear
        placeholder={placeholder || 'Lọc...'}
        onChange={event => onChange(event.target.value)}
        onClick={event => event.stopPropagation()}
      />
    </div>
  );
}

function CandidateList({ data, selected, onSelect }) {
  if (!data.length) return <Empty description="Không tìm thấy mã phù hợp" />;

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {data.map(candidate => {
        const active = selected?.key === candidate.key;
        const firstRef = candidate.external_refs?.[0];
        return (
          <Card
            key={candidate.key}
            size="small"
            hoverable
            onClick={() => onSelect(candidate)}
            style={{
              cursor: 'pointer',
              borderColor: active ? '#1677ff' : undefined,
              boxShadow: active ? '0 0 0 2px rgba(22,119,255,.12)' : undefined,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <Space wrap size={6}>
                  <Text code strong style={{ fontSize: 15 }}>{candidate.ma_hang}</Text>
                  <MatchTag group={candidate.match_group} score={candidate.score} />
                  {candidate.conversion_kind === '555_to_aisin' && <Tag color="geekblue">555 → Aisin</Tag>}
                  {candidate.source_kind === 'win_inventory' && <Tag color="purple">Kho Win Win</Tag>}
                  {candidate.requires_user_choice && <Tag color="orange">Bạn phải chọn</Tag>}
                </Space>
                <div style={{ marginTop: 6, fontWeight: 500 }}>
                  {candidate.ten_hang || firstRef?.xe_ap_dung || 'Chưa có tên hàng'}
                </div>
                <div style={{ marginTop: 5, color: 'var(--color-text-secondary)', fontSize: 12 }}>
                  {(candidate.reasons || []).slice(0, 3).map((reason, index) => (
                    <div key={index}>• {reason}</div>
                  ))}
                </div>
                {firstRef && (
                  <Space wrap size={4} style={{ marginTop: 7 }}>
                    {firstRef.loai_ma && <Tag>{firstRef.loai_ma}</Tag>}
                    {firstRef.nha_cc && <Tag color={nhaCCColor(firstRef.nha_cc)}>{firstRef.nha_cc}</Tag>}
                    {firstRef.vi_tri && <Tag>{firstRef.vi_tri}</Tag>}
                  </Space>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>Lịch sử khớp</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{candidate.history_count || 0}</div>
              </div>
            </div>
          </Card>
        );
      })}
    </Space>
  );
}

function InventoryPanel({ candidate }) {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState(null);
  const [inventoryCode, setInventoryCode] = useState(candidate?.ma_hang || '');

  useEffect(() => {
    if (!inventoryCode) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get('/tonkho/lookup', { params: { ma_hang: inventoryCode } })
      .then(response => { if (!cancelled) setPayload(response.data); })
      .catch(error => {
        if (!cancelled) {
          setPayload({ success: false, error: error.response?.data?.error || error.message, data: [] });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [inventoryCode]);

  const rows = payload?.data || [];
  const totalStock = rows.reduce((sum, row) => sum + Number(row.ton_kho || 0), 0);
  const supplier = candidate?.external_refs?.find(ref =>
    Number(ref.gia_dai_ly || 0) > 0 || Number(ref.gia_thung || 0) > 0
  );
  const winMatches = candidate?.win_matches || [];

  return (
    <Card
      title={<Space><InboxOutlined />Tồn kho & giá nhập</Space>}
      size="small"
      loading={loading}
      style={{ position: 'sticky', top: 78 }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        <div>
          <Text type="secondary">Mã đang kiểm tra</Text>
          <div><Text code strong>{inventoryCode || '—'}</Text></div>
        </div>

        {candidate?.reference_ma_hang && candidate.reference_ma_hang !== inventoryCode && (
          <Alert
            type="info"
            showIcon
            message="Mã này không phải 555 nên hệ thống không tự quy đổi"
            description={(
              <Button size="small" onClick={() => setInventoryCode(candidate.reference_ma_hang)}>
                Kiểm tra tồn mã kho tham khảo {candidate.reference_ma_hang}
              </Button>
            )}
          />
        )}

        {payload?.from_cache && (
          <Alert
            type="warning"
            showIcon
            message="Đang dùng cache offline"
            description={payload.cache_note || 'Cần kiểm tra độ mới trước khi báo.'}
          />
        )}

        {payload?.error && <Alert type="error" showIcon message={payload.error} />}

        <Card size="small" style={{ background: totalStock > 0 ? '#f6ffed' : '#fff2f0' }}>
          <Statistic
            title="Tổng tồn các kho"
            value={totalStock}
            valueStyle={{ color: totalStock > 0 ? '#389e0d' : '#cf1322' }}
            suffix={rows[0]?.dvt || ''}
          />
        </Card>

        {rows.length === 0 && !loading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu tồn đúng mã này" />
        ) : rows.map((row, index) => (
          <Card key={`${row.kho}-${index}`} size="small">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <Badge status={Number(row.ton_kho || 0) > 0 ? 'success' : 'error'} />
                <Text strong>{row.kho || 'Không rõ kho'}</Text>
              </div>
              <Text strong style={{ color: Number(row.ton_kho || 0) > 0 ? '#389e0d' : '#cf1322' }}>
                {Number(row.ton_kho || 0).toLocaleString('vi-VN')} {row.dvt || ''}
              </Text>
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <Descriptions size="small" column={1} colon={false}>
              <Descriptions.Item label="Giá nhập + VAT">
                <Text strong>{Number(row.don_gia || 0) > 0 ? formatMoney(row.don_gia) : '—'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Giá gốc">
                {Number(row.don_gia_goc || 0) > 0 ? formatMoney(row.don_gia_goc) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="VAT">
                {Number(row.don_gia_vat_rate || 0)}%
              </Descriptions.Item>
              {row.ngay_gia_gan_nhat && (
                <Descriptions.Item label="Ngày giá gần nhất">
                  {String(row.ngay_gia_gan_nhat).slice(0, 10)}
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        ))}

        <Text type="secondary" style={{ fontSize: 11 }}>
          {payload?.price_definition || 'Đơn giá tồn kho là giá nhập gần nhất đã cộng VAT theo chứng từ mua.'}
        </Text>

        {winMatches.length > 0 && (
          <>
            <Divider style={{ margin: '4px 0' }}>Kho Win Win</Divider>
            {winMatches.map((row, index) => (
              <Card
                key={`${row.ma_win}-${index}`}
                size="small"
                style={{ background: Number(row.con_lai || 0) > 0 ? '#f9f0ff' : '#fafafa' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <Space size={4} wrap>
                      <Text code>{row.ma_win}</Text>
                      <Tag color={row.match_group === 'exact' ? 'green' : row.match_group === 'alias' ? 'blue' : 'orange'}>
                        {row.score || 0}%
                      </Tag>
                    </Space>
                    <div style={{ marginTop: 4, fontSize: 12 }}>{row.ten_hang || '—'}</div>
                    <div style={{ marginTop: 3, color: 'var(--color-text-secondary)', fontSize: 11 }}>
                      Khớp qua {row.matched_target || row.ma_win}: {row.reason || 'mã tương ứng'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text strong style={{ color: Number(row.con_lai || 0) > 0 ? '#722ed1' : '#8c8c8c', fontSize: 18 }}>
                      {Number(row.con_lai || 0).toLocaleString('vi-VN')}
                    </Text>
                    <div style={{ fontSize: 11 }}>{row.dvt || ''}</div>
                  </div>
                </div>
                <Divider style={{ margin: '8px 0' }} />
                <Descriptions size="small" column={1} colon={false}>
                  <Descriptions.Item label="Giá Hachi">{Number(row.gia_hachi || 0) > 0 ? formatMoney(row.gia_hachi) : '—'}</Descriptions.Item>
                  <Descriptions.Item label="Giá lẻ">{Number(row.gia_le || 0) > 0 ? formatMoney(row.gia_le) : '—'}</Descriptions.Item>
                  <Descriptions.Item label="Giá thùng">{Number(row.gia_thung || 0) > 0 ? formatMoney(row.gia_thung) : '—'}</Descriptions.Item>
                  <Descriptions.Item label="Tổng bán">{Number(row.tong_ban || 0).toLocaleString('vi-VN')}</Descriptions.Item>
                </Descriptions>
              </Card>
            ))}
            <Alert
              type="info"
              showIcon
              message="Kho Win Win là nguồn riêng"
              description="Kết quả gần đúng chỉ để tham khảo. Hãy đối chiếu mô tả/mã trước khi báo hàng."
            />
          </>
        )}

        {supplier && (
          <>
            <Divider style={{ margin: '4px 0' }}>Giá NCC hiện hành</Divider>
            <Descriptions size="small" column={1} colon={false}>
              <Descriptions.Item label="Nhà cung cấp">{supplier.nha_cc || '—'}</Descriptions.Item>
              <Descriptions.Item label="Giá đại lý">
                {Number(supplier.gia_dai_ly || 0) > 0 ? formatMoney(supplier.gia_dai_ly) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Giá thùng">
                {Number(supplier.gia_thung || 0) > 0 ? formatMoney(supplier.gia_thung) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="SL/thùng">{supplier.sl_thung || '—'}</Descriptions.Item>
              <Descriptions.Item label="Stock NCC">{supplier.stock_ncc || 'Chưa xác nhận'}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Space>
    </Card>
  );
}

function SalesHistoryPanel({ candidate, onAliasConfirmed }) {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState(null);
  const [filters, setFilters] = useState({ code: '', description: '', customer: '', supplier: '', price: '' });
  const [savingAlias, setSavingAlias] = useState('');

  useEffect(() => {
    if (!candidate) return undefined;
    let cancelled = false;
    setLoading(true);
    api.post('/ma-ngoai/lookup/detail', {
      ma_hang: candidate.ma_hang,
      history_codes: candidate.history_codes || [],
    })
      .then(response => { if (!cancelled) setPayload(response.data); })
      .catch(error => {
        if (!cancelled) message.error(error.response?.data?.error || error.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidate]);

  const filteredSales = useMemo(() => {
    const rows = payload?.sales || [];
    const textMatch = (value, search) => !search || String(value || '').toUpperCase().includes(search.trim().toUpperCase());
    const priceTerm = Number(String(filters.price || '').replace(/[^0-9]/g, ''));
    return rows.filter(row =>
      textMatch(row.ma_hang, filters.code) &&
      textMatch(row.mo_ta, filters.description) &&
      textMatch(row.ten_kh, filters.customer) &&
      textMatch(row.nha_cc, filters.supplier) &&
      (!priceTerm || Number(row.don_gia || 0) === priceTerm)
    );
  }, [payload, filters]);

  const visibleStats = useMemo(() => {
    const prices = filteredSales.map(row => Number(row.don_gia || 0)).filter(v => v > 0);
    return {
      rows: filteredSales.length,
      qty: filteredSales.reduce((sum, row) => sum + Number(row.so_luong || 0), 0),
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      median: median(prices),
      mode: mode(prices),
    };
  }, [filteredSales]);

  async function confirmAlias(historyCode) {
    if (!candidate?.ma_hang || !historyCode) return;
    setSavingAlias(historyCode);
    try {
      await api.post('/ma-ngoai/aliases', {
        ma_hang: candidate.ma_hang,
        alias_raw: historyCode,
        loai_alias: 'ten_cu_qldh',
        nguon: 'QLĐH',
        ghi_chu: 'Xác nhận từ màn hình tra cứu mã',
      });
      message.success(`Đã lưu ${historyCode} là bí danh của ${candidate.ma_hang}`);
      onAliasConfirmed?.();
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
    } finally {
      setSavingAlias('');
    }
  }

  const columns = [
    {
      title: <HeaderFilter label="Mã hàng" value={filters.code} onChange={value => setFilters(f => ({ ...f, code: value }))} width={125} />,
      dataIndex: 'ma_hang', width: 150, fixed: 'left',
      render: value => <Text code>{value}</Text>,
    },
    {
      title: <HeaderFilter label="Mô tả" value={filters.description} onChange={value => setFilters(f => ({ ...f, description: value }))} width={170} />,
      dataIndex: 'mo_ta', width: 260,
      render: (value, row) => (
        <div>
          <div>{value || '—'}</div>
          {row.hang_sx && <Text type="secondary" style={{ fontSize: 11 }}>{row.hang_sx}</Text>}
        </div>
      ),
    },
    {
      title: <HeaderFilter label="Khách hàng" value={filters.customer} onChange={value => setFilters(f => ({ ...f, customer: value }))} width={160} />,
      dataIndex: 'ten_kh', width: 210,
    },
    { title: 'SL', dataIndex: 'so_luong', width: 70, align: 'right' },
    {
      title: <HeaderFilter label="Giá bán" value={filters.price} onChange={value => setFilters(f => ({ ...f, price: value }))} placeholder="VD 250000" width={110} />,
      dataIndex: 'don_gia', width: 135, align: 'right',
      render: value => Number(value || 0) > 0 ? <Text strong>{formatMoney(value)}</Text> : '—',
    },
    {
      title: 'Giá vốn cũ', dataIndex: 'gia_von', width: 125, align: 'right',
      render: (value, row) => Number(value || 0) > 0
        ? formatMoney(value)
        : row.nha_cc === 'B11' ? <Tooltip title="B11 = hàng đi từ kho; không coi giá vốn là 0"><Tag color="blue">Kho B11</Tag></Tooltip> : '—',
    },
    {
      title: <HeaderFilter label="Nhà CC" value={filters.supplier} onChange={value => setFilters(f => ({ ...f, supplier: value }))} width={100} />,
      dataIndex: 'nha_cc', width: 130,
      render: value => value ? <Tag color={nhaCCColor(value)}>{value}</Tag> : '—',
    },
    { title: 'Ghi chú', dataIndex: 'ghi_chu', width: 150, ellipsis: true },
  ];

  const unconfirmedHistory = (candidate?.history_matches || []).filter(match =>
    !match.confirmed &&
    normalizeCode(match.code) !== normalizeCode(candidate.ma_hang) &&
    match.score >= 82
  );

  return (
    <Card
      title={<Space><SearchOutlined />Lịch sử mua bán QLĐH</Space>}
      size="small"
      loading={loading}
    >
      {!candidate ? <Empty description="Chọn một kết quả mã để xem lịch sử" /> : (
        <>
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col xs={12} sm={8} md={4}><Statistic title="Dòng đang xem" value={visibleStats.rows} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title="Tổng SL" value={visibleStats.qty} precision={2} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title="Thấp nhất" value={visibleStats.min} formatter={value => value ? formatMoney(value) : '—'} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title="Cao nhất" value={visibleStats.max} formatter={value => value ? formatMoney(value) : '—'} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title="Trung vị" value={visibleStats.median} formatter={value => value ? formatMoney(value) : '—'} /></Col>
            <Col xs={12} sm={8} md={4}><Statistic title="Thường gặp" value={visibleStats.mode} formatter={value => value ? formatMoney(value) : '—'} /></Col>
          </Row>

          {filters.customer && visibleStats.rows === 0 && (
            <Alert
              style={{ marginBottom: 10 }}
              type="info"
              showIcon
              message={`Không có lịch sử của “${filters.customer}” với mã này`}
              description="Xóa bộ lọc khách hàng để xem giá đã bán cho các khách khác."
            />
          )}

          {unconfirmedHistory.length > 0 && (
            <Alert
              style={{ marginBottom: 10 }}
              type="warning"
              showIcon
              message="Tìm thấy mã cũ/biến thể trong QLĐH"
              description={(
                <Space wrap style={{ marginTop: 6 }}>
                  {unconfirmedHistory.slice(0, 5).map(match => (
                    <Popconfirm
                      key={match.code}
                      title={`Xác nhận ${match.code} là cùng sản phẩm với ${candidate.ma_hang}?`}
                      description="Sau khi xác nhận, lần tìm sau hệ thống sẽ coi đây là bí danh đã kiểm chứng."
                      onConfirm={() => confirmAlias(match.code)}
                      okText="Xác nhận"
                      cancelText="Không"
                    >
                      <Button size="small" icon={<LinkOutlined />} loading={savingAlias === match.code}>
                        {match.code} ({match.reason})
                      </Button>
                    </Popconfirm>
                  ))}
                </Space>
              )}
            />
          )}

          <Table
            dataSource={filteredSales}
            columns={columns}
            rowKey="id"
            size="small"
            scroll={{ x: 1250, y: 520 }}
            pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200] }}
            locale={{ emptyText: 'Chưa có lịch sử bán phù hợp' }}
          />
        </>
      )}
    </Card>
  );
}

function LookupWorkspace() {
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [groupTab, setGroupTab] = useState('all');

  const doSearch = useCallback(async value => {
    const q = String(value || query).trim();
    if (q.length < 2) {
      message.warning('Nhập ít nhất 2 ký tự mã');
      return;
    }
    setLoading(true);
    setSearchedQuery(q);
    try {
      const response = await api.get('/ma-ngoai/lookup', { params: { q } });
      const rows = response.data.data || [];
      setResults(rows);
      setSelected(rows[0] || null);
      setGroupTab('all');
      if (!rows.length) message.info('Không tìm thấy mã trong dữ liệu hiện có');
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const visibleResults = groupTab === 'all' ? results : results.filter(item => item.match_group === groupTab);

  return (
    <div>
      <Card style={{ marginBottom: 12 }}>
        <Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>Tra cứu mã để báo hàng</Title>
        <Text type="secondary">
          Tra Alopart trước, sau đó dán mã 555 / MK / KYB / OEM / mã kho vào đây. Hệ thống chỉ hỗ trợ tìm và gom bằng chứng; bạn là người quyết định mã và giá.
        </Text>
        <Input.Search
          autoFocus
          size="large"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onSearch={doSearch}
          enterButton={<><SearchOutlined /> Tìm mã</>}
          placeholder="VD: SR3880, HUB-MI-004, 344410..."
          loading={loading}
          allowClear
          style={{ marginTop: 14 }}
        />
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="Quy tắc nghiệp vụ"
          description="Chỉ mã 555 được tự quy đổi qua mã Aisin. Mã MK/KYB/OEM được tìm trực tiếp; mapping khác chỉ hiện như lựa chọn tham khảo."
        />
      </Card>

      {searchedQuery && (
        <>
          <Card
            size="small"
            title={<Space>Kết quả cho <Text code>{searchedQuery}</Text></Space>}
            style={{ marginBottom: 12 }}
          >
            <Tabs
              activeKey={groupTab}
              onChange={setGroupTab}
              items={[
                { key: 'all', label: `Tất cả (${results.length})` },
                { key: 'exact', label: `Đúng mã (${results.filter(x => x.match_group === 'exact').length})` },
                { key: 'alias', label: `Bí danh (${results.filter(x => x.match_group === 'alias').length})` },
                { key: 'fuzzy', label: `Gần giống (${results.filter(x => x.match_group === 'fuzzy').length})` },
              ]}
            />
            <CandidateList data={visibleResults} selected={selected} onSelect={setSelected} />
          </Card>

          {selected && (
            <Row gutter={[12, 12]} align="top">
              <Col xs={24} xl={18}>
                <SalesHistoryPanel key={selected.key} candidate={selected} onAliasConfirmed={() => doSearch(searchedQuery)} />
              </Col>
              <Col xs={24} xl={6}>
                <InventoryPanel key={selected.key} candidate={selected} />
              </Col>
            </Row>
          )}
        </>
      )}
    </div>
  );
}

function ConfirmModal({ unmatched, onConfirm, onClose, dsMaHang }) {
  const [items, setItems] = useState(unmatched.map(item => ({ ...item, ma_hang_chon: item.candidates?.[0] || '' })));

  function setChosen(index, value) {
    setItems(previous => previous.map((item, i) => i === index ? { ...item, ma_hang_chon: value } : item));
  }

  function handleOk() {
    onConfirm(items.filter(item => item.ma_hang_chon).map(item => ({
      ...item,
      ma_hang: item.ma_hang_chon,
      ma_ngoai: item.ma_ngoai || item.ma_excel,
    })));
  }

  return (
    <Modal open title={`Xác nhận ${unmatched.length} mã chưa khớp`} onCancel={onClose} onOk={handleOk} okText="Lưu mã đã chọn" width={900}>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="Không tự động chọn khi có nhiều khả năng"
        description="Kiểm tra mã/ứng dụng xe rồi mới xác nhận."
      />
      <Table
        dataSource={items}
        rowKey={(_, index) => index}
        size="small"
        pagination={false}
        scroll={{ y: 430, x: 850 }}
        columns={[
          { title: 'Mã file', dataIndex: 'ma_excel', width: 130, render: value => <Text code>{value}</Text> },
          { title: 'Loại', dataIndex: 'loai_ma', width: 80, render: value => <Tag>{value || 'KHAC'}</Tag> },
          { title: 'Sheet/NCC', dataIndex: 'nha_cc', width: 120, render: value => <Tag color={nhaCCColor(value)}>{value}</Tag> },
          { title: 'Xe áp dụng', dataIndex: 'xe_ap_dung', width: 230, ellipsis: true },
          {
            title: 'Mã kho tương ứng', width: 240,
            render: (_, row, index) => (
              <Select
                showSearch
                value={row.ma_hang_chon || undefined}
                onChange={value => setChosen(index, value)}
                placeholder="Chọn mã sau khi kiểm tra"
                style={{ width: '100%' }}
                options={unique([...(row.candidates || []), ...dsMaHang]).map(value => ({ value, label: value }))}
                filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
                allowClear
              />
            ),
          },
        ]}
      />
    </Modal>
  );
}

function MappingFormDrawer({ open, initial, dsMaHang, dsNhaCC, onSave, onClose }) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      form.setFieldsValue(initial || {
        ma_hang: '', ma_ngoai: '', loai_ma: 'KHAC', nha_cc: '', xe_ap_dung: '', vi_tri: '',
        gia_dai_ly: 0, gia_thung: 0, sl_thung: 0, stock_ncc: '', ghi_chu: '',
      });
    }
  }, [open, initial, form]);

  return (
    <Drawer
      title={initial?.id ? 'Sửa mapping mã' : 'Thêm mapping mã'}
      open={open}
      onClose={onClose}
      width={480}
      footer={<Space><Button type="primary" onClick={() => form.validateFields().then(onSave)}>Lưu</Button><Button onClick={onClose}>Hủy</Button></Space>}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="ma_hang" label="Mã tồn kho / mã chuẩn" rules={[{ required: true }]}>
          <Select
            showSearch
            placeholder="Chọn mã MISA"
            options={dsMaHang.map(value => ({ value, label: value }))}
            filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
        <Row gutter={8}>
          <Col span={15}>
            <Form.Item name="ma_ngoai" label="Mã ngoài" rules={[{ required: true }]}>
              <Input placeholder="VD SR3880, D2275..." />
            </Form.Item>
          </Col>
          <Col span={9}>
            <Form.Item name="loai_ma" label="Loại mã">
              <Select options={CODE_TYPE_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="nha_cc" label="Nhà cung cấp / sheet nguồn">
          <Select showSearch allowClear options={dsNhaCC.map(value => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item name="xe_ap_dung" label="Xe áp dụng"><Input /></Form.Item>
        <Form.Item name="vi_tri" label="Vị trí"><Input /></Form.Item>
        <Row gutter={8}>
          <Col span={8}><Form.Item name="gia_dai_ly" label="Giá đại lý"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item name="gia_thung" label="Giá thùng"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item name="sl_thung" label="SL/thùng"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Form.Item name="stock_ncc" label="Tình trạng NCC"><Input placeholder="Còn hàng / hết hàng..." /></Form.Item>
        <Form.Item name="ghi_chu" label="Ghi chú"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Drawer>
  );
}

function MappingAdmin() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', nha_cc: '' });
  const [dsNhaCC, setDsNhaCC] = useState([]);
  const [dsMaHang, setDsMaHang] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [importing, setImporting] = useState(false);
  const [confirmData, setConfirmData] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/ma-ngoai', { params: { ...filters, page, limit: 50 } });
      setData(response.data.data || []);
      setTotal(response.data.total || 0);
      setDsNhaCC(response.data.dsNhaCC || []);
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    api.get('/products/all').then(response => setDsMaHang((response.data || []).map(product => product.ma_hang)));
  }, []);
  useEffect(() => { load(); }, [load]);

  function handleSearchChange(event) {
    const value = event.target.value;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilters(previous => ({ ...previous, q: value }));
      setPage(1);
    }, 250);
  }

  async function handleSave(values) {
    try {
      if (editItem?.id) await api.put(`/ma-ngoai/${editItem.id}`, values);
      else await api.post('/ma-ngoai', values);
      message.success('Đã lưu mapping');
      setDrawerOpen(false);
      load();
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/ma-ngoai/${id}`);
      message.success('Đã xóa');
      load();
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
    }
  }

  async function handleImport(file) {
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await api.post('/ma-ngoai/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      const {
        matched,
        unmatched,
        suggestions,
        sales_history: salesHistory,
        win_inventory: winInventory,
      } = response.data;
      const historyCount = Number(salesHistory?.imported || 0);
      const winCount = Number(winInventory?.imported || 0);
      message.success(`Đã nhập ${historyCount} dòng QLĐH, ${winCount} mã WIN và ${matched} mapping NCC; ${unmatched} dòng cần kiểm tra`, 7);
      if (suggestions?.length) setConfirmData(suggestions);
      load();
    } catch (error) {
      message.error('Import lỗi: ' + (error.response?.data?.error || error.message));
    } finally {
      setImporting(false);
    }
    return false;
  }

  async function handleConfirm(items) {
    try {
      await api.post('/ma-ngoai/import/confirm', { items });
      message.success(`Đã lưu ${items.length} mapping thủ công`);
      setConfirmData(null);
      load();
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
    }
  }

  const columns = [
    { title: 'Mã kho', dataIndex: 'ma_hang', width: 145, fixed: 'left', render: value => <Text code>{value}</Text> },
    { title: 'Tên hàng', dataIndex: 'ten_hang', width: 240, ellipsis: true },
    { title: 'Mã ngoài', dataIndex: 'ma_ngoai', width: 150, render: value => <Text code style={{ color: '#1677ff' }}>{value}</Text> },
    { title: 'Loại', dataIndex: 'loai_ma', width: 85, render: value => <Tag color={value === '555' ? 'geekblue' : 'default'}>{value || 'KHAC'}</Tag> },
    { title: 'Nhà CC', dataIndex: 'nha_cc', width: 125, render: value => value ? <Tag color={nhaCCColor(value)}>{value}</Tag> : '—' },
    { title: 'Xe áp dụng', dataIndex: 'xe_ap_dung', width: 260, ellipsis: true },
    { title: 'Vị trí', dataIndex: 'vi_tri', width: 130, ellipsis: true },
    { title: 'Giá ĐL', dataIndex: 'gia_dai_ly', width: 110, align: 'right', render: value => Number(value || 0) ? formatMoney(value) : '—' },
    { title: 'Giá thùng', dataIndex: 'gia_thung', width: 110, align: 'right', render: value => Number(value || 0) ? formatMoney(value) : '—' },
    { title: 'Stock NCC', dataIndex: 'stock_ncc', width: 110, ellipsis: true },
    {
      title: '', width: 80, fixed: 'right',
      render: (_, row) => (
        <Space size={2}>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setEditItem(row); setDrawerOpen(true); }} />
          <Popconfirm title="Xóa mapping này?" onConfirm={() => handleDelete(row.id)} okText="Xóa" cancelText="Hủy">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Đây là màn hình quản trị dữ liệu"
        description="Màn hình Tra cứu phía trên mới là nơi sử dụng hằng ngày. Import một lần file ABCXYZ để cập nhật lịch sử QLĐH, kho WIN và catalog NCC; tại đây cũng sửa mapping và xác nhận loại mã."
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Input.Search placeholder="Mã kho, mã ngoài, tên hàng..." style={{ width: 300 }} onChange={handleSearchChange} allowClear />
        <Select
          placeholder="Tất cả nhà CC" allowClear style={{ width: 170 }}
          options={dsNhaCC.map(value => ({ value, label: value }))}
          onChange={value => { setFilters(previous => ({ ...previous, nha_cc: value || '' })); setPage(1); }}
        />
        <Button icon={<PlusOutlined />} onClick={() => { setEditItem(null); setDrawerOpen(true); }}>Thêm mapping</Button>
        <Upload accept=".xlsx,.xls" beforeUpload={handleImport} showUploadList={false}>
          <Button icon={<UploadOutlined />} loading={importing}>Import ABCXYZ (QLĐH + WIN + NCC)</Button>
        </Upload>
        <Text type="secondary" style={{ alignSelf: 'center' }}>{total} mapping</Text>
      </div>
      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 1500 }}
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: value => `${value} mapping` }}
      />
      <MappingFormDrawer
        open={drawerOpen}
        initial={editItem}
        dsMaHang={dsMaHang}
        dsNhaCC={dsNhaCC}
        onSave={handleSave}
        onClose={() => setDrawerOpen(false)}
      />
      {confirmData && (
        <ConfirmModal
          unmatched={confirmData}
          dsMaHang={dsMaHang}
          onConfirm={handleConfirm}
          onClose={() => setConfirmData(null)}
        />
      )}
    </div>
  );
}

export default MappingAdmin;
