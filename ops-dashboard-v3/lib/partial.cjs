const STORES = ['일산','하남','고양','자유로','광명','성수','안성'];

function dateKey(value) {
  if (typeof value === 'number' && Number.isFinite(value))
    return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
  const match = String(value ?? '').match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}` : null;
}

function numeric(value) {
  return value !== '' && value != null && Number.isFinite(Number(value));
}
function close(a,b) {
  return numeric(a) && numeric(b) && Math.abs(Number(a)-Number(b)) <= Math.max(0.01,Math.abs(Number(b))*1e-9);
}
function indexRows(rows, nameColumn, monthColumn) {
  const headers = rows?.[0] || [];
  const at = (row,name) => row?.[headers.indexOf(name)];
  const indexed = new Map();
  for (const row of (rows || []).slice(1)) {
    const month = Number(at(row,monthColumn));
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    const key = nameColumn ? `${at(row,nameColumn)}:${month}` : String(month);
    if (indexed.has(key)) throw new Error('duplicate source key');
    indexed.set(key,row);
  }
  return { headers, at, indexed };
}

// Final audit is not yet available: publish only stable, reconciled source groups.
function preparePartial(sheets, build) {
  const cfg = Object.fromEntries(sheets.cfg || []);
  const facts = indexRows(sheets.factMonthly,'매장','월번호');
  const overall = indexRows(sheets.overallMonthly,null,'월번호');
  if (!facts.headers.includes('매장') || !overall.headers.includes('월번호')) throw new Error('missing source headers');
  const qualities = {};
  for (const key of ['salesQuality','salesQualityPrev','usageQuality','usageQualityPrev']) {
    const rows = sheets[key] || [];
    const runCol = rows[0]?.indexOf('실행본');
    qualities[key] = indexRows(runCol >= 0 && rows[1]?.[runCol] === build.runId ? rows : [],'매장','월');
  }
  const cells = {};
  const months = [];
  let available = 0;
  const year = Number(cfg.current_year);
  const currentMonth = Number(cfg.current_month);
  if (!Number.isInteger(year) || !Number.isInteger(currentMonth) || currentMonth < 1 || currentMonth > 12)
    throw new Error('missing source period');
  const sourceDate = (month,latest,y) => {
    const date = dateKey(latest);
    if (!date || Number(date.slice(0,4)) !== y || Number(date.slice(5,7)) < month) return null;
    return Number(date.slice(5,7)) === month ? date
      : `${y}-${String(month).padStart(2,'0')}-${new Date(Date.UTC(y,month,0)).getUTCDate()}`;
  };
  function qualityReady(key,store,month,row,y,usage) {
    const table = qualities[key];
    const q = table.indexed.get(`${store}:${month}`);
    if (!q || !row) return false;
    const get = name => table.at(q,name);
    if (!['OK','MISSING','PREOPEN'].includes(get('품질상태')) ||
        !['중복행','잘못된 값','매출 분해 불일치'].every(name=>numeric(get(name)) && Number(get(name))===0)) return false;
    if (get('품질상태') === 'PREOPEN') return (usage ? [`총사용_${y}`] : [`총매출_${y}`,`환불_${y}`,`순매출_${y}`])
      .every(name=>numeric(facts.at(row,name)) && Number(facts.at(row,name))===0);
    if (!(Number(get('수신일')) > 0)) return false;
    const factDate = usage ? sourceDate(month,cfg[y===year?'usage_local_latest_date':'usage_local_latest_date_2025'] ||
      (sheets[key]?.[1]?.[sheets[key][0]?.indexOf('원천 기준일')]),y) : dateKey(facts.at(row,`최신매출일_${y}`));
    if (!factDate || factDate !== dateKey(get('집계 기준일'))) return false;
    if (usage) return Number.isInteger(Number(facts.at(row,`총사용_${y}`))) && Number(facts.at(row,`총사용_${y}`))>=0 &&
      close(facts.at(row,`총사용_${y}`),get('관측 이용량'));
    const gross = facts.at(row,`총매출_${y}`) ?? facts.at(row,`실결제매출_${y}`);
    const refund = facts.at(row,`환불_${y}`);
    return Number(gross)>=0 && Number(refund)>=0 && close(gross,get('관측 결제매출')) && close(refund,get('관측 환불')) &&
      close(Number(gross)-Number(refund),facts.at(row,`순매출_${y}`)) &&
      close(['1회권매출','단일구독매출','올패스매출'].reduce((sum,name)=>sum+Number(facts.at(row,`${name}_${y}`)),0),gross);
  }
  for (let month=1;month<=currentMonth;month++) {
    const total = overall.indexed.get(String(month));
    const records = STORES.map(store=>facts.indexed.get(`${store}:${month}`));
    const group = {};
    for (const store of STORES) {
      const row = facts.indexed.get(`${store}:${month}`);
      const cap = facts.at(row,'Capacity') ?? facts.at(row,'Capacity_2026');
      const mtdCap = facts.at(row,'MTD_Capacity_2026');
      const target = facts.at(row,'목표매출') ?? facts.at(row,'목표매출_2026');
      const validDenominators = numeric(cap) && numeric(mtdCap) && numeric(target) &&
        Number(cap)>=0 && Number(mtdCap)>=0 && Number(mtdCap)<=Number(cap)+0.01 && Number(target)>=0;
      const cell = cells[`${store}:${month}`] = {
        sales:validDenominators && qualityReady('salesQuality',store,month,row,year,false),
        usage:validDenominators && qualityReady('usageQuality',store,month,row,year,true),
        salesPrev:qualityReady('salesQualityPrev',store,month,row,year-1,false),
        usagePrev:qualityReady('usageQualityPrev',store,month,row,year-1,true),
        subscription:false
      };
      const subscriptionDate = dateKey(facts.at(row,'최신구독일_2026'));
      const fields = ['유지_2026','신규_2026','해지_2026','MRR_2026','ARR_2026'];
      const preopen = ['salesQuality','usageQuality'].every(key=> {
        const q=qualities[key].indexed.get(`${store}:${month}`);
        return q && qualities[key].at(q,'품질상태')==='PREOPEN';
      }) && fields.every(name=>numeric(facts.at(row,name)) && Number(facts.at(row,name))===0);
      cell.subscription = Boolean(subscriptionDate && subscriptionDate===sourceDate(month,cfg.subscription_local_latest_date,year) &&
        fields.every(name=>numeric(facts.at(row,name)) && Number(facts.at(row,name))>=0) &&
        ['유지_2026','신규_2026','해지_2026'].every(name=>Number.isInteger(Number(facts.at(row,name)))) &&
        close(Number(facts.at(row,'신규_2026'))-Number(facts.at(row,'해지_2026')),facts.at(row,'순증감_2026')) &&
        close(Number(facts.at(row,'MRR_2026'))*12,facts.at(row,'ARR_2026')));
      if (preopen) cell.subscription=true;
    }
    for (const [name,fields] of [['sales',['총매출_2026','환불_2026','순매출_2026']],['usage',['총사용_2026']],
      ['salesPrev',['총매출_2025','환불_2025','순매출_2025']],['usagePrev',['총사용_2025']],
      ['subscription',['유지_2026','신규_2026','해지_2026']]]) {
      const sumMatches = fields.every(field=>close(records.reduce((sum,row)=>sum+Number(facts.at(row,field)),0),overall.at(total,field)));
      group[name] = sumMatches && STORES.every(store=>cells[`${store}:${month}`][name]);
      if (!sumMatches) STORES.forEach(store=>{ cells[`${store}:${month}`][name]=false; });
    }
    const totalDate = dateKey(overall.at(total,'최신구독일_2026'));
    group.subscription = group.subscription && Boolean(totalDate && totalDate===sourceDate(month,cfg.subscription_local_latest_date,year) &&
      numeric(overall.at(total,'MRR_2026')) && Number(overall.at(total,'MRR_2026'))>=0 &&
      numeric(overall.at(total,'올패스유지_2026')) && Number(overall.at(total,'올패스유지_2026'))>=0 &&
      Number.isInteger(Number(overall.at(total,'올패스유지_2026'))) &&
      close(Number(overall.at(total,'MRR_2026'))*12,overall.at(total,'ARR_2026')));
    if (!group.subscription) STORES.forEach(store=>{cells[`${store}:${month}`].subscription=false;});
    available += STORES.filter(store=> {
      const cell=cells[`${store}:${month}`];
      return (cell.sales || cell.usage) && ['salesQuality','usageQuality'].some(key=> {
        const q=qualities[key].indexed.get(`${store}:${month}`);
        return Number(qualities[key].at(q,'수신일'))>0;
      });
    }).length;
    months.push({month,...group});
  }
  if (!available) throw new Error('no reconciled source groups');
  const cleanFacts = sheets.factMonthly.map((row,i)=> {
    if (!i) return row;
    const copy = [...row];
    const cell = cells[`${facts.at(row,'매장')}:${facts.at(row,'월번호')}`];
    if (!cell) return copy;
    for (const name of ['달성률_2026','가동률_2026','환불율_2026','이탈률_2026',
      '운영기여매출_2026','올패스운영귀속매출_2026']) {
      const col = facts.headers.indexOf(name); if (col>=0) copy[col]='';
    }
    if (!cell.subscription) for (const name of ['최신구독일_2026','최신구독일_2025']) {
      const col = facts.headers.indexOf(name); if (col>=0) copy[col]='';
    }
    return copy;
  });
  const cleanOverall = sheets.overallMonthly.map((row,i)=> {
    if (!i || months.find(m=>m.month===Number(overall.at(row,'월번호')))?.subscription) return row;
    const copy = [...row];
    for (const name of ['최신구독일_2026','최신구독일_2025']) {
      const col=overall.headers.indexOf(name); if (col>=0) copy[col]='';
    }
    return copy;
  });
  return { sheets:{...sheets,factMonthly:cleanFacts,overallMonthly:cleanOverall,summary:[],coupon:[],ops:[],dataCheck:[]},
    readiness:{mode:'partial',cells,months,held:['coupon','contribution'],
      sourceDates:{sales:dateKey(cfg.sales_effective_latest_date),usage:dateKey(cfg.usage_local_latest_date),
        subscription:dateKey(cfg.subscription_local_latest_date)}} };
}

module.exports = { preparePartial, dateKey };
