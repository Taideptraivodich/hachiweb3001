# HANDOVER — Tra mã / Mã ngoài V1

## 1. Mục tiêu nghiệp vụ

Phiên bản này biến màn hình **Mã ngoài** thành một công cụ hỗ trợ báo hàng, nhưng **không tự quyết định thay người dùng**.

Luồng chuẩn:

```text
Người bán hỏi hàng
  → Admin tra Alopart để xác định đúng xe/phụ tùng/mã
  → Dán mã 555 / MK / KYB / OEM / mã kho vào web
  → Web tìm đúng mã, bí danh/tên cũ và kết quả gần giống
  → Chỉ mã 555 được tự quy đổi sang mã Aisin/mã kho
  → Web gom toàn bộ lịch sử bán QLĐH
  → Có thể lọc khách ngay trên header bảng
  → Web tra tồn kho MISA và giá nhập gần nhất đã cộng VAT
  → Người dùng tự kiểm tra và quyết định giá báo
```

Nguyên tắc an toàn:

- Không tự chọn phụ tùng.
- Không tự coi kết quả gần giống là cùng sản phẩm.
- Không tự quyết giá bán.
- Không tự quy đổi MK/KYB/OEM sang mã khác; chỉ hiển thị mapping tham khảo nếu có.
- Nếu một mã 555 có nhiều mapping, bắt buộc người dùng chọn theo Alopart/VIN/ứng dụng xe.

---

## 2. Giao diện mới

Menu đổi từ **Mã ngoài** thành **Tra mã / Mã ngoài** và có 2 tab:

### Tab 1 — Tra cứu báo hàng

1. Ô tìm kiếm lớn nhận mọi loại mã.
2. Kết quả chia 3 nhóm:
   - Đúng mã.
   - Bí danh / tên cũ.
   - Gần giống — cần kiểm tra.
3. Mỗi kết quả giải thích lý do khớp.
4. Bảng lịch sử QLĐH có ô lọc trực tiếp trên header:
   - Mã hàng.
   - Mô tả.
   - Khách hàng.
   - Giá bán.
   - Nhà cung cấp.
5. Panel tồn kho nằm bên phải:
   - Tồn theo từng kho.
   - Tổng tồn.
   - Giá nhập gần nhất + VAT.
   - Giá gốc và VATRate.
   - Cảnh báo nếu đang dùng cache offline.
   - Giá NCC hiện hành từ catalog import, nếu có.
6. Cho phép xác nhận mã cũ/biến thể thành bí danh.

Ví dụ:

```text
Nhập: HUB-MI-004
Mã kho: HUB-MI-004
Lịch sử cũ tìm thấy: MI-004/MI004
Lý do: bỏ tiền tố HUB + chuẩn hóa dấu gạch
```

### Tab 2 — Quản lý mã & import

- Quản lý mapping mã ngoài ↔ mã kho.
- Phân loại mã: 555, MK, KYB, OEM, SAKURA, TOKICO...
- Lưu giá đại lý, giá thùng, SL/thùng, stock NCC.
- Import catalog Excel và xác nhận các dòng không khớp.

---

## 3. Logic tìm kiếm

File lõi:

```text
toa-hang/backend/src/utils/codeSearch.js
```

Các bước:

1. Chuẩn hóa chữ hoa.
2. Bỏ khoảng trắng và ký tự phân cách khi so sánh.
3. Tách ô chứa nhiều mã theo `/`, `;`, `,`, `=`, newline.
4. Thử bỏ tiền tố nhóm dạng `HUB-` khi phần còn lại có dạng mã.
5. Tính độ gần bằng Levenshtein.
6. Chỉ hiện kết quả fuzzy đủ ngưỡng; không tự xác nhận.

Mức ưu tiên:

```text
Trùng nguyên bản
→ Trùng sau chuẩn hóa
→ Bí danh đã xác nhận
→ Bỏ tiền tố nhóm
→ Chứa phần mã
→ Gần giống 1–2 ký tự
```

