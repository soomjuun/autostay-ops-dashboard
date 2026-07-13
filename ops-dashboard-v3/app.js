/* ═══════════════════════════════════════════════════════════
   [OPS] 직영점 운영 대시보드 — app.js v3 (새 폴더, 클린 빌드)
   ═══════════════════════════════════════════════════════════ */

/* ── 0. ChartDataLabels 전역 비활성화 ─────────────────────── */
if (typeof ChartDataLabels !== "undefined") {
  Chart.register(ChartDataLabels);
  Chart.defaults.plugins.datalabels.display = false;
}
Chart.defaults.font.family = "'Pretendard Variable', Pretendard, sans-serif";
Chart.defaults.color = "#74695d";
Chart.defaults.borderColor = "#efe8dc";
Chart.defaults.animation.duration = 550;

/* ── 1. 상수 ────────────────────────────────────────────────── */
const SHEET_ID = "1QasrQPOZqq3ljxCXQWnGYEy40D8jhojJRFOWkVa6uxo";
const GID = {
  summary:   446178451,
  ops:       638953343,
  sales:     1760990535,
  subs:      625947534,
  mrr:       2025485494,
  coupon:    2006396236,
  dataCheck: 830227479,    // 데이터 점검 시트
  factMonthly: 464978532,  // 최신 정규화 월·매장 원천
  overallMonthly: 863402866, // 전사 전용 Stock/MRR 원천 (단일 PASS + ALL PASS)
  stores: {
    ilsan:       { gid: 2064859531, name: "일산"  },
    hanam:       { gid: 916989893,  name: "하남"  },
    goyang:      { gid: 1437587407, name: "고양"  },
    jayuro:      { gid: 650976822,  name: "자유로" },
    gwangmyeong: { gid: 2128707766, name: "광명"  },
    seongsu:     { gid: 387245119,  name: "성수"  },
    anseong:     { gid: 1905150076, name: "안성"  }  // ★ 2026-05-15 오픈
  }
};
// ★ 현재 달까지만 포함 — 아직 시작하지 않은 달은 제외
const TODAY_MONTH = new Date().getMonth() + 1;   // 1-12
const QUARTERS = ['Q1','Q2','Q3','Q4'];
const PERIOD_FILTERS = ['all','H1', ...QUARTERS];
function quarterForMonth(monthNum) {
  return `Q${Math.ceil((+monthNum || 1) / 3)}`;
}
function quarterEndMonth(q) {
  const n = +String(q || '').replace('Q','') || 0;
  return n >= 1 && n <= 4 ? n * 3 : null;
}
function periodMatchesMonth(period, month) {
  if (period === 'all') return true;
  if (period === 'H1') return (month.monthNum || month.num || 0) >= 1 && (month.monthNum || month.num || 0) <= 6;
  return month.quarter === period;
}
function periodEndMonth(period) {
  if (period === 'H1') return 6;
  return quarterEndMonth(period);
}
const ALL_MONTH_SPECS = [
  { month:"1월", quarter:"Q1", cur:1, prev:2, yoy:3, mom:4, num:1 },
  { month:"2월", quarter:"Q1", cur:5, prev:6, yoy:7, mom:8, num:2 },
  { month:"3월", quarter:"Q1", cur:9, prev:10,yoy:11,mom:12,num:3 },
  { month:"4월", quarter:"Q2", cur:1, prev:2, yoy:3, mom:4, num:4 },
  { month:"5월", quarter:"Q2", cur:5, prev:6, yoy:7, mom:8, num:5 },
  { month:"6월", quarter:"Q2", cur:9, prev:10,yoy:11,mom:12,num:6 },
  { month:"7월", quarter:"Q3", cur:1, prev:2, yoy:3, mom:4, num:7 },
  { month:"8월", quarter:"Q3", cur:5, prev:6, yoy:7, mom:8, num:8 },
  { month:"9월", quarter:"Q3", cur:9, prev:10,yoy:11,mom:12,num:9 },
  { month:"10월", quarter:"Q4", cur:1, prev:2, yoy:3, mom:4, num:10 },
  { month:"11월", quarter:"Q4", cur:5, prev:6, yoy:7, mom:8, num:11 },
  { month:"12월", quarter:"Q4", cur:9, prev:10,yoy:11,mom:12,num:12 }
].filter(s => s.num <= TODAY_MONTH);
const MONTH_SPECS = ALL_MONTH_SPECS;
const PALETTE = {
  accent:"#8f4219", navy:"#24344f", green:"#216552",
  amber:"#c07b48",  rose:"#b24c58", teal:"#1d7a8a",
  violet:"#5a3f8c"
};
// ★ 운영 상수 ─────────────────────────────────────────────────────
const UNIT_PRICE_TARGET  = 14111;   // 손실 추정 매출 단가 (원/대)
const SEASON_BASE_USAGE  = 45741;   // 2025 기준 연평균 월 세차 대수 (계절지수 1.0 기준)
// 매장별 원천 월 Capacity. fact_monthly에 값이 있으면 해당 값을 우선한다.
const STORE_CAPACITY_RAW = {
  '광명': 16800, '하남': 14400, '자유로': 14400,
  '일산':  9600, '성수':  9600, '고양':   5760,
  '안성': 16800   // ★ 2026-05-15 오픈
};
const STORE_OPEN_DATES = {
  '안성': '2026-05-15'
};
// 하위 렌더러 호환용 별칭. 최신 시트에는 별도 0.85 보정 Capacity 정의가 없으므로
// 원천 Capacity와 동일하게 유지한다.
const STORE_CAPACITY = { ...STORE_CAPACITY_RAW };

// ★ 2025 실적 기반 계절지수 — 월별 기준선 (6개점 합산) ──────────────
// 출처: tickets(1회권) + ticket_subscription_use(구독) 2025-01-01~12-31
// 연 총 548,893대 · 월 평균 45,741대 (= SEASON_BASE_USAGE 확정)
const SEASON_MONTHLY_2025 = {
  1:48062, 2:55769, 3:56815, 4:51469, 5:50286, 6:46121,
  7:41985, 8:40297, 9:34296, 10:33610, 11:40809, 12:49374
};
// 6개점 합산 공식 계절지수 (해당 월 / 연 월평균 45,741)
const SEASON_IDX_2025 = {
  1:1.051, 2:1.219, 3:1.242, 4:1.125, 5:1.099, 6:1.008,
  7:0.918, 8:0.881, 9:0.750, 10:0.735, 11:0.892, 12:1.079
};
// 매장별 2025 월별 세차대수 — 시즌 민감도 분석 및 YoY 비교 기준
const SEASON_MONTHLY_2025_STORE = {
  '일산':   { 1:6632,  2:7734,  3:8035,  4:6903,  5:7375,  6:6361,  7:5529,  8:5288,  9:4267,  10:4368,  11:5409,  12:6385  },
  '고양':   { 1:4263,  2:4034,  3:3928,  4:3162,  5:3202,  6:2644,  7:2437,  8:1845,  9:1731,  10:1751,  11:1959,  12:2646  },
  '하남':   { 1:12594, 2:13520, 3:13331, 4:12246, 5:12434, 6:11224, 7:9416,  8:9745,  9:8041,  10:7960,  11:9185,  12:11597 },
  '성수':   { 1:7496,  2:9665,  3:9460,  4:9171,  5:7399,  6:8031,  7:7950,  8:7530,  9:6574,  10:6411,  11:8363,  12:10046 },
  '광명':   { 1:9725,  2:11727, 3:12450, 4:11259, 5:11281, 6:10110, 7:9424,  8:9384,  9:8122,  10:8023,  11:9737,  12:11164 },
  '자유로': { 1:7352,  2:9089,  3:9611,  4:8728,  5:8595,  6:7751,  7:7229,  8:6505,  9:5561,  10:5097,  11:6156,  12:7536  },
  '안성':   { 1:0,     2:0,     3:0,     4:0,     5:0,     6:0,     7:0,     8:0,     9:0,     10:0,     11:0,     12:0     }  // ★ 2026-05-15 오픈
};
// 매장별 2025 연간 세차대수 (월 평균 산출 기준)
const STORE_ANNUAL_2025 = {
  '일산':74286, '고양':33602, '하남':131293, '성수':98096, '광명':122406, '자유로':89210,
  '안성': 0   // ★ 2026-05-15 오픈
};

// ★ MTD 계산용 상수 / 헬퍼 ────────────────────────────────────────
const TODAY_DAY = new Date().getDate();   // 현재 경과 일수 (1~31)
function daysInMonth(monthNum, yr) {      // 해당 월의 총 일수
  return new Date(yr || new Date().getFullYear(), monthNum, 0).getDate();
}
function monthStatus(mNum) {              // 월 상태 판정
  if (mNum < TODAY_MONTH)  return 'confirmed';   // 확정 (마감 완료)
  if (mNum === TODAY_MONTH) return 'mtd';         // MTD (진행 중)
  return 'projected';                              // 예상 (미래, MONTH_SPECS에서 이미 제외됨)
}
const STATUS_LABEL = { confirmed:'확정', mtd:'MTD', projected:'예상' };
const STATUS_TIP   = {
  confirmed : '월마감 완료 데이터',
  mtd       : '현재일까지 누적 데이터 (Month-to-Date)',
  projected : '현재 추세를 월말까지 환산한 값'
};
// ★ 차트 x축 레이블: "4월 CLOSED" / "5월 MTD" 구분 표시
function chartMonthLabel(m) {
  const st = monthStatus(m.num);
  if (st === 'confirmed') return `${m.month} ✓`;
  if (st === 'mtd')       return `${m.month} MTD`;
  return m.month;
}

/* ── 2. 상태 ─────────────────────────────────────────────────── */
let state = { quarter:"all", store:"all" };
let dashboard = null;
const charts = {};

function getMtdDay() {
  const sourceDate = dashboard?.dataQuality?.salesLatestDate;
  if (sourceDate instanceof Date && !Number.isNaN(sourceDate.getTime())
      && sourceDate.getFullYear() === new Date().getFullYear()
      && sourceDate.getMonth() + 1 === TODAY_MONTH) {
    return sourceDate.getDate();
  }
  return TODAY_DAY;
}

/* ── 3. 포맷 헬퍼 ───────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const fmtW   = v => `${Math.round(+v||0).toLocaleString("ko-KR")}원`;
// fmtS: 정밀 표시 — ARPU 등 소수점 있는 만원 단위도 .1 자리까지 표시
const fmtS   = v => { const n=+v||0,a=Math.abs(n); if(a>=1e8) return `${(n/1e8).toFixed(1)}억`; if(a>=1e4){const m=n/1e4; return `${Number.isInteger(m)?m:m.toFixed(1)}만원`;} return `${Math.round(n).toLocaleString()}원`; };
const fmtA   = v => { const n=+v||0,a=Math.abs(n); return a>=1e8?`${(n/1e8).toFixed(1)}억`:a>=1e4?`${Math.round(n/1e4)}만`:String(Math.round(n)); };
const fmtN   = v => `${Math.round(+v||0).toLocaleString("ko-KR")}`;
const fmtP   = v => `${(+v||0).toFixed(1)}%`;
const fmtP1  = v => `${(+v||0).toFixed(1)}%`;
const tx     = v => String(v??'').replace(/\s+/g,' ').trim();
const num    = v => typeof v==='number'?v:+(String(v??'').replace(/[^\d.-]/g,''))||0;
// ★ pct() 핵심 로직:
//  gviz는 % 서식 셀을 소수로 반환  → 0.16 (16%), 1.182 (118.2%)
//  일반 숫자 셀로 저장된 % 값은 원본 그대로 반환 → 16, 99.8, 118.2
//  임계값 |v| ≤ 3 이면 소수 형태 → ×100 / |v| > 3 이면 이미 % 형태 → as-is
const pct = v => {
  if (typeof v === 'number') return Math.abs(v) <= 3 ? v * 100 : v;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  if (s.includes('%')) return parseFloat(s) || 0;     // "118.2%" → 118.2
  const n = parseFloat(s.replace(/[^\d.-]/g,'')) || 0;
  return Math.abs(n) <= 3 ? n * 100 : n;
};

/* ── 4. URL 해시 ────────────────────────────────────────────── */
function parseHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/,''));
  const s = p.get('store'), q = p.get('quarter');
  if (s) state.store = s;
  if (q && PERIOD_FILTERS.includes(q)) state.quarter = q;
}
function syncHash() {
  const p = new URLSearchParams();
  if (state.store !== 'all') p.set('store', state.store);
  if (state.quarter !== 'all') p.set('quarter', state.quarter);
  const h = p.toString();
  history.replaceState(null,'', h ? `#${h}` : location.pathname);
}
function syncPeriodToggleActive() {
  const wrap = $('quarterToggle');
  if (!wrap) return;
  wrap.querySelectorAll('button').forEach(btn => {
    const value = btn.dataset.q || btn.dataset.quarter;
    btn.classList.toggle('active', value === state.quarter);
  });
}

/* ── 5. JSONP 로더 ──────────────────────────────────────────── */
// ★ Change 6: 시트 실패 추적
const _failedSheets = new Set();

function loadSheet(gid, includeColumnHeaders=false) {
  return new Promise((resolve, reject) => {
    const cb = `cb_${gid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sc = document.createElement('script');
    const tm = setTimeout(()=>{ cleanup(); _failedSheets.add(gid); reject(new Error(`timeout:${gid}`)); }, 18000);
    function cleanup(){ clearTimeout(tm); delete window[cb]; sc.remove(); }
    window[cb] = payload => {
      cleanup();
      _failedSheets.delete(gid);
      if (!payload || payload.status !== 'ok') { _failedSheets.add(gid); reject(new Error(`err:${gid}`)); return; }
      const rows = (payload.table.rows||[]).map(r=>(r.c||[]).map(c=>c?c.v??'':''));
      if (includeColumnHeaders) {
        const headers = (payload.table.cols || []).map(c => tx(c?.label || ''));
        resolve([headers, ...rows]);
      } else {
        resolve(rows);
      }
    };
    sc.onerror = ()=>{ cleanup(); _failedSheets.add(gid); reject(new Error(`load:${gid}`)); };
    sc.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=responseHandler:${cb};out:json&gid=${gid}&headers=${includeColumnHeaders?1:0}`;
    document.body.appendChild(sc);
  });
}

// ★ Change 6: 느린 로딩 경고 (15초 후)
let _slowLoadTimer = null;
function startSlowLoadTimer() {
  clearTimeout(_slowLoadTimer);
  _slowLoadTimer = setTimeout(() => {
    const loadText = $('loadText');
    if (loadText) loadText.innerHTML = '스프레드시트에서 데이터를 불러오는 중…<br><span style="color:#c07b48;font-size:12px;font-weight:600">⚠ 시트 연결 확인 필요 — 연결이 오래 걸리고 있습니다</span>';
  }, 15000);
}
function clearSlowLoadTimer() { clearTimeout(_slowLoadTimer); }

/* ── 6. 파싱 유틸 ───────────────────────────────────────────── */
function qIdx(rows, label) {
  return rows.findIndex(r => tx(r[0]) === label);
}
function qSectionIdx(rows, label) {
  const exact = qIdx(rows, label);
  if (exact >= 0) return exact;
  const normalized = tx(label);
  return rows.findIndex(r => {
    const v = tx(r[0]);
    return v === normalized || v === `${normalized} 상세` || v === `${normalized}상세`;
  });
}
function qDetailSectionIdx(rows, label) {
  const normalized = tx(label);
  const detail = rows.findIndex(r => {
    const v = tx(r[0]);
    return v === `${normalized} 상세` || v === `${normalized}상세`;
  });
  return detail >= 0 ? detail : qSectionIdx(rows, label);
}
function mRows(rows, idx) {
  const m = new Map();
  // idx=-2는 Q1 레이블 없이 시트 최상단부터 데이터가 시작하는 구조를 의미한다.
  if (idx < 0 && idx !== -2) return m;
  let emptyStreak = 0;
  for (let i = idx+2; i < rows.length; i++) {
    const k = tx(rows[i][0]);
    if (!k) { emptyStreak++; if (emptyStreak >= 2) break; continue; } // 빈 행 1개는 허용
    emptyStreak = 0;
    if (/^Q[1-4]/.test(k) || ['당월 스냅샷','YTD 누적','매장','스냅샷','현황','Summary'].includes(k)) break;
    m.set(k, rows[i]);
  }
  return m;
}
function mv(map, key, col, fn=num) {
  const r = map.get(key); return r ? fn(r[col]) : 0;
}
function fuzzyAliasMatch(actualKey, expectedKey) {
  const actual = tx(actualKey);
  const expected = tx(expectedKey);
  if (!actual || !expected) return false;
  const expectedGross = expected.includes('실결제매출') || expected.includes('총매출') || expected.includes('Gross') || expected.includes('Paid');
  const actualGross = actual.startsWith('실결제매') && (actual.includes('총매출') || actual.includes('구 총매출'));
  if (expectedGross && actualGross) return true;

  const expectedGrossAchievement = expected.includes('실결제매출') && expected.includes('달성');
  const actualGrossAchievement = actual.startsWith('실결제매') && actual.includes('달성');
  return expectedGrossAchievement && actualGrossAchievement;
}
// 여러 키 별칭 시도 (시트 표기 불일치 대응: 이탈률/이탈율, 환불율/환불률 등)
function mvAlias(map, keys, col, fn=num) {
  for (const k of keys) {
    const r = map.get(k);
    if (r !== undefined && r[col] !== undefined && String(r[col]).trim() !== '') return fn(r[col]);
  }
  for (const k of keys) {
    for (const [actualKey, r] of map.entries()) {
      if (fuzzyAliasMatch(actualKey, k) && r[col] !== undefined && String(r[col]).trim() !== '') return fn(r[col]);
    }
  }
  return 0;
}

const GROSS_REVENUE_KEYS = [
  '실결제매출(구 총매출)',
  '실결제매출',
  '총매출',
  'Gross Revenue',
  'Paid Revenue'
];
const GROSS_ACHIEVEMENT_KEYS = [
  '실결제매출 달성률',
  '실결제매출달성률',
  '달성률(실결제매출)',
  '총매출 달성률',
  '총매출달성률',
  '달성률(총매출)',
  'Gross Achievement'
];

function buildMonth(label, quarter, salesM, subM, mrrM, spec) {
  const retained   = mv(subM, '유지', spec.cur);
  const cancelSubs = mv(subM, '해지', spec.cur);
  // 이탈률: 시트에 직접 기재된 값 우선, 없으면 해지/유지로 계산
  const churnRaw   = mvAlias(subM, ['이탈률','이탈율','이탈율(%)','이탈률(%)'], spec.cur, pct);
  const churn      = churnRaw > 0 ? churnRaw : (retained > 0 && cancelSubs > 0 ? cancelSubs / retained * 100 : 0);
  const target     = mv(salesM,'목표매출', spec.cur);
  const gross      = mvAlias(salesM, GROSS_REVENUE_KEYS, spec.cur);
  const net        = mv(salesM,'순매출',   spec.cur);
  const netAchievementRaw   = mvAlias(salesM,['달성률','달성율','달성률(순매출)','순매출 달성률','순매출달성률'], spec.cur, pct);
  const grossAchievementRaw = mvAlias(salesM, GROSS_ACHIEVEMENT_KEYS, spec.cur, pct);
  return {
    month: label, quarter,
    target,
    gross,
    grossPrev:    mvAlias(salesM, GROSS_REVENUE_KEYS, spec.prev),
    grossYoY:     mvAlias(salesM, GROSS_REVENUE_KEYS, spec.yoy, pct),
    achievement:  netAchievementRaw || (target ? net / target * 100 : 0),
    grossAchievement: grossAchievementRaw || (target ? gross / target * 100 : 0),
    net,
    netPrev:      mv(salesM,'순매출',     spec.prev),
    netYoY:       mv(salesM,'순매출',     spec.yoy, pct),
    usage:        mvAlias(salesM,['총사용','사용건수','총이용'],          spec.cur),
    // 할인은 전용 원천 행이 있을 때만 사용한다. 환불을 할인으로 대체하면
    // 환불이 이중 집계되어 수익 구성 비중이 왜곡된다.
    discountAmount: mv(salesM,'할인금액', spec.cur),
    discountShare:  mvAlias(salesM,['할인비중','할인율','할인비율'], spec.cur, pct),
    hasDiscountData: salesM.has('할인금액') || ['할인비중','할인율','할인비율'].some(k => salesM.has(k)),
    refundAmount: mvAlias(salesM,['환불금액','환불액'], spec.cur),
    refundRate:   mvAlias(salesM,['환불율','환불률','환불비율'],           spec.cur, pct),
    utilization:  mvAlias(salesM,['가동률','가동율','이용률'],             spec.cur, pct),
    retained, retainedPrev: mv(subM, '유지', spec.prev),
    newSubs:      mv(subM,  '신규',       spec.cur),
    cancelSubs,
    netAdds:      mv(subM,  '순증감',     spec.cur),
    churn,
    mrr:          mv(mrrM,  'MRR',        spec.cur),
    mrrPrev:      mv(mrrM,  'MRR',        spec.prev),
    mrrYoY:       mv(mrrM,  'MRR',        spec.yoy, pct),
    arr:          mv(mrrM,  'ARR',        spec.cur),
    arrPrev:      mv(mrrM,  'ARR',        spec.prev),
    arrYoY:       mv(mrrM,  'ARR',        spec.yoy, pct),
    ltv:          mv(mrrM,  'LTV(추정)',   spec.cur),
    ltvPrev:      mv(mrrM,  'LTV(추정)',   spec.prev),
    // ★ 월별 ARPU: MRR/유지 우선, 없으면 순매출/총사용 역산
    arpu: (()=>{
      const mrrVal = mv(mrrM, 'MRR', spec.cur);
      const retVal = mv(subM, '유지', spec.cur);
      if (mrrVal > 0 && retVal > 0) return mrrVal / retVal;
      const nVal = net;
      const uVal = mvAlias(salesM, ['총사용','사용건수','총이용'], spec.cur);
      return (nVal > 0 && uVal > 0) ? nVal / uVal : 0;
    })(),
    // ★ 월 상태 (confirmed/mtd/projected) — Capacity·계절지수 계산 정합성 기준
    monthNum: spec.num || 0,
    status:   spec.num ? monthStatus(spec.num) : 'confirmed',
    // ★ 계절 지수 = 해당 월 세차 대수 / 연평균 월 세차 대수 (확정월 기준으로만 공식 해석)
    get seasonIdx() { return SEASON_BASE_USAGE > 0 ? (this.usage / SEASON_BASE_USAGE) : 0; }
  };
}

// ★ Q1 섹션 레이블 없이 시트 최상단부터 데이터가 시작하는 경우 처리
//    (매출/구독/MRR 시트 모두 Q1 헤더 행 없이 row 0 = 첫 지표)
//    qIdx가 -1 → idx=-2 → mRows 시작 i=idx+2=0 (Q2 레이블에서 자동 중단)
function q1Fallback(rows) { const i = qSectionIdx(rows,'Q1'); return i >= 0 ? i : -2; }
function quarterRows(rows, quarter) {
  const detailIdx = qDetailSectionIdx(rows, quarter);
  if (detailIdx >= 0) return mRows(rows, detailIdx);
  return mRows(rows, quarter === 'Q1' ? q1Fallback(rows) : qSectionIdx(rows, quarter));
}
function quarterRowMaps(rows) {
  return QUARTERS.reduce((acc, q) => {
    acc[q] = quarterRows(rows, q);
    return acc;
  }, {});
}

function parseOverall(salesR, subR, mrrR) {
  const salesByQuarter = quarterRowMaps(salesR);
  const subsByQuarter = quarterRowMaps(subR);
  const mrrByQuarter = quarterRowMaps(mrrR);
  return MONTH_SPECS.map(sp => buildMonth(
    sp.month, sp.quarter,
    salesByQuarter[sp.quarter] || new Map(),
    subsByQuarter[sp.quarter] || new Map(),
    mrrByQuarter[sp.quarter] || new Map(),
    sp
  ));
}

function applyPortfolioCouponDiscounts(months, couponRows) {
  const couponsByQuarter = quarterRowMaps(couponRows);
  months.forEach((m, i) => {
    const sp = MONTH_SPECS[i];
    const source = couponsByQuarter[sp.quarter] || new Map();
    const hasCouponRow = source.has('쿠폰할인금액');
    const couponDiscount = mv(source, '쿠폰할인금액', sp.cur);
    const canMapToPreCouponEstimate = hasCouponRow && couponDiscount > 0 && m.gross > 0;
    const mappedDiscount = canMapToPreCouponEstimate ? couponDiscount : 0;
    const listPriceRevenue = m.gross + mappedDiscount;
    m.discountAmount = mappedDiscount;
    m.discountShare = listPriceRevenue > 0 ? mappedDiscount / listPriceRevenue * 100 : 0;
    m.hasDiscountData = canMapToPreCouponEstimate;
    m.couponSheetPresent = hasCouponRow;
    m.hasCouponSourceData = couponDiscount > 0;
    m.unmappedCouponDiscount = canMapToPreCouponEstimate ? 0 : couponDiscount;
    m.discountScope = canMapToPreCouponEstimate ? 'portfolio_coupon' : null;
    m.discountBasis = canMapToPreCouponEstimate ? 'pre_coupon_estimate' : null;
    m.listPriceRevenue = listPriceRevenue;
  });
  return months;
}

function parseOps(rows) {
  const idx = rows.findIndex(r => tx(r[0]) === '매장');
  const items = [];
  const knownStoreNames = new Set(Object.values(GID.stores).map(s => s.name));
  const startRow = idx >= 0 ? idx + 1 : rows.findIndex(r => knownStoreNames.has(tx(r[0])));
  if (startRow < 0) return items;
  for (let i = startRow; i < rows.length; i++) {
    const name = tx(rows[i][0]); if (!name) break;
    if (!knownStoreNames.has(name)) continue;

    // ─── 컬럼 매핑 (gviz 실제 데이터 확인 기준) ─────────────────────
    // col0 : 매장명
    // col1 : 목표매출
    // col2 : 총매출(gross)
    // col3 : 달성률 (소수, 0.7199 → 71.99%)
    // col4 : 순매출(net)
    // col5 : 총사용(세차 건수)
    // col6 : 유지 가입자 수(명)
    // col7 : 신규 가입자
    // col8 : 해지 가입자
    // col9 : 환불율 (소수, 0.0282 → 2.82%)
    // col10: 이탈률 (소수, 0.1087 → 10.87%)
    // col11: 순증감
    // col12: ARPU (원)
    // col13: 가동률 (소수, 0.6787 → 67.87%)
    // col14: 판정 (텍스트, '주의/달성률' 등) — 최신 시트에서는 생략 가능
    // col15-16: null
    // ────────────────────────────────────────────────────────────────

    const target       = num(rows[i][1]);
    const gross        = num(rows[i][2]);
    const net          = num(rows[i][4]);
    const usageVal     = num(rows[i][5]);
    const retained     = num(rows[i][6]);
    const refundRate   = pct(rows[i][9]);   // 소수 → %, pct() 자동 처리
    const churn        = pct(rows[i][10]);  // 소수 → %, pct() 자동 처리
    // [통일] 가동률 단일 소스: ops시트 col13 — 매장 레벨 가동률의 권위 값
    const utilizationVal = pct(rows[i][13]);// 소수 → %, pct() 자동 처리

    // 파생 계산
    const discountAmount = 0;
    const discountShare  = 0;
    const cancelSubs     = num(rows[i][8]);

    // 운영 인사이트의 가동률에서 현재 MTD Capacity를 역산한다.
    const sourceCapacity = utilizationVal > 0 ? usageVal / (utilizationVal / 100) : 0;
    const rawCap = sourceCapacity || STORE_CAPACITY_RAW[name] || 0;
    const cap = rawCap;
    const idleCount    = Math.max(0, sourceCapacity - usageVal);
    const lossEstimate = idleCount * UNIT_PRICE_TARGET;

    const utilizationRaw = utilizationVal;
    const netAchievement = pct(rows[i][3]) || (target > 0 ? net / target * 100 : 0);

    items.push({
      name,
      target,         gross,
      achievement:    netAchievement,  net,
      grossAchievement: target > 0 ? gross / target * 100 : 0,
      discountAmount, discountShare, hasDiscountData: false,
      refundAmount: Math.max(0, gross - net),
      usage:          usageVal,         utilization: utilizationVal,
      utilizationRaw,
      refundRate,     retained,
      newSubs:        num(rows[i][7]),  cancelSubs,
      netAdds:        num(rows[i][11]), arpu:        num(rows[i][12]),
      status:         tx(rows[i][14]) || '운영 중',
      churn,
      // ★ 파싱 플래그 — 정상 컬럼 매핑으로 항상 false (하위 호환성 유지)
      _refundParseFlag: false,
      _churnParseFlag:  false,
      _refundRawVal:    0,
      // ★ 가동률 심층 분석
      rawCapacity: rawCap,
      capacity:    cap,
      idleCount,
      lossEstimate
    });
  }
  return items;
}

function parseStore(name, rows) {
  // 스냅샷 섹션 레이블: '당월 스냅샷' or '스냅샷' or '현황'
  const snapIdx = ['당월 스냅샷','스냅샷','현황','Summary'].reduce((f,l)=>f>=0?f:qIdx(rows,l),-1);
  const snap = mRows(rows, snapIdx);
  // 분기 상세 섹션 레이블 유연 처리
  const byQuarter = quarterRowMaps(rows);
  const curSpec = { cur:1, prev:2, yoy:3, mom:0, num:TODAY_MONTH };
  // ★ mrrM에 src(동일 섹션 맵) 전달 — 매장 개별 시트의 MRR 행을 직접 파싱
  //   gviz 확인: Q1 row35 'MRR' 컬럼 레이아웃이 MONTH_SPECS cur/prev/yoy와 완전 일치
  //   수정 전: em=new Map() 전달 → mrr/mrrPrev/mrrYoY 모두 0 (빈 맵)
  //   수정 후: src 전달 → 실제 MRR 데이터 파싱 (53,196,260원 등)
  const months = MONTH_SPECS.map(sp => {
    const src = byQuarter[sp.quarter] || new Map();
    return buildMonth(sp.month, sp.quarter, src, src, src, sp);
  });
  const currentQuarter = quarterForMonth(TODAY_MONTH);
  return { name, current: buildMonth(`${TODAY_MONTH}월`,currentQuarter,snap,snap,snap,curSpec), months };
}

function factValue(row, headerIndex, keys, fn=num) {
  for (const key of keys) {
    const col = headerIndex.get(key);
    if (col === undefined) continue;
    const value = row[col];
    if (value !== undefined && value !== null && String(value).trim() !== '') return fn(value);
  }
  return 0;
}

// 최신 시트의 정규화 원천(fact_monthly)을 월·매장 데이터 모델로 변환한다.
// 표시용 분석 탭이 재생성 중 0으로 남아도 이 원천과 매장 상세를 통해 대시보드를 복구한다.
function parseFactMonthly(rows) {
  const headerRowIdx = rows.findIndex(r => tx(r[0]) === '분기' && r.some(v => tx(v) === '월번호'));
  if (headerRowIdx < 0) return new Map();

  const headers = rows[headerRowIdx].map(tx);
  const headerIndex = new Map(headers.map((h, i) => [h, i]));
  const knownStoreNames = new Set(Object.values(GID.stores).map(s => s.name));
  const byStore = new Map();

  rows.slice(headerRowIdx + 1).forEach(row => {
    const storeName = tx(row[headerIndex.get('매장')]);
    const monthNum = factValue(row, headerIndex, ['월번호']);
    if (!knownStoreNames.has(storeName) || monthNum < 1 || monthNum > TODAY_MONTH) return;

    const quarter = tx(row[headerIndex.get('분기')]) || quarterForMonth(monthNum);
    const month = tx(row[headerIndex.get('월라벨')]) || `${monthNum}월`;
    const status = monthStatus(monthNum);
    const fullCapacity = factValue(row, headerIndex, ['Capacity', 'Capacity_2026']);
    const mtdCapacity = factValue(row, headerIndex, ['MTD_Capacity_2026']) || fullCapacity;
    const targetFull = factValue(row, headerIndex, ['목표매출', '목표매출_2026']);
    const targetProgress = status === 'mtd' && fullCapacity > 0
      ? Math.max(0, Math.min(1, mtdCapacity / fullCapacity))
      : 1;
    const target = targetFull * targetProgress;
    const gross = factValue(row, headerIndex, ['실결제매출_2026', '총매출_2026']);
    const grossPrev = factValue(row, headerIndex, ['실결제매출_2025', '총매출_2025']);
    const net = factValue(row, headerIndex, ['순매출_2026']);
    const netPrev = factValue(row, headerIndex, ['순매출_2025']);
    const refundAmount = factValue(row, headerIndex, ['환불_2026', '환불금액_2026']);
    const usage = factValue(row, headerIndex, ['총사용_2026']);
    const retained = factValue(row, headerIndex, ['유지_2026']);
    const retainedPrev = factValue(row, headerIndex, ['유지_2025']);
    const cancelSubs = factValue(row, headerIndex, ['해지_2026']);
    const mrr = factValue(row, headerIndex, ['MRR_2026']);
    const mrrPrev = factValue(row, headerIndex, ['MRR_2025']);
    const achievementRaw = factValue(row, headerIndex, ['달성률_2026'], pct);
    const utilizationRaw = factValue(row, headerIndex, ['가동률_2026'], pct);
    const churnRaw = factValue(row, headerIndex, ['이탈률_2026'], pct);
    const refundRateRaw = factValue(row, headerIndex, ['환불율_2026'], pct);
    const seasonIdxConfirmed = factValue(row, headerIndex, ['계절지수_확정_2026']);
    const seasonIdxMtd = factValue(row, headerIndex, ['계절지수_MTD_2026']);
    const seasonIdxProjected = factValue(row, headerIndex, ['계절지수_예상_2026']);

    const item = {
      month, monthNum, quarter, status,
      target, targetFull,
      gross, grossPrev,
      grossYoY: grossPrev > 0 ? (gross - grossPrev) / grossPrev * 100 : 0,
      net, netPrev,
      netYoY: netPrev > 0 ? (net - netPrev) / netPrev * 100 : 0,
      achievement: achievementRaw || (target > 0 ? net / target * 100 : 0),
      grossAchievement: target > 0 ? gross / target * 100 : 0,
      refundAmount,
      refundRate: refundRateRaw || (gross > 0 ? refundAmount / gross * 100 : 0),
      usage,
      utilization: utilizationRaw || (mtdCapacity > 0 ? usage / mtdCapacity * 100 : 0),
      utilizationRaw: utilizationRaw || (mtdCapacity > 0 ? usage / mtdCapacity * 100 : 0),
      capacity: fullCapacity,
      mtdCapacity,
      elapsedDays: factValue(row, headerIndex, ['경과일수_2026']),
      daysInSourceMonth: factValue(row, headerIndex, ['월일수_2026']),
      retained, retainedPrev,
      newSubs: factValue(row, headerIndex, ['신규_2026']),
      cancelSubs,
      netAdds: factValue(row, headerIndex, ['순증감_2026']),
      churn: churnRaw || (retained > 0 ? cancelSubs / retained * 100 : 0),
      mrr, mrrPrev,
      mrrYoY: mrrPrev > 0 ? (mrr - mrrPrev) / mrrPrev * 100 : 0,
      arr: factValue(row, headerIndex, ['ARR_2026']),
      arrPrev: factValue(row, headerIndex, ['ARR_2025']),
      ltv: factValue(row, headerIndex, ['LTV_추정_2026']),
      ltvPrev: factValue(row, headerIndex, ['LTV_추정_2025']),
      arpu: factValue(row, headerIndex, ['매장PASS_ARPU_2026']),
      discountAmount: 0,
      discountShare: 0,
      hasDiscountData: false,
      listPriceRevenue: gross,
      seasonBase: factValue(row, headerIndex, ['계절기준선_2026']),
      seasonIdxConfirmed,
      seasonIdxMtd,
      seasonIdxProjected,
      seasonIdx: status === 'mtd' ? seasonIdxMtd : seasonIdxConfirmed,
      lossUnitPrice: factValue(row, headerIndex, ['손실단가_2026']),
      idleMtd: factValue(row, headerIndex, ['미가동대수_MTD_2026']),
      projectedUsage: factValue(row, headerIndex, ['월말예상총사용_2026']),
      projectedIdle: factValue(row, headerIndex, ['월말예상미가동대수_2026']),
      lossMtd: factValue(row, headerIndex, ['손실추정매출_MTD_2026']),
      lossProjected: factValue(row, headerIndex, ['손실추정매출_월말예상_2026']),
      anomalyFlags: tx(row[headerIndex.get('이상플래그_종합')]),
      source: 'fact_monthly'
    };

    if (!byStore.has(storeName)) byStore.set(storeName, []);
    byStore.get(storeName).push(item);
  });

  byStore.forEach(months => months.sort((a, b) => a.monthNum - b.monthNum));
  return byStore;
}

