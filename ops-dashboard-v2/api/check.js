// api/check.js — 쿠키 유효성 확인 엔드포인트
function parseCookie(str) {
  const out = {};
  (str || '').split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  });
  return out;
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
  if (!DASHBOARD_TOKEN) {
    return res.status(200).json({ ok: true });
  }

  const cookieKey = process.env.COOKIE_KEY || 'ds_auth';
  const cookie = parseCookie(req.headers.cookie);
  if (cookie[cookieKey] === DASHBOARD_TOKEN) {
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ ok: false, redirect: '/api/auth' });
};
