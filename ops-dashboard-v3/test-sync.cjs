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

test('equivalent date serials are informational, but real synchronization mismatches remain warnings',()=>{
  const api=createDashboardApi();
  const check=value=>api.parseDataQuality([['점검 항목','상태','기준/값'],['최신일 동기화','주의',value]]);
  const value='최신일 동기화: _overall 2026=46296 / raw=2026-10-01, _overall 2025=45931 / raw=2025-10-01';
  assert.equal(check(value).warnings.length,0);
  assert.equal(check(value).infos.length,1);
  assert.equal(check(value.replace('46296','46295')).warnings.length,1);
  assert.equal(check(value+' / 오류 행 발견').warnings.length,1);
});

test('Q4 filters only received fourth-quarter months and keeps MTD targets',()=>{
  const api=createDashboardApi();api.setState({quarter:'Q4',store:'all'});
  const months=[{monthNum:9,quarter:'Q3',gross:100},
    {monthNum:10,quarter:'Q4',gross:90,net:85,target:100},
    {monthNum:11,quarter:'Q4',gross:null,net:null,target:300}];
  const filtered=api.filterMonths(months);
  assert.deepEqual(Array.from(filtered,m=>m.monthNum),[10]);
  assert.equal(api.aggMonths(filtered).achievement,85);
});

test('ARPU-only charts hide the absent coupon axis and keep zero coupon data visible',()=>{
  const api=createDashboardApi({opsArpuChart:{closest:()=>null}});
  api.renderOpsArpuChart({months:[{month:'1월',monthNum:1,hasDiscountData:false,arpu:40000}]});
  let config=api.getChartConfig('opsArpuChart');
  assert.equal(config.options.scales.pct.display,false);
  assert.equal(config.options.scales.arpu.position,'left');
  assert.equal(config.data.datasets.length,1);
  api.renderOpsArpuChart({months:[{month:'1월',monthNum:1,hasDiscountData:true,discountShare:0,arpu:40000}]});
  config=api.getChartConfig('opsArpuChart');
  assert.equal(config.options.scales.pct.display,true);
  assert.equal(config.options.scales.arpu.position,'right');
  assert.equal(config.data.datasets[0].data[0],0);
});

test('subscription pipeline reports zero change neutrally and keeps positive and negative flows',()=>{
  const panel={innerHTML:''};const api=createDashboardApi({subPipeline:panel});
  const render=(newSubs,cancelSubs)=>api.renderSubscriptionPipeline({months:[{retained:100,newSubs,cancelSubs,
    netAdds:newSubs-cancelSubs,churn:5,hasSubscriptionData:true,status:'mtd'}]});
  render(20,20);assert.match(panel.innerHTML,/변동 없음/);assert.doesNotMatch(panel.innerHTML,/신규 우위|해지 우위/);
  render(21,20);assert.match(panel.innerHTML,/신규 우위/);assert.match(panel.innerHTML,/\+1건/);
  render(19,20);assert.match(panel.innerHTML,/해지 우위/);assert.match(panel.innerHTML,/-1건/);
});

function reviewDom() {
  const elements={};
  const createElement=tag=>({tagName:tag.toUpperCase(),style:{},hidden:false,innerHTML:'',
    remove(){delete elements[this.id];},
    appendChild(child){child.parentElement=this;elements[child.id]=child;},
    closest(){return this.host || null;}});
  const add=(id,tag='div')=>{const node=createElement(tag);node.id=id;elements[id]=node;return node;};
  return {elements,add,createElement};
}

test('reviewed sections keep their frames across all periods without retaining unavailable charts',()=>{
  const dom=reviewDom();
  const ids=['scoreChart','healthChart','seasonChart','capacityPanel'];
  for(const id of ids) {
    const node=dom.add(id,id.endsWith('Chart')?'canvas':'div');
    node.host=dom.createElement('article');node.parentElement=dom.createElement('div');
  }
  const api=createDashboardApi(dom.elements,{createElement:dom.createElement});
  let renders=0;const ent={isAll:true};
  for(const period of ['all','H1','H2','Q1','Q2','Q3','Q4']) {
    api.setState({quarter:period,store:'all'});
    api.renderReviewed(()=>renders++,ent,ids,false);
    for(const id of ids) {
      const node=dom.elements[id];
      assert.equal(node.host.hidden,false,`${period} / ${id} frame`);
      assert.equal(node.hidden,id.endsWith('Chart'),`${period} / ${id} content`);
      assert.match(dom.elements[`${id}Review`].innerHTML,/선택 기간 자료 확인 후 표시/);
    }
  }
  assert.equal(renders,0);
  assert.equal(Object.keys(dom.elements).filter(id=>id.endsWith('Review')).length,4);
  api.renderReviewed(()=>renders++,ent,ids,true);
  assert.equal(renders,1);
  for(const id of ids) {
    assert.equal(dom.elements[id].hidden,false);
    assert.equal(dom.elements[`${id}Review`],undefined);
  }
  const chart=dom.add('opsArpuChart','canvas');chart.parentElement=dom.createElement('div');
  api.renderOpsArpuChart({months:[{month:'1월',monthNum:1,hasDiscountData:false,arpu:40000}]});
  assert.ok(api.getChartConfig('opsArpuChart'));
  api.renderReviewed(()=>{},ent,['opsArpuChart'],false);
  assert.equal(api.getChartConfig('opsArpuChart'),undefined);
});

