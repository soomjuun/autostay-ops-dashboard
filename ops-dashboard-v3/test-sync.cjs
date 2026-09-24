const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, verify } = require('node:crypto');
const { createDashboardApi } = require('./validate-live.cjs');
const { fetchSnapshot, SOURCES } = require('./lib/sheets.cjs');

const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date());
const month=Number(date.split('-')[1]);
const year=Number(date.split('-')[0]);
const day=n=>`${year}-${String(month).padStart(2,'0')}-${String(n).padStart(2,'0')}`;
function fact(overrides={}) {
  const row={분기:`Q${Math.ceil(month/3)}`,월번호:month,월라벨:`${month}월`,매장:'일산',Capacity:3000,목표매출:30000,
    최신매출일_2026:day(9),최신매출일_2025:day(9).replace(String(year),String(year-1)),
    최신구독일_2026:day(7),최신구독일_2025:day(7).replace(String(year),String(year-1)),
    총매출_2026:9000,순매출_2026:8500,환불_2026:500,총사용_2026:700,
    유지_2026:100,유지_2025:80,신규_2026:2,해지_2026:7,순증감_2026:-5,
    단일구독매출_2026:6000,매장PASS_ARPU_2026:999,
    MRR_2026:5000,MRR_2025:4000,ARR_2026:60000,경과일수_2026:9,월일수_2026:30,MTD_Capacity_2026:900,
    운영기여매출_2026:9500,올패스운영귀속매출_2026:1500,...overrides};
  return [Object.keys(row),Object.values(row)];
}
function apiWithDates() {
  const api=createDashboardApi();
  api.setSourceSnapshot({sheets:{cfg:[['usage_local_latest_date',day(7)]]}});
  return api;
}

test('moved Summary rows, real zero flows and additional contribution metrics',()=>{
  const api=createDashboardApi();
  const rows=Array.from({length:16},()=>['']);
  rows.push(['전체 순매출 성장(안성 포함)','8.0%'],['누적 신규 / 누적 해지 / 최근 유지(구독 건)','0 / 0 / 100'],
    ['누적 운영기여매출(환불 전)','9,500원'],['H1 KPI'],['전체 순매출 성장(안성 포함)','99%']);
  const result=api.parseSummary(rows);
  assert.equal(result.totalNetGrowth,8); assert.equal(result.totalNewSubs,0); assert.equal(result.contributionRevenue,9500);
});
test('completed build and informational statuses do not become pending warnings',()=>{
  const api=createDashboardApi();
  const result=api.parseDataQuality([['점검 항목','상태','기준/값'],['대시보드 빌드 상태','정상','완료','빌드 실행 완료'],
    ['검증 범위','확인','핵심'],['실행 방식','안내','단계별'],['매출 최신일','정상','2026-09-09']]);
  assert.equal(result.sourceCheckPending,false); assert.equal(result.warnings.length,0);
  assert.equal(result.salesLatestDate.getDate(),9);
  assert.equal(api.isSourceCheckPending({name:'대시보드 빌드 상태',status:'진행 중'}),true);
});
test('subscription exposure uses its own date and mismatched ARPU stays null through aggregation',()=>{
  const api=apiWithDates(); const row=api.parseFactMonthly(fact()).get('일산')[0];
  assert.ok(Math.abs(row.retainedExposure-100*7/30)<1e-9);
  assert.ok(Math.abs(row.churn-30)<1e-9);
  assert.equal(row.arpu,null); assert.equal(row.hasArpwData,false);
  const summary=api.aggMonths([row]); assert.equal(summary.arpu,null);
  assert.equal(summary.contributionRevenue,9500); assert.equal(summary.allPassAttributedRevenue,1500);
  assert.equal(summary.subscriptionLagged,true);
});
test('missing subscription source remains null and unaligned previous dates disable comparisons',()=>{
  const api=apiWithDates();
  const row=api.parseFactMonthly(fact({최신구독일_2026:'',최신매출일_2025:''})).get('일산')[0];
  for(const key of ['mrr','retained','newSubs','churn','arpu']) assert.equal(row[key],null,key);
  assert.equal(api.aggMonths([row]).hasNetYoY,false);
  assert.equal(api.sourceDateKey(46274),'2026-09-09');
});
test('canonical portfolio cannot refill intentionally blank ARPU',()=>{
  const api=apiWithDates(); const rows=fact();
  const store={name:'일산',months:api.parseFactMonthly(rows).get('일산')};
  const portfolio=api.aggregatePortfolioMonths([store]);
  api.applyPortfolioFinancials(portfolio,rows,[]);
  assert.equal(portfolio.find(m=>m.monthNum===month).arpu,null);
});
test('zero coupon amount is a received value, not missing',()=>{
  const api=createDashboardApi();
  const months=[{gross:100,monthNum:1}];
  api.applyPortfolioCouponDiscounts(months,[['쿠폰할인금액',0,0,0,0]]);
  assert.equal(months[0].hasDiscountData,true); assert.equal(months[0].discountShare,0);
});

