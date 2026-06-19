require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const { setupDatabase }     = require('./src/setup');
const { startSyncScheduler, syncProducts, syncCustomers, syncTonkho, syncCongno, syncCongnoChiTiet, syncTonkhoChiTiet } = require('./src/sync');
const productsRouter = require('./src/routes/products');
const ordersRouter   = require('./src/routes/orders');
const reportsRouter  = require('./src/routes/reports');
const historyRouter  = require('./src/routes/history');
const congnoRouter   = require('./src/routes/congno');
const tonkhoRouter   = require('./src/routes/tonkho');

const syncStatusRouter = require('./src/routes/sync_status');
const bangCongNoRouter = require('./src/routes/bang_cong_no');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/products',  productsRouter);
app.use('/api/ma-ngoai', require('./src/routes/ma_ngoai'));
app.use('/api/orders',    ordersRouter);
app.use('/api/reports',   reportsRouter);
app.use('/api/history',   historyRouter);
app.use('/api/congno',    congnoRouter);
app.use('/api/tonkho',   tonkhoRouter);
app.use('/api/bang-cong-no', bangCongNoRouter);
app.use('/api/sync',     syncStatusRouter);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

// Serve React build (production)
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

async function start() {
  try {
    console.log('🚀 Khởi động hệ thống toa hàng...');

    // Setup DB tables
    await setupDatabase();

    // Sync lần đầu khi khởi động
    console.log('🔄 Sync dữ liệu lần đầu...');
    await syncProducts();
    await syncCustomers();
    await syncTonkho();
    await syncCongno();

    // Pre-cache chi tiết (6 tháng gần nhất) — chạy ngầm, không chặn server start
    syncCongnoChiTiet().catch(() => {});
    syncTonkhoChiTiet().catch(() => {});

    // Bắt đầu scheduler
    startSyncScheduler();

    app.listen(PORT, () => {
      console.log(`✅ Server chạy tại http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Lỗi khởi động:', err.message);
    process.exit(1);
  }
}

start();
