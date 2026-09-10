const { fetchSnapshot } = require('../lib/sheets.cjs');

function authorized(req) {
  const expected=process.env.DASHBOARD_TOKEN;
  if (!expected) return false;
  const key=process.env.COOKIE_KEY || 'ds_auth';
  try {
    const cookies=Object.fromEntries(String(req.headers.cookie||'').split(';').map(part=>{
      const [name,...value]=part.trim().split('='); return [name,decodeURIComponent(value.join('='))];
    }));
    return cookies[key]===expected;
  } catch { return false; }
}

let pending;
module.exports=async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if (req.method!=='GET') return res.status(405).json({code:'METHOD_NOT_ALLOWED',error:'GET 요청만 지원합니다.'});
  if (!authorized(req)) return res.status(401).json({code:'UNAUTHORIZED',error:'대시보드 인증이 필요합니다.',redirect:'/api/auth'});
  try {
    // Coalesce concurrent requests, but never keep a snapshot across refreshes.
    if (!pending) pending=fetchSnapshot().finally(()=>{pending=null;});
    return res.status(200).json(await pending);
  } catch(error) {
    return res.status(error.status||503).json({code:error.code||'SOURCE_UNAVAILABLE',
      error:error.code ? error.message : '시트 연결이 지연되고 있습니다. 잠시 후 다시 시도하세요.'});
  }
};