// 전사 MRR은 매장별 fact 합계와 범위가 다르다. 최신 시트 정의에 따라
// _overall_monthly의 단일 PASS + ALL PASS 스냅샷을 별도로 읽는다.
function parseOverallMonthly(rows) {
  const headerRowIdx = rows.findIndex(r => tx(r[0]) === '분기' && r.some(v => tx(v) === '월번호'));
  if (headerRowIdx < 0) return new Map();

  const headers = rows[headerRowIdx].map(tx);
  const headerIndex = new Map(headers.map((h, i) => [h, i]));
  const byMonth = new Map();

  rows.slice(headerRowIdx + 1).forEach(row => {
    const monthNum = factValue(row, headerIndex, ['월번호']);
    if (monthNum < 1 || monthNum > TODAY_MONTH) return;
    const retained = factValue(row, headerIndex, ['유지_2026']);
    const retainedPrev = factValue(row, headerIndex, ['유지_2025']);
    const allPassRetained = factValue(row, headerIndex, ['올패스유지_2026']);
    const allPassRetainedPrev = factValue(row, headerIndex, ['올패스유지_2025']);
    byMonth.set(monthNum, {
      mrr: factValue(row, headerIndex, ['MRR_2026']),
      mrrPrev: factValue(row, headerIndex, ['MRR_2025']),
      arr: factValue(row, headerIndex, ['ARR_2026']),
      arrPrev: factValue(row, headerIndex, ['ARR_2025']),
      ltv: factValue(row, headerIndex, ['LTV_추정_2026']),
      ltvPrev: factValue(row, headerIndex, ['LTV_추정_2025']),
      retained,
      retainedPrev,
      allPassRetained,
      allPassRetainedPrev,
      mrrSubscribers: retained + allPassRetained,
      mrrSubscribersPrev: retainedPrev + allPassRetainedPrev,
      source: '_overall_monthly'
    });
  });
  return byMonth;
}

function applyPortfolioFinancials(months, overallRows, legacyMonths = []) {
  const overallByMonth = parseOverallMonthly(overallRows);
  months.forEach((m, i) => {
    const canonical = overallByMonth.get(m.monthNum);
    const fallback = legacyMonths[i] || {};
    const finance = canonical?.mrr > 0 ? canonical : fallback;
    if (!(finance.mrr > 0)) {
      m.mrrSubscribers = m.retained || 0;
      return;
    }

    m.mrr = finance.mrr || 0;
    m.mrrPrev = finance.mrrPrev || 0;
    m.mrrYoY = m.mrrPrev > 0 ? (m.mrr - m.mrrPrev) / m.mrrPrev * 100 : 0;
    m.arr = finance.arr || m.mrr * 12;
    m.arrPrev = finance.arrPrev || m.mrrPrev * 12;
    m.arrYoY = m.arrPrev > 0 ? (m.arr - m.arrPrev) / m.arrPrev * 100 : 0;
    m.ltv = finance.ltv || 0;
    m.ltvPrev = finance.ltvPrev || 0;
    m.allPassRetained = canonical?.allPassRetained || 0;
    m.allPassRetainedPrev = canonical?.allPassRetainedPrev || 0;
    m.mrrSubscribers = canonical?.mrrSubscribers || m.retained || 0;
    m.mrrSubscribersPrev = canonical?.mrrSubscribersPrev || m.retainedPrev || 0;
    m.arpu = m.mrrSubscribers > 0 ? m.mrr / m.mrrSubscribers : 0;
    m.portfolioFinanceSource = canonical?.source || 'analysis_tabs';
  });
  return months;
}

function mergeStoreWithFact(store, factByStore) {
  const factMonths = factByStore.get(store.name) || [];
  if (!factMonths.length) return store;
  return { ...store, months: factMonths, current: factMonths[factMonths.length - 1], source: 'fact_monthly' };
}

function aggregatePortfolioMonths(stores) {
  return MONTH_SPECS.map(spec => {
    const records = stores
      .map(store => store.months.find(m => m.monthNum === spec.num))
      .filter(Boolean);
    if (!records.length) return buildMonth(spec.month, spec.quarter, new Map(), new Map(), new Map(), spec);

    const sum = key => records.reduce((total, row) => total + (+row[key] || 0), 0);
    const target = sum('target');
    const gross = sum('gross');
    const grossPrev = sum('grossPrev');
    const net = sum('net');
    const netPrev = sum('netPrev');
    const usage = sum('usage');
    const refundAmount = sum('refundAmount');
    const retained = sum('retained');
    const retainedPrev = sum('retainedPrev');
    const cancelSubs = sum('cancelSubs');
    const mrr = sum('mrr');
    const mrrPrev = sum('mrrPrev');
    const capacity = records.reduce((total, row) => total + (+row.capacity || 0), 0);
    const mtdCapacity = records.reduce((total, row) => {
      const inferred = row.utilization > 0 ? row.usage / (row.utilization / 100) : 0;
      return total + (+row.mtdCapacity || inferred || +row.capacity || 0);
    }, 0);
    const arr = sum('arr');
    const arrPrev = sum('arrPrev');
    const seasonBase = sum('seasonBase');
    const seasonUsage = records.reduce((total, row) => total + ((row.seasonBase || 0) > 0 ? (+row.usage || 0) : 0), 0);

    return {
      month: spec.month, monthNum: spec.num, quarter: spec.quarter, status: monthStatus(spec.num),
      target, targetFull: sum('targetFull'),
      gross, grossPrev,
      grossYoY: grossPrev > 0 ? (gross - grossPrev) / grossPrev * 100 : 0,
      net, netPrev,
      netYoY: netPrev > 0 ? (net - netPrev) / netPrev * 100 : 0,
      achievement: target > 0 ? net / target * 100 : 0,
      grossAchievement: target > 0 ? gross / target * 100 : 0,
      refundAmount,
      refundRate: gross > 0 ? refundAmount / gross * 100 : 0,
      usage,
      utilization: mtdCapacity > 0 ? usage / mtdCapacity * 100 : 0,
      utilizationRaw: mtdCapacity > 0 ? usage / mtdCapacity * 100 : 0,
      capacity, mtdCapacity,
      retained, retainedPrev, allPassRetained:0, allPassRetainedPrev:0,
      mrrSubscribers:retained, mrrSubscribersPrev:retainedPrev,
      newSubs: sum('newSubs'), cancelSubs, netAdds: sum('netAdds'),
      churn: retained > 0 ? cancelSubs / retained * 100 : 0,
      mrr, mrrPrev,
      mrrYoY: mrrPrev > 0 ? (mrr - mrrPrev) / mrrPrev * 100 : 0,
      arr, arrPrev,
      arrYoY: arrPrev > 0 ? (arr - arrPrev) / arrPrev * 100 : 0,
      ltv: cancelSubs > 0 ? mrr / cancelSubs : 0,
      arpu: retained > 0 ? mrr / retained : 0,
      discountAmount: 0, discountShare: 0, hasDiscountData: false,
      listPriceRevenue: gross,
      seasonBase,
      seasonIdx: seasonBase > 0 ? seasonUsage / seasonBase : 0,
      anomalyFlags: records.map(row => row.anomalyFlags).filter(Boolean).join(' | '),
      source: records.some(row => row.source === 'fact_monthly') ? 'fact_monthly' : 'store_detail'
    };
  });
}

function aggMonths(months) {
  if (!months.length) return null;
  const t = months.reduce((a,m)=>({
    target:        a.target+m.target,   gross:        a.gross+m.gross,
    grossPrev:     a.grossPrev+m.grossPrev, net:      a.net+m.net,
    netPrev:       a.netPrev+m.netPrev, usage:        a.usage+m.usage,
    comparableGross:a.comparableGross+(m.grossPrev>0?m.gross:0),
    comparableGrossPrev:a.comparableGrossPrev+(m.grossPrev>0?m.grossPrev:0),
    comparableNet:a.comparableNet+(m.netPrev>0?m.net:0),
    comparableNetPrev:a.comparableNetPrev+(m.netPrev>0?m.netPrev:0),
    retainedExposure:a.retainedExposure+m.retained,
    newSubs:       a.newSubs+m.newSubs, cancelSubs:   a.cancelSubs+m.cancelSubs,
    netAdds:       a.netAdds+m.netAdds,
    discountAmount:a.discountAmount+m.discountAmount,
    hasDiscountData:a.hasDiscountData||m.hasDiscountData,
    portfolioCouponData:a.portfolioCouponData||m.discountScope==='portfolio_coupon',
    couponSheetMonths:a.couponSheetMonths+(m.couponSheetPresent?1:0),
    couponSourceMonths:a.couponSourceMonths+(m.hasCouponSourceData?1:0),
    couponMappedMonths:a.couponMappedMonths+(m.hasDiscountData?1:0),
    unmappedCouponDiscount:a.unmappedCouponDiscount+(m.unmappedCouponDiscount||0),
    refundVal:     a.refundVal+(m.refundAmount || m.gross*(m.refundRate/100)||0),
    // 원천 가동률에서 해당 월의 유효 Capacity를 역산해 기간 가중 집계한다.
    cap:           a.cap+(m.utilization>0?m.usage/(m.utilization/100):0),
  }), {target:0,gross:0,grossPrev:0,net:0,netPrev:0,usage:0,
       comparableGross:0,comparableGrossPrev:0,comparableNet:0,comparableNetPrev:0,
       retainedExposure:0,newSubs:0,cancelSubs:0,netAdds:0,discountAmount:0,
       hasDiscountData:false,portfolioCouponData:false,couponSheetMonths:0,couponSourceMonths:0,couponMappedMonths:0,
       unmappedCouponDiscount:0,refundVal:0,cap:0});
  // 최신 월(마지막 요소) 기준 스냅샷 값
  const last = months[months.length-1];
  return {
    target:t.target, gross:t.gross, net:t.net,
    grossYoY: t.comparableGrossPrev?(t.comparableGross-t.comparableGrossPrev)/t.comparableGrossPrev*100:0,
    netYoY:   t.comparableNetPrev?(t.comparableNet-t.comparableNetPrev)/t.comparableNetPrev*100:0,
    achievement: t.target?t.net/t.target*100:0,
    grossAchievement: t.target?t.gross/t.target*100:0,
    usage:t.usage, retained:last.retained, retainedPrev:last.retainedPrev,
    allPassRetained:last.allPassRetained||0, allPassRetainedPrev:last.allPassRetainedPrev||0,
    mrrSubscribers:last.mrrSubscribers||last.retained||0,
    mrrSubscribersPrev:last.mrrSubscribersPrev||last.retainedPrev||0,
    newSubs:t.newSubs,
    cancelSubs:t.cancelSubs, netAdds:t.netAdds, mrr:last.mrr,
    mrrPrev:last.mrrPrev,
    mrrYoY: last.mrrPrev?(last.mrr-last.mrrPrev)/last.mrrPrev*100:0,
    churn:   t.retainedExposure?t.cancelSubs/t.retainedExposure*100:0,
    utilization: t.cap?t.usage/t.cap*100:0,
    refundRate:  t.gross?t.refundVal/t.gross*100:0,
    refundAmount:t.refundVal,
    discountAmount:t.discountAmount,
    listPriceRevenue:t.gross+t.discountAmount,
    discountShare: (t.gross+t.discountAmount)?t.discountAmount/(t.gross+t.discountAmount)*100:0,
    hasDiscountData:t.hasDiscountData,
    discountScope:t.portfolioCouponData?'portfolio_coupon':null,
    couponSheetMonths:t.couponSheetMonths,
    couponSourceMonths:t.couponSourceMonths,
    couponMappedMonths:t.couponMappedMonths,
    unmappedCouponDiscount:t.unmappedCouponDiscount,
    retainedYoY: last.retainedPrev?(last.retained-last.retainedPrev)/last.retainedPrev*100:0,
    // 스냅샷형 지표는 선택 기간의 최신 월 기준
    arpu: (last.mrrSubscribers||last.retained)>0 && last.mrr>0 ? last.mrr/(last.mrrSubscribers||last.retained)
         : t.usage>0 ? t.net/t.usage : 0,
    arr:    last.arr    || 0,
    ltv:    last.ltv    || 0,
    arrYoY: last.arrYoY || 0
  };
}

function filterMonths(months) {
  // 데이터가 없는 달(gross=0, retained=0, mrr=0)은 제외하여 차트 노이즈 방지
  const hasData = m => m.gross > 0 || m.retained > 0 || m.mrr > 0 || m.usage > 0;
  const active = months.filter(hasData);
  if (state.quarter === 'all') return active;
  const qFiltered = active.filter(m => periodMatchesMonth(state.quarter, m));
  return qFiltered;
}

/* ── 7. 정합성 검사 ─────────────────────────────────────────── */
// ★ 노이즈 감소 원칙:
//  - 수치 자체의 이상치(net>gross, 순매출 달성률 200%+)만 flagging
//  - 운영 지표(ARPU, 이탈률) 임계값은 보수적으로 적용 (false positive 최소화)
//  - ARPU=0 은 MRR/구독 데이터가 실제로 있을 때만 flag
//  - 파싱 이상(> 100% rate)은 운영 리스크가 아닌 '시트 형식 확인' 카테고리로 분리
function runAudit(months, opsStores) {
  const opIssues   = [];   // 운영 리스크 (실데이터 기반 경고)
  const fmtIssues  = [];   // 시트 형식/컬럼 오류 (파싱 이상 — 운영 리스크 아님)

  months.forEach(m => {
    if (m.gross > 0 && m.net > m.gross * 1.02)
      opIssues.push(`${m.month}: 순매출이 실결제매출 초과`);
    if (m.achievement > 200)
      opIssues.push(`${m.month}: 순매출 달성률 ${fmtP(m.achievement)} — 목표값 확인 필요`);
    // 원천 Capacity 기준 가동률 >100% 경고
    if (m.utilization > 100 && m.utilization <= 130)
      opIssues.push(`${m.month}: 가동률 ${fmtP(m.utilization)} — 원천 Capacity 초과 (Capacity 재검토 필요)`);
    // 극단적 이상치
    if (m.utilization > 130)
      opIssues.push(`${m.month}: 가동률 ${fmtP(m.utilization)} — Capacity 원천 데이터 확인 필요`);
    // ★ v3: 쿠폰할인율 ≈ 환불율 동일값 감지 — 컬럼 혼용 가능성
    if (m.hasDiscountData && m.discountShare > 0 && m.refundRate > 0) {
      const diff = Math.abs(m.discountShare - m.refundRate);
      if (diff < 0.01) opIssues.push(`${m.month}: 쿠폰할인율·환불율 동일값(${fmtP(m.refundRate)}) — 컬럼 매핑 확인 필요`);
    }
    if ((m.unmappedCouponDiscount||0) > 0)
      fmtIssues.push(`${m.month}: 쿠폰할인 ${fmtS(m.unmappedCouponDiscount)} 있으나 실결제매출 0원 — 쿠폰 적용 전 추정액 대비 할인율 산출 제외`);
  });

  const emptyCouponAggregateMonths = months.filter(m =>
    m.couponSheetPresent && m.gross > 0 && !m.hasDiscountData
  ).length;
  if (emptyCouponAggregateMonths >= 2)
    fmtIssues.push(`쿠폰 분석 ${emptyCouponAggregateMonths}개월 집계값 0원 — 쿠폰 원천/집계 산식 확인 필요`);

  // ★ v3: 매출 합산 정합성 체크 (전체 합산 vs 개별 매장 합산 ±0.5%)
  if (dashboard?.overall && dashboard?.stores) {
    const activeStores = getActiveStores();
    const storeGrossSum = activeStores.reduce((sum, s) => {
      const agg = aggMonths(filterMonths(s.months)) || {};
      return sum + (agg.gross || 0);
    }, 0);
    const overallMonths = filterMonths(dashboard.overall);
    const overallAgg    = aggMonths(overallMonths) || {};
    const overallGross  = overallAgg.gross || 0;
    if (overallGross > 0 && storeGrossSum > 0) {
      const diffPct = Math.abs((overallGross - storeGrossSum) / overallGross * 100);
      if (diffPct > 0.5) {
        opIssues.push(`매출 정합성: 전체합산(${fmtS(overallGross)}) vs 매장별합산(${fmtS(storeGrossSum)}) 차이 ${diffPct.toFixed(1)}% — 시트 데이터 확인 필요`);
      }
    }
  }

  opsStores.forEach(s => {
    // ★ v3: 오픈 전 매장이 KPI에 포함되었으면 경고
    if (s.status === '오픈 전' && (s.gross > 0 || s.usage > 0)) {
      opIssues.push(`${s.name}: 오픈 전 매장에 실데이터 존재 — KPI 집계 범위 확인 필요`);
    }

    // ── 환불율 ───────────────────────────────────────────────────
    if (s._refundParseFlag) {
      fmtIssues.push(`${s.name}: 환불율 컬럼 형식 확인 필요 (원천값 ${s._refundRawVal?.toFixed(0)||'?'} — 비율·건수 혼재 가능)`);
    } else if (s.refundRate > 30) {
      opIssues.push(`${s.name}: 환불율 ${fmtP(s.refundRate)} — 집중 점검 필요`);
    } else if (s.refundRate > 10) {
      opIssues.push(`${s.name}: 환불율 ${fmtP(s.refundRate)} — 주의 수준`);
    }

    // ── 이탈률 ───────────────────────────────────────────────────
    if (s._churnParseFlag) {
      fmtIssues.push(`${s.name}: 이탈률 컬럼 형식 확인 필요 (시트값이 건수로 저장됨 — 해지/유지 비율로 대체 표시 중)`);
    } else if (s.churn > 25) {
      opIssues.push(`${s.name}: 이탈률 ${fmtP(s.churn)} — 이상치 확인 필요`);
    }

    // ── ARPU ─────────────────────────────────────────────────────
    if (s.mrr > 0 && s.retained > 0 && s.arpu === 0)
      opIssues.push(`${s.name}: ARPU 계산 불가 (MRR 데이터 점검)`);
  });

  // ★ v3: 매장 수 정합성 체크
  if (dashboard?.opsStores) {
    const opsCount    = getActiveOpsStores().length;
    const storeCount  = getActiveStores().length;
    if (opsCount !== storeCount && storeCount > 0)
      opIssues.push(`매장 수 불일치: ops시트 운영매장 ${opsCount}개 vs 개별시트 ${storeCount}개 — 데이터 범위 확인 필요`);
  }

  // ★ v3: 정합성 카드 "정상" 판정 기준 강화
  //   아래 조건 중 하나라도 해당하면 "정상" 아님:
  //   ① 가동률 >100% ② 쿠폰할인율=환불율 동일값 ③ 매출 불일치 ④ 매장 수 불일치 ⑤ 오픈 전 실데이터

  // 운영 리스크 먼저, 시트 형식 확인 사항은 별도 prefix로 뒤에 추가
  return [
    ...opIssues,
    ...(fmtIssues.length ? ['---'] : []),  // 구분선
    ...fmtIssues.map(t => `[형식] ${t}`)
  ];
}

/* ── 8. Summary 시트 파싱 ────────────────────────────────────── */
function parseSummary(rows) {
  // Summary 시트에서 전체 포트폴리오 KPI (키-값 형식) 파싱
  const map = new Map();
  rows.forEach(r => {
    const k = tx(r[0]);
    if (k) map.set(k, r);
  });
  // 주요 집계 값 추출 (있으면 ops 시트 보완)
  const get = (keys, col=1) => {
    for (const k of keys) {
      const r = map.get(k);
      if (r && r[col] !== undefined && String(r[col]).trim() !== '') return num(r[col]);
    }
    return null;
  };
  const getPct = (keys, col=1) => {
    for (const k of keys) {
      const r = map.get(k);
      if (r && r[col] !== undefined && String(r[col]).trim() !== '') return pct(r[col]);
    }
    return null;
  };
  const updatedRow = rows.find(r => tx(r[0]).startsWith('업데이트'));
  return {
    totalGross:   get(['누적 실결제매출(구 총매출)','누적 실결제매출','실결제매출(구 총매출)','실결제매출','누적 총매출','총매출','매출합계','Total Revenue','total_gross']),
    totalNet:     get(['누적 순매출','순매출','Net Revenue']),
    totalMrr:     get(['MRR','월정기매출']),
    avgUtilization: getPct(['가동률','평균가동률','Utilization']),
    avgChurn:       getPct(['이탈률','평균이탈률','Churn Rate']),
    totalSubs:    get(['총구독','유지구독','Active Subs']),
    lastUpdated:  tx(updatedRow?.[0] || '')
  };
}

/* ── 8-B. 데이터 점검 시트 파싱 ──────────────────────────────── */
function isSourceCheckPending(c) {
  const text = `${c?.name || ''} ${c?.status || ''} ${c?.value || ''} ${c?.note || ''}`;
  if (c?.name === '빌드 상태' && /재생성|진행 중|진행중|빌드/.test(text)) return true;
  if (c?.name === '매출 최신일' && /점검중|미완료|중간에 중단|확인 불가/.test(text)) return true;
  return /대시보드 재생성이 완료되지 않았|최종 점검 미완료/.test(text);
}

function isInformationalDataQualityCheck(c) {
  // 최신 원천의 "전년 비교 완전성=주의"는 2025년 1월 기준일 부재로 YoY를 공란 처리했다는 안내다.
  // 데이터 오류나 운영 리스크로 카운트하지 않는다.
  if (c?.status !== '주의') return false;
  if (c?.name === '전년 비교 완전성') return true;

  const text = `${c?.name || ''} ${c?.value || ''} ${c?.note || ''}`;
  const nonBlockingNames = new Set([
    '참고 경고',
    'YoY 비교 기준일',
    '최신일 동기화',
    '매장별 매출 최신일',
    '매출 최신일'
  ]);
  return nonBlockingNames.has(c?.name) && (
    text.includes('확인 불가') ||
    text.includes('latest date missing') ||
    text.includes('비교 기준일 없음') ||
    text.includes('raw/_cfg/_overall 일치') ||
    text.includes('전체 최신매출일 확인 불가') ||
    text.includes('비차단')
  );
}

function parseDataQuality(rows) {
  const checks = [];
  const details = [];
  const headerIdx = rows.findIndex(r => tx(r[0]) === '점검 항목');
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const name = tx(rows[i][0]);
      if (!name || name === '오류 상세' || name === '검증 상세') break;
      checks.push({ name, status: tx(rows[i][1]), value: tx(rows[i][2]), note: tx(rows[i][3]) });
    }
  }
  const detailIdx = rows.findIndex(r => tx(r[0]) === '검증 상세' || tx(r[0]) === '오류 상세');
  if (detailIdx >= 0) {
    const detailHeader = rows[detailIdx + 1] || [];
    const hasGradedDetails = tx(detailHeader[0]) === '등급' && tx(detailHeader[1]) === '위치';
    const start = hasGradedDetails ? detailIdx + 2 : detailIdx + 1;
    for (let i = start; i < rows.length; i++) {
      const grade = hasGradedDetails ? tx(rows[i][0]) : '';
      const loc = tx(rows[i][hasGradedDetails ? 1 : 0]);
      const msg = tx(rows[i][hasGradedDetails ? 2 : 1]);
      const action = hasGradedDetails ? tx(rows[i][3]) : '';
      if (!loc && !msg) continue;
      if (loc === '위치' && msg === '메시지') continue;
      details.push({ grade, location: loc, message: msg || loc, action });
    }
  }
  const salesCheck = checks.find(c => c.name === '매출 최신일');
  const dateMatch = salesCheck?.value?.match(/latest\s+(\d{4}-\d{2}-\d{2})/i);
  const salesLatestDate = dateMatch ? new Date(`${dateMatch[1]}T00:00:00`) : null;
  const nonNormalChecks = checks.filter(c => c.status && c.status !== '정상');
  const pendingChecks = nonNormalChecks.filter(isSourceCheckPending);
  const sourceCheckPending = pendingChecks.length > 0 ||
    details.some(d => isSourceCheckPending({ name:d.location, value:d.message, note:'' }));
  const actionableChecks = nonNormalChecks.filter(c => !isSourceCheckPending(c));
  return {
    checks,
    warnings: actionableChecks.filter(c => !isInformationalDataQualityCheck(c)),
    infos: actionableChecks.filter(isInformationalDataQualityCheck),
    pendingChecks,
    sourceCheckPending,
    details,
    salesLatestDate,
    sheetUpdatedText: tx(rows.find(r => tx(r[0]).startsWith('업데이트'))?.[0] || '')
  };
}

function runDataQualityAudit(dataQuality) {
  if (!dataQuality) return [];
  const activeSourceLabel = dashboard?.sourceStatus?.primary === 'fact_monthly'
    ? 'fact_monthly·매장 상세'
    : '매출·구독·MRR·매장 상세';
  const pendingItems = dataQuality.sourceCheckPending
    ? [`[점검보류] 원천 점검 결과 재생성 미완료: 데이터 점검 탭이 임시 상태입니다. 대시보드는 ${activeSourceLabel} 직접 조회값으로 표시 중`]
    : [];
  const blockerDetails = (dataQuality.details || []).filter(d => /차단|위험/.test(d.grade || ''));
  const aggregateSourceRecovered = dashboard?.sourceStatus?.primary === 'fact_monthly' &&
    blockerDetails.length > 0 && blockerDetails.every(d => /_overall_monthly/.test(`${d.location} ${d.message}`));
  const recoveredAggregateNames = new Set(['차단 오류', 'Capacity 합계', '계산시트 산식 완전성']);
  const warningItems = (dataQuality.warnings || []).map(c => {
    if (aggregateSourceRecovered && recoveredAggregateNames.has(c.name)) {
      return `[정보] 원천 보조 집계탭 ${c.name}: ${c.value || c.status}${c.note ? ` · ${c.note}` : ''} · 대시보드는 fact_monthly 직접 집계로 자동 복구`;
    }
    if (c.name === '검증 경고') {
      const detailCount = dataQuality.details?.length || num(c.value);
      return `원천 검증 경고: ${detailCount || c.value || c.status}건 · 세부 항목은 데이터 점검 시트의 검증 상세 참고`;
    }
    if (c.name === '매출 최신일' && dataQuality.salesLatestDate) {
      const d = dataQuality.salesLatestDate;
      const dateText = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return `원천 매출 최신일: ${dateText} · 데이터 최신성 확인 필요`;
    }
    if (c.name.startsWith('탭 오류')) {
      return `원천 시트 탭 오류: ${c.value || c.status}${c.note ? ` · ${c.note}` : ''}`;
    }
    return `원천 점검 ${c.name}: ${c.value || c.status}${c.note ? ` · ${c.note}` : ''}`;
  });
  const infoItems = (dataQuality.infos || []).map(c =>
    `[정보] 원천 점검 ${c.name}: ${c.value || c.status}${c.note ? ` · ${c.note}` : ''}`
  );
  return [...warningItems, ...pendingItems, ...infoItems];
}

/* ── 8-D. 데이터 로드 ─────────────────────────────────────────── */
async function loadData() {
  // ── 로딩 진행 헬퍼 ──────────────────────────────────────
  const bar      = $('loadProgressBar');
  const setProgress = (pct, txt) => {
    if (bar) bar.style.width = `${pct}%`;
    if (txt) $('loadText').textContent = txt;
  };
  const markDone   = id => { const el=$(id); if(el){el.classList.remove('active');el.classList.add('done');} };
  const markActive = id => { const el=$(id); if(el) el.classList.add('active'); };

  setProgress(8, '매출 · 구독 · MRR 시트 연결 중…');
  markActive('lstep-sheets');
  startSlowLoadTimer();

  const storeKeys = Object.keys(GID.stores);

  // summary·dataCheck 시트는 실패해도 핵심 지표 로드는 계속한다.
  const summaryPromise   = loadSheet(GID.summary).catch(() => []);
  const dataCheckPromise = loadSheet(GID.dataCheck).catch(() => []);
  const couponPromise    = loadSheet(GID.coupon).catch(() => []);
  const factPromise      = loadSheet(GID.factMonthly, true).catch(() => []);
  const overallMonthlyPromise = loadSheet(GID.overallMonthly, true).catch(() => []);

  // ① 핵심 4개 시트 먼저 로드 (진행 표시)
  const [salesR, subR, mrrR, opsR] = await Promise.all([
    loadSheet(GID.sales), loadSheet(GID.subs), loadSheet(GID.mrr), loadSheet(GID.ops)
  ]);

  markDone('lstep-sheets');
  setProgress(48, '매장별 상세 데이터 로드 중…');
  markActive('lstep-stores');

  // ② 매장별 시트 + 보조 시트
  const [summaryR, dataCheckR, couponR, factR, overallMonthlyR, ...storeRaws] = await Promise.all([
    summaryPromise, dataCheckPromise, couponPromise, factPromise, overallMonthlyPromise,
    ...storeKeys.map(k => loadSheet(GID.stores[k].gid))
  ]);

  markDone('lstep-stores');
  setProgress(80, '데이터 파싱 및 집계 중…');
  markActive('lstep-render');

  const opsStores     = parseOps(opsR);
  const summaryKpis   = parseSummary(summaryR);
  const dataQuality   = parseDataQuality(dataCheckR);
  const factByStore   = parseFactMonthly(factR);
  const stores        = storeKeys.map((k,i) =>
    mergeStoreWithFact(parseStore(GID.stores[k].name, storeRaws[i]), factByStore)
  );
  const legacyOverall = parseOverall(salesR, subR, mrrR);
  const derivedOverall = aggregatePortfolioMonths(stores);
  const financialOverall = applyPortfolioFinancials(derivedOverall, overallMonthlyR, legacyOverall);
  const overall       = applyPortfolioCouponDiscounts(financialOverall, couponR);
  const legacyAggregateEmpty = legacyOverall.every(m =>
    (m.gross || 0) === 0 && (m.net || 0) === 0 && (m.usage || 0) === 0 && (m.mrr || 0) === 0
  ) && overall.some(m => (m.gross || 0) > 0 || (m.net || 0) > 0);
  const legacyAggregateMismatchMonths = legacyOverall.reduce((count, legacy, i) => {
    const derived = overall[i] || {};
    // 전사 MRR은 ALL PASS를 포함하므로 매장 합계와 다른 것이 정상이다.
    const differs = ['gross','net','usage'].some(key => {
      const expected = +derived[key] || 0;
      const actual = +legacy[key] || 0;
      return Math.abs(actual - expected) > Math.max(1, Math.abs(expected) * 0.001);
    });
    return count + (differs ? 1 : 0);
  }, 0);
  const sourceStatus = {
    primary: factByStore.size ? 'fact_monthly' : 'store_detail',
    legacyAggregateEmpty,
    legacyAggregateMismatchMonths,
    portfolioFinanceSource: overall.find(m => m.portfolioFinanceSource)?.portfolioFinanceSource || 'store_sum',
    factStoreCount: factByStore.size
  };

  // ops 데이터와 store monthly 데이터 병합
  const storesFull = stores.map(s => {
    const ops = opsStores.find(o => o.name === s.name) || {};
    return { ...s, ops };
  });

  // summary 시트 데이터로 ops 집계 보완
  const overallAgg = aggMonths(overall) || {};
  if (summaryKpis.totalGross && summaryKpis.totalGross > 0) overallAgg._summaryGross = summaryKpis.totalGross;
  if (summaryKpis.totalMrr   && summaryKpis.totalMrr   > 0) overallAgg._summaryMrr   = summaryKpis.totalMrr;

  const now = new Date();
  // runAudit가 매장 합계 교차검증을 수행할 수 있도록 감사 전에 데이터 모델을 할당한다.
  dashboard = { overall, opsStores, stores: storesFull, summaryKpis, dataQuality, sourceStatus, audit: [], loadedAt: now };
  const baseAudit = runAudit(overall, opsStores);
  const qualityAudit = runDataQualityAudit(dataQuality);
  if (legacyAggregateEmpty) {
    qualityAudit.unshift('[정보] 포트폴리오 분석 탭이 0으로 남아 fact_monthly·매장 상세 합계로 자동 복구했습니다.');
  } else if (legacyAggregateMismatchMonths > 0) {
    qualityAudit.unshift(`[정보] 포트폴리오 분석 탭 ${legacyAggregateMismatchMonths}개월이 fact_monthly와 불일치하여 원천 직접 합계로 자동 복구했습니다.`);
  }
  dashboard.audit = [...baseAudit, ...qualityAudit];

  // updatedAt / auditBadge — renderHeroKpis()에서 동적으로 재생성하므로 중복 설정 제거
  markDone('lstep-render');
  setProgress(100, '완료!');
  clearSlowLoadTimer();

  buildStoreSelect();
}