test('compact Summary monetary units retain won scale',()=>{
  const api=createDashboardApi();
  const summary=api.parseSummary([['누적 운영기여매출(환불 전)','47.75억원']]);
  assert.equal(summary.contributionRevenue,4775000000);
});

test('numeric cumulative Summary amounts follow declared units without scaling percentages or stocks',()=>{
  const api=createDashboardApi();
  const rows=[['단위/결측 안내','누적 금액: 억원. 월별 금액: 백만원. 상세: 원, 회, 건, %.'],
    ['누적 운영기여매출(환불 전)',48.79354563],['누적 올패스 운영귀속매출(환불 전)',7.88960243],
    ['누적 목표매출','45.83억원'],['누적 순매출 달성률(대표)',0.934],['MRR',494885950]];
  const value=api.parseSummary(rows);
  assert.ok(Math.abs(value.contributionRevenue-4879354563)<0.01);
  assert.ok(Math.abs(value.allPassAttributedRevenue-788960243)<0.01);
  assert.equal(value.totalTarget,4583000000); assert.equal(value.achievement,93.4);
  assert.equal(value.totalMrr,494885950);
  assert.equal(api.parseSummary([['누적 운영기여매출(환불 전)',9500]]).contributionRevenue,9500);
});

test('utilization chart preserves real zero and gaps, and distinguishes provisional segments',()=>{
  const api=createDashboardApi();
  const rows=[{hasUsageData:true,utilization:75},
    {hasUsageData:false,observedUsage:700,mtdCapacity:1000,utilization:null},
    {hasUsageData:false,observedUsage:null,mtdCapacity:1000,utilization:null},
    {hasUsageData:true,utilization:0},{hasUsageData:true,utilization:118.2}];
  const data=api.utilizationDataset(rows);
  assert.deepEqual(Array.from(data.data),[75,70,null,0,118.2]);
  assert.equal(data.spanGaps,false);
  assert.deepEqual(Array.from(data.segment.borderDash({p0DataIndex:0,p1DataIndex:1})),[5,4]);
  assert.deepEqual(Array.from(data.segment.borderDash({p0DataIndex:3,p1DataIndex:4})),[]);
  assert.equal(data.pointStyle[1],'triangle'); assert.equal(rows[1].utilization,null);
});

test('sparklines keep missing months as gaps and display zero and negative series',()=>{
  const api=createDashboardApi();
  const svg=api.sparkline([10,null,20,30],'#abc',28,80,[false,false,true,false]);
  assert.equal((svg.match(/<line /g)||[]).length,1);
  assert.equal((svg.match(/<circle /g)||[]).length,3);
  assert.ok(svg.includes('stroke-dasharray="3 2"'));
  assert.ok(api.sparkline([0,0]).includes('<line'));
  assert.ok(api.sparkline([-2,-1]).includes('<line'));
  assert.equal(api.sparkline([null,null]),'');
});

