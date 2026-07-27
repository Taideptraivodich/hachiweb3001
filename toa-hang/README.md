# Hệ thống Quản lý Toa Hàng Phụ Tùng Ô Tô

## Yêu cầu
- Node.js 18+
- SQL Server (MISA đang dùng)
- Tạo thêm 1 database mới trên SQL Server để lưu dữ liệu app

---

## Cài đặt lần đầu

### Bước 1 — Tạo database app trên SQL Server
Mở SSMS, chạy:
```sql
CREATE DATABASE ToaHangDB;
```

### Bước 2 — Cấu hình kết nối
Mở file `backend/.env`, điền thông tin thực tế:

```env
# Kết nối MISA (đọc tồn kho)
MISA_HOST=192.168.1.x        # IP máy chủ SQL Server MISA
MISA_PORT=1433
MISA_USER=sa
MISA_PASSWORD=mat_khau_cua_ban
MISA_DATABASE=ten_database_misa  # Tên DB MISA (xem trong SSMS)

# Kết nối App DB (lưu toa hàng)
APP_HOST=192.168.1.x         # Cùng server hoặc khác đều được
APP_PORT=1433
APP_USER=sa
APP_PASSWORD=mat_khau_cua_ban
APP_DATABASE=ToaHangDB

# Cổng web
PORT=3001
SYNC_INTERVAL_MINUTES=15     # Tự động sync MISA mỗi 15 phút
```

### Bước 3 — Cài dependencies

```bash
# Backend
cd backend
npm install

# Frontend (chỉ cần build 1 lần)
cd ../frontend
npm install
npm run build
```

### Bước 4 — Chạy server

```bash
cd backend
npm start
```

Mở trình duyệt: **http://localhost:3001**

---

## Trong quá trình phát triển (hot reload)

Chạy 2 terminal:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Mở: **http://localhost:5173**

---

## Cấu trúc project

```
toa-hang/
├── backend/
│   ├── .env              ← Cấu hình kết nối (QUAN TRỌNG)
│   ├── index.js          ← Entry point
│   └── src/
│       ├── db.js         ← Connection pools MISA + App
│       ├── setup.js      ← Tạo tables tự động
│       ├── sync.js       ← Đồng bộ dữ liệu từ MISA
│       └── routes/
│           ├── products.js  ← API hàng hóa + khách hàng
│           ├── orders.js    ← API toa hàng
│           └── reports.js   ← API báo cáo
└── frontend/
    └── src/
        ├── App.jsx
        ├── api.js           ← Gọi API backend
        ├── utils.js         ← Format tiền, sinh text toa
        └── components/
            ├── OrderForm.jsx   ← Form tạo/sửa toa
            ├── OrderList.jsx   ← Danh sách toa
            └── Reports.jsx     ← Báo cáo thống kê
```

---

## Lưu ý quan trọng

### Sync khách hàng
Mặc định sync từ bảng `AccountObject` của MISA với `ObjectType IN (1,3)`.
Nếu không ra dữ liệu, kiểm tra lại bằng SSMS:
```sql
SELECT TOP 5 * FROM AccountObject WHERE ObjectType IN (1,3);
```
Nếu tên bảng khác, sửa trong `backend/src/sync.js` hàm `syncCustomers()`.

### Giá vốn
Giá vốn lấy `MAX(MainUnitPrice)` từ `InventoryLedger` — là giá nhập cao nhất
trong lịch sử, dùng để tham khảo khi báo giá. Không phải giá vốn bình quân
chính xác của MISA nhưng đủ dùng cho mục đích lập toa.

### Backup
Nên backup `ToaHangDB` hàng đêm bằng SQL Server Agent hoặc chạy thủ công:
```sql
BACKUP DATABASE [ToaHangDB]
TO DISK = N'D:\Backup\ToaHangDB_' + CONVERT(VARCHAR,GETDATE(),112) + '.bak'
WITH COMPRESSION;
```

---

## Hướng dẫn sử dụng nhanh

1. **Tạo toa mới** → click "Tạo toa mới" → tìm khách hàng → thêm từng mặt hàng → Lưu
2. **Gửi Zalo** → click icon Copy (📋) ở danh sách → dán vào Zalo
3. **Hoàn thành toa** → click ✓ xanh
4. **Hủy toa** → click 🚫 đỏ (dữ liệu không bị xóa)
5. **Sync MISA thủ công** → click "Sync MISA" góc trên phải

---

## Tra mã / Mã ngoài V1

Phiên bản mới bổ sung màn hình hỗ trợ báo hàng theo luồng:

```text
Tra Alopart để lấy mã
→ dán mã vào Tra mã / Mã ngoài
→ tìm đúng mã, bí danh/tên cũ và mã gần giống
→ riêng mã 555: hiện mapping Aisin để người dùng chọn
→ xem toàn bộ lịch sử bán QLĐH và lọc khách trên header
→ xem tồn kho + giá nhập gần nhất đã cộng VAT
→ người dùng tự kiểm tra và quyết định giá báo
```

Điểm quan trọng:

- Không tự coi mã gần giống là cùng sản phẩm.
- Không tự quy đổi MK/KYB/OEM; chỉ mã 555 được quy đổi theo bảng mapping.
- Một mã 555 có nhiều kết quả thì người dùng phải chọn dựa trên Alopart/VIN.
- Có thể xác nhận mã cũ như `MI-004/MI004` thành bí danh của `HUB-MI-004`.
- Import catalog NCC bỏ qua `QLĐH`, `WIN`, `T7`, `NHÁP T7`; lịch sử QLĐH được import bằng chức năng riêng.

### Giá trên panel tồn kho

Panel Tra mã dùng endpoint tra tồn kho chính xác theo mã. Đơn giá được lấy từ **lần nhập mua gần nhất** trong `InventoryLedger`, nối `PUVoucherDetail` qua `RefDetailID` để lấy thuế suất:

```text
Giá hiển thị = UnitPrice × (1 + VATRate / 100)
```

Chỉ lấy dòng có `InwardQuantity > 0`. Đây là **giá nhập gần nhất đã gồm VAT**, không phải giá vốn bình quân tồn kho và không phải `MAX(MainUnitPrice)` trong `product_cache`.

Tài liệu đầy đủ:

```text
../HANDOVER_TRA_MA_V1.md
../DEPLOY_VPS_TRA_MA_V1.md
```
