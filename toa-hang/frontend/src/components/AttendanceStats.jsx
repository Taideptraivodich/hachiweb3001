import { useEffect, useState, useCallback } from 'react';
import {
  Tabs, Table, DatePicker, Select, Button, Space, message, Typography,
  Modal, Form, Input, Switch, Popconfirm, Tag, Empty, TimePicker,
} from 'antd';
import {
  DownloadOutlined, ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getAttendanceSummary, getAttendanceDetail, exportAttendance,
  getEmployees, createEmployee, updateEmployee, deleteEmployee,
} from '../api';

const { RangePicker } = DatePicker;
const { Text } = Typography;

// "2026-10-01 08:57:08" -> "08:57"
const hm = (v) => (v ? v.split(' ')[1].slice(0, 5) : '');

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Tab: Bảng tổng hợp ───────────────────────────────────────────────────────
function SummaryTab({ range, gioHC, gioRaHC }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (range?.[0]) params.tu_ngay = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.den_ngay = range[1].format('YYYY-MM-DD');
      params.gio_hc = gioHC;
      params.gio_ra_hc = gioRaHC;
      setRows(await getAttendanceSummary(params));
    } catch (err) {
      message.error('Lỗi tải bảng tổng hợp: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, [range, gioHC, gioRaHC]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    try {
      const params = { gio_hc: gioHC, gio_ra_hc: gioRaHC };
      if (range?.[0]) params.tu_ngay = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.den_ngay = range[1].format('YYYY-MM-DD');
      const blob = await exportAttendance('summary', params);
      downloadBlob(blob, `Cham cong tong hop ${dayjs().format('YYYY-MM-DD')}.xlsx`);
    } catch (err) {
      message.error('Lỗi xuất Excel: ' + (err.response?.data?.error || err.message));
    }
  }

  const columns = [
    { title: 'Mã NV', dataIndex: 'ma_nv', width: 100 },
    { title: 'Họ tên', dataIndex: 'ho_ten' },
    { title: 'Số ngày công', dataIndex: 'so_ngay_cong', width: 130, align: 'center' },
    { title: 'Số lần đi trễ', dataIndex: 'so_lan_tre', width: 130, align: 'center',
      render: (v) => v > 0 ? <Tag color="red">{v}</Tag> : v },
    { title: 'Tổng phút trễ', dataIndex: 'tong_phut_tre', width: 130, align: 'center',
      render: (v) => v > 0 ? <Text type="danger" strong>{v}</Text> : v },
    { title: 'Số lần ra sớm', dataIndex: 'so_lan_ra_som', width: 130, align: 'center',
      render: (v) => v > 0 ? <Tag color="orange">{v}</Tag> : v },
    { title: 'Tổng phút ra sớm', dataIndex: 'tong_phut_ra_som', width: 150, align: 'center',
      render: (v) => v > 0 ? <Text type="warning" strong>{v}</Text> : v },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load}>Tải lại</Button>
        <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>Xuất Excel</Button>
      </Space>
      <Table
        rowKey="employee_id" columns={columns} dataSource={rows}
        loading={loading} size="small" pagination={{ pageSize: 20 }}
        locale={{ emptyText: <Empty description="Không có dữ liệu chấm công trong khoảng thời gian này" /> }}
      />
    </div>
  );
}

