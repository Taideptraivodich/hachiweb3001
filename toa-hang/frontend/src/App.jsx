import React, { useState } from 'react';
import { Layout, Menu, Typography, Button, message, Space } from 'antd';
import {
  FileTextOutlined, BarChartOutlined,
  ReloadOutlined, DatabaseOutlined,
  BankOutlined
} from '@ant-design/icons';
import OrderList from './components/OrderList';
import Reports   from './components/Reports';
import CongNo    from './components/CongNo';
import { syncProducts, syncCustomers } from './api';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

export default function App() {
  const [page, setPage]         = useState('orders');
  const [syncing, setSyncing]   = useState(false);
  const [lastSync, setLastSync] = useState(null);

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
    <Layout style={{ minHeight:'100vh' }}>
      <Header style={{
        display:'flex', alignItems:'center',
        justifyContent:'space-between',
        padding:'0 20px', background:'#1677ff'
      }}>
        <Space>
          <DatabaseOutlined style={{ color:'#fff', fontSize:20 }} />
          <Text style={{ color:'#fff', fontWeight:600, fontSize:16 }}>
            Quản lý Toa Hàng
          </Text>
        </Space>
        <Space>
          {lastSync && (
            <Text style={{ color:'rgba(255,255,255,0.7)', fontSize:12 }}>
              Sync lúc {lastSync}
            </Text>
          )}
          <Button
            size="small" icon={<ReloadOutlined />}
            loading={syncing} onClick={handleSync}
            style={{ background:'rgba(255,255,255,0.15)', color:'#fff', border:'none' }}
          >
            Sync MISA
          </Button>
        </Space>
      </Header>

      <Layout>
        <Sider width={180} style={{ background:'#fff', borderRight:'1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[page]}
            onClick={({ key }) => setPage(key)}
            style={{ borderRight:0, paddingTop:8 }}
            items={[
              { key:'orders',  icon:<FileTextOutlined />,  label:'Toa hàng' },
              { key:'reports', icon:<BarChartOutlined />,  label:'Báo cáo' },
              { key:'congno',  icon:<BankOutlined />,      label:'Công nợ' },
            ]}
          />
        </Sider>

        <Content style={{ padding:16, background:'#f5f5f5' }}>
          <div style={{
            background:'#fff', padding:16,
            borderRadius:8, minHeight:'calc(100vh - 100px)'
          }}>
            {page === 'orders'  && <OrderList />}
            {page === 'reports' && <Reports />}
            {page === 'congno'  && <CongNo />}
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
