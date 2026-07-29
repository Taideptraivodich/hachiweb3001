require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const { setupDatabase }     = require('./src/setup');
const { startSyncScheduler, syncProducts, syncCustomers, syncTonkho, syncCongno, syncCongnoChiTiet, syncTonkhoChiTiet, isMisaOnline } = require('./src/sync');
const productsRouter = require('./src/routes/products');
const ordersRouter   = require('./src/routes/orders');
const reportsRouter  = require('./src/routes/reports');
const historyRouter  = require('./src/routes/history');
const congnoRouter   = require('./src/routes/congno');
const tonkhoRouter   = require('./src/routes/tonkho');

const syncStatusRouter = require('./src/routes/sync_status');
const bangCongNoRouter = require('./src/routes/bang_cong_no');
const authRouter       = require('./src/routes/auth');
const kioskRouter      = require('./src/routes/kiosk');
const { requireAuth }  = require('./src/middleware/auth');
const { startQrScheduler, ensureActiveToken } = require('./src/services/attendance_qr');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Auth & health check — KHÔNG yêu cầu đăng nhập
app.use('/api/auth', authRouter);
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));
// Màn hình kiosk chấm công (đặt ở cổng công ty) — cũng không yêu cầu đăng nhập
app.use('/api/kiosk', kioskRouter);

// Từ đây trở xuống, mọi route /api/* đều yêu cầu JWT hợp lệ
app.use('/api', requireAuth);

// API routes
app.use('/api/products',  productsRouter);
app.use('/api/ma-ngoai', require('./src/routes/ma_ngoai'));
app.use('/api/navigation', require('./src/routes/navigation'));
app.use('/api/data-sources', require('./src/routes/data_sources'));
app.use('/api/orders',    ordersRouter);
app.use('/api/reports',   reportsRouter);
app.use('/api/history',   historyRouter);
app.use('/api/congno',    congnoRouter);
app.use('/api/tonkho',   tonkhoRouter);
app.use('/api/bang-cong-no', bangCongNoRouter);
app.use('/api/sync',     syncStatusRouter);
app.use('/api/employees',  require('./src/routes/employees'));
app.use('/api/attendance', require('./src/routes/attendance'));

// Serve React build (production)
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

async function start() {
  try {
    console.log('🚀 Khởi động hệ thống toa hàng...');

    // Database phải sẵn sàng trước khi nhận request.
    await setupDatabase();

    // Mở cổng ngay sau khi DB sẵn sàng.
    const server = app.listen(PORT, () => {
      console.log(`✅ Server chạy tại http://localhost:${PORT}`);
    });

    server.on('error', (error) => {
      console.error('❌ Không mở được cổng server:', error);
    });

    // Các tác vụ khởi động còn lại chạy nền, không được chặn server.
    (async () => {
      try {
        const misaOnline = await isMisaOnline();

        if (misaOnline) {
          console.log('🔄 MISA online — sync dữ liệu lần đầu...');

          await syncProducts();
          await syncCustomers();
          await syncTonkho();
          await syncCongno();

          (async () => {
            await syncCongnoChiTiet();
            await syncTonkhoChiTiet();
          })().catch((error) => {
            console.warn('⚠️ Pre-cache chi tiết lỗi:', error.message);
          });
        } else {
          console.warn(
            '⚠️ MISA offline — bỏ qua sync khởi động, tiếp tục dùng cache local'
          );
        }
      } catch (error) {
        console.warn(
          '⚠️ Kiểm tra/sync MISA lúc khởi động lỗi, tiếp tục dùng cache local:',
          error.message
        );
      }

      try {
        const { loadMemoryIndex } =
          require('./src/services/navigationIndex');

        const navigationIndex = await loadMemoryIndex(true);

        console.log(
          `🧭 Navigation index ready: ${navigationIndex.documents.size} documents`
        );
      } catch (error) {
        console.warn(
          '⚠️ Không warm được navigation index:',
          error.message
        );
      }
      console.warn('⚠️ Tạm tắt inventory cache warm để khoanh vùng V3.0.3');

      try {
        startSyncScheduler();
      } catch (error) {
        console.warn(
          '⚠️ Không khởi động được scheduler:',
          error.message
        );
      }

      try {
        await ensureActiveToken();
        startQrScheduler();
      } catch (error) {
        console.warn(
          '⚠️ Không khởi động được QR chấm công:',
          error.message
        );
      }
    })();
  } catch (error) {
    console.error('❌ Lỗi khởi động database/server:', error);
    process.exit(1);
  }
}

start();
