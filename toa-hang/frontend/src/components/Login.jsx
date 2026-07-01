import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, DatabaseOutlined } from '@ant-design/icons';
import { login as loginApi } from '../api';
import { useAuth } from '../context/AuthContext';

const { Title, Text } = Typography;

export default function Login() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);

  async function handleFinish(values) {
    setLoading(true);
    try {
      const r = await loginApi(values.username.trim(), values.password);
      login(r.token, r.expiresIn);
      message.success('Đăng nhập thành công');
    } catch (err) {
      message.error(err.response?.data?.error || 'Đăng nhập thất bại, thử lại');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
        padding: 16,
      }}
    >
      <Card style={{ width: 360, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <DatabaseOutlined style={{ fontSize: 32, color: '#1677ff' }} />
          <Title level={4} style={{ marginTop: 8, marginBottom: 0 }}>
            Quản lý Toa Hàng
          </Title>
          <Text type="secondary">Đăng nhập để tiếp tục</Text>
        </div>

        <Form layout="vertical" onFinish={handleFinish} disabled={loading}>
          <Form.Item
            name="username"
            label="Tài khoản"
            rules={[{ required: true, message: 'Nhập tài khoản' }]}
          >
            <Input prefix={<UserOutlined />} autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mật khẩu"
            rules={[{ required: true, message: 'Nhập mật khẩu' }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Đăng nhập
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
