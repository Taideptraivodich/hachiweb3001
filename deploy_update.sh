#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Deploy/update script — Bảng công nợ (Phase 3: gợi ý đối trừ thanh toán)
# Chạy script này TRÊN VPS, sau khi đã copy file BangCongNo.jsx mới lên.
# Cách dùng: bash deploy_update.sh
# ─────────────────────────────────────────────────────────────────────────
set -e

APP_DIR="/var/www/hachiweb3001/toa-hang"
FRONTEND_DIR="$APP_DIR/frontend"

echo "📁 Vào thư mục frontend..."
cd "$FRONTEND_DIR"

echo "📦 Cài dependencies (nếu có gói mới)..."
npm install

echo "🔨 Build frontend..."
npm run build

echo "✅ Build xong: $FRONTEND_DIR/dist"
echo ""
echo "🔁 Đang restart backend..."

if command -v pm2 >/dev/null 2>&1 && pm2 list | grep -qi "online\|errored\|stopped"; then
  echo "→ Phát hiện pm2, danh sách process hiện tại:"
  pm2 list
  echo ""
  echo "⚠️  Script KHÔNG tự đoán tên process để tránh restart nhầm app khác."
  echo "   Chạy lệnh sau với đúng tên/ID process của app này:"
  echo "   pm2 restart <ten-hoac-id-process>"
elif systemctl list-units --type=service 2>/dev/null | grep -qi "toahang\|hachiweb"; then
  echo "→ Phát hiện systemd service, chạy:"
  echo "   systemctl restart <ten-service>"
  systemctl list-units --type=service | grep -i "toahang\|hachiweb"
else
  echo "⚠️  Không tự phát hiện được process manager (pm2/systemd)."
  echo "   Anh restart thủ công theo cách hiện đang chạy backend, ví dụ:"
  echo "   - pm2 restart <id>           (nếu dùng pm2)"
  echo "   - systemctl restart <name>   (nếu dùng systemd)"
  echo "   - pkill -f 'node index.js' && cd $APP_DIR/backend && nohup node index.js > app.log 2>&1 &  (nếu chạy tay)"
fi

echo ""
echo "🌐 Kiểm tra app còn sống chưa (sau khi đã restart):"
echo "   curl -s http://localhost:3001/api/health"
