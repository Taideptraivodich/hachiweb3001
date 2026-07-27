# Deploy Tra mã V2.1

## 1. Upload gói deploy

```powershell
scp .\hachiweb3001-tra-ma-v2.1-deploy.tar.gz root@IP_VPS:/tmp/
ssh root@IP_VPS
```

## 2. Giải nén đè source

```bash
cd /var/www/hachiweb3001

tar -xzf /tmp/hachiweb3001-tra-ma-v2.1-deploy.tar.gz \
  -C /var/www/hachiweb3001
```

Gói deploy không chứa `.env` và database production.

## 3. Chạy deploy

Kiểm tra tên PM2:

```bash
pm2 list
```

Sau đó:

```bash
APP_DIR=/var/www/hachiweb3001/toa-hang \
PM2_NAME=toa-hang \
bash deploy_tra_ma_v2.1.sh
```

## 4. Import lại ABCXYZ.xlsx

Vào:

`Tra mã / Mã ngoài → Quản lý mã & import → Import ABCXYZ (QLĐH + WIN + NCC)`

Kết quả kỳ vọng với file đã cung cấp:

- 11.976 dòng QLĐH
- 265 mã WIN
- catalog NCC được cập nhật
