const fs=require('node:fs');
const assert=require('node:assert/strict');
const {preparePartial}=require('./lib/partial.cjs');
const {buildState}=require('./lib/sheets.cjs');
const {createDashboardApi}=require('./validate-live.cjs');

const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const partial=preparePartial(input.sheets,buildState(input.sheets.cfg));
const snapshot={...input,...partial,build:buildState(input.sheets.cfg),preview:true};
const api=createDashboardApi();api.setSourceSnapshot(snapshot);
const stores=[...api.parseFactMonthly(snapshot.sheets.factMonthly)].map(([name,months])=>({name,months}));
const portfolio=api.applyPortfolioFinancials(api.aggregatePortfolioMonths(stores),snapshot.sheets.overallMonthly);
const raw=input.sheets.overallMonthly;
const at=(row,name)=>row[raw[0].indexOf(name)];
const near=(a,b)=>Math.abs(a-b)<Math.max(0.01,Math.abs(b)*1e-9);
const checks=[];
for (const month of portfolio.filter(m=>m.monthNum<=Number(Object.fromEntries(input.sheets.cfg).current_month))) {
  const source=raw.slice(1).find(row=>Number(at(row,'월번호'))===month.monthNum);
  const ready=partial.readiness.months.find(r=>r.month===month.monthNum);
  if (ready.sales) for(const [field,column] of [['gross','총매출_2026'],['net','순매출_2026'],['refundAmount','환불_2026']]) {
    assert(near(month[field],Number(at(source,column))),`${month.monthNum} ${field}`);
    checks.push({month:month.monthNum,metric:field,result:'match'});
  }
  if (month.hasUsageData) assert(near(month.usage,Number(at(source,'총사용_2026'))));
  else if (month.observedUsage!=null) assert(near(month.observedUsage,Number(at(source,'총사용_2026'))));
  if (ready.subscription) assert(near(month.mrr,Number(at(source,'MRR_2026'))));
}
assert.equal(stores.length,7);
assert.deepEqual(snapshot.sheets.coupon,[]);
if (process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(snapshot));
console.log(JSON.stringify({inputMode:'captured-source-policy-check',sourceBuild:snapshot.build.status,
  months:partial.readiness.months,financialChecks:checks.length,
  latest:portfolio.find(m=>m.monthNum===Number(Object.fromEntries(input.sheets.cfg).current_month)),
  output:process.argv[3] || null},null,2));
