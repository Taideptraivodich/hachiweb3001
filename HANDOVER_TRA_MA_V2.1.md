# Handover Tra mã V2.1 — Tích hợp sheet WIN

## Luồng import thống nhất

Tại **Tra mã / Mã ngoài → Quản lý mã & import**, nút:

`Import ABCXYZ (QLĐH + WIN + NCC)`

Một lần upload sẽ chạy trong cùng transaction:

1. `QLĐH` → thay toàn bộ bảng `sales_history`.
2. `WIN` → thay toàn bộ bảng `win_inventory`.
3. Các sheet Daisin/Tokico/Advics/Rotuyn... → upsert vào `ma_ngoai`.
4. `Sheet1`, `T7`, `NHÁP T7` → bỏ qua.
5. Nếu một phần lỗi, toàn bộ import rollback.

## Sheet WIN được hiểu thế nào

- Cột A: mã WIN, ví dụ `40IB001`.
- Tên hàng: dùng để tìm thêm mã hãng nằm trong mô tả, ví dụ `C 2275` → alias `C2275`.
- Giá thùng, giá lẻ, giá Hachi: sheet đang ghi theo đơn vị nghìn; importer quy đổi `227` thành `227.000`.
- `CÒN LẠI`: tồn kho Win Win hiện tại.
- WIN là nguồn kho riêng, không cộng vào tồn MISA của công ty.

## UX tra cứu

Panel bên phải hiển thị hai nguồn tách biệt:

- **Tồn kho công ty:** lấy từ endpoint tồn kho/MISA; đơn giá là lần nhập gần nhất đã cộng VAT.
- **Kho Win Win:** hiển thị mã WIN, tồn còn lại, giá Hachi, giá lẻ, giá thùng và lý do khớp.

Kết quả WIN có độ khớp dưới mức chắc chắn chỉ là tham khảo. Người dùng phải đối chiếu mô tả/mã trước khi báo hàng.

## Cấu trúc DB mới

Bảng `win_inventory`:

- `ma_win`, `ma_win_norm`
- `ten_hang`
- `gia_thung`, `gia_le`, `gia_hachi`
- `dvt`
- `sl_ban_dau`, `so_luong`, `nhap_them`, `tong_ban`, `con_lai`
- `aliases_json`
- `imported_at`, `updated_at`

## Kiểm thử với ABCXYZ.xlsx

- QLĐH: 11.976 dòng.
- WIN: 265 mã.
- Mẫu `40IB001`: tên `C 2275 Toyota Innova 2006 - 2016`, còn 2 bộ, alias `C2275`.
- Frontend production build thành công.
- Backend syntax check thành công.

## Các điểm còn tồn đọng

- Cache offline tồn kho công ty chưa ổn định; chưa sửa toàn diện.
- Mapping giữa WIN và mã kho công ty hiện dựa vào exact/alias/fuzzy, chưa có bảng xác nhận riêng.
- Chưa có lịch sử phiên bản tồn WIN theo từng lần import.
- Chưa có diff giữa file WIN mới và cũ.
- Chưa phân quyền người được xác nhận alias/mapping.
