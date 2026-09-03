const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, 'app.js');
const sheetId = '1QasrQPOZqq3ljxCXQWnGYEy40D8jhojJRFOWkVa6uxo';

const gids = {
  summary: 446178451,
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
      parseSummary, aggMonths, filterMonths, parseDataQuality, runDataQualityAudit,
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

async function loadSheet(gid, includeColumnHeaders = false, range = '') {
  const rangeQuery = range ? `&range=${encodeURIComponent(range)}` : '';
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}&headers=${includeColumnHeaders ? 1 : 0}${rangeQuery}`;
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

function metricClose(actual, expected, percentage = false) {
  const absTolerance = percentage ? 0.05 : 1;
  const relativeTolerance = percentage ? 1e-5 : 1e-7;
  return Math.abs(Number(actual || 0) - Number(expected || 0)) <=
    Math.max(absTolerance, Math.abs(Number(expected || 0)) * relativeTolerance);
}

function rawPercent(value) {
  const number = Number(value || 0);
  return Math.abs(number) <= 3 ? number * 100 : number;
}

function kstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { year:Number(values.year), month:Number(values.month), day:Number(values.day) };
}

async function main() {
  const api = createDashboardApi();
  const storeNames = Object.keys(gids.stores);
  const entries = await Promise.all([
    loadSheet(gids.summary, false, 'A1:B14'),
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
  const [summaryRows, opsRows, salesRows, subsRows, mrrRows, couponRows, dataCheckRows, factRows, overallMonthlyRows, ...storeRows] = entries;

  const factByStore = api.parseFactMonthly(factRows);
  const parsedStores = storeNames.map((name, index) => api.parseStore(name, storeRows[index]));
  const stores = parsedStores.map(store => api.mergeStoreWithFact(store, factByStore));
  const opsStores = api.parseOps(opsRows);
  const summaryKpis = api.parseSummary(summaryRows);
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
  const rawText = (row, key) => String(row[index[key]] ?? '').trim();
  const rawByMonth = new Map();
  const rawRows = factRows.slice(1).filter(row => row.some(value => String(value ?? '').trim() !== ''));
  rawRows.forEach(row => {
    const month = rawNumber(row, '월번호');
    if (!rawByMonth.has(month)) rawByMonth.set(month, []);
    rawByMonth.get(month).push(row);
  });
  const canonicalFinanceByMonth = api.parseOverallMonthly(overallMonthlyRows);

  const requiredFactHeaders = [
    '분기', '월번호', '월라벨', '매장', 'Capacity', '목표매출',
    '총매출_2026', '환불_2026', '순매출_2026', '총사용_2026',
    '단일구독매출_2026', '매장PASS_ARPU_2026',
    '신규_2026', '해지_2026', '유지_2026', '순증감_2026',
    '달성률_2026', '이탈률_2026', '환불율_2026', '가동률_2026',
    'MRR_2026', '경과일수_2026', '월일수_2026', 'MTD_Capacity_2026', 'ARR_2026'
  ];
  const requiredOverallHeaders = [
    '월번호', 'MRR_2026', 'MRR_2025', '유지_2026', '유지_2025',
    '신규_2026', '해지_2026', '올패스유지_2026', '올패스유지_2025',
    '경과일수_2026', '월일수_2026', '단일구독매출_2026',
    '매장PASS_ARPU_2026', 'ARR_2026'
  ];
  const overallHeaders = overallMonthlyRows[0] || [];
  const schemaIssues = [
    ...requiredFactHeaders.filter(name => !header.includes(name)).map(name => ({ source:'fact_monthly', missingHeader:name })),
    ...requiredOverallHeaders.filter(name => !overallHeaders.includes(name)).map(name => ({ source:'_overall_monthly', missingHeader:name }))
  ];

  const grainIssues = [];
  const factKeys = new Set();
  const maxFactMonth = Math.max(0, ...rawRows.map(row => rawNumber(row, '월번호')));
  rawRows.forEach(row => {
    const store = rawText(row, '매장');
    const month = rawNumber(row, '월번호');
    const key = `${store}|${month}`;
    if (!storeNames.includes(store) || month < 1 || month > 12) {
      grainIssues.push({ key, issue:'invalid store or month' });
    } else if (factKeys.has(key)) {
      grainIssues.push({ key, issue:'duplicate store-month key' });
    }
    factKeys.add(key);
  });
  storeNames.forEach(store => {
    const startMonth = store === '안성' ? 5 : 1;
    for (let month = startMonth; month <= maxFactMonth; month++) {
      const key = `${store}|${month}`;
      if (!factKeys.has(key)) grainIssues.push({ key, issue:'missing active store-month row' });
    }
  });

  const formulaIssues = [];
  const recordFormulaIssue = (row, formula, actual, expected, percentage = false) => {
    if (!metricClose(actual, expected, percentage)) {
      formulaIssues.push({
        key:`${rawText(row, '매장')}|${rawNumber(row, '월번호')}`,
        formula,
        actual:Number(actual || 0),
        expected:Number(expected || 0)
      });
    }
  };
  rawRows.forEach(row => {
    const month = rawNumber(row, '월번호');
    const gross = rawNumber(row, '총매출_2026');
    const refund = rawNumber(row, '환불_2026');
    const net = rawNumber(row, '순매출_2026');
    const usage = rawNumber(row, '총사용_2026');
    const retained = rawNumber(row, '유지_2026');
    const elapsedDays = rawNumber(row, '경과일수_2026');
    const sourceMonthDays = rawNumber(row, '월일수_2026');
    const exposureFactor = month === maxFactMonth && sourceMonthDays > 0
      ? Math.max(0, Math.min(1, elapsedDays / sourceMonthDays))
      : 1;
    const retainedExposure = retained * exposureFactor;
    const newSubs = rawNumber(row, '신규_2026');
    const cancels = rawNumber(row, '해지_2026');
    const netAdds = rawNumber(row, '순증감_2026');
    const capacity = rawNumber(row, 'Capacity');
    const mtdCapacity = rawNumber(row, 'MTD_Capacity_2026');
    const targetFull = rawNumber(row, '목표매출');
    const effectiveTarget = month === maxFactMonth && capacity > 0
      ? targetFull * Math.max(0, Math.min(1, mtdCapacity / capacity))
      : targetFull;
    const nonNegative = {
      gross, refund, net, usage, retained, newSubs, cancels,
      capacity, mtdCapacity,
      mrr:rawNumber(row, 'MRR_2026'),
      arr:rawNumber(row, 'ARR_2026')
    };
    Object.entries(nonNegative).forEach(([field, value]) => {
      if (value < 0) formulaIssues.push({
        key:`${rawText(row, '매장')}|${month}`,
        formula:`${field} nonnegative`,
        actual:value,
        expected:0
      });
    });
    recordFormulaIssue(row, 'net = gross - refund', net, gross - refund);
    recordFormulaIssue(row, 'net adds = new - cancels', netAdds, newSubs - cancels);
    recordFormulaIssue(row, 'utilization = usage / MTD capacity',
      rawPercent(rawNumber(row, '가동률_2026')),
      mtdCapacity > 0 ? usage / mtdCapacity * 100 : 0,
      true
    );
    recordFormulaIssue(row, 'refund rate = refund / gross',
      rawPercent(rawNumber(row, '환불율_2026')),
      gross > 0 ? refund / gross * 100 : 0,
      true
    );
    recordFormulaIssue(row, 'churn = cancels / subscriber-month exposure',
      rawPercent(rawNumber(row, '이탈률_2026')),
      retainedExposure > 0 ? cancels / retainedExposure * 100 : 0,
      true
    );
    recordFormulaIssue(row, 'store PASS ARPU = store PASS revenue / subscriber-month exposure',
      rawNumber(row, '매장PASS_ARPU_2026'),
      retainedExposure > 0 ? rawNumber(row, '단일구독매출_2026') / retainedExposure : 0
    );
    recordFormulaIssue(row, 'net achievement = net / elapsed target',
      rawPercent(rawNumber(row, '달성률_2026')),
      effectiveTarget > 0 ? net / effectiveTarget * 100 : 0,
      true
    );
    recordFormulaIssue(row, 'ARR = MRR x 12',
      rawNumber(row, 'ARR_2026'),
      rawNumber(row, 'MRR_2026') * 12
    );
    if (mtdCapacity > capacity + 1) {
      formulaIssues.push({
        key:`${rawText(row, '매장')}|${month}`,
        formula:'MTD capacity <= full capacity',
        actual:mtdCapacity,
        expected:capacity
      });
    }
    if (month < maxFactMonth) {
      recordFormulaIssue(row, 'closed month MTD capacity = full capacity', mtdCapacity, capacity);
    }
  });

  const discrepancies = [];
  const missingnessIssues = [];
  overall.forEach(month => {
    const rows = rawByMonth.get(month.monthNum) || [];
    const sum = key => rows.reduce((total, row) => total + rawNumber(row, key), 0);
    const canonical = canonicalFinanceByMonth.get(month.monthNum);
    const checks = {
      gross: sum('총매출_2026'),
      net: sum('순매출_2026'),
      usage: sum('총사용_2026'),
      retained: canonical?.retained || 0,
      newSubs: canonical?.newSubs || 0,
      cancelSubs: canonical?.cancelSubs || 0,
      netAdds: (canonical?.newSubs || 0) - (canonical?.cancelSubs || 0),
      mrr: canonical?.mrr || 0,
      mrrSubscribers: canonical?.mrrSubscribers || 0,
      mtdCapacity: sum('MTD_Capacity_2026')
    };
    Object.entries(checks).forEach(([key, expected]) => {
      const actual = Number(month[key] || 0);
      if (!closeEnough(actual, expected)) discrepancies.push({ month: month.month, key, actual, expected });
    });
    const subscriptionFields = ['retained','newSubs','cancelSubs','netAdds','churn','mrr','arpu','arr','ltv'];
    if (canonical?.hasSubscriptionData === false) {
      if (month.hasSubscriptionData !== false) {
        missingnessIssues.push({ month:month.month, issue:'missing subscription source not marked unavailable' });
      }
      subscriptionFields.forEach(field => {
        if (month[field] !== null) {
          missingnessIssues.push({ month:month.month, field, issue:'missing subscription source coerced to a value', actual:month[field] });
        }
      });
    }
  });

  const storeTabDiscrepancies = [];
  const storeFields = [
    ['gross', false], ['net', false], ['usage', false], ['retained', false],
    ['newSubs', false], ['cancelSubs', false], ['netAdds', false], ['mrr', false],
    ['utilization', true], ['refundRate', true], ['churn', true], ['achievement', true],
    ['arpu', false]
  ];
  parsedStores.forEach(store => {
    const canonicalMonths = factByStore.get(store.name) || [];
    canonicalMonths.forEach(expected => {
      const actual = store.months.find(month => month.monthNum === expected.monthNum);
      if (!actual) {
        storeTabDiscrepancies.push({ key:`${store.name}|${expected.monthNum}`, issue:'missing month in store detail tab' });
        return;
      }
      storeFields.forEach(([field, percentage]) => {
        if (!metricClose(actual[field], expected[field], percentage)) {
          storeTabDiscrepancies.push({
            key:`${store.name}|${expected.monthNum}`,
            field,
            actual:Number(actual[field] || 0),
            expected:Number(expected[field] || 0)
          });
        }
      });
    });
  });

  const opsDiscrepancies = [];
  const opsFields = [
    ['target', false], ['gross', false], ['net', false], ['usage', false],
    ['retained', false], ['newSubs', false], ['cancelSubs', false], ['netAdds', false],
    ['utilization', true], ['refundRate', true], ['churn', true], ['achievement', true]
  ];
  opsStores.forEach(actual => {
    const canonicalMonths = factByStore.get(actual.name) || [];
    const expected = canonicalMonths[canonicalMonths.length - 1];
    if (!expected) {
      opsDiscrepancies.push({ store:actual.name, issue:'missing canonical current month' });
      return;
    }
    opsFields.forEach(([field, percentage]) => {
      if (!metricClose(actual[field], expected[field], percentage)) {
        opsDiscrepancies.push({
          store:actual.name,
          field,
          actual:Number(actual[field] || 0),
          expected:Number(expected[field] || 0)
        });
      }
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
      grossAchievement: portfolio.grossAchievement || 0,
      sameStoreNetYoY: portfolio.netYoY || 0,
      totalNetGrowth: portfolio.totalNetGrowth || 0,
      utilization: portfolio.utilization || 0,
      churn: portfolio.churn || 0,
      mrr: portfolio.mrr || 0,
      retained: portfolio.retained || 0,
      allPassRetained: portfolio.allPassRetained || 0,
      mrrSubscribers: portfolio.mrrSubscribers || 0,
      arpu: portfolio.arpu || 0
    };
  }

  const summaryDiscrepancies = [];
  // Summary 상단은 기간 누적 Flow와 최신월 Stock이 혼합된 공식 요약 보드다.
  const cumulativePortfolio = api.aggMonths(overall) || {};
  const latestPortfolioMonth = overall[overall.length - 1] || {};
  const requiredSummaryChecks = [
    ['totalTarget', cumulativePortfolio.target, false],
    ['totalGross', cumulativePortfolio.gross, false],
    ['totalNet', cumulativePortfolio.net, false],
    ['achievement', cumulativePortfolio.achievement, true],
    ['grossAchievement', cumulativePortfolio.grossAchievement, true],
    ['refundRate', cumulativePortfolio.refundRate, true],
    ['sameStoreNetYoY', cumulativePortfolio.netYoY, true],
    ['totalNetGrowth', cumulativePortfolio.totalNetGrowth, true]
  ];
  if (summaryKpis.subscriptionAvailable !== false) {
    requiredSummaryChecks.push(
      ['totalNewSubs', cumulativePortfolio.newSubs, false],
      ['totalCancelSubs', cumulativePortfolio.cancelSubs, false],
      ['retained', cumulativePortfolio.retained, false]
    );
  }
  requiredSummaryChecks.forEach(([summaryField, expected, percentage]) => {
    const actual = summaryKpis[summaryField];
    if (actual === null || actual === undefined) {
      summaryDiscrepancies.push({ field:summaryField, issue:'missing required Summary value', expected });
    } else if (!metricClose(actual, expected, percentage)) {
      summaryDiscrepancies.push({ field:summaryField, actual, expected });
    }
  });
  if (summaryKpis.totalMrr !== null && summaryKpis.totalMrr !== undefined &&
      !metricClose(summaryKpis.totalMrr, latestPortfolioMonth.mrr, false)) {
    summaryDiscrepancies.push({
      field:'totalMrr',
      actual:summaryKpis.totalMrr,
      expected:latestPortfolioMonth.mrr
    });
  }

  const sourceHealthIssues = [];
  const sourceBlockingIssues = [];
  if (dataQuality.sourceCheckPending) {
    const issue = { issue:'data quality build is pending' };
    sourceHealthIssues.push(issue);
    sourceBlockingIssues.push(issue);
  }
  (dataQuality.warnings || []).forEach(check => {
    const issue = { issue:'data quality warning', name:check.name, value:check.value || check.status };
    sourceHealthIssues.push(issue);
    if (check.name === '차단 오류' || /차단|오류|실패/.test(check.status || '')) {
      sourceBlockingIssues.push(issue);
    }
  });
  const sourceDate = dataQuality.salesLatestDate;
  let sourceAgeDays = null;
  if (sourceDate instanceof Date && !Number.isNaN(sourceDate.getTime())) {
    const today = kstDateParts();
    sourceAgeDays = Math.max(0, Math.round((
      Date.UTC(today.year, today.month - 1, today.day) -
      Date.UTC(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate())
    ) / 86400000));
    if (sourceAgeDays > 1) {
      const issue = { issue:'sales source beyond previous-day SLA', sourceAgeDays };
      sourceHealthIssues.push(issue);
      sourceBlockingIssues.push(issue);
    }
  } else {
    const issue = { issue:'sales latest date unavailable' };
    sourceHealthIssues.push(issue);
    sourceBlockingIssues.push(issue);
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
    const differs = [
      ['gross', 1], ['net', 1], ['usage', 1], ['churn', 0.05], ['arpu', 1]
    ].some(([key, absoluteTolerance]) =>
      Math.abs(Number(legacy[key] || 0) - Number(derived[key] || 0)) >
      Math.max(absoluteTolerance, Math.abs(Number(derived[key] || 0)) * 0.001)
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
    sourceAgeDays,
    sourceHealthIssues,
    sourceBlockingIssues,
    schemaIssues,
    grainIssues,
    formulaIssues,
    missingnessIssues,
    storeTabDiscrepancies,
    opsDiscrepancies,
    summaryDiscrepancies,
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
    currentKpis: {
      month: latestPortfolioMonth.month || null,
      gross: latestPortfolioMonth.gross || 0,
      net: latestPortfolioMonth.net || 0,
      achievement: latestPortfolioMonth.achievement || 0,
      utilization: latestPortfolioMonth.utilization || 0,
      subscriptionAvailable: latestPortfolioMonth.hasSubscriptionData !== false,
      subscriptionSnapshotMonth: cumulativePortfolio.subscriptionSnapshotMonth || null,
      churn: latestPortfolioMonth.churn,
      arpu: latestPortfolioMonth.arpu,
      mrr: latestPortfolioMonth.mrr,
      retained: latestPortfolioMonth.retained
    },
    audit: dashboard.audit
  };
  console.log(JSON.stringify(result, null, 2));
  const blockingIssues = [
    ...schemaIssues,
    ...grainIssues,
    ...formulaIssues,
    ...missingnessIssues,
    ...discrepancies,
    ...storeTabDiscrepancies,
    ...opsDiscrepancies,
    ...summaryDiscrepancies,
    ...sourceBlockingIssues
  ];
  if (factByStore.size !== storeNames.length || legacyAggregateMismatchMonths || blockingIssues.length) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
