#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/hachiweb3001/toa-hang}"
PM2_NAME="${PM2_NAME:-toa-hang}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$APP_DIR")/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

[[ -d "$APP_DIR/backend" && -d "$APP_DIR/frontend" ]] || { echo "❌ Không thấy app tại $APP_DIR"; exit 1; }
mkdir -p "$BACKUP_DIR"

if [[ -f "$APP_DIR/backend/data/toa-hang.db" ]]; then
  cp -a "$APP_DIR/backend/data/toa-hang.db" "$BACKUP_DIR/toa-hang-$STAMP.db"
  echo "✅ Backup DB: $BACKUP_DIR/toa-hang-$STAMP.db"
fi
if [[ -f "$APP_DIR/backend/.env" ]]; then
  cp -a "$APP_DIR/backend/.env" "$BACKUP_DIR/backend-env-$STAMP"
fi

node --check "$APP_DIR/backend/src/routes/ma_ngoai.js"
node --check "$APP_DIR/backend/src/setup.js"

(cd "$APP_DIR/backend" && npm ci --no-audit --no-fund)
(cd "$APP_DIR/frontend" && npm ci --no-audit --no-fund)
(cd "$APP_DIR/backend" && npm run test:code-search)
(cd "$APP_DIR/frontend" && npm run build)

(cd "$APP_DIR/backend" && node - <<'NODE'
const { setupDatabase } = require('./src/setup');
setupDatabase().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
NODE
)

pm2 restart "$PM2_NAME" --update-env
sleep 2
curl -fsS http://127.0.0.1:3001/api/health && echo

echo "✅ Deploy V2.1 hoàn tất"
echo "➡️ Import lại ABCXYZ.xlsx để cập nhật QLĐH + WIN + catalog NCC"