// ─── Tab: Chi tiết theo từng nhân viên ────────────────────────────────────────
function DetailTab({ range, employees, gioHC, gioRaHC }) {
  const [employeeId, setEmployeeId] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (range?.[0]) params.tu_ngay = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.den_ngay = range[1].format('YYYY-MM-DD');
      if (employeeId) params.employee_id = employeeId;
      params.gio_hc = gioHC;
      params.gio_ra_hc = gioRaHC;
      setRows(await getAttendanceDetail(params));
    } catch (err) {
      message.error('Lỗi tải chi tiết: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, [range, employeeId, gioHC, gioRaHC]);

  useEffect(() => { load(); }, [load]);

  async function handleExport() {
    try {
      const params = { gio_hc: gioHC, gio_ra_hc: gioRaHC };
      if (range?.[0]) params.tu_ngay = range[0].format('YYYY-MM-DD');
      if (range?.[1]) params.den_ngay = range[1].format('YYYY-MM-DD');
      if (employeeId) params.employee_id = employeeId;
      const blob = await exportAttendance('detail', params);
      downloadBlob(blob, `Cham cong chi tiet ${dayjs().format('YYYY-MM-DD')}.xlsx`);
    } catch (err) {
      message.error('Lỗi xuất Excel: ' + (err.response?.data?.error || err.message));
    }
  }

  const columns = [
    { title: 'Ngày', dataIndex: 'ngay', width: 110 },
    { title: 'Mã NV', dataIndex: 'ma_nv', width: 100 },
    { title: 'Họ tên', dataIndex: 'ho_ten' },
    { title: 'Giờ vào', dataIndex: 'gio_vao', width: 100, align: 'center',
      render: (v) => v ? hm(v) : <Tag color="red">Chưa chấm</Tag> },
    { title: 'Phút vào trễ', dataIndex: 'phut_tre', width: 130, align: 'center',
      render: (v, r) => !r.gio_vao ? '' : v > 0 ? <Text type="danger" strong>{v}</Text> : 0 },
    { title: 'Giờ ra', dataIndex: 'gio_ra', width: 100, align: 'center',
      render: (v) => v ? hm(v) : <Tag color="orange">Chưa chấm</Tag> },
    { title: 'Phút ra sớm', dataIndex: 'phut_ra_som', width: 130, align: 'center',
      render: (v, r) => !r.gio_ra ? '' : v > 0 ? <Text type="warning" strong>{v}</Text> : 0 },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear placeholder="Tất cả nhân viên" style={{ width: 220 }}
          value={employeeId} onChange={setEmployeeId}
          options={employees.map(e => ({ value: e.id, label: `${e.ma_nv} — ${e.ho_ten}` }))}
        />
        <Button icon={<ReloadOutlined />} onClick={load}>Tải lại</Button>
        <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>Xuất Excel</Button>
      </Space>
      <Table
        rowKey="id" columns={columns} dataSource={rows}
        loading={loading} size="small" pagination={{ pageSize: 30 }}
        locale={{ emptyText: <Empty description="Không có dữ liệu chấm công trong khoảng thời gian này" /> }}
      />
    </div>
  );
}

// ─── Tab: Quản lý tài khoản nhân viên (để đăng nhập app mobile) ───────────────
function EmployeesTab({ employees, reload }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }
  function openEdit(emp) {
    setEditing(emp);
    form.setFieldsValue({ ma_nv: emp.ma_nv, ho_ten: emp.ho_ten, chuc_vu: emp.chuc_vu, active: !!emp.active });
    setModalOpen(true);
  }

  async function handleSubmit() {
    try {
      const values = await form.validateFields();
      if (editing) {
        await updateEmployee(editing.id, values);
        message.success('Đã cập nhật nhân viên');
      } else {
        await createEmployee(values);
        message.success('Đã tạo tài khoản nhân viên');
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      if (err?.errorFields) return; // lỗi validate form, không cần toast
      message.error('Lỗi: ' + (err.response?.data?.error || err.message));
    }
  }

  async function handleDelete(id) {
    try {
      await deleteEmployee(id);
      message.success('Đã xoá nhân viên');
      reload();
    } catch (err) {
      message.error('Lỗi xoá: ' + (err.response?.data?.error || err.message));
    }
  }

  const columns = [
    { title: 'Mã NV', dataIndex: 'ma_nv', width: 110 },
    { title: 'Họ tên', dataIndex: 'ho_ten' },
    { title: 'Chức vụ', dataIndex: 'chuc_vu' },
    { title: 'Trạng thái', dataIndex: 'active', width: 120,
      render: (v) => v ? <Tag color="green">Đang hoạt động</Tag> : <Tag>Đã khoá</Tag> },
    {
      title: '', width: 90, render: (_, emp) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(emp)} />
          <Popconfirm title="Xoá tài khoản này?" onConfirm={() => handleDelete(emp.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm nhân viên</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={employees} size="small" pagination={{ pageSize: 20 }} />

      <Modal
        title={editing ? 'Sửa nhân viên' : 'Thêm nhân viên'}
        open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        okText={editing ? 'Lưu' : 'Tạo tài khoản'} cancelText="Huỷ"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="ma_nv" label="Mã nhân viên (dùng để đăng nhập app)" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input disabled={!!editing} placeholder="VD: NV001" />
          </Form.Item>
          <Form.Item name="ho_ten" label="Họ tên" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="chuc_vu" label="Chức vụ">
            <Input />
          </Form.Item>
          <Form.Item
            name="password" label={editing ? 'Mật khẩu mới (bỏ trống nếu không đổi)' : 'Mật khẩu'}
            rules={editing ? [] : [{ required: true, message: 'Bắt buộc' }, { min: 4, message: 'Tối thiểu 4 ký tự' }]}
          >
            <Input.Password />
          </Form.Item>
          {editing && (
            <Form.Item name="active" label="Đang hoạt động" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

// ─── Component chính ──────────────────────────────────────────────────────────
export default function AttendanceStats() {
  const [range, setRange] = useState([dayjs().startOf('month'), dayjs()]);
  const [employees, setEmployees] = useState([]);
  const [gioHC, setGioHC] = useState(() => {
    try { return localStorage.getItem('cc_gio_hc') || '08:00'; } catch { return '08:00'; }
  });
  const [gioRaHC, setGioRaHC] = useState(() => {
    try { return localStorage.getItem('cc_gio_ra_hc') || '17:00'; } catch { return '17:00'; }
  });
  function changeGioRaHC(t) {
    const v = t ? t.format('HH:mm') : '17:00';
    setGioRaHC(v);
    try { localStorage.setItem('cc_gio_ra_hc', v); } catch { /* bỏ qua */ }
  }
  function changeGioHC(t) {
    const v = t ? t.format('HH:mm') : '08:00';
    setGioHC(v);
    try { localStorage.setItem('cc_gio_hc', v); } catch { /* bỏ qua */ }
  }

  const loadEmployees = useCallback(async () => {
    try {
      setEmployees(await getEmployees());
    } catch (err) {
      message.error('Lỗi tải danh sách nhân viên: ' + (err.response?.data?.error || err.message));
    }
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <Text strong>Khoảng thời gian:</Text>
        <RangePicker value={range} onChange={(v) => v && setRange(v)} format="DD/MM/YYYY" />
        <Text strong>Giờ vào làm:</Text>
        <TimePicker
          value={dayjs(gioHC, 'HH:mm')} onChange={changeGioHC}
          format="HH:mm" allowClear={false} needConfirm={false} minuteStep={5}
        />
        <Text strong>Giờ ra tiêu chuẩn:</Text>
        <TimePicker
          value={dayjs(gioRaHC, 'HH:mm')} onChange={changeGioRaHC}
          format="HH:mm" allowClear={false} needConfirm={false} minuteStep={5}
        />
      </Space>
      <Tabs
        defaultActiveKey="summary"
        items={[
          { key: 'summary', label: 'Bảng tổng hợp', children: <SummaryTab range={range} gioHC={gioHC} gioRaHC={gioRaHC} /> },
          { key: 'detail',  label: 'Chi tiết theo nhân viên', children: <DetailTab range={range} employees={employees} gioHC={gioHC} gioRaHC={gioRaHC} /> },
          { key: 'employees', label: 'Quản lý nhân viên', children: <EmployeesTab employees={employees} reload={loadEmployees} /> },
        ]}
      />
    </div>
  );
}
