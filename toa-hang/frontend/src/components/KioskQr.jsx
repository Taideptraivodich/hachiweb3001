import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Typography, Spin } from 'antd';

const { Title, Text } = Typography;

// Không dùng axios instance chính (api.js) vì endpoint này public, không cần
// và không nên gắn JWT admin — máy kiosk đặt ở cổng, không đăng nhập.
async function fetchQr() {
  const res = await fetch('/api/kiosk/qr');
  if (!res.ok) throw new Error('Không lấy được mã QR');
  return res.json();
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function KioskQr() {
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef(null);

  async function refresh() {
    try {
      const data = await fetchQr();
      setQr(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // Poll mỗi 30s — đủ nhanh để màn hình tự cập nhật đúng lúc token đổi
    // lúc 0h/12h mà không tạo tải liên tục lên server.
    pollRef.current = setInterval(refresh, 30000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(pollRef.current); clearInterval(tick); };
  }, []);

  const expiresAt = qr ? new Date(qr.expires_at.replace(' ', 'T')).getTime() : null;
  const remaining = expiresAt ? expiresAt - now : null;

  // Nếu đồng hồ đã qua mốc hết hạn hiển thị (vd server rotate chậm hơn vài giây
  // so với poll gần nhất), chủ động refresh sớm thay vì đứng yên ở 00:00:00.
  useEffect(() => {
    if (remaining !== null && remaining <= 0) refresh();
  }, [remaining]);

  return (
    <div style={{
      minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#0b1220',
      color: '#fff', textAlign: 'center', padding: 24, boxSizing: 'border-box',
    }}>
      <Title style={{ color: '#fff', marginBottom: 4 }} level={2}>Quét mã để chấm công</Title>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 16 }}>
        Mở app Chấm công Hachi trên điện thoại và quét mã bên dưới
      </Text>

      <div style={{
        background: '#fff', borderRadius: 24, padding: 32, marginTop: 32,
        boxShadow: '0 0 60px rgba(255,255,255,0.08)',
      }}>
        {qr ? (
          <QRCodeSVG value={qr.token} size={360} level="M" />
        ) : (
          <div style={{ width: 360, height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin size="large" />
          </div>
        )}
      </div>

      {error && (
        <Text style={{ color: '#ff7875', marginTop: 16, fontSize: 16 }}>{error} — đang thử lại...</Text>
      )}

      {qr && (
        <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 24, fontSize: 15 }}>
          Mã sẽ tự đổi sau: <strong style={{ color: '#fff' }}>{formatCountdown(remaining)}</strong>
        </Text>
      )}
    </div>
  );
}
