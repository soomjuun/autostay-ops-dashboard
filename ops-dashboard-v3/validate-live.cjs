const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, 'app.js');
const sheetId = '1QasrQPOZqq3ljxCXQWnGYEy40D8jhojJRFOWkVa6uxo';

const gids = {
  ops: 638953343,
  sales: 1760990535,
  subs: 625947534,
  mrr: 2025485494,
  coupon: 2006396236,
  dataCheck: 830227479,
  factMonthly: 464978532,
  overallMonthly: 863402866,
  stores: {
    '일산': 2064859531,
    '하남': 916989893,
    '고양': 1437587407,
    '자유로': 650976822,
    '광명': 2128707766,
    '성수': 387245119,
    '안성': 1905150076
  }
};

function createDashboardApi() {
  let source = fs.readFileSync(appPath, 'utf8');
  source = source.replace(/parseHash\(\);\s*bindEvents\(\);\s*init\(\);\s*$/, '');
  source += `
    globalThis.__qa = {
      parseFactMonthly, parseOverallMonthly, applyPortfolioFinancials,
      mergeStoreWithFact, aggregatePortfolioMonths,
      parseStore, parseOps, parseOverall, applyPortfolioCouponDiscounts,
      aggMonths, filterMonths, parseDataQuality, runDataQualityAudit,
      runAudit, buildCapacityData,
      setDashboard: value => { dashboard = value; },
      setState: value => { state = value; }
    };
  `;

  function Chart() {}
  Chart.defaults = { plugins: { datalabels: {} }, font: {}, animation: {} };
  Chart.register = () => {};

  const document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ remove() {}, style: {} }),
    body: { appendChild() {} }
  };
  const sandbox = {
    Chart,
    ChartDataLabels: undefined,
    document,
    location: { hash: '', pathname: '/' },
    history: { replaceState() {} },
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Date,
    Math,
    Intl
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: appPath });
  return sandbox.__qa;
}