test('provisional contribution needs usable shared sources and aligned dates, without becoming official',()=>{
  const api=createDashboardApi();
  const names=['일산','하남','고양','자유로','광명','성수','안성'];
  const quality=usageQuality('MISSING',8);
  quality.push(...names.slice(1).map(name=>[name,month,9,9,0,0,0,0,'OK',700]));
  const sheets={cfg:[['usage_local_latest_date',day(9)]],usageQuality:quality,salesQuality:quality};
  api.setSourceSnapshot({sheets});
  let row=api.parseFactMonthly(fact()).get('일산')[0];
  assert.equal(row.contributionRevenue,null); assert.equal(row.observedContributionRevenue,9500);
  assert.equal(api.aggMonths([row]).observedContributionRevenue,9500);
  assert.equal(api.aggregatePortfolioMonths([{name:'일산',months:[row]}]).find(m=>m.monthNum===month).observedContributionRevenue,9500);
  sheets.cfg=[['usage_local_latest_date',day(8)]];
  row=api.parseFactMonthly(fact()).get('일산')[0];
  assert.equal(row.observedContributionRevenue,null);
  sheets.cfg=[['usage_local_latest_date',day(9)]];
  quality[2][3]=0;
  assert.equal(api.parseFactMonthly(fact()).get('일산')[0].observedContributionRevenue,null);
  quality[2][3]=9; quality[2][5]=1;
  assert.equal(api.parseFactMonthly(fact()).get('일산')[0].observedContributionRevenue,null);
});

test('typed hold text never becomes a monetary amount or a percentage',()=>{
  const api=createDashboardApi();
  const result=api.parseSummary([['누적 운영기여매출(환불 전)','귀속 보류\n15점포일 누락'],
    ['가동률','참고 42.7%\n7점포일 누락']]);
  assert.equal(result.contributionRevenue,null);
  assert.equal(result.avgUtilization,null);
});

test('previous-result labels do not turn passed checks and zero blockers into warnings',()=>{
  const api=createDashboardApi();
  api.setSourceSnapshot({sheets:{cfg:[['dashboard_build_status','success'],['dashboard_run_id','run'],
    ['dashboard_audit_run_id','run'],['dashboard_audit_blocking',0]]}});
  const result=api.parseDataQuality([['점검 항목','상태','기준/값'],
    ['대시보드 빌드 상태','주의','생성 완료. 감사 실행본/차단 오류를 함께 확인'],
    ['차단 오류','전회 결과','0건'],['참고 경고','전회 결과','4건'],
    ['Summary 수식','전회 결과','검증 통과'],['2026 쿠폰 ID 대사','전회 결과','[주의] 쿠폰 메타 누락'],
    ['일별 원천 정합성','전회 결과','누락 30 / 오류 0 매장-월']]);
  assert.equal(result.auditCurrent,true);
  assert.deepEqual(Array.from(result.warnings,c=>c.name),['2026 쿠폰 ID 대사','일별 원천 정합성']);
});

test('real blockers and failed previous checks remain actionable',()=>{
  const api=createDashboardApi();
  const result=api.parseDataQuality([['점검 항목','상태','기준/값'],
    ['차단 오류','전회 결과','2건'],['Summary 수식','전회 결과','검증 실패'],
    ['검증 상세'],['등급','위치','메시지'],['위험','fact_monthly','필수 열 누락']]);
  assert.equal(result.warnings.length,3);
});

test('partial reference utilization never replaces official utilization or fabricates zero',()=>{
  const api=createDashboardApi();
  const row={hasUsageData:false,observedUsage:700,mtdCapacity:1000,usageMissingDays:1,utilization:null};
  const display=api.usagePresentation(row);
  assert.equal(display.label,'잠정 70.0%'); assert.equal(row.utilization,null);
  assert.equal(api.usagePresentation({...row,observedUsage:null}).reference,null);
  assert.equal(api.usagePresentation({...row,observedUsage:0}).reference,0);
  api.setState({quarter:'H2',store:'all'});
  assert.deepEqual(Array.from(api.filterMonths([{monthNum:6,gross:1},{monthNum:7,gross:1},{monthNum:9,gross:1}]),m=>m.monthNum),[7,9]);
});

function usageQuality(status, received, expected=9) {
  return [['매장','월','기대일','수신일','누락일','중복행','잘못된 값','매출 분해 불일치','품질상태','관측 이용량'],
    ['일산',month,expected,received,expected-received,0,0,0,status,700]];
}

