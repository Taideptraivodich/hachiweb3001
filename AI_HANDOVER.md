# AI HANDOVER — Bảng công nợ gửi khách

> Lưu ý: file này KHÔNG tồn tại sẵn trong repo lúc bắt đầu phiên này (đã kiểm tra
> toàn bộ repo, không thấy AI_HANDOVER.md ở bất kỳ đâu, kể cả các commit cũ).
> File này được tạo mới ở phiên này. Từ giờ nên commit file này vào repo để
> phiên sau đọc được.

---

## Trạng thái xác minh lại đầu phiên (đọc trực tiếp từ code, không suy theo lời kể)

```text
Import file nguồn:        đã hoạt động (XLSX.read trong BangCongNo.jsx)
Bảng nháp editable:       đã hoạt động
Lưu/mở draft:             đã hoạt động (CRUD đầy đủ trong bang_cong_no.js)
Lấy dữ liệu MISA:         đã có (fetchMisaData, gọi /congno/chi-tiet + /congno/tong-hop)
Export Excel (gửi khách): CHƯA CÓ — không có route export nào ở backend,
                          không có hàm/nút export nào ở frontend.
                          (XLSX trong frontend chỉ dùng để ĐỌC file nguồn lúc import,
                          không có chỗ nào tạo file Excel để xuất ra.)
Export ảnh / clipboard:   CHƯA CÓ (trước phiên này)
Gợi ý đối trừ thanh toán: CHƯA CÓ (trước phiên này)
```

→ Đã điều chỉnh kế hoạch theo yêu cầu của user: làm **Phase 3 (đối trừ) trước**,
**Export Excel + Export ảnh/clipboard làm chung 1 lượt ở phiên sau**.

---

## Đã làm trong phiên này: Phase 3 — Gợi ý đối trừ thanh toán

### File đã sửa
```text
toa-hang/frontend/src/components/BangCongNo.jsx
```
Không sửa backend (`bang_cong_no.js`) vì `allocations` đã có sẵn trong
`draft_json` (key generic, lưu/đọc qua JSON blob), không cần thêm cột DB hay
route mới.

### Logic đã implement
- `buildDebtQueue(draft)` — danh sách khoản nợ theo đúng thứ tự ưu tiên:
  đầu kỳ → phát sinh (ngày tăng dần) → điều chỉnh tăng (ngày tăng dần).
- `buildPaymentQueue(draft)` — danh sách thanh toán theo ngày tăng dần.
- `generateAllocationSuggestions(draft)` — thuật toán FIFO:
  - Giữ nguyên các allocation có status `accepted`/`manual`/`ignored`.
  - Xoá các allocation `suggested` cũ.
  - Tính phần còn lại của từng khoản nợ / khoản thanh toán sau khi trừ phần
    đã `accepted`/`manual` (KHÔNG trừ phần `ignored`, vì bỏ qua gợi ý nghĩa là
    số tiền đó vẫn "tự do" để được gợi ý lại ở nơi khác).
  - Chạy FIFO: thanh toán theo ngày tăng dần, cấn vào khoản nợ theo đúng thứ
    tự ưu tiên, có thể 1 thanh toán chia nhiều dòng allocation nếu nợ cũ
    không đủ phủ hết số tiền thanh toán đó.
- Không có chỗ nào tự xoá/ẩn dòng nợ gốc — đúng yêu cầu "chỉ gợi ý, không tự xoá".

### Cấu trúc allocation (đúng spec)
```json
{
  "id": "al_xxx",
  "payment_id": "tt_xxx",
  "target_type": "dau_ky | phat_sinh | dieu_chinh",
  "target_id": "...",
  "amount": 5000000,
  "status": "suggested | accepted | ignored | manual"
}
```

### UI đã thêm
- Section mới **"🔗 Gợi ý đối trừ thanh toán"** (component `DoiTruSection`),
  đặt sau phần Điều chỉnh, trước phần Đối chiếu MISA.
  - Bảng: Khoản thanh toán | Gợi ý cấn vào | Số tiền | Trạng thái | Hành động.
  - Nút **"Tạo gợi ý đối trừ"** → gọi `generateAllocationSuggestions`.
  - Hành động mỗi dòng: **Chấp nhận** / **Bỏ qua** / **Chỉnh tay**
    (Chỉnh tay cho sửa cả khoản nợ đích và số tiền, sau khi lưu set
    `status = 'manual'`).
