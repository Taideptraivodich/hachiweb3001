import { Space, Tabs } from 'antd';
import { DatabaseOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import NavigationSearch from './NavigationSearch';
import DataSources from './DataSources';
import MappingAdmin from './MappingAdminLegacy';

export default function MaNgoai() {
  return (
    <Tabs
      defaultActiveKey="lookup"
      items={[
        { key: 'lookup', label: <Space><SearchOutlined />Tra cứu báo hàng</Space>, children: <NavigationSearch /> },
        { key: 'sources', label: <Space><DatabaseOutlined />Nguồn dữ liệu</Space>, children: <DataSources /> },
        { key: 'admin', label: <Space><EditOutlined />Quản lý mã cũ</Space>, children: <MappingAdmin /> },
      ]}
    />
  );
}