function actionApi(stores=[]) {
  const dom=reviewDom();
  for(const id of ['actionCenter','acActionList','acDangerList','acLossBody','acActionCount','acDangerCount']) {
    const node=dom.add(id);node.innerHTML='stale period data';node.textContent='3';
    node.querySelectorAll=()=>[];
  }
  const api=createDashboardApi(dom.elements,{createElement:dom.createElement});
  api.setDashboard({stores,opsStores:[]});api.setState({quarter:'all',store:'all'});
  return {api,dom};
}
function opportunityFixture(overrides={}) {
  return {month:'1월',monthNum:1,quarter:'Q1',status:'confirmed',capacity:100,mtdCapacity:100,
    usage:60,net:600,gross:600,refundAmount:0,target:1000,retained:100,retainedExposure:100,
    newSubs:2,cancelSubs:6,netAdds:-4,hasUsageData:true,hasSalesData:true,hasSubscriptionData:true,
    hasArpwData:true,lossUnitPrice:10,...overrides};
}

test('partial usage does not suppress confirmed sales and subscription actions or fabricate opportunity zero',()=>{
  const row=opportunityFixture({hasUsageData:false,usage:null});
  const {api,dom}=actionApi([{name:'일산',months:[row]}]);
  api.renderActionCenter({isAll:true,months:[row],current:api.aggMonths([row])});
  assert.equal(dom.elements.acActionCount.textContent,'3');
  assert.match(dom.elements.acActionList.innerHTML,/순매출 달성률 60.0%|이탈률 6.0%|구독 순증감 -4건/);
  assert.match(dom.elements.acActionList.innerHTML,/가동률은 자료 확인 전/);
  assert.doesNotMatch(dom.elements.acActionList.innerHTML,/선택 기간 자료 확인 후 표시|stale period data|1차 원인|DRI/);
  assert.match(dom.elements.acDangerList.innerHTML,/일산/);
  assert.match(dom.elements.acLossBody.innerHTML,/ac-loss-total">—/);
  assert.match(dom.elements.acLossBody.innerHTML,/확인 0\/1개 매장-월/);
});

test('priority uses common confirmed metrics without scoring missing utilization as zero',()=>{
  const full=opportunityFixture({net:950,gross:950,usage:10,cancelSubs:0,netAdds:2});
  const missing=opportunityFixture({hasUsageData:false,usage:null,net:800,gross:800,cancelSubs:0,netAdds:2});
  const {api}=actionApi([{name:'일산',months:[full]},{name:'하남',months:[missing]}]);
  const review=api.buildPriorityReview({isAll:true});
  assert.deepEqual(Array.from(review.common,rule=>rule.key),['refundRate','churn','achievement']);
  assert.equal(review.rows[0].name,'하남');assert.equal(review.rows[1].signals.length,0);
  const single=api.buildPriorityReview({isAll:false,name:'일산',months:[full]});
  assert.equal(single.common.length,4);assert.equal(single.rows[0].signals[0].key,'utilization');
});

test('empty comparison basis does not manufacture priority ranks or normal status',()=>{
  const row=opportunityFixture({hasSalesData:false,hasUsageData:false,hasSubscriptionData:false,usage:null});
  const {api,dom}=actionApi([{name:'일산',months:[row]}]);
  api.renderActionCenter({isAll:true,months:[row],current:api.aggMonths([row])});
  assert.equal(dom.elements.acDangerCount.textContent,'—');
  assert.match(dom.elements.acDangerList.innerHTML,/순위를 산정하지 않습니다/);
  assert.doesNotMatch(dom.elements.acDangerList.innerHTML,/ac-danger-rank|class="ac-danger-store"/);
});

test('monthly prices and idle are summed independently, including confirmed real zero usage',()=>{
  const rows=[opportunityFixture({usage:120,net:1200,lossUnitPrice:10}),
    opportunityFixture({month:'2월',monthNum:2,usage:50,net:1000,lossUnitPrice:20}),
    opportunityFixture({month:'3월',monthNum:3,usage:0,net:100,gross:100,lossUnitPrice:3})];
  const {api}=actionApi([{name:'성수',months:rows}]);
  const ent={isAll:false,name:'성수',months:rows};
  const review=api.buildOpportunityReview(ent),capacity=api.buildCapacityData(ent)[0];
  assert.equal(review.loss,1300);assert.equal(review.idle,150);assert.equal(review.readyCount,3);
  assert.equal(capacity.confirmedLoss,1300);assert.equal(capacity.confirmedIdle,150);
  assert.equal(capacity.confirmedMonths,3);assert.equal(capacity.confirmedDesignCap,300);
});

test('zero MTD usage, zero unit price and zero projected usage are valid values, absent price is not',()=>{
  const {api}=actionApi();
  const row=opportunityFixture({status:'mtd',usage:0,net:100,projectedUsage:0,lossUnitPrice:3,elapsedDays:1,daysInSourceMonth:31});
  const result=api.opportunityMonth(row);assert.equal(result.loss,300);assert.equal(result.projectedLoss,300);
  const cap=api.buildCapacityData({isAll:false,name:'일산',months:[row]})[0];
  assert.equal(cap.hasMTD,true);assert.equal(cap.mtdLoss,300);assert.equal(cap.projUsage,0);assert.equal(cap.projLoss,300);
  assert.equal(api.opportunityMonth({...row,lossUnitPrice:0}).loss,0);
  assert.equal(api.opportunityMonth({...row,lossUnitPrice:null}).ready,false);
  assert.equal(api.buildCapacityData({isAll:false,name:'일산',months:[{...row,lossUnitPrice:null}]} )[0].lossEstimate,null);
});

test('blank opportunity source fields preserve null while real zero remains zero',()=>{
  const api=apiWithDates();
  let row=api.parseFactMonthly(fact({최신매출일_2026:day(7)})).get('일산')[0];
  for(const key of ['lossUnitPrice','idleMtd','projectedUsage','projectedIdle','lossMtd','lossProjected'])assert.equal(row[key],null,key);
  row=api.parseFactMonthly(fact({최신매출일_2026:day(7),손실단가_2026:0,월말예상총사용_2026:0})).get('일산')[0];
  assert.equal(row.lossUnitPrice,0);assert.equal(row.projectedUsage,0);
});

test('source formula mismatch excludes only its store-month and never guesses the missing amount',()=>{
  const rows=[opportunityFixture(),opportunityFixture({month:'2월',monthNum:2,lossMtd:999}),
    opportunityFixture({month:'3월',monthNum:3,hasUsageData:false,usage:null})];
  const {api,dom}=actionApi([{name:'일산',months:rows}]);
  const review=api.buildOpportunityReview({isAll:true});
  assert.equal(review.loss,400);assert.equal(review.readyCount,1);assert.equal(review.totalCount,3);assert.equal(review.complete,false);
  api.renderActionCenter({isAll:true,months:rows,current:api.aggMonths(rows)});
  assert.match(dom.elements.acLossBody.innerHTML,/산출 가능한 구간 합계|확인 1\/3개 매장-월|2개 매장-월은 제외/);
  assert.match(dom.elements.acLossBody.innerHTML,/2월 원천 기회금액 산식 불일치/);
});

test('all seven periods recompute eligible amounts and priorities within the selected source months',()=>{
  const rows=Array.from({length:month},(_,i)=>opportunityFixture({month:`${i+1}월`,monthNum:i+1,
    quarter:`Q${Math.ceil((i+1)/3)}`,lossUnitPrice:i+1,status:i+1===month?'mtd':'confirmed'}));
  const {api,dom}=actionApi([{name:'일산',months:rows}]);
  const bounds={all:[1,12],H1:[1,6],H2:[7,12],Q1:[1,3],Q2:[4,6],Q3:[7,9],Q4:[10,12]};
  for(const [period,[start,end]] of Object.entries(bounds)) {
    api.setState({quarter:period,store:'all'});
    const selected=api.filterMonths(rows),expected=rows.filter(row=>row.monthNum>=start && row.monthNum<=end);
    const review=api.buildOpportunityReview({isAll:true});
    assert.equal(review.loss,expected.reduce((sum,row)=>sum+40*row.lossUnitPrice,0),period);
    assert.equal(review.totalCount,expected.length,period);
    api.renderActionCenter({isAll:true,months:selected,current:api.aggMonths(selected)||{}});
    for(const id of ['acActionList','acDangerList','acLossBody'])assert.doesNotMatch(dom.elements[id].innerHTML,/선택 기간 자료 확인 후 표시|stale period data/);
  }
});

test('missing subscription months cannot produce confirmed flow recommendations',()=>{
  const rows=[opportunityFixture(),opportunityFixture({month:'2월',monthNum:2,hasSubscriptionData:false})];
  const {api,dom}=actionApi([{name:'일산',months:rows}]);
  api.renderActionCenter({isAll:true,months:rows,current:api.aggMonths(rows)});
  assert.doesNotMatch(dom.elements.acActionList.innerHTML,/<strong>이탈률|<strong>구독 순증감/);
  assert.match(dom.elements.acActionList.innerHTML,/이탈률.*자료 확인 전/);
});

test('store snapshots use source thresholds and preserve missing sales and subscription values',()=>{
  const panel={innerHTML:'',querySelectorAll:()=>[]};const api=createDashboardApi({storeTableBody:panel});
  const rows=[opportunityFixture({hasSalesData:false,hasSubscriptionData:false,net:null,gross:null,
    hasUsageData:false,usage:null})];
  api.setDashboard({stores:[{name:'일산',months:rows}],opsStores:[]});api.setState({quarter:'all',store:'all'});
  api.renderTable({isAll:true});
  assert.match(panel.innerHTML,/<td data-label="순매출 달성률">—/);
  assert.match(panel.innerHTML,/<td data-label="이탈률">—/);
  assert.match(panel.innerHTML,/일부 자료 확인 중/);assert.doesNotMatch(panel.innerHTML,/목표 미달/);
  rows[0]=opportunityFixture({net:850,gross:850,usage:75,cancelSubs:4,netAdds:0});
  api.renderTable({isAll:true});assert.match(panel.innerHTML,/목표 미달/);
});

test('partial utilization keeps four signals and does not classify observed usage as a confirmed risk',()=>{
  const panel={innerHTML:''};const api=createDashboardApi({signalGrid:panel});
  const current={hasSalesData:true,achievement:95,target:100,net:95,hasSubscriptionData:true,
    churn:13,mrr:5000,hasMrrYoY:true,mrrYoY:20,hasUsageData:false,
    observedUsage:300,mtdCapacity:1000,usageMissingDays:2,utilization:null};
  api.renderSignals({current});
  assert.equal((panel.innerHTML.match(/class="signal /g)||[]).length,4);
  assert.match(panel.innerHTML,/목표 근접/);assert.match(panel.innerHTML,/이탈 위험/);
  assert.match(panel.innerHTML,/MRR 고성장/);assert.match(panel.innerHTML,/가동률 판정 대기/);
  assert.match(panel.innerHTML,/잠정 30\.0%/);assert.doesNotMatch(panel.innerHTML,/가동 저조/);
  api.renderSignals({current:{...current,hasUsageData:true,usage:0,utilization:0}});
  assert.match(panel.innerHTML,/가동 저조/);assert.doesNotMatch(panel.innerHTML,/가동률 판정 대기/);
  api.renderSignals({current:{hasSalesData:false,hasSubscriptionData:false,hasUsageData:false}});
  assert.equal((panel.innerHTML.match(/class="signal neutral"/g)||[]).length,4);
  assert.doesNotMatch(panel.innerHTML,/이탈 안정|MRR 성장|목표 미달/);
});

test('partial detail keeps received financial metrics without fabricated idle capacity or stale drilldowns',()=>{
  const dom=reviewDom();for(const id of ['detailGrid','detailTitle','detailSub','detailDrilldown'])dom.add(id);
  const api=createDashboardApi(dom.elements,{createElement:dom.createElement});
  api.setDashboard({stores:{},overall:[],dataQuality:{}});
  api.renderDetail({isAll:true,months:[{}],current:{hasSalesData:true,gross:10000,net:9000,target:10000,
    achievement:90,hasSubscriptionData:true,mrr:5000,churn:5,hasUsageData:false,
    observedUsage:300,mtdCapacity:1000,usageMissingDays:2,utilization:null}});
  const html=dom.elements.detailGrid.innerHTML;
  assert.equal((html.match(/class="d-item"/g)||[]).length,12);
  assert.match(html,/실결제매출/);assert.match(html,/순매출 달성률/);assert.match(html,/90\.0%/);
  assert.match(html,/잠정 30\.0%/);assert.match(html,/관측 300회/);
  assert.doesNotMatch(html,/유휴 Capacity|NaN/);
  assert.equal(dom.elements.detailDrilldown,undefined);
});

test('payment summary keeps all five metric cards when per-wash inputs are unavailable',()=>{
  const panel={innerHTML:''};const api=createDashboardApi({paymentPanel:panel});
  const current={gross:10000,net:9000,usage:null,hasArpwData:false,hasSubscriptionData:true,
    arpu:40000,arr:60000,ltv:50000};
  api.renderPaymentPanel({current});
  assert.equal((panel.innerHTML.match(/class="pay-item /g)||[]).length,5);
  assert.match(panel.innerHTML,/건당 매출/);assert.match(panel.innerHTML,/건당 순매출/);
  assert.equal((panel.innerHTML.match(/class="pay-val">—/g)||[]).length,2);
  api.renderPaymentPanel({current:{...current,usage:1000,hasArpwData:true}});
  assert.equal((panel.innerHTML.match(/class="pay-item /g)||[]).length,5);
  assert.doesNotMatch(panel.innerHTML,/class="pay-val">—/);
});

test('heatmap keeps five core columns and neutral cells for unavailable usage and subscription data',()=>{
  const panel={innerHTML:'',querySelectorAll:()=>[]};const api=createDashboardApi({heatmapGrid:panel});
  const m={month:'1월',monthNum:1,quarter:'Q1',status:'confirmed',gross:10000,net:9000,target:10000,
    refundAmount:1000,hasSalesData:true,hasSubscriptionData:false,hasUsageData:false,hasArpwData:false};
  api.setState({quarter:'all',store:'all'});
  api.setDashboard({stores:[{name:'일산',months:[m]}],overall:[m],opsStores:[]});
  api.renderHeatmap({isAll:true});
  assert.match(panel.innerHTML,/5개 지표/);
  assert.match(panel.innerHTML,/가동률/);assert.match(panel.innerHTML,/기회금액 상한/);
  assert.equal((panel.innerHTML.match(/class="hm-head-cell"/g)||[]).length,6);
  assert.equal((panel.innerHTML.match(/title="원천 자료 확인 후 표시">—/g)||[]).length,3);
  assert.doesNotMatch(panel.innerHTML,/NaN|Infinity/);
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

test('final completed audit blockers and changed seals reject a mixed snapshot',async()=>{
  for(const field of ['dashboard_audit_blocking','dashboard_audit_run_id','dashboard_audit_source_fingerprint']) {
    const source=mockSource(['complete']);const original=source.fetchImpl;let reads=0;
    source.fetchImpl=async(url,options)=>{
      const response=await original(url,options);
      if(String(url).includes('oauth2.googleapis.com'))return response;
      const payload=await response.json();reads++;
      if(reads===3) {
        const rows=payload.valueRanges[0].values;
        const row=rows.find(r=>r[0]===field);
        if(row)row[1]=field==='dashboard_audit_blocking'?1:'changed-run';
        else rows.push([field,'changed-fingerprint']);
      }
      return {ok:true,json:async()=>payload};
    };
    await assert.rejects(fetchSnapshot(source),{code:field==='dashboard_audit_blocking'?'SOURCE_AUDIT_FAILED':'SOURCE_CHANGED'});
  }
});

test('completed quality tables accept a table-level execution ID with unsealed later rows',async()=>{
  const source=mockSource(['complete']);const original=source.fetchImpl;
  source.fetchImpl=async(url,options)=>{
    const response=await original(url,options);
    if(String(url).includes('oauth2.googleapis.com'))return response;
    const payload=await response.json();
    for(const range of payload.valueRanges)if(range.values[0]?.includes('실행본'))
      range.values.push(['하남',month,'OK'],['고양',month,'OK',''],['자유로',month,'OK','  ']);
    return {ok:true,json:async()=>payload};
  };
  const snapshot=await fetchSnapshot(source);
  assert.equal(snapshot.readiness.mode,'complete');
  assert.equal(snapshot.sheets.usageQuality.length,5);
});

test('completed quality tables require the table seal even if a later row has a current ID',async()=>{
  const source=mockSource(['complete']);const original=source.fetchImpl;
  source.fetchImpl=async(url,options)=>{
    const response=await original(url,options);
    if(String(url).includes('oauth2.googleapis.com'))return response;
    const payload=await response.json();
    for(const range of payload.valueRanges)if(range.values[0]?.includes('실행본')) {
      range.values[1][3]='';
      range.values.push(['하남',month,'OK','run-1']);
    }
    return {ok:true,json:async()=>payload};
  };
  await assert.rejects(fetchSnapshot(source),{code:'SOURCE_QUALITY_PENDING'});
});

test('completed quality tables reject conflicting explicit execution IDs in later rows',async()=>{
  const source=mockSource(['complete']);const original=source.fetchImpl;
  source.fetchImpl=async(url,options)=>{
    const response=await original(url,options);
    if(String(url).includes('oauth2.googleapis.com'))return response;
    const payload=await response.json();
    for(const range of payload.valueRanges)if(range.values[0]?.includes('실행본'))range.values.push(['하남',month,'OK','old-run']);
    return {ok:true,json:async()=>payload};
  };
  await assert.rejects(fetchSnapshot(source),{code:'SOURCE_QUALITY_PENDING'});
});

test('the same run transitions from partial to complete with coupon and display sources restored',async()=>{
  const sheets=partialSheets();const source=partialSource(sheets);
  const partial=await fetchSnapshot(source);
  sheets.cfg.find(r=>r[0]==='dashboard_build_status')[1]='success';
  sheets.cfg.find(r=>r[0]==='dashboard_audit_run_id')[1]='current-run';
  const complete=await fetchSnapshot(source);
  assert.equal(partial.readiness.mode,'partial');assert.equal(complete.readiness.mode,'complete');
  assert.deepEqual(complete.sheets.coupon,sheets.coupon);
  assert.deepEqual(complete.sheets.summary,sheets.summary);
  assert.equal(complete.build.runId,partial.build.runId);
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
    await assert.rejects(fetchSnapshot(mock),{code:key==='quality'?'SOURCE_QUALITY_PENDING':'SOURCE_PARTIAL_PENDING'});
  }
});

test('slow sheet responses return a localized source timeout',async()=>{
  const mock=mockSource(['complete']); const original=mock.fetchImpl;
  mock.fetchImpl=(url,options)=>String(url).includes('oauth2.googleapis.com') ? original(url,options)
    : Promise.reject(new DOMException('internal timeout details','TimeoutError'));
  await assert.rejects(fetchSnapshot(mock),{code:'SOURCE_TIMEOUT'});
});
test('unverified running, failed, changed and unconfigured sources never appear as a valid snapshot',async()=>{
  await assert.rejects(fetchSnapshot(mockSource(['running'])),{code:'SOURCE_PARTIAL_PENDING'});
  await assert.rejects(fetchSnapshot(mockSource(['failed'])),{code:'SOURCE_BUILD_FAILED'});
  await assert.rejects(fetchSnapshot(mockSource(['complete','running','complete'])),{code:'SOURCE_CHANGED'});
  await assert.rejects(fetchSnapshot({env:{},fetchImpl:()=>{throw Error('network must not run');}}),{code:'SOURCE_AUTH_REQUIRED'});
});

function partialSheets(status='running') {
  const cfg=[['dashboard_build_status',status],['dashboard_run_id','current-run'],['dashboard_audit_run_id','old-run'],
    ['dashboard_audit_blocking',0],['current_year',year],['current_month',month],
    ['sales_effective_latest_date',day(1)],['usage_local_latest_date',day(1)],['subscription_local_latest_date',day(1)]];
  const names=['일산','하남','고양','자유로','광명','성수','안성'];
  const sheets={cfg,summary:[['old summary']],coupon:[['old coupon']],ops:[['old ops']],dataCheck:[['old audit']]};
  const qHead=['매장','월','기대일','수신일','누락일','중복행','잘못된 값','매출 분해 불일치','품질상태',
    '집계 기준일','전체 누락일','관측 결제매출','관측 환불','관측 이용량','','실행본','원천 기준일'];
  for(const key of ['usageQuality','usageQualityPrev','salesQuality','salesQualityPrev']) sheets[key]=[qHead];
  sheets.factMonthly=[]; sheets.overallMonthly=[];
  for(let m=1;m<=month;m++) {
    const d=m===month ? 1 : new Date(Date.UTC(year,m,0)).getUTCDate();
    const current=`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const prior=current.replace(String(year),String(year-1));
    let template;
    for(const name of names) {
      const [head,row]=fact({월번호:m,월라벨:`${m}월`,매장:name,최신매출일_2026:current,최신매출일_2025:prior,
        최신구독일_2026:current,최신구독일_2025:prior,총매출_2025:8500,환불_2025:500,순매출_2025:8000,총사용_2025:600,
        '1회권매출_2026':1000,올패스매출_2026:2000,'1회권매출_2025':1000,단일구독매출_2025:6000,올패스매출_2025:1500,
        MTD_Capacity_2026:3000,MRR_2026:5000,ARR_2026:60000});
      if(!sheets.factMonthly.length) sheets.factMonthly.push(head);
      sheets.factMonthly.push(row);
      template=Object.fromEntries(head.map((h,i)=>[h,row[i]]));
      for(const key of ['usageQuality','usageQualityPrev','salesQuality','salesQualityPrev']) {
        const prev=key.endsWith('Prev'),sales=key.startsWith('sales');
        sheets[key].push([name,m,d,d,0,0,0,0,'OK',prev?prior:current,'',sales?(prev?8500:9000):0,sales?500:0,
          sales?0:prev?600:700,'','current-run',prev?day(1).replace(String(year),String(year-1)):day(1)]);
      }
    }
    for(const key of ['총매출_2026','환불_2026','순매출_2026','총사용_2026','총매출_2025','환불_2025','순매출_2025','총사용_2025',
      '유지_2026','신규_2026','해지_2026']) if(key in template) template[key]*=7;
    template.MRR_2026=37000; template.ARR_2026=444000;template.올패스유지_2026=30;
    const head=Object.keys(template);
    if(!sheets.overallMonthly.length) sheets.overallMonthly.push(head);
    sheets.overallMonthly.push(Object.values(template));
  }
  return sheets;
}

function partialSource(sheets,change) {
  const source=mockSource(['running']);let reads=0;
  const auth=source.fetchImpl;
  source.fetchImpl=async(url,options)=> {
    if(String(url).includes('oauth2.googleapis.com')) return auth(url,options);
    reads++;
    const data=structuredClone(sheets);
    if(change) change(data,reads);
    const ranges=new URL(url).searchParams.getAll('ranges');
    return {ok:true,json:async()=>({valueRanges:ranges.map(range=>({values:data[Object.keys(SOURCES).find(key=>SOURCES[key].range===range)] || []}))})};
  };
  return source;
}

test('running source publishes stable reconciled groups without stale display tabs',async()=>{
  const snapshot=await fetchSnapshot(partialSource(partialSheets()));
  assert.equal(snapshot.readiness.mode,'partial');
  assert.equal(snapshot.readiness.cells[`일산:${month}`].sales,true);
  assert.equal(snapshot.readiness.cells[`일산:${month}`].usage,true);
  assert.equal(snapshot.readiness.cells[`일산:${month}`].subscription,true);
  for(const key of ['summary','coupon','ops','dataCheck']) assert.deepEqual(snapshot.sheets[key],[]);
  assert.equal(snapshot.sheets.factMonthly[1][snapshot.sheets.factMonthly[0].indexOf('운영기여매출_2026')],'');
});

test('completed build awaiting audit can publish locally reconciled groups',async()=>{
  assert.equal((await fetchSnapshot(partialSource(partialSheets('complete')))).readiness.mode,'partial');
});

test('stale prior usage table does not block current sales and usage, but disables YoY',async()=>{
  const sheets=partialSheets();sheets.usageQualityPrev[1][15]='old-run';
  const snapshot=await fetchSnapshot(partialSource(sheets));
  const cell=snapshot.readiness.cells[`일산:${month}`];
  assert.equal(cell.sales,true);assert.equal(cell.usage,true);assert.equal(cell.usagePrev,false);
  const api=createDashboardApi();api.setSourceSnapshot(snapshot);
  const row=api.parseFactMonthly(snapshot.sheets.factMonthly).get('일산').at(-1);
  assert.equal(row.hasUsageData,true);assert.equal(row.usageComparable,false);
});

test('numeric changes within one run are rejected instead of mixing snapshots',async()=>{
  await assert.rejects(fetchSnapshot(partialSource(partialSheets(),(sheets,read)=>{
    if(read===3) sheets.factMonthly[1][sheets.factMonthly[0].indexOf('총매출_2026')]+=100;
  })),{code:'SOURCE_CHANGED'});
});

test('usage mismatch holds that monthly group without blocking sales',async()=>{
  const sheets=partialSheets();
  const row=sheets.factMonthly.find(r=>r[sheets.factMonthly[0].indexOf('매장')]==='일산' && r[1]===month);
  row[sheets.factMonthly[0].indexOf('총사용_2026')]+=1;
  const snapshot=await fetchSnapshot(partialSource(sheets));
  assert.equal(snapshot.readiness.cells[`일산:${month}`].sales,true);
  assert.equal(snapshot.readiness.cells[`일산:${month}`].usage,false);
  const api=createDashboardApi();api.setSourceSnapshot(snapshot);
  const item=api.parseFactMonthly(snapshot.sheets.factMonthly).get('일산').at(-1);
  assert.equal(item.gross,9000);assert.equal(item.usage,null);assert.equal(item.observedUsage,null);
});

test('unreconciled sales cannot appear as a zero or a partial portfolio total',async()=>{
  const sheets=partialSheets();
  const row=sheets.factMonthly.find(r=>r[sheets.factMonthly[0].indexOf('매장')]==='일산' && r[1]===month);
  row[sheets.factMonthly[0].indexOf('총매출_2026')]='#REF!';
  const snapshot=await fetchSnapshot(partialSource(sheets));
  const api=createDashboardApi();api.setSourceSnapshot(snapshot);
  const stores=[...api.parseFactMonthly(snapshot.sheets.factMonthly)].map(([name,months])=>({name,months}));
  const portfolio=api.aggregatePortfolioMonths(stores).find(m=>m.monthNum===month);
  assert.equal(portfolio.gross,null);assert.equal(portfolio.net,null);assert.equal(portfolio.achievement,null);
  assert.equal(api.aggMonths([portfolio]).gross,null);
});

test('invalid subscription identity blanks its dates without hiding sales',async()=>{
  const sheets=partialSheets();
  sheets.factMonthly[1][sheets.factMonthly[0].indexOf('순증감_2026')]=999;
  const snapshot=await fetchSnapshot(partialSource(sheets));
  assert.equal(snapshot.readiness.cells['일산:1'].sales,true);
  assert.equal(snapshot.readiness.cells['일산:1'].subscription,false);
  assert.equal(snapshot.sheets.factMonthly[1][snapshot.sheets.factMonthly[0].indexOf('최신구독일_2026')],'');
});

test('pre-opening zero subscription rows do not suppress an operating portfolio',async()=>{
  const sheets=partialSheets();
  const row=sheets.factMonthly.find(r=>r[sheets.factMonthly[0].indexOf('매장')]==='안성' && r[1]===1);
  const head=sheets.factMonthly[0];
  for(const field of ['유지_2026','신규_2026','해지_2026','순증감_2026','MRR_2026','ARR_2026']) row[head.indexOf(field)]=0;
  for(const field of ['총매출_2026','환불_2026','순매출_2026','총사용_2026']) row[head.indexOf(field)]=0;
  row[head.indexOf('최신구독일_2026')]='';
  for(const key of ['salesQuality','usageQuality']) sheets[key].find(r=>r[0]==='안성' && r[1]===1)[8]='PREOPEN';
  const total=sheets.overallMonthly[1],totalHead=sheets.overallMonthly[0];
  for(const [field,value] of [['유지_2026',600],['신규_2026',12],['해지_2026',42]]) total[totalHead.indexOf(field)]=value;
  for(const [field,value] of [['총매출_2026',54000],['환불_2026',3000],['순매출_2026',51000],['총사용_2026',4200]]) total[totalHead.indexOf(field)]=value;
  const snapshot=await fetchSnapshot(partialSource(sheets));
  assert.equal(snapshot.readiness.months[0].subscription,true);
});

test('duplicate source keys and current audit blockers fail closed',async()=>{
  const sheets=partialSheets();sheets.factMonthly.push(sheets.factMonthly[1]);
  await assert.rejects(fetchSnapshot(partialSource(sheets)),{code:'SOURCE_PARTIAL_PENDING'});
  const blocked=partialSheets();blocked.cfg.find(r=>r[0]==='dashboard_audit_run_id')[1]='current-run';
  blocked.cfg.find(r=>r[0]==='dashboard_audit_blocking')[1]=2;
  await assert.rejects(fetchSnapshot(partialSource(blocked)),{code:'SOURCE_AUDIT_FAILED'});
});

test('a blocker published during the stability read cannot be bypassed',async()=>{
  await assert.rejects(fetchSnapshot(partialSource(partialSheets(),(sheets,read)=>{
    if(read===3) {
      sheets.cfg.find(r=>r[0]==='dashboard_audit_run_id')[1]='current-run';
      sheets.cfg.find(r=>r[0]==='dashboard_audit_blocking')[1]=1;
    }
  })),{code:'SOURCE_AUDIT_FAILED'});
});

test('a not-yet-written latest month does not suppress verified closed months',async()=>{
  if(month===1) return;
  const sheets=partialSheets();sheets.factMonthly=sheets.factMonthly.filter((row,i)=>!i || row[1]!==month);
  sheets.overallMonthly=sheets.overallMonthly.filter((row,i)=>!i || row[1]!==month);
  const snapshot=await fetchSnapshot(partialSource(sheets));
  assert.equal(snapshot.readiness.months.at(-1).sales,false);
  assert.equal(snapshot.readiness.months[0].sales,true);
});

test('bounded browser cache preserves source time and never re-saves fallback or previews',()=>{
  const api=createDashboardApi();let text;
  const storage={getItem:()=>text,setItem:(_,value)=>{text=value;}};
  const now=Date.now();
  const snapshot={schemaVersion:1,sheetId:'1QasrQPOZqq3ljxCXQWnGYEy40D8jhojJRFOWkVa6uxo',fetchedAt:new Date(now).toISOString(),
    readiness:{mode:'partial'},sheets:{factMonthly:[],overallMonthly:[],cfg:[['current_year',year],['current_month',month]]}};
  api.saveCachedSnapshot(snapshot,storage);
  assert.equal(api.readCachedSnapshot(storage,now).fetchedAt,snapshot.fetchedAt);
  assert.equal(api.readCachedSnapshot(storage,now+25*60*60*1000),null);
  const old=text;api.saveCachedSnapshot({...snapshot,preview:true},storage);assert.equal(text,old);
  api.saveCachedSnapshot({...snapshot,delivery:{mode:'cached'}},storage);assert.equal(text,old);
  text='broken';assert.equal(api.readCachedSnapshot(storage,now),null);
});

test('API retains last confirmed snapshot on transient errors, not auth failures or expired cache',async()=>{
  const {createHandler}=require('./api/data.js');const {SourceError}=require('./lib/sheets.cjs');
  const previous=process.env.DASHBOARD_TOKEN;process.env.DASHBOARD_TOKEN='cache-test';
  const now=Date.now();let time=now,fail=null;
  const snapshot={schemaVersion:1,fetchedAt:new Date(now).toISOString(),readiness:{mode:'complete'},sheets:{}};
  const handler=createHandler(async()=>{if(fail)throw new SourceError(fail,'safe message');return snapshot;},()=>time);
  const req={method:'GET',headers:{cookie:'ds_auth=cache-test'}};
  const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
  try {
    await handler(req,response());fail='SOURCE_TIMEOUT';const cached=response();await handler(req,cached);
    assert.equal(cached.code,200);assert.equal(cached.body.delivery.mode,'cached');assert.equal(cached.body.fetchedAt,snapshot.fetchedAt);
    fail='SOURCE_AUTH_INVALID';const auth=response();await handler(req,auth);assert.equal(auth.code,503);
    fail='SOURCE_ACCESS_DENIED';const revoked=response();await handler(req,revoked);assert.equal(revoked.code,503);
    fail='SOURCE_TIMEOUT';time=now+25*60*60*1000;const expired=response();await handler(req,expired);assert.equal(expired.code,503);
    const denied=response();await handler({...req,headers:{cookie:''}},denied);assert.equal(denied.code,401);
  } finally { if(previous===undefined) delete process.env.DASHBOARD_TOKEN;else process.env.DASHBOARD_TOKEN=previous; }
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
