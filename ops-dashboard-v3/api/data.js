const { fetchSnapshot, SourceError } = require('../lib/sheets.cjs');
const { createHash } = require('node:crypto');

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

function createHandler(load=fetchSnapshot,now=Date.now) {
let pending, lastSnapshot, scope;
return async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if (req.method!=='GET') return res.status(405).json({code:'METHOD_NOT_ALLOWED',error:'GET 요청만 지원합니다.'});
  if (!authorized(req)) return res.status(401).json({code:'UNAUTHORIZED',error:'대시보드 인증이 필요합니다.',redirect:'/api/auth'});
  const currentScope=createHash('sha256').update(JSON.stringify([process.env.DASHBOARD_TOKEN,
    process.env.GOOGLE_OAUTH_CLIENT_ID,process.env.GOOGLE_OAUTH_REFRESH_TOKEN,process.env.GOOGLE_CLIENT_EMAIL,
    new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date(now()))])).digest('hex');
  if (scope!==currentScope) { scope=currentScope; pending=null; lastSnapshot=null; }
  try {
    if (!pending) pending=load().finally(()=>{pending=null;});
    const snapshot=await pending;
    lastSnapshot=snapshot;
    return res.status(200).json(snapshot);
  } catch(error) {
    const known = error instanceof SourceError;
    const recoverable=known && ['SOURCE_TIMEOUT','SOURCE_READ_FAILED','SOURCE_CHANGED','SOURCE_PARTIAL_PENDING',
      'SOURCE_BUILD_FAILED','SOURCE_AUDIT_FAILED','SOURCE_QUALITY_PENDING'].includes(error.code);
    if (recoverable && lastSnapshot && now()-Date.parse(lastSnapshot.fetchedAt)<24*60*60*1000) {
      return res.status(200).json({...lastSnapshot,delivery:{mode:'cached',reason:error.message,code:error.code}});
    }
    return res.status(known ? error.status : 503).json({code:known ? error.code : 'SOURCE_UNAVAILABLE',
      error:known ? error.message : '시트 연결이 지연되고 있습니다. 잠시 후 다시 시도하세요.'});
  }
};
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
