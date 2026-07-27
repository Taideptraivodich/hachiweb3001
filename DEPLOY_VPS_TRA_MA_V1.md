# Deploy Tra mã / Mã ngoài V1 lên VPS

## Cách an toàn nhất: dùng gói deploy `.tar.gz`

### 1. Từ máy Windows, gửi file lên VPS

PowerShell:

```powershell
scp .\hachiweb3001-tra-ma-v1-deploy.tar.gz root@IP_VPS:/tmp/
```

### 2. SSH vào VPS

```bash
ssh root@IP_VPS
```

### 3. Giải nén source mới

Giả sử app hiện nằm ở:

```text
/var/www/hachiweb3001/toa-hang
```

Chạy:

```bash
cd /var/www/hachiweb3001
mkdir -p backups
cp -a toa-hang/backend/data/toa-hang.db "backups/toa-hang-$(date +%Y%m%d-%H%M%S).db"
cp -a toa-hang/backend/.env "backups/backend-env-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true

tar -xzf /tmp/hachiweb3001-tra-ma-v1-deploy.tar.gz -C /var/www/hachiweb3001
```

Gói deploy **không chứa** `backend/data/toa-hang.db` và `.env`, nên không ghi đè dữ liệu production.

### 4. Chạy script deploy

Nếu backend chạy bằng PM2:

```bash
cd /var/www/hachiweb3001
APP_DIR=/var/www/hachiweb3001/toa-hang \
PM2_NAME=toa-hang \
bash deploy_tra_ma_v1.sh
```

Thay `toa-hang` bằng tên process thật từ:

```bash
pm2 list
```

Nếu chạy bằng systemd:

```bash
cd /var/www/hachiweb3001
APP_DIR=/var/www/hachiweb3001/toa-hang \
SYSTEMD_SERVICE=toa-hang.service \
bash deploy_tra_ma_v1.sh
```

### 5. Kiểm tra

```bash
curl -s http://127.0.0.1:3001/api/health
pm2 logs toa-hang --lines 100
```

Mở web và kiểm tra:

```text
Tra mã / Mã ngoài
→ Tra cứu báo hàng
→ tìm một mã đã biết
```

---

## Deploy nhanh bằng Git

Sau khi bạn push code lên GitHub:

```bash
ssh root@IP_VPS
cd /var/www/hachiweb3001
git pull
APP_DIR=/var/www/hachiweb3001/toa-hang PM2_NAME=toa-hang bash deploy_tra_ma_v1.sh
```

---

## Chế độ VPS không có Internet/npm registry

Gói deploy đã có sẵn `frontend/dist`.

```bash
APP_DIR=/var/www/hachiweb3001/toa-hang \
PM2_NAME=toa-hang \
SKIP_INSTALL=1 \
SKIP_BUILD=1 \
bash deploy_tra_ma_v1.sh
```

Chỉ dùng cách này nếu `backend/node_modules` hiện tại đã đầy đủ và không đổi phiên bản dependency.

---

## Rollback

```bash
pm2 stop toa-hang
cp /var/www/hachiweb3001/backups/toa-hang-YYYYMMDD-HHMMSS.db \
   /var/www/hachiweb3001/toa-hang/backend/data/toa-hang.db
```

Sau đó khôi phục source commit cũ hoặc giải nén bản release cũ rồi:

```bash
pm2 restart toa-hang
```