function buildStoreSelect() {
  const sel = $('storeSelect');
  // ★ v3: 운영 중 / 오픈 예정 동적 카운트
  const allOpsStores   = dashboard?.opsStores || [];
  const activeCount    = allOpsStores.filter(s => s.status !== '오픈 전').length;
  const openingCount   = allOpsStores.filter(s => s.status === '오픈 전').length;
  const totalCount     = Object.keys(GID.stores).length;
  const labelSuffix    = openingCount > 0
    ? `운영 ${activeCount}개 + 오픈예정 ${openingCount}개`
    : `${totalCount}개 매장 합산`;
  sel.innerHTML = `<option value="all">전체 (${labelSuffix})</option>`;
  Object.entries(GID.stores).forEach(([k,v]) => {
    const opt = document.createElement('option');
    opt.value = k;
    const opsEntry = allOpsStores.find(s => s.name === v.name);
    opt.textContent = opsEntry?.status === '오픈 전' ? `${v.name} (오픈예정)` : v.name;
    sel.appendChild(opt);
  });
  sel.value = state.store;
}

/* ── v3 헬퍼: 운영 중 / 오픈 예정 매장 분리 ─────────────────── */
function getSelectedPeriodEndDate() {
  const now = new Date();
  const year = now.getFullYear();
  const endMonth = periodEndMonth(state.quarter);
  if (endMonth) {
    const periodEnd = new Date(year, endMonth, 0, 23, 59, 59);
    return periodEnd > now ? now : periodEnd;
  }
  return now;
}
function isStoreActiveForSelectedPeriod(storeName) {
  const openDateText = STORE_OPEN_DATES[storeName];
  if (openDateText) {
    const openDate = new Date(`${openDateText}T00:00:00`);
    return openDate <= getSelectedPeriodEndDate();
  }
  const ops = (dashboard?.opsStores || []).find(o => o.name === storeName);
  return ops?.status !== '오픈 전';
}
function getActiveOpsStores() {
  return (dashboard?.opsStores || []).filter(s => isStoreActiveForSelectedPeriod(s.name));
}
function getOpeningOpsStores() {
  return (dashboard?.opsStores || []).filter(s => !isStoreActiveForSelectedPeriod(s.name));
}
function isOpeningStore(storeName) {
  const ops = (dashboard?.opsStores || []).find(o => o.name === storeName);
  return ops?.status === '오픈 전';
}
function getActiveStores() {
  return (dashboard?.stores || []).filter(s => isStoreActiveForSelectedPeriod(s.name));
}

/* ── 9. 엔티티 결정 ─────────────────────────────────────────── */
function getEntity() {
  if (state.store === 'all') {
    const filtered = filterMonths(dashboard.overall);
    const agg = aggMonths(filtered) || {};
    return { name:'전체 합산', months: filtered, current: agg, ops: dashboard.opsStores, isAll: true };
  }
  const s = dashboard.stores.find(x => {
    const k = Object.keys(GID.stores).find(k => GID.stores[k].name === x.name);
    return k === state.store;
  });
  if (!s) return getEntity.call({...this, store:'all'}) || null;
  const filtered = filterMonths(s.months);
  const agg = aggMonths(filtered) || {};
  // 기간 필터 화면은 월별 원천 집계만 사용한다. 운영 시트의 현재 스냅샷으로 과거 기간을 덮어쓰지 않는다.
  if (!agg.utilizationRaw && agg.utilization > 0 && s.name && STORE_CAPACITY_RAW[s.name]) {
    const capRow = buildCapacityData({ name:s.name, isAll:false, months:filtered })[0];
    if (capRow?.capacity > 0) agg.utilizationRaw = capRow.utilization;
  }
  // MRR: parseStore() 수정으로 이제 매장 개별 시트에서 직접 파싱됨
  // mrr=0인 경우만 arpu×retained로 fallback (시트에 MRR 행 없는 경우 대비)
  if (agg.mrr === 0 && (agg.retained || 0) > 0 && (agg.arpu || 0) > 0) {
    agg.mrr = agg.retained * agg.arpu; // MRR 추정값 fallback
  }
  // _mrrNoSheet: mrr과 mrrPrev 모두 0이면 시트 미연결 상태 — 게이지에 "—" 표시
  agg._mrrNoSheet = (agg.mrrYoY === 0 && agg.mrrPrev === 0 && agg.mrr === 0);
  return { name: s.name, months: filtered, current: agg, ops: [s.ops||{}], isAll: false, storeData: s };
}

/* ── 10. GAUGE ──────────────────────────────────────────────── */
function makeGauge(wrapId, valId, subId, score, valText, subText) {
  const wrap = $(wrapId);
  if (!wrap) return;
  const r = 80, cx = 100, cy = 105, perim = Math.PI * r;
  const s = Math.max(0, Math.min(100, score));
  const color = s >= 72 ? '#216552' : s >= 45 ? '#c07b48' : '#b24c58';
  const trackColor = '#f0ebe3';
  const theta = Math.PI * (1 - s/100);
  const nx = (cx + r * Math.cos(theta)).toFixed(1);
  const ny = (cy - r * Math.sin(theta)).toFixed(1);

  wrap.innerHTML = `
    <svg viewBox="0 0 200 115" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
      <path d="M${cx-r},${cy} A${r},${r} 0 0,1 ${cx+r},${cy}"
            stroke="${trackColor}" stroke-width="12" stroke-linecap="round" fill="none"/>
      <path id="${wrapId}_arc"
            d="M${cx-r},${cy} A${r},${r} 0 0,1 ${cx+r},${cy}"
            stroke="${color}" stroke-width="12" stroke-linecap="round" fill="none"
            stroke-dasharray="${perim}"
            stroke-dashoffset="${perim}"/>
      <line id="${wrapId}_needle"
            x1="${cx}" y1="${cy}" x2="${cx-r}" y2="${cy}"
            stroke="${color}" stroke-width="3" stroke-linecap="round"
            style="transition:none"/>
      <circle cx="${cx}" cy="${cy}" r="5" fill="${color}"/>
    </svg>`;

  const arc    = document.getElementById(`${wrapId}_arc`);
  const needle = document.getElementById(`${wrapId}_needle`);
  const target = (perim * (1 - s/100)).toFixed(1);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (arc) {
        arc.style.transition = 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)';
        arc.setAttribute('stroke-dashoffset', target);
      }
      if (needle) {
        needle.style.transition = 'x2 1s cubic-bezier(.4,0,.2,1), y2 1s cubic-bezier(.4,0,.2,1)';
        needle.setAttribute('x2', nx);
        needle.setAttribute('y2', ny);
      }
    });
  });

  const vEl = $(valId), sEl = $(subId);
  if (vEl) { vEl.textContent = valText; vEl.style.color = color; }
  if (sEl) sEl.innerHTML = subText;
}

// [Change 3] renderGauges: store-aware — ent.current 및 ent.months 모두
//   getEntity()에서 단일 매장 또는 합산 기준으로 정확하게 공급됨
function renderGauges(ent) {
  const c  = ent.current;
  const ms = ent.months;
  // ★ 실제 값 보존: 게이지 호(arc) 각도는 100% 기준으로 클램프하되,
  //   표시 숫자는 실제 값(>100% 가능)을 그대로 보여줌
  const achRaw  = c.achievement||0;
  const utilRaw = c.utilization||0;
  const ach  = Math.min(100, achRaw);
  const util = Math.min(100, utilRaw);
  const churnH = Math.max(0, 100 - ((c.churn||0)/12)*100);
  const mrrM = Math.max(0, Math.min(100, 50 + (c.mrrYoY||0)));

  // 100% 초과 시 배지 추가
  const achLabel  = achRaw  > 100 ? `${fmtP(achRaw)} ★`  : fmtP(achRaw);
  const utilLabel = utilRaw > 100 ? `${fmtP(utilRaw)} ↑`  : fmtP(utilRaw);

  // ★ Change 3: MoM 델타 계산 (최신 달 vs 직전 달)
  const lastM = ms.length ? ms[ms.length-1] : null;
  const prevM = ms.length >= 2 ? ms[ms.length-2] : null;
  // ★ Priority 4: 최신 달이 MTD이면 "MTD 기준" 라벨 부착
  const lastIsMTD = lastM && (lastM.status === 'mtd' || monthStatus(lastM.monthNum) === 'mtd');
  // ★ MTD vs 확정월 직접 비교 경고 — 경과일 기준 비교가 아님을 명시
  const momCtxLabel = lastIsMTD
    ? ` (${lastM.month} MTD↔${prevM?.month||'전월'} 확정, 직접비교 주의)`
    : ' MoM';
  function gaugeDeltaHtml(cur, prev, invert=false) {
    if (!prevM || prev == null) return '';
    const d = cur - prev;
    if (Math.abs(d) < 0.05) return '';
    const isGood = invert ? d < 0 : d > 0;
    const arrow = d > 0 ? '▲' : '▼';
    const color = isGood ? '#6ce8b0' : '#ff8fa0';
    return ` <span style="font-size:11px;font-weight:700;color:${color}">${arrow}${Math.abs(d).toFixed(1)}%p${momCtxLabel}</span>`;
  }
  const achDelta   = gaugeDeltaHtml(lastM?.achievement||0, prevM?.achievement||0, false);
  const utilDelta  = gaugeDeltaHtml(lastM?.utilization||0, prevM?.utilization||0, false);
  const churnDelta = gaugeDeltaHtml(lastM?.churn||0, prevM?.churn||0, true);
  // ★ MRR 게이지 delta: YoY율의 전월 변화(▲53.9%p)는 사용자에게 불투명 → 실제 MRR MoM 변화율로 교체
  //   게이지 face는 MRR YoY%, sub에는 "MoM MRR ▲X%" 형태로 기준 명시
  const mrrMoMPct = (lastM && prevM && prevM.mrr > 0)
    ? ((lastM.mrr - prevM.mrr) / prevM.mrr * 100) : null;
  const mrrDelta = mrrMoMPct !== null
    ? ` <span style="font-size:11px;font-weight:700;color:${mrrMoMPct>=0?'#6ce8b0':'#ff8fa0'}">${mrrMoMPct>=0?'▲':'▼'}${Math.abs(mrrMoMPct).toFixed(1)}%${momCtxLabel}</span>`
    : '';

  // FIX 5A — 기간 라벨 (게이지 서브에 기간 컨텍스트 추가)
  const periodLabel = ms.length > 0
    ? ` <span style="font-size:10px;color:rgba(255,255,255,.45)">${ms[0].month}~${ms[ms.length-1].month} ${ms.length}개월</span>`
    : '';

  // [Change 2] 게이지 서브레이블 강화 — KPI 카드 레이어 제거 후 핵심 컨텍스트 통합
  // 달성률: 목표 대비 순매출
  const achSubNet = c.net ? ` · 순매출 ${fmtS(c.net)}` : '';
  // FIX 2 — 가동률: 총사용 · 미가동 추정 (전체 시 모든 매장 합산)
  const capArrForGauge = (typeof buildCapacityData === 'function' && ent) ? buildCapacityData(ent) : [];
  const idleForGauge = ent.isAll
    ? capArrForGauge.reduce((s, d) => s + (d.idleCount || 0), 0)
    : (capArrForGauge[0]?.idleCount || 0);
  // 이탈건전성: 이탈 N명 · 유지 M명
  // MRR YoY: MRR X억 · ARPU Y만원
  const arpuSub = (c.arpu||0) > 0 ? ` · ARPU ${fmtS(c.arpu)}` : '';

  // MRR 게이지: 개별 매장 MRR 시트 미연결 시 YoY = 0 → 값 대신 "—" 표시 (fleet proxy 오해 방지)
  const mrrValText = c._mrrNoSheet
    ? '—'
    : `${(c.mrrYoY||0)>0?'+':''}${fmtP(c.mrrYoY||0)}`;
  const mrrSubText = c._mrrNoSheet
    ? `MRR ${fmtS(c.mrr||0)}${arpuSub} · YoY 시트 미연결${periodLabel}`
    : `MRR ${fmtS(c.mrr||0)}${arpuSub}${mrrDelta}${periodLabel}`;

  // HTML의 element ID와 일치: gsvg-*, gval-*, gsub-*
  makeGauge('gsvg-ach',  'gval-ach',  'gsub-ach',
    ach, achLabel, `목표 ${fmtS(c.target||0)}${achSubNet}${achDelta}${periodLabel}`);
  makeGauge('gsvg-util', 'gval-util', 'gsub-util',
    util, utilLabel, `총사용 ${fmtN(c.usage||0)}대 · 기간 누적 유휴 Capacity ${fmtN(idleForGauge)}대${utilDelta}${periodLabel}`);
  makeGauge('gsvg-churn','gval-churn','gsub-churn',
    churnH, fmtP(c.churn||0), `이탈 ${fmtN(c.cancelSubs||0)}명 · 유지 ${fmtN(c.retained||0)}명${churnDelta}${periodLabel}`);
  makeGauge('gsvg-mrr',  'gval-mrr',  'gsub-mrr',
    mrrM, mrrValText, mrrSubText);

  // FIX 3A — 가동률 게이지 라벨 '운영 가동률'로 명확화
  const utilLabelEl = document.querySelector('[data-gauge="util"] .g-label') ||
    document.getElementById('gsvg-util')?.closest('.gauge-card')?.querySelector('.g-label');
  if (utilLabelEl) utilLabelEl.textContent = '운영 가동률';
}

/* ── 11. KPI 카드 ───────────────────────────────────────────── */
// 지표 툴팁 정의 (산식 + 기준값)
function couponCoverageSuffix(c) {
  const sourceMonths = c.couponSourceMonths || 0;
  const mappedMonths = c.couponMappedMonths || 0;
  const excludedMonths = Math.max(0, sourceMonths - mappedMonths);
  return excludedMonths > 0
    ? ` · 매출 미집계 ${excludedMonths}개월 쿠폰할인 ${fmtS(c.unmappedCouponDiscount||0)} 제외`
    : '';
}

function couponUnavailableLabel(c) {
  if (dashboard?.dataQuality?.sourceCheckPending) return '쿠폰 집계 미완료 · 원천 재생성 중';
  if ((c.couponSheetMonths||0) > 0) return '쿠폰 집계값 없음 · 원천 확인 필요';
  return (c.couponSourceMonths||0) > 0
    ? `실결제매출 미집계로 쿠폰할인 ${fmtS(c.unmappedCouponDiscount||0)} 산출 제외`
    : '매장별 쿠폰할인 미배분';
}

function arpuBasisLabel(c) {
  return (c?.allPassRetained||0) > 0
    ? 'MRR ÷ 전체 활성 구독자(매장PASS+ALL PASS)'
    : 'MRR ÷ 유지 구독자';
}

const KPI_TOOLTIPS = {
  '실결제매출':  { formula:'환불 차감 전 실결제 기준 매출. 목표 달성 판단은 순매출 달성률을 우선 적용', benchmark:'실결제매출 달성률은 보조 지표' },
  '순매출':  { formula:'순매출 = 실결제매출 − 환불 · 쿠폰 적용 전 추정 결제액 = 실결제매출 + 쿠폰할인', benchmark:'정상가 GMV는 원천 미보유 · 환불율 < 5%' },
  'MRR':    { formula:'활성 구독 기반 반복매출 런레이트. 전체는 단일 PASS+ALL PASS, 매장별은 단일 PASS 기준', benchmark:'YoY +10% 이상 = 성장 안정' },
  '가동률':  { formula:'총사용 ÷ 원천 MTD Capacity\n마감월은 월 Capacity, 미마감월은 유효 경과일 기준 MTD Capacity 사용', benchmark:'≥ 80% 우수 · 65~80% 양호 · < 65% 주의' },
  '이탈률':  { formula:'해지 건수 ÷ 유지 구독자 수 × 100', benchmark:'< 4% 건강 · 4~8% 경계 · > 8% 위험' },
  '순증감':  { formula:'신규 구독 − 해지 구독', benchmark:'≥ 0 구독 성장 · < 0 구독 감소' },
  'ARR':    { formula:'MRR × 12 (연간 반복 매출)', benchmark:'YoY +20% 이상 = 고성장' },
  'LTV':    { formula:'ARPU ÷ 월 이탈률 (고객 생애 가치 추정)', benchmark:'LTV ÷ CAC ≥ 3 = 건전' }
};

function kpiTooltipIcon(label) {
  const tip = KPI_TOOLTIPS[label];
  if (!tip) return '';
  const text = `${tip.formula}&#10;기준: ${tip.benchmark}`.replace(/'/g, '&#39;');
  return `<span class="kpi-tooltip-wrap">
    <span class="kpi-tooltip-icon">?</span>
    <span class="kpi-tooltip-box">${tip.formula}<br><span style="color:#c07b48">기준: ${tip.benchmark}</span></span>
  </span>`;
}

function renderKpis(ent) {
  const c = ent.current;
  const ms = ent.months;
  // 월별 트렌드 배열 (스파크라인용)
  const grossTrend = ms.map(m=>m.gross);
  const netTrend   = ms.map(m=>m.net);
  const mrrTrend   = ms.map(m=>m.mrr||0);
  const utilTrend  = ms.map(m=>m.utilization||0);
  const churnTrend = ms.map(m=>m.churn||0);
  const addsTrend  = ms.map(m=>m.netAdds||0);

  // 최신 달과 직전 달로 MoM 계산
  const lastM = ms.length ? ms[ms.length-1] : null;
  const prevM = ms.length >= 2 ? ms[ms.length-2] : null;
  const momUtil  = (lastM&&prevM&&prevM.utilization>0) ? lastM.utilization - prevM.utilization : null;
  const momChurn = (lastM&&prevM&&prevM.churn>0)       ? lastM.churn - prevM.churn             : null;
  const momAdds  = (lastM&&prevM)                       ? lastM.netAdds - prevM.netAdds         : null;

  // 월말 예상 (최신 달 run-rate 기반) ───────────────────────
  // 오늘이 몇 일째인지 기반으로 월 진행률 추산 (단순화: 오늘 날짜/30)
  const todayDay  = getMtdDay();
  const daysInMon = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  const elapsed   = Math.max(1, Math.min(todayDay, daysInMon));
  const monthProg = elapsed / daysInMon; // 0~1

  // 현재 달(마지막 달)이 진행 중이면 월말 예상 표시
  const isCurrentMonth = lastM && lastM.monthNum === TODAY_MONTH && lastM.status === 'mtd';
  const projGross  = (isCurrentMonth && lastM && monthProg > 0 && monthProg < 0.99)
    ? lastM.gross / monthProg : null;

  const kpis = [
    { label:'실결제매출',  val:fmtS(c.gross),
      delta:c.grossYoY,   sub:`실결제매출 달성 ${fmtP(c.grossAchievement||0)} · 순매출 달성 ${fmtP(c.achievement||0)}`,
      prog:c.grossAchievement, color:'accent', spark:grossTrend, sparkColor:'#8f4219',
      projection: projGross ? `월말 예상 ${fmtS(projGross)}` : null },
    { label:'순매출',  val:fmtS(c.net),
      delta:c.netYoY,     sub:`${c.hasDiscountData ? `쿠폰할인 ${fmtS(c.discountAmount||0)} · 적용 전 추정액 대비 ${fmtP(c.discountShare||0)}${couponCoverageSuffix(c)}` : couponUnavailableLabel(c)} · 환불 ${fmtP(c.refundRate||0)}`,
      color:'navy',  spark:netTrend, sparkColor:'#24344f' },
    { label:'MRR',    val:fmtS(c.mrr||0),
      delta:c.mrrYoY,     sub:`MRR YoY · 전월 ${fmtS(c.mrrPrev||0)}${(c.arpu||0)>0?' · ARPU '+fmtS(c.arpu):''}`,
      color:'green', spark:mrrTrend, sparkColor:'#216552' },
    { label:'가동률',  val:fmtP(c.utilization||0),
      delta:momUtil!==null?momUtil:null, deltaSuffix:'%p',
      sub:`총사용 ${fmtN(c.usage||0)}대`,
      color:'amber', spark:utilTrend, sparkColor:'#c07b48',
      projection: (c.achievement||0)>0 && (c.achievement||0)<100
        ? `목표 달성 필요 가동률: ${fmtP(Math.min(100,(c.utilization||0) / Math.max(0.01,(c.achievement||0)/100)))}` : null },
    { label:'이탈률',  val:fmtP(c.churn||0),
      delta:momChurn!==null?momChurn:null, deltaSuffix:'%p', invert:true,
      sub:`해지 ${fmtN(c.cancelSubs||0)}건 · 유지 ${fmtN(c.retained||0)}건`,
      color:'rose', spark:churnTrend, sparkColor:'#b24c58',
      projection: (c.churn||0) > 6 ? `월말 예상 해지 ${fmtN(Math.round((c.churn||0)/100*(c.retained||0)))}명` : null },
    { label:'순증감',  val:(c.netAdds||0)>=0?`+${fmtN(c.netAdds)}`:fmtN(c.netAdds||0),
      delta:momAdds!==null?momAdds:null, deltaSuffix:'건', isRaw:true,
      sub:`신규 ${fmtN(c.newSubs||0)} / 해지 ${fmtN(c.cancelSubs||0)}`,
      color:'teal', spark:addsTrend, sparkColor:'#1d7a8a',
      projection: (c.netAdds||0) < 0
        ? `현 추세 유지 시 월 구독 ${c.netAdds||0}건 감소` : null }
  ];
  // ★ Priority 4: 최신 달 MTD 여부로 MoM 라벨 분기
  const _kpiLastM = ms.length ? ms[ms.length-1] : null;
  const _kpiMomCtx = (_kpiLastM && monthStatus(_kpiLastM.num) === 'mtd') ? 'MTD기준' : 'MoM';
  $('kpiGrid').innerHTML = kpis.map(k => {
    const hasDelta = k.delta != null && !isNaN(k.delta);
    const deltaClass = hasDelta ? (k.invert ? (k.delta<=0?'up':'down') : (k.delta>=0?'up':'down')) : 'neutral';
    const suffix = k.deltaSuffix || '%';
    const absD   = Math.abs(k.delta||0);
    const deltaText = hasDelta
      ? `${(k.delta||0)>=0?'▲':'▼'} ${k.isRaw ? fmtN(absD) : absD.toFixed(1)}${suffix} ${_kpiMomCtx}`
      : '';
    const prog = k.prog != null ? `<div class="kpi-progress"><div class="kpi-bar ${k.color}" style="width:${Math.min(100,k.prog||0)}%"></div></div>` : '';
    const spark = k.spark && k.spark.some(v=>v>0) && k.spark.length>=2 ? `<div class="kpi-spark">${sparkline(k.spark, k.sparkColor)}</div>` : '';
    const proj = k.projection ? `<div class="kpi-projection">${k.projection}</div>` : '';
    return `<div class="kpi ${k.color}">
      <div class="kpi-label">${k.label}${kpiTooltipIcon(k.label)}</div>
      <div class="kpi-main">
        <div class="kpi-value">${k.val}</div>
        ${spark}
      </div>
      <div class="kpi-row">
        ${hasDelta?`<span class="kpi-delta ${deltaClass}">${deltaText}</span>`:''}
      </div>
      ${prog}
      <div class="kpi-sub">${k.sub}</div>
      ${proj}
    </div>`;
  }).join('');
}

/* ── 12. 시그널 ─────────────────────────────────────────────── */
function renderSignals(ent) {
  const c = ent.current;
  const signals = [];

  // 순매출 달성률
  const ach = c.achievement||0;
  if (ach >= 110) signals.push({type:'ok',  title:'목표 초과 달성', text:`순매출 달성률 ${fmtP(ach)} ★`});
  else if (ach >= 100) signals.push({type:'ok', title:'목표 달성',  text:`순매출 달성률 ${fmtP(ach)}`});
  else if (ach >= 80)  signals.push({type:'warn',title:'목표 근접', text:`순매출 달성률 ${fmtP(ach)} — ${fmtS(Math.max(0,(c.target||0)-(c.net||0)))} 미달`});
  else                 signals.push({type:'bad', title:'목표 미달', text:`순매출 달성률 ${fmtP(ach)} — 즉시 점검 필요`});

  // 이탈률
  const churn = c.churn||0;
  if (churn < 4)       signals.push({type:'ok',  title:'이탈 안정', text:`이탈률 ${fmtP(churn)} — 구독 건강`});
  else if (churn < 8)  signals.push({type:'warn', title:'이탈 주의', text:`이탈률 ${fmtP(churn)} — 리텐션 점검`});
  else                 signals.push({type:'bad',  title:'이탈 위험', text:`이탈률 ${fmtP(churn)} — 즉각 대응`});

  // FIX 4 — 가동률 시그널 (100% 초과 과부하 케이스 추가)
  const util = c.utilization||0;
  if (util > 100) {
    signals.push({type:'warn', title:'과부하 주의', text:`운영 가동률 ${fmtP(util)} — Capacity 초과, 설비 점검 및 Capacity 재검토 필요`});
  } else if (util >= 85) {
    signals.push({type:'ok', title:'가동 최적', text:`운영 가동률 ${fmtP(util)} — 고효율 운영`});
  } else if (util >= 65) {
    signals.push({type:'ok', title:'가동 양호', text:`운영 가동률 ${fmtP(util)}`});
  } else if (util >= 45) {
    signals.push({type:'warn', title:'가동 보통', text:`운영 가동률 ${fmtP(util)} — 개선 여지`});
  } else {
    signals.push({type:'bad', title:'가동 저조', text:`운영 가동률 ${fmtP(util)} — 즉각 점검 필요`});
  }

  // MRR
  const mrrYoY = c.mrrYoY||0;
  if (mrrYoY >= 10)    signals.push({type:'ok',  title:'MRR 고성장', text:`YoY +${fmtP(mrrYoY)} · ${fmtS(c.mrr||0)}`});
  else if (mrrYoY >= 0) signals.push({type:'ok', title:'MRR 성장', text:`YoY +${fmtP(mrrYoY)}`});
  else                  signals.push({type:'warn', title:'MRR 감소', text:`YoY ${fmtP(mrrYoY)} — 구독 확대 필요`});

  $('signalGrid').innerHTML = signals.map(s =>
    `<div class="signal ${s.type}"><div class="signal-dot"></div>
     <div class="signal-text"><strong>${s.title}</strong><span>${s.text}</span></div></div>`
  ).join('');
}

/* ── 13. 인사이트 ───────────────────────────────────────────── */
function renderInsights(ent) {
  const c = ent.current;
  const ms = ent.months;

  // ── 핵심 요약 (동적 인사이트) ──────────────────
  // ★ v3: topStore = 필터 기간 기준 집계 (ops 스냅샷 아닌 filterMonths 기반)
  const topStore = ent.isAll
    ? [...getActiveStores()]
        .map(s => { const agg = aggMonths(filterMonths(s.months)) || {}; return { name: s.name, gross: agg.gross || 0 }; })
        .sort((a,b) => b.gross - a.gross)[0]
    : null;
  const achStatus = (c.achievement||0)>=100?'목표 초과 달성':(c.achievement||0)>=80?'목표 근접':'목표 미달';
  const mrrDir    = (c.mrrYoY||0)>=0?'성장 중':'감소 중';
  const latestM   = ms.length ? ms[ms.length-1] : null;
  const firstM    = ms.length ? ms[0].month : '';
  const lastM_str = ms.length ? ms[ms.length-1].month : '';

  // FIX 5C — 기간 정보 헤드라인에 추가
  const periodInfo = ms.length > 0 ? `[${firstM}~${lastM_str} 기준] ` : '';
  // ★ v3: 운영 중 매장 수 동적 (오픈 전 제외)
  const _insActiveN = getActiveOpsStores().length;
  let summary = ent.isAll
    ? `${periodInfo}${_insActiveN}개 직영점 합산 (오픈 중): 순매출 ${fmtS(c.net)} / 실결제매출 ${fmtS(c.gross)} (순매출 ${achStatus} ${fmtP(c.achievement||0)}) · 운영 가동률 ${fmtP(c.utilization||0)} · 이탈률 ${fmtP(c.churn||0)} · MRR ${fmtS(c.mrr||0)} ${mrrDir}. `
    : `${periodInfo}${ent.name}: 순매출 ${fmtS(c.net)} / 실결제매출 ${fmtS(c.gross)} (순매출 ${achStatus} ${fmtP(c.achievement||0)}) · 운영 가동률 ${fmtP(c.utilization||0)} · 이탈률 ${fmtP(c.churn||0)} · MRR ${fmtS(c.mrr||0)}. `;

  if (ent.isAll && topStore) {
    // ★ v3: 기간 명시 — 누적 합산 기준임을 명확히
    const topPeriodLabel = ms.length > 1 ? `${firstM}~${lastM_str} 합산` : firstM;
    summary += `${topPeriodLabel} 최고 매출: ${topStore.name} (${fmtS(topStore.gross)}).`;
  }
  if (latestM && ms.length >= 2) {
    const prev = ms[ms.length-2];
    const momGross = prev.gross>0?(latestM.gross-prev.gross)/prev.gross*100:0;
    const latestIsMTD = monthStatus(latestM.num) === 'mtd';
    if (Math.abs(momGross)>0.5) {
      if (latestIsMTD) {
        // MTD월은 확정월과 직접 비교 부적절 → 비교 기준을 명시적으로 표기
        const prevLabel = prev.month || '전월';
        summary += ` (최근월 ${latestM.month} MTD vs ${prevLabel} 확정 기준 ${momGross>=0?'+':''}${momGross.toFixed(1)}% — 경과일 차이 있음).`;
      } else if (ms.length === 2) {
        // 2개월 비교일 때만 MoM 표기 (명확한 맥락)
        summary += ` ${prev.month} 대비 ${latestM.month} 실결제매출 ${momGross>=0?'+':''}${momGross.toFixed(1)}% MoM.`;
      }
      // 3개월+ 누적 화면에서는 MoM 숫자 생략 — 월별 카드에서 확인
    }
  }
  $('headline').textContent = summary;

  // ── 리스크 — 문제/영향/담당/조치 구조화 ──────────────────
  const risks = [];
  const gap = fmtS(Math.max(0,(c.target||0)-(c.net||0)));
  if ((c.churn||0) > 12)
    risks.push({lv:'critical', text:`이탈률 심각 (${fmtP(c.churn||0)})`,
      impact:`MRR 직접 손실 · 구독 기반 잠식 위험`,
      owner:`사업운영팀 · 마케팅팀`,
      action:`해지 방어 캠페인 즉시 실행 + 해지 원인 인터뷰 착수`});
  else if ((c.churn||0) > 7)
    risks.push({lv:'warning', text:`이탈률 경계 (${fmtP(c.churn||0)})`,
      impact:`구독자 감소 가속 위험`,
      owner:`사업운영팀`,
      action:`리텐션 캠페인 검토 · 혜택 재설계 우선`});
  if ((c.achievement||0) < 70)
    risks.push({lv:'critical', text:`순매출 달성률 부진 (${fmtP(c.achievement||0)})`,
      impact:`목표 대비 ${gap} 미달 — 수익 직결`,
      owner:`마케팅팀 · 사업운영팀`,
      action:`채널별 원인 분석 후 집중 마케팅 캠페인 실행`});
  else if ((c.achievement||0) < 85)
    risks.push({lv:'warning', text:`순매출 달성률 미달 (${fmtP(c.achievement||0)})`,
      impact:`${gap} 추가 달성 필요`,
      owner:`마케팅팀`,
      action:`월말 집중 프로모션 · 신규 채널 테스트`});
  // FIX 4 — over-capacity risk
  if ((c.utilization||0) > 100) {
    risks.push({lv:'warning', text:`운영 가동률 ${fmtP(c.utilization||0)} — 원천 Capacity 초과`,
      impact:`설비 과부하 · 서비스 품질 저하 위험`,
      owner:`사업운영팀 · 건축관리팀`,
      action:'Capacity 설정값 재검토 · 설비 점검 우선'});
  }
  if ((c.utilization||0) < 45)
    risks.push({lv:'critical', text:`운영 가동률 저조 (${fmtP(c.utilization||0)})`,
      impact:`유휴 Capacity 기회금액 상한 증가 · 설비 유휴화`,
      owner:`사업운영팀 · 건축관리팀`,
      action:`미가동 시간대 특가 프로모션 · 기업 제휴 세차 패키지 검토`});
  else if ((c.utilization||0) < 60)
    risks.push({lv:'warning', text:`운영 가동률 주의 (${fmtP(c.utilization||0)})`,
      impact:`Capacity 대비 세차 대수 부족`,
      owner:`사업운영팀 · 건축관리팀`,
      action:`유휴 설비 점검 · 예약 운영 시스템 검토`});
  if ((c.refundRate||0) > 20)
    risks.push({lv:'critical', text:`환불율 위험 (${fmtP(c.refundRate||0)})`,
      impact:`매출 차감 직접 영향 · 고객 불만 누적`,
      owner:`사업운영팀 · 건축관리팀`,
      action:`CS 티켓 원인 분류 후 서비스 프로세스 즉각 점검`});
  else if ((c.refundRate||0) > 10)
    risks.push({lv:'warning', text:`환불율 높음 (${fmtP(c.refundRate||0)})`,
      impact:`순매출 감소 · 고객 만족도 하락`,
      owner:`사업운영팀`,
      action:`환불 유형별 분류 · 클레임 원인 파악`});
  if ((c.mrrYoY||0) < -10)
    risks.push({lv:'warning', text:`MRR 감소세 (YoY ${fmtP(c.mrrYoY||0)})`,
      impact:`구독 수익 지속 감소`,
      owner:`제품팀 · 마케팅팀`,
      action:`구독 성장 전략 재검토 · 업셀 시나리오 기획`});
  if ((c.netAdds||0) < 0)
    risks.push({lv:'warning', text:`순구독 감소 (${c.netAdds||0}건)`,
      impact:`유지 구독자 기반 축소`,
      owner:`마케팅팀`,
      action:`신규 유입 채널 강화 · 온보딩 전환율 점검`});
  if (!risks.length) risks.push({lv:'ok', text:'주요 리스크 없음', action:'현재 지표 유지 · 이탈률·가동률 주간 모니터링 지속'});

  $('riskList').innerHTML = risks.slice(0,5).map(r=>`
    <div class="risk-action-item">
      <div class="risk-action-header">
        <span class="risk-dot ${r.lv}" style="margin-top:5px"></span>
        <span class="risk-action-text">${r.text}</span>
        ${r.lv!=='ok'?'<span class="risk-status-badge">미조치</span>':''}
      </div>
      ${r.impact?`<div class="risk-impact">💥 ${r.impact}</div>`:''}
      ${r.owner?`<div class="risk-owner">👤 담당: ${r.owner}</div>`:''}
      ${r.action?`<div class="risk-action-rec">→ ${r.action}</div>`:''}
    </div>`).join('');

  // ── 정합성 — 문제·영향 지표·권장 조치 ──────────────────
  const al = dashboard.audit;
  const alOp = al.filter(a => a !== '---' && !a.startsWith('[형식]') && !a.startsWith('[정보]') && !a.startsWith('[점검보류]'));  // 운영 리스크만
  $('auditList').innerHTML = al.length
    ? al.map(a => {
        if (a === '---') {
          return `<div class="audit-section-divider"><span>시트 형식 확인 사항</span></div>`;
        }
        const isFmt = a.startsWith('[형식]');
        const isInfo = a.startsWith('[정보]');
        const isPending = a.startsWith('[점검보류]');
        const text  = isFmt ? a.replace('[형식] ', '') : isInfo ? a.replace('[정보] ', '') : isPending ? a.replace('[점검보류] ', '') : a;
        const icon  = isFmt ? '⚙' : isInfo ? 'ℹ' : isPending ? '⏳' : '⚑';
        const cls   = isFmt || isInfo || isPending ? 'audit-action-item audit-fmt' : 'audit-action-item';
        const rec   = isFmt
          ? '→ 데이터 값은 계산 대체값으로 표시 중 · 시트 컬럼 형식 확인 권장'
          : isInfo
          ? '→ 참고 정보 · 원천 시트 정책에 따라 자동 제외'
          : isPending
          ? '→ 원천 점검 탭 재생성 완료 후 자동 해소 · 실적 원천 탭 직접 파싱은 유지'
          : '→ 원본 시트 대조 · 입력값 검토 필요';
        return `
        <div class="${cls}">
          <span class="audit-flag">${icon}</span>
          <div class="audit-content">
            <div class="audit-issue">${text}</div>
            <div class="audit-action-rec">${rec}</div>
          </div>
        </div>`;
      }).join('')
    : '<div class="audit-item audit-ok">✓ 모든 수치가 정상 범위입니다</div>';

  // ── 포커스 패널 ──────────────────
  $('focusLabel').textContent = ent.name;
  // ★ v3: 오픈 전 제외한 운영 중 매장 수 표시
  const _focusActiveN = getActiveOpsStores().length;
  $('focusSub').textContent = ent.isAll
    ? `${ms.length}개월 합산 · 운영 ${_focusActiveN}개 매장`
    : `${ms.length}개월 추적 중`;

  if (!ent.isAll) {
    const sc = computeScore(c);
    const allScores = getActiveStores().map(s => computeScore(aggMonths(filterMonths(s.months))||{}));
    const sorted = [...allScores].sort((a,b)=>b-a);
    const rank = sorted.indexOf(sc)+1;
    $('focusScore').style.display = 'flex';
    $('scoreBadgeVal').textContent = `${sc}점`;
    $('scoreBadgeVal').style.color = sc>=70?'#6cffb6':sc>=50?'#ffd080':'#ff8a9e';
    $('scoreBadgeRank').textContent = `${rank}위 / ${sorted.length}개 매장`;
  } else {
    $('focusScore').style.display = 'none';
  }
}

function computeScore(c) {
  const scores = [
    Math.min(100, (c.achievement||0)),
    Math.min(100, (c.utilization||0)),
    Math.max(0,  100 - (c.churn||0)*5),
    Math.max(0,  100 - (c.refundRate||0)*3),
    Math.min(100, 50 + (c.mrrYoY||0)),
    Math.min(100, 50 + (c.grossYoY||0))
  ];
  return Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
}

/* ── 14. 그라디언트 헬퍼 ────────────────────────────────────── */
function makeGrad(ctx, r, g, b, aTop=0.35, aBot=0.0) {
  return function(context) {
    const chart = context.chart;
    const {top, bottom} = chart.chartArea||{top:0,bottom:300};
    const gradient = chart.ctx.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${aTop})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},${aBot})`);
    return gradient;
  };
}

/* ── 15. 차트 렌더링 ─────────────────────────────────────────── */
function mkChart(id, config) {
  if (charts[id]) { charts[id].destroy(); }
  const ctx = $(id);
  if (!ctx) return;
  charts[id] = new Chart(ctx, config);
}

const TTdefaults = {
  callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.formattedValue}` }
};

