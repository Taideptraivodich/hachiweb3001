#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/hachiweb3001/toa-hang}"
PM2_NAME="${PM2_NAME:-}"
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$APP_DIR")/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "$APP_DIR/backend" || ! -d "$APP_DIR/frontend" ]]; then
  echo "❌ Không tìm thấy app tại: $APP_DIR"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

if [[ -f "$APP_DIR/backend/data/toa-hang.db" ]]; then
  cp -a "$APP_DIR/backend/data/toa-hang.db" "$BACKUP_DIR/toa-hang-$STAMP.db"
  echo "✅ Backup DB: $BACKUP_DIR/toa-hang-$STAMP.db"
fi
if [[ -f "$APP_DIR/backend/.env" ]]; then
  cp -a "$APP_DIR/backend/.env" "$BACKUP_DIR/backend-env-$STAMP"
  echo "✅ Backup .env: $BACKUP_DIR/backend-env-$STAMP"
fi

echo "🔎 Kiểm tra cú pháp backend..."
node --check "$APP_DIR/backend/src/routes/ma_ngoai.js"
node --check "$APP_DIR/backend/src/routes/tonkho.js"
node --check "$APP_DIR/backend/src/setup.js"
node --check "$APP_DIR/backend/src/utils/codeSearch.js"

if [[ "$SKIP_INSTALL" != "1" ]]; then
  echo "📦 Cài backend dependencies..."
  (cd "$APP_DIR/backend" && npm ci --no-audit --no-fund)

  echo "📦 Cài frontend dependencies..."
  (cd "$APP_DIR/frontend" && npm ci --no-audit --no-fund)
fi

echo "🧪 Chạy test tìm mã..."
(cd "$APP_DIR/backend" && npm run test:code-search)

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "🔨 Build frontend..."
  (cd "$APP_DIR/frontend" && npm run build)
else
  if [[ ! -f "$APP_DIR/frontend/dist/index.html" ]]; then
    echo "❌ SKIP_BUILD=1 nhưng không có frontend/dist/index.html"
    exit 1
  fi
  echo "⏭️  Dùng frontend/dist đã build sẵn"
fi

echo "🗃️  Chạy migration SQLite..."
(
  cd "$APP_DIR/backend"
  node - <<'NODE'
const { setupDatabase } = require('./src/setup');
setupDatabase()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
NODE
)

if [[ -n "$PM2_NAME" ]]; then
  echo "🔁 Restart PM2: $PM2_NAME"
  pm2 restart "$PM2_NAME" --update-env
elif [[ -n "$SYSTEMD_SERVICE" ]]; then
  echo "🔁 Restart systemd: $SYSTEMD_SERVICE"
  systemctl restart "$SYSTEMD_SERVICE"
else
  echo "⚠️  Chưa truyền PM2_NAME hoặc SYSTEMD_SERVICE."
  echo "   Restart thủ công backend sau khi script kết thúc."
fi

sleep 2
if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  echo "✅ Health check thành công"
  curl -s http://127.0.0.1:3001/api/health
  echo
else
  echo "⚠️  Chưa health-check được cổng 3001. Kiểm tra process/log backend."
fi

echo "✅ Deploy hoàn tất"
