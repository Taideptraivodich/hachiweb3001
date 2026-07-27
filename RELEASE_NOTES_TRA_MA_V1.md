# Release notes — Tra mã / Mã ngoài V1

Ngày đóng gói: 2026-07-14

## Tính năng chính

- Một ô tìm mọi loại mã phụ tùng.
- Tìm chính xác, chuẩn hóa dấu, bí danh/tên cũ và gần đúng.
- Giải thích lý do khớp và phân nhóm mức tin cậy.
- Chỉ mã 555 được quy đổi sang Aisin/mã kho.
- Xem lịch sử bán QLĐH của toàn bộ khách.
- Lọc mã, mô tả, khách, giá và nhà cung cấp ngay trên header bảng.
- Xem tồn theo kho trên cùng màn hình.
- Giá nhập gần nhất đã gồm VAT từ MISA.
- Xem giá catalog NCC hiện hành.
- Xác nhận mã cũ thành bí danh dùng chung.
- Import nhiều sheet catalog Daisin, bỏ qua sheet không thuộc catalog.

## Kiểm thử

- Backend syntax check: đạt.
- Unit test tìm mã: đạt.
- Frontend build: đạt.
- ESLint riêng `MaNgoai.jsx` và `App.jsx`: đạt.
- Migration trên bản sao DB cũ: đạt.
- Smoke test API tìm mã/lịch sử/cache: đạt.
- Import thử `ABCXYZ.xlsx`: đạt.

## Chưa làm trong V1

- Chưa tích hợp kho WIN.
- Chưa sửa toàn diện cache offline.
- Chưa có lịch sử báo giá.
- Chưa tích hợp trực tiếp Alopart.
- Chưa lưu phiên bản lịch sử giá nhà cung cấp.
- Chưa có quyền duyệt mapping/bí danh.

Xem chi tiết tại `HANDOVER_TRA_MA_V1.md`.