test('partial usage is observed only, never a full-period utilization or ARPW',()=>{
  const api=createDashboardApi();
  api.setSourceSnapshot({sheets:{cfg:[['usage_local_latest_date',day(9)]],usageQuality:usageQuality('MISSING',8)}});
  const row=api.parseFactMonthly(fact({최신구독일_2026:day(9)})).get('일산')[0];
  assert.equal(row.observedUsage,700);
  assert.equal(row.usage,null); assert.equal(row.utilization,null);
  assert.equal(row.hasArpwData,false); assert.equal(row.hasArpuData,true);
  assert.equal(row.contributionRevenue,null);
  assert.equal(api.aggMonths([row]).utilization,null);
  assert.equal(api.aggregatePortfolioMonths([{name:'일산',months:[row]}]).find(m=>m.monthNum===month).usage,null);
});

test('complete current usage survives missing prior-year usage without a false comparison',()=>{
  const api=createDashboardApi();
  api.setSourceSnapshot({sheets:{cfg:[['usage_local_latest_date',day(9)]],
    usageQuality:usageQuality('OK',9),usageQualityPrev:usageQuality('MISSING',8)}});
  const row=api.parseFactMonthly(fact({최신구독일_2026:day(9)})).get('일산')[0];
  assert.equal(row.hasUsageData,true); assert.equal(row.hasArpwData,true);
  assert.equal(row.usage,700); assert.equal(row.usageComparable,false);
});

test('pre-opening store rows cannot suppress valid portfolio ARPU',()=>{
  const api=createDashboardApi();
  const rows=fact({매장:'안성',월번호:1,월라벨:'1월'});
  assert.equal(api.parseFactMonthly(rows).has('안성'),false);
});

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
function mockSource(states) {
  let calls=0;
  const env={GOOGLE_CLIENT_EMAIL:`test-${Math.random()}@example.invalid`,
    GOOGLE_PRIVATE_KEY:keys.privateKey.export({format:'pem',type:'pkcs8'})};
  const cfg=status=>[['dashboard_build_status',status],['dashboard_run_id','run-1'],['dashboard_audit_run_id','run-1'],['dashboard_audit_blocking',0]];
  const fetchImpl=async(url,options)=>{
    if(String(url).includes('oauth2.googleapis.com')) {
      const jwt=options.body.get('assertion').split('.');
      assert.equal(JSON.parse(Buffer.from(jwt[1],'base64url')).scope,'https://www.googleapis.com/auth/spreadsheets.readonly');
      assert.ok(verify('RSA-SHA256',Buffer.from(jwt.slice(0,2).join('.')),keys.publicKey,Buffer.from(jwt[2],'base64url')));
      return {ok:true,json:async()=>({access_token:'unit-test-token',expires_in:3600})};
    }
    const ranges=new URL(url).searchParams.getAll('ranges');
    const status=states[Math.min(calls++,states.length-1)];
    return {ok:true,json:async()=>({valueRanges:ranges.map(range=>({values:range===SOURCES.cfg.range ? cfg(status)
      : range===SOURCES.factMonthly.range || range===SOURCES.overallMonthly.range ? fact()
      : range.includes('_ops_quality_') ? [['매장','월','품질상태','실행본'],['일산',month,'OK','run-1']] : [['test']] }))})};
  };
  return {env,fetchImpl};
}
test('authenticated batch read returns only a stable completed snapshot',async()=>{
  const snapshot=await fetchSnapshot(mockSource(['complete']));
  assert.equal(snapshot.build.status,'complete'); assert.ok(snapshot.sheets.factMonthly.length);
  assert.equal(JSON.stringify(snapshot).includes('unit-test-token'),false);
});

test('stale audit and stale quality execution IDs fail closed',async()=>{
  for (const key of ['dashboard_audit_run_id','quality']) {
    const mock=mockSource(['complete']);
    const original=mock.fetchImpl;
    mock.fetchImpl=async(url,options)=>{
      const response=await original(url,options);
      if (String(url).includes('oauth2.googleapis.com')) return response;
      const payload=await response.json();
      for (const range of payload.valueRanges) {
        if (key==='quality' && range.values[0]?.includes('실행본')) range.values[1][3]='old-run';
        for (const row of range.values) if(row[0]===key) row[1]='old-run';
      }
      return {ok:true,json:async()=>payload};
    };
    await assert.rejects(fetchSnapshot(mock),{code:key==='quality'?'SOURCE_QUALITY_PENDING':'SOURCE_AUDIT_PENDING'});
  }
});