async function loadSheet(gid, includeColumnHeaders = false) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}&headers=${includeColumnHeaders ? 1 : 0}`;
  const response = await fetch(url, { headers: { 'user-agent': 'autostay-dashboard-validator/1.0' } });
  if (!response.ok) throw new Error(`sheet ${gid}: HTTP ${response.status}`);
  const text = await response.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`sheet ${gid}: invalid gviz response`);
  const payload = JSON.parse(text.slice(start, end + 1));
  if (payload.status !== 'ok') throw new Error(`sheet ${gid}: ${payload.errors?.[0]?.message || 'query failed'}`);
  const rows = (payload.table.rows || []).map(row => (row.c || []).map(cell => cell ? (cell.v ?? '') : ''));
  if (!includeColumnHeaders) return rows;
  const headers = (payload.table.cols || []).map(column => String(column?.label || '').trim());
  return [headers, ...rows];
}

function closeEnough(actual, expected) {
  return Math.abs(actual - expected) <= Math.max(1, Math.abs(expected) * 1e-9);
}

async function main() {
  const api = createDashboardApi();
  const storeNames = Object.keys(gids.stores);
  const entries = await Promise.all([
    loadSheet(gids.ops),
    loadSheet(gids.sales),
    loadSheet(gids.subs),
    loadSheet(gids.mrr),
    loadSheet(gids.coupon),
    loadSheet(gids.dataCheck),
    loadSheet(gids.factMonthly, true),
    loadSheet(gids.overallMonthly, true),
    ...storeNames.map(name => loadSheet(gids.stores[name]))
  ]);
  const [opsRows, salesRows, subsRows, mrrRows, couponRows, dataCheckRows, factRows, overallMonthlyRows, ...storeRows] = entries;

  const factByStore = api.parseFactMonthly(factRows);
  const stores = storeNames.map((name, index) =>
    api.mergeStoreWithFact(api.parseStore(name, storeRows[index]), factByStore)
  );
  const opsStores = api.parseOps(opsRows);
  const dataQuality = api.parseDataQuality(dataCheckRows);
  const legacyOverall = api.parseOverall(salesRows, subsRows, mrrRows);
  const financialOverall = api.applyPortfolioFinancials(
    api.aggregatePortfolioMonths(stores), overallMonthlyRows, legacyOverall
  );
  const overall = api.applyPortfolioCouponDiscounts(financialOverall, couponRows);
  const dashboard = {
    overall,
    stores: stores.map(store => ({ ...store, ops: opsStores.find(row => row.name === store.name) || {} })),
    opsStores,
    dataQuality,
    sourceStatus: { primary: factByStore.size ? 'fact_monthly' : 'store_detail' },
    audit: []
  };
  api.setDashboard(dashboard);

  const header = factRows[0];
  const index = Object.fromEntries(header.map((name, col) => [name, col]));
  const rawNumber = (row, key) => Number(row[index[key]] || 0);
  const rawByMonth = new Map();
  factRows.slice(1).forEach(row => {
    const month = rawNumber(row, '월번호');
    if (!rawByMonth.has(month)) rawByMonth.set(month, []);
    rawByMonth.get(month).push(row);
  });
  const canonicalFinanceByMonth = api.parseOverallMonthly(overallMonthlyRows);

  const discrepancies = [];
  overall.forEach(month => {
    const rows = rawByMonth.get(month.monthNum) || [];
    const sum = key => rows.reduce((total, row) => total + rawNumber(row, key), 0);
    const checks = {
      gross: sum('총매출_2026'),
      net: sum('순매출_2026'),
      usage: sum('총사용_2026'),
      retained: sum('유지_2026'),
      mrr: canonicalFinanceByMonth.get(month.monthNum)?.mrr || 0,
      mrrSubscribers: canonicalFinanceByMonth.get(month.monthNum)?.mrrSubscribers || 0,
      mtdCapacity: sum('MTD_Capacity_2026')
    };
    Object.entries(checks).forEach(([key, expected]) => {
      const actual = Number(month[key] || 0);
      if (!closeEnough(actual, expected)) discrepancies.push({ month: month.month, key, actual, expected });
    });
  });

  const periods = {};
  for (const period of ['all', 'H1', 'Q1', 'Q2', 'Q3']) {
    api.setState({ quarter: period, store: 'all' });
    const months = api.filterMonths(overall);
    const portfolio = api.aggMonths(months) || {};
    const storeAggregates = stores.map(store => api.aggMonths(api.filterMonths(store.months)) || {});
    const storeSum = key => storeAggregates.reduce((total, row) => total + Number(row[key] || 0), 0);
    const reconciliation = {
      gross: Number(portfolio.gross || 0) - storeSum('gross'),
      net: Number(portfolio.net || 0) - storeSum('net'),
      usage: Number(portfolio.usage || 0) - storeSum('usage')
    };
    Object.entries(reconciliation).forEach(([key, difference]) => {
      if (!closeEnough(difference, 0)) discrepancies.push({ period, key, difference });
    });
    periods[period] = {
      months: months.map(month => month.month),
      target: portfolio.target || 0,
      gross: portfolio.gross || 0,
      net: portfolio.net || 0,
      achievement: portfolio.achievement || 0,
      utilization: portfolio.utilization || 0,
      mrr: portfolio.mrr || 0,
      retained: portfolio.retained || 0,
      allPassRetained: portfolio.allPassRetained || 0,
      mrrSubscribers: portfolio.mrrSubscribers || 0,
      arpu: portfolio.arpu || 0
    };
  }

  api.setState({ quarter: 'all', store: 'all' });
  const capacityRows = api.buildCapacityData({ isAll: true, months: overall });
  const mtdCapacity = capacityRows.reduce((total, row) => total + Number(row.mtdDesignCap || 0), 0);
  const mtdUsage = capacityRows.reduce((total, row) => total + Number(row.mtdUsage || 0), 0);
  dashboard.audit = [...api.runAudit(overall, opsStores), ...api.runDataQualityAudit(dataQuality)];

  const legacyAggregateEmpty = legacyOverall.every(month =>
    !month.gross && !month.net && !month.usage && !month.mrr
  );
  const legacyAggregateMismatchMonths = legacyOverall.reduce((count, legacy, index) => {
    const derived = overall[index] || {};
    const differs = ['gross', 'net', 'usage'].some(key =>
      Math.abs(Number(legacy[key] || 0) - Number(derived[key] || 0)) >
      Math.max(1, Math.abs(Number(derived[key] || 0)) * 0.001)
    );
    return count + (differs ? 1 : 0);
  }, 0);
  const result = {
    checkedAt: new Date().toISOString(),
    factStoreCount: factByStore.size,
    legacyAggregateEmpty,
    legacyAggregateMismatchMonths,
    portfolioFinanceSource: overall.find(month => month.portfolioFinanceSource)?.portfolioFinanceSource || 'store_sum',
    sourceCheckPending: dataQuality.sourceCheckPending,
    couponCoverage: overall.map(month => ({
      month: month.month,
      amount: month.discountAmount || 0,
      mapped: Boolean(month.hasDiscountData),
      sheetRowPresent: Boolean(month.couponSheetPresent)
    })),
    discrepancies,
    periods,
    currentCapacity: {
      capacity: mtdCapacity,
      usage: mtdUsage,
      utilization: mtdCapacity > 0 ? mtdUsage / mtdCapacity * 100 : 0
    },
    audit: dashboard.audit
  };
  console.log(JSON.stringify(result, null, 2));
  if (factByStore.size !== storeNames.length || discrepancies.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