function renderPerformanceChart(ent) {
  const ms = ent.months;
  const labels = ms.map(m=>chartMonthLabel(m));
  mkChart('performanceChart', {
    data: {
      labels,
      datasets: [
        { type:'bar', label:'목표매출', data:ms.map(m=>m.target),
          backgroundColor:'rgba(36,52,79,0.12)', borderColor:PALETTE.navy, borderWidth:1.5,
          borderRadius:4, order:2 },
        { type:'bar', label:'실결제매출', data:ms.map(m=>m.gross),
          backgroundColor:makeGrad(null,143,66,25,0.80,0.55),
          borderColor:PALETTE.accent, borderWidth:0, borderRadius:5, order:3 },
        { type:'line', label:'순매출', data:ms.map(m=>m.net),
          borderColor:PALETTE.green, borderWidth:2.5, pointRadius:5,
          pointHoverRadius:8,
          fill:true, backgroundColor:makeGrad(null,33,101,82,0.18,0),
          tension:0.4, order:1 },
        { type:'line', label:'MRR', data:ms.map(m=>m.mrr),
          borderColor:PALETTE.amber, borderWidth:2.5, pointRadius:4,
          borderDash:[5,3], fill:false, tension:0.4, order:0 },
        { type:'line', label:'순매출 달성률 %', data:ms.map(m=>m.achievement||0),
          yAxisID:'y1',
          borderColor:PALETTE.rose, borderWidth:2, pointRadius:3,
          borderDash:[3,3], fill:false, tension:0.35, order:0 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{position:'top',labels:{boxWidth:12,padding:14}}, tooltip:TTdefaults },
      scales:{
        y:{ ticks:{callback:fmtA}, grid:{color:'#f0ebe3'} },
        y1:{ position:'right', min:0, suggestedMax:130, ticks:{callback:v=>`${v}%`}, grid:{drawOnChartArea:false} },
        x:{ grid:{display:false} }
      }
    }
  });
}

function renderScoreChart(ent) {
  const isAll = ent.isAll;
  const keys = Object.keys(GID.stores);

  if (isAll) {
    // 전체: 매장별 스코어 막대
    const scores = getActiveStores().map(s => ({
      name: s.name,
      score: computeScore(aggMonths(filterMonths(s.months))||{})
    })).sort((a,b)=>b.score-a.score);

    mkChart('scoreChart', {
      type:'bar',
      data: {
        labels: scores.map(s=>s.name),
        datasets:[{
          label:'운영 스코어',
          data: scores.map(s=>s.score),
          backgroundColor: scores.map(s=>s.score>=70?'rgba(33,101,82,.75)':s.score>=50?'rgba(192,123,72,.75)':'rgba(178,76,88,.75)'),
          borderRadius:8, borderSkipped:false
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false, indexAxis:'y',
        plugins:{
          legend:{display:false},
          datalabels:{ display:true, anchor:'end', align:'end', formatter:v=>`${v}점`, font:{weight:700} }
        },
        scales:{ x:{max:100, grid:{color:'#f0ebe3'}}, y:{grid:{display:false}} }
      }
    });
    $('scoreTitle').textContent = '매장별 운영 스코어';
  } else {
    // 개별: 레이더 형식으로 항목별 점수
    const c = ent.current;
    const dims = ['순매출달성률','가동률','이탈건전성','환불건전성','MRR성장','매출성장'];
    const vals = [
      Math.min(100,c.achievement||0),
      Math.min(100,c.utilization||0),
      Math.max(0,100-(c.churn||0)*5),
      Math.max(0,100-(c.refundRate||0)*3),
      Math.max(0,Math.min(100,50+(c.mrrYoY||0))),
      Math.max(0,Math.min(100,50+(c.grossYoY||0)))
    ];
    const activeStores = getActiveStores();
    const avgScore = activeStores.map(s=>({
      vals:[
        Math.min(100,(aggMonths(filterMonths(s.months))||{}).achievement||0),
        Math.min(100,(aggMonths(filterMonths(s.months))||{}).utilization||0),
        Math.max(0,100-((aggMonths(filterMonths(s.months))||{}).churn||0)*5),
        Math.max(0,100-((aggMonths(filterMonths(s.months))||{}).refundRate||0)*3),
        Math.max(0,Math.min(100,50+((aggMonths(filterMonths(s.months))||{}).mrrYoY||0))),
        Math.max(0,Math.min(100,50+((aggMonths(filterMonths(s.months))||{}).grossYoY||0)))
      ]
    })).reduce((avg,s)=>avg.map((v,i)=>v+s.vals[i]/Math.max(1, activeStores.length)), [0,0,0,0,0,0]);

    mkChart('scoreChart', {
      type:'bar',
      data: {
        labels: dims,
        datasets:[
          { label:ent.name, data:vals, backgroundColor:'rgba(143,66,25,.75)', borderRadius:5 },
          { label:'포트폴리오 평균', data:avgScore, backgroundColor:'rgba(36,52,79,.25)', borderRadius:5 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{position:'top',labels:{boxWidth:10}},
          datalabels:{ display:true, anchor:'end', align:'end', formatter:v=>`${Math.round(v)}`, font:{size:11,weight:600} }
        },
        scales:{ y:{max:100,grid:{color:'#f0ebe3'}}, x:{grid:{display:false}} }
      }
    });
    $('scoreTitle').textContent = `${ent.name} 운영 레버 스코어`;
  }
}

function renderSubscriptionChart(ent) {
  const ms = ent.months;
  mkChart('subscriptionChart', {
    data:{
      labels: ms.map(m=>chartMonthLabel(m)),
      datasets:[
        { type:'bar', label:'유지', data:ms.map(m=>m.retained),
          backgroundColor:'rgba(33,101,82,.7)', borderRadius:4, stack:'subs' },
        { type:'bar', label:'신규', data:ms.map(m=>m.newSubs),
          backgroundColor:'rgba(36,52,79,.7)', borderRadius:4, stack:'subs' },
        { type:'bar', label:'해지', data:ms.map(m=>m.cancelSubs),
          backgroundColor:'rgba(178,76,88,.55)', borderRadius:4, stack:'subs' },
        { type:'line', label:'순증감', data:ms.map(m=>m.netAdds),
          borderColor:PALETTE.amber, borderWidth:2.5, pointRadius:4,
          fill:false, tension:0.3 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10,padding:12}}, tooltip:TTdefaults },
      scales:{
        y:{ stacked:false, grid:{color:'#f0ebe3'} },
        x:{ grid:{display:false} }
      }
    }
  });
}

/* ── 운영 품질 추적: 3분할 차트 ─────────────────────────────────
   ① renderOpsUtilChart  / renderOpsUtilStats   — 가동률 추이
   ② renderOpsChurnChart / renderOpsChurnStats  — 이탈·환불 리스크
   ③ renderOpsArpuChart  / renderOpsArpuStats   — 할인·ARPU 수익성
   ────────────────────────────────────────────────────────────── */

/* ① 가동률 추이 */
function renderOpsUtilChart(ent) {
  const ms = ent.months;
  // ★ 인라인 플러그인: 75% 기준선 — 이 차트에만 적용 (Chart.register 미사용)
  const refLinePlugin = {
    id: 'opsUtilRefLine',
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      const yPx = scales.y.getPixelForValue(75);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#c07b48';
      ctx.lineWidth   = 1.2;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yPx);
      ctx.lineTo(chartArea.right, yPx);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#c07b48';
      ctx.font = '9px Pretendard Variable, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('목표 75%', chartArea.right - 2, yPx - 3);
      ctx.restore();
    }
  };
  mkChart('opsUtilChart', {
    plugins: [refLinePlugin],   // ← Chart.js 4: 인라인 플러그인 배열
    data:{
      labels: ms.map(m=>chartMonthLabel(m)),
      datasets:[
        { type:'line', label:'가동률 %', data:ms.map(m=>m.utilization||0),
          borderColor:PALETTE.green, borderWidth:2.5, pointRadius:4,
          fill:true, backgroundColor:makeGrad(null,33,101,82,.18,0), tension:0.4 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false }, tooltip:TTdefaults },
      scales:{
        y:{ ticks:{callback:v=>`${v.toFixed(0)}%`, font:{size:10}}, grid:{color:'#f0ebe3'}, suggestedMin:0 },
        x:{ grid:{display:false}, ticks:{font:{size:10}} }
      }
    }
  });
}

function renderOpsUtilStats(ent) {
  const el = $('opsUtilStats');
  if (!el) return;
  const ms = ent.months;
  if (!ms || ms.length === 0) { el.innerHTML = ''; return; }

  // 색상 기준: ≥85% 녹색 / 75-85% 주황 / <75% 빨강
  function utilColor(v) {
    return v >= 85 ? 'var(--green)' : v >= 75 ? 'var(--amber)' : 'var(--rose)';
  }
  function utilBg(v) {
    return v >= 85 ? '#e8f5f0' : v >= 75 ? '#fff3e0' : '#fce8ea';
  }

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">월</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--green);font-size:10.5px">가동률</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--muted);font-size:10.5px">vs 목표</th>
          <th style="text-align:right;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">판정</th>
        </tr>
      </thead>
      <tbody>
        ${ms.map(m => {
          const u    = m.utilization || 0;
          const diff = (u - 75).toFixed(1);
          const sign = diff >= 0 ? '+' : '';
          const verdict = u >= 85 ? '✅ 양호' : u >= 75 ? '🔶 관리' : '🔴 저가동';
          return `<tr style="border-bottom:1px solid var(--bg2)">
            <td style="padding:4px 0;font-weight:700;color:var(--text-2)">${m.month}</td>
            <td style="padding:4px 6px;text-align:right;font-weight:700;color:${utilColor(u)};background:${utilBg(u)};border-radius:4px">${u.toFixed(1)}%</td>
            <td style="padding:4px 6px;text-align:right;color:${diff >= 0 ? 'var(--green)' : 'var(--rose)'}">${sign}${diff}%p</td>
            <td style="padding:4px 0;text-align:right;font-size:11px">${verdict}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4" style="padding:6px 0 2px;font-size:10px;color:var(--muted);border-top:1px solid var(--border)">
            판정 기준&nbsp;:&nbsp;
            <span style="color:var(--rose);font-weight:600">🔴 저가동 &lt;75%</span>&nbsp;|&nbsp;
            <span style="color:var(--amber);font-weight:600">🔶 관리 75~85%</span>&nbsp;|&nbsp;
            <span style="color:var(--green);font-weight:600">✅ 양호 ≥85%</span>
            &nbsp;&nbsp;(목표 기준 75%)
          </td>
        </tr>
      </tfoot>
    </table>`;
}

/* ② 이탈·환불 리스크 */
function renderOpsChurnChart(ent) {
  const ms = ent.months;
  mkChart('opsChurnChart', {
    data:{
      labels: ms.map(m=>chartMonthLabel(m)),
      datasets:[
        { type:'line', label:'이탈률 %', data:ms.map(m=>m.churn||0),
          borderColor:PALETTE.rose, borderWidth:2.5, pointRadius:4,
          fill:true, backgroundColor:makeGrad(null,178,76,88,.15,0), tension:0.4 },
        { type:'line', label:'환불율 %', data:ms.map(m=>m.refundRate||0),
          borderColor:PALETTE.amber, borderWidth:2, pointRadius:3,
          borderDash:[4,3], fill:false, tension:0.4 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10,padding:10,font:{size:11}}}, tooltip:TTdefaults },
      scales:{
        y:{ ticks:{callback:v=>`${v.toFixed(1)}%`, font:{size:10}}, grid:{color:'#f0ebe3'}, suggestedMin:0 },
        x:{ grid:{display:false}, ticks:{font:{size:10}} }
      }
    }
  });
}

function renderOpsChurnStats(ent) {
  const el = $('opsChurnStats');
  if (!el) return;
  const ms = ent.months;
  if (!ms || ms.length === 0) { el.innerHTML = ''; return; }

  // 색상 기준 — 이탈: ≤6% 녹 / 6-10% 주황 / >10% 빨 / 환불: ≤3% 녹 / 3-5% 주황 / >5% 빨
  function churnColor(v)  { return v <= 6  ? 'var(--green)' : v <= 10 ? 'var(--amber)' : 'var(--rose)'; }
  function refundColor(v) { return v <= 3  ? 'var(--green)' : v <= 5  ? 'var(--amber)' : 'var(--rose)'; }
  function churnBg(v)     { return v <= 6  ? '#e8f5f0' : v <= 10 ? '#fff3e0' : '#fce8ea'; }
  function refundBg(v)    { return v <= 3  ? '#e8f5f0' : v <= 5  ? '#fff3e0' : '#fce8ea'; }

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">월</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--rose);font-size:10.5px">이탈률</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--amber);font-size:10.5px">환불율</th>
          <th style="text-align:right;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">관리 수준</th>
        </tr>
      </thead>
      <tbody>
        ${ms.map(m => {
          const c = m.churn     || 0;
          const r = m.refundRate || 0;
          const riskLevel = (c > 10 || r > 5) ? '🔴 집중관리' : (c > 6 || r > 3) ? '🔶 주의' : '✅ 양호';
          return `<tr style="border-bottom:1px solid var(--bg2)">
            <td style="padding:4px 0;font-weight:700;color:var(--text-2)">${m.month}</td>
            <td style="padding:4px 6px;text-align:right;font-weight:700;color:${churnColor(c)};background:${churnBg(c)};border-radius:4px">${c.toFixed(1)}%</td>
            <td style="padding:4px 6px;text-align:right;font-weight:700;color:${refundColor(r)};background:${refundBg(r)};border-radius:4px">${r.toFixed(1)}%</td>
            <td style="padding:4px 0;text-align:right;font-size:11px">${riskLevel}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

/* ③ 쿠폰할인·ARPU 수익성 */
function renderOpsArpuChart(ent) {
  const ms = ent.months;
  const hasDiscountData = ms.some(m => m.hasDiscountData);
  const hasCouponSheetRows = ms.some(m => m.couponSheetPresent);
  const hasCouponSourceData = ms.some(m => m.hasCouponSourceData);
  const arpuArt = $('opsArpuChart')?.closest('.ops-sub-section');
  if (arpuArt) {
    const h2 = arpuArt.querySelector('h2');
    const sub = arpuArt.querySelector('.sub');
    if (h2) h2.textContent = hasDiscountData ? '③ 쿠폰할인·ARPU 수익성' : `③ ARPU 수익성 · ${hasCouponSourceData ? '쿠폰할인율 산출 제외' : hasCouponSheetRows ? '쿠폰 집계값 없음' : '매장별 쿠폰할인 미배분'}`;
    if (sub) sub.textContent = hasDiscountData ? '쿠폰 적용 전 추정액 대비 할인율(%) · ARPU(원)' : `ARPU 월별 추이 · ${dashboard?.dataQuality?.sourceCheckPending ? '쿠폰 집계 미완료' : hasCouponSourceData ? '실결제매출 미집계' : hasCouponSheetRows ? '쿠폰 원천/집계 산식 확인 필요' : '쿠폰 원천에 매장 ID 없음'}`;
  }
  mkChart('opsArpuChart', {
    data:{
      labels: ms.map(m=>chartMonthLabel(m)),
      datasets:[
        ...(hasDiscountData ? [{ type:'bar', label:'쿠폰할인율 %', data:ms.map(m=>m.hasDiscountData ? (m.discountShare||0) : null),
          backgroundColor:makeGrad(null,90,63,140,.55,.2),
          borderColor:PALETTE.violet, borderWidth:0, borderRadius:4, yAxisID:'pct' }] : []),
        { type:'line', label:'ARPU (원)', data:ms.map(m=>m.arpu||0),
          borderColor:PALETTE.navy, borderWidth:2.5, pointRadius:4,
          fill:false, tension:0.4, yAxisID:'arpu' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10,padding:10,font:{size:11}}}, tooltip:TTdefaults },
      scales:{
        pct:{ position:'left',  ticks:{callback:v=>`${v.toFixed(1)}%`, font:{size:10}}, grid:{color:'#f0ebe3'}, suggestedMin:0 },
        arpu:{ position:'right', ticks:{callback:v=>`${(v/10000).toFixed(1)}만`, font:{size:10}}, grid:{display:false} },
        x:{ grid:{display:false}, ticks:{font:{size:10}} }
      }
    }
  });
}

function renderOpsArpuStats(ent) {
  const el = $('opsArpuStats');
  if (!el) return;
  const ms = ent.months;
  if (!ms || ms.length === 0) { el.innerHTML = ''; return; }

  const arpuList = ms.map(m=>m.arpu||0).filter(v=>v>0);
  const arpuAvg  = arpuList.length ? arpuList.reduce((a,b)=>a+b,0)/arpuList.length : 0;
  const hasDiscountData = ms.some(m => m.hasDiscountData);
  const hasCouponSheetRows = ms.some(m => m.couponSheetPresent);
  const hasCouponSourceData = ms.some(m => m.hasCouponSourceData);

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">월</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--violet,#5a3f8c);font-size:10.5px">쿠폰할인율</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--navy,#24344f);font-size:10.5px">ARPU</th>
          <th style="text-align:right;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">vs 평균</th>
        </tr>
      </thead>
      <tbody>
        ${ms.map(m => {
          const d    = m.discountShare || 0;
          const arpu = m.arpu || 0;
          const diff = arpuAvg > 0 ? ((arpu - arpuAvg) / arpuAvg * 100) : 0;
          const sign = diff >= 0 ? '+' : '';
          const dColor = d <= 10 ? 'var(--green)' : d <= 20 ? 'var(--amber)' : 'var(--rose)';
          return `<tr style="border-bottom:1px solid var(--bg2)">
            <td style="padding:4px 0;font-weight:700;color:var(--text-2)">${m.month}</td>
            <td style="padding:4px 6px;text-align:right;color:${m.hasDiscountData ? dColor : 'var(--muted)'}">${m.hasDiscountData ? `${d.toFixed(1)}%` : (m.hasCouponSourceData ? '산출 제외' : m.couponSheetPresent ? '집계 없음' : '—')}</td>
            <td style="padding:4px 6px;text-align:right;font-weight:700;color:var(--text)">${fmtS(arpu)}</td>
            <td style="padding:4px 0;text-align:right;color:${diff >= 0 ? 'var(--green)' : 'var(--rose)'};">${sign}${diff.toFixed(1)}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="font-size:10.5px;color:var(--muted);margin-top:6px">평균 ARPU ${fmtS(Math.round(arpuAvg))} 기준${hasDiscountData ? ` · 쿠폰할인율은 적용 전 추정액 대비${ms.some(m=>m.hasCouponSourceData&&!m.hasDiscountData) ? ' · 실결제매출 0원 월 산출 제외' : ''}` : ` · ${dashboard?.dataQuality?.sourceCheckPending ? '쿠폰 집계 미완료' : hasCouponSourceData ? '실결제매출 미집계로 쿠폰할인율 산출 제외' : hasCouponSheetRows ? '쿠폰 집계값 없음 · 원천/집계 산식 확인 필요' : '쿠폰 원천에 매장 ID 없음'}`}</div>`;
}

function renderMrrTrendChart(ent) {
  const ms = ent.months;
  const includesAllPass = ent.isAll && ms.some(m => (m.allPassRetained||0) > 0);
  const subscriberLabel = includesAllPass ? '전체 활성 구독자' : '유지 구독자';
  // ★ 구독 재무 특화: MRR + 유지 구독자 수 — YoY 모멘텀 차트와 역할 분리
  mkChart('mrrTrendChart', {
    data:{
      labels: ms.map(m=>chartMonthLabel(m)),
      datasets:[
        { type:'bar', label:'MRR', data:ms.map(m=>m.mrr||0),
          backgroundColor:makeGrad(null,143,66,25,.65,.3),
          borderColor:PALETTE.accent, borderWidth:0, borderRadius:5, yAxisID:'val' },
        { type:'line', label:subscriberLabel, data:ms.map(m=>m.mrrSubscribers||m.retained||0),
          borderColor:PALETTE.teal, borderWidth:2.5, pointRadius:4,
          pointBackgroundColor:PALETTE.teal,
          fill:false, tension:0.4, yAxisID:'subs' },
        { type:'line', label:'MRR YoY %', data:ms.map(m=>m.mrrYoY||0),
          borderColor:PALETTE.navy, borderWidth:1.5, pointRadius:2,
          borderDash:[5,3], fill:false, tension:0.4, yAxisID:'pct' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10,padding:12}}, tooltip:TTdefaults },
      scales:{
        val:{ position:'left', ticks:{callback:fmtA}, grid:{color:'#f0ebe3'} },
        subs:{ position:'right', ticks:{callback:v=>`${Math.round(v)}명`}, grid:{display:false} },
        pct:{ display:false },   // tooltip에서만 확인 (3축 축적 방지)
        x:{ grid:{display:false} }
      }
    }
  });
  // 제목·설명 동기화 (역할 명확화)
  const mrrArt = $('mrrTrendChart')?.closest('article');
  if (mrrArt) {
    const h2 = mrrArt.querySelector('h2');
    const sub = mrrArt.querySelector('.sub');
    if (h2) h2.textContent = 'MRR · 구독 성장 추적';
    if (sub) sub.textContent = includesAllPass
      ? 'MRR (막대) · 전체 활성 구독자(매장PASS+ALL PASS, 선) — 동일 전사 범위'
      : 'MRR (막대) · 유지 구독자 수 (선) — 매장PASS 범위';
  }
}

// [Change 3] renderBridgeChart: store-aware — ent.current는 getEntity()에서
//   단일 매장 선택 시 해당 매장 필터된 월 집계값 사용. isAll=false이면 매장별 데이터.
function renderBridgeChart(ent) {
  const c = ent.current;
  const gross    = Math.max(0, c.gross||0);
  const net      = Math.max(0, c.net||0);
  const discount = c.hasDiscountData ? Math.max(0, c.discountAmount || 0) : 0;
  const listPriceRevenue = gross + discount;
  const afterSaleDeduction = Math.max(0, gross - net);
  const refundVal = Math.min(afterSaleDeduction, Math.max(0, c.refundAmount || gross * ((c.refundRate||0)/100)));
  const otherDeduction = Math.max(0, afterSaleDeduction - refundVal);


  // 쿠폰 적용 전 추정 결제액은 실결제매출+쿠폰할인이며 정상가 GMV와는 구분한다.
  //   Floating/Stack 방식의 Chart.js 렌더링 버그 완전 제거
  //   매장별 원천이 없는 경우 쿠폰할인은 0원으로 표시하고 임의 배분하지 않는다.
  const barData   = [listPriceRevenue, discount, gross, refundVal, otherDeduction, net];
  const barColors = [
    'rgba(90,63,140,.82)',   // violet — 쿠폰 적용 전 추정 결제액
    'rgba(178,76,88,.82)',   // rose  — 쿠폰할인
    'rgba(36,52,79,.85)',    // navy  — 실결제매출
    'rgba(192,110,80,.78)',  // amber — 환불
    'rgba(192,123,72,.75)',  // amber — 기타 차감
    'rgba(33,101,82,.88)'    // green — 순매출
  ];
  const barBorders = ['#5a3f8c','#b24c58','#24344f','#c06e50','#c07b48','#216552'];
  const pctBase = listPriceRevenue || gross;
  const pctLabel = v => pctBase > 0 ? `${((v/pctBase)*100).toFixed(1)}%` : '';

  // 화살표 서브레이블 (X축 레이블 아래)
  const arrowLabels = [c.hasDiscountData ? '쿠폰 적용 전 추정' : '실결제매출', '(−) 쿠폰할인', '실결제매출', '(−) 환불', '(−) 기타', '순매출'];

  mkChart('bridgeChart', {
    type:'bar',
    data:{
      labels: arrowLabels,
      datasets:[{
        label:'금액',
        data: barData,
        backgroundColor: barColors,
        borderColor: barBorders,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.52   // 바 사이 간격 넓혀서 각 바가 독립적으로 보이게
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            title: ctx => ctx[0].label,
            label: ctx => {
              const v = +ctx.raw || 0;
              if (!v && ctx.dataIndex !== barData.length - 1) return ['해당 없음 (0원)'];
              return [`금액: ${fmtS(v)}`, `${c.hasDiscountData ? '쿠폰 적용 전 추정액' : '실결제매출'} 대비: ${pctLabel(v)}`];
            }
          }
        },
        datalabels:{
          display: true,   // 모든 바에 레이블 (0원 포함)
          // 값이 작으면 바 위에, 크면 바 중앙에
          anchor: ctx => {
            const v = barData[ctx.dataIndex];
            return (pctBase > 0 && v/pctBase < 0.08) ? 'end' : 'center';
          },
          align: ctx => {
            const v = barData[ctx.dataIndex];
            return (pctBase > 0 && v/pctBase < 0.08) ? 'top' : 'center';
          },
          color: ctx => {
            const v = barData[ctx.dataIndex];
            return (pctBase > 0 && v/pctBase < 0.08) ? '#4a3f35' : '#fff';
          },
          font:{size:11, weight:700},
          textAlign:'center',
          padding:{ bottom: 2 },
          formatter: (v, ctx) => {
            const val = +v || 0;
            const isSmall = pctBase > 0 && val/pctBase < 0.08;
            if (val === 0) {
              // 할인 또는 환불이 0원인 경우
              return ctx.dataIndex === 0 || ctx.dataIndex === barData.length - 1 ? `${fmtS(val)}\n${pctLabel(val)}` : '0원';
            }
            if (isSmall) {
              // 소액 항목: 값과 비율을 바 위에 표시
              return `${fmtS(val)} (${pctLabel(val)})`;
            }
            // 일반 항목: 값과 비율을 바 중앙에 표시
            return `${fmtS(val)}\n${pctLabel(val)}`;
          }
        }
      },
      scales:{
        y:{
          ticks:{callback:fmtA},
          grid:{color:'#f0ebe3'},
          beginAtZero:true,
          suggestedMax: Math.ceil(pctBase * 1.20)  // 상단 여백 확보 (소액 레이블 공간)
        },
        x:{ grid:{display:false} }
      }
    }
  });

  $('bridgeTitle').textContent = ent.isAll ? '포트폴리오 수익 브리지' : `${ent.name} 수익 브리지`;
  const bridgeSub = document.querySelector('#bridgeTitle + .sub') ||
    document.querySelector('[id="bridgeTitle"]')?.closest('article')?.querySelector('.sub');
  if (bridgeSub) {
    const netPct = pctBase > 0 ? ` (${c.hasDiscountData ? '쿠폰 적용 전 추정액' : '실결제매출'} 대비 ${pctLabel(net)})` : '';
    bridgeSub.textContent = c.hasDiscountData
      ? `쿠폰 적용 전 추정액 ${fmtS(listPriceRevenue)} → 쿠폰할인 ${fmtS(discount)} → 실결제매출 ${fmtS(gross)} → 환불 ${fmtS(refundVal)} → 기타차감 ${fmtS(otherDeduction)} → 순매출 ${fmtS(net)}${netPct}${couponCoverageSuffix(c)} · 정상가 GMV 원천 미보유`
      : `실결제매출 ${fmtS(gross)} → ${couponUnavailableLabel(c)} → 환불 ${fmtS(refundVal)} → 기타차감 ${fmtS(otherDeduction)} → 순매출 ${fmtS(net)}${netPct}`;
  }
}

function renderBenchmarkChart(ent) {
  // ★ v3: HTML 랭킹 스트립 — 오픈 전 매장 제외 + 분기 필터 적용 + 기간 레이블 표시
  const el = $('rankStrip');
  if (!el) return;

  // ★ 오픈 전 제외 + 분기 필터 적용 — ops시트 스냅샷(dashboard.opsStores) 대신
  //   filterMonths()로 분기 집계 → 벤치마크 기간이 선택한 분기와 일치
  const activeStoresData = getActiveStores();
  const rankData = activeStoresData.map(s => {
    const filtMs = filterMonths(s.months);
    const agg    = aggMonths(filtMs) || {};
    return { name: s.name, gross: agg.gross || 0, achievement: agg.achievement || 0, months: filtMs };
  }).sort((a, b) => b.gross - a.gross);

  // 기간 레이블 (★ 벤치마크가 어느 기간 기준인지 명확화)
  const periodMonths = ent.months;
  const periodLabel  = periodMonths.length > 0
    ? `${periodMonths[0].month}~${periodMonths[periodMonths.length-1].month} 기준`
    : state.quarter === 'all' ? '전체 기간' : state.quarter;
  const rankTitleEl = document.querySelector('[id="rankStrip"]')?.closest('section')?.querySelector('h2, .section-title');
  // 기간 레이블을 부제목으로 추가
  const rankSubEl = $('rankStripSub');
  if (rankSubEl) rankSubEl.textContent = `📅 ${periodLabel} · 운영 ${rankData.length}개 매장 기준 (오픈 예정 제외)`;

  const selName  = ent.isAll ? null : ent.name;
  const maxGross = rankData[0]?.gross || 1;

  el.innerHTML = rankData.map((s,i)=>{
    const isSelected = s.name === selName;
    const barW = (s.gross / maxGross * 100).toFixed(1);
    const ach = s.achievement||0;
    // color-coded 달성률 배지
    const achBg    = ach>=100?'var(--green-soft)':ach>=80?'var(--amber-soft)':'var(--rose-soft)';
    const achColor = ach>=100?'var(--green)':ach>=80?'var(--amber)':'var(--rose)';
    const achStyle = `background:${achBg};color:${achColor};padding:1px 7px;border-radius:8px;font-size:10.5px;font-weight:800${ach<80?';font-weight:900':''}`;
    const barColor = isSelected?'#8f4219':'#24344f';
    return `<div class="rank-row${isSelected?' selected':''}" data-store="${s.name}" role="button" tabindex="0"
               style="cursor:pointer" title="${s.name} 클릭으로 선택">
      <span class="rank-num${i===0?' top':''}">${i+1}</span>
      <span class="rank-name">${s.name}</span>
      <div class="rank-bar-wrap"><div class="rank-bar" style="width:${barW}%;background:${barColor}88;"></div></div>
      <span class="rank-val">${fmtS(s.gross)}</span>
      <span class="rank-ach" style="${achStyle}">${fmtP(ach)}</span>
    </div>`;
  }).join('');

  // 클릭으로 매장 선택 → 인라인 드릴다운 스크롤
  el.querySelectorAll('.rank-row').forEach(row => {
    const onClick = () => {
      const name = row.dataset.store;
      const key = Object.keys(GID.stores).find(k=>GID.stores[k].name===name);
      if (key) {
        state.store = key; $('storeSelect').value = key; renderAll(); syncHash();
        setTimeout(() => $('inlineStoreDetail')?.scrollIntoView({ behavior:'smooth', block:'nearest' }), 80);
      }
    };
    row.addEventListener('click', onClick);
    row.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') onClick(); });
  });
}

function renderHealthChart(ent) {
  const c = ent.current;
  const dims = ['순매출달성률','가동률','이탈건전성','환불건전성','MRR성장','매출성장'];
  const selVals = [
    Math.min(100,c.achievement||0),
    Math.min(100,c.utilization||0),
    Math.max(0,100-(c.churn||0)*5),
    Math.max(0,100-(c.refundRate||0)*3),
    Math.max(0,Math.min(100,50+(c.mrrYoY||0))),
    Math.max(0,Math.min(100,50+(c.grossYoY||0)))
  ];
  const avgVals = [0,0,0,0,0,0];
  // ★ v3: 오픈 전 매장 제외 — 전체 평균 왜곡 방지
  const activeStoresForHealth = getActiveStores();
  const healthDenom = activeStoresForHealth.length || 1;
  activeStoresForHealth.forEach(s=>{
    const sc = aggMonths(filterMonths(s.months))||{};
    avgVals[0] += Math.min(100,sc.achievement||0)/healthDenom;
    avgVals[1] += Math.min(100,sc.utilization||0)/healthDenom;
    avgVals[2] += Math.max(0,100-(sc.churn||0)*5)/healthDenom;
    avgVals[3] += Math.max(0,100-(sc.refundRate||0)*3)/healthDenom;
    avgVals[4] += Math.max(0,Math.min(100,50+(sc.mrrYoY||0)))/healthDenom;
    avgVals[5] += Math.max(0,Math.min(100,50+(sc.grossYoY||0)))/healthDenom;
  });

  mkChart('healthChart', {
    type:'radar',
    data:{
      labels:dims,
      datasets:[
        { label: ent.isAll?'포트폴리오 합산':ent.name, data:selVals,
          borderColor:PALETTE.accent, backgroundColor:'rgba(143,66,25,.15)',
          borderWidth:2.5, pointRadius:4, pointBackgroundColor:PALETTE.accent },
        { label:'포트폴리오 평균', data:avgVals.map(v=>Math.round(v)),
          borderColor:PALETTE.navy, backgroundColor:'rgba(36,52,79,.08)',
          borderWidth:1.5, pointRadius:3, borderDash:[4,3] }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom',labels:{boxWidth:10}} },
      scales:{ r:{ suggestedMin:0, suggestedMax:100,
        grid:{color:'#f0ebe3'}, ticks:{stepSize:25,backdropColor:'transparent'} } }
    }
  });
  $('healthSub').textContent = ent.isAll ? '포트폴리오 합산 기준' : `${ent.name} vs 포트폴리오 평균`;
}

function renderQuarterChart(ent) {
  const isAll = ent.isAll;
  const source = isAll ? dashboard.overall : (ent.storeData?.months||ent.months);
  const agg = ms => aggMonths(ms)||{};
  const visibleQuarters = QUARTERS.filter(q =>
    source.some(m => m.quarter === q && ((m.gross || 0) > 0 || (m.net || 0) > 0 || (m.usage || 0) > 0 || (m.retained || 0) > 0 || (m.mrr || 0) > 0))
  );
  const chartQuarters = visibleQuarters.length ? visibleQuarters : QUARTERS.filter(q => MONTH_SPECS.some(m => m.quarter === q));
  const quarterAggs = chartQuarters.map(q => agg(source.filter(m=>m.quarter===q)));
  const colors = [
    'rgba(36,52,79,.7)',
    'rgba(143,66,25,.7)',
    'rgba(33,101,82,.75)',
    'rgba(192,123,72,.75)'
  ];
  const netColors = [
    'rgba(33,101,82,.6)',
    'rgba(33,101,82,.85)',
    'rgba(36,52,79,.65)',
    'rgba(36,52,79,.85)'
  ];
  const addColors = [
    'rgba(192,123,72,.6)',
    'rgba(192,123,72,.85)',
    'rgba(143,66,25,.6)',
    'rgba(143,66,25,.85)'
  ];

  mkChart('quarterChart', {
    type:'bar',
    data:{
      labels:chartQuarters.map(q=>`${q} 누적`),
      datasets:[
        { label:'실결제매출', data:quarterAggs.map(q=>q.gross||0), backgroundColor:chartQuarters.map((_,i)=>colors[i % colors.length]), borderRadius:6 },
        { label:'순매출', data:quarterAggs.map(q=>q.net||0), backgroundColor:chartQuarters.map((_,i)=>netColors[i % netColors.length]), borderRadius:6 },
        { label:'순증감', data:quarterAggs.map(q=>q.netAdds||0), backgroundColor:chartQuarters.map((_,i)=>addColors[i % addColors.length]), borderRadius:6 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10}} },
      scales:{ y:{ticks:{callback:fmtA},grid:{color:'#f0ebe3'}}, x:{grid:{display:false}} }
    }
  });
}

function renderScatterChart(ent) {
  // 포지션 맵은 확정월 기준을 우선한다. MTD를 섞으면 4·5월 마감 성과가 6월 초 부분 실적으로 희석된다.
  // 선택 기간에 확정월이 없을 때만 MTD를 대체 사용한다.
  const selectedPeriodMonths = months => {
    const base = months.filter(m =>
      periodMatchesMonth(state.quarter, m) && m.gross > 0 && m.target > 0
    );
    const confirmed = base.filter(m => m.status === 'confirmed');
    return confirmed.length ? confirmed : base.filter(m => m.status === 'mtd');
  };
  const stores = getActiveStores().map(s => {
    const positionMonths = selectedPeriodMonths(s.months);
    const agg = aggMonths(positionMonths) || {};
    return {
      name:s.name,
      achievement:agg.achievement||0,
      churn:agg.churn||0,
      gross:agg.gross||0,
      monthCount:positionMonths.length,
      monthNums:positionMonths.map(m=>m.monthNum).filter(Boolean)
    };
  }).filter(s => s.monthCount > 0 && s.gross > 0);

  const selName = ent.isAll ? null : ent.name;
  const maxGross = Math.max(...stores.map(s=>s.gross), 1);
  const classify = s => s.achievement >= 100 && s.churn <= 10
    ? '목표 달성·이탈 관리'
    : s.churn > 10
      ? '고이탈 관리 필요'
      : '목표 매출 개선 필요';
  const bubbleColor = s => s.name === selName ? 'rgba(143,66,25,.92)'
    : s.achievement >= 100 && s.churn <= 10 ? 'rgba(33,101,82,.78)'
    : s.churn > 10 ? 'rgba(178,76,88,.72)'
    : 'rgba(192,123,72,.75)';
  const datasets = stores.map(s=>({
    label: s.name,
    positionStatus: classify(s),
    gross: s.gross,
    monthCount: s.monthCount,
    data:[{
      x:s.achievement||0,
      y:s.churn||0,
      r:7 + Math.sqrt((s.gross||0) / maxGross) * 10
    }],
    backgroundColor: bubbleColor(s),
    borderColor: s.name===selName ? PALETTE.accent : 'rgba(255,255,255,.92)',
    borderWidth: s.name===selName ? 3 : 1.5,
    pointStyle:'circle'
  }));

  const positionMonths = [...new Set(stores.flatMap(s=>s.monthNums))].sort((a,b)=>a-b);
  const positionUsesMtd = stores.length > 0 && stores.every(s => {
    const src = getActiveStores().find(st => st.name === s.name)?.months || [];
    const selected = selectedPeriodMonths(src);
    return selected.length && selected.every(m => m.status === 'mtd');
  });
  const periodText = positionMonths.length
    ? `${positionMonths[0]}월~${positionMonths[positionMonths.length-1]}월 매출 집계 기준`
    : `${state.quarter === 'all' ? '선택 기간' : state.quarter} 실결제매출 미집계`;
  const positionSub = $('positionSub');
  if (positionSub) positionSub.textContent = stores.length
    ? `${periodText}${positionUsesMtd ? ' (MTD)' : ' (확정월)'} · 점선: 순매출 달성률 100% / 이탈률 10% · 버블 크기: 실결제매출`
    : `${periodText}로 포지션 산출 제외`;

  const maxAchievement = Math.max(...stores.map(s=>s.achievement), 100);
  const maxChurn = Math.max(...stores.map(s=>s.churn), 10);
  const xMax = Math.max(130, Math.ceil((maxAchievement + 10) / 10) * 10);
  const yMax = Math.max(25, Math.ceil((maxChurn + 3) / 5) * 5);
  const positionGuidePlugin = {
    id:'positionGuide',
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x || !scales.y) return;
      const x100 = scales.x.getPixelForValue(100);
      const y10 = scales.y.getPixelForValue(10);
      ctx.save();
      ctx.fillStyle = 'rgba(33,101,82,.055)';
      ctx.fillRect(Math.max(chartArea.left,x100), Math.max(chartArea.top,y10),
        Math.max(0,chartArea.right-Math.max(chartArea.left,x100)),
        Math.max(0,chartArea.bottom-Math.max(chartArea.top,y10)));
      ctx.fillStyle = 'rgba(178,76,88,.04)';
      ctx.fillRect(chartArea.left, chartArea.top,
        Math.max(0,Math.min(chartArea.right,x100)-chartArea.left),
        Math.max(0,Math.min(chartArea.bottom,y10)-chartArea.top));
      ctx.restore();
    },
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.x || !scales.y) return;
      ctx.save();
      if (!stores.length) {
        ctx.fillStyle = '#74695d';
        ctx.font = '600 12px Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('실결제매출 집계 후 포지션을 표시합니다', (chartArea.left+chartArea.right)/2, (chartArea.top+chartArea.bottom)/2);
        ctx.restore();
        return;
      }
      const x100 = scales.x.getPixelForValue(100);
      const y10 = scales.y.getPixelForValue(10);
      ctx.setLineDash([5,4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(33,101,82,.65)';
      ctx.beginPath(); ctx.moveTo(x100,chartArea.top); ctx.lineTo(x100,chartArea.bottom); ctx.stroke();
      ctx.strokeStyle = 'rgba(178,76,88,.65)';
      ctx.beginPath(); ctx.moveTo(chartArea.left,y10); ctx.lineTo(chartArea.right,y10); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 9px Pretendard, sans-serif';
      ctx.fillStyle = '#216552';
      ctx.textAlign = 'right';
      ctx.fillText('목표 100%', Math.min(chartArea.right-2,x100-4), chartArea.top+10);
      ctx.fillStyle = '#b24c58';
      ctx.textAlign = 'left';
      ctx.fillText('이탈 경계 10%', chartArea.left+4, Math.max(chartArea.top+10,y10-5));
      ctx.restore();
    }
  };

  mkChart('scatterChart', {
    type:'bubble',
    plugins:[positionGuidePlugin],
    data:{ datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{ callbacks:{
          label:(ctx)=>[
            ` ${ctx.dataset.label}: 순매출 달성률 ${fmtP(ctx.parsed.x)} · 이탈률 ${fmtP(ctx.parsed.y)}`,
            ` 실결제매출 ${fmtS(ctx.dataset.gross)} · ${ctx.dataset.monthCount}개월 집계`,
            ` ${ctx.dataset.positionStatus}`
          ]
        } },
        datalabels:{
          display:true, anchor:'center', clamp:true, clip:false, offset:5,
          align:ctx=>['top','right','bottom','left'][ctx.datasetIndex%4],
          formatter:(v,ctx)=>ctx.chart.data.datasets[ctx.datasetIndex].label,
          font:ctx=>({size:ctx.chart.data.datasets[ctx.datasetIndex].label===selName?11:10,weight:700}),
          color:ctx=>ctx.chart.data.datasets[ctx.datasetIndex].label===selName?PALETTE.accent:PALETTE.navy,
          backgroundColor:'rgba(255,255,255,.9)',
          borderColor:'rgba(239,232,220,.95)',
          borderWidth:1,
          borderRadius:3,
          padding:{top:2,bottom:2,left:4,right:4}
        }
      },
      onClick:(event,elements)=>{
        if (!elements.length) return;
        const name = datasets[elements[0].datasetIndex]?.label;
        const key = Object.keys(GID.stores).find(k=>GID.stores[k].name===name);
        if (key) {
          state.store = key;
          $('storeSelect').value = key;
          renderAll();
          syncHash();
        }
      },
      scales:{
        x:{ min:0, max:xMax, title:{display:true,text:'순매출 달성률 (%)'}, ticks:{callback:v=>`${v}%`}, grid:{color:'#f0ebe3'} },
        y:{ min:0, max:yMax, title:{display:true,text:'이탈률 (%)'}, ticks:{callback:v=>`${v}%`}, grid:{color:'#f0ebe3'} }
      }
    }
  });
}

function renderMomentumChart(ent) {
  const ms = ent.months;
  // ★ 운영 건전성 3종 특화: 순매출 달성률·가동률·이탈률 — MRR 재무 차트와 역할 분리
  mkChart('momentumChart', {
    data:{
      labels: ms.map(m=>chartMonthLabel(m)),
      datasets:[
        { type:'line', label:'순매출 달성률 %', data:ms.map(m=>m.achievement||0),
          borderColor:PALETTE.accent, borderWidth:2.5, pointRadius:4,
          fill:true, backgroundColor:makeGrad(null,143,66,25,.13,0), tension:0.4 },
        { type:'line', label:'가동률 %', data:ms.map(m=>m.utilization||0),
          borderColor:PALETTE.green, borderWidth:2.5, pointRadius:4,
          fill:false, tension:0.4 },
        { type:'line', label:'이탈률 %', data:ms.map(m=>m.churn||0),
          borderColor:PALETTE.rose, borderWidth:2, pointRadius:3,
          borderDash:[4,3], fill:false, tension:0.4 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10}} },
      scales:{
        y:{ ticks:{callback:v=>`${v}%`}, grid:{color:'#f0ebe3'}, suggestedMin:0 },
        x:{ grid:{display:false} }
      }
    }
  });
  $('momentumTitle').textContent = ent.isAll ? '운영 KPI 월별 추적' : `${ent.name} 운영 KPI 추적`;
  // 부제목 업데이트
  const momArt = $('momentumTitle')?.closest('article');
  if (momArt) {
    const sub = momArt.querySelector('.sub');
    if (sub) sub.textContent = '순매출 달성률 · 가동률 · 이탈률 — 운영 건전성 3종 월별 흐름';
  }
}

function renderMixChart(ent) {
  const c = ent.current;
  const gross    = Math.max(0, c.gross||0);
  const discount = c.hasDiscountData ? Math.max(0, c.discountAmount||0) : 0;
  const refund   = Math.max(0, c.refundAmount || gross*((c.refundRate||0)/100));
  const net      = Math.max(0, c.net||0);
  const other    = Math.max(0, gross - refund - net);

  const rawData  = [net, discount, refund, other];
  const total    = rawData.reduce((a,b)=>a+b,0);
  const MIN_SHOW = 0.05; // 5% 미만 슬라이스 레이블 숨김 (겹침 방지)

  mkChart('mixChart', {
    type:'doughnut',
    data:{
      labels:['순매출','쿠폰할인','환불금액','기타차감'],
      datasets:[{
        data: rawData,
        backgroundColor:[
          'rgba(33,101,82,.85)',
          'rgba(36,52,79,.78)',
          'rgba(178,76,88,.80)',
          'rgba(192,123,72,.75)'
        ],
        borderWidth: 2,
        borderColor: ['#216552','#24344f','#b24c58','#c07b48'],
        hoverOffset: 10
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'58%',
      layout:{ padding: 16 },
      plugins:{
        legend:{
          position:'bottom',
          labels:{
            boxWidth:12, padding:12,
            generateLabels: chart => {
              const ds = chart.data.datasets[0];
              return chart.data.labels.map((label,i)=>{
                const val = ds.data[i];
                const pct = total>0?((val/total)*100).toFixed(1):'0.0';
                return {
                  text: `${label} (${pct}%)`,
                  fillStyle: ds.backgroundColor[i],
                  strokeStyle: ds.borderColor[i],
                  lineWidth:1, hidden:false, index:i
                };
              });
            }
          }
        },
        tooltip:{
          callbacks:{
            label: ctx => {
              const v = ctx.parsed;
              const pct = total>0?((v/total)*100).toFixed(1):'0';
              return ` ${ctx.label}: ${fmtS(v)} (${pct}%)`;
            }
          }
        },
        datalabels:{
          // 5% 미만 슬라이스는 레이블 숨겨 겹침 방지
          display: ctx => {
            const v = ctx.dataset.data[ctx.dataIndex];
            return total > 0 && (v / total) >= MIN_SHOW;
          },
          color:'#fff',
          font:{size:11, weight:700},
          textAlign:'center',
          formatter:(v, ctx)=>{
            const pct = total>0?((v/total)*100).toFixed(1):'0';
            return `${pct}%`;
          }
        }
      }
    }
  });
  $('mixTitle').textContent = ent.isAll ? '포트폴리오 구성 분석' : `${ent.name} 구성 분석`;
  $('mixSub').textContent   = total > 0
    ? `${c.hasDiscountData ? '쿠폰 적용 전 추정액' : '실결제매출'} 대비 순매출 ${total?((net/total)*100).toFixed(1):'—'}% | 환불 ${fmtS(refund)} · ${c.hasDiscountData ? `쿠폰할인 ${fmtS(discount)}${couponCoverageSuffix(c)}` : couponUnavailableLabel(c)}`
    : `실결제매출 ${fmtS(gross)} 기준 수익 구조`;
}

/* ── 15-A. 히어로 KPI 스트립 + 메타 바 ─────────────────────────── */
function renderHeroKpis(ent) {
  const c = ent.current;
  const el = $('heroKpiStrip');
  if (!el) return;
  const items = [
    { label:'실결제매출', val: fmtS(c.gross), note: `실결제매출 달성 ${fmtP(c.grossAchievement||0)}`, good: (c.grossAchievement||0)>=100 },
    { label:'MRR',   val: fmtS(c.mrr||0), note: `MRR YoY ${(c.mrrYoY||0)>=0?'+':''}${fmtP(c.mrrYoY||0)}`, good: (c.mrrYoY||0)>=0 },
    { label:'가동률', val: fmtP(c.utilization||0), note: `${fmtN(c.usage||0)}대 사용`, good: (c.utilization||0)>=70 },
    { label:'이탈률', val: fmtP(c.churn||0), note: `해지 ${fmtN(c.cancelSubs||0)}건`, good: (c.churn||0)<8, invert:true },
    { label:'순증감', val: `${(c.netAdds||0)>=0?'+':''}${fmtN(c.netAdds||0)}`, note: `신규 ${fmtN(c.newSubs||0)} − 해지 ${fmtN(c.cancelSubs||0)}`, good: (c.netAdds||0)>=0 },
    { label:'순매출 달성률', val: fmtP(c.achievement||0), note: `순매출 ${fmtS(c.net||0)} / 목표 ${fmtS(c.target||0)}`, good: (c.achievement||0)>=100 }
  ];
  el.innerHTML = items.map(it => {
    const color = it.invert ? (it.good?'#1d6450':'#ae3f4d') : (it.good?'#1d6450':'#b87030');
    return `<div class="hero-kpi">
      <div class="hero-kpi-label">${it.label}</div>
      <div class="hero-kpi-val" style="color:${color}">${it.val}</div>
      <div class="hero-kpi-delta" style="color:rgba(255,255,255,.45)">${it.note}</div>
    </div>`;
  }).join('');

  // ── 메타 바 동적 업데이트 (현재 분석 대상 · 기간 · 갱신 시각 명확화) ──
  const metaEl = document.querySelector('.hero-meta');
  if (!metaEl || !dashboard) return;

  // 갱신 신선도
  const loadedAt  = dashboard.loadedAt;
  const freshMin  = loadedAt ? Math.round((Date.now() - loadedAt) / 60000) : null;
  const freshStr  = freshMin === null ? '—' : freshMin < 1 ? '방금 전' : `${freshMin}분 전`;
  const loadedStr = loadedAt ? loadedAt.toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'}) : '—';
  const sourceDate = dashboard.dataQuality?.salesLatestDate;
  const sourcePending = dashboard.dataQuality?.sourceCheckPending;
  const sourceStr = sourceDate instanceof Date && !Number.isNaN(sourceDate.getTime())
    ? sourceDate.toLocaleDateString('ko-KR', {month:'numeric', day:'numeric'})
    : sourcePending ? '점검 보류' : '확인 불가';
  const now = new Date();
  const sourceLagDays = sourceDate instanceof Date && !Number.isNaN(sourceDate.getTime())
    ? Math.max(0, Math.round((
        new Date(now.getFullYear(), now.getMonth(), now.getDate())
        - new Date(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate())
      ) / 86400000))
    : null;
  const sourceClass = sourcePending ? 'info' : sourceLagDays !== null && sourceLagDays > 1 ? 'warn' : 'ok';

  // 분석 범위 요약
  const months    = ent.months;
  const firstM    = months.length ? months[0].month : '—';
  const lastM_    = months.length ? months[months.length-1].month : '—';
  const rangeStr  = months.length > 1 ? `${firstM}~${lastM_} (${months.length}개월)` : firstM;

  // 현재 필터 상태
  // ★ v3: 운영 중 / 오픈 예정 동적 카운트
  const _activeN   = getActiveOpsStores().length;
  const _openingN  = getOpeningOpsStores().length;
  const _storeDesc = _openingN > 0
    ? `운영 ${_activeN}개 매장 합산 (+ 오픈예정 ${_openingN}개 제외)`
    : `전체 ${_activeN}개 매장 합산`;
  const storeStr  = ent.isAll ? _storeDesc : ent.name;
  const qStr      = state.quarter === 'all' ? '전체' : state.quarter;

  // 정합성 — 운영 리스크만 카운트 (파싱 형식 오류는 별도)
  const auditAll    = dashboard.audit || [];
  const auditPendingCnt = auditAll.filter(a => a.startsWith('[점검보류]')).length;
  const auditQualityCnt = auditAll.filter(a => a.startsWith('원천 ')).length;
  const auditInfoCnt = auditAll.filter(a => a.startsWith('[정보]')).length;
  const auditOpCnt  = auditAll.filter(a => a !== '---' && !a.startsWith('[형식]') && !a.startsWith('[정보]') && !a.startsWith('[점검보류]') && !a.startsWith('원천 ')).length;
  const auditFmtCnt = auditAll.filter(a => a.startsWith('[형식]')).length;
  const auditClass  = auditOpCnt || auditQualityCnt ? 'warn' : (auditPendingCnt || auditFmtCnt ? 'info' : 'ok');
  const auditText   = auditQualityCnt
    ? `⚠ 데이터 품질 ${auditQualityCnt}건${auditOpCnt ? ` · 운영 ${auditOpCnt}건` : ''}${auditFmtCnt ? ` · 형식 ${auditFmtCnt}건` : ''}`
    : auditOpCnt
    ? `⚠ 운영 이슈 ${auditOpCnt}건${auditFmtCnt ? ` · 형식 ${auditFmtCnt}건` : ''}`
    : auditPendingCnt
      ? `⚙ 원천 점검 보류${auditFmtCnt ? ` · 형식 ${auditFmtCnt}건` : ''}${auditInfoCnt ? ` · 안내 ${auditInfoCnt}건` : ''}`
      : auditFmtCnt
        ? `⚙ 시트 형식 확인 ${auditFmtCnt}건`
        : auditInfoCnt
          ? `✓ 정합성 정상 · 안내 ${auditInfoCnt}건`
          : '✓ 정합성 정상';

  // 연결 상태는 실제 로드 실패 여부, 데이터 최신성은 원천 매출 최신일로 별도 표시한다.
  const connectionIssue = _failedSheets.size > 0;
  const connClass = connectionIssue ? 'warn' : 'ok';

  metaEl.innerHTML = `
    <span class="meta-pill" id="updatedAt">🕐 조회 ${loadedStr} · ${freshStr}</span>
    <span class="meta-pill">📊 ${storeStr} · ${qStr}</span>
    <span class="meta-pill">📅 ${rangeStr}</span>
    <span class="meta-pill ${connClass}">● 시트 연결 ${connectionIssue ? '일부 실패' : '정상'}</span>
    <span class="meta-pill ${sourceClass}">🗂 원천 매출 ${sourceStr}${sourceLagDays ? ` · ${sourceLagDays}일 지연` : ''}</span>
    <span class="meta-pill ${auditClass}" id="auditBadge">${auditText}</span>
    <span class="meta-pill">↻ 자동갱신 5분</span>
  `;
}

/* ── 15-B. 알림 스트립 ─────────────────────────────────────────── */
function renderAlerts(ent) {
  const c = ent.current;
  const el = $('alertStrip');
  if (!el) return;
  const alerts = [];
  if ((c.achievement||0) < 80)   alerts.push({ lvl:'danger',  msg: `⚠ 순매출 달성률 ${fmtP(c.achievement||0)} — 목표 80% 미달. 즉각 점검 필요` });
  else if ((c.achievement||0) >= 100) alerts.push({ lvl:'success', msg: `✓ 순매출 달성률 ${fmtP(c.achievement||0)} — 목표 초과 달성` });
  if ((c.utilization||0) > 110)  alerts.push({ lvl:'info',    msg: `ℹ 가동률 ${fmtP(c.utilization||0)} — 100% 초과, 설비 과부하 모니터링 권장` });
  else if ((c.utilization||0) < 50) alerts.push({ lvl:'danger', msg: `⚠ 가동률 ${fmtP(c.utilization||0)} — 50% 미달, 운영 효율화 필요` });
  if ((c.churn||0) > 10)         alerts.push({ lvl:'danger',  msg: `⚠ 이탈률 ${fmtP(c.churn||0)} — 긴급 해지 방어 캠페인 검토` });
  else if ((c.churn||0) > 6)     alerts.push({ lvl:'warn',    msg: `△ 이탈률 ${fmtP(c.churn||0)} — 경계 수준, 리텐션 점검 권장` });
  if ((c.refundRate||0) > 15)    alerts.push({ lvl:'warn',    msg: `△ 환불율 ${fmtP(c.refundRate||0)} — CS 이슈 점검 필요` });
  // ★ 정합성 — 알림 센터에는 요약만 (상세는 정합성 카드에서 확인)
  // 컬럼 매핑 관련 반복 경고를 건수 요약으로 통합
  const auditOpItems = (dashboard.audit||[]).filter(a => a !== '---' && !a.startsWith('[형식]') && !a.startsWith('[정보]') && !a.startsWith('[점검보류]'));
  if (auditOpItems.length) {
    const mappingItems = auditOpItems.filter(a => a.includes('컬럼 매핑') || a.includes('동일값'));
    const otherItems   = auditOpItems.filter(a => !a.includes('컬럼 매핑') && !a.includes('동일값'));
    // 매핑 관련: 건수 요약 1줄로 통합
    if (mappingItems.length) alerts.push({ lvl:'warn', msg: `⚑ 컬럼 매핑 확인 필요 ${mappingItems.length}건 — 정합성 카드 상세 확인` });
    // 기타 운영 리스크: 개별 표시
    otherItems.forEach(a => alerts.push({ lvl:'warn', msg: `⚑ ${a}` }));
  }

  // 상태 도트 업데이트
  const dot = $('statusDot'), txt = $('statusText');
  const hasDanger = alerts.some(a=>a.lvl==='danger');
  if (dot) dot.style.backgroundColor = hasDanger ? '#b24c58' : alerts.length ? '#c07b48' : '#216552';
  if (txt) txt.textContent = hasDanger ? '위험 지표 있음' : alerts.length ? `알림 ${alerts.length}건` : '정상';

  if (!alerts.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  el.style.flexWrap = 'wrap';
  el.innerHTML = alerts.map(a =>
    `<div class="alert-item alert-${a.lvl}">${a.msg}</div>`
  ).join('');
}

/* ── 15-C. SVG 스파크라인 ─────────────────────────────────────── */
function sparkline(values, color='#8f4219', height=28, width=80) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v,i) => {
    const x = (i/(values.length-1) * width).toFixed(1);
    const y = (height - ((v-min)/range * (height-4) + 2)).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${(values.length-1)/(values.length-1)*width}" cy="${(height-((values[values.length-1]-min)/range*(height-4)+2)).toFixed(1)}" r="2.5" fill="${color}"/>
  </svg>`;
}

/* ── 15-C1-b. 가동률 패널 인라인 공식 툴팁 헬퍼 ─────────────────── */
function capTip(html) {
  return `<span class="kpi-tooltip-wrap" style="vertical-align:middle;margin-left:4px">
    <span class="kpi-tooltip-icon" style="font-size:9px">ⓘ</span>
    <span class="kpi-tooltip-box">${html}</span>
  </span>`;
}

/* ── 15-C2. 가동률 심층 패널 (Capacity 기회금액 상한 + 계절 지수) ── */
function storeActiveDaysInMonth(storeName, monthNum, throughDay = null) {
  const year = new Date().getFullYear();
  const monthDays = daysInMonth(monthNum, year);
  const endDay = Math.min(monthDays, throughDay == null ? monthDays : throughDay);
  if (endDay <= 0) return 0;

  const openDateText = STORE_OPEN_DATES[storeName];
  if (!openDateText) return endDay;

  const openDate = new Date(`${openDateText}T00:00:00`);
  const openMonth = openDate.getMonth() + 1;
  if (openDate.getFullYear() < year || (openDate.getFullYear() === year && openMonth < monthNum)) return endDay;
  if (openDate.getFullYear() > year || openMonth > monthNum) return 0;
  return Math.max(0, endDay - openDate.getDate() + 1);
}

function proratedCapacity(monthlyCapacity, storeName, monthNum, throughDay = null) {
  const monthDays = daysInMonth(monthNum);
  const activeDays = storeActiveDaysInMonth(storeName, monthNum, throughDay);
  return monthDays > 0 ? monthlyCapacity * activeDays / monthDays : 0;
}

/* 최신 원천 Capacity 기준 누적 분모·오픈월 일할 계산 */
function buildCapacityData(ent) {
  // fact_monthly의 Capacity/MTD_Capacity가 있으면 이를 권위 값으로 사용한다.
  function calcForStore(storeName, filtMs) {
    const sourceMonthCap = filtMs.reduce((max, m) => Math.max(max, +m.capacity || 0), 0);
    const rawCap   = sourceMonthCap || STORE_CAPACITY_RAW[storeName] || 0;
    const monthCap = rawCap; // 하위 렌더러 호환 필드
    const mtdDay   = getMtdDay();

    const confirmedMs = filtMs.filter(m => m.status === 'confirmed');
    const confirmedCapacityMs = confirmedMs.filter(m =>
      !((m.usage || 0) === 0 && ((m.gross || 0) > 0 || (m.net || 0) > 0))
    );
    const mtdM        = filtMs.find(m  => m.status === 'mtd') || null;
    const hasMtdData  = !!mtdM && (mtdM.usage || 0) > 0;

    // ── 보수적 단가: 매출과 사용량이 모두 있는 월만 사용 ──────────
    // 선택 기간에 매출 원천이 없으면 해당 매장의 가용 과거 실적으로 대체한다.
    const calcUnitPrice = months => {
      const valid = (months || []).filter(m => (m.net || 0) > 0 && (m.usage || 0) > 0);
      const net = valid.reduce((s, m) => s + (m.net || 0), 0);
      const usage = valid.reduce((s, m) => s + (m.usage || 0), 0);
      return usage > 0 ? net / usage : 0;
    };
    const periodPrice = calcUnitPrice(filtMs);
    const storeHistory = (dashboard?.stores || []).find(s => s.name === storeName)?.months || [];
    const historyPrice = calcUnitPrice(storeHistory);
    const sourcePrice = [...filtMs].reverse().find(m => (+m.lossUnitPrice || 0) > 0)?.lossUnitPrice || 0;
    const consPrice = sourcePrice || periodPrice || historyPrice || UNIT_PRICE_TARGET;
    const priceSource = sourcePrice ? 'fact_monthly' : periodPrice ? 'selected_period' : historyPrice ? 'available_history' : 'fallback_target';

    // ── 확정월 집계 ─────────────────────────────────────────────
    const confirmedUsage = confirmedCapacityMs.reduce((s, m) => s + (m.usage || 0), 0);
    const confirmedDesignCap = confirmedCapacityMs.reduce(
      (s, m) => s + (+m.mtdCapacity || +m.capacity ||
        (m.utilization > 0 ? m.usage / (m.utilization / 100) : proratedCapacity(rawCap, storeName, m.monthNum))), 0
    );
    const confirmedAdjustedCap = confirmedDesignCap;
    const confirmedIdle  = Math.max(0, confirmedDesignCap - confirmedUsage);
    const confirmedDesignUtil = confirmedDesignCap > 0 ? confirmedUsage / confirmedDesignCap * 100 : 0;
    const confirmedAdjustedUtil = confirmedAdjustedCap > 0 ? confirmedUsage / confirmedAdjustedCap * 100 : 0;
    const confirmedLoss  = confirmedIdle * consPrice;

    // ── 당월 MTD ─────────────────────────────────────────────────
    const mtdDaysIn  = (mtdM?.daysInSourceMonth || daysInMonth(mtdM ? mtdM.monthNum : TODAY_MONTH));
    const mtdActiveDays = hasMtdData ? (mtdM.elapsedDays || storeActiveDaysInMonth(storeName, mtdM.monthNum, mtdDay)) : 0;
    const mtdMonthActiveDays = hasMtdData ? storeActiveDaysInMonth(storeName, mtdM.monthNum) : 0;
    const mtdDesignCap = hasMtdData ? (+mtdM.mtdCapacity ||
      (mtdM.utilization > 0 ? mtdM.usage / (mtdM.utilization / 100) : proratedCapacity(rawCap, storeName, mtdM.monthNum, mtdDay))) : 0;
    const mtdAdjustedCap = mtdDesignCap;
    const mtdUsage   = hasMtdData ? (mtdM.usage || 0) : 0;
    const mtdIdle    = hasMtdData ? Math.max(0, mtdDesignCap - mtdUsage) : 0;
    const mtdDesignUtil = mtdDesignCap > 0 ? mtdUsage / mtdDesignCap * 100 : 0;
    const mtdAdjustedUtil = mtdAdjustedCap > 0 ? mtdUsage / mtdAdjustedCap * 100 : 0;
    const mtdLoss    = mtdIdle  * consPrice;

    // ── 당월 예상 (MTD → 월말 환산) ─────────────────────────────
    const projUsage  = hasMtdData
      ? (+mtdM.projectedUsage || (mtdActiveDays > 0 ? Math.round(mtdUsage / mtdActiveDays * mtdMonthActiveDays) : 0))
      : 0;
    const projDesignCap = hasMtdData ? (+mtdM.capacity || proratedCapacity(rawCap, storeName, mtdM.monthNum)) : 0;
    const projAdjustedCap = projDesignCap;
    const projIdle   = hasMtdData ? Math.max(0, projDesignCap - projUsage) : 0;
    const projDesignUtil = projDesignCap > 0 ? projUsage / projDesignCap * 100 : 0;
    const projAdjustedUtil = projAdjustedCap > 0 ? projUsage / projAdjustedCap * 100 : 0;
    const projLoss   = projIdle * consPrice;

    // ── 계절 지수 (확정월만 = 공식 계절지수) ──────────────────────
    const storeMonthlyBase2025 = STORE_ANNUAL_2025[storeName]
      ? STORE_ANNUAL_2025[storeName] / 12
      : 0;
    const confirmedSeasonIdx = confirmedCapacityMs.map(m => ({
      month: m.month, monthNum: m.monthNum,
      usage: m.usage || 0,
      base: +m.seasonBase || storeMonthlyBase2025 * storeActiveDaysInMonth(storeName, m.monthNum) / daysInMonth(m.monthNum),
      idx: (+m.seasonIdxConfirmed || (storeMonthlyBase2025 > 0 && storeActiveDaysInMonth(storeName, m.monthNum) > 0
        ? (m.usage || 0) / (storeMonthlyBase2025 * storeActiveDaysInMonth(storeName, m.monthNum) / daysInMonth(m.monthNum))
        : 0))
    }));
    const confirmedSeasonUsage = storeMonthlyBase2025 > 0 ? confirmedUsage : 0;
    const confirmedSeasonBase = confirmedSeasonIdx.reduce((s, m) => s + (m.base || 0), 0);
    // MTD 계절 추이 (진행률 기준 지수) / 예상 계절지수
    const mtdSeasonIdx = hasMtdData ? {
      month: mtdM.month, monthNum: mtdM.monthNum,
      usage: mtdUsage, days: mtdActiveDays, daysInMonth: mtdMonthActiveDays,
      idx_mtd: +mtdM.seasonIdxMtd || ((storeMonthlyBase2025 > 0 && mtdMonthActiveDays > 0 && mtdActiveDays > 0)
        ? mtdUsage / (storeMonthlyBase2025 * mtdActiveDays / mtdMonthActiveDays) : 0),
      idx_proj: +mtdM.seasonIdxProjected || (storeMonthlyBase2025 > 0 && mtdMonthActiveDays > 0
        ? projUsage / (storeMonthlyBase2025 * mtdMonthActiveDays / mtdDaysIn) : 0)
    } : null;

    // ── 이상값 탐지 ──────────────────────────────────────────────
    const anomalies = [];
    if (confirmedDesignUtil > 100 || mtdDesignUtil > 100)
      anomalies.push('over_capacity');
    if (mtdM && !hasMtdData)
      anomalies.push('mtd_data_missing');
    filtMs.forEach(m => {
      if (m.anomalyFlags) anomalies.push(...String(m.anomalyFlags).split('|').map(tx).filter(Boolean));
      if ((m.usage || 0) === 0 && (m.gross || 0) > 0)
        anomalies.push('usage_zero_revenue_nonzero');
      if ((m.usage || 0) > 0  && (m.gross || 0) === 0)
        anomalies.push('usage_nonzero_revenue_zero');
    });

    // ── 기존 호환 필드: 선택 기간 누적(확정 + MTD) 기준 ─────────
    const repUsage = confirmedUsage + mtdUsage;
    const repIdle  = confirmedIdle + mtdIdle;
    const repLoss  = confirmedLoss + mtdLoss;
    const repCap   = confirmedDesignCap + mtdDesignCap;
    const repUtil  = repCap > 0 ? repUsage / repCap * 100 : 0;

    return {
      name: storeName, monthCap, rawCap, conservativePrice: consPrice, priceSource,
      monthCount: filtMs.length,
      // 확정
      confirmedMonths: confirmedCapacityMs.length,
      confirmedExcludedMonths: confirmedMs.length - confirmedCapacityMs.length,
      confirmedUsage,
      confirmedDesignCap, confirmedAdjustedCap,
      confirmedCap: confirmedDesignCap,
      confirmedIdle, confirmedDesignUtil, confirmedAdjustedUtil,
      confirmedUtil: confirmedDesignUtil, confirmedLoss,
      // MTD
      hasMTD: hasMtdData, mtdDataMissing: !!mtdM && !hasMtdData,
      mtdDays: mtdDay, mtdDaysInMonth: mtdDaysIn,
      mtdActiveDays, mtdMonthActiveDays, mtdUsage,
      mtdDesignCap, mtdAdjustedCap, mtdCap: mtdDesignCap,
      mtdIdle, mtdDesignUtil, mtdAdjustedUtil, mtdUtil: mtdDesignUtil, mtdLoss,
      // 예상
      projUsage, projDesignCap, projAdjustedCap, projIdle,
      projDesignUtil, projAdjustedUtil, projUtil: projDesignUtil, projLoss,
      // 계절 지수
      confirmedSeasonIdx, confirmedSeasonUsage, confirmedSeasonBase, mtdSeasonIdx,
      // 이상값
      anomalies,
      // 호환 필드
      usage: repUsage, capacity: repCap, idleCount: repIdle,
      lossEstimate: repLoss, utilization: repUtil
    };
  }

  if (ent.isAll) {
    // ★ v3: 오픈 전 매장 제외 — 유휴 손실 집계에 미개장 매장 포함 금지
    const activeStores = getActiveStores();
    return activeStores.map(s =>
      calcForStore(s.name, filterMonths(s.months))
    );
  }
  // 단일 매장: ent.months는 getEntity()에서 이미 filterMonths() 적용됨
  return [calcForStore(ent.name, ent.months || [])];
}

// [v3] renderCapacityPanel: store-aware — buildCapacityData(ent)가
//   !ent.isAll 시 [calcForStore(ent.name, ent.months)] 반환 (단일 매장 데이터만 표시)
//   ent.isAll 시 운영 중 매장 배열 반환 (★ 오픈 전 제외)
function renderCapacityPanel(ent) {
  const el = $('capacityPanel');
  if (!el) return;
  const stores = buildCapacityData(ent);

  // ── 포트폴리오 합산 ──────────────────────────────────────────
  const totConfUsage  = stores.reduce((s,st) => s+(st.confirmedUsage||0), 0);
  const totConfDesignCap = stores.reduce((s,st) => s+(st.confirmedDesignCap||0), 0);
  const totConfAdjustedCap = stores.reduce((s,st) => s+(st.confirmedAdjustedCap||0), 0);
  const totConfIdle   = stores.reduce((s,st) => s+(st.confirmedIdle||0),  0);
  const totConfLoss   = stores.reduce((s,st) => s+(st.confirmedLoss||0),  0);
  const totMtdUsage   = stores.reduce((s,st) => s+(st.mtdUsage||0),       0);
  const totMtdDesignCap = stores.reduce((s,st) => s+(st.mtdDesignCap||0), 0);
  const totMtdAdjustedCap = stores.reduce((s,st) => s+(st.mtdAdjustedCap||0), 0);
  const totMtdIdle    = stores.reduce((s,st) => s+(st.mtdIdle||0),        0);
  const totMtdLoss    = stores.reduce((s,st) => s+(st.mtdLoss||0),        0);
  const totProjUsage  = stores.reduce((s,st) => s+(st.projUsage||0),      0);
  const totProjDesignCap = stores.reduce((s,st) => s+(st.projDesignCap||0), 0);
  const totProjAdjustedCap = stores.reduce((s,st) => s+(st.projAdjustedCap||0), 0);
  const totProjIdle   = stores.reduce((s,st) => s+(st.projIdle||0),       0);
  const totProjLoss   = stores.reduce((s,st) => s+(st.projLoss||0),       0);
  const totDesignMonthCap = stores.reduce((s,st) => s+(st.rawCap||0),     0);
  const totAdjustedMonthCap = stores.reduce((s,st) => s+(st.monthCap||0), 0);
  const hasMTD        = stores.some(s => s.hasMTD);
  const confDesignUtil = totConfDesignCap > 0 ? totConfUsage / totConfDesignCap * 100 : 0;
  const confAdjustedUtil = totConfAdjustedCap > 0 ? totConfUsage / totConfAdjustedCap * 100 : 0;
  const mtdDesignUtil = totMtdDesignCap > 0 ? totMtdUsage / totMtdDesignCap * 100 : 0;
  const mtdAdjustedUtil = totMtdAdjustedCap > 0 ? totMtdUsage / totMtdAdjustedCap * 100 : 0;
  const projDesignUtil = totProjDesignCap > 0 ? totProjUsage / totProjDesignCap * 100 : 0;
  const projAdjustedUtil = totProjAdjustedCap > 0 ? totProjUsage / totProjAdjustedCap * 100 : 0;
  const confMonthCounts = stores.map(s => s.confirmedMonths || 0);
  const confMonthLabel = confMonthCounts.length && confMonthCounts.every(v => v === confMonthCounts[0])
    ? `${confMonthCounts[0]}개월 마감 완료`
    : '매장별 운영기간 반영';

  // 계절지수 (확정월 기준) — 2025 실적 기반 매장별 월평균으로 계산
  const confSeasonUsage = stores.reduce((s,st) => s+(st.confirmedSeasonUsage||0), 0);
  const confSeasonBase = stores.reduce((s,st) => s+(st.confirmedSeasonBase||0), 0);
  const confSeasonIdx  = confSeasonBase > 0 ? confSeasonUsage / confSeasonBase : null;

  // 상태 배지 헬퍼
  function sBadge(type) {
    return `<span class="status-badge ${type}" title="${STATUS_TIP[type]||''}">${STATUS_LABEL[type]||type}</span>`;
  }
  const utilColor = c => c >= 80 ? '#216552' : c >= 60 ? '#c07b48' : '#b24c58';
  const lossColor = v => v > 50000000 ? '#b24c58' : v > 20000000 ? '#c07b48' : '#216552';

  // 패널 부제목을 최신 원천 정의와 일치시킨다.
  const capPanelArt = el.closest('article') || el.closest('section');
  if (capPanelArt) {
    const capSub = capPanelArt.querySelector('.sub');
    if (capSub) capSub.textContent = '원천 Capacity·MTD Capacity 기준 운영 효율 분석';
  }

  // ── 기준 고지 ────────────────────────────────────────────────
  let html = `<div style="padding:6px 10px;background:var(--navy-soft);border:1px solid rgba(36,51,80,.12);border-radius:var(--r-sm);font-size:11px;color:#4a5568;margin-bottom:12px;line-height:1.6">
    <strong>심층 분석 기준:</strong> 최신 시트의 월 Capacity와 MTD Capacity를 직접 사용합니다. 미마감월과 안성 오픈월은 원천 시트의 유효 경과일이 반영됩니다.
  </div>`;

  // ── 이상값 배너 ──────────────────────────────────────────────
  const anomalySet = new Set(stores.flatMap(s => s.anomalies||[]));
  if (anomalySet.has('over_capacity'))
    html += `<div class="cap-anomaly-banner">⚠ 선택 기간 중 Capacity 100% 초과 이력이 있습니다. 해당 월의 원천 Capacity를 재확인하세요.</div>`;
  if (anomalySet.has('usage_zero_revenue_nonzero'))
    html += `<div class="cap-anomaly-banner">⚠ 데이터 점검 필요 — 총사용 0대인데 매출이 존재하는 월/매장 있음</div>`;
  if (anomalySet.has('usage_nonzero_revenue_zero'))
    html += `<div class="cap-anomaly-banner">⚠ 데이터 점검 필요 — 총사용 대수가 있는데 매출이 0원인 월/매장 있음</div>`;
  if (anomalySet.has('mtd_data_missing'))
    html += `<div class="cap-anomaly-banner">⚠ MTD 사용량 미집계 — 당월 총사용 관측값이 없는 매장은 MTD 유휴 Capacity와 월말 예상을 산출하지 않음</div>`;

  // ── 확정월 요약 ──────────────────────────────────────────────
  html += `<div class="cap-section-divider">확정 구간 ${sBadge('confirmed')} <span style="font-size:10px;color:#9e8c7e;font-weight:400">${confMonthLabel}</span></div>
  <div class="cap-summary">
    <div class="cap-sum-item">
      <div class="cap-sum-label">확정 가동률${capTip('확정월 총사용 ÷ 원천 월 Capacity<br>매장 오픈월은 원천 시트의 유효 Capacity 적용')}</div>
      <div class="cap-sum-val" style="color:${utilColor(confDesignUtil)}">${totConfDesignCap>0
        ? `${fmtP(confDesignUtil)}`
        : '—'}</div>
      <div class="cap-sum-sub">원천 Capacity ${fmtN(totConfDesignCap)}대</div>
    </div>
    <div class="cap-sum-item">
      <div class="cap-sum-label">월 Capacity${capTip('최신 시트 fact_monthly의 매장별 유효 월 Capacity 합계')}</div>
      <div class="cap-sum-val">${fmtN(totDesignMonthCap)}</div>
      <div class="cap-sum-sub">운영 대상 매장 월 기준</div>
    </div>
    <div class="cap-sum-item">
      <div class="cap-sum-label">확정 유휴 Capacity${capTip('MAX(0, 원천 Capacity − 확정월 총사용)<br>확정 기간 합산 기준')}</div>
      <div class="cap-sum-val bad">${fmtN(totConfIdle)}<span style="font-size:11px;font-weight:600">대</span></div>
    </div>
    <div class="cap-sum-item">
      <div class="cap-sum-label">확정 기회금액 상한${capTip('확정 유휴 Capacity × 보수적 단가<br>수요를 반영하지 않은 상한 추정치이며 실제 손실이 아님')}</div>
      <div class="cap-sum-val bad">${fmtS(totConfLoss)}</div>
    </div>
    <div class="cap-sum-item">
      <div class="cap-sum-label">계절 지수 (확정)${capTip('2025 매장별 월평균 대비 확정월 총사용<br>2025 기준선이 없는 신규 매장은 제외')}</div>
      <div class="cap-sum-val" style="color:${confSeasonIdx==null?'var(--muted)':confSeasonIdx>=1?'#216552':confSeasonIdx>=0.8?'#c07b48':'#b24c58'}">${confSeasonIdx==null?'—':confSeasonIdx.toFixed(2)}</div>
      <div class="cap-sum-sub">2025 실적 보유 매장 기준</div>
    </div>
  </div>`;

  // ── 당월 MTD / 예상 섹션 ─────────────────────────────────────
  if (hasMTD) {
    html += `<div class="cap-section-divider">당월 진행 ${sBadge('mtd')} <span style="font-size:10px;color:#9e8c7e;font-weight:400">${getMtdDay()}일 경과 기준</span></div>
    <div class="cap-summary">
      <div class="cap-sum-item">
        <div class="cap-sum-label">MTD 가동률${capTip('당월 총사용 ÷ 원천 MTD Capacity<br>오픈월은 오픈일부터 원천 최신일까지 일할 적용')}</div>
        <div class="cap-sum-val" style="color:${utilColor(mtdDesignUtil)}">${totMtdDesignCap>0
          ? `${fmtP(mtdDesignUtil)}`
          : '—'} ${sBadge('mtd')}</div>
        <div class="cap-sum-sub">원천 MTD Capacity ${fmtN(totMtdDesignCap)}대</div>
      </div>
      <div class="cap-sum-item">
        <div class="cap-sum-label">MTD 유휴 Capacity${capTip('MAX(0, 원천 MTD Capacity − 당월 총사용)')}</div>
        <div class="cap-sum-val bad">${fmtN(totMtdIdle)}대 ${sBadge('mtd')}</div>
      </div>
      <div class="cap-sum-item">
        <div class="cap-sum-label">MTD 기회금액 상한${capTip('MTD 유휴 Capacity × 보수적 단가<br>실제 손실이 아닌 상한 추정치')}</div>
        <div class="cap-sum-val bad">${fmtS(totMtdLoss)} ${sBadge('mtd')}</div>
      </div>
      <div class="cap-sum-item">
        <div class="cap-sum-label">예상 가동률${capTip('원천 월말예상총사용 ÷ 원천 월 Capacity')}</div>
        <div class="cap-sum-val" style="color:${utilColor(projDesignUtil)}">${totProjDesignCap>0
          ? `${fmtP(projDesignUtil)}`
          : '—'} ${sBadge('projected')}</div>
      </div>
      <div class="cap-sum-item">
        <div class="cap-sum-label">예상 기회금액 상한${capTip('예상 유휴 Capacity × 보수적 단가<br>현재 추세 기준 월말 환산 참고치')}</div>
        <div class="cap-sum-val bad">${fmtS(totProjLoss)} ${sBadge('projected')}</div>
      </div>
    </div>`;
  }

  // ── 매장별 상세 카드 ─────────────────────────────────────────
  // ★ Priority 8: Capacity > 100% 매장 경고 카드 (항상 표시)
  const overCapStores = stores.filter(s => {
    const u = s.hasMTD ? s.mtdUtil : s.confirmedUtil;
    return u > 100;
  });
  if (overCapStores.length > 0) {
    html += `<div class="cap-anomaly-banner" style="background:#fde8ea;border-color:#b24c58;margin-bottom:8px">
      🚨 <strong>Capacity 100% 초과 매장:</strong> ${overCapStores.map(s=>{
        const u = s.hasMTD ? s.mtdUtil : s.confirmedUtil;
        return `${s.name} (${fmtP(u)})`;
      }).join(' · ')} — 원천 Capacity 재확인 또는 증설 검토 필요
    </div>`;
  }

  // ★ Priority 8: 매장별 상세 — 기본 접힘 (toggle 버튼으로 펼치기)
  html += `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div class="cap-section-divider" style="margin:0;flex:1">매장별 상세</div>
    <button class="collapse-toggle collapsed" data-target="capStoreGrid" style="font-size:10.5px;padding:2px 8px;white-space:nowrap">
      <span class="arrow">▾</span><span class="toggle-label">펼치기</span>
    </button>
  </div>
  <div id="capStoreGrid" class="collapsible-content collapsed">
  <div class="cap-store-grid">`;

  [...stores].sort((a,b) => {
    const ua = a.hasMTD ? a.mtdDesignUtil : a.confirmedDesignUtil;
    const ub = b.hasMTD ? b.mtdDesignUtil : b.confirmedDesignUtil;
    return ub - ua;
  }).forEach(s => {
    const designUtil = s.hasMTD ? s.mtdDesignUtil : s.confirmedDesignUtil;
    const adjUtil    = s.hasMTD ? s.mtdAdjustedUtil : s.confirmedAdjustedUtil;
    const dispIdle   = s.hasMTD ? s.mtdIdle   : s.confirmedIdle;
    const dispLoss   = s.hasMTD ? s.mtdLoss   : s.confirmedLoss;
    const dispUsage  = s.hasMTD ? s.mtdUsage  : s.confirmedUsage;
    const dispDesignCap = s.hasMTD ? s.mtdDesignCap : s.confirmedDesignCap;
    const dispAdjustedCap = s.hasMTD ? s.mtdAdjustedCap : s.confirmedAdjustedCap;
    const dispStatus = s.hasMTD ? 'mtd' : 'confirmed';

    const utilDualLabel = dispDesignCap > 0
      ? `원천 기준 ${fmtP(designUtil)}`
      : `원천 기준 ${fmtP(designUtil)}`;

    const bColor = utilColor(designUtil);
    const barW   = Math.min(100, designUtil).toFixed(1);

    // 이상값 배지 (카드 단위)
    let cardBadge = '';
    if ((s.anomalies||[]).includes('over_capacity'))
      cardBadge += `<span class="status-badge anomaly" style="margin-left:0;margin-bottom:5px;display:inline-block">기간 중 Capacity 초과 이력</span> `;
    if ((s.anomalies||[]).some(a=>a.includes('usage')))
      cardBadge += `<span class="status-badge anomaly" style="margin-left:0;margin-bottom:5px;display:inline-block">데이터 점검 필요</span>`;
    if ((s.anomalies||[]).includes('mtd_data_missing'))
      cardBadge += `<span class="status-badge anomaly" style="margin-left:0;margin-bottom:5px;display:inline-block">MTD 미집계</span>`;

    html += `<div class="cap-store-card">
      <div class="cap-store-head">
        <span class="cap-store-name">${s.name}</span>
        <span class="cap-store-util" style="color:${bColor}">${utilDualLabel} ${sBadge(dispStatus)}</span>
      </div>
      ${cardBadge ? `<div style="margin-bottom:5px">${cardBadge}</div>` : ''}
      <div class="cap-bar-wrap">
        <div class="cap-bar" style="width:${barW}%;background:${bColor}88;${s.hasMTD?'border-right:2px dashed '+bColor:''}"></div>
        ${designUtil > 100 ? '<span class="cap-over">OVER</span>' : ''}
      </div>
      <div class="cap-store-meta">
        <span>${s.hasMTD?'MTD':'확정월 누적'} ${fmtN(dispUsage)}대 / Capacity ${fmtN(dispDesignCap)}대</span>
        <span style="color:${lossColor(dispLoss)}">${s.hasMTD?'MTD':'확정'} 기회금액 상한 ${fmtS(dispLoss)}</span>
      </div>
      <div class="cap-store-meta" style="margin-top:3px">
        <span class="period-badge" style="font-size:10px;color:var(--muted);background:var(--bg2);border-radius:4px;padding:1px 6px">${s.confirmedMonths > 0 ? `확정 ${s.confirmedMonths}개월${s.hasMTD?' + MTD':''}` : (s.hasMTD ? 'MTD만' : '—')}</span>
      </div>
      <div class="cap-idle">보수 단가 ~${fmtS(Math.round(s.conservativePrice||0))}/대 · 유휴 <strong>${fmtN(dispIdle)}대</strong>${s.priceSource==='available_history'?' · 가용 과거 매출 단가 적용':''}</div>
      ${s.hasMTD && s.projUsage > 0 ? `
      <div class="cap-idle" style="color:#c07b48;margin-top:4px">
        예상 가동률 ${fmtP(s.projDesignUtil)} · 기회금액 상한 ${fmtS(s.projLoss)} ${sBadge('projected')}
      </div>` : ''}
    </div>`;
  });
  html += `</div></div>`;   // close .cap-store-grid + #capStoreGrid collapsible

  // ── 산정 기준 고지 ─────────────────────────────────────────
  const avgPrice = stores.length ? stores.reduce((s,st)=>s+(st.conservativePrice||0),0)/stores.length : UNIT_PRICE_TARGET;
  html += `<div class="cap-basis-note">
    <strong>산정 기준</strong> ·
    적용 단가: <strong>보수적 단가 (순매출 ÷ 총사용)</strong>, 기간 평균 약 ${fmtS(Math.round(avgPrice))}/대 ·
    유휴 Capacity = MAX(0, 원천 Capacity − 실제 세차 대수) ·
    <strong>확정월·MTD</strong>: 오픈월 운영일수 일할 적용 ·
    <strong>기회금액 상한</strong>: 유휴 Capacity × 보수적 단가, 수요·시간대·요일 변동 미반영 ·
    <strong>실제 손실이 아님</strong>
  </div>`;

  el.innerHTML = html;
}

// [Change 3] renderSeasonChart: store-aware — !ent.isAll 시 SEASON_MONTHLY_2025_STORE[ent.name]
//   단일 매장 2025 기준선 사용. ent.isAll 시 합산 SEASON_MONTHLY_2025 + SEASON_BASE_USAGE 사용.
function renderSeasonChart(ent) {
  const el = $('seasonChart');
  if (!el) return;
  const ms = ent.months;
  const mtdDay = getMtdDay();
  const labels = ms.map(m => chartMonthLabel(m));

  // ── 2025 기준선 데이터 선택 (매장 or 합산) ──────────────────────
  // 매장별 월평균을 SEASON_BASE_USAGE(합산 기준)로 쓰면 왜곡되므로,
  // 매장 뷰에서는 해당 매장 2025 연간 세차대수 ÷ 12 를 기준 삼음
  const storeRef2025 = (!ent.isAll && SEASON_MONTHLY_2025_STORE[ent.name])
    ? SEASON_MONTHLY_2025_STORE[ent.name] : null;
  const storeAnnual2025 = (!ent.isAll && STORE_ANNUAL_2025[ent.name])
    ? STORE_ANNUAL_2025[ent.name] : null;
  const storeBase = storeAnnual2025 ? storeAnnual2025 / 12 : SEASON_BASE_USAGE;

  // 각 월의 2025 실적 (합산 or 매장)
  const ref2025Usage = ms.map(m => {
    if (!m.monthNum) return null;
    if (storeRef2025) return storeRef2025[m.monthNum] || null;
    return SEASON_MONTHLY_2025[m.monthNum] || null;
  });
  // 2025 공식 계절지수 (합산) or 매장 계산
  const ref2025Idx = ms.map(m => {
    if (!m.monthNum) return null;
    if (storeRef2025 && storeBase > 0)
      return +((storeRef2025[m.monthNum] || 0) / storeBase).toFixed(3);
    return SEASON_IDX_2025[m.monthNum] || null;
  });

  // ── 2026 데이터 배열: 상태별 분리 ────────────────────────────────
  const confirmedBars = ms.map(m => m.status === 'confirmed' ? (m.usage || 0) : null);
  const mtdBars       = ms.map(m => m.status === 'mtd'       ? (m.usage || 0) : null);

  // 확정 계절지수 (공식값) = 2026 usage / storeBase
  const confirmedIdx = ms.map(m => {
    if (m.status !== 'confirmed') return null;
    return storeBase > 0 ? +((m.usage||0) / storeBase).toFixed(3) : null;
  });
  // MTD 계절 추이 = 당월 총사용 / (기준선 × 경과일/월일수)
  const mtdIdx = ms.map(m => {
    if (m.status !== 'mtd') return null;
    const dim = daysInMonth(m.monthNum);
    if (!storeBase || !dim || !mtdDay) return null;
    return +((m.usage||0) / (storeBase * mtdDay / dim)).toFixed(3);
  });
  // 예상 계절지수 = 예상 총사용 / 기준선
  const projIdx = ms.map(m => {
    if (m.status !== 'mtd') return null;
    const dim = daysInMonth(m.monthNum);
    const projUsage = mtdDay > 0 ? Math.round((m.usage||0) / mtdDay * dim) : 0;
    return storeBase > 0 ? +(projUsage / storeBase).toFixed(3) : null;
  });

  // ── YoY 세차대수 비교: 해당 월 2026 vs 2025 ────────────────────
  // 막대 위에 YoY% 레이블을 datalabel로 표시
  const yoyPct = ms.map(m => {
    if (!m.monthNum) return null;
    const ref = storeRef2025 ? (storeRef2025[m.monthNum]||0) : (SEASON_MONTHLY_2025[m.monthNum]||0);
    if (!ref) return null;
    return +((( (m.usage||0) / ref ) - 1) * 100).toFixed(1);
  });

  mkChart('seasonChart', {
    data:{
      labels,
      datasets:[
        // ① 2025 기준 막대 (배경 — 가장 먼저 그려야 뒤에 렌더)
        { type:'bar', label:'2025 실적', data:ref2025Usage,
          backgroundColor:'rgba(160,148,136,0.18)',
          borderColor:'rgba(160,148,136,0.5)', borderWidth:1,
          borderRadius:2, yAxisID:'cnt', order:3, spanGaps:false },
        // ② 2026 확정 막대 — solid navy gradient
        { type:'bar', label:'세차 대수 (확정)', data:confirmedBars,
          backgroundColor:makeGrad(null,36,52,79,.70,.30),
          borderColor:PALETTE.navy, borderWidth:0, borderRadius:4,
          yAxisID:'cnt', order:2, spanGaps:false },
        // ③ 2026 MTD 막대 — 반투명 navy
        { type:'bar', label:'세차 대수 (MTD)', data:mtdBars,
          backgroundColor:'rgba(36,52,79,0.25)',
          borderColor:PALETTE.navy, borderWidth:1.5, borderRadius:4,
          yAxisID:'cnt', order:2, spanGaps:false },
        // ④ 2025 기준 계절지수 — gray dashed 참고선
        { type:'line', label:'2025 계절지수', data:ref2025Idx,
          borderColor:'rgba(140,130,120,0.7)', borderWidth:1.5,
          borderDash:[6,4],
          pointRadius:3, pointBackgroundColor:'rgba(140,130,120,0.6)',
          fill:false, tension:0.3, yAxisID:'idx', order:4, spanGaps:false },
        // ⑤ 2026 확정 계절지수 — solid accent line
        { type:'line', label:'계절지수 (확정)', data:confirmedIdx,
          borderColor:PALETTE.accent, borderWidth:2.5,
          pointRadius:5, pointBackgroundColor:PALETTE.accent, pointBorderColor:PALETTE.accent,
          fill:false, tension:0.3, yAxisID:'idx', order:1, spanGaps:false },
        // ⑥ MTD 계절 추이 — dashed teal, triangle marker
        { type:'line', label:'MTD 계절 추이', data:mtdIdx,
          borderColor:PALETTE.teal, borderWidth:2,
          borderDash:[5,4],
          pointRadius:7, pointStyle:'triangle',
          pointBackgroundColor:PALETTE.teal, pointBorderColor:PALETTE.teal,
          fill:false, tension:0, yAxisID:'idx', order:1, spanGaps:false },
        // ⑦ 예상 계절지수 — dashed amber, hollow diamond
        { type:'line', label:'예상 계절지수', data:projIdx,
          borderColor:PALETTE.amber, borderWidth:2,
          borderDash:[4,4],
          pointRadius:7, pointStyle:'rectRot',
          pointBackgroundColor:'transparent', pointBorderColor:PALETTE.amber, pointBorderWidth:2,
          fill:false, tension:0, yAxisID:'idx', order:1, spanGaps:false }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{position:'top',labels:{boxWidth:10,padding:10,usePointStyle:true,
          filter: item => item.datasetIndex !== 0  // 2025 막대 범례 숨김 (배경 바)
        }},
        tooltip:{
          callbacks:{
            label: ctx => {
              if (ctx.raw === null) return null;
              const di = ctx.datasetIndex;
              if (di === 0) return ` 2025 실적: ${fmtN(ctx.raw)}대`;
              if (di <= 2)  {
                const yoy = yoyPct[ctx.dataIndex];
                const yoyStr = yoy !== null ? ` (YoY ${yoy>=0?'+':''}${yoy}%)` : '';
                return ` 2026 세차 대수: ${fmtN(ctx.raw)}대${yoyStr}`;
              }
              const idxLabels = {3:'2025 계절지수', 4:'계절지수(확정)', 5:'MTD 계절추이', 6:'예상 계절지수'};
              const tips = {4:STATUS_TIP.confirmed, 5:STATUS_TIP.mtd, 6:STATUS_TIP.projected};
              const tip = tips[di] ? ` — ${tips[di]}` : ' — 2025 기준선';
              return ` ${idxLabels[di]||''}: ${(+ctx.raw).toFixed(2)}${tip}`;
            },
            filter: item => item.raw !== null
          }
        },
        datalabels:{
          display: ctx => {
            const di = ctx.datasetIndex;
            if (ctx.raw === null) return false;
            // 계절지수 계열에만 레이블 (4,5,6)
            return di >= 4;
          },
          anchor:'end', align:'top',
          formatter: v => v != null ? v.toFixed(2) : '',
          font:{size:9.5, weight:700},
          color: ctx => {
            const c = {4:PALETTE.accent, 5:PALETTE.teal, 6:PALETTE.amber};
            return c[ctx.datasetIndex] || '#888';
          }
        }
      },
      scales:{
        cnt:{
          position:'left',
          ticks:{callback:v=>`${Math.round(v/1000)}k`},
          grid:{color:'#f0ebe3'},
          stacked:false
        },
        idx:{
          position:'right',
          ticks:{callback:v=>v.toFixed(1)},
          grid:{display:false},
          min:0, suggestedMax:1.5
        },
        x:{grid:{display:false}}
      }
    }
  });
}

/* ── 15-D. 구독 현황 패널 ───────────────────────────────────── */
function renderSubscriptionPipeline(ent) {
  const el = $('subPipeline');
  if (!el) return;
  const ms = ent.months;
  if (!ms.length) { el.innerHTML = '<p style="color:#9e8c7e;font-size:12px">데이터 없음</p>'; return; }

  // 가장 최근 달 기준
  const last = ms[ms.length-1];
  const retained   = last.retained   || 0;
  const newSubs    = last.newSubs    || 0;
  const cancelSubs = last.cancelSubs || 0;
  const netAdds    = last.netAdds != null ? last.netAdds : newSubs - cancelSubs;
  const flowBase   = Math.max(newSubs, cancelSubs, Math.abs(netAdds), 1);
  const churnPct   = retained > 0 ? cancelSubs / retained * 100 : 0;
  const acquisitionPct = retained > 0 ? newSubs / retained * 100 : 0;
  const flowRows = [
    { label:'월중 신규', val: newSubs, color:'#1d7a8a', note:`유지 대비 ${fmtP(acquisitionPct)}` },
    { label:'월중 해지', val: cancelSubs, color:'#b24c58', note:`유지 대비 ${fmtP(churnPct)}` },
    { label:'순증감', val: netAdds, color:netAdds>=0?'#216552':'#b24c58', note:newSubs >= cancelSubs ? '신규 우위' : '해지 우위' }
  ];

  el.innerHTML = `
    <div class="pipe-summary-card">
      <div>
        <div class="pipe-label">월말 매장PASS 유지 구독자</div>
        <div class="pipe-main-val">${fmtN(retained)}명</div>
      </div>
      <div class="pipe-summary-note">${last.month} 기준</div>
    </div>
    <div class="pipe-flow-title">월중 변동 흐름</div>
    ${flowRows.map(s => {
      const absVal = Math.abs(s.val || 0);
      const w = Math.max(6, (absVal / flowBase * 100)).toFixed(1);
      const signVal = s.label === '순증감' && s.val > 0 ? `+${fmtN(s.val)}` : fmtN(s.val);
      return `<div class="pipe-row">
        <div class="pipe-label-row">
          <span class="pipe-label">${s.label}</span>
          <span class="pipe-note">${s.note}</span>
        </div>
        <div class="pipe-bar-wrap">
          <div class="pipe-bar" style="width:${w}%;background:${s.color}88"></div>
          <span class="pipe-val" style="color:${s.color}">${signVal}명</span>
        </div>
      </div>`;
    }).join('')}
    <div class="pipe-footnote">매장PASS 유지는 월말 스냅샷, 신규·해지는 월중 발생 건수입니다. ALL PASS는 전사 MRR·전체 활성 구독자 범위에만 별도 포함됩니다.</div>
  `;

  // MoM 변화 요약
  if (ms.length >= 2) {
    const prev = ms[ms.length-2];
    const delta = (last.netAdds||0) - (prev.netAdds||0);
    const trend = delta >= 0 ? `<span style="color:#216552">▲ ${delta > 0 ? '+' : ''}${fmtN(delta)}</span>` : `<span style="color:#b24c58">▼ ${fmtN(delta)}</span>`;
    el.innerHTML += `<div class="pipe-footer">순증감 ${(last.netAdds||0)>=0?'+':''}${fmtN(last.netAdds||0)}명 · 전월 대비 ${trend}</div>`;
  }
}

/* ── 15-D2. 이탈 원인 분류 (자발/비자발) ──────────────────────── */
// ★ Change 7: 이탈 원인 분류 분석 섹션
function renderChurnClassification(ent) {
  const el = $('churnClassPanel');
  if (!el) return;
  const c  = ent.current;
  const ms = ent.months;

  const cancelSubs = c.cancelSubs || 0;
  const voluntary  = Math.round(cancelSubs * 0.70);
  const involuntary= cancelSubs - voluntary;
  const churnRate  = c.churn || 0;
  const volRate    = churnRate * 0.70;
  const invRate    = churnRate * 0.30;

  // 트렌드 — 최근 달 이탈 합계
  const totalCancelAll = ms.reduce((s,m)=>s+(m.cancelSubs||0),0);
  const totalVolAll    = Math.round(totalCancelAll * 0.70);
  const totalInvAll    = totalCancelAll - totalVolAll;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div>
        <h2 style="font-size:14px;font-weight:800;margin:0 0 3px">이탈 원인 분류 분석</h2>
        <p class="sub" style="margin:0">자발적 이탈 vs 비자발적 이탈 (결제실패) 추정 분류</p>
      </div>
      <span class="section-tag" style="background:var(--rose-soft);color:var(--rose)">구독 엔진</span>
    </div>

    <!-- ★ v3: 강화된 추정치 경고 배너 (섹션 최상단, 눈에 띄게) -->
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:rgba(192,123,72,.12);border:1.5px solid rgba(192,123,72,.45);border-radius:var(--r-md);margin-bottom:12px">
      <span style="font-size:16px;line-height:1.2">⚠</span>
      <div>
        <div style="font-size:12px;font-weight:900;color:var(--amber);margin-bottom:3px">추정치 — 실데이터 미연결</div>
        <div style="font-size:11.5px;color:var(--text-2);line-height:1.55">
          아래 수치는 <strong>업계 평균 비율(자발 70% / 결제실패 30%)</strong>을 적용한 통계적 추정값입니다.
          실제 해지 원인 데이터(CRM·결제 실패 로그)가 연결되지 않은 상태로,
          의사결정 참고용으로만 사용하세요.
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <!-- 자발적 이탈 -->
      <div style="background:var(--surface-soft);border:1px solid var(--border);border-left:3px solid var(--amber);border-radius:var(--r-md);padding:14px 16px">
        <div style="font-size:10.5px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">자발적 이탈 <span style="font-weight:500;opacity:.7">(추정)</span></div>
        <div style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:2px">${fmtN(voluntary)}명<sup style="font-size:10px;color:var(--amber);font-weight:700"> 추정</sup></div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${fmtP(volRate)} · 전체 해지의 70%</div>
        <div style="height:6px;background:var(--bg2);border-radius:99px;overflow:hidden;margin-bottom:8px">
          <div style="height:100%;width:70%;background:var(--amber);border-radius:99px"></div>
        </div>
        <div style="font-size:11.5px;color:var(--text-2);font-weight:600">→ 서비스 품질 점검 · 혜택 강화</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">기간 합산: ${fmtN(totalVolAll)}명 추정</div>
      </div>
      <!-- 비자발적 이탈 -->
      <div style="background:var(--surface-soft);border:1px solid var(--border);border-left:3px solid var(--rose);border-radius:var(--r-md);padding:14px 16px">
        <div style="font-size:10.5px;font-weight:700;color:var(--rose);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">비자발적 이탈 (결제실패) <span style="font-weight:500;opacity:.7">(추정)</span></div>
        <div style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:2px">${fmtN(involuntary)}명<sup style="font-size:10px;color:var(--rose);font-weight:700"> 추정</sup></div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${fmtP(invRate)} · 전체 해지의 30%</div>
        <div style="height:6px;background:var(--bg2);border-radius:99px;overflow:hidden;margin-bottom:8px">
          <div style="height:100%;width:30%;background:var(--rose);border-radius:99px"></div>
        </div>
        <div style="font-size:11.5px;color:var(--text-2);font-weight:600">→ 결제 재시도 자동화 · 문자 알림 강화</div>
        <div style="font-size:11px;color:var(--muted);margin-top:3px">기간 합산: ${fmtN(totalInvAll)}명 추정</div>
      </div>
    </div>

    <!-- 시각적 비율 바 -->
    <div style="margin-bottom:10px">
      <div style="display:flex;height:18px;border-radius:99px;overflow:hidden;gap:2px">
        <div style="width:70%;background:var(--amber);display:flex;align-items:center;justify-content:center">
          <span style="font-size:10px;font-weight:800;color:#fff">자발 70% (추정)</span>
        </div>
        <div style="width:30%;background:var(--rose);display:flex;align-items:center;justify-content:center">
          <span style="font-size:10px;font-weight:800;color:#fff">결제 30% (추정)</span>
        </div>
      </div>
    </div>

    <!-- 실데이터 연결 안내 -->
    <div style="padding:8px 12px;background:var(--surface-soft);border:1px solid var(--border);border-radius:var(--r-sm);font-size:11px;color:var(--muted);line-height:1.6">
      💡 <strong>실데이터 연결 방법:</strong> CRM 해지 사유 분류 + PG사 결제 실패 로그를 연동하면
      이 섹션이 실제 수치로 자동 업데이트됩니다 (담당: 사업운영팀).
    </div>
  `;
}

/* ── 15-E. 결제 단가 / ARPU 상세 패널 ─────────────────────────── */
function renderPaymentPanel(ent) {
  const el = $('paymentPanel');
  if (!el) return;
  const c = ent.current;

  // ARPU: 집계된 값 사용. 추가 단가 데이터는 별도 시트 연동 시 확장 가능
  const arpu  = c.arpu || 0;
  const gross = c.gross || 0;
  const usage = c.usage || 0;
  const net   = c.net   || 0;
  const mrr   = c.mrr   || 0;
  const retained = c.retained || 0;
  const arr   = c.arr   || 0;
  const ltv   = c.ltv   || 0;

  // 단가 추정 (available data)
  const revenuePerWash  = usage > 0 ? gross / usage : 0;    // 실결제매출 / 총사용 = 건당 매출
  const netPerWash      = usage > 0 ? net   / usage : 0;    // 순매출 / 총사용 = 건당 순매출
  const mrrPerSub       = retained > 0 ? mrr / retained : 0; // MRR / 유지 구독 = 구독 ARPU

  const items = [
    { label:'건당 매출', val:fmtS(revenuePerWash),
      note:`실결제매출 ÷ ${fmtN(usage)}대`, color:'navy' },
    { label:'건당 순매출', val:fmtS(netPerWash),
      note:`실결제매출에서 환불·기타 차감 후`, color:'green' },
    { label:'구독 ARPU', val:arpu>0?fmtS(arpu):(mrrPerSub>0?fmtS(mrrPerSub):'—'),
      note:arpuBasisLabel(c), color:'accent' },
    { label:'목표 실현 단가', val:`${fmtN(UNIT_PRICE_TARGET)}원`,
      note:`Capacity 기회금액 상한 기준 단가`, color:'amber' }
  ];

  el.innerHTML = items.map(it => `
    <div class="pay-item ${it.color}">
      <div class="pay-label">${it.label}</div>
      <div class="pay-val">${it.val}</div>
      <div class="pay-note">${it.note}</div>
    </div>`).join('') + `
  <div class="pay-row" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:2px">
    <div class="pay-item accent">
      <div class="pay-label">ARR${kpiTooltipIcon('ARR')}</div>
      <div class="pay-val">${arr > 0 ? fmtS(arr) : '—'}</div>
      <div class="pay-note">${c.arrYoY ? `YoY ${c.arrYoY > 0 ? '+' : ''}${fmtP(c.arrYoY)}` : 'MRR × 12'}</div>
    </div>
    <div class="pay-item navy">
      <div class="pay-label">LTV (추정)${kpiTooltipIcon('LTV')}</div>
      <div class="pay-val">${ltv > 0 ? fmtW(ltv) : '—'}</div>
      <div class="pay-note">ARPU ÷ 월 이탈률 추정</div>
    </div>
  </div>`;
}

/* ── 16. 히트맵 ─────────────────────────────────────────────── */
// ★ Priority 8: 기본 5개 지표 + 토글 3개 / 순위 hover 표시 / 안성 별도 행
let _hmShowExtra = false;  // 추가 지표 토글 상태

function renderHeatmap(ent) {
  // [Change 3] 히트맵은 포트폴리오 비교 목적 — 항상 전체 매장 표시 (필터 쿼터는 반영)
  const capData = buildCapacityData({ isAll: true, months: [] });
  const storeAgg = getActiveStores().map(s => {
    const filtMs = filterMonths(s.months);
    const agg    = aggMonths(filtMs) || {};
    const ops    = s.ops || {};
    const cap    = capData.find(c => c.name === s.name) || {};
    return {
      name:        s.name,
      status:      ops.status || '',
      achievement: agg.achievement  || 0,
      utilization: agg.utilization  || 0,
      churn:       agg.churn        || 0,
      refundRate:  agg.refundRate   || 0,
      netAdds:     agg.netAdds      || 0,
      arpu:        agg.arpu         || 0,
      gross:       agg.gross        || 0,
      lossEstimate:cap.lossEstimate || 0
    };
  });

  // ★ 오픈 전 매장 분리: 운영 매장만 히트맵 본문에, 오픈 예정은 하단 요약 행
  // gross > 0 조건 추가: 시트에 없는 오픈 예정 매장이 status=''로 슬립스루 되는 경우 방지
  const activeStores  = storeAgg.filter(s => s.status !== '오픈 전' && s.gross > 0);
  const openingStores = storeAgg.filter(s => s.status === '오픈 전');

  // ★ 기본 5개 지표 + 선택적 3개
  const metricsCore = [
    { key:'achievement',   label:'순매출 달성률',   fmt:fmtP,  inv:false },
    { key:'utilization',   label:'가동률',   fmt:fmtP,  inv:false },
    { key:'churn',         label:'이탈률',   fmt:fmtP,  inv:true  },
    { key:'refundRate',    label:'환불율',   fmt:fmtP,  inv:true  },
    { key:'lossEstimate',  label:'기회금액 상한', fmt:fmtS, inv:true }
  ];
  const metricsExtra = [
    { key:'netAdds',  label:'순증감', fmt:fmtN,  inv:false },
    { key:'arpu',     label:'ARPU',   fmt:fmtS,  inv:false },
    { key:'gross',    label:'실결제매출', fmt:fmtS,  inv:false }
  ];
  const metrics = _hmShowExtra ? [...metricsCore, ...metricsExtra] : metricsCore;

  // 열별 min/max — 운영 매장 기준 정규화
  const cols = metrics.map(m=>{
    const vals = activeStores.map(s=>s[m.key]||0);
    return { min:Math.min(...vals), max:Math.max(...vals) };
  });

  function cellColor(norm, inv) {
    const n = inv ? 1-norm : norm;
    if (n >= 0.7) return { bg:'rgba(33,101,82,.15)', text:'#1a5240' };
    if (n >= 0.4) return { bg:'rgba(192,123,72,.12)', text:'#7a4e1a' };
    return { bg:'rgba(178,76,88,.15)', text:'#7a2530' };
  }

  const selName = state.store==='all' ? null : GID.stores[state.store]?.name;
  const colCount = metrics.length + 1;  // +1 for store label

  // 토글 버튼 포함 헤더
  let html = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
    <div style="font-size:11px;font-weight:600;color:var(--muted)">운영 ${activeStores.length}개 매장 · ${metrics.length}개 지표</div>
    <button id="hmToggleExtra" style="font-size:10.5px;padding:3px 9px;border:1px solid var(--border);border-radius:12px;background:var(--bg2);color:var(--text-2);cursor:pointer">
      ${_hmShowExtra ? '▲ 간략히' : '▼ 추가 지표'}
    </button>
  </div>
  <div class="hm-head-row" style="grid-template-columns:90px ${'1fr '.repeat(metrics.length).trim()}">
    <div class="hm-head-cell" style="text-align:left">매장</div>
    ${metrics.map(m=>`<div class="hm-head-cell">${m.label}</div>`).join('')}
  </div>`;

  // 운영 매장 행 (rank는 tooltip으로 hover 시 노출)
  activeStores.forEach(s => {
    const isSelected = s.name === selName;
    html += `<div class="hm-data-row${isSelected?' selected':''}" data-store="${s.name}"
      style="grid-template-columns:90px ${'1fr '.repeat(metrics.length).trim()}">
      <div class="hm-label-cell">${s.name}</div>
      ${metrics.map((m,i)=>{
        const v = s[m.key]||0;
        const {min,max} = cols[i];
        const norm = max>min?(v-min)/(max-min):0.5;
        const {bg,text} = cellColor(norm, m.inv);
        // ★ 항상 내림차순 정렬 — inv:true(이탈률·손실 등)에서 rank 1 = 가장 위험한 매장
        const rank = [...activeStores].sort((a,b)=>(b[m.key]||0)-(a[m.key]||0)).findIndex(st=>st.name===s.name)+1;
        const rankLabel = m.inv ? `위험 ${rank}위 / ${activeStores.length}개 매장` : `${rank}위 / ${activeStores.length}개 매장`;
        // ★ 순위는 title(hover tooltip)로만 노출
        return `<div class="hm-cell" style="background:${bg};color:${text}" title="${rankLabel}">
          <span class="hm-cell-top">${m.fmt(v)}</span>
        </div>`;
      }).join('')}
    </div>`;
  });

  // ★ 오픈 예정 매장 — 하단 요약 행 (구분선 포함)
  if (openingStores.length > 0) {
    html += `<div style="border-top:1px dashed var(--border);margin:6px 0 4px;opacity:.6"></div>`;
    openingStores.forEach(s => {
      const openInfo = dashboard.opsStores?.find(o => o.name === s.name);
      const openDateStr = openInfo?.openDate || '5/15';
      html += `<div class="hm-data-row" data-store="${s.name}"
        style="grid-template-columns:90px ${'1fr '.repeat(metrics.length).trim()};opacity:.7;pointer-events:none">
        <div class="hm-label-cell" style="color:var(--teal);font-style:italic">
          ${s.name}<span style="font-size:9px;background:var(--teal);color:#fff;border-radius:3px;padding:0 4px;margin-left:4px">예정</span>
        </div>
        ${metrics.map(()=>`<div class="hm-cell hm-cell-opening" style="background:rgba(29,122,138,.06)">
          <span class="hm-cell-top" style="color:var(--teal);font-size:10px">오픈예정</span>
        </div>`).join('')}
      </div>`;
    });
    html += `<div style="font-size:10px;color:var(--teal);padding:2px 0 0 2px">▲ ${openingStores.map(s=>s.name).join(', ')} — 오픈 후 KPI 자동 집계</div>`;
  }

  $('heatmapGrid').innerHTML = html;

  // 추가 지표 토글
  const toggleBtn = document.getElementById('hmToggleExtra');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      _hmShowExtra = !_hmShowExtra;
      renderHeatmap(ent);
    });
  }

  // 클릭 이벤트 (.hm-data-row) → 인라인 드릴다운
  $('heatmapGrid').querySelectorAll('.hm-data-row').forEach(row=>{
    row.addEventListener('click', ()=>{
      const name = row.dataset.store;
      const key = Object.keys(GID.stores).find(k=>GID.stores[k].name===name);
      if (key) {
        state.store = key;
        $('storeSelect').value = key;
        renderAll();
        syncHash();
        setTimeout(() => $('inlineStoreDetail')?.scrollIntoView({ behavior:'smooth', block:'nearest' }), 80);
      }
    });
  });
}

/* ── 17. 테이블 ─────────────────────────────────────────────── */
// ★ Change 3: MoM delta 헬퍼 (invert=true → 낮을수록 좋음)
function momDelta(cur, prev, suffix='%p', invert=false) {
  if (prev == null || cur == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 0.01) return '';
  const isGood = invert ? d < 0 : d > 0;
  const cls = isGood ? 'delta-up' : 'delta-down';
  const arrow = d > 0 ? '▲' : '▼';
  return ` <span class="${cls}">${arrow}${Math.abs(d).toFixed(1)}${suffix}</span>`;
}

function renderTable(ent) {
  const selName = ent.isAll ? null : ent.name;
  // ★ 쿼터/매장 필터에 반응: 필터된 월 데이터 집계 사용
  // 심층 Capacity 계산값 조회용 — 기간·오픈월·MTD 기준을 동일하게 적용
  const capMetricMap = {};
  try {
    buildCapacityData({ isAll: true, months: [] }).forEach(d => {
      if (d.name) capMetricMap[d.name] = d;
    });
  } catch(e) {}

  const tableStores = getActiveStores().map(s => {
    const filtMs = filterMonths(s.months);
    const agg    = aggMonths(filtMs) || {};
    const ops    = s.ops || {};
    // 기간별 원천 집계만 사용하며, 운영 시트의 현재 스냅샷은 상태 표시에만 사용한다.
    // ★ Change 3: 이전 달 집계 계산
    // 여러 달 누적값에는 MoM 화살표를 붙이지 않는다. 선택 결과가 1개월일 때만
    // 해당 월과 직전 달의 월간 값을 비교한다.
    const currentMonth = filtMs.length === 1 ? filtMs[0] : null;
    const prevMonth = currentMonth
      ? s.months.find(m => m.monthNum === currentMonth.monthNum - 1) || null
      : null;
    const capMetric = capMetricMap[s.name] || {};
    const utilizationRaw = capMetric.capacity > 0 ? capMetric.utilization : 0;
    return {
      name:        s.name,
      gross:       agg.gross        || 0,
      achievement: agg.achievement  || 0,
      net:         agg.net          || 0,
      usage:       agg.usage        || 0,
      utilization: agg.utilization  || 0,
      utilizationRaw,
      refundRate:  agg.refundRate   || 0,
      churn:       agg.churn        || 0,
      netAdds:     agg.netAdds      || 0,
      arpu:        agg.arpu         || 0,
      lossEstimate: capMetric.lossEstimate || 0,
      opsStatus:   ops.status       || '—',   // 시트 원본 상태 (참고용)
      // prev period for MoM arrows
      prevUtil:    prevMonth ? (prevMonth.utilization || 0) : null,
      prevRefund:  prevMonth ? (prevMonth.refundRate  || 0) : null,
      prevAch:     prevMonth ? (prevMonth.achievement || 0) : null,
    };
  });

  // ★ v3: 파생 상태 계산 함수 — 실데이터 기반 다중 조건
  // 우선 점검 매장 로직과 동일 기준 사용
  function deriveStoreStatus(s) {
    if (s.opsStatus === '오픈 전') return { text:'오픈 전', cls:'open' };
    const ach      = s.achievement    || 0;
    const util     = s.utilization    || 0;
    const utilRaw  = s.utilizationRaw || util;
    const refund   = s.refundRate     || 0;
    const churn    = s.churn          || 0;
    const loss     = s.lossEstimate   || 0;

    // ── 리스크 유형별로 단 하나의 태그만 선택 (중복 방지) ──
    // 각 차원에서 해당하는 단 하나의 가장 심각한 단계만 등록
    const risks = [];

    // [Capacity 차원] 가동률 100% 초과 매장만 — % 기반 판정
    if (utilRaw > 100 || util > 100)            risks.push({ score:150, tag:'Capacity 검토' });

    // [이탈 차원] 3단계 구간 — 가장 높은 단계 하나만
    //   심각: 15% 초과 / 위험: 10~15% / 주의: 6~10%
    if      (churn > 15)                        risks.push({ score:130, tag:'이탈 집중관리' });
    else if (churn > 10)                        risks.push({ score:90,  tag:'이탈 관리필요' });
    else if (churn > 6)                         risks.push({ score:50,  tag:'이탈 주의' });

    // [환불 차원] 2단계 — 가장 높은 단계 하나만
    if      (refund > 15)                       risks.push({ score:120, tag:'환불 집중관리' });
    else if (refund > 8)                        risks.push({ score:80,  tag:'환불 관리필요' });

    // [달성률 차원] 2단계 — 가장 높은 단계 하나만
    if      (ach < 70)                          risks.push({ score:110, tag:'목표 큰 폭 미달' });
    else if (ach < 80)                          risks.push({ score:70,  tag:'목표 미달' });

    // [Capacity 기회 차원] 달성률 양호하지만 유휴 Capacity가 큰 매장
    if (ach >= 90 && loss > 100000000)          risks.push({ score:75,  tag:'Capacity 기회' });

    // [가동률 차원] 저가동 — Capacity 초과와 중복 방지
    if (util < 60 && utilRaw <= 100)            risks.push({ score:65,  tag:'저가동' });

    // 정상 매장 (리스크 없음)
    if (!risks.length) return { text:'정상', cls:'good' };

    // 점수 내림차순 정렬 후 상위 2개만 표시
    risks.sort((a,b) => b.score - a.score);
    const topTags = risks.slice(0, 2).map(r => r.tag);

    // 최상위 리스크 기준으로 cls 결정
    const topScore = risks[0].score;
    const cls = topScore >= 100 ? 'bad' : 'warn';
    return { text: topTags.join(' + '), cls };
  }

  const rows = tableStores.map(s=>{
    const ach = s.achievement||0;
    // ★ Change 4: color-coded 달성률 셀
    const achBg    = ach>=100?'var(--green-soft)':ach>=80?'var(--amber-soft)':'var(--rose-soft)';
    const achColor = ach>=100?'var(--green)':ach>=80?'var(--amber)':'var(--rose)';
    const achBold  = ach < 80 ? 'font-weight:900;' : '';
    const achDelta = momDelta(ach, s.prevAch, '%p', false);
    const achCell  = `<div class="ach-wrap" style="background:${achBg};padding:3px 6px;border-radius:6px;display:inline-block">
      <span style="color:${achColor};${achBold}">${fmtP(ach)}</span>${achDelta}
      <div class="ach-bar-bg"><div class="ach-bar-fill" style="width:${Math.min(100,ach)}%;background:${ach>=100?'#216552':ach>=80?'#c07b48':'#b24c58'}"></div></div>
    </div>`;

    // 원천 MTD Capacity 기준 가동률 + 기간 변화
    const util = s.utilization||0;
    const utilRaw = s.utilizationRaw||0;
    const utilDelta = momDelta(util, s.prevUtil, '%p', false);
    const utilCell = `${fmtP(utilRaw || util)}${utilDelta}`;

    // ★ Change 3: 환불율 MoM (낮을수록 좋음 → invert)
    const refundDelta = momDelta(s.refundRate||0, s.prevRefund, '%p', true);

    // ★ v3: 파생 상태 표시 (시트 판정 대신 실데이터 기반)
    const derivedSt = deriveStoreStatus(s);

    const selected = s.name===selName?'selected':'';
    return `<tr class="${selected}" data-store="${s.name}">
      <td>${s.name}</td>
      <td>${fmtS(s.gross)}</td>
      <td>${achCell}</td>
      <td>${fmtS(s.net)}</td>
      <td>${fmtN(s.usage)}</td>
      <td>${utilCell}</td>
      <td>${fmtP(s.refundRate||0)}${refundDelta}</td>
      <td>${(s.netAdds||0)>=0?'+':''}${fmtN(s.netAdds||0)}</td>
      <td style="white-space:nowrap">${fmtW(s.arpu||0)}</td>
      <td><span class="verdict-chip ${derivedSt.cls}" title="시트 판정: ${s.opsStatus||'—'}">${derivedSt.text}</span></td>
    </tr>`;
  }).join('');
  $('storeTableBody').innerHTML = rows;

  $('storeTableBody').querySelectorAll('tr').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const name = tr.dataset.store;
      const key = Object.keys(GID.stores).find(k=>GID.stores[k].name===name);
      if (key) {
        state.store = key;
        $('storeSelect').value = key;
        renderAll();
        syncHash();
        setTimeout(() => $('inlineStoreDetail')?.scrollIntoView({ behavior:'smooth', block:'nearest' }), 80);
      }
    });
  });
}

