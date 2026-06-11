import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import viVN from 'antd/locale/vi_VN'
import dayjs from 'dayjs'
import 'dayjs/locale/vi'
import App from './App'
import './index.css'

dayjs.locale('vi')

ReactDOM.createRoot(document.getElementById('root')).render(
  <ConfigProvider locale={viVN} theme={{
    token: {
      colorPrimary: '#1677ff',
      borderRadius: 6,
    }
  }}>
    <App />
  </ConfigProvider>
)