- Highlight nhẹ (nền vàng nhạt `#fffbe6`) cho:
  - Dòng đầu kỳ có allocation đang active (không phải `ignored`).
  - Dòng phát sinh có allocation đang active.
  - Dòng thanh toán có allocation đang active.
- Hiển thị thêm (không xoá dòng gốc, chỉ hiển thị động):
  - "Đã đối trừ: ... · Còn lại: ..." dưới mỗi dòng nợ có allocation đã
    `accepted`/`manual`.
  - Badge "Đã thanh toán đủ" khi `remaining_amount = 0`.
  - "Đã đối trừ: ..." dưới mỗi dòng thanh toán có allocation đã chốt.

### Lưu/mở draft
`allocations` nằm trong `draft.allocations`, được gửi nguyên trong
`draft_json` ở `saveDraft()` và đọc lại nguyên trong `loadDraft()` — không
cần sửa gì thêm, đã tự động giữ lại khi lưu/mở lại draft.

---

## Test đã chạy

```text
✅ npx vite build      → build thành công, không lỗi cú pháp/compile
✅ npx eslint           → các lỗi báo ra đều là lỗi CŨ có từ trước phiên này
                          (useRef/useCallback/Badge/Alert/Divider/Table/
                          EditOutlined/CloseCircleOutlined unused,
                          2 warning react-hooks/set-state-in-effect ở
                          EditableCell và DraftListModal — không liên quan
                          đến thay đổi của phiên này)
```

### Chưa test được trong phiên này (cần làm thủ công trên máy có MISA/DB thật)
```text
☐ Import file nguồn → Mở khách có phát sinh → Lấy dữ liệu MISA →
  Bấm "Tạo gợi ý đối trừ" → kiểm tra thanh toán cấn vào nợ cũ trước (FIFO)
☐ Chấp nhận 1 allocation, Bỏ qua 1 allocation
☐ Lưu draft → Mở lại draft → allocations còn nguyên
```
Lý do chưa test được: sandbox không có MISA pool / DB thật của user, chỉ
verify được bằng build + đọc logic. Cần user tự test case thực tế ở máy có
dữ liệu MISA.

---

## Bug còn lại / điểm cần lưu ý

- Chưa test thực tế với dữ liệu thật (xem mục Test trên).
- File `toa-hang/backend/src.rar`, file rác `console.log('test` và `{` ở
  `toa-hang/backend/` — không phải do phiên này tạo ra, có sẵn trong repo từ
  trước. Không động vào (ngoài phạm vi phiên này) nhưng nên dọn ở phiên khác.
- `EMPTY_DRAFT.meta` có field `customer_name/period_from/period_to/title`
  nhưng `meta` state ở component dùng field khác (`ten_kh/tu_ngay/den_ngay/
  tieu_de`) — 2 schema field không khớp nhau, hiện tại không gây lỗi vì
  `meta` trong `draft_json` chỉ là chỗ chứa thêm cho an toàn, nhưng nên thống
  nhất ở phiên dọn code sau (không phải scope phiên này, chỉ note lại).

---

## Phase tiếp theo

```text
Phase 6 gộp: Export Excel (gửi khách) + Export ảnh / copy clipboard Zalo
```
Cả 2 nên làm cùng lúc vì:
- Export Excel cần dựng đúng layout giống file mẫu "Ô TÔ CHÚ TÁM" (tiêu đề →
  bảng phát sinh theo ngày có subtotal → Tổng → Đầu kỳ → Thanh toán → Công nợ
  còn phải thanh toán).
- Export ảnh/clipboard nên chụp đúng vùng có cùng nội dung/layout với bản
  Excel gửi khách, nên dễ làm chung 1 lượt để đảm bảo 2 bản nhất quán với
  nhau.

Gợi ý vùng cần làm ở phiên sau:
```text
- Backend: thêm route export Excel (dùng exceljs hoặc xlsx để build file
  theo đúng layout mẫu, áp dụng allocations đã accepted để show "đã đối trừ"
  nếu cần, nhưng KHÔNG ẩn dòng nợ trừ khi user chọn ẩn — đúng nguyên tắc đã
  giữ ở Phase 3).
- Frontend: nút "Export Excel" / "Tải file gửi khách".
- Frontend: nút "Copy ảnh gửi Zalo" + "Tải ảnh PNG" (html2canvas hoặc tương
  đương), chỉ chụp đúng vùng bảng gửi khách, có fallback khi Clipboard API
  lỗi.
```