/* ── 18. 상세 패널 + 드릴다운 ───────────────────────────────── */
// [Change 3] renderDetail: store-aware — ent.current는 단일 매장 집계값 (getEntity() 보장)
//   isAll=true 시 포트폴리오 합산, false 시 ent.name 매장 데이터만 표시
function renderDetail(ent) {
  const c  = ent.current;
  const ms = ent.months;

  // 기본 지표 그리드
  const items = [
    { label:'실결제매출',    val:fmtS(c.gross),         sub:`실결제매출 달성 ${fmtP(c.grossAchievement||0)}` },
    { label:'순매출',    val:fmtS(c.net),            sub:c.hasDiscountData ? `실결제매출−환불 · 쿠폰할인 적용 전 추정액 대비 ${fmtP(c.discountShare||0)}${couponCoverageSuffix(c)}` : `실결제매출−환불 · ${couponUnavailableLabel(c)}` },
    { label:'MRR',      val:fmtS(c.mrr||0),         sub:`MRR YoY ${(c.mrrYoY||0)>=0?'+':''}${fmtP(c.mrrYoY||0)}` },
    { label:'순매출 달성률',   val:fmtP(c.achievement||0),  sub:`순매출 ${fmtS(c.net||0)} / 목표 ${fmtS(c.target||0)}` },
    { label:'운영 가동률', val:fmtP(c.utilization||0),  sub:(()=>{
        const capAll = buildCapacityData(ent);
        const cr = ent.isAll
          ? { idleCount: capAll.reduce((s,d)=>s+(d.idleCount||0),0) }
          : (capAll[0]||{});
        return `총사용 ${fmtN(c.usage||0)}대 · 기간 누적 유휴 Capacity ${fmtN(cr.idleCount||0)}대`;
      })() },
    { label:'이탈률',   val:fmtP(c.churn||0),        sub:`해지 ${fmtN(c.cancelSubs||0)}건` },
    (()=>{
      const dRefund   = c.refundRate||0;
      return { label:'환불율', val:fmtP(dRefund), sub:'실결제매출 기준' };
    })(),
    { label:'순증감',   val:`${(c.netAdds||0)>=0?'+':''}${fmtN(c.netAdds||0)}`, sub:`신규 ${fmtN(c.newSubs||0)} / 해지 ${fmtN(c.cancelSubs||0)}` },
    (()=>{
      const dDiscount = c.discountShare||0;
      const noData    = !c.hasDiscountData;
      const badgeText = dashboard?.dataQuality?.sourceCheckPending ? '집계 중'
                      : (c.couponSheetMonths||0) > 0 ? '집계 없음'
                      : (c.couponSourceMonths||0) > 0 ? '산출 제외' : '미배분';
      const badge     = noData  ? ` <span style="font-size:9px;background:#f0ebe3;color:#7a6a50;padding:1px 4px;border-radius:3px;font-weight:700">${badgeText}</span>`
                      : '';
      const dispVal   = noData  ? '—' : fmtP(dDiscount);
      const dispSub   = noData  ? couponUnavailableLabel(c)
                      : `쿠폰 적용 전 추정액 대비 · ${fmtS(c.discountAmount||0)}${couponCoverageSuffix(c)}`;
      return { label:`쿠폰할인율${badge}`, val:dispVal, sub:dispSub };
    })(),
    { label:'ARPU',     val:c.arpu>0?fmtS(c.arpu):'—', sub:arpuBasisLabel(c) },
    { label:'ARR',      val: (c.arr||0) > 0 ? fmtS(c.arr) : '—', sub:`ARR YoY ${c.arrYoY ? (c.arrYoY>0?'+':'')+fmtP(c.arrYoY) : '—'} (연간 반복매출)` },
    { label:'LTV(추정)', val: (c.ltv||0) > 0 ? fmtW(c.ltv) : '—', sub:`ARPU ÷ 이탈률 추정` }
  ];
  $('detailGrid').innerHTML = items.map(i=>
    `<div class="d-item">
       <div class="d-label">${i.label}</div>
       <div class="d-val">${i.val}</div>
       ${i.sub?`<div class="d-sub">${i.sub}</div>`:''}
     </div>`
  ).join('');
  $('detailTitle').textContent = ent.isAll ? '포트폴리오 합산 상세' : `${ent.name} 드릴다운`;
  $('detailSub').textContent = `${ms.length}개월 집계 기준`;

  // ── 드릴다운: 점검 포인트·추세·권장 액션 (단일 매장 선택 시) ──
  if (ent.isAll) return; // 전체 뷰는 기본 그리드만 표시

  // 트렌드 헬퍼 (최근 2개월 변화)
  const lastM = ms.length ? ms[ms.length-1] : null;
  const prevM = ms.length >= 2 ? ms[ms.length-2] : null;
  const trendChip = (current, prev, invert=false) => {
    if (!prev) return '';
    const delta = current - prev;
    const isGood = invert ? delta < 0 : delta > 0;
    const isFlat = Math.abs(delta) < 0.5;
    const cls = isFlat ? 'flat' : (isGood ? 'up' : 'dn');
    const sign = delta > 0 ? '+' : '';
    return `<span class="drilldown-trend-chip ${cls}">${sign}${delta.toFixed(1)}</span>`;
  };

  // 점검 포인트 탐지
  const issues = [];
  const ach = c.achievement || 0;
  const churn = c.churn || 0;
  const util = c.utilization || 0;
  const refund = c.refundRate || 0;
  const netAdds = c.netAdds || 0;
  const capRow = buildCapacityData(ent)[0] || {};

  if (ach < 80)     issues.push({ sev:'critical', text:`순매출 달성률 부진 (${fmtP(ach)}) — 현재 순매출 ${fmtS(c.net)} vs 목표 ${fmtS(c.target||0)}` });
  else if (ach < 95) issues.push({ sev:'warning',  text:`순매출 달성률 ${fmtP(ach)} — 목표까지 ${fmtS(Math.max(0,(c.target||0)-(c.net||0)))} 남음` });

  // 이탈 임계값: 15%+ 심각 / 10~15% 위험 / 6~10% 주의
  if (churn > 15)     issues.push({ sev:'critical', text:`이탈률 심각 ${fmtP(churn)} — 해지 ${fmtN(c.cancelSubs||0)}건, 긴급 대응 필요` });
  else if (churn > 10) issues.push({ sev:'critical', text:`이탈률 ${fmtP(churn)} — 해지 ${fmtN(c.cancelSubs||0)}건, 즉각 점검 필요` });
  else if (churn > 6)  issues.push({ sev:'warning',  text:`이탈률 ${fmtP(churn)} — 유지 ${fmtN(c.retained||0)}명 중 이탈 경계 수준` });

  if (util < 50)    issues.push({ sev:'critical', text:`가동률 저조 (${fmtP(util)}) — 유휴 Capacity ${fmtN(capRow.idleCount||0)}대, 기회금액 상한 ${fmtS(capRow.lossEstimate||0)}` });
  else if (util < 65) issues.push({ sev:'warning', text:`가동률 ${fmtP(util)} — 개선 여지 있음, 유휴 Capacity ${fmtN(capRow.idleCount||0)}대` });

  if (refund > 15)  issues.push({ sev:'critical', text:`환불율 ${fmtP(refund)} — 서비스 품질 이슈 또는 CS 불만 다수 예상` });
  else if (refund > 8) issues.push({ sev:'warning', text:`환불율 ${fmtP(refund)} — 클레임 원인 점검 권장` });

  if (netAdds < -5) issues.push({ sev:'critical', text:`순감 ${netAdds}건 — 신규 ${fmtN(c.newSubs||0)} < 해지 ${fmtN(c.cancelSubs||0)}` });
  else if (netAdds < 0) issues.push({ sev:'warning', text:`구독 순감 (${netAdds}건) — 해지 방어 필요` });

  if (!issues.length) issues.push({ sev:'ok', text:'식별된 주요 특이사항 없음 — 현재 정상 운영 중' });

  // 최근 추세 (월별 변화)
  const trends = [];
  if (lastM && prevM) {
    const momGross = prevM.gross > 0 ? (lastM.gross - prevM.gross) / prevM.gross * 100 : 0;
    const momUtil  = lastM.utilization - prevM.utilization;
    const momChurn = lastM.churn - prevM.churn;
    trends.push({ label:'실결제매출 MoM',  val:`${momGross>=0?'+':''}${momGross.toFixed(1)}%`, good: momGross >= 0 });
    trends.push({ label:'가동률 변화', val:`${momUtil>=0?'+':''}${momUtil.toFixed(1)}%p`, good: momUtil >= 0 });
    trends.push({ label:'이탈률 변화', val:`${momChurn>=0?'+':''}${momChurn.toFixed(1)}%p`, good: momChurn <= 0, invert:true });
    trends.push({ label:'순증감 변화', val:`${(lastM.netAdds||0)>=0?'+':''}${lastM.netAdds||0}건`, good: (lastM.netAdds||0) >= 0 });
  }

  // 권장 액션
  const recActions = [];
  if (churn > 6)   recActions.push('구독 만료 전 리텐션 메시지 발송 (할인 쿠폰·혜택 강조)');
  if (util < 65)   recActions.push('미가동 시간대 특가 프로모션 또는 기업 제휴 세차 패키지 도입 검토');
  if (ach < 90)    recActions.push('순매출 달성률 개선: 월 중순 집중 마케팅 캠페인 및 신규 채널 테스트');
  if (refund > 8)  recActions.push('환불 클레임 항목별 분류 후 서비스 프로세스 개선 적용');
  if (netAdds < 0) recActions.push('신규 유입 채널 강화: 지역 SNS 광고·아파트 단지 제휴 확대');
  if (!recActions.length) recActions.push('현재 지표 유지: 이탈률·가동률 주간 모니터링 지속');

  // HTML 조합
  const drilldownHtml = `<div class="drilldown-panel" style="margin-top:14px">
    <div class="drilldown-section">
      <div class="drilldown-section-title">⚠ 점검 포인트</div>
      ${issues.map(i => `
        <div class="drilldown-issue">
          <span class="drilldown-dot" style="background:${i.sev==='critical'?'#b24c58':i.sev==='warning'?'#c07b48':'#216552'}"></span>
          <span>${i.text}</span>
        </div>`).join('')}
    </div>
    ${trends.length ? `
    <div class="drilldown-section">
      <div class="drilldown-section-title">📈 최근 트렌드 (전월 대비)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${trends.map(t => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg);border-radius:var(--r-sm)">
            <span style="font-size:11px;color:var(--muted)">${t.label}</span>
            <span style="font-size:13px;font-weight:800;color:${t.invert?(t.good?'#216652':'#b24c58'):(t.good?'#216652':'#b24c58')}">${t.val}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}
    <div class="drilldown-section">
      <div class="drilldown-section-title">✅ 권장 액션</div>
      ${recActions.map((a,i) => `
        <div class="drilldown-action">
          <span class="drilldown-num">${i+1}</span>
          <span>${a}</span>
        </div>`).join('')}
    </div>
  </div>`;

  // 기존 드릴다운 패널 제거 후 새로 삽입 (중복 방지)
  const existing = document.getElementById('detailDrilldown');
  if (existing) existing.remove();
  const wrapper = document.createElement('div');
  wrapper.id = 'detailDrilldown';
  wrapper.innerHTML = drilldownHtml;
  $('detailGrid').insertAdjacentElement('afterend', wrapper);
}

/* ── 18-B. Action Command Center ────────────────────────────── */
function renderActionCenter(ent) {
  const c = ent.current;

  // ① 오늘 조치할 항목 ───────────────────────────────────────
  const actions = [];

  const ach = c.achievement || 0;
  // ★ v3: actions에 DRI · deadline · KPI · 완료조건 추가
  const today      = new Date();
  const monthEnd   = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
  const daysLeft   = monthEnd - today.getDate();
  const fmt2d = (d) => {
    const y = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0'), dy = String(d.getDate()).padStart(2,'0');
    return `${y}-${mo}-${dy}`;
  };
  const d3   = new Date(today); d3.setDate(today.getDate()+3);
  const dWk  = new Date(today); dWk.setDate(today.getDate()+7);
  const dEOM = new Date(today.getFullYear(), today.getMonth()+1, 0);
  const deadlineEOM = `${fmt2d(dEOM)} (D-${daysLeft})`;
  const deadline3d  = fmt2d(d3);
  const deadlineWk  = fmt2d(dWk);

  if (ach < 70)       actions.push({ level:'critical', text:`순매출 달성률 ${fmtP(ach)} — 매출 채널별 원인 분석 즉시 필요`,
    dri:'마케팅팀', deadline:deadline3d,
    kpi:`순매출 달성률 80% 이상`,
    confirm:`3일 내 순매출 달성률 5%p 이상 반등 확인` });
  else if (ach < 90)  actions.push({ level:'warning',  text:`순매출 달성률 ${fmtP(ach)} — 월말까지 ${fmtS(Math.max(0,(c.target||0)-(c.net||0)))} 추가 달성 필요`,
    dri:'마케팅팀', deadline:deadlineEOM,
    kpi:`순매출 달성률 90% 이상`,
    confirm:`7일 내 주간 매출 전주 대비 10% 이상 증가` });

  const churn = c.churn || 0;
  // 이탈 임계값: 15%+ 심각 / 10~15% 위험 / 6~10% 주의 — deriveStoreStatus와 동일 기준
  if (churn > 15)     actions.push({ level:'critical', text:`이탈률 ${fmtP(churn)} — 해지 방어 캠페인 즉각 실행`,
    dri:'사업운영팀', deadline:deadline3d,
    kpi:'이탈률 15% 이하',
    confirm:`7일 내 재결제 전환율 8% 이상 또는 해지 사유 태깅 완료 80건 이상` });
  else if (churn > 10) actions.push({ level:'critical', text:`이탈률 ${fmtP(churn)} — 리텐션 캠페인 긴급 집행`,
    dri:'사업운영팀', deadline:deadlineWk,
    kpi:'이탈률 10% 이하',
    confirm:`7일 내 이탈률 1%p 이상 개선 또는 리텐션 캠페인 전환율 8% 이상` });
  else if (churn > 6) actions.push({ level:'warning',  text:`이탈률 ${fmtP(churn)} — 구독 혜택 재검토 및 모니터링`,
    dri:'사업운영팀', deadline:deadlineWk,
    kpi:'이탈률 6% 이하',
    confirm:`주간 이탈률 추이 안정화 확인 또는 리텐션 메시지 발송 완료` });

  const util = c.utilization || 0;
  if (util < 45)      actions.push({ level:'critical', text:`가동률 ${fmtP(util)} — 미가동 설비 점검 및 프로모션 계획 수립`,
    dri:'사업운영팀', deadline:deadline3d,
    kpi:'가동률 60% 이상',
    confirm:`3일 내 일별 세차 대수 목표 대비 80% 이상 달성` });
  else if (util < 62) actions.push({ level:'warning',  text:`가동률 ${fmtP(util)} — 운영 효율화 방안 검토`,
    dri:'사업운영팀', deadline:deadlineWk,
    kpi:'가동률 65% 이상',
    confirm:`7일 내 주간 세차 대수 전주 대비 5% 이상 증가` });

  const refund = c.refundRate || 0;
  if (refund > 15)    actions.push({ level:'critical', text:`환불율 ${fmtP(refund)} — CS 팀 즉각 점검, 클레임 원인 파악`,
    dri:'사업운영팀', deadline:deadline3d,
    kpi:'환불율 10% 이하',
    confirm:`3일 내 환불 요청 일평균 건수 전주 대비 30% 이상 감소` });
  else if (refund > 8) actions.push({ level:'warning', text:`환불율 ${fmtP(refund)} — 서비스 품질 이슈 확인 필요`,
    dri:'사업운영팀', deadline:deadlineWk,
    kpi:'환불율 8% 이하',
    confirm:`7일 내 환불율 1%p 이상 개선 (서비스 개선 조치 후 수치 확인)` });

  if ((c.netAdds||0) < -10) actions.push({ level:'critical', text:`순구독 ${c.netAdds||0}건 — 신규 유입 채널 긴급 강화`,
    dri:'마케팅팀', deadline:deadline3d,
    kpi:'순증감 0건 이상',
    confirm:`3일 내 신규 가입 전환율 5% 이상 또는 일 신규가입 목표 달성` });
  else if ((c.netAdds||0) < 0) actions.push({ level:'warning', text:`순구독 감소 (${c.netAdds||0}건) — 신규 유입 채널 검토`,
    dri:'마케팅팀', deadline:deadlineWk,
    kpi:'순증감 0건 이상',
    confirm:`7일 내 신규가입 전환율 8% 이상 도달` });

  // Capacity 기회금액 상한 기반 액션
  const capData   = buildCapacityData(ent);
  const totalLoss = capData.reduce((s,d) => s + ((d.confirmedLoss||0)+(d.mtdLoss||0)), 0);
  if (totalLoss > 100000000)  actions.push({ level:'critical', text:`Capacity 기회금액 상한 ${fmtS(totalLoss)} — 수요 검증 후 가동률 제고 계획 수립`,
    dri:'사업운영팀', deadline:deadlineWk,
    kpi:'가동률 65% 이상 달성으로 유휴 Capacity 50% 이상 감소',
    confirm:`14일 내 주간 가동률 5%p 이상 반등 수치 확인` });
  else if (totalLoss > 30000000) actions.push({ level:'warning', text:`Capacity 기회금액 상한 ${fmtS(totalLoss)} — 수요 검증 및 유휴 Capacity 최소화 방안 검토`,
    dri:'사업운영팀', deadline:deadlineWk,
    kpi:'유휴 Capacity 10% 감소',
    confirm:`7일 내 유휴 Capacity 전주 대비 10% 이상 감소 또는 프로모션 전환율 5% 이상` });

  if (!actions.length) actions.push({ level:'ok', text:'현재 즉각 조치가 필요한 항목 없음 — 정상 운영 중' });

  const actionCount = actions.filter(a => a.level !== 'ok').length;
  $('acActionCount').textContent = actionCount || '0';
  $('acActionList').innerHTML = actions.map(a => {
    const hasDetail = a.dri && a.level !== 'ok';
    return `<div class="ac-item">
      <span class="ac-item-dot ${a.level}"></span>
      <div style="flex:1;min-width:0">
        <span>${a.text}</span>
        ${hasDetail ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px">
          <span style="font-size:10px;color:var(--muted)">👤 DRI: <strong style="color:var(--text-2)">${a.dri}</strong></span>
          <span style="font-size:10px;color:var(--muted)">📅 기한: <strong style="color:${a.level==='critical'?'var(--rose)':'var(--amber)'}">${a.deadline}</strong></span>
          <span style="font-size:10px;color:var(--muted)">📊 KPI: <strong style="color:var(--text-2)">${a.kpi}</strong></span>
          <span style="font-size:10px;color:var(--muted)">✅ 완료: ${a.confirm}</span>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  // ② 우선 점검 매장 / 매장 현황 ────────────────────────────────
  // 전체 뷰: 우선 점검 3곳 | 단일 매장: 해당 매장 이슈 집중 표시
  const dangerTitleEl = document.querySelector('.ac-danger .ac-title');
  if (!ent.isAll) {
    // ── 단일 매장: 해당 매장 이슈 표시 ──
    if (dangerTitleEl) dangerTitleEl.textContent = `${ent.name} 운영 현황`;
    const score  = computeScore(c);
    const sIssues = [];
    if ((c.achievement||0) < 80)  sIssues.push(`순매출 달성률 ${fmtP(c.achievement||0)}`);
    if ((c.churn||0)       > 8)   sIssues.push(`이탈 ${fmtP(c.churn||0)}`);
    if ((c.utilization||0) < 60)  sIssues.push(`가동 ${fmtP(c.utilization||0)}`);
    if ((c.refundRate||0)  > 10)  sIssues.push(`환불 ${fmtP(c.refundRate||0)}`);
    if ((c.netAdds||0)     < 0)   sIssues.push(`순증감 ${c.netAdds||0}건`);
    // ★ 경계 수준 경고 (임계값 미달이지만 모니터링 필요)
    const sWarnings = [];
    if ((c.churn||0) > 6  && (c.churn||0)     <= 8)  sWarnings.push(`이탈 경계 ${fmtP(c.churn||0)}`);
    if ((c.refundRate||0) > 5 && (c.refundRate||0) <= 10) sWarnings.push(`환불 경계 ${fmtP(c.refundRate||0)}`);
    if ((c.achievement||0) >= 80 && (c.achievement||0) < 90) sWarnings.push(`순매출 달성률 ${fmtP(c.achievement||0)} 점검`);
    // ★ 이슈 없음 vs 경계 vs 정상에 따른 맥락 문구
    const issueText = sIssues.length
      ? sIssues.join(' · ')
      : sWarnings.length
        ? `주요 위험 없음 — ${sWarnings.join(' · ')} 모니터링 권장`
        : '정상 운영 중';
    const scoreColor = score >= 75 ? '#216552' : score >= 60 ? '#c07b48' : '#b24c58';
    $('acDangerCount').textContent = sIssues.length || '✓';
    $('acDangerList').innerHTML = `
      <div class="ac-danger-store">
        <span class="ac-danger-rank" style="font-size:14px">📍</span>
        <div style="flex:1;min-width:0">
          <div class="ac-danger-name">${ent.name}</div>
          <div class="ac-danger-issues">${issueText}</div>
        </div>
        <span class="ac-danger-score" style="color:${scoreColor}">${score}점</span>
      </div>`;
  } else {
    // ── 전체 뷰: 우선 점검 3곳 (★ v3: 오픈 전 매장 제외) ──
    if (dangerTitleEl) dangerTitleEl.textContent = '우선 점검 매장 3곳';
    const activeStoresForRank = getActiveStores();
    const storeScores = activeStoresForRank.map(s => {
      const filtMs = filterMonths(s.months);
      const agg    = aggMonths(filtMs) || {};
      const score = computeScore(agg);
      const issues = [];
      if ((agg.achievement||0) < 80)  issues.push(`순매출 달성률 ${fmtP(agg.achievement||0)}`);
      if ((agg.churn||0)       > 8)   issues.push(`이탈 ${fmtP(agg.churn||0)}`);
      if ((agg.utilization||0) < 60)  issues.push(`가동 ${fmtP(agg.utilization||0)}`);
      if ((agg.refundRate||0)  > 10)  issues.push(`환불 ${fmtP(agg.refundRate||0)}`);
      if (!issues.length && score < 65) issues.push('복합 지표 저조');

      // ★ Priority 7: 1차 원인 + 우선 액션 도출 (deriveStoreStatus와 동일 차원 우선순위)
      const ach     = agg.achievement  || 0;
      const util    = agg.utilization  || 0;
      const capMetric = buildCapacityData({ name:s.name, isAll:false, months:filtMs })[0] || {};
      const utilRaw = capMetric.capacity > 0 ? capMetric.utilization : util;
      const churn   = agg.churn        || 0;
      const refund  = agg.refundRate   || 0;
      let rootCause = '', priorityAction = '', dri = '';

      // 각 차원에서 가장 심각한 단계 하나씩만, 복합 표시 시 최대 2가지
      const rc = [];
      if (utilRaw > 100 || util > 100)    rc.push({ score:150, cause:`Capacity 초과(${fmtP(utilRaw||util)})`, action:'원천 Capacity 재검토 · 예약 제한 운영', dri_:'Field Ops 담당' });
      // 이탈 구간: 15%+ 심각 / 10~15% 위험 / 6~10% 주의 — deriveStoreStatus와 동일 기준
      if      (churn > 15)                rc.push({ score:130, cause:`이탈 집중관리(${fmtP(churn)})`, action:'CS 이슈 긴급 점검 · 해지 사유 분류', dri_:'BizOps 리텐션 담당' });
      else if (churn > 10)                rc.push({ score:90,  cause:`이탈 관리필요(${fmtP(churn)})`, action:'리텐션 캠페인 집행 · 해지 사유 수집', dri_:'BizOps 리텐션 담당' });
      else if (churn > 6)                 rc.push({ score:50,  cause:`이탈 주의(${fmtP(churn)})`, action:'해지 고객 설문 집계', dri_:'BizOps 리텐션 담당' });
      if (refund > 15)                    rc.push({ score:120, cause:`환불 집중관리(${fmtP(refund)})`, action:'CS 티켓 유형별 분류 · 환불 방어 프로세스 점검', dri_:'CS 담당' });
      else if (refund > 8)                rc.push({ score:80,  cause:`환불 관리필요(${fmtP(refund)})`, action:'환불 사유 태깅 · 서비스 품질 점검', dri_:'CS 담당' });
      if (ach < 70)                       rc.push({ score:110, cause:`목표 큰 폭 미달(순매출 달성률 ${fmtP(ach)})`, action:'가격·프로모션 긴급 검토', dri_:'BizOps 영업 담당' });
      else if (ach < 80)                  rc.push({ score:70,  cause:`목표 미달(순매출 달성률 ${fmtP(ach)})`, action:'채널별 전환율 분석', dri_:'BizOps 영업 담당' });
      if (util < 60 && utilRaw <= 100)    rc.push({ score:65,  cause:`저가동(${fmtP(util)})`, action:'예약 채널 점검 · 피크 마케팅 집행', dri_:'Field Ops 담당' });

      if (rc.length) {
        rc.sort((a,b) => b.score - a.score);
        const top2 = rc.slice(0, 2);
        rootCause = top2.map(r => r.cause).join(' + ');
        priorityAction = top2[0].action;
        dri = top2[0].dri_;
      } else {
        rootCause = '복합 지표 저조';
        priorityAction = '주간 현장 점검 실시';
        dri = 'BizOps 리텐션 담당';
      }
      return { name: s.name, score, issues, rootCause, priorityAction, dri };
    }).sort((a,b) => a.score - b.score).slice(0, 3);

    // ★ v3: 오픈 예정 매장 안내 카드 추가
    const openingStores = getOpeningOpsStores();
    const openingHtml = openingStores.length > 0 ? openingStores.map(s => `
      <div class="ac-danger-store" style="border:1px dashed rgba(29,122,138,.35);background:rgba(29,122,138,.04);border-radius:6px;margin-bottom:4px">
        <span class="ac-danger-rank" style="font-size:11px;color:var(--teal)">NEW</span>
        <div style="flex:1;min-width:0">
          <div class="ac-danger-name" style="color:var(--teal)">${s.name}</div>
          <div class="ac-danger-issues" style="color:var(--teal)">런칭 준비 중 — 오픈 후 KPI 집계 시작</div>
        </div>
        <span class="ac-danger-score" style="color:var(--teal);font-size:11px">${STORE_OPEN_DATES[s.name] || '오픈 예정'}</span>
      </div>`).join('') : '';

    $('acDangerCount').textContent = storeScores.length;
    $('acDangerList').innerHTML = storeScores.map((s, i) => {
      const scoreColor = s.score >= 65 ? '#c07b48' : '#b24c58';
      return `<div class="ac-danger-store" style="flex-direction:column;align-items:stretch;gap:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <span class="ac-danger-rank">${i+1}</span>
          <div style="flex:1;min-width:0">
            <div class="ac-danger-name">${s.name}</div>
            <div class="ac-danger-issues">${s.issues.length ? s.issues.join(' · ') : '집계 중'}</div>
          </div>
          <span class="ac-danger-score" style="color:${scoreColor}">${s.score}점</span>
        </div>
        <div style="font-size:10.5px;background:rgba(178,76,88,.06);border-radius:5px;padding:5px 8px;line-height:1.55;margin-left:2px">
          <span style="color:#9e8c7e;font-weight:600">1차 원인 </span><span style="color:var(--text)">${s.rootCause}</span><br>
          <span style="color:#9e8c7e;font-weight:600">우선 액션 </span><span style="color:var(--text)">${s.priorityAction}</span><br>
          <span style="color:#9e8c7e;font-weight:600">DRI </span><span style="color:var(--accent)">${s.dri}</span>
        </div>
      </div>`;
    }).join('') + openingHtml;
  }

  // ③ Capacity 기회금액 상한 ──────────────────────────────────
  // 전체 뷰: 포트폴리오 합산 | 단일 매장: 해당 매장 기준
  const lossTitleEl = document.querySelector('.ac-loss .ac-title');
  const capForLoss = ent.isAll
    ? buildCapacityData({ isAll: true, months: [] })
    : buildCapacityData(ent);
  const totalLossAll  = capForLoss.reduce((s,d) => s+(d.lossEstimate||0), 0);
  const totalIdleAll  = capForLoss.reduce((s,d) => s+(d.idleCount||0),    0);
  const sorted = [...capForLoss].sort((a,b) => b.lossEstimate - a.lossEstimate);
  if (lossTitleEl) lossTitleEl.textContent = ent.isAll ? '누적 기회금액 상한' : `${ent.name} 누적 기회금액 상한`;

  // ★ v3: 손실 기준 명확화 — 확정월 합산 + 당월 MTD 합산 구분
  const totConfLoss_ = capForLoss.reduce((s,d)=>s+(d.confirmedLoss||0),0);
  const totMtdLoss_  = capForLoss.reduce((s,d)=>s+(d.mtdLoss||0),0);
  const totProjLoss_ = capForLoss.reduce((s,d)=>s+(d.projLoss||0),0);
  const totConfIdle_ = capForLoss.reduce((s,d)=>s+(d.confirmedIdle||0),0);
  const totMtdIdle_  = capForLoss.reduce((s,d)=>s+(d.mtdIdle||0),0);
  const hasMTD_      = capForLoss.some(d=>d.hasMTD);

  // 표시할 기본 손실값 선택: MTD 있으면 누적(확정)+MTD, 없으면 확정만
  const displayLoss  = hasMTD_ ? totConfLoss_ + totMtdLoss_ : totalLossAll;
  const displayIdle  = hasMTD_ ? totConfIdle_ + totMtdIdle_ : totalIdleAll;
  const displayBasis = hasMTD_
    ? `확정 ${fmtS(totConfLoss_)} + MTD ${fmtS(totMtdLoss_)}`
    : '확정 기간 합산';
  const weightedPrice = displayIdle > 0 ? displayLoss / displayIdle : 0;

  $('acLossBody').innerHTML = `
    <div class="ac-loss-total">${fmtS(displayLoss)}</div>
    <div class="ac-loss-sub">${ent.isAll ? '운영 매장 합산 · ' : ''}유휴 Capacity ${fmtN(displayIdle)}대 · 가중 평균 단가 ${fmtN(weightedPrice)}원/대</div>
    <div style="font-size:10.5px;color:var(--muted);margin:3px 0 8px;line-height:1.5">
      ${hasMTD_
        ? `<span style="background:rgba(36,51,80,.08);border-radius:3px;padding:1px 5px">확정월 누적</span> ${fmtS(totConfLoss_)} · <span style="background:rgba(192,123,72,.1);border-radius:3px;padding:1px 5px">MTD (${getMtdDay()}일)</span> ${fmtS(totMtdLoss_)}`
        : '확정월 누적 합산'}
      ${hasMTD_&&totProjLoss_>0?`<br><span style="background:rgba(178,76,88,.08);border-radius:3px;padding:1px 5px">월말 예상</span> ${fmtS(totProjLoss_)} <span style="color:rgba(178,76,88,.6)">(추세 기준 참고용)</span>`:''}
    </div>
    <div class="ac-loss-breakdown">
      ${sorted.filter(d => (d.confirmedLoss||0) + (d.mtdLoss||0) > 0).map(d => {
        const storeLoss = (d.confirmedLoss||0) + (d.mtdLoss||0);
        const pct = displayLoss > 0 ? (storeLoss / displayLoss * 100).toFixed(0) : 0;
        const lossColor = storeLoss > 50000000 ? '#b24c58' : '#c07b48';
        const basisLabel = d.hasMTD
          ? `확정 ${fmtS(d.confirmedLoss||0)} + MTD ${fmtS(d.mtdLoss||0)}`
          : `확정 ${fmtS(d.confirmedLoss||0)}`;
        return `<div class="ac-loss-row">
          <span style="color:#74695d">${d.name}</span>
          <div style="text-align:right">
            <div style="color:${lossColor};font-weight:700">${fmtS(storeLoss)}</div>
            <div style="font-size:9.5px;color:var(--muted)">${basisLabel}</div>
          </div>
        </div>
        <div class="ac-loss-bar-wrap">
          <div class="ac-loss-bar" style="width:${pct}%;background:${lossColor}88"></div>
        </div>`;
      }).join('')}
    </div>`;
}

/* ── 18-C. 인라인 매장 드릴다운 (히트맵·랭킹·테이블 클릭 직후 노출) ── */
function renderInlineStoreDetail(ent) {
  const el = $('inlineStoreDetail');
  if (!el) return;

  // 전체 뷰이면 패널 숨김
  if (ent.isAll) { el.style.display = 'none'; return; }

  const c  = ent.current;
  const ms = ent.months;

  // 트렌드 헬퍼
  const lastM = ms.length ? ms[ms.length-1] : null;
  const prevM = ms.length >= 2 ? ms[ms.length-2] : null;

  // 점검 포인트
  const issues = [];
  const ach    = c.achievement || 0;
  const churn  = c.churn       || 0;
  const util   = c.utilization || 0;
  const refund = c.refundRate  || 0;
  const netAdds= c.netAdds     || 0;
  const capRow = buildCapacityData(ent)[0] || {};

  if (ach < 80)     issues.push({ sev:'critical', text:`순매출 달성률 부진 (${fmtP(ach)}) — 목표 대비 ${fmtS(Math.max(0,(c.target||0)-(c.net||0)))} 미달` });
  else if (ach < 95) issues.push({ sev:'warning',  text:`순매출 달성률 ${fmtP(ach)} — 목표까지 ${fmtS(Math.max(0,(c.target||0)-(c.net||0)))} 남음` });
  if      (churn > 15) issues.push({ sev:'critical', text:`이탈률 심각 ${fmtP(churn)} — 해지 ${fmtN(c.cancelSubs||0)}건 긴급 대응` });
  else if (churn > 10) issues.push({ sev:'critical', text:`이탈률 ${fmtP(churn)} — 해지 ${fmtN(c.cancelSubs||0)}건 즉각 점검` });
  else if (churn > 6) issues.push({ sev:'warning', text:`이탈률 ${fmtP(churn)} — 유지 구독자 이탈 경계` });
  if (util < 50)    issues.push({ sev:'critical', text:`가동률 저조 (${fmtP(util)}) — 유휴 Capacity ${fmtN(capRow.idleCount||0)}대 · 기회금액 상한 ${fmtS(capRow.lossEstimate||0)}` });
  else if (util < 65) issues.push({ sev:'warning', text:`가동률 ${fmtP(util)} — 유휴 Capacity ${fmtN(capRow.idleCount||0)}대 개선 여지` });
  if (refund > 15)  issues.push({ sev:'critical', text:`환불율 ${fmtP(refund)} — CS 이슈 즉각 점검` });
  else if (refund > 8) issues.push({ sev:'warning', text:`환불율 ${fmtP(refund)} — 클레임 원인 점검 권장` });
  if (netAdds < -5) issues.push({ sev:'critical', text:`순구독 감소 ${netAdds}건 — 신규 채널 긴급 강화` });
  else if (netAdds < 0) issues.push({ sev:'warning', text:`구독 순감 (${netAdds}건) — 해지 방어 필요` });
  if (!issues.length) issues.push({ sev:'ok', text:'현재 주요 특이사항 없음 — 정상 운영 중' });

  // 최근 트렌드
  const trends = [];
  if (lastM && prevM) {
    const momGross = prevM.gross > 0 ? (lastM.gross - prevM.gross) / prevM.gross * 100 : 0;
    const momUtil  = (lastM.utilization||0) - (prevM.utilization||0);
    const momChurn = (lastM.churn||0) - (prevM.churn||0);
    const momNetA  = (lastM.netAdds||0) - (prevM.netAdds||0);
    trends.push({ label:'실결제매출 MoM',  val:`${momGross>=0?'+':''}${momGross.toFixed(1)}%`,  good:momGross>=0 });
    trends.push({ label:'가동률 변화', val:`${momUtil>=0?'+':''}${momUtil.toFixed(1)}%p`,   good:momUtil>=0 });
    trends.push({ label:'이탈률 변화', val:`${momChurn>=0?'+':''}${momChurn.toFixed(1)}%p`, good:momChurn<=0 });
    trends.push({ label:'순증감 변화', val:`${momNetA>=0?'+':''}${momNetA}건`,              good:momNetA>=0 });
  }

  // 권장 액션
  const recs = [];
  if (churn > 6)   recs.push('구독 만료 전 리텐션 메시지 발송 (할인 쿠폰·혜택 강조)');
  if (util < 65)   recs.push('미가동 시간대 특가 프로모션 또는 기업 제휴 세차 패키지 검토');
  if (ach < 90)    recs.push('순매출 달성률 개선: 월 중순 집중 마케팅 캠페인 및 신규 채널 테스트');
  if (refund > 8)  recs.push('환불 클레임 항목별 분류 후 서비스 프로세스 개선 적용');
  if (netAdds < 0) recs.push('신규 유입 채널 강화: 지역 SNS 광고·아파트 단지 제휴 확대');
  if (!recs.length) recs.push('현재 지표 유지: 이탈률·가동률 주간 모니터링 지속');

  const score = computeScore(c);
  const scoreColor = score >= 75 ? '#216552' : score >= 55 ? '#c07b48' : '#b24c58';

  el.style.display = '';
  el.innerHTML = `
    <div class="inline-detail-header">
      <span class="score-badge" style="background:${scoreColor};color:#fff;padding:3px 12px;border-radius:99px;font-size:12px;font-weight:800">${score}점</span>
      <strong style="font-size:15px;color:var(--text)">${ent.name} 드릴다운</strong>
      <span style="font-size:11.5px;color:var(--muted)">${ms.length}개월 집계 · ${ms.length?ms[0].month:''} ~ ${ms.length?ms[ms.length-1].month:''}</span>
      <button class="inline-detail-close" id="inlineDetailClose">✕ 닫기</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
      ${[
        {l:'실결제매출',      v:fmtS(c.gross),        s:`실결제매출 달성 ${fmtP(c.grossAchievement||0)}`},
        {l:'순매출 달성률',      v:fmtP(ach),             s:`순매출 ${fmtS(c.net||0)} / 목표 ${fmtS(c.target||0)}`},
        {l:'운영 가동률', v:fmtP(util),            s:`기간 누적 유휴 Capacity ${fmtN(capRow.idleCount||0)}대`},
        {l:'이탈률',      v:fmtP(churn),           s:`해지 ${fmtN(c.cancelSubs||0)}건`},
        {l:'순증감',   v:`${netAdds>=0?'+':''}${fmtN(netAdds)}`, s:`신규 ${fmtN(c.newSubs||0)} / 해지 ${fmtN(c.cancelSubs||0)}`},
      ].map(i=>`
        <div class="d-item">
          <div class="d-label">${i.l}</div>
          <div class="d-val">${i.v}</div>
          <div class="d-sub">${i.s}</div>
        </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
      ${[
        {l:'MRR',         v:fmtS(c.mrr||0),      s:`MRR YoY ${(c.mrrYoY||0)>=0?'+':''}${fmtP(c.mrrYoY||0)}`},
        {l:'ARPU',        v:(c.arpu||0)>0?fmtS(c.arpu):'—', s:arpuBasisLabel(c)},
        {l:'ARR',         v:(c.arr||0)>0?fmtS(c.arr):'—', s:`ARR YoY ${c.arrYoY?(c.arrYoY>0?'+':'')+fmtP(c.arrYoY):'—'}`},
        {l:'LTV(추정)',    v:(c.ltv||0)>0?fmtW(c.ltv):'—', s:`ARPU ÷ 이탈률 추정`},
      ].map(i=>`
        <div class="d-item">
          <div class="d-label">${i.l}</div>
          <div class="d-val">${i.v}</div>
          <div class="d-sub">${i.s}</div>
        </div>`).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div>
        <div class="drilldown-section-title" style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">⚠ 점검 포인트</div>
        ${issues.map(i=>`
          <div class="drilldown-issue">
            <span class="drilldown-dot" style="background:${i.sev==='critical'?'#b24c58':i.sev==='warning'?'#c07b48':'#216552'}"></span>
            <span style="font-size:12px">${i.text}</span>
          </div>`).join('')}
      </div>
      ${trends.length ? `
      <div>
        <div class="drilldown-section-title" style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">📈 전월 대비</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
          ${trends.map(t=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 9px;background:var(--bg);border-radius:var(--r-sm)">
              <span style="font-size:11px;color:var(--muted)">${t.label}</span>
              <span style="font-size:12.5px;font-weight:800;color:${t.good?'#216552':'#b24c58'}">${t.val}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
      <div>
        <div class="drilldown-section-title" style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:7px">✅ 권장 액션</div>
        ${recs.map((a,i)=>`
          <div class="drilldown-action">
            <span class="drilldown-num">${i+1}</span>
            <span style="font-size:12px">${a}</span>
          </div>`).join('')}
      </div>
    </div>`;

  // 닫기 버튼
  document.getElementById('inlineDetailClose')?.addEventListener('click', () => {
    el.style.display = 'none';
    // 전체 뷰로 돌아가지 않고 패널만 접음 (매장 선택 상태는 유지)
  });
}

/* ── 19. 전체 렌더 ──────────────────────────────────────────── */
function renderAll() {
  if (!dashboard) return;
  const ent = getEntity();
  if (!ent) return;

  renderHeroKpis(ent);
  renderAlerts(ent);
  renderActionCenter(ent);   // ★ 액션 커맨드 센터 — 상단 우선 노출
  renderGauges(ent);
  // renderKpis(ent);  // ★ [Change 2] KPI 카드 레이어 비활성화 — 게이지에 필수 정보 통합됨
  renderSignals(ent);
  renderInsights(ent);
  renderPerformanceChart(ent);
  renderScoreChart(ent);
  renderSubscriptionChart(ent);
  renderOpsUtilChart(ent);
  renderOpsUtilStats(ent);
  renderOpsChurnChart(ent);
  renderOpsChurnStats(ent);
  renderOpsArpuChart(ent);
  renderOpsArpuStats(ent);
  renderMrrTrendChart(ent);
  renderBridgeChart(ent);
  renderBenchmarkChart(ent);
  renderHealthChart(ent);
  renderQuarterChart(ent);
  renderScatterChart(ent);
  renderMomentumChart(ent);
  renderMixChart(ent);
  renderSubscriptionPipeline(ent);
  renderChurnClassification(ent);
  renderCapacityPanel(ent);
  renderSeasonChart(ent);
  renderPaymentPanel(ent);
  renderHeatmap(ent);
  renderTable(ent);
  renderDetail(ent);
  renderInlineStoreDetail(ent);   // ★ 히트맵·랭킹·테이블 클릭 직후 노출 드릴다운
}

/* ── 20. 이벤트 바인딩 ──────────────────────────────────────── */
function bindEvents() {
  // 분기 토글 (HTML: data-q="Q1" 속성 사용)
  $('quarterToggle').querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.quarter = btn.dataset.q || btn.dataset.quarter;
      syncPeriodToggleActive();
      renderAll();
      syncHash();
    });
  });
  syncPeriodToggleActive();

  // 매장 선택
  $('storeSelect').addEventListener('change', e=>{
    state.store = e.target.value;
    renderAll();
    syncHash();
  });

  // 새로고침
  $('refreshBtn').addEventListener('click', ()=>{ init(true); });

  // 5분 자동 새로고침
  setInterval(()=>{ init(false); }, 5*60*1000);

  // ── 접기/펼치기 토글 (collapse-toggle 버튼) ────────────────────
  document.addEventListener('click', e => {
    const btn = e.target.closest('.collapse-toggle');
    if (!btn) return;
    const targetId = btn.dataset.target;
    const content  = $(targetId);
    if (!content) return;
    const isCollapsed = content.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', isCollapsed);
    // max-height 처리: 펼칠 때 현재 scrollHeight 설정 → CSS transition 적용
    const label = btn.querySelector('.toggle-label');
    if (isCollapsed) {
      content.style.maxHeight = content.scrollHeight + 'px';
      requestAnimationFrame(() => { content.style.maxHeight = '0px'; });
      if (label) label.textContent = '펼치기';
    } else {
      content.style.maxHeight = content.scrollHeight + 'px';
      setTimeout(() => { content.style.maxHeight = ''; }, 310);
      if (label) label.textContent = '접기';
    }
  });
}

