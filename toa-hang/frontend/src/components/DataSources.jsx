/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm,
  Select, Space, Table, Tabs, Tag, Typography, Upload, message,
} from 'antd';
import { DatabaseOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { apiClient as api } from '../api';

const { Text } = Typography;

const ROLE_OPTIONS = [
  ['IGNORE', 'Không dùng'],
  ['PRIMARY_CODE:INTERNAL', 'Mã chính · Nội bộ / mã NCC'],
  ['PRIMARY_CODE:555', 'Mã chính · 555'],
  ['PRIMARY_CODE:AISIN', 'Mã chính · AISIN'],
  ['PRIMARY_CODE:OEM', 'Mã chính · OEM'],
  ['PRIMARY_CODE:KYB', 'Mã chính · KYB'],
  ['PRIMARY_CODE:TOKICO', 'Mã chính · TOKICO'],
  ['CODE:555', 'Mã liên quan · 555'],
  ['CODE:AISIN', 'Mã liên quan · AISIN'],
  ['CODE:OEM', 'Mã liên quan · OEM'],
  ['CODE:KYB', 'Mã liên quan · KYB'],
  ['CODE:MK', 'Mã liên quan · MK'],
  ['CODE:TOKICO', 'Mã liên quan · TOKICO'],
  ['CODE:CTR', 'Mã liên quan · CTR'],
  ['CODE:OTHER', 'Mã liên quan · Khác'],
  ['NAME', 'Tên hàng'],
  ['DESCRIPTION', 'Mô tả'],
  ['COST', 'Giá nhập'],
  ['RETAIL_PRICE', 'Giá bán / giá lẻ'],
  ['STOCK', 'Tồn kho'],
  ['BRAND', 'Hãng sản xuất'],
  ['VEHICLE', 'Xe áp dụng'],
  ['POSITION', 'Vị trí'],
  ['REMARK', 'Ghi chú'],
].map(([value, label]) => ({ value, label }));

function emptyWizard() {
  return {
    open: false,
    source: { id: null, name: '', source_type: 'supplier', description: '', priority: 100 },
    file: null,
    fileName: '',
    sheets: [],
    activeSheet: '',
    previewing: false,
    importing: false,
  };
}

export default function DataSources() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [wizard, setWizard] = useState(emptyWizard());
  const [hachiImporting, setHachiImporting] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/data-sources');
      setSources(response.data || []);
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openWizard(source = null) {
    const sourceValue = source
      ? { id: source.id, name: source.name, source_type: source.source_type, description: source.description, priority: source.priority }
      : { id: null, name: '', source_type: 'supplier', description: '', priority: 100 };
    form.setFieldsValue(sourceValue);
    setWizard({ ...emptyWizard(), open: true, source: sourceValue });
  }

  async function previewFile(file) {
    const source = await form.validateFields();
    setWizard(old => ({ ...old, previewing: true, file, fileName: file.name, source: { ...source, id: wizard.source.id } }));
    try {
      const body = new FormData();
      body.append('file', file);
      if (wizard.source.id) body.append('source_id', wizard.source.id);
      const response = await api.post('/data-sources/preview', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const sheets = (response.data.sheets || []).map(sheet => {
        const saved = sheet.saved_template;
        const mapping = saved?.mapping || Object.fromEntries(sheet.headers.map(header => [header.index, header.suggested_role || 'IGNORE']));
        return {
          ...sheet,
          enabled: Boolean(saved) || response.data.sheets.length === 1,
          header_row: saved?.header_row ?? sheet.header_row,
          mapping,
          template_name: saved?.name || `${source.name} - ${sheet.sheet_name}`,
          save_template: true,
        };
      });
      setWizard(old => ({
        ...old,
        previewing: false,
        sheets,
        activeSheet: sheets.find(sheet => sheet.enabled)?.sheet_name || sheets[0]?.sheet_name || '',
      }));
    } catch (error) {
      setWizard(old => ({ ...old, previewing: false, file: null, fileName: '' }));
      message.error(error.response?.data?.error || error.message);
    }
    return false;
  }

  function patchSheet(sheetName, patch) {
    setWizard(old => ({ ...old, sheets: old.sheets.map(sheet => sheet.sheet_name === sheetName ? { ...sheet, ...patch } : sheet) }));
  }

  function patchMapping(sheetName, columnIndex, role) {
    setWizard(old => ({
      ...old,
      sheets: old.sheets.map(sheet => sheet.sheet_name === sheetName
        ? { ...sheet, mapping: { ...sheet.mapping, [columnIndex]: role } }
        : sheet),
    }));
  }

  const activeSheet = useMemo(() => wizard.sheets.find(sheet => sheet.sheet_name === wizard.activeSheet), [wizard.sheets, wizard.activeSheet]);

  async function runImport() {
    const source = await form.validateFields();
    const enabled = wizard.sheets.filter(sheet => sheet.enabled);
    if (!wizard.file) return message.warning('Chưa chọn file');
    if (!enabled.length) return message.warning('Chọn ít nhất một sheet');
    for (const sheet of enabled) {
      if (!Object.values(sheet.mapping || {}).some(role => String(role).startsWith('PRIMARY_CODE') || String(role).startsWith('CODE:'))) {
        return message.warning(`Sheet ${sheet.sheet_name} chưa có cột mã`);
      }
    }

    setWizard(old => ({ ...old, importing: true }));
    try {
      const config = {
        source: { ...source, id: wizard.source.id },
        sheets: enabled.map(sheet => ({
          sheet_name: sheet.sheet_name,
          header_row: sheet.header_row,
          signature: sheet.signature,
          mapping: sheet.mapping,
          template_name: sheet.template_name,
          save_template: sheet.save_template,
          enabled: true,
        })),
      };
      const body = new FormData();
      body.append('file', wizard.file);
      body.append('config', JSON.stringify(config));
      const response = await api.post('/data-sources/import', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      message.success(`Đã import ${response.data.imported} dòng từ ${response.data.source_name}; index có ${response.data.index?.documents || 0} điểm điều hướng`, 6);
      setWizard(emptyWizard());
      form.resetFields();
      load();
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
      setWizard(old => ({ ...old, importing: false }));
    }
  }


  async function importHachiWorkbook(file) {
    setHachiImporting(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await api.post('/ma-ngoai/import', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const history = Number(response.data.sales_history?.imported || 0);
      const win = Number(response.data.win_inventory?.imported || 0);
      const mappings = Number(response.data.catalog?.matched || response.data.matched || 0);
      message.success(`Đã cập nhật ${history} dòng QLĐH, ${win} mã WIN và ${mappings} mapping NCC; Search Index đã được xây lại.`, 7);
    } catch (error) {
      message.error(error.response?.data?.error || error.message);
    } finally {
      setHachiImporting(false);
    }
    return false;
  }

  async function removeSource(id) {
    try {
      await api.delete(`/data-sources/${id}`);
      message.success('Đã xóa nguồn và xây lại index');
      load();
    } catch (error) { message.error(error.response?.data?.error || error.message); }
  }

  const sourceColumns = [
    { title: 'Nguồn dữ liệu', dataIndex: 'name', render: (value, row) => <div><Text strong>{value}</Text><div><Text type="secondary">{row.description || row.source_type}</Text></div></div> },
    { title: 'Loại', dataIndex: 'source_type', width: 120, render: value => <Tag>{value}</Tag> },
    { title: 'Số dòng', dataIndex: 'record_count', width: 100, align: 'right' },
    { title: 'Template', dataIndex: 'template_count', width: 90, align: 'right' },
    { title: 'File gần nhất', dataIndex: 'last_file_name', width: 220, ellipsis: true },
    { title: 'Import gần nhất', dataIndex: 'last_import_at', width: 165 },
    {
      title: '', width: 190,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<UploadOutlined />} onClick={() => openWizard(row)}>Import mới</Button>
          <Popconfirm title="Xóa nguồn dữ liệu này?" description="Dữ liệu nguồn, relation và index liên quan sẽ bị xóa." onConfirm={() => removeSource(row.id)}>
            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const mappingColumns = activeSheet ? [
    { title: 'Cột Excel', dataIndex: 'header', width: 220, render: (value, row) => <div><Text strong>{value}</Text><div><Text type="secondary">Cột {row.index + 1}</Text></div></div> },
    { title: 'Ví dụ dữ liệu', dataIndex: 'samples', render: values => <Space direction="vertical" size={0}>{(values || []).slice(0, 3).map((value, index) => <Text key={index} code={typeof value !== 'number'}>{String(value || '—')}</Text>)}</Space> },
    {
      title: 'Vai trò trong HachiWeb', width: 260,
      render: (_, row) => (
        <Select
          showSearch
          style={{ width: '100%' }}
          value={activeSheet.mapping?.[row.index] || 'IGNORE'}
          options={ROLE_OPTIONS}
          onChange={value => patchMapping(activeSheet.sheet_name, row.index, value)}
          optionFilterProp="label"
        />
      ),
    },
  ] : [];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Data Source Engine"
        description="Thêm nhà cung cấp mới mà không sửa code: upload file → map cột một lần → lưu template → các lần sau chỉ import. Các cột mã liên quan trong cùng một dòng sẽ tự tạo quan hệ mã."
      />
      <Space style={{ marginBottom: 12 }} wrap>
        <Upload accept=".xlsx,.xls" beforeUpload={importHachiWorkbook} showUploadList={false}>
          <Button type="primary" icon={<UploadOutlined />} loading={hachiImporting}>Import file tổng hợp ABCXYZ</Button>
        </Upload>
        <Button icon={<DatabaseOutlined />} onClick={() => openWizard()}>Thêm nguồn dữ liệu khác</Button>
      </Space>
      <Table rowKey="id" dataSource={sources} columns={sourceColumns} loading={loading} size="small" pagination={false} />

      <Modal
        open={wizard.open}
        title={wizard.source.id ? `Import lại nguồn ${wizard.source.name}` : 'Thêm nguồn dữ liệu mới'}
        onCancel={() => setWizard(emptyWizard())}
        width={1100}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setWizard(emptyWizard())}>Hủy</Button>,
          <Button key="import" type="primary" disabled={!wizard.file || !wizard.sheets.length} loading={wizard.importing} onClick={runImport}>Import & xây index</Button>,
        ]}
      >
        <Form form={form} layout="vertical" initialValues={wizard.source}>
          <Space align="start" wrap style={{ width: '100%' }}>
            <Form.Item name="name" label="Tên nguồn" rules={[{ required: true }]}><Input placeholder="VD CTR, KYB, Nhà cung cấp A" style={{ width: 230 }} /></Form.Item>
            <Form.Item name="source_type" label="Loại nguồn"><Select style={{ width: 160 }} options={[{ value: 'supplier', label: 'Nhà cung cấp' }, { value: 'catalog', label: 'Catalog' }, { value: 'inventory', label: 'Kho phụ' }]} /></Form.Item>
            <Form.Item name="priority" label="Ưu tiên"><InputNumber min={1} max={999} style={{ width: 110 }} /></Form.Item>
            <Form.Item name="description" label="Ghi chú"><Input style={{ width: 300 }} /></Form.Item>
          </Space>
        </Form>

        <Upload accept=".xlsx,.xls" beforeUpload={previewFile} showUploadList={false}>
          <Button icon={<UploadOutlined />} loading={wizard.previewing}>Chọn Excel & xem trước</Button>
        </Upload>
        {wizard.fileName && <Text style={{ marginLeft: 10 }}>{wizard.fileName}</Text>}

        {wizard.sheets.length > 0 && (
          <Tabs
            style={{ marginTop: 14 }}
            activeKey={wizard.activeSheet}
            onChange={active => setWizard(old => ({ ...old, activeSheet: active }))}
            items={wizard.sheets.map(sheet => ({
              key: sheet.sheet_name,
              label: <Space><Checkbox checked={sheet.enabled} onClick={event => event.stopPropagation()} onChange={event => patchSheet(sheet.sheet_name, { enabled: event.target.checked })} />{sheet.sheet_name}<Tag>{sheet.row_count} dòng</Tag>{sheet.saved_template && <Tag color="green">Đã nhận template</Tag>}</Space>,
              children: sheet.sheet_name === wizard.activeSheet ? (
                <>
                  <Space style={{ marginBottom: 10 }} wrap>
                    <Checkbox checked={sheet.enabled} onChange={event => patchSheet(sheet.sheet_name, { enabled: event.target.checked })}>Import sheet này</Checkbox>
                    <span>Dòng header:</span>
                    <InputNumber min={0} value={sheet.header_row} onChange={value => patchSheet(sheet.sheet_name, { header_row: Number(value || 0) })} />
                    <Checkbox checked={sheet.save_template} onChange={event => patchSheet(sheet.sheet_name, { save_template: event.target.checked })}>Lưu mapping làm template</Checkbox>
                    <Input value={sheet.template_name} onChange={event => patchSheet(sheet.sheet_name, { template_name: event.target.value })} style={{ width: 260 }} />
                  </Space>
                  <Alert type="warning" showIcon style={{ marginBottom: 10 }} message="Mã chính và các cột Mã liên quan trong cùng một dòng sẽ được nối thành relation" />
                  <Table rowKey="index" dataSource={sheet.headers} columns={mappingColumns} size="small" pagination={false} scroll={{ y: 430 }} />
                </>
              ) : null,
            }))}
          />
        )}
      </Modal>
    </div>
  );
}
