import React, { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Button, message, Space, ConfigProvider, theme } from 'antd';
import {
  FileTextOutlined, BarChartOutlined, ReloadOutlined,
  DatabaseOutlined, BankOutlined, InboxOutlined,
  SunOutlined, MoonOutlined,
} from '@ant-design/icons';
import OrderList from './components/OrderList';
import Reports   from './components/Reports';
import CongNo    from './components/CongNo';
import TonKho    from './components/TonKho';
import { syncProducts, syncCustomers } from './api';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

export default function App() {
  const [page, setPage]     = useState('orders');
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [dark, setDark]     = useState(false);

  // Toggle class dark trên body → CSS variables tự đổi toàn app
  useEffect(() => {
    document.body.classList.toggle('dark', dark);
  }, [dark]);

  async function handleSync() {
    setSyncing(true);
    try {
      const [r1, r2] = await Promise.all([syncProducts(), syncCustomers()]);
      message.success(`Sync: ${r1.count||0} hàng hóa, ${r2.count||0} khách hàng`);
      setLastSync(new Date().toLocaleTimeString('vi-VN'));
    } catch (err) {
      message.error('Sync lỗi: ' + err.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff' },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px', background: '#1677ff',
        }}>
          <Space>
            <DatabaseOutlined style={{ color: '#fff', fontSize: 20 }} />
            <Text style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>
              Quản lý Toa Hàng
            </Text>
          </Space>
          <Space>
            {lastSync && (
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
                Sync lúc {lastSync}
              </Text>
            )}
            <Button
              size="small"
              icon={dark ? <SunOutlined /> : <MoonOutlined />}
              onClick={() => setDark(d => !d)}
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}
              title={dark ? 'Light mode' : 'Dark mode'}
            />
            <Button
              size="small" icon={<ReloadOutlined />}
              loading={syncing} onClick={handleSync}
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}
            >
              Sync MISA
            </Button>
          </Space>
        </Header>

        <Layout>
          <Sider width={180}>
            <Menu
              mode="inline"
              selectedKeys={[page]}
              onClick={({ key }) => setPage(key)}
              style={{ borderRight: 0, paddingTop: 8, height: '100%' }}
              items={[
                { key: 'orders',  icon: <FileTextOutlined />, label: 'Toa hàng'  },
                { key: 'reports', icon: <BarChartOutlined />, label: 'Báo cáo'   },
                { key: 'congno',  icon: <BankOutlined />,     label: 'Công nợ'   },
                { key: 'tonkho',  icon: <InboxOutlined />,    label: 'Tồn kho'   },
              ]}
            />
          </Sider>

          <Content style={{ padding: 16, minHeight: 'calc(100vh - 64px)' }}>
            {page === 'orders'  && <OrderList />}
            {page === 'reports' && <Reports />}
            {page === 'congno'  && <CongNo />}
            {page === 'tonkho'  && <TonKho />}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