Test tự động:

```bash
cd toa-hang/backend
npm run test:code-search
```

---

## 4. Quy tắc theo loại mã

### Mã 555

```text
SR3880
  → tìm trong bảng ROTUYN / ma_ngoai
  → trả mã Aisin/mã kho
  → dùng mã Aisin để tra QLĐH và tồn kho
```

Nếu nhiều mã Aisin cùng map với mã 555, UI đánh dấu **Bạn phải chọn**.

### MK / KYB / OEM / mã khác

- Tìm trực tiếp đúng mã trong QLĐH.
- Không tự chuyển sang mã kho khác.
- Nếu database có mapping, mã kho chỉ hiện thành lựa chọn tham khảo.

---

## 5. Giá vốn trên panel tồn kho

Endpoint mới:

```text
GET /api/tonkho/lookup?ma_hang=...
```

Định nghĩa giá:

```text
Lần nhập mua gần nhất trong InventoryLedger
  LEFT JOIN PUVoucherDetail qua RefDetailID
  lấy VATRate
  đơn giá hiển thị = UnitPrice × (1 + VATRate / 100)
```

Điều kiện quan trọng:

```sql
ISNULL(il.InwardQuantity, 0) > 0
```

Nghĩa là chỉ lấy dòng nhập mua, không lấy dòng xuất/giá vốn COGS.

UI hiển thị riêng:

- `don_gia`: giá nhập đã cộng VAT.
- `don_gia_goc`: UnitPrice trước VAT.
- `don_gia_vat_rate`: VATRate.

Với QLĐH:

```text
Nhà CC = B11 và Giá vốn = 0
```

được hiển thị là **Kho B11**, không được hiểu là vốn bằng 0.

---

## 6. Import file ABCXYZ / catalog NCC

Import mapping bỏ qua các sheet:

```text
QLĐH, T7, NHÁP T7, WIN
```

Lý do:

- `QLĐH` là lịch sử bán, import riêng bằng chức năng **Import lịch sử Excel**.
- `WIN` là kho bố thắng riêng, chưa tích hợp trong V1.
- `T7` và `NHÁP T7` không dùng.

Các sheet catalog đã được nhận diện:

- TOKICO.
- CLUTCH SET.
- WATERPUMP.
- ADVICS.
- CYLINDER.
- OIL FILTER.
- ROTUYN T10.
- MITSUBOSHI.
- lọc số.
- Sheet1 nếu có dữ liệu mapping phù hợp.

Importer đọc được:

- Mã chuẩn/mã kho.
- Mã 555/MK/OEM/Sakura/Part No.
- Vị trí.
- Ứng dụng xe.
- Giá đại lý.
- Giá thùng.
- SL/thùng.
- Stock NCC.

Với ô nhiều mã như:

```text
C1147 / C1142
31470-12111\n31470-12140
```

hệ thống tách thành từng mapping riêng.

---

## 7. Database migration

Migration chạy tự động trong:

```text
toa-hang/backend/src/setup.js
```

Bảng mới:

```text
product_aliases
```

Các cột bổ sung vào `ma_ngoai`:

```text
ma_hang_norm
ma_ngoai_norm
loai_ma
gia_dai_ly
gia_thung
sl_thung
stock_ncc
trang_thai
updated_at
```

Các cột bổ sung vào `tonkho_cache`:

```text
don_gia_goc
don_gia_vat_rate
```

Trước khi deploy phải backup:

```text
backend/data/toa-hang.db
backend/.env
```

---

## 8. API mới

### Tìm mã

```http
GET /api/ma-ngoai/lookup?q=HUB-MI-004
```

### Lấy lịch sử QLĐH của kết quả đã chọn

```http
POST /api/ma-ngoai/lookup/detail
Content-Type: application/json

{
  "ma_hang": "HUB-MI-004",
  "history_codes": ["MI-004/MI004"]
}
```

