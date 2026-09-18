const { createSign, createHash } = require('node:crypto');

const SHEET_ID = '1QasrQPOZqq3ljxCXQWnGYEy40D8jhojJRFOWkVa6uxo';
const SOURCES = {
  summary: { gid:446178451, range:"'Summary'!A1:B60" },
  dataCheck: { gid:830227479, range:"'데이터 점검'!A1:F100" },
  coupon: { gid:2006396236, range:"'쿠폰 분석'!A1:AB140" },
  factMonthly: { gid:464978532, range:"'fact_monthly'!A1:CW100" },
  overallMonthly: { gid:863402866, range:"'_overall_monthly'!A1:CZ14" },
  ops: { gid:638953343, range:"'운영 인사이트'!A1:Z90" },
  usageQuality: { range:"'_ops_quality_usage_2026'!A1:R85" },
  usageQualityPrev: { range:"'_ops_quality_usage_2025'!A1:R85" },
  salesQuality: { range:"'_ops_quality_sales_2026'!A1:R85" },
  salesQualityPrev: { range:"'_ops_quality_sales_2025'!A1:R85" },
  cfg: { gid:1506888111, range:"'_cfg'!A1:B90" }
};

class SourceError extends Error {
  constructor(code, message, status=503) { super(message); this.code=code; this.status=status; }
}

function buildState(rows) {
  const cfg = Object.fromEntries((rows || []).filter(row => row[0]));
  const status = String(cfg.dashboard_build_status || '').toLowerCase();
  return { status, runId:String(cfg.dashboard_run_id || ''),
    version:String(cfg.dashboard_code_version || cfg.script_version || ''),
    pending:/^(running|pending|building|in_progress)$/.test(status),
    failed:/^(failed|error|aborted)$/.test(status) };
}

let tokenCache;
async function googleToken(env, fetchImpl) {
  const oauth=[env.GOOGLE_OAUTH_CLIENT_ID,env.GOOGLE_OAUTH_CLIENT_SECRET,env.GOOGLE_OAUTH_REFRESH_TOKEN];
  if (oauth.some(Boolean)) {
    if (!oauth.every(Boolean)) throw new SourceError('SOURCE_AUTH_REQUIRED','Google OAuth 서버 인증 설정이 일부 누락됐습니다.');
    const cacheKey=createHash('sha256').update(JSON.stringify(oauth)).digest('hex');
    if (tokenCache?.cacheKey===cacheKey && tokenCache.expires>Date.now()+60000) return tokenCache.token;
    const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'refresh_token',client_id:oauth[0],client_secret:oauth[1],refresh_token:oauth[2]}),
      signal:AbortSignal.timeout(10000)});
    const payload=await response.json();
    if (!response.ok || !payload.access_token) throw new SourceError('SOURCE_AUTH_INVALID',
      payload.error==='invalid_grant' ? 'Google 조회 승인이 만료되거나 취소됐습니다. 관리자 계정으로 다시 연결해야 합니다.' : 'Google OAuth 서버 인증에 실패했습니다.');
    const scopes=String(payload.scope||'').split(' ');
    const allowed=new Set(['https://www.googleapis.com/auth/spreadsheets.readonly','openid','email','https://www.googleapis.com/auth/userinfo.email']);
    if (!scopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly') || scopes.some(scope=>!allowed.has(scope)))
      throw new SourceError('SOURCE_AUTH_INVALID','Google OAuth 권한이 승인된 읽기 전용 범위와 다릅니다. 다시 연결해야 합니다.');
    tokenCache={cacheKey,token:payload.access_token,expires:Date.now()+Number(payload.expires_in||3600)*1000};
    return tokenCache.token;
  }
  const email=env.GOOGLE_CLIENT_EMAIL;
  const privateKey=env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new SourceError('SOURCE_AUTH_REQUIRED',
    'Google 시트 서버 인증이 설정되지 않았습니다. 배포 관리자에게 시트 연결 설정을 요청하세요.');
  if (tokenCache?.email === email && tokenCache.expires > Date.now()+60000) return tokenCache.token;
  const now=Math.floor(Date.now()/1000);
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:email,
    scope:'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const signer=createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  let signature;
  try { signature=signer.sign(privateKey,'base64url'); }
  catch { throw new SourceError('SOURCE_AUTH_INVALID','Google 시트 서버 인증 키 형식을 확인해야 합니다.'); }
  const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),
    signal:AbortSignal.timeout(10000)});
  const payload=await response.json();
  if (!response.ok || !payload.access_token) throw new SourceError('SOURCE_AUTH_INVALID','Google 시트 서버 인증에 실패했습니다.');
  tokenCache={email,token:payload.access_token,expires:Date.now()+Number(payload.expires_in||3600)*1000};
  return tokenCache.token;
}

