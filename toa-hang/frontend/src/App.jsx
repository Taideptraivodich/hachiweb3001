import React, { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Button, message, Space, ConfigProvider, theme, Drawer } from 'antd';
import {
  FileTextOutlined, BarChartOutlined, ReloadOutlined,
  DatabaseOutlined, BankOutlined, InboxOutlined,
  SunOutlined, MoonOutlined, TagsOutlined, MenuOutlined, FileDoneOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import OrderList from './components/OrderList';
import Reports   from './components/Reports';
import CongNo    from './components/CongNo';
import TonKho    from './components/TonKho';
import MaNgoai   from './components/MaNgoai';
import BangCongNo from './components/BangCongNo';
import Login     from './components/Login';
import { useAuth } from './context/AuthContext';
import { syncAll } from './api';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

const MENU_ITEMS = [
  { key: 'orders',     icon: <FileTextOutlined />, label: 'Toa hàng'  },
  { key: 'reports',    icon: <BarChartOutlined />, label: 'Báo cáo'   },
  { key: 'congno',     icon: <BankOutlined />,     label: 'Công nợ'   },
  { key: 'bangcongno', icon: <FileDoneOutlined />, label: 'Bảng CN'   },
  { key: 'tonkho',     icon: <InboxOutlined />,    label: 'Tồn kho'   },
  { key: 'manggoai',   icon: <TagsOutlined />,     label: 'Mã ngoài'  },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function App() {
  const [page, setPage]         = useState('orders');
  const [syncing, setSyncing]   = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [dark, setDark]         = useState(false);
  const [mobileMenuOpen, setMobileMenu] = useState(false);
  const isMobile = useIsMobile();
  const { isAuthenticated, logout } = useAuth();

  useEffect(() => {
    document.body.classList.toggle('dark', dark);
  }, [dark]);

  // Chưa đăng nhập → chỉ hiện màn hình Login, không load layout/dữ liệu chính
  if (!isAuthenticated) {
    return (
      <ConfigProvider
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: { colorPrimary: '#1677ff' },
        }}
      >
        <Login />
      </ConfigProvider>
    );
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await syncAll();
      message.success(
        `Sync: ${r.products?.count||0} hàng hóa, ${r.customers?.count||0} khách, ` +
        `${r.tonkho?.count||0} tồn kho, ${r.congno?.count||0} công nợ`
      );
      setLastSync(new Date().toLocaleTimeString('vi-VN'));
    } catch (err) {
      message.error('Sync lỗi: ' + err.message);
    } finally {
      setSyncing(false);
    }
  }

  function handleNav(key) {
    setPage(key);
    setMobileMenu(false);
  }

  const menuEl = (
    <Menu
      mode="inline"
      selectedKeys={[page]}
      onClick={({ key }) => handleNav(key)}
      style={{ borderRight: 0, paddingTop: 8, height: '100%' }}
      items={MENU_ITEMS}
    />
  );

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff' },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        {/* Header */}
        <Header style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px', background: '#1677ff',
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <Space>
            {isMobile && (
              <Button
                size="small"
                icon={<MenuOutlined />}
                onClick={() => setMobileMenu(true)}
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}
              />
            )}
            <DatabaseOutlined style={{ color: '#fff', fontSize: 18 }} />
            {!isMobile && (
              <Text style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>
                Quản lý Toa Hàng
              </Text>
            )}
          </Space>
          <Space size={6}>
            {lastSync && !isMobile && (
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
                Sync lúc {lastSync}
              </Text>
            )}
            <Button
              size="small"
              icon={dark ? <SunOutlined /> : <MoonOutlined />}
              onClick={() => setDark(d => !d)}
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}
            />
            <Button
              size="small" icon={<ReloadOutlined />}
              loading={syncing} onClick={handleSync}
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}
            >
              {isMobile ? '' : 'Sync MISA'}
            </Button>
            <Button
              size="small" icon={<LogoutOutlined />}
              onClick={logout}
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}
            >
              {isMobile ? '' : 'Đăng xuất'}
            </Button>
          </Space>
        </Header>

        <Layout>
          {/* Desktop sidebar */}
          {!isMobile && (
            <Sider width={180}>
              {menuEl}
            </Sider>
          )}

          {/* Mobile drawer menu */}
          {isMobile && (
            <Drawer
              title="Menu"
              placement="left"
              open={mobileMenuOpen}
              onClose={() => setMobileMenu(false)}
              width={200}
              bodyStyle={{ padding: 0 }}
            >
              {menuEl}
            </Drawer>
          )}

          <Content style={{
            padding: isMobile ? 8 : 16,
            minHeight: 'calc(100vh - 64px)',
            overflowX: 'hidden',
          }}>
            {page === 'orders'   && <OrderList />}
            {page === 'reports'  && <Reports />}
            {page === 'congno'   && <CongNo />}
            {page === 'tonkho'   && <TonKho />}
            {page === 'bangcongno' && <BangCongNo />}
            {page === 'manggoai' && <MaNgoai />}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