/* ── 21. 초기화 ─────────────────────────────────────────────── */
// ★ Change 6: loadAll() — 외부에서 재시도 호출 가능한 래퍼
async function loadAll() { await init(true); }

async function init(showLoading=true) {
  if (showLoading) $('loadingOverlay').style.display = 'flex';
  const errBannerEl = $('errBanner');
  if (errBannerEl) errBannerEl.style.display = 'none';
  _failedSheets.clear();
  try {
    await loadData();
    renderAll();
    $('loadingOverlay').style.display = 'none';
  } catch(e) {
    console.error('[OPS Dashboard] 로드 오류:', e);
    clearSlowLoadTimer();
    $('loadingOverlay').style.display = 'none';
    // ★ Change 6: 실패한 시트 이름 표시
    const failedNames = [..._failedSheets].map(gid => {
      const storeEntry = Object.entries(GID.stores).find(([,v]) => v.gid === gid);
      if (storeEntry) return `${storeEntry[1].name} 매장`;
      const knownGids = { [GID.summary]:'요약', [GID.ops]:'운영', [GID.sales]:'매출', [GID.subs]:'구독', [GID.mrr]:'MRR', [GID.coupon]:'쿠폰 분석', [GID.dataCheck]:'데이터 점검', [GID.factMonthly]:'월·매장 원천' };
      return knownGids[gid] || `시트(${gid})`;
    });
    const failedStr = failedNames.length ? ` · 실패 시트: ${failedNames.join(', ')}` : '';
    const errEl = $('errBanner');
    if (errEl) {
      errEl.style.display = 'block';
      errEl.innerHTML = `<span style="font-weight:800">⚠ 데이터 로드 실패 · 시트 연결을 확인해주세요${failedStr}</span>
        <br><span style="font-size:11.5px;opacity:.85">${e.message}</span>
        <button id="errRetryBtn" style="margin-left:14px;padding:4px 14px;border-radius:99px;border:1px solid currentColor;background:transparent;color:inherit;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer">↻ 재시도</button>`;
      document.getElementById('errRetryBtn')?.addEventListener('click', loadAll);
    }
  }
}

parseHash();
bindEvents();
init();
