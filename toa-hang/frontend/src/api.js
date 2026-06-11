import axios from 'axios';
const api = axios.create({ baseURL: '/api' });
// Products
export const searchProducts = (q) =>
  api.get('/products', { params: { q } }).then(r => r.data);
export const searchCustomers = (q) =>
  api.get('/products/customers', { params: { q } }).then(r => r.data);
export const syncProducts = () =>
  api.post('/products/sync').then(r => r.data);
export const syncCustomers = () =>
  api.post('/products/customers/sync').then(r => r.data);
// Orders
export const getOrders = (params) =>
  api.get('/orders', { params }).then(r => r.data);
export const getOrder = (ma_toa) =>
  api.get(`/orders/${ma_toa}`).then(r => r.data);
export const createOrder = (data) =>
  api.post('/orders', data).then(r => r.data);
export const updateOrder = (ma_toa, data) =>
  api.put(`/orders/${ma_toa}`, data).then(r => r.data);
export const updateOrderStatus = (ma_toa, trang_thai) =>
  api.patch(`/orders/${ma_toa}/status`, { trang_thai }).then(r => r.data);
export const deleteOrder = (ma_toa) =>
  api.delete(`/orders/${ma_toa}`).then(r => r.data);
export const getNextCode = (date) =>
  api.get('/orders/next-code', { params: { date } }).then(r => r.data);
// Reports
export const getReportSummary = (params) =>
  api.get('/reports/summary', { params }).then(r => r.data);
export const getTopProducts = (params) =>
  api.get('/reports/top-products', { params }).then(r => r.data);
export const getDailyReport = (params) =>
  api.get('/reports/daily', { params }).then(r => r.data);
export const getProductHistory = (ma_hang) =>
  api.get(`/reports/product/${ma_hang}`).then(r => r.data);
export const getCustomerHistory = (ma_kh) =>
  api.get(`/reports/customer/${ma_kh}`).then(r => r.data);
// History
export const getProductHistory2 = (ma_hang) =>
  api.get(`/history/${encodeURIComponent(ma_hang)}`).then(r => r.data);
export const getHistoryStats = () =>
  api.get('/history/stats').then(r => r.data);
export const importHistoryFile = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/history/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }).then(r => r.data);
};