async function readRanges(ranges, env, fetchImpl) {
  const token=await googleToken(env,fetchImpl);
  const url=new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet`);
  ranges.forEach(range=>url.searchParams.append('ranges',range));
  url.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');
  url.searchParams.set('dateTimeRenderOption','FORMATTED_STRING');
  let response;
  try {
    response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(45000)});
  } catch (error) {
    if (['TimeoutError','AbortError'].includes(error.name))
      throw new SourceError('SOURCE_TIMEOUT','Google 시트 응답이 지연되어 조회를 완료하지 못했습니다. 잠시 후 다시 시도하세요.');
    throw error;
  }
  if (!response.ok) throw new SourceError('SOURCE_READ_FAILED',
    response.status===403 ? 'Google 시트 읽기 권한 또는 Sheets API 사용 설정을 확인해야 합니다.' : 'Google 시트 조회에 실패했습니다. 잠시 후 다시 시도하세요.');
  const payload=await response.json();
  if (payload.valueRanges?.length !== ranges.length) throw new SourceError('SOURCE_INCOMPLETE','일부 원천 범위가 응답에서 누락됐습니다.');
  return payload.valueRanges.map(item=>item.values||[]);
}

async function fetchSnapshot({env=process.env,fetchImpl=fetch}={}) {
  const before=buildState((await readRanges([SOURCES.cfg.range],env,fetchImpl))[0]);
  if (!before.status || !before.runId) throw new SourceError('SOURCE_STATE_MISSING','시트 생성 상태를 확인할 수 없어 갱신을 보류합니다.');
  if (before.pending || before.failed) throw new SourceError(before.failed?'SOURCE_BUILD_FAILED':'SOURCE_BUILD_PENDING',
    before.failed?'원천 시트 생성이 실패했습니다. 마지막 정상 화면을 유지합니다.':'원천 시트를 재생성 중입니다. 완료 후 자동으로 다시 조회합니다.');
  if (!['complete','completed','success','done'].includes(before.status))
    throw new SourceError('SOURCE_STATE_MISSING','시트 생성 완료 상태를 확인할 수 없어 갱신을 보류합니다.');
  const keys=Object.keys(SOURCES);
  const values=await readRanges(keys.map(key=>SOURCES[key].range),env,fetchImpl);
  const after=buildState((await readRanges([SOURCES.cfg.range],env,fetchImpl))[0]);
  if (after.pending || after.failed || before.runId!==after.runId || before.status!==after.status)
    throw new SourceError('SOURCE_CHANGED','조회 중 원천 시트가 변경되어 갱신을 보류했습니다. 다음 조회에 다시 반영합니다.');
  const sheets=Object.fromEntries(keys.map((key,index)=>[key,values[index]]));
  const captured=buildState(sheets.cfg);
  if (captured.status!==before.status || captured.runId!==before.runId)
    throw new SourceError('SOURCE_CHANGED','조회 중 원천 실행본이 변경되어 갱신을 보류했습니다.');
  const cfg=Object.fromEntries(sheets.cfg || []);
  if (cfg.dashboard_audit_run_id !== before.runId || String(cfg.dashboard_audit_blocking ?? '').trim() === '' ||
      !Number.isFinite(Number(cfg.dashboard_audit_blocking)))
    throw new SourceError('SOURCE_AUDIT_PENDING','현재 원천 실행본의 최종 점검이 완료되지 않아 갱신을 보류합니다.');
  if (Number(cfg.dashboard_audit_blocking)>0)
    throw new SourceError('SOURCE_AUDIT_FAILED','원천 시트의 차단 오류가 남아 있어 갱신을 보류합니다.');
  for (const key of ['usageQuality','usageQualityPrev','salesQuality','salesQualityPrev']) {
    const rows = sheets[key];
    const runColumn = rows?.[0]?.indexOf('실행본');
    if (runColumn < 0 || rows?.[1]?.[runColumn] !== before.runId || !rows?.[0]?.includes('품질상태'))
      throw new SourceError('SOURCE_QUALITY_PENDING','일별 원천 품질표가 현재 실행본과 일치하지 않아 갱신을 보류합니다.');
  }
  if (!sheets.factMonthly?.[0]?.includes('월번호') || !sheets.overallMonthly?.[0]?.includes('월번호'))
    throw new SourceError('SOURCE_SCHEMA_CHANGED','공식 월별 원천의 필수 열을 찾지 못했습니다.');
  return {schemaVersion:1,sheetId:SHEET_ID,fetchedAt:new Date().toISOString(),build:after,sheets};
}

module.exports={SHEET_ID,SOURCES,SourceError,buildState,fetchSnapshot};