### Xác nhận bí danh

```http
POST /api/ma-ngoai/aliases

{
  "ma_hang": "HUB-MI-004",
  "alias_raw": "MI-004/MI004",
  "loai_alias": "ten_cu_qldh",
  "nguon": "QLĐH"
}
```

### Tra tồn kho đúng mã

```http
GET /api/tonkho/lookup?ma_hang=JAJT-4005
```

---

## 9. File đã thay đổi

```text
backend/src/routes/ma_ngoai.js
backend/src/routes/tonkho.js
backend/src/setup.js
backend/src/utils/codeSearch.js            (mới)
backend/scripts/test-code-search.js         (mới)
backend/package.json

frontend/src/components/MaNgoai.jsx
frontend/src/App.jsx
frontend/package.json
frontend/package-lock.json
frontend/dist/*                             (đã build)
```

Đã xóa dependency `better-sqlite3` khỏi frontend vì không được dùng và dễ gây lỗi build native trên VPS.

---

## 10. Kiểm thử đã thực hiện

### Đã chạy thành công

```text
✅ node --check cho các file backend mới/sửa
✅ npm run test:code-search
✅ npm run build frontend
✅ Migration thử trên bản sao SQLite cũ
✅ API smoke test:
   - HUB-MI-004 tìm ra MI-004/MI004
   - mã 555 đổi sang mã Aisin
   - mã KYB được tìm trực tiếp, không tự đổi
   - lịch sử QLĐH lọc đúng
   - tồn kho cache trả giá gốc + VAT + giá sau VAT
✅ Import thử file ABCXYZ:
   - bỏ qua QLĐH/WIN/T7/NHÁP T7
   - đọc được ROTUYN, OIL FILTER, CYLINDER, ADVICS...
```

### Lint

File mới `MaNgoai.jsx` và thay đổi `App.jsx` lint sạch. Toàn project vẫn có nhiều lỗi lint cũ ở các component khác; không nằm trong scope V1.

---

## 11. Hạn chế / việc còn tồn đọng

### Ưu tiên cao

1. **Cache offline tồn kho chưa được sửa toàn diện.**
   - V1 chỉ bổ sung lưu giá gốc và VATRate.
   - Cần kiểm tra việc tạo snapshot nhiều kỳ, dữ liệu trùng và thời điểm sync.
2. **WIN chưa tích hợp vào panel tồn kho.**
3. **Chưa lưu lịch sử báo giá**, mới chỉ đọc lịch sử bán QLĐH.
4. **Chưa tích hợp Alopart API**, vẫn tra thủ công.
5. **Chưa có log tồn NCC theo thời hạn**, hiện chỉ đọc stock từ file import.
6. **Chưa có version lịch sử bảng giá NCC**; import hiện cập nhật giá hiện hành.
7. **Chưa có quyền phân vai** người được xác nhận bí danh/mapping.

### Kỹ thuật cũ cần lưu ý

- `product_cache` có thể bị ghi đè khi một mã tồn ở nhiều kho vì khóa hiện chỉ là `ma_hang`.
- Panel tồn kho mới không dùng `product_cache` làm nguồn cuối cùng; nó gọi trực tiếp `/tonkho/lookup` theo từng kho.
- Bundle frontend đang lớn; nên code-split ở phase sau.

---

## 12. Phase tiếp theo đề xuất

1. Import/đồng bộ kho WIN.
2. Lưu lịch sử báo giá và trạng thái: đã báo / chốt / không lấy.
3. Ghi nhận tồn NCC có thời hạn trong ngày.
4. Chuẩn hóa tên khách và gợi ý các khách tương tự.
5. Sửa cache offline tồn kho theo snapshot rõ ràng.
6. Chế độ Mentor: giải thích mã, phụ tùng, xe áp dụng và bài học từ ca thực tế.