test('slow sheet responses return a localized source timeout',async()=>{
  const mock=mockSource(['complete']); const original=mock.fetchImpl;
  mock.fetchImpl=(url,options)=>String(url).includes('oauth2.googleapis.com') ? original(url,options)
    : Promise.reject(new DOMException('internal timeout details','TimeoutError'));
  await assert.rejects(fetchSnapshot(mock),{code:'SOURCE_TIMEOUT'});
});
test('running, failed, changed and unconfigured sources never appear as a valid snapshot',async()=>{
  await assert.rejects(fetchSnapshot(mockSource(['running'])),{code:'SOURCE_BUILD_PENDING'});
  await assert.rejects(fetchSnapshot(mockSource(['failed'])),{code:'SOURCE_BUILD_FAILED'});
  await assert.rejects(fetchSnapshot(mockSource(['complete','running','complete'])),{code:'SOURCE_CHANGED'});
  await assert.rejects(fetchSnapshot({env:{},fetchImpl:()=>{throw Error('network must not run');}}),{code:'SOURCE_AUTH_REQUIRED'});
});
test('data API rejects unauthenticated requests even without middleware',async()=>{
  const handler=require('./api/data.js');
  const previous=process.env.DASHBOARD_TOKEN; process.env.DASHBOARD_TOKEN='unit-test-dashboard';
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  try {
    await handler({method:'GET',headers:{cookie:'ds_auth=%broken'}},res);
    assert.equal(res.code,401); assert.equal(res.body.code,'UNAUTHORIZED');
  } finally { if(previous===undefined)delete process.env.DASHBOARD_TOKEN;else process.env.DASHBOARD_TOKEN=previous; }
});

test('OAuth refresh is read-only, cached and never included in snapshots',async()=>{
  const source=mockSource(['complete']); let tokens=0;
  const env={GOOGLE_OAUTH_CLIENT_ID:'test-oauth-client',GOOGLE_OAUTH_CLIENT_SECRET:'test-secret',GOOGLE_OAUTH_REFRESH_TOKEN:'test-refresh'};
  const fetchImpl=async(url,options)=>{
    if(String(url).includes('oauth2.googleapis.com')) {
      tokens++;
      assert.equal(options.body.get('grant_type'),'refresh_token');
      assert.equal(options.body.get('refresh_token'),'test-refresh');
      assert.equal(options.body.has('assertion'),false);
      return {ok:true,json:async()=>({access_token:'oauth-access',expires_in:3600,scope:'https://www.googleapis.com/auth/spreadsheets.readonly openid https://www.googleapis.com/auth/userinfo.email'})};
    }
    assert.equal(options.headers.Authorization,'Bearer oauth-access');
    return source.fetchImpl(url,options);
  };
  const snapshot=await fetchSnapshot({env,fetchImpl});
  await fetchSnapshot({env,fetchImpl});
  assert.equal(tokens,1);
  assert.doesNotMatch(JSON.stringify(snapshot),/test-refresh|test-secret|oauth-access/);
});

test('OAuth incomplete, revoked and excessive grants fail closed',async()=>{
  await assert.rejects(fetchSnapshot({env:{GOOGLE_OAUTH_CLIENT_ID:'incomplete'},fetchImpl:()=>{throw Error('must not request');}}),{code:'SOURCE_AUTH_REQUIRED'});
  const env={GOOGLE_OAUTH_CLIENT_ID:'other-client',GOOGLE_OAUTH_CLIENT_SECRET:'secret',GOOGLE_OAUTH_REFRESH_TOKEN:'revoked'};
  await assert.rejects(fetchSnapshot({env,fetchImpl:async()=>({ok:false,json:async()=>({error:'invalid_grant',error_description:'sensitive upstream details'})})}),error=>error.code==='SOURCE_AUTH_INVALID' && !error.message.includes('sensitive'));
  await assert.rejects(fetchSnapshot({env,fetchImpl:async()=>({ok:true,json:async()=>({access_token:'bad-scope',scope:'https://www.googleapis.com/auth/spreadsheets'})})}),{code:'SOURCE_AUTH_INVALID'});
});
