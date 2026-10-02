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
// ★ 한국 운영일 기준 현재 달까지만 포함 — 브라우저 로컬 시간대 영향 제거
function getKstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { year:+values.year, month:+values.month, day:+values.day };
}
const KST_TODAY  = getKstDateParts();
const TODAY_YEAR = KST_TODAY.year;
const TODAY_MONTH = KST_TODAY.month;   // 1-12
const QUARTERS = ['Q1','Q2','Q3','Q4'];
const PERIOD_FILTERS = ['all','H1','H2', ...QUARTERS];
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
  if (period === 'H2') return (month.monthNum || month.num || 0) >= 7 && (month.monthNum || month.num || 0) <= 12;
  return month.quarter === period;
}
function periodEndMonth(period) {
  if (period === 'H1') return 6;
  if (period === 'H2') return 12;
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
const TODAY_DAY = KST_TODAY.day;   // 한국시간 현재 경과 일수 (1~31)
function daysInMonth(monthNum, yr) {      // 해당 월의 총 일수
  return new Date(yr || TODAY_YEAR, monthNum, 0).getDate();
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
  const st = m.status || monthStatus(m.monthNum || m.num);
  if (st === 'confirmed') return `${m.month} ✓`;
  if (st === 'mtd')       return `${m.month} MTD`;
  return m.month;
}

/* ── 2. 상태 ─────────────────────────────────────────────────── */
let state = { quarter:"all", store:"all" };
let dashboard = null;
const charts = {};

function getMtdDay() {
  const current = dashboard?.overall?.find(month => month.monthNum === TODAY_MONTH);
  if (current?.elapsedDays > 0) return current.elapsedDays;
  const sourceDate = dashboard?.dataQuality?.salesLatestDate;
  if (sourceDate instanceof Date && !Number.isNaN(sourceDate.getTime())
      && sourceDate.getFullYear() === TODAY_YEAR
      && sourceDate.getMonth() + 1 === TODAY_MONTH) {
    return sourceDate.getDate();
  }
  return TODAY_DAY;
}

/* ── 3. 포맷 헬퍼 ───────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const fmtW   = v => `${Math.round(+v||0).toLocaleString("ko-KR")}원`;
// fmtS: 정밀 표시 — ARPU 등 소수점 있는 만원 단위도 .1 자리까지 표시
const fmtS   = v => { if(v==null || !Number.isFinite(+v)) return '—'; const n=+v||0,a=Math.abs(n); if(a>=1e8) return `${(n/1e8).toFixed(1)}억`; if(a>=1e4){const m=n/1e4; return `${Number.isInteger(m)?m:m.toFixed(1)}만원`;} return `${Math.round(n).toLocaleString()}원`; };
const fmtA   = v => { const n=+v||0,a=Math.abs(n); return a>=1e8?`${(n/1e8).toFixed(1)}억`:a>=1e4?`${Math.round(n/1e4)}만`:String(Math.round(n)); };
const fmtN   = v => `${Math.round(+v||0).toLocaleString("ko-KR")}`;
const fmtP   = v => v == null || !Number.isFinite(+v) ? '—' : `${(+v).toFixed(1)}%`;
const fmtP1  = v => `${(+v||0).toFixed(1)}%`;
const fmtYoY = (v, available=true) => available ? `${(+v||0)>0?'+':''}${fmtP(v||0)}` : '비교 없음';
function subscriptionMonthsFor(months) {
  return (months || []).filter(month => month.hasSubscriptionData !== false);
}
function subscriptionBasisLabel(summary) {
  if (!summary?.hasSubscriptionData) return '구독 원천 미수신';
  const monthLabel = summary.subscriptionSnapshotMonth || '최근 수신월';
  return `${summary.subscriptionSourceDate || monthLabel} 구독 수신 기준${summary.subscriptionLagged ? ' / 매출 기준일과 다름' : ''}`;
}
const tx     = v => String(v??'').replace(/\s+/g,' ').trim();
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => {
  if (typeof v === 'number') return v;
  const text = String(v ?? '').trim();
  const value = +(text.replace(/[^\d.-]/g,'')) || 0;
  const unit = /억원?$/.test(text) ? 1e8 : /백만원$/.test(text) ? 1e6 : /만원$/.test(text) ? 1e4 : 1;
  return value * unit;
};
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

/* Server-backed source loading */
const _failedSheets = new Set();
let sourceSnapshot = null;
let sourceRefreshFailed = false;
const SNAPSHOT_CACHE_KEY = 'ops-source-confirmed-v2';
const SNAPSHOT_CACHE_MAX_AGE = 24*60*60*1000;

function readCachedSnapshot(storage, now=Date.now()) {
  try {
    storage=storage || window.localStorage;
    const snapshot=JSON.parse(storage.getItem(SNAPSHOT_CACHE_KEY));
    const age=now-Date.parse(snapshot?.fetchedAt);
    const cfg=Object.fromEntries(snapshot?.sheets?.cfg || []);
    if (snapshot?.schemaVersion!==1 || snapshot?.sheetId!=='1QasrQPOZqq3ljxCXQWnGYEy40D8jhojJRFOWkVa6uxo' ||
        !['complete','partial'].includes(snapshot.readiness?.mode) || !Array.isArray(snapshot.sheets?.factMonthly) ||
        !Array.isArray(snapshot.sheets?.overallMonthly) || Number(cfg.current_year)!==TODAY_YEAR || Number(cfg.current_month)!==TODAY_MONTH ||
        !Number.isFinite(age) || age<0 || age>SNAPSHOT_CACHE_MAX_AGE) return null;
    return snapshot;
  } catch { return null; }
}

function saveCachedSnapshot(snapshot,storage) {
  try {
    storage=storage || window.localStorage;
    if (!snapshot?.preview && snapshot?.delivery?.mode!=='cached' && snapshot?.readiness)
      storage.setItem(SNAPSHOT_CACHE_KEY,JSON.stringify(snapshot));
  } catch { /* Storage can be disabled or full; live loading remains available. */ }
}

async function fetchDashboardSnapshot() {
  let response;
  try {
    response=await fetch('/api/data', { cache:'no-store', credentials:'same-origin', signal:AbortSignal.timeout(170000) });
  } catch {
    const cached=readCachedSnapshot();
    if (cached) {
      try {
        const auth=await fetch('/api/check',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});
        if (auth.ok && (await auth.json()).ok===true) {
          sourceSnapshot={...cached,delivery:{mode:'cached',reason:'데이터 조회가 지연되어 마지막 확인값을 유지합니다.',code:'SOURCE_TIMEOUT'}};
          return;
        }
      } catch {}
    }
    throw new Error('데이터 조회가 지연됐습니다. 연결이 복구되면 자동으로 다시 조회합니다.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.sheets) {
    if (response.status === 401) {
      try { window.localStorage.removeItem(SNAPSHOT_CACHE_KEY); } catch {}
      throw new Error('인증이 만료됐습니다. 페이지를 새로 열어 로그인하세요.');
    }
    if (response.status===503 && /^SOURCE_/.test(payload?.code || '') &&
        !['SOURCE_AUTH_REQUIRED','SOURCE_AUTH_INVALID','SOURCE_ACCESS_DENIED'].includes(payload.code)) {
      const cached=readCachedSnapshot();
      if (cached) {
        sourceSnapshot={...cached,delivery:{mode:'cached',reason:payload.error,code:payload.code}};
        return;
      }
    }
    throw new Error(payload?.error || '시트 데이터 API에 연결하지 못했습니다. 최신 배포와 연결 설정을 확인하세요.');
  }
  sourceSnapshot = payload;
}

function loadSheet(gid, includeColumnHeaders=false, range='') {
  const key = Object.keys(GID).find(key => GID[key] === gid);
  const rows = sourceSnapshot?.sheets?.[key];
  if (rows) return Promise.resolve(rows);
  _failedSheets.add(gid);
  return Promise.reject(new Error('필수 시트 데이터가 누락됐습니다.'));
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
function normalizeMetricKey(value) {
  const key = tx(value);
  if (!key) return '';
  return key
    .replace(/\(추정\s*,\s*원\/해지\s*건\)$/u, '(추정)')
    .replace(/\((?:%|원(?:\/[^,)]*)?|회|구독\s*건)(?:\s*,[^)]*)?\)$/u, '')
    .trim();
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
    const normalizedKey = normalizeMetricKey(k);
    if (normalizedKey && !m.has(normalizedKey)) m.set(normalizedKey, rows[i]);
  }
  return m;
}
function mv(map, key, col, fn=num) {
  const r = map.get(key); return r ? fn(r[col]) : 0;
}
function mapHasMetricValue(map, keys, col) {
  return keys.some(key => {
    const r = map.get(key) || map.get(normalizeMetricKey(key));
    return r && r[col] !== undefined && r[col] !== null && String(r[col]).trim() !== '';
  });
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
  const hasSubscriptionData = mapHasMetricValue(subM, ['유지','신규','해지','순증감'], spec.cur)
    || mapHasMetricValue(mrrM, ['MRR','ARR','LTV(추정)'], spec.cur);
  const retainedRaw   = mv(subM, '유지', spec.cur);
  const cancelSubsRaw = mv(subM, '해지', spec.cur);
  // 이탈률: 시트에 직접 기재된 값 우선, 없으면 해지/유지로 계산
  const churnRaw   = mvAlias(subM, ['이탈률(월환산)','이탈률','이탈율','이탈율(%)','이탈률(%)'], spec.cur, pct);
  const churnValue = churnRaw > 0 ? churnRaw : (retainedRaw > 0 && cancelSubsRaw > 0 ? cancelSubsRaw / retainedRaw * 100 : 0);
  const retainedExposureValue = churnValue > 0 && cancelSubsRaw > 0
    ? cancelSubsRaw / (churnValue / 100)
    : retainedRaw;
  const target     = mv(salesM,'목표매출', spec.cur);
  const gross      = mvAlias(salesM, GROSS_REVENUE_KEYS, spec.cur);
  const grossPrev  = mvAlias(salesM, GROSS_REVENUE_KEYS, spec.prev);
  const net        = mv(salesM,'순매출',   spec.cur);
  const netPrev    = mv(salesM,'순매출',   spec.prev);
  const netAchievementRaw   = mvAlias(salesM,['달성률','달성율','달성률(순매출)','순매출 달성률','순매출달성률'], spec.cur, pct);
  const grossAchievementRaw = mvAlias(salesM, GROSS_ACHIEVEMENT_KEYS, spec.cur, pct);
  const mrrRaw     = mv(mrrM, 'MRR', spec.cur);
  const mrrPrevRaw = mv(mrrM, 'MRR', spec.prev);
  const storePassRevenue = mvAlias(mrrM, ['단일구독매출','매장PASS 매출'], spec.cur) ||
    mvAlias(salesM, ['단일구독매출','매장PASS 매출'], spec.cur);
  const storePassArpu = mvAlias(mrrM, ['매장PASS ARPU(월환산)','매장PASS ARPU','ARPU'], spec.cur);
  return {
    month: label, quarter,
    target,
    gross,
    grossPrev,
    hasGrossYoY: grossPrev > 0,
    grossYoY:     mvAlias(salesM, GROSS_REVENUE_KEYS, spec.yoy, pct),
    achievement:  netAchievementRaw || (target ? net / target * 100 : 0),
    grossAchievement: grossAchievementRaw || (target ? gross / target * 100 : 0),
    net,
    netPrev,
    hasNetYoY: netPrev > 0,
    netYoY:       mv(salesM,'순매출',     spec.yoy, pct),
    usage:        mvAlias(salesM,['총사용량','총사용','사용건수','총이용'], spec.cur),
    // 할인은 전용 원천 행이 있을 때만 사용한다. 환불을 할인으로 대체하면
    // 환불이 이중 집계되어 수익 구성 비중이 왜곡된다.
    discountAmount: mv(salesM,'할인금액', spec.cur),
    discountShare:  mvAlias(salesM,['할인비중','할인율','할인비율'], spec.cur, pct),
    hasDiscountData: salesM.has('할인금액') || ['할인비중','할인율','할인비율'].some(k => salesM.has(k)),
    refundAmount: mvAlias(salesM,['환불금액','환불액'], spec.cur),
    refundRate:   mvAlias(salesM,['환불율','환불률','환불비율'],           spec.cur, pct),
    utilization:  mvAlias(salesM,['가동률','가동율','이용률'],             spec.cur, pct),
    hasSubscriptionData,
    retained: hasSubscriptionData ? retainedRaw : null,
    retainedPrev: hasSubscriptionData ? mv(subM, '유지', spec.prev) : null,
    retainedExposure: hasSubscriptionData ? retainedExposureValue : null,
    newSubs:      hasSubscriptionData ? mv(subM, '신규', spec.cur) : null,
    cancelSubs:   hasSubscriptionData ? cancelSubsRaw : null,
    netAdds:      hasSubscriptionData ? mv(subM, '순증감', spec.cur) : null,
    churn:        hasSubscriptionData ? churnValue : null,
    mrr:          hasSubscriptionData ? mrrRaw : null,
    mrrPrev:      hasSubscriptionData ? mrrPrevRaw : null,
    hasMrrYoY: hasSubscriptionData && mrrPrevRaw > 0,
    mrrYoY:       hasSubscriptionData ? mv(mrrM, 'MRR', spec.yoy, pct) : null,
    arr:          hasSubscriptionData ? mv(mrrM, 'ARR', spec.cur) : null,
    arrPrev:      hasSubscriptionData ? mv(mrrM, 'ARR', spec.prev) : null,
    arrYoY:       hasSubscriptionData ? mv(mrrM, 'ARR', spec.yoy, pct) : null,
    ltv:          hasSubscriptionData ? mv(mrrM, 'LTV(추정)', spec.cur) : null,
    ltvPrev:      hasSubscriptionData ? mv(mrrM, 'LTV(추정)', spec.prev) : null,
    storePassRevenue,
    arpu: hasSubscriptionData
      ? (storePassArpu || (retainedExposureValue > 0 ? storePassRevenue / retainedExposureValue : 0))
      : null,
    arpuBasis: 'store_pass_sales_exposure',
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
    const hasCouponValue = mapHasMetricValue(source, ['쿠폰할인금액'], sp.cur);
    const canMapToPreCouponEstimate = hasCouponValue && couponDiscount >= 0 && m.gross > 0;
    const mappedDiscount = canMapToPreCouponEstimate ? couponDiscount : 0;
    const listPriceRevenue = m.gross + mappedDiscount;
    m.discountAmount = mappedDiscount;
    m.discountShare = m.gross > 0 ? mappedDiscount / m.gross * 100 : 0;
    m.hasDiscountData = canMapToPreCouponEstimate;
    m.couponSheetPresent = hasCouponRow;
    m.hasCouponSourceData = hasCouponValue;
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
    const usageVal     = tx(rows[i][5]) === '' ? null : num(rows[i][5]);
    const retained     = num(rows[i][6]);
    const refundRate   = pct(rows[i][9]);   // 소수 → %, pct() 자동 처리
    const churn        = pct(rows[i][10]);  // 소수 → %, pct() 자동 처리
    // [통일] 가동률 단일 소스: ops시트 col13 — 매장 레벨 가동률의 권위 값
    const utilizationVal = tx(rows[i][13]) === '' ? null : pct(rows[i][13]);

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

function factRawValue(row, headerIndex, keys) {
  for (const key of keys) {
    const col = headerIndex.get(key);
    if (col === undefined) continue;
    const value = row[col];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function factValue(row, headerIndex, keys, fn=num) {
  const value = factRawValue(row, headerIndex, keys);
  return value === null ? 0 : fn(value);
}

function sourceDateKey(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
  const text = String(value).trim();
  const match = text.match(/(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
  const gviz = text.match(/^Date\((\d{4}),(\d+),(\d+)/);
  return gviz ? `${gviz[1]}-${String(+gviz[2]+1).padStart(2,'0')}-${gviz[3].padStart(2,'0')}` : null;
}

function sourceMonthDate(monthNum, latest) {
  const date = sourceDateKey(latest);
  if (!date || +date.slice(0,4) !== TODAY_YEAR || +date.slice(5,7) < monthNum) return null;
  return +date.slice(5,7) === monthNum ? date
    : `${TODAY_YEAR}-${String(monthNum).padStart(2,'0')}-${daysInMonth(monthNum)}`;
}

function sourceQuality(key, storeName, monthNum) {
  const group={salesQuality:'sales',salesQualityPrev:'salesPrev',usageQuality:'usage',usageQualityPrev:'usagePrev'}[key];
  if (sourceSnapshot?.readiness?.mode==='partial' && sourceSnapshot.readiness.cells?.[`${storeName}:${monthNum}`]?.[group]!==true)
    return {complete:false,usable:false,observed:null,status:'HOLD',expected:0,received:0};
  const rows = sourceSnapshot?.sheets?.[key];
  if (!rows) return { complete:true, usable:true, observed:null, status:'LEGACY' };
  const headers = rows[0] || [];
  const get = (row, name) => row[headers.indexOf(name)];
  const row = rows.slice(1).find(row => get(row,'매장') === storeName && Number(get(row,'월')) === monthNum);
  const status = row ? get(row,'품질상태') : 'MISSING';
  const clean = row && ['중복행','잘못된 값','매출 분해 불일치'].every(key => Number(get(row,key)) === 0);
  return { complete:Boolean(clean && (status === 'OK' || status === 'PREOPEN')), status,
    usable:status === 'PREOPEN' || Boolean(clean && num(get(row,'수신일')) > 0),
    expected:row ? num(get(row,'기대일')) : 0, received:row ? num(get(row,'수신일')) : 0,
    observed:clean && num(get(row,'수신일')) > 0 ? num(get(row,'관측 이용량')) : null,
    sourceDate:row ? sourceDateKey(get(row,'집계 기준일')) : null };
}

function applySourceQuality(item, storeName) {
  const usage = sourceQuality('usageQuality',storeName,item.monthNum);
  const sales = sourceQuality('salesQuality',storeName,item.monthNum);
  const priorSales = sourceQuality('salesQualityPrev',storeName,item.monthNum);
  const priorUsage = sourceQuality('usageQualityPrev',storeName,item.monthNum);
  const stores = Object.values(GID.stores).map(s=>s.name);
  const sharedComplete = stores.every(name => sourceQuality('usageQuality',name,item.monthNum).complete &&
    sourceQuality('salesQuality',name,item.monthNum).complete);
  const sharedUsable = stores.every(name => sourceQuality('usageQuality',name,item.monthNum).usable &&
    sourceQuality('salesQuality',name,item.monthNum).usable);
  const attributionAvailable = sharedUsable && item.salesSourceDate && item.salesSourceDate === item.usageSourceDate;
  item.observedContributionRevenue = attributionAvailable ? item.contributionRevenue : null;
  item.observedAllPassAttributedRevenue = attributionAvailable ? item.allPassAttributedRevenue : null;
  item.hasUsageData = usage.complete;
  item.hasSalesData = sales.complete;
  item.usageQuality = usage;
  item.usageMissingDays = Math.max(0, (usage.expected || 0) - (usage.received || 0));
  item.observedUsage = usage.status === 'LEGACY' ? item.usage : usage.observed;
  const priorActive = !STORE_OPEN_DATES[storeName] || `${TODAY_YEAR-1}-${String(item.monthNum).padStart(2,'0')}-31` >= STORE_OPEN_DATES[storeName];
  item.priorUsageApplicable = priorActive;
  item.hasUsagePrevData = priorActive && priorUsage.complete && Number.isFinite(item.usagePrev);
  item.observedUsagePrev = priorActive ? (priorUsage.status === 'LEGACY' ? item.usagePrev : priorUsage.observed) : null;
  item.usagePrevSourceDate = priorUsage.sourceDate || item.salesPrevDate || null;
  item.usagePrevMissingDays = Math.max(0,(priorUsage.expected||0)-(priorUsage.received||0));
  if (!item.hasUsagePrevData) item.usagePrev = null;
  item.usageComparable = priorActive && usage.complete && priorUsage.complete;
  item.salesComparable = item.salesComparable !== false && sales.complete && priorSales.complete;
  item.hasGrossYoY = item.hasGrossYoY && item.salesComparable;
  item.hasNetYoY = item.hasNetYoY && item.salesComparable;
  item.hasArpwData = item.hasArpwData && usage.complete && sales.complete;
  item.hasArpuData = item.hasArpuData && sales.complete;
  if (!usage.complete) {
    for (const key of ['usage','utilization','utilizationRaw','seasonIdx','seasonIdxConfirmed','seasonIdxMtd',
      'seasonIdxProjected','idleMtd','projectedUsage','projectedIdle','lossUnitPrice','lossMtd','lossProjected']) item[key] = null;
  }
  if (!sales.complete) {
    for (const key of ['gross','net','refundAmount','achievement','grossAchievement','refundRate','arpu']) item[key] = null;
  }
  if (!sharedComplete) { item.contributionRevenue = null; item.allPassAttributedRevenue = null; }
  return item;
}

function dateContract(row, headerIndex, monthNum) {
  const read = key => sourceDateKey(factRawValue(row,headerIndex,[key]));
  const cfg = new Map(sourceSnapshot?.sheets?.cfg || []);
  const salesSourceDate = read('최신매출일_2026');
  const salesPrevDate = read('최신매출일_2025');
  const subscriptionSourceDate = read('최신구독일_2026');
  const subscriptionPrevDate = read('최신구독일_2025');
  const usageSourceDate = read('최신사용일_2026') || sourceMonthDate(monthNum,cfg.get('usage_local_latest_date'));
  return { salesSourceDate, salesPrevDate, subscriptionSourceDate, subscriptionPrevDate, usageSourceDate,
    hasArpuData:Boolean(salesSourceDate && subscriptionSourceDate && salesSourceDate===subscriptionSourceDate),
    hasArpwData:Boolean(salesSourceDate && usageSourceDate && salesSourceDate===usageSourceDate),
    salesComparable:Boolean(salesSourceDate && salesPrevDate && salesSourceDate.slice(5)===salesPrevDate.slice(5)),
    subscriptionComparable:Boolean(subscriptionSourceDate && subscriptionPrevDate && subscriptionSourceDate.slice(5)===subscriptionPrevDate.slice(5)) };
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
  const nullableNumber = (row, key) => {
    const raw=factRawValue(row,headerIndex,[key]);
    const value=raw == null ? NaN : Number(String(raw).replace(/,/g,''));
    return Number.isFinite(value) ? value : null;
  };

  rows.slice(headerRowIdx + 1).forEach(row => {
    const storeName = tx(row[headerIndex.get('매장')]);
    const monthNum = factValue(row, headerIndex, ['월번호']);
    if (!knownStoreNames.has(storeName) || monthNum < 1 || monthNum > TODAY_MONTH) return;
    if (storeActiveDaysInMonth(storeName, monthNum) === 0) return;

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
    const dates = dateContract(row, headerIndex, monthNum);
    const subscriptionSourceDate = dates.subscriptionSourceDate;
    const hasSubscriptionData = headerIndex.has('최신구독일_2026')
      ? Boolean(subscriptionSourceDate)
      : ['유지_2026','신규_2026','해지_2026','MRR_2026'].some(key => factRawValue(row, headerIndex, [key]) !== null);
    const retainedRaw = factValue(row, headerIndex, ['유지_2026']);
    const retainedPrevRaw = factValue(row, headerIndex, ['유지_2025']);
    const cancelSubsRaw = factValue(row, headerIndex, ['해지_2026']);
    const elapsedDays = factValue(row, headerIndex, ['경과일수_2026']);
    const daysInSourceMonth = factValue(row, headerIndex, ['월일수_2026']);
    const exposureFactor = status === 'mtd' && daysInSourceMonth > 0
      ? Math.max(0, Math.min(1, Number(subscriptionSourceDate?.slice(8) || 0) / daysInSourceMonth))
      : 1;
    const retainedExposureRaw = retainedRaw * exposureFactor;
    const storePassRevenue = factValue(row, headerIndex, ['단일구독매출_2026']);
    const storePassArpuRaw = factValue(row, headerIndex, ['매장PASS_ARPU_2026']);
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
      ...dates,
      salesComparable:storeName === '안성' ? null : dates.salesComparable,
      contributionRevenue: factRawValue(row,headerIndex,['운영기여매출_2026']) === null ? null : factValue(row,headerIndex,['운영기여매출_2026']),
      allPassAttributedRevenue: factRawValue(row,headerIndex,['올패스운영귀속매출_2026']) === null ? null : factValue(row,headerIndex,['올패스운영귀속매출_2026']),
      attributionSourceDate: sourceDateKey(factRawValue(row,headerIndex,['올패스귀속기준일_2026'])),
      target, targetFull,
      gross, grossPrev,
      hasGrossYoY: dates.salesComparable && grossPrev > 0,
      grossYoY: grossPrev > 0 ? (gross - grossPrev) / grossPrev * 100 : 0,
      net, netPrev,
      hasNetYoY: dates.salesComparable && netPrev > 0,
      netYoY: netPrev > 0 ? (net - netPrev) / netPrev * 100 : 0,
      achievement: achievementRaw || (target > 0 ? net / target * 100 : 0),
      grossAchievement: target > 0 ? gross / target * 100 : 0,
      refundAmount,
      refundRate: refundRateRaw || (gross > 0 ? refundAmount / gross * 100 : 0),
      usage,
      usagePrev:nullableNumber(row,'총사용_2025'),
      utilization: utilizationRaw || (mtdCapacity > 0 ? usage / mtdCapacity * 100 : 0),
      utilizationRaw: utilizationRaw || (mtdCapacity > 0 ? usage / mtdCapacity * 100 : 0),
      capacity: fullCapacity,
      mtdCapacity,
      elapsedDays,
      daysInSourceMonth,
      hasSubscriptionData,
      subscriptionSourceDate: subscriptionSourceDate || null,
      retained: hasSubscriptionData ? retainedRaw : null,
      retainedPrev: hasSubscriptionData ? retainedPrevRaw : null,
      retainedExposure: hasSubscriptionData ? retainedExposureRaw : null,
      newSubs: hasSubscriptionData ? factValue(row, headerIndex, ['신규_2026']) : null,
      cancelSubs: hasSubscriptionData ? cancelSubsRaw : null,
      netAdds: hasSubscriptionData ? factValue(row, headerIndex, ['순증감_2026']) : null,
      churn: hasSubscriptionData
        ? (churnRaw || (retainedExposureRaw > 0 ? cancelSubsRaw / retainedExposureRaw * 100 : 0))
        : null,
      mrr: hasSubscriptionData ? mrr : null,
      mrrPrev: hasSubscriptionData ? mrrPrev : null,
      hasMrrYoY: hasSubscriptionData && dates.subscriptionComparable && mrrPrev > 0,
      mrrYoY: hasSubscriptionData && mrrPrev > 0 ? (mrr - mrrPrev) / mrrPrev * 100 : null,
      arr: hasSubscriptionData ? factValue(row, headerIndex, ['ARR_2026']) : null,
      arrPrev: hasSubscriptionData ? factValue(row, headerIndex, ['ARR_2025']) : null,
      ltv: hasSubscriptionData ? factValue(row, headerIndex, ['LTV_추정_2026']) : null,
      ltvPrev: hasSubscriptionData ? factValue(row, headerIndex, ['LTV_추정_2025']) : null,
      storePassRevenue,
      arpu: hasSubscriptionData && dates.hasArpuData
        ? (storePassArpuRaw || (retainedExposureRaw > 0 ? storePassRevenue / retainedExposureRaw : 0))
        : null,
      arpuBasis: 'store_pass_sales_exposure',
      discountAmount: 0,
      discountShare: 0,
      hasDiscountData: false,
      listPriceRevenue: gross,
      seasonBase: factValue(row, headerIndex, ['계절기준선_2026']),
      seasonIdxConfirmed,
      seasonIdxMtd,
      seasonIdxProjected,
      seasonIdx: status === 'mtd' ? seasonIdxMtd : seasonIdxConfirmed,
      lossUnitPrice: nullableNumber(row, '손실단가_2026'),
      idleMtd: nullableNumber(row, '미가동대수_MTD_2026'),
      projectedUsage: nullableNumber(row, '월말예상총사용_2026'),
      projectedIdle: nullableNumber(row, '월말예상미가동대수_2026'),
      lossMtd: nullableNumber(row, '손실추정매출_MTD_2026'),
      lossProjected: nullableNumber(row, '손실추정매출_월말예상_2026'),
      anomalyFlags: tx(row[headerIndex.get('이상플래그_종합')]),
      source: 'fact_monthly'
    };

    if (!byStore.has(storeName)) byStore.set(storeName, []);
    byStore.get(storeName).push(applySourceQuality(item, storeName));
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
    const dates = dateContract(row, headerIndex, monthNum);
    const subscriptionSourceDate = dates.subscriptionSourceDate;
    const hasSubscriptionData = headerIndex.has('최신구독일_2026')
      ? Boolean(subscriptionSourceDate)
      : ['유지_2026','신규_2026','해지_2026','MRR_2026'].some(key => factRawValue(row, headerIndex, [key]) !== null);
    const retainedRaw = factValue(row, headerIndex, ['유지_2026']);
    const retainedPrevRaw = factValue(row, headerIndex, ['유지_2025']);
    const newSubsRaw = factValue(row, headerIndex, ['신규_2026']);
    const cancelSubsRaw = factValue(row, headerIndex, ['해지_2026']);
    const netAddsRaw = headerIndex.has('순증감_2026')
      ? factValue(row, headerIndex, ['순증감_2026'])
      : newSubsRaw - cancelSubsRaw;
    const allPassRetainedRaw = factValue(row, headerIndex, ['올패스유지_2026']);
    const allPassRetainedPrevRaw = factValue(row, headerIndex, ['올패스유지_2025']);
    const elapsedDays = factValue(row, headerIndex, ['경과일수_2026']);
    const daysInSourceMonth = factValue(row, headerIndex, ['월일수_2026']);
    const status = monthStatus(monthNum);
    const exposureFactor = status === 'mtd' && daysInSourceMonth > 0
      ? Math.max(0, Math.min(1, Number(subscriptionSourceDate?.slice(8) || 0) / daysInSourceMonth))
      : 1;
    byMonth.set(monthNum, {
      ...dates,
      hasSubscriptionData,
      subscriptionSourceDate: subscriptionSourceDate || null,
      mrr: hasSubscriptionData ? factValue(row, headerIndex, ['MRR_2026']) : null,
      mrrPrev: hasSubscriptionData ? factValue(row, headerIndex, ['MRR_2025']) : null,
      arr: hasSubscriptionData ? factValue(row, headerIndex, ['ARR_2026']) : null,
      arrPrev: hasSubscriptionData ? factValue(row, headerIndex, ['ARR_2025']) : null,
      ltv: hasSubscriptionData ? factValue(row, headerIndex, ['LTV_추정_2026']) : null,
      ltvPrev: hasSubscriptionData ? factValue(row, headerIndex, ['LTV_추정_2025']) : null,
      retained: hasSubscriptionData ? retainedRaw : null,
      retainedPrev: hasSubscriptionData ? retainedPrevRaw : null,
      newSubs: hasSubscriptionData ? newSubsRaw : null,
      cancelSubs: hasSubscriptionData ? cancelSubsRaw : null,
      netAdds: hasSubscriptionData ? netAddsRaw : null,
      allPassRetained: hasSubscriptionData ? allPassRetainedRaw : null,
      allPassRetainedPrev: hasSubscriptionData ? allPassRetainedPrevRaw : null,
      retainedExposure: hasSubscriptionData ? retainedRaw * exposureFactor : null,
      storePassRevenue: factValue(row, headerIndex, ['단일구독매출_2026']),
      storePassArpu: hasSubscriptionData && dates.hasArpuData ? factValue(row, headerIndex, ['매장PASS_ARPU_2026']) : null,
      allPassArpu: hasSubscriptionData && dates.hasArpuData ? factValue(row, headerIndex, ['올패스_ARPU_2026']) : null,
      mrrSubscribers: hasSubscriptionData ? retainedRaw + allPassRetainedRaw : null,
      mrrSubscribersPrev: hasSubscriptionData ? retainedPrevRaw + allPassRetainedPrevRaw : null,
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
    const finance = canonical || fallback;
    const hasSubscriptionData = canonical
      ? canonical.hasSubscriptionData !== false
      : fallback.hasSubscriptionData !== false && [fallback.retained, fallback.newSubs, fallback.mrr]
        .some(value => value !== null && value !== undefined && Number(value) !== 0);

    if (canonical) {
      ['salesSourceDate','usageSourceDate','subscriptionSourceDate','subscriptionComparable'].forEach(key => { m[key] = canonical[key]; });
      m.hasArpuData = m.hasArpuData !== false && canonical.hasArpuData;
      m.hasArpwData = m.hasArpwData !== false && canonical.hasArpwData;
      m.retained = canonical.retained;
      m.retainedPrev = canonical.retainedPrev;
      m.retainedExposure = canonical.retainedExposure;
      m.newSubs = canonical.newSubs;
      m.cancelSubs = canonical.cancelSubs;
      m.netAdds = canonical.netAdds;
      m.churn = canonical.retainedExposure > 0
        ? canonical.cancelSubs / canonical.retainedExposure * 100
        : (canonical.hasSubscriptionData ? 0 : null);
      m.storePassRevenue = canonical.storePassRevenue ?? m.storePassRevenue ?? 0;
    }

    m.hasSubscriptionData = hasSubscriptionData;
    m.subscriptionSourceDate = canonical?.subscriptionSourceDate || m.subscriptionSourceDate || null;
    m.portfolioFinanceSource = canonical?.source || 'analysis_tabs';
    if (!hasSubscriptionData) {
      ['retained','retainedPrev','retainedExposure','newSubs','cancelSubs','netAdds','churn',
        'mrr','mrrPrev','mrrYoY','arr','arrPrev','arrYoY','ltv','ltvPrev','allPassRetained',
        'allPassRetainedPrev','mrrSubscribers','mrrSubscribersPrev','arpu','allPassArpu','mrrPerSubscriber']
        .forEach(key => { m[key] = null; });
      m.hasMrrYoY = false;
      return;
    }

    m.mrr = finance.mrr ?? m.mrr ?? 0;
    m.mrrPrev = finance.mrrPrev ?? m.mrrPrev ?? 0;
    m.hasMrrYoY = m.subscriptionComparable !== false && m.mrrPrev > 0;
    m.mrrYoY = m.mrrPrev > 0 ? (m.mrr - m.mrrPrev) / m.mrrPrev * 100 : 0;
    m.arr = finance.arr ?? m.mrr * 12;
    m.arrPrev = finance.arrPrev ?? m.mrrPrev * 12;
    m.arrYoY = m.arrPrev > 0 ? (m.arr - m.arrPrev) / m.arrPrev * 100 : 0;
    m.ltv = finance.ltv ?? 0;
    m.ltvPrev = finance.ltvPrev ?? 0;
    m.allPassRetained = canonical?.allPassRetained ?? 0;
    m.allPassRetainedPrev = canonical?.allPassRetainedPrev ?? 0;
    m.mrrSubscribers = canonical?.mrrSubscribers ?? m.retained ?? 0;
    m.mrrSubscribersPrev = canonical?.mrrSubscribersPrev ?? m.retainedPrev ?? 0;
    m.storePassRevenue = canonical?.storePassRevenue ?? m.storePassRevenue ?? 0;
    m.retainedExposure = canonical?.retainedExposure ?? m.retainedExposure ?? m.retained ?? 0;
    m.arpu = m.hasArpuData === false ? null : canonical?.storePassArpu ?? m.arpu ??
      (m.retainedExposure > 0 ? m.storePassRevenue / m.retainedExposure : null);
    m.allPassArpu = m.hasArpuData === false ? null : canonical?.allPassArpu ?? null;
    m.mrrPerSubscriber = m.mrrSubscribers > 0 ? m.mrr / m.mrrSubscribers : 0;
    m.arpuBasis = 'store_pass_sales_exposure';
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
    const comparableGross = records.reduce((total, row) => total + (row.grossPrev > 0 ? (+row.gross || 0) : 0), 0);
    const comparableGrossPrev = records.reduce((total, row) => total + (row.grossPrev > 0 ? (+row.grossPrev || 0) : 0), 0);
    const comparableNet = records.reduce((total, row) => total + (row.netPrev > 0 ? (+row.net || 0) : 0), 0);
    const comparableNetPrev = records.reduce((total, row) => total + (row.netPrev > 0 ? (+row.netPrev || 0) : 0), 0);
    const usage = sum('usage');
    const refundAmount = sum('refundAmount');
    const hasSubscriptionData = records.every(row => row.hasSubscriptionData !== false);
    const hasSalesData = records.every(row => row.hasSalesData !== false);
    const retained = sum('retained');
    const retainedPrev = sum('retainedPrev');
    const retainedExposure = sum('retainedExposure');
    const cancelSubs = sum('cancelSubs');
    const storePassRevenue = sum('storePassRevenue');
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
      salesSourceDate:records.map(row=>row.salesSourceDate).filter(Boolean).sort().at(-1) || null,
      usageSourceDate:records.map(row=>row.usageSourceDate).filter(Boolean).sort().at(-1) || null,
      hasArpuData:records.every(row=>row.hasArpuData!==false),
      hasArpwData:records.every(row=>row.hasArpwData!==false),
      salesComparable:records.every(row=>row.salesComparable!==false),
      contributionRevenue:records.every(row=>row.contributionRevenue!=null) ? sum('contributionRevenue') : null,
      observedContributionRevenue:records.every(row=>row.observedContributionRevenue!=null) ? sum('observedContributionRevenue') : null,
      observedAllPassAttributedRevenue:records.every(row=>row.observedAllPassAttributedRevenue!=null) ? sum('observedAllPassAttributedRevenue') : null,
      allPassAttributedRevenue:records.every(row=>row.allPassAttributedRevenue!=null) ? sum('allPassAttributedRevenue') : null,
      gross:hasSalesData ? gross : null, grossPrev,
      comparableGross, comparableGrossPrev,
      hasGrossYoY: grossPrev > 0,
      grossYoY: grossPrev > 0 ? (gross - grossPrev) / grossPrev * 100 : 0,
      net:hasSalesData ? net : null, netPrev,
      comparableNet, comparableNetPrev,
      hasNetYoY: netPrev > 0,
      netYoY: netPrev > 0 ? (net - netPrev) / netPrev * 100 : 0,
      achievement: hasSalesData && target > 0 ? net / target * 100 : null,
      grossAchievement: hasSalesData && target > 0 ? gross / target * 100 : null,
      refundAmount:hasSalesData ? refundAmount : null,
      refundRate: hasSalesData && gross > 0 ? refundAmount / gross * 100 : null,
      hasUsageData:records.every(row=>row.hasUsageData!==false),
      hasUsagePrevData:records.some(row=>row.priorUsageApplicable!==false)
        && records.filter(row=>row.priorUsageApplicable!==false).every(row=>row.hasUsagePrevData!==false),
      usagePrev:records.filter(row=>row.priorUsageApplicable!==false).every(row=>row.hasUsagePrevData!==false) ? sum('usagePrev') : null,
      observedUsagePrev:records.every(row=>row.observedUsagePrev!=null || row.priorUsageApplicable===false || row.capacity===0)
        ? sum('observedUsagePrev') : null,
      usagePrevSourceDate:records.map(row=>row.usagePrevSourceDate).filter(Boolean).sort().at(-1) || null,
      usagePrevMissingDays:sum('usagePrevMissingDays'),
      hasSalesData,
      usageComparable:records.every(row=>row.usageComparable!==false),
      observedUsage:records.every(row=>row.observedUsage!=null || row.capacity===0) ? sum('observedUsage') : null,
      usageMissingDays:sum('usageMissingDays'),
      usage:records.every(row=>row.hasUsageData!==false) ? usage : null,
      utilization: records.every(row=>row.hasUsageData!==false) && mtdCapacity > 0 ? usage / mtdCapacity * 100 : null,
      utilizationRaw: records.every(row=>row.hasUsageData!==false) && mtdCapacity > 0 ? usage / mtdCapacity * 100 : null,
      capacity, mtdCapacity,
      hasSubscriptionData,
      subscriptionSourceDate: records.map(row => row.subscriptionSourceDate).filter(Boolean).sort().at(-1) || null,
      retained: hasSubscriptionData ? retained : null,
      retainedPrev: hasSubscriptionData ? retainedPrev : null,
      retainedExposure: hasSubscriptionData ? retainedExposure : null,
      allPassRetained:hasSubscriptionData ? 0 : null,
      allPassRetainedPrev:hasSubscriptionData ? 0 : null,
      mrrSubscribers:hasSubscriptionData ? retained : null,
      mrrSubscribersPrev:hasSubscriptionData ? retainedPrev : null,
      newSubs: hasSubscriptionData ? sum('newSubs') : null,
      cancelSubs: hasSubscriptionData ? cancelSubs : null,
      netAdds: hasSubscriptionData ? sum('netAdds') : null,
      churn: hasSubscriptionData ? (retainedExposure > 0 ? cancelSubs / retainedExposure * 100 : 0) : null,
      mrr: hasSubscriptionData ? mrr : null,
      mrrPrev: hasSubscriptionData ? mrrPrev : null,
      hasMrrYoY: hasSubscriptionData && mrrPrev > 0,
      mrrYoY: hasSubscriptionData && mrrPrev > 0 ? (mrr - mrrPrev) / mrrPrev * 100 : null,
      arr: hasSubscriptionData ? arr : null,
      arrPrev: hasSubscriptionData ? arrPrev : null,
      arrYoY: hasSubscriptionData && arrPrev > 0 ? (arr - arrPrev) / arrPrev * 100 : null,
      ltv: hasSubscriptionData ? (cancelSubs > 0 ? mrr / cancelSubs : 0) : null,
      storePassRevenue,
      arpu: hasSubscriptionData ? (retainedExposure > 0 ? storePassRevenue / retainedExposure : 0) : null,
      arpuBasis: 'store_pass_sales_exposure',
      elapsedDays: Math.max(0, ...records.map(row => +row.elapsedDays || 0)),
      daysInSourceMonth: Math.max(0, ...records.map(row => +row.daysInSourceMonth || 0)),
      discountAmount: 0, discountShare: 0, hasDiscountData: false,
      listPriceRevenue: gross,
      seasonBase,
      seasonIdx: seasonBase > 0 ? seasonUsage / seasonBase : null,
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
    comparableGross:a.comparableGross+(m.comparableGross ?? (m.grossPrev>0?m.gross:0)),
    comparableGrossPrev:a.comparableGrossPrev+(m.comparableGrossPrev ?? (m.grossPrev>0?m.grossPrev:0)),
    comparableNet:a.comparableNet+(m.comparableNet ?? (m.netPrev>0?m.net:0)),
    comparableNetPrev:a.comparableNetPrev+(m.comparableNetPrev ?? (m.netPrev>0?m.netPrev:0)),
    retainedExposure:a.retainedExposure+(m.hasSubscriptionData !== false ? (m.retainedExposure ?? m.retained ?? 0) : 0),
    storePassRevenue:a.storePassRevenue+(m.hasSubscriptionData !== false ? (m.storePassRevenue||0) : 0),
    newSubs:       a.newSubs+(m.hasSubscriptionData !== false ? (+m.newSubs||0) : 0),
    cancelSubs:    a.cancelSubs+(m.hasSubscriptionData !== false ? (+m.cancelSubs||0) : 0),
    netAdds:       a.netAdds+(m.hasSubscriptionData !== false ? (+m.netAdds||0) : 0),
    subscriptionMonths:a.subscriptionMonths+(m.hasSubscriptionData !== false ? 1 : 0),
    discountAmount:a.discountAmount+m.discountAmount,
    hasDiscountData:a.hasDiscountData||m.hasDiscountData,
    portfolioCouponData:a.portfolioCouponData||m.discountScope==='portfolio_coupon',
    couponSheetMonths:a.couponSheetMonths+(m.couponSheetPresent?1:0),
    couponSourceMonths:a.couponSourceMonths+(m.hasCouponSourceData?1:0),
    couponMappedMonths:a.couponMappedMonths+(m.hasDiscountData?1:0),
    unmappedCouponDiscount:a.unmappedCouponDiscount+(m.unmappedCouponDiscount||0),
    refundVal:     a.refundVal+(m.refundAmount || m.gross*(m.refundRate/100)||0),
    // 원천 가동률에서 해당 월의 유효 Capacity를 역산해 기간 가중 집계한다.
    cap:           a.cap+(m.mtdCapacity ?? (m.utilization>0?m.usage/(m.utilization/100):0)),
  }), {target:0,gross:0,grossPrev:0,net:0,netPrev:0,usage:0,
       comparableGross:0,comparableGrossPrev:0,comparableNet:0,comparableNetPrev:0,
       retainedExposure:0,storePassRevenue:0,newSubs:0,cancelSubs:0,netAdds:0,subscriptionMonths:0,discountAmount:0,
       hasDiscountData:false,portfolioCouponData:false,couponSheetMonths:0,couponSourceMonths:0,couponMappedMonths:0,
       unmappedCouponDiscount:0,refundVal:0,cap:0});
  // 매출/사용과 구독의 최신 수신일이 다를 수 있다. 구독 Stock은 선택 기간 안의 최신 수신월을 사용한다.
  const last = months[months.length-1];
  const subscriptionMonths = months.filter(m => m.hasSubscriptionData !== false);
  const lastSubscription = subscriptionMonths[subscriptionMonths.length - 1] || null;
  const hasSubscriptionData = Boolean(lastSubscription);
  const hasArpuData = months.every(m => m.hasArpuData !== false) && hasSubscriptionData && t.retainedExposure>0;
  const hasArpwData = months.every(m => m.hasArpwData !== false);
  const salesComparable = months.every(m => m.salesComparable !== false);
  const hasUsageData = months.every(m => m.hasUsageData !== false);
  const hasSalesData = months.every(m => m.hasSalesData !== false);
  return {
    hasArpuData, hasArpwData, salesComparable, hasUsageData, hasSalesData,
    usageComparable:months.every(m=>m.usageComparable!==false),
    observedUsage:months.every(m=>m.observedUsage!=null) ? months.reduce((s,m)=>s+m.observedUsage,0) : null,
    usageMissingDays:months.reduce((s,m)=>s+(m.usageMissingDays||0),0),
    mtdCapacity:t.cap,
    salesSourceDate:last.salesSourceDate || null,
    usageSourceDate:last.usageSourceDate || null,
    contributionRevenue:months.every(m=>m.contributionRevenue!=null) ? months.reduce((s,m)=>s+m.contributionRevenue,0) : null,
    observedContributionRevenue:months.every(m=>m.observedContributionRevenue!=null) ? months.reduce((s,m)=>s+m.observedContributionRevenue,0) : null,
    observedAllPassAttributedRevenue:months.every(m=>m.observedAllPassAttributedRevenue!=null) ? months.reduce((s,m)=>s+m.observedAllPassAttributedRevenue,0) : null,
    allPassAttributedRevenue:months.every(m=>m.allPassAttributedRevenue!=null) ? months.reduce((s,m)=>s+m.allPassAttributedRevenue,0) : null,
    target:t.target, gross:hasSalesData ? t.gross : null, grossPrev:t.grossPrev, net:hasSalesData ? t.net : null, netPrev:t.netPrev,
    grossYoY: t.comparableGrossPrev?(t.comparableGross-t.comparableGrossPrev)/t.comparableGrossPrev*100:0,
    netYoY:   t.comparableNetPrev?(t.comparableNet-t.comparableNetPrev)/t.comparableNetPrev*100:0,
    sameStoreNetYoY:t.comparableNetPrev?(t.comparableNet-t.comparableNetPrev)/t.comparableNetPrev*100:0,
    totalNetGrowth:t.netPrev?(t.net-t.netPrev)/t.netPrev*100:0,
    hasTotalNetGrowth:salesComparable && t.netPrev>0,
    hasGrossYoY:salesComparable && t.comparableGrossPrev>0,
    hasNetYoY:salesComparable && t.comparableNetPrev>0,
    achievement: hasSalesData && t.target ? t.net/t.target*100 : null,
    grossAchievement: hasSalesData && t.target ? t.gross/t.target*100 : null,
    usage:hasUsageData ? t.usage : null,
    hasSubscriptionData,
    subscriptionFlowComplete:months.every(m=>m.hasSubscriptionData !== false),
    subscriptionMonthCount:t.subscriptionMonths,
    subscriptionSnapshotMonth:lastSubscription?.month || null,
    subscriptionSourceDate:lastSubscription?.subscriptionSourceDate || null,
    subscriptionLagged:hasSubscriptionData && (lastSubscription !== last || lastSubscription.subscriptionSourceDate !== last.salesSourceDate),
    retained:hasSubscriptionData ? lastSubscription.retained : null,
    retainedPrev:hasSubscriptionData ? lastSubscription.retainedPrev : null,
    retainedExposure:hasSubscriptionData ? t.retainedExposure : null,
    allPassRetained:hasSubscriptionData ? (lastSubscription.allPassRetained||0) : null,
    allPassRetainedPrev:hasSubscriptionData ? (lastSubscription.allPassRetainedPrev||0) : null,
    mrrSubscribers:hasSubscriptionData ? (lastSubscription.mrrSubscribers ?? lastSubscription.retained ?? 0) : null,
    mrrSubscribersPrev:hasSubscriptionData ? (lastSubscription.mrrSubscribersPrev ?? lastSubscription.retainedPrev ?? 0) : null,
    newSubs:hasSubscriptionData ? t.newSubs : null,
    cancelSubs:hasSubscriptionData ? t.cancelSubs : null,
    netAdds:hasSubscriptionData ? t.netAdds : null,
    mrr:hasSubscriptionData ? lastSubscription.mrr : null,
    mrrPrev:hasSubscriptionData ? lastSubscription.mrrPrev : null,
    hasMrrYoY:hasSubscriptionData && lastSubscription.hasMrrYoY !== false && (lastSubscription.mrrPrev||0)>0,
    mrrYoY:hasSubscriptionData && lastSubscription.mrrPrev
      ? (lastSubscription.mrr-lastSubscription.mrrPrev)/lastSubscription.mrrPrev*100
      : null,
    churn:hasSubscriptionData && t.retainedExposure ? t.cancelSubs/t.retainedExposure*100 : null,
    utilization: hasUsageData && t.cap ? t.usage/t.cap*100 : null,
    refundRate: hasSalesData && t.gross ? t.refundVal/t.gross*100 : null,
    refundAmount:hasSalesData ? t.refundVal : null,
    discountAmount:t.discountAmount,
    listPriceRevenue:t.gross+t.discountAmount,
    discountShare: t.gross ? t.discountAmount/t.gross*100 : 0,
    hasDiscountData:t.hasDiscountData,
    discountScope:t.portfolioCouponData?'portfolio_coupon':null,
    couponSheetMonths:t.couponSheetMonths,
    couponSourceMonths:t.couponSourceMonths,
    couponMappedMonths:t.couponMappedMonths,
    unmappedCouponDiscount:t.unmappedCouponDiscount,
    retainedYoY: hasSubscriptionData && lastSubscription.retainedPrev
      ? (lastSubscription.retained-lastSubscription.retainedPrev)/lastSubscription.retainedPrev*100
      : null,
    // 스냅샷형 지표는 선택 기간의 최신 월 기준
    storePassRevenue:t.storePassRevenue,
    arpu: hasArpuData ? t.storePassRevenue/t.retainedExposure : null,
    arpuBasis:'store_pass_sales_exposure',
    arr:    hasSubscriptionData ? (lastSubscription.arr ?? 0) : null,
    ltv:    hasSubscriptionData ? (lastSubscription.ltv ?? 0) : null,
    arrYoY: hasSubscriptionData ? (lastSubscription.arrYoY ?? 0) : null
  };
}

function filterMonths(months) {
  // Confirmed zero activity is data; absent future rows are not.
  const hasData = m => m.hasSalesData === true || m.hasSubscriptionData === true || m.hasUsageData === true
    || m.gross > 0 || m.retained > 0 || m.mrr > 0 || m.usage > 0 || m.observedUsage > 0;
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
    // ★ v3: 지정 쿠폰 비중 ≈ 환불율 동일값 감지 — 컬럼 혼용 가능성
    if (m.hasDiscountData && m.discountShare > 0 && m.refundRate > 0) {
      const diff = Math.abs(m.discountShare - m.refundRate);
      if (diff < 0.01) opIssues.push(`${m.month}: 지정 쿠폰 비중·환불율 동일값(${fmtP(m.refundRate)}) — 컬럼 매핑 확인 필요`);
    }
    if ((m.unmappedCouponDiscount||0) > 0)
      fmtIssues.push(`${m.month}: 쿠폰할인 ${fmtS(m.unmappedCouponDiscount)} 있으나 실결제매출 0원 — 실결제매출 대비 지정 쿠폰 할인액 비율 산출 제외`);
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
      opIssues.push(`${s.name}: 이탈률 ${fmtP(s.churn)} — 운영 원인 집중 점검 필요`);
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
  //   ① 가동률 >100% ② 지정 쿠폰 비중=환불율 동일값 ③ 매출 불일치 ④ 매장 수 불일치 ⑤ 오픈 전 실데이터

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
  const sectionEnd = rows.findIndex(r => tx(r[0]) === 'H1 KPI');
  const summaryRows = sectionEnd >= 0 ? rows.slice(0, sectionEnd) : rows;
  summaryRows.forEach(r => {
    const k = tx(r[0]);
    if (k) map.set(k, r);
  });
  // 주요 집계 값 추출 (있으면 ops 시트 보완)
  const get = (keys, col=1) => {
    for (const k of keys) {
      const r = map.get(k);
      if (r && r[col] !== undefined && String(r[col]).trim() !== '')
        return /보류|미수신|누락|참고|불가/.test(tx(r[col])) ? null : num(r[col]);
    }
    return null;
  };
  // Only numeric cumulative cells use the explicitly declared display unit.
  const getAmount = keys => {
    const scale = /누적 금액:\s*억원/.test(tx(map.get('단위/결측 안내')?.[1])) ? 1e8 : 1;
    for (const key of keys) {
      const value = get([key]);
      if (value != null) return value * (key.startsWith('누적 ') && typeof map.get(key)?.[1] === 'number' ? scale : 1);
    }
    return null;
  };
  const getPct = (keys, col=1) => {
    for (const k of keys) {
      const r = map.get(k);
      if (r && r[col] !== undefined && String(r[col]).trim() !== '')
        return /보류|미수신|누락|참고|불가/.test(tx(r[col])) ? null : pct(r[col]);
    }
    return null;
  };
  const updatedRow = rows.find(r => tx(r[0]).startsWith('업데이트'));
  const subscriptionSummaryRow = [
    '누적 신규 / 누적 해지 / 최근 유지(구독 건)',
    '누적 신규 / 누적 해지 / 현재 유지',
    '누적 신규 / 해지 / 유지'
  ].map(key => map.get(key)).find(Boolean);
  const subscriptionSummaryText = tx(subscriptionSummaryRow?.[1]);
  const subscriptionAvailable = subscriptionSummaryRow
    ? !/미수신|확인 불가|집계 불가|데이터 없음/u.test(subscriptionSummaryText)
    : null;
  const subscriptionSummary = subscriptionAvailable
    ? subscriptionSummaryText.split('/').map(num)
    : [];
  return {
    totalTarget:  getAmount(['누적 목표매출','목표매출 합계']),
    totalGross:   getAmount(['누적 실결제매출(구 총매출)','누적 실결제매출','실결제매출(구 총매출)','실결제매출','누적 총매출','총매출','매출합계','Total Revenue','total_gross']),
    totalNet:     getAmount(['누적 순매출','순매출','Net Revenue']),
    contributionRevenue: getAmount(['누적 운영기여매출(환불 전)']),
    allPassAttributedRevenue: getAmount(['누적 올패스 운영귀속매출(환불 전)']),
    achievement:  getPct(['누적 순매출 달성률(대표)','누적 달성률(순매출)','누적 순매출 달성률']),
    grossAchievement: getPct(['누적 실결제매출 달성률(보조)','누적 실결제매출 달성률']),
    refundRate: getPct(['누적 환불율','누적 환불률']),
    sameStoreNetYoY: getPct(['동일점 순매출 YoY(안성 제외)']),
    totalNetGrowth: getPct(['전체 순매출 성장(안성 포함)']),
    totalNewSubs: subscriptionSummary[0] ?? null,
    totalCancelSubs: subscriptionSummary[1] ?? null,
    retained: subscriptionSummary[2] ?? null,
    subscriptionAvailable,
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
  if (['빌드 상태', '대시보드 빌드 상태'].includes(c?.name)) {
    return /진행\s*중|재생성\s*중|미완료|running|pending/i.test(`${c.status} ${c.value}`);
  }
  if (c?.name === '매출 최신일' && /점검중|미완료|중간에 중단|확인 불가/.test(text)) return true;
  return /대시보드 재생성이 완료되지 않았|최종 점검 미완료/.test(text);
}

function isInformationalDataQualityCheck(c) {
  if (c?.name === '원천별 최신일') return true;
  if (c?.name === '최신일 동기화' && c.status === '주의') {
    const pairs = String(c.value || '').replace(/^최신일 동기화:\s*/, '').split(/\s*,\s*/)
      .map(part => part.match(/^_overall\s+(\d{4})=(\d{1,7}(?:\.\d+)?)\s*\/\s*raw=(\d{4}-\d{2}-\d{2})$/));
    if (pairs.length === 2 && pairs.every(pair => pair && pair[1] === pair[3].slice(0,4) &&
        sourceDateKey(Number(pair[2])) === pair[3])) return true;
  }
  if (c?.name === '원천 미수신 0값 보호' && /매장 분석 O6 구독 결측 보호 누락/u.test(`${c?.value || ''} ${c?.note || ''}`)) {
    return true;
  }
  // 최신 원천의 "전년 비교 완전성=주의"는 2025년 1월 기준일 부재로 YoY를 공란 처리했다는 안내다.
  // 데이터 오류나 운영 리스크로 카운트하지 않는다.
  if (c?.status !== '주의') return false;
  if (c?.name === '전년 비교 완전성') return true;
  if (['참고 경고', '가동률 상한 검토', '빌드 실행시간'].includes(c?.name)) return true;

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
      if (grade === '정상' && (loc === '-' || !loc) && (!msg || msg === '오류 없음')) continue;
      details.push({ grade, location: loc, message: msg || loc, action });
    }
  }
  const salesCheck = checks.find(c => c.name === '매출 최신일');
  const dateMatch = salesCheck?.value?.match(/(\d{4}-\d{2}-\d{2})/);
  const salesLatestDate = dateMatch ? new Date(`${dateMatch[1]}T00:00:00`) : null;
  const cfg = Object.fromEntries(sourceSnapshot?.sheets?.cfg || []);
  const auditCurrent = ['success','complete','completed','done'].includes(cfg.dashboard_build_status) &&
    Boolean(cfg.dashboard_run_id) && cfg.dashboard_audit_run_id === cfg.dashboard_run_id &&
    String(cfg.dashboard_audit_blocking ?? '').trim() === '0';
  const nonNormalChecks = checks.filter(c => {
    if (['참고 경고','검증 경고'].includes(c.name)) return false;
    if (c.name === '차단 오류') return num(c.value) > 0;
    if (['빌드 상태','대시보드 빌드 상태'].includes(c.name) && auditCurrent) return false;
    if (c.status === '전회 결과')
      return /\[주의\]|\[위험\]|검토:|누락\s*[1-9]\d*|실패|#REF!|#VALUE!|#DIV\/0!|불일치/.test(c.value);
    return c.status && !['정상','확인','안내','완료'].includes(c.status);
  });
  const pendingChecks = nonNormalChecks.filter(isSourceCheckPending);
  const sourceCheckPending = pendingChecks.length > 0 ||
    details.some(d => isSourceCheckPending({ name:d.location, value:d.message, note:'' }));
  const actionableChecks = nonNormalChecks.filter(c => !isSourceCheckPending(c));
  const warnings = actionableChecks.filter(c => !isInformationalDataQualityCheck(c));
  details.filter(d => /차단|위험|오류/.test(d.grade)).forEach(d => {
    if (!warnings.some(c => c.value === d.message || c.name === d.location))
      warnings.push({name:d.location, status:d.grade, value:d.message, note:d.action});
  });
  return {
    checks, auditCurrent,
    warnings,
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
      return `마지막 원천 점검에 기록된 매출일: ${dateText} / 현재 수신 기준일은 핵심 요약에서 확인`;
    }
    if (c.name.startsWith('탭 오류')) {
      return `원천 시트 탭 오류: ${c.value || c.status}${c.note ? ` · ${c.note}` : ''}`;
    }
    return `원천 점검 ${c.name}: ${c.value || c.status}${c.note ? ` · ${c.note}` : ''}`;
  });
  const infoItems = (dataQuality.infos || []).map(c => {
    if (c.name === '원천별 최신일') {
      return `[정보] 마지막 원천 점검 기준일: ${c.value || c.status}${c.note ? ` / ${c.note}` : ''}`;
    }
    if (c.name === '원천 미수신 0값 보호') {
      return `[정보] 구독 결측 보호: ${c.value || c.status} / 대시보드는 미수신 월을 공란 처리하고 선택 기간의 최신 수신월 스냅샷을 사용`;
    }
    return `[정보] 원천 점검 ${c.name}: ${c.value || c.status}${c.note ? ` / ${c.note}` : ''}`;
  });
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

  setProgress(8, '공식 월별 원천 연결 중…');
  markActive('lstep-sheets');
  startSlowLoadTimer();
  await fetchDashboardSnapshot();

  const storeKeys = Object.keys(GID.stores);

  // 보조 시트는 실패해도 공식 월별 원천으로 핵심 지표 로드는 계속한다.
  // Summary 전체 범위 조회 시 Google Visualization API가 상단 수식형 문자열을
  // 생략하는 경우가 있어 핵심 요약 범위를 명시적으로 고정한다.
  const safeLoad = (...args) => loadSheet(...args).catch(() => []);
  const [summaryR, dataCheckR, couponR, factR, overallMonthlyR, opsR] = await Promise.all([
    safeLoad(GID.summary, false, 'A1:B40'),
    safeLoad(GID.dataCheck),
    safeLoad(GID.coupon),
    safeLoad(GID.factMonthly, true),
    safeLoad(GID.overallMonthly, true),
    safeLoad(GID.ops)
  ]);

  const factByStore = parseFactMonthly(factR);
  const missingStores = storeKeys.filter(key => !factByStore.has(GID.stores[key].name));
  if (missingStores.length) throw new Error('공식 월별 원천에 일부 매장이 누락되어 갱신을 보류했습니다.');
  const hasPortfolioFinance = parseOverallMonthly(overallMonthlyR).size > 0;
  const needsStoreFallback = factByStore.size < storeKeys.length;
  const needsLegacyFinance = !hasPortfolioFinance;

  markDone('lstep-sheets');
  setProgress(48, needsStoreFallback || needsLegacyFinance
    ? '보조 분석 탭으로 누락 원천 복구 중…'
    : '공식 원천 연결 완료 · 데이터 구조 확인 중…');
  markActive('lstep-stores');

  // 공식 원천이 누락된 경우에만 표시용 분석·매장 탭을 복구 경로로 조회한다.
  const [salesR, subR, mrrR, ...storeRaws] = await Promise.all([
    needsLegacyFinance ? safeLoad(GID.sales) : Promise.resolve([]),
    needsLegacyFinance ? safeLoad(GID.subs) : Promise.resolve([]),
    needsLegacyFinance ? safeLoad(GID.mrr) : Promise.resolve([]),
    ...storeKeys.map(k => needsStoreFallback
      ? safeLoad(GID.stores[k].gid)
      : Promise.resolve([]))
  ]);

  markDone('lstep-stores');
  setProgress(80, '데이터 파싱 및 집계 중…');
  markActive('lstep-render');

  const opsStores     = parseOps(opsR);
  const summaryKpis   = parseSummary(summaryR);
  const dataQuality   = parseDataQuality(dataCheckR);
  const stores        = storeKeys.map((k,i) =>
    mergeStoreWithFact(parseStore(GID.stores[k].name, storeRaws[i]), factByStore)
  );
  const legacyOverall = needsLegacyFinance ? parseOverall(salesR, subR, mrrR) : [];
  const derivedOverall = aggregatePortfolioMonths(stores);
  const financialOverall = applyPortfolioFinancials(derivedOverall, overallMonthlyR, legacyOverall);
  const overall       = applyPortfolioCouponDiscounts(financialOverall, couponR);
  if (!overall.some(m => (m.gross || 0) > 0 || (m.net || 0) > 0 || (m.usage || 0) > 0)) {
    throw new Error('공식 월별 원천과 보조 매장 탭에서 표시 가능한 데이터를 찾지 못했습니다.');
  }
  const legacyAggregateEmpty = needsLegacyFinance && legacyOverall.every(m =>
    (m.gross || 0) === 0 && (m.net || 0) === 0 && (m.usage || 0) === 0 && (m.mrr || 0) === 0
  ) && overall.some(m => (m.gross || 0) > 0 || (m.net || 0) > 0);
  const legacyAggregateMismatchMonths = needsLegacyFinance ? legacyOverall.reduce((count, legacy, i) => {
    const derived = overall[i] || {};
    // 전사 MRR은 ALL PASS를 포함하므로 매장 합계와 다른 것이 정상이다.
    const differs = ['gross','net','usage'].some(key => {
      const expected = +derived[key] || 0;
      const actual = +legacy[key] || 0;
      return Math.abs(actual - expected) > Math.max(1, Math.abs(expected) * 0.001);
    });
    return count + (differs ? 1 : 0);
  }, 0) : 0;
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

  const now = sourceSnapshot?.delivery?.mode==='cached' ? new Date(sourceSnapshot.fetchedAt) : new Date();
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
  if (sourceSnapshot?.preview) dashboard.audit.unshift('[점검보류] 로컬 검증 화면: 캡처한 시트 데이터이며 실시간 연동 결과가 아닙니다.');

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
  const totalCount     = Object.keys(GID.stores).length;
  const activeCount    = getActiveStores().length;
  const openingCount   = Math.max(0, totalCount - activeCount);
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
  const opsStores = dashboard?.opsStores || [];
  if (opsStores.length) return opsStores.filter(s => isStoreActiveForSelectedPeriod(s.name));
  return (dashboard?.stores || [])
    .filter(s => isStoreActiveForSelectedPeriod(s.name))
    .map(s => ({ name:s.name, status:'운영 중' }));
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
    agg._mrrNoSheet = Boolean(agg.hasSubscriptionData)
      && agg.mrrYoY === 0 && agg.mrrPrev === 0 && agg.mrr === 0;
    return { name:'전체 합산', months: filtered, current: agg, ops: dashboard.opsStores, isAll: true };
  }
  const s = dashboard.stores.find(x => {
    const k = Object.keys(GID.stores).find(k => GID.stores[k].name === x.name);
    return k === state.store;
  });
  if (!s) return getEntity.call({...this, store:'all'}) || null;
  const filtered = filterMonths(s.months);
  const agg = aggMonths(filtered) || {hasSalesData:false,hasUsageData:false,hasSubscriptionData:false,
    hasArpuData:false,hasArpwData:false,hasGrossYoY:false,hasMrrYoY:false,hasNetYoY:false,
    gross:null,net:null,usage:null,utilization:null,achievement:null,target:null};
  // 기간 필터 화면은 월별 원천 집계만 사용한다. 운영 시트의 현재 스냅샷으로 과거 기간을 덮어쓰지 않는다.
  if (!agg.utilizationRaw && agg.utilization > 0 && s.name && STORE_CAPACITY_RAW[s.name]) {
    const capRow = buildCapacityData({ name:s.name, isAll:false, months:filtered })[0];
    if (capRow?.capacity > 0) agg.utilizationRaw = capRow.utilization;
  }
  // 매장PASS ARPU는 실결제매출 기준이므로 MRR 역산에 사용하지 않는다.
  // _mrrNoSheet: mrr과 mrrPrev 모두 0이면 시트 미연결 상태 — 게이지에 "—" 표시
  agg._mrrNoSheet = Boolean(agg.hasSubscriptionData)
    && agg.mrrYoY === 0 && agg.mrrPrev === 0 && agg.mrr === 0;
  return { name: s.name, months: filtered, current: agg, ops: [s.ops||{}], isAll: false, storeData: s };
}

/* ── 10. GAUGE ──────────────────────────────────────────────── */
function makeGauge(wrapId, valId, subId, score, valText, subText, reference = false) {
  const wrap = $(wrapId);
  if (!wrap) return;
  const r = 80, cx = 100, cy = 105, perim = Math.PI * r;
  const s = Math.max(0, Math.min(100, score));
  const color = reference ? '#c07b48' : s >= 72 ? '#216552' : s >= 45 ? '#c07b48' : '#b24c58';
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
  const subscriptionMonths = subscriptionMonthsFor(ms);
  const lastSubscription = subscriptionMonths[subscriptionMonths.length - 1] || null;
  const prevSubscription = subscriptionMonths[subscriptionMonths.length - 2] || null;
  const hasSubscriptionData = Boolean(c.hasSubscriptionData);
  // ★ 실제 값 보존: 게이지 호(arc) 각도는 100% 기준으로 클램프하되,
  //   표시 숫자는 실제 값(>100% 가능)을 그대로 보여줌
  const achRaw  = c.achievement||0;
  const utilDisplay = usagePresentation(c);
  const utilRaw = utilDisplay.value ?? 0;
  const ach  = Math.min(100, achRaw);
  const util = Math.min(100, utilRaw);
  const churnH = hasSubscriptionData ? Math.max(0, 100 - ((c.churn||0)/12)*100) : 50;
  const hasMrrYoY = Boolean(c.hasMrrYoY);
  const mrrM = hasMrrYoY ? Math.max(0, Math.min(100, 50 + (c.mrrYoY||0))) : 50;

  // 100% 초과 시 배지 추가
  const achLabel  = c.hasSalesData===false ? '—' : achRaw > 100 ? `${fmtP(achRaw)} ★` : fmtP(achRaw);
  const utilLabel = utilRaw > 100 ? `${fmtP(utilRaw)} ↑`  : fmtP(utilRaw);

  // ★ MRR 게이지 delta: YoY율의 전월 변화(▲53.9%p)는 사용자에게 불투명 → 실제 MRR MoM 변화율로 교체
  //   게이지 face는 MRR YoY%, sub에는 "MoM MRR ▲X%" 형태로 기준 명시
  const mrrMoMPct = (lastSubscription?.status === 'confirmed' && prevSubscription?.status === 'confirmed' && prevSubscription.mrr > 0)
    ? ((lastSubscription.mrr - prevSubscription.mrr) / prevSubscription.mrr * 100) : null;
  const mrrMomContext = lastSubscription?.status === 'mtd'
    ? ` (${lastSubscription.month} MTD / ${prevSubscription?.month || '전월'} 확정)`
    : ' MoM';
  const mrrDelta = mrrMoMPct !== null
    ? ` <span style="font-size:11px;font-weight:700;color:${mrrMoMPct>=0?'#6ce8b0':'#ff8fa0'}">${mrrMoMPct>=0?'▲':'▼'}${Math.abs(mrrMoMPct).toFixed(1)}%${mrrMomContext}</span>`
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
  const arpuSub = (c.arpu||0) > 0 ? ` · 매장PASS ARPU ${fmtS(c.arpu)}` : '';

  // MRR 게이지: 개별 매장 MRR 시트 미연결 시 YoY = 0 → 값 대신 "—" 표시 (fleet proxy 오해 방지)
  const mrrValText = !hasSubscriptionData || c._mrrNoSheet
    ? '—'
    : fmtYoY(c.mrrYoY, hasMrrYoY);
  const mrrSubText = !hasSubscriptionData
    ? `${subscriptionBasisLabel(c)}${periodLabel}`
    : c._mrrNoSheet
    ? `MRR ${fmtS(c.mrr||0)}${arpuSub} · YoY 시트 미연결${periodLabel}`
    : `MRR ${fmtS(c.mrr||0)}${arpuSub}${hasMrrYoY ? mrrDelta : ' · 전년 동기 운영 이력 없음'} · ${subscriptionBasisLabel(c)}${periodLabel}`;

  // HTML의 element ID와 일치: gsvg-*, gval-*, gsub-*
  makeGauge('gsvg-ach',  'gval-ach',  'gsub-ach',
    ach, achLabel, c.hasSalesData===false ? '매출 확인 대기' : `목표 ${fmtS(c.target||0)}${achSubNet}${periodLabel}`);
  if (c.hasSalesData===false) $('gsvg-ach').innerHTML='';
  makeGauge('gsvg-util', 'gval-util', 'gsub-util',
    util, usagePresentation(c).label, c.hasUsageData === false
      ? usagePresentation(c).note
      : `총사용 ${fmtN(c.usage||0)}회 / 기간 누적 유휴 Capacity ${fmtN(idleForGauge)}회${periodLabel}`, utilDisplay.partial);
  if (utilDisplay.value == null) $('gsvg-util').innerHTML = '';
  makeGauge('gsvg-churn','gval-churn','gsub-churn',
    churnH, hasSubscriptionData ? fmtP(c.churn||0) : '—', !hasSubscriptionData
      ? `${subscriptionBasisLabel(c)}${periodLabel}`
      : ms.length > 1
        ? `기간 해지 ${fmtN(c.cancelSubs||0)}건 / 구독-월 노출 ${fmtN(c.retainedExposure||0)}건 / ${subscriptionBasisLabel(c)}${periodLabel}`
        : `해지 ${fmtN(c.cancelSubs||0)}건 / 구독-월 노출 ${fmtN(c.retainedExposure||c.retained||0)}건 / ${subscriptionBasisLabel(c)}${periodLabel}`);
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
  if (sourceSnapshot?.readiness?.held?.includes('coupon')) return '쿠폰 갱신 대기 / 최종 점검 후 반영';
  if (dashboard?.dataQuality?.sourceCheckPending) return '쿠폰 집계 미완료 · 원천 재생성 중';
  if ((c.couponSheetMonths||0) > 0) return '쿠폰 집계값 없음 · 원천 확인 필요';
  return (c.couponSourceMonths||0) > 0
    ? `실결제매출 미집계로 쿠폰할인 ${fmtS(c.unmappedCouponDiscount||0)} 산출 제외`
    : '매장별 쿠폰할인 미배분';
}

function arpuBasisLabel(c) {
  if (c?.hasArpuData === false) return '매출/구독 기준일 불일치 또는 미수신으로 산출 보류';
  return c?.arpuBasis === 'store_pass_sales_exposure'
    ? '매장PASS 실결제매출 ÷ 구독자-월 노출량'
    : '매장PASS 실결제매출 ÷ 유지 구독자';
}

const KPI_TOOLTIPS = {
  '실결제매출':  { formula:'환불 차감 전 실결제 기준 매출. 목표 달성 판단은 순매출 달성률을 우선 적용', benchmark:'실결제매출 달성률은 보조 지표' },
  '순매출':  { formula:'순매출 = 실결제매출 − 환불', benchmark:'정상가 GMV는 원천 미보유, 환불율 < 5%' },
  'MRR':    { formula:'활성 구독 기반 반복매출 런레이트. 전체는 단일 PASS+ALL PASS, 매장별은 단일 PASS 기준', benchmark:'YoY +10% 이상 = 성장 안정' },
  '가동률':  { formula:'총사용 ÷ 원천 MTD Capacity\n마감월은 월 Capacity, 미마감월은 유효 경과일 기준 MTD Capacity 사용', benchmark:'시트 기준: 70% 미만 주의. 일부 수신 잠정값은 판정 제외' },
  '이탈률':  { formula:'해지 건수 ÷ 구독자-월 노출량 × 100. 진행월은 경과일/월일수로 월환산', benchmark:'< 4% 건강 · 4~8% 경계 · > 8% 위험' },
  '순증감':  { formula:'신규 구독 − 해지 구독', benchmark:'≥ 0 구독 성장 · < 0 구독 감소' },
  'ARR':    { formula:'MRR × 12 (연간 반복 매출)', benchmark:'YoY +20% 이상 = 고성장' },
  'LTV':    { formula:'MRR ÷ 월환산 해지수 (단순 추정)', benchmark:'고객 코호트·원가를 반영하지 않은 운영용 proxy' }
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
  const hasSubscriptionData = Boolean(c.hasSubscriptionData);
  // 월별 트렌드 배열 (스파크라인용)
  const grossTrend = ms.map(m=>m.gross);
  const netTrend   = ms.map(m=>m.net);
  const mrrTrend   = ms.map(m=>m.hasSubscriptionData === false ? null : m.mrr);
  const utilTrend  = ms.map(m=>usagePresentation(m).value);
  const churnTrend = ms.map(m=>m.hasSubscriptionData === false ? null : m.churn);
  const addsTrend  = ms.map(m=>m.hasSubscriptionData === false ? null : m.netAdds);

  // 최신 달은 MTD 월말 예상의 원천 기준으로만 사용한다.
  const lastM = ms.length ? ms[ms.length-1] : null;
  // 월말 예상 (최신 달 원천 경과일·월일수 기반) ──────────────
  const todayDay  = lastM?.elapsedDays || getMtdDay();
  const daysInMon = lastM?.daysInSourceMonth || daysInMonth(lastM?.monthNum || TODAY_MONTH, TODAY_YEAR);
  const elapsed   = Math.max(1, Math.min(todayDay, daysInMon));
  const monthProg = elapsed / daysInMon; // 0~1

  // 현재 달(마지막 달)이 진행 중이면 월말 예상 표시
  const isCurrentMonth = lastM && lastM.monthNum === TODAY_MONTH && lastM.status === 'mtd';
  const projGross  = (isCurrentMonth && lastM && monthProg > 0 && monthProg < 0.99)
    ? lastM.gross / monthProg : null;

  const kpis = [
    { label:'실결제매출',  val:fmtS(c.gross),
      delta:c.hasGrossYoY ? c.grossYoY : null,   sub:`실결제매출 달성 ${fmtP(c.grossAchievement||0)} · 순매출 달성 ${fmtP(c.achievement||0)}`,
      deltaContext:'YoY',
      prog:c.grossAchievement, color:'accent', spark:grossTrend, sparkColor:'#8f4219',
      projection: projGross ? `${lastM.month} 월말 예상 ${fmtS(projGross)}` : null },
    { label:'순매출',  val:fmtS(c.net),
      delta:c.hasNetYoY ? c.netYoY : null,     sub:`${c.hasDiscountData ? `쿠폰할인 ${fmtS(c.discountAmount||0)} · 실결제매출 대비 ${fmtP(c.discountShare||0)}${couponCoverageSuffix(c)}` : couponUnavailableLabel(c)} · 환불 ${fmtP(c.refundRate||0)}${ent.isAll && c.hasTotalNetGrowth ? ` · 안성 포함 전체 성장 ${c.totalNetGrowth>=0?'+':''}${fmtP(c.totalNetGrowth)}` : ''}`,
      deltaContext:ent.isAll ? '동일점 YoY' : 'YoY',
      color:'navy',  spark:netTrend, sparkColor:'#24344f' },
    { label:'MRR',    val:hasSubscriptionData ? fmtS(c.mrr||0) : '—',
      delta:c.hasMrrYoY ? c.mrrYoY : null,
      sub:!hasSubscriptionData
        ? subscriptionBasisLabel(c)
        : c.hasMrrYoY
          ? `MRR YoY · 전년 동기 ${fmtS(c.mrrPrev||0)}${(c.arpu||0)>0?' · 매장PASS ARPU '+fmtS(c.arpu):''} · ${subscriptionBasisLabel(c)}`
          : `MRR YoY 비교 없음 · 전년 동기 운영 이력 없음${(c.arpu||0)>0?' · 매장PASS ARPU '+fmtS(c.arpu):''} · ${subscriptionBasisLabel(c)}`,
      deltaContext:'YoY',
      color:'green', spark:mrrTrend, sparkColor:'#216552' },
    { label:'가동률',  val:usagePresentation(c).label,
      delta:null, deltaSuffix:'%p',
      sub:usagePresentation(c).note,
      color:'amber', spark:utilTrend, sparkColor:'#c07b48', sparkPartial:ms.map(m=>m.hasUsageData === false),
      projection: c.hasUsageData !== false && (c.achievement||0)>0 && (c.achievement||0)<100
        ? `목표 달성 필요 가동률: ${fmtP(Math.min(100,(usageValue(c)) / Math.max(0.01,(c.achievement||0)/100)))}` : null },
    { label:'이탈률',  val:hasSubscriptionData ? fmtP(c.churn||0) : '—',
      delta:null, deltaSuffix:'%p', invert:true,
      sub:!hasSubscriptionData ? subscriptionBasisLabel(c) : ms.length > 1
        ? `기간 해지 ${fmtN(c.cancelSubs||0)}건 / 구독-월 노출 ${fmtN(c.retainedExposure||0)}건`
        : `해지 ${fmtN(c.cancelSubs||0)}건 / 구독-월 노출 ${fmtN(c.retainedExposure||c.retained||0)}건`,
      color:'rose', spark:churnTrend, sparkColor:'#b24c58' },
    { label:'순증감',  val:hasSubscriptionData ? ((c.netAdds||0)>=0?`+${fmtN(c.netAdds)}`:fmtN(c.netAdds||0)) : '—',
      delta:null, deltaSuffix:'건', isRaw:true,
      sub:hasSubscriptionData
        ? `${ms.length > 1 ? '기간 ' : ''}신규 ${fmtN(c.newSubs||0)} / 해지 ${fmtN(c.cancelSubs||0)} · ${subscriptionBasisLabel(c)}`
        : subscriptionBasisLabel(c),
      color:'teal', spark:addsTrend, sparkColor:'#1d7a8a',
      projection: (c.netAdds||0) < 0
        ? `선택 기간 순감 ${fmtN(Math.abs(c.netAdds||0))}건` : null }
  ];
  // ★ Priority 4: 최신 달 MTD 여부로 MoM 라벨 분기
  const _kpiLastM = ms.length ? ms[ms.length-1] : null;
  const _kpiMomCtx = (_kpiLastM && (_kpiLastM.status || monthStatus(_kpiLastM.monthNum)) === 'mtd') ? '전월 확정 대비(MTD)' : 'MoM';
  $('kpiGrid').innerHTML = kpis.map(k => {
    const hasDelta = k.delta != null && !isNaN(k.delta);
    const deltaClass = hasDelta ? (k.invert ? (k.delta<=0?'up':'down') : (k.delta>=0?'up':'down')) : 'neutral';
    const suffix = k.deltaSuffix || '%';
    const absD   = Math.abs(k.delta||0);
    const deltaText = hasDelta
      ? `${(k.delta||0)>=0?'▲':'▼'} ${k.isRaw ? fmtN(absD) : absD.toFixed(1)}${suffix} ${k.deltaContext || _kpiMomCtx}`
      : '';
    const prog = k.prog != null ? `<div class="kpi-progress"><div class="kpi-bar ${k.color}" style="width:${Math.min(100,k.prog||0)}%"></div></div>` : '';
    const spark = k.spark && k.spark.length>=2 ? `<div class="kpi-spark">${sparkline(k.spark, k.sparkColor, 28, 80, k.sparkPartial)}</div>` : '';
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
  if (c.hasSalesData === false || c.achievement == null) signals.push({type:'neutral', title:'매출 확인 대기', text:'수신된 매출과 목표를 확인한 후 판정합니다.'});
  else if (ach >= 110) signals.push({type:'ok',  title:'목표 초과 달성', text:`순매출 달성률 ${fmtP(ach)} ★`});
  else if (ach >= 100) signals.push({type:'ok', title:'목표 달성',  text:`순매출 달성률 ${fmtP(ach)}`});
  else if (ach >= 80)  signals.push({type:'warn',title:'목표 근접', text:`순매출 달성률 ${fmtP(ach)} — ${fmtS(Math.max(0,(c.target||0)-(c.net||0)))} 미달`});
  else                 signals.push({type:'bad', title:'목표 미달', text:`순매출 달성률 ${fmtP(ach)} — 즉시 점검 필요`});

  // 이탈률
  const churn = c.churn||0;
  if (c.hasSubscriptionData === false || c.churn == null) signals.push({type:'neutral', title:'구독 확인 대기', text:'수신된 구독 지표를 확인한 후 판정합니다.'});
  else if (churn < 4)       signals.push({type:'ok',  title:'이탈 안정', text:`이탈률 ${fmtP(churn)} — 구독 건강`});
  else if (churn < 8)  signals.push({type:'warn', title:'이탈 주의', text:`이탈률 ${fmtP(churn)} — 리텐션 점검`});
  else                 signals.push({type:'bad',  title:'이탈 위험', text:`이탈률 ${fmtP(churn)} — 즉각 대응`});

  // FIX 4 — 가동률 시그널 (100% 초과 과부하 케이스 추가)
  const util = usageValue(c);
  if (c.hasUsageData === false || c.utilization == null) {
    signals.push({type:'neutral', title:'가동률 판정 대기', text:`${usagePresentation(c).label} / 이용량 확인 후 판정`});
  } else if (util > 100) {
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
  if (c.hasSubscriptionData === false || c.mrr == null) signals.push({type:'neutral', title:'MRR 확인 대기', text:'수신된 MRR을 확인한 후 비교합니다.'});
  else if (!c.hasMrrYoY)    signals.push({type:'warn', title:'MRR 비교 제외', text:`전년 동기 운영 이력 없음 · ${fmtS(c.mrr||0)}`});
  else if (mrrYoY >= 10) signals.push({type:'ok', title:'MRR 고성장', text:`YoY +${fmtP(mrrYoY)} · ${fmtS(c.mrr||0)}`});
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
  if (!ms.length) {
    $('headline').innerHTML='<p class="analysis-note">선택 기간에 운영 실적이 없습니다. 미운영 구간이나 미수신 자료를 0점 또는 목표 미달로 판정하지 않습니다.</p>';
    $('riskList').innerHTML='<p class="analysis-note">선택 기간 운영 자료 없음 / 위험 판정 제외</p>';
    $('focusLabel').textContent=ent.name;
    $('focusSub').textContent='선택 기간 운영 자료 없음';
    $('focusScore').style.display='none';
    return;
  }

  // ── 핵심 요약 (동적 인사이트) ──────────────────
  // ★ v3: topStore = 필터 기간 기준 집계 (ops 스냅샷 아닌 filterMonths 기반)
  const topStore = ent.isAll
    ? [...getActiveStores()]
        .map(s => { const agg = aggMonths(filterMonths(s.months)) || {}; return { name: s.name, gross: agg.gross || 0 }; })
        .sort((a,b) => b.gross - a.gross)[0]
    : null;
  const achStatus = c.hasSalesData===false ? '매출 확인 대기' : (c.achievement||0)>=100?'목표 초과 달성':(c.achievement||0)>=80?'목표 근접':'목표 미달';
  const mrrDir    = !c.hasSubscriptionData ? '원천 미수신' : !c.hasMrrYoY ? '전년 비교 제외' : (c.mrrYoY||0)>=0?'성장 중':'감소 중';
  const latestM   = ms.length ? ms[ms.length-1] : null;
  const firstM    = ms.length ? ms[0].month : '';
  const lastM_str = ms.length ? ms[ms.length-1].month : '';
  const lastPeriodLabel = latestM && (latestM.status || monthStatus(latestM.monthNum)) === 'mtd'
    ? `${lastM_str} MTD`
    : lastM_str;

  const periodRangeLabel = ms.length > 1 ? `${firstM}~${lastPeriodLabel}` : lastPeriodLabel;
  const _insActiveN = getActiveOpsStores().length;
  const summaryNotes = [];
  const contribution = c.contributionRevenue ?? c.observedContributionRevenue;
  if (contribution != null) {
    const provisional = c.contributionRevenue == null;
    summaryNotes.push(`<strong>운영기여매출 (${provisional ? '잠정 / 보조' : '보조'})</strong><span>${fmtS(contribution)} / 올패스 운영귀속 ${fmtS(c.allPassAttributedRevenue ?? c.observedAllPassAttributedRevenue)} / 환불 전 사용량 귀속 관리값${provisional ? ' / 공동 모수 일부 누락' : ''}</span>`);
  }
  if (c.salesSourceDate || c.usageSourceDate) {
    summaryNotes.push(`<strong>원천 기준일</strong><span>매출 ${c.salesSourceDate || '미수신'} / 사용 ${c.usageSourceDate || '미수신'} / 구독 ${c.subscriptionSourceDate || '미수신'}</span>`);
  }

  if (ent.isAll && topStore) {
    const topPeriodLabel = ms.length > 1 ? `${firstM}~${lastPeriodLabel} 합산` : lastPeriodLabel;
    summaryNotes.push(`<strong>최고 매출</strong><span>${topStore.name} · ${fmtS(topStore.gross)} (${topPeriodLabel})</span>`);
  }
  if (ent.isAll && c.hasNetYoY && c.hasTotalNetGrowth) {
    summaryNotes.push(`<strong>순매출 성장</strong><span>동일점 ${c.netYoY>=0?'+':''}${fmtP(c.netYoY)} · 안성 포함 전체 ${c.totalNetGrowth>=0?'+':''}${fmtP(c.totalNetGrowth)}</span>`);
  }
  if (c.subscriptionLagged) {
    summaryNotes.push(`<strong>구독 기준일</strong><span>${subscriptionBasisLabel(c)}</span>`);
  }
  if (latestM && ms.length >= 2) {
    const prev = ms[ms.length-2];
    const momGross = prev.gross>0?(latestM.gross-prev.gross)/prev.gross*100:0;
    const latestIsMTD = (latestM.status || monthStatus(latestM.monthNum)) === 'mtd';
    if (Math.abs(momGross)>0.5 && !latestIsMTD) {
      if (ms.length === 2) {
        summaryNotes.push(`<strong>매출 흐름</strong><span>${prev.month} 대비 ${latestM.month} ${momGross>=0?'+':''}${momGross.toFixed(1)}% MoM</span>`);
      }
    }
  }
  if (!summaryNotes.length) {
    summaryNotes.push(`<strong>분석 범위</strong><span>${ent.isAll ? `운영 ${_insActiveN}개 매장 합산` : `${ent.name} 단일 매장`} · ${periodRangeLabel}</span>`);
  }
  const gapValue = Math.max(0, (c.target||0) - (c.net||0));
  const overValue = Math.max(0, (c.net||0) - (c.target||0));
  const gapText = c.hasSalesData===false ? '합계 검증 후 반영' : (c.achievement||0) >= 100
    ? `목표 대비 ${fmtS(overValue)} 초과`
    : `목표까지 ${fmtS(gapValue)}`;
  const statusClass = (c.achievement||0) >= 100 ? 'good' : (c.achievement||0) >= 80 ? 'warn' : 'bad';
  $('headline').innerHTML = `
    <div class="summary-head">
      <span class="summary-period">${periodRangeLabel || '선택 기간'} · ${ent.isAll ? `운영 ${_insActiveN}개 매장` : ent.name}</span>
      <span class="summary-status ${statusClass}">${achStatus}</span>
    </div>
    <div class="summary-lead">
      <div>
        <span class="summary-lead-label">순매출</span>
        <strong>${fmtS(c.net)}</strong>
      </div>
      <span>${fmtP(c.achievement)} 달성 / ${gapText}<br>실결제매출 ${fmtS(c.gross)}</span>
    </div>
    <div class="summary-metric-grid">
      <div class="summary-metric"><span>가동률</span><strong>${usagePresentation(c).label}</strong></div>
      <div class="summary-metric"><span>이탈률</span><strong>${c.hasSubscriptionData ? fmtP(c.churn||0) : '—'}</strong></div>
      <div class="summary-metric"><span>MRR</span><strong>${c.hasSubscriptionData ? fmtS(c.mrr||0) : '—'}</strong><small>${mrrDir}</small></div>
    </div>
    <div class="summary-note-list">
      ${summaryNotes.map(note => `<div class="summary-note">${note}</div>`).join('')}
    </div>
  `;

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
  if (c.hasSalesData!==false && Number.isFinite(c.achievement) && c.achievement < 70)
    risks.push({lv:'critical', text:`순매출 달성률 부진 (${fmtP(c.achievement||0)})`,
      impact:`목표 대비 ${gap} 미달 — 수익 직결`,
      owner:`마케팅팀 · 사업운영팀`,
      action:`채널별 원인 분석 후 집중 마케팅 캠페인 실행`});
  else if (c.hasSalesData!==false && Number.isFinite(c.achievement) && c.achievement < 85)
    risks.push({lv:'warning', text:`순매출 달성률 미달 (${fmtP(c.achievement||0)})`,
      impact:`${gap} 추가 달성 필요`,
      owner:`마케팅팀`,
      action:`월말 집중 프로모션 · 신규 채널 테스트`});
  // FIX 4 — over-capacity risk
  if ((usageValue(c)) > 100) {
    risks.push({lv:'warning', text:`운영 가동률 ${fmtP(usageValue(c))} — 원천 Capacity 초과`,
      impact:`설비 과부하 · 서비스 품질 저하 위험`,
      owner:`사업운영팀 · 건축관리팀`,
      action:'Capacity 설정값 재검토 · 설비 점검 우선'});
  }
  if ((usageValue(c)) < 45)
    risks.push({lv:'critical', text:`운영 가동률 저조 (${fmtP(usageValue(c))})`,
      impact:`유휴 Capacity 기회금액 상한 증가 · 설비 유휴화`,
      owner:`사업운영팀 · 건축관리팀`,
      action:`미가동 시간대 특가 프로모션 · 기업 제휴 세차 패키지 검토`});
  else if ((usageValue(c)) < 60)
    risks.push({lv:'warning', text:`운영 가동률 주의 (${fmtP(usageValue(c))})`,
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
      </div>
      ${r.impact?`<div class="risk-impact">💥 ${r.impact}</div>`:''}
      ${r.action?`<div class="risk-action-rec">→ ${r.action}</div>`:''}
    </div>`).join('');


  // ── 포커스 패널 ──────────────────
  $('focusLabel').textContent = ent.name;
  // ★ v3: 오픈 전 제외한 운영 중 매장 수 표시
  const _focusActiveN = getActiveOpsStores().length;
  $('focusSub').textContent = ent.isAll
    ? `${ms.length}개월 합산${ms[ms.length-1]?.status === 'mtd' ? ' · 최신월 MTD' : ''} · 운영 ${_focusActiveN}개 매장`
    : `${ms.length}개월 추적 중${ms[ms.length-1]?.status === 'mtd' ? ' · 최신월 MTD' : ''}`;

  if (!ent.isAll) {
    const review = buildScoreReview(ent);
    const sc = review.rows.find(row=>row.name===ent.name)?.score;
    const scores = review.rows.map(row=>row.score).filter(Number.isFinite);
    const rank = scores.indexOf(sc)+1;
    $('focusScore').style.display = Number.isFinite(sc) ? 'flex' : 'none';
    $('scoreBadgeVal').textContent = Number.isFinite(sc) ? `${sc}점` : '—';
    $('scoreBadgeVal').style.color = sc>=70?'#6cffb6':sc>=50?'#ffd080':'#ff8a9e';
    $('scoreBadgeRank').textContent = `${review.complete?'':'부분 비교 / '}${rank}위 / ${scores.length}개 매장 / 공통 ${review.common.length}/6개 지표`;
  } else {
    $('focusScore').style.display = 'none';
  }
}

function usageValue(c) { return c.hasUsageData === false || !Number.isFinite(c.utilization) ? NaN : c.utilization; }

// Reference values remain separate from official KPIs, comparisons and rankings.
function usagePresentation(c) {
  const partial = c.hasUsageData === false;
  const reference = partial && c.observedUsage != null && c.mtdCapacity > 0
    ? c.observedUsage / c.mtdCapacity * 100 : null;
  return {
    partial, reference, value:partial ? reference : c.utilization ?? null,
    label:partial ? (reference == null ? '—' : `잠정 ${fmtP(reference)}`) : Number.isFinite(c.utilization) ? fmtP(c.utilization) : '—',
    note:partial
      ? reference == null ? '이용량 자료 확인 중' : `관측 ${fmtN(c.observedUsage)}회 / ${fmtN(c.usageMissingDays)}점포일 누락`
      : Number.isFinite(c.usage) ? `${fmtN(c.usage)}회 사용` : '선택 기간 사용 자료 없음'
  };
}

function utilizationDataset(months) {
  const points = months.map(usagePresentation);
  const provisionalSegment = ctx => points[ctx.p0DataIndex]?.partial || points[ctx.p1DataIndex]?.partial;
  return {
    type:'line', label:points.some(p=>p.partial && p.value != null) ? '가동률 % (잠정: 점선)' : '가동률 %',
    data:points.map(p=>p.value), borderColor:PALETTE.green, borderWidth:2.5,
    pointRadius:4, pointStyle:points.map(p=>p.partial ? 'triangle' : 'circle'),
    pointBackgroundColor:points.map(p=>p.partial ? PALETTE.amber : PALETTE.green),
    pointBorderColor:points.map(p=>p.partial ? PALETTE.amber : PALETTE.green),
    segment:{borderColor:ctx=>provisionalSegment(ctx) ? PALETTE.amber : PALETTE.green,
      borderDash:ctx=>provisionalSegment(ctx) ? [5,4] : []},
    fill:false, tension:0.25, spanGaps:false
  };
}

const SCORE_DIMENSIONS = [
  {key:'achievement',label:'순매출달성률',available:c=>c.hasSalesData!==false,score:v=>v},
  {key:'utilization',label:'가동률',available:c=>c.hasUsageData!==false,score:v=>v},
  {key:'churn',label:'이탈건전성',available:c=>c.hasSubscriptionData!==false && c.subscriptionFlowComplete!==false,score:v=>100-v*5},
  {key:'refundRate',label:'환불건전성',available:c=>c.hasSalesData!==false,score:v=>100-v*3},
  {key:'mrrYoY',label:'MRR성장',available:c=>c.hasSubscriptionData!==false && c.hasMrrYoY===true,score:v=>50+v},
  {key:'grossYoY',label:'매출성장',available:c=>c.hasSalesData!==false && c.hasGrossYoY===true,score:v=>50+v}
];
function scoreComponents(current) {
  return SCORE_DIMENSIONS.map(dimension=>({
    ...dimension,value:dimension.available(current) && Number.isFinite(current[dimension.key])
      ? Math.max(0,Math.min(100,dimension.score(current[dimension.key]))) : null
  }));
}
function computeScore(current) {
  const values=scoreComponents(current).map(row=>row.value);
  return values.every(Number.isFinite) ? Math.round(values.reduce((sum,value)=>sum+value,0)/values.length) : null;
}
function buildScoreReview(ent) {
  const rows=getActiveStores().map(store=>({
    name:store.name,current:aggMonths(filterMonths(store.months))||{}
  })).filter(row=>filterMonths((dashboard.stores.find(store=>store.name===row.name)||{}).months||[]).length);
  rows.forEach(row=>{row.components=scoreComponents(row.current);});
  const common=SCORE_DIMENSIONS.map((dimension,index)=>index)
    .filter(index=>rows.length && rows.every(row=>row.components[index].value!=null));
  rows.forEach(row=>{row.score=common.length
    ? Math.round(common.reduce((sum,index)=>sum+row.components[index].value,0)/common.length) : null;});
  rows.sort((a,b)=>(b.score ?? -1)-(a.score ?? -1)||a.name.localeCompare(b.name,'ko'));
  return {rows,common,complete:common.length===SCORE_DIMENSIONS.length};
}
function buildHealthReview(ent) {
  const rows=getActiveStores().map(store=>scoreComponents(aggMonths(filterMonths(store.months))||{}));
  const selected=scoreComponents(ent.current);
  const axes=SCORE_DIMENSIONS.map((dimension,index)=>{
    const received=rows.map(row=>row[index].value).filter(Number.isFinite);
    return {...dimension,value:selected[index].value,count:received.length,total:rows.length,
      average:received.length ? received.reduce((sum,value)=>sum+value,0)/received.length : null};
  });
  return {axes};
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
        { type:'line', label:'순매출 달성률 %', data:ms.map(m=>m.hasSalesData===false ? null : m.achievement ?? null),
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
  const review=buildScoreReview(ent);
  const health=buildHealthReview(ent);
  const color=review.complete ? 'rgba(33,101,82,.75)' : 'rgba(192,123,72,.75)';
  const commonLabels=review.common.map(index=>SCORE_DIMENSIONS[index].label).join(' / ');
  if (ent.isAll) {
    mkChart('scoreChart',{
      type:'bar',data:{labels:review.rows.map(row=>row.name),datasets:[{
        label:review.complete?'운영 스코어':'공통 확인 지표 스코어 (부분 비교)',
        data:review.rows.map(row=>row.score),backgroundColor:color,borderRadius:8,borderSkipped:false
      }]},
      options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.raw==null?'산출 불가':
          ` ${ctx.raw}점 / 공통 ${review.common.length}/6개 확인 지표`}},
          datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]!=null,anchor:'end',align:'end',
            formatter:value=>value==null?'':`${value}점`,font:{weight:700}}},
        scales:{x:{min:0,max:100,grid:{color:'#f0ebe3'}},y:{grid:{display:false}}}}
    });
    $('scoreTitle').textContent='매장별 운영 스코어';
  } else {
    mkChart('scoreChart',{
      type:'bar',data:{labels:health.axes.map(axis=>axis.label),datasets:[
        {label:ent.name,data:health.axes.map(axis=>axis.value),backgroundColor:'rgba(143,66,25,.75)',borderRadius:5},
        {label:'확인 매장 평균',data:health.axes.map(axis=>axis.average),backgroundColor:'rgba(36,52,79,.25)',borderRadius:5}
      ]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'top',labels:{boxWidth:10}},
          tooltip:{callbacks:{afterLabel:ctx=>ctx.datasetIndex===1
            ? `확인 ${health.axes[ctx.dataIndex].count}/${health.axes[ctx.dataIndex].total}개 매장` : ''}},
          datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]!=null,anchor:'end',align:'end',
            formatter:value=>value==null?'':Math.round(value),font:{size:11,weight:600}}},
        scales:{y:{min:0,max:100,grid:{color:'#f0ebe3'}},x:{grid:{display:false}}}}
    });
    $('scoreTitle').textContent=`${ent.name} 운영 레버 스코어`;
  }
  if ($('scoreSub')) $('scoreSub').textContent=ent.isAll
    ? `공통 ${review.common.length}/6개 지표 동일 가중 평균${review.complete?'':' (부분 비교)'} / ${commonLabels||'공통 확인 지표 없음'}`
    : '지표별 확인 값과 확인 매장 평균 / 미수신 축은 공란';
  if ($('scoreNote')) $('scoreNote').textContent='관리용 0~100점 환산입니다. 달성률과 가동률은 최대 100점, 이탈은 100−이탈률×5, 환불은 100−환불율×3, 성장은 50+YoY를 0~100점 범위로 표시합니다. 부분 스코어는 전체 6개 지표 종합 점수가 아니며 다른 기간의 점수와 직접 비교하지 않습니다.';
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
        { type:'line', label:'순증감 (구독 수신월)', data:ms.map(m=>m.netAdds),
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
  // Match the source definition's utilization warning threshold.
  const refLinePlugin = {
    id: 'opsUtilRefLine',
    afterDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales.y) return;
      const yPx = scales.y.getPixelForValue(70);
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
      ctx.fillText('주의 기준 70%', chartArea.right - 2, yPx - 3);
      ctx.restore();
    }
  };
  mkChart('opsUtilChart', {
    plugins: [refLinePlugin],   // ← Chart.js 4: 인라인 플러그인 배열
    data:{
      labels: ms.map(m=>chartMonthLabel(m)),
      datasets:[utilizationDataset(ms)]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:true, labels:{boxWidth:10} }, tooltip:TTdefaults },
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

  function utilColor(v) {
    return v >= 70 ? 'var(--green)' : 'var(--rose)';
  }
  function utilBg(v) {
    return v >= 70 ? '#e8f5f0' : '#fce8ea';
  }

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">월</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--green);font-size:10.5px">가동률</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--muted);font-size:10.5px">vs 기준</th>
          <th style="text-align:right;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">판정</th>
        </tr>
      </thead>
      <tbody>
        ${ms.map(m => {
          if (m.hasUsageData === false) return `<tr class="reference-row"><td>${esc(m.month)}</td><td>${usagePresentation(m).label}</td><td>—</td><td>${usagePresentation(m).value == null ? '확인 필요' : '잠정'}</td></tr>`;
          const u    = m.utilization || 0;
          const diff = (u - 70).toFixed(1);
          const sign = diff >= 0 ? '+' : '';
          const verdict = u >= 70 ? '정상' : '주의';
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
            <span style="color:var(--rose);font-weight:600">주의 &lt;70%</span> /
            <span style="color:var(--green);font-weight:600">정상 ≥70%</span>
            (시트 정의 기준, 잠정값 판정 제외)
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
        { type:'line', label:'이탈률 %', data:ms.map(m=>m.hasSubscriptionData === false ? null : m.churn),
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
          const hasSubscriptionData = m.hasSubscriptionData !== false;
          const c = hasSubscriptionData ? (m.churn || 0) : null;
          const r = m.refundRate || 0;
          const riskLevel = hasSubscriptionData
            ? ((c > 10 || r > 5) ? '🔴 집중관리' : (c > 6 || r > 3) ? '🔶 주의' : '✅ 양호')
            : (r > 5 ? '🔴 환불 집중관리' : r > 3 ? '🔶 환불 주의' : '구독 원천 미수신');
          return `<tr style="border-bottom:1px solid var(--bg2)">
            <td style="padding:4px 0;font-weight:700;color:var(--text-2)">${m.month}</td>
            <td style="padding:4px 6px;text-align:right;font-weight:700;color:${hasSubscriptionData ? churnColor(c) : 'var(--muted)'};background:${hasSubscriptionData ? churnBg(c) : 'var(--surface-soft)'};border-radius:4px">${hasSubscriptionData ? `${c.toFixed(1)}%` : '미수신'}</td>
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
  const couponHeld = sourceSnapshot?.readiness?.held?.includes('coupon');
  if (arpuArt) {
    const h2 = arpuArt.querySelector('h2');
    const sub = arpuArt.querySelector('.sub');
    if (h2) h2.textContent = hasDiscountData ? '③ 쿠폰할인·매장PASS ARPU 수익성' : `③ 매장PASS ARPU 수익성 · ${hasCouponSourceData ? '지정 쿠폰 비중 산출 제외' : hasCouponSheetRows ? '쿠폰 집계값 없음' : '매장별 쿠폰할인 미배분'}`;
    if (sub) sub.textContent = hasDiscountData ? '실결제매출 대비 지정 쿠폰 할인액 비율(%) · 구독자-월 노출 기준 ARPU(원)' : `매장PASS ARPU 월별 추이 · ${dashboard?.dataQuality?.sourceCheckPending ? '쿠폰 집계 미완료' : hasCouponSourceData ? '실결제매출 미집계' : hasCouponSheetRows ? '쿠폰 원천/집계 산식 확인 필요' : '쿠폰 원천에 매장 ID 없음'}`;
    if (couponHeld) {
      if (h2) h2.textContent='③ 매장PASS ARPU 수익성 / 쿠폰 갱신 대기';
      if (sub) sub.textContent='매장PASS ARPU 월별 추이 / 쿠폰은 최종 점검 후 반영';
    }
  }
  mkChart('opsArpuChart', {
    data:{
      labels: ms.map(m=>chartMonthLabel(m)),
      datasets:[
        ...(hasDiscountData ? [{ type:'bar', label:'지정 쿠폰 비중 %', data:ms.map(m=>m.hasDiscountData ? (m.discountShare||0) : null),
          backgroundColor:makeGrad(null,90,63,140,.55,.2),
          borderColor:PALETTE.violet, borderWidth:0, borderRadius:4, yAxisID:'pct' }] : []),
        { type:'line', label:'매장PASS ARPU (원)', data:ms.map(m=>m.hasSubscriptionData === false ? null : m.arpu),
          borderColor:PALETTE.navy, borderWidth:2.5, pointRadius:4,
          fill:false, tension:0.4, yAxisID:'arpu' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10,padding:10,font:{size:11}}}, tooltip:TTdefaults },
      scales:{
        pct:{ display:hasDiscountData, position:'left', ticks:{callback:v=>`${v.toFixed(1)}%`, font:{size:10}}, grid:{color:'#f0ebe3'}, min:0 },
        arpu:{ position:hasDiscountData ? 'right' : 'left', ticks:{callback:v=>`${(v/10000).toFixed(1)}만`, font:{size:10}}, grid:{display:!hasDiscountData,color:'#f0ebe3'} },
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

  const couponNote = sourceSnapshot?.readiness?.held?.includes('coupon') ? '쿠폰 갱신 대기 / 최종 점검 후 반영'
    : dashboard?.dataQuality?.sourceCheckPending ? '쿠폰 집계 미완료'
    : hasCouponSourceData ? '실결제매출 미집계로 지정 쿠폰 비중 산출 제외'
    : hasCouponSheetRows ? '쿠폰 집계값 없음 / 원천 확인 필요' : '쿠폰 원천에 매장 ID 없음';

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">월</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--violet,#5a3f8c);font-size:10.5px">지정 쿠폰 비중</th>
          <th style="text-align:right;padding:3px 6px;font-weight:600;color:var(--navy,#24344f);font-size:10.5px">매장PASS ARPU</th>
          <th style="text-align:right;padding:3px 0;font-weight:600;color:var(--muted);font-size:10.5px">vs 평균</th>
        </tr>
      </thead>
      <tbody>
        ${ms.map(m => {
          const d    = m.discountShare || 0;
          const hasSubscriptionData = m.hasSubscriptionData !== false && m.hasArpuData !== false;
          const arpu = hasSubscriptionData ? (m.arpu || 0) : null;
          const diff = hasSubscriptionData && arpuAvg > 0 ? ((arpu - arpuAvg) / arpuAvg * 100) : null;
          const sign = diff !== null && diff >= 0 ? '+' : '';
          const dColor = d <= 10 ? 'var(--green)' : d <= 20 ? 'var(--amber)' : 'var(--rose)';
          return `<tr style="border-bottom:1px solid var(--bg2)">
            <td style="padding:4px 0;font-weight:700;color:var(--text-2)">${m.month}</td>
            <td style="padding:4px 6px;text-align:right;color:${m.hasDiscountData ? dColor : 'var(--muted)'}">${m.hasDiscountData ? `${d.toFixed(1)}%` : (m.hasCouponSourceData ? '산출 제외' : m.couponSheetPresent ? '집계 없음' : '—')}</td>
            <td style="padding:4px 6px;text-align:right;font-weight:700;color:${hasSubscriptionData ? 'var(--text)' : 'var(--muted)'}">${hasSubscriptionData ? fmtS(arpu) : m.hasSubscriptionData === false ? '미수신' : '기준일 불일치'}</td>
            <td style="padding:4px 0;text-align:right;color:${diff === null ? 'var(--muted)' : diff >= 0 ? 'var(--green)' : 'var(--rose)'};">${diff === null ? '—' : `${sign}${diff.toFixed(1)}%`}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="font-size:10.5px;color:var(--muted);margin-top:6px">평균 매장PASS ARPU ${fmtS(Math.round(arpuAvg))} 기준 / ${hasDiscountData ? '지정 쿠폰 할인비중은 실결제매출 대비' : couponNote}</div>`;
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
        { type:'bar', label:'MRR', data:ms.map(m=>m.hasSubscriptionData === false ? null : m.mrr),
          backgroundColor:makeGrad(null,143,66,25,.65,.3),
          borderColor:PALETTE.accent, borderWidth:0, borderRadius:5, yAxisID:'val' },
        { type:'line', label:subscriberLabel, data:ms.map(m=>m.hasSubscriptionData === false ? null : (m.mrrSubscribers ?? m.retained ?? 0)),
          borderColor:PALETTE.teal, borderWidth:2.5, pointRadius:4,
          pointBackgroundColor:PALETTE.teal,
          fill:false, tension:0.4, yAxisID:'subs' },
        { type:'line', label:'MRR YoY %', data:ms.map(m=>m.hasMrrYoY ? m.mrrYoY : null),
          borderColor:PALETTE.navy, borderWidth:1.5, pointRadius:2,
          borderDash:[5,3], fill:false, tension:0.4, yAxisID:'pct' }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10,padding:12}}, tooltip:TTdefaults },
      scales:{
        val:{ position:'left', ticks:{callback:fmtA}, grid:{color:'#f0ebe3'} },
        subs:{ position:'right', ticks:{callback:v=>`${Math.round(v)}건`}, grid:{display:false} },
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
    if (sub) sub.textContent = `${includesAllPass
      ? 'MRR (막대) / 전체 활성 구독자(매장PASS+ALL PASS, 선), 동일 전사 범위'
      : 'MRR (막대) / 유지 구독자 수 (선), 매장PASS 범위'} / ${subscriptionBasisLabel(ent.current)}`;
  }
}

// [Change 3] renderBridgeChart: store-aware — ent.current는 getEntity()에서
//   단일 매장 선택 시 해당 매장 필터된 월 집계값 사용. isAll=false이면 매장별 데이터.
function renderBridgeChart(ent) {
  const c = ent.current;
  const gross = c.gross || 0;
  const refund = c.refundAmount || 0;
  const net = c.net || 0;
  mkChart('bridgeChart', {
    type:'bar',
    data:{ labels:['실결제매출','환불 차감','순매출'], datasets:[{
      label:'금액', data:[[0,gross],[net,gross],[0,net]],
      backgroundColor:['#24344f','#b24c58','#216552'], borderRadius:4
    }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{
        label:ctx => fmtW([gross,refund,net][ctx.dataIndex])
      }} },
      scales:{y:{beginAtZero:true,ticks:{callback:fmtA}},x:{grid:{display:false}}}
    }
  });
  $('bridgeTitle').textContent = ent.isAll ? '포트폴리오 수익 브릿지' : ent.name + ' 수익 브릿지';
  const sub = document.querySelector('#bridgeTitle + .sub');
  if (sub) sub.textContent = '실결제매출 → 환불 차감 → 순매출. 정상가 원천이 없어 할인 전 매출은 산출하지 않습니다. 지정 쿠폰 할인액은 별도 참고값입니다.';
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
  const review=buildHealthReview(ent),axes=review.axes;
  const selected=axes.map(axis=>axis.value),average=axes.map(axis=>axis.average);
  mkChart('healthChart',{
    type:'radar',data:{labels:axes.map(axis=>axis.label),datasets:[
      {label:ent.isAll?'포트폴리오 합산':ent.name,data:selected,borderColor:PALETTE.accent,
        backgroundColor:'rgba(143,66,25,.10)',borderWidth:2.5,pointRadius:4,
        pointBackgroundColor:PALETTE.accent,fill:selected.every(Number.isFinite),spanGaps:false},
      {label:'확인 매장 평균',data:average,borderColor:PALETTE.navy,
        backgroundColor:'rgba(36,52,79,.06)',borderWidth:1.5,pointRadius:3,borderDash:[4,3],
        fill:average.every(Number.isFinite),spanGaps:false}
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{boxWidth:10}},
        tooltip:{callbacks:{afterLabel:ctx=>ctx.datasetIndex===1
          ? `확인 ${axes[ctx.dataIndex].count}/${axes[ctx.dataIndex].total}개 매장` : ''}}},
      scales:{r:{min:0,max:100,grid:{color:'#f0ebe3'},ticks:{stepSize:25,backdropColor:'transparent'}}}}
  });
  $('healthSub').textContent=`${ent.isAll?'포트폴리오 합산':ent.name} vs 지표별 확인 매장 평균 / 미수신 축은 연결하지 않음`;
  if ($('healthNote')) $('healthNote').textContent=axes.map(axis=>
    `${axis.label} 평균 ${axis.count}/${axis.total}개 매장${axis.value==null?' / 선택 값 미확인':''}`).join(' / ');
}

function renderQuarterChart(ent) {
  const source = ent.months;
  const agg = ms => aggMonths(ms)||{};
  const visibleQuarters = QUARTERS.filter(q =>
    source.some(m => m.quarter === q)
  );
  const chartQuarters = visibleQuarters;
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
  mkChart('quarterChart', {
    type:'bar',
    data:{
      labels:chartQuarters.map(q=>`${q} 누적`),
      datasets:[
        { label:'실결제매출', data:quarterAggs.map(q=>q.gross ?? null), backgroundColor:chartQuarters.map((_,i)=>colors[i % colors.length]), borderRadius:6 },
        { label:'순매출', data:quarterAggs.map(q=>q.net ?? null), backgroundColor:chartQuarters.map((_,i)=>netColors[i % netColors.length]), borderRadius:6 },
        { type:'line', label:'순증감 (건, 우측)', yAxisID:'subscriptions',
          data:quarterAggs.map(q=>q.hasSubscriptionData === false ? null : q.netAdds ?? null),
          borderColor:PALETTE.amber, backgroundColor:PALETTE.amber, borderWidth:2,
          pointRadius:4, fill:false, tension:0.2 }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'top',labels:{boxWidth:10}},
        tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.dataset.yAxisID === 'subscriptions' ? fmtN(ctx.parsed.y)+'건' : fmtS(ctx.parsed.y)}`}} },
      scales:{ y:{ticks:{callback:fmtA},grid:{color:'#f0ebe3'},beginAtZero:true},
        subscriptions:{position:'right',ticks:{callback:v=>fmtN(v)+'건'},grid:{drawOnChartArea:false},beginAtZero:true},
        x:{grid:{display:false}} }
    }
  });
  if ($('quarterSub')) $('quarterSub').textContent='선택 기간에 포함된 분기별 누적 매출 및 순증감 / 진행월은 MTD';
}

function renderScatterChart(ent) {
  // 포지션 맵은 확정월 기준을 우선한다. MTD를 섞으면 4·5월 마감 성과가 6월 초 부분 실적으로 희석된다.
  // 선택 기간에 확정월이 없을 때만 MTD를 대체 사용한다.
  const selectedPeriodMonths = months => {
    const base = months.filter(m =>
      periodMatchesMonth(state.quarter, m) && m.gross > 0 && m.target > 0 && m.hasSubscriptionData !== false && m.hasArpuData !== false
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
    ? `${positionMonths[0]}월~${positionMonths[positionMonths.length-1]}월 매출/구독 공통 수신 기준`
    : `${state.quarter === 'all' ? '선택 기간' : state.quarter} 매출/구독 공통 수신월 없음`;
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
          display:ctx=>ctx.dataset.label === selName ? true : 'auto', anchor:'center', clamp:true, clip:false, offset:5,
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
        { type:'line', label:'순매출 달성률 %', data:ms.map(m=>m.hasSalesData === false ? null : m.achievement ?? null),
          borderColor:PALETTE.accent, borderWidth:2.5, pointRadius:4,
          fill:true, backgroundColor:makeGrad(null,143,66,25,.13,0), tension:0.4 },
        utilizationDataset(ms),
        { type:'line', label:'이탈률 %', data:ms.map(m=>m.hasSubscriptionData === false ? null : m.churn ?? null),
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
    if (sub) sub.textContent = '순매출 달성률 / 가동률 / 이탈률. 가동률 점선은 일부 수신 잠정값';
  }
}

function renderMixChart(ent) {
  const c = ent.current;
  const gross    = Math.max(0, c.gross||0);
  const discount = c.hasDiscountData ? Math.max(0, c.discountAmount||0) : 0;
  const refund   = Math.max(0, c.refundAmount || gross*((c.refundRate||0)/100));
  const net      = Math.max(0, c.net||0);
  const other    = Math.max(0, gross - refund - net);

  const rawData  = [net, refund, other];
  const total    = rawData.reduce((a,b)=>a+b,0);
  const MIN_SHOW = 0.05; // 5% 미만 슬라이스 레이블 숨김 (겹침 방지)

  mkChart('mixChart', {
    type:'doughnut',
    data:{
      labels:['순매출','환불금액','기타차감'],
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
    ? `실결제매출 대비 순매출 ${((net/total)*100).toFixed(1)}% / 환불 ${fmtS(refund)}. 지정 쿠폰 할인액은 이미 반영된 금액이므로 구성비에 더하지 않습니다.`
    : `실결제매출 ${fmtS(gross)} 기준 수익 구조`;
}

/* ── 15-A. 히어로 KPI 스트립 + 메타 바 ─────────────────────────── */
function renderHeroKpis(ent) {
  const c = ent.current;
  const el = $('heroKpiStrip');
  if (!el) return;
  const hasSubscriptionData = Boolean(c.hasSubscriptionData);
  const items = [
    { label:'실결제매출', val: fmtS(c.gross), note: c.hasSalesData===false ? '매출 확인 대기' : `실결제매출 달성 ${fmtP(c.grossAchievement)}`, good: c.hasSalesData===false ? null : (c.grossAchievement||0)>=100 },
    { label:'MRR',   val: hasSubscriptionData ? fmtS(c.mrr||0) : '—', note: hasSubscriptionData ? `MRR YoY ${fmtYoY(c.mrrYoY, c.hasMrrYoY)} / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c), good: c.hasMrrYoY ? (c.mrrYoY||0)>=0 : null },
    { label:'가동률', val:usagePresentation(c).label, note:usagePresentation(c).note, good:c.hasUsageData === false ? null : c.utilization>=70 },
    { label:'이탈률', val: hasSubscriptionData ? fmtP(c.churn||0) : '—', note: hasSubscriptionData ? `해지 ${fmtN(c.cancelSubs||0)}건 / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c), good: hasSubscriptionData ? (c.churn||0)<8 : null, invert:true },
    { label:'순증감', val: hasSubscriptionData ? `${(c.netAdds||0)>=0?'+':''}${fmtN(c.netAdds||0)}` : '—', note: hasSubscriptionData ? `신규 ${fmtN(c.newSubs||0)} / 해지 ${fmtN(c.cancelSubs||0)} / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c), good: hasSubscriptionData ? (c.netAdds||0)>=0 : null },
    { label:'순매출 달성률', val: c.hasSalesData===false?'—':fmtP(c.achievement), note: c.hasSalesData===false?'선택 기간 매출 확인 대기':`순매출 ${fmtS(c.net)} / 목표 ${fmtS(c.target)}`, good: c.hasSalesData===false?null:c.achievement>=100 }
  ];
  el.innerHTML = items.map(it => {
    const color = it.good == null ? '#f4ce91' : it.good ? '#9ae6c6' : it.invert ? '#ffacb7' : '#f4ce91';
    return `<div class="hero-kpi">
      <div class="hero-kpi-label">${it.label}</div>
      <div class="hero-kpi-val" style="color:${color}">${it.val}</div>
      <div class="hero-kpi-delta">${it.note}</div>
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
  const actualSalesDate = dashboard.overall?.map(month=>month.salesSourceDate).filter(Boolean).sort().at(-1);
  const sourceDate = actualSalesDate ? new Date(`${actualSalesDate}T00:00:00`) : dashboard.dataQuality?.salesLatestDate;
  const partial = sourceSnapshot?.readiness?.mode==='partial';
  const cached = sourceSnapshot?.delivery?.mode==='cached';
  const sourcePending = partial || dashboard.dataQuality?.sourceCheckPending;
  const sourceStr = sourceDate instanceof Date && !Number.isNaN(sourceDate.getTime())
    ? sourceDate.toLocaleDateString('ko-KR', {month:'numeric', day:'numeric'})
    : sourcePending ? '점검 보류' : '확인 불가';
  const sourceAgeDays = sourceDate instanceof Date && !Number.isNaN(sourceDate.getTime())
    ? Math.max(0, Math.round((
        Date.UTC(getKstDateParts().year, getKstDateParts().month - 1, getKstDateParts().day)
        - Date.UTC(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate())
      ) / 86400000))
    : null;
  // 전일 마감 원천은 정상 SLA다. 이틀 이상 차이부터 실제 지연일로 표시한다.
  const sourceLagDays = sourceAgeDays === null ? null : Math.max(0, sourceAgeDays - 1);
  const sourceFreshness = sourceAgeDays === 0
    ? ' · 당일까지 반영'
    : sourceAgeDays === 1
      ? ' · 전일까지 반영'
      : sourceLagDays > 0 ? ` · ${sourceLagDays}일 지연` : '';
  const sourceClass = sourcePending ? 'info' : sourceLagDays !== null && sourceLagDays > 0 ? 'warn' : 'ok';

  // 분석 범위 요약
  const months    = ent.months;
  const firstM    = months.length ? months[0].month : '—';
  const lastMonthObj = months.length ? months[months.length-1] : null;
  const lastM_    = lastMonthObj
    ? `${lastMonthObj.month}${(lastMonthObj.status || monthStatus(lastMonthObj.monthNum)) === 'mtd' ? ' MTD' : ''}`
    : '—';
  const rangeStr  = months.length > 1 ? `${firstM}~${lastM_} (${months.length}개월)` : lastM_;

  // 현재 필터 상태
  // ★ v3: 운영 중 / 오픈 예정 동적 카운트
  const _activeN   = getActiveOpsStores().length;
  const _openingN  = getOpeningOpsStores().length;
  const _storeDesc = _openingN > 0
    ? `운영 ${_activeN}개 매장 합산 (+ 오픈예정 ${_openingN}개 제외)`
    : `전체 ${_activeN}개 매장 합산`;
  const storeStr  = ent.isAll ? _storeDesc : ent.name;
  const qStr      = state.quarter === 'all' ? '전체' : state.quarter;

  const auditQualityCnt = dashboard.dataQuality?.warnings?.length || 0;
  const auditClass = sourcePending || auditQualityCnt ? 'warn' : 'ok';
  const auditText = partial ? '부분 검증 / 최종 점검 대기' : sourcePending ? '원천 점검 대기'
    : auditQualityCnt ? `데이터 참고사항 ${auditQualityCnt}건` : '원천 점검 완료';

  // 연결 상태는 실제 로드 실패 여부, 데이터 최신성은 원천 매출 최신일로 별도 표시한다.
  const connectionIssue = sourceRefreshFailed || cached || _failedSheets.size > 0;
  const connClass = connectionIssue || partial || sourceSnapshot?.preview ? 'warn' : 'ok';
  const connectionText = connectionIssue ? '갱신 대기 / 마지막 확인값'
    : sourceSnapshot?.preview ? '캡처 데이터 검증 화면 / 실시간 아님'
    : partial ? '시트 갱신 중 / 확인값 우선 반영' : '시트 연결 정상';

  metaEl.innerHTML = `
    <span class="meta-pill" id="updatedAt">🕐 조회 ${loadedStr} · ${freshStr}</span>
    <span class="meta-pill">📊 ${storeStr} · ${qStr}</span>
    <span class="meta-pill">📅 ${rangeStr}</span>
    <span class="meta-pill ${connClass}" id="connectionStatus">${connectionText}</span>
    <span class="meta-pill ${sourceClass}">🗂 원천 매출 ${sourceStr}${sourceFreshness}</span>
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
  if (c.hasSalesData!==false && (c.achievement||0) < 80) alerts.push({ lvl:'danger', msg: `⚠ 순매출 달성률 ${fmtP(c.achievement)} — 목표 80% 미달. 즉각 점검 필요` });
  else if ((c.achievement||0) >= 100) alerts.push({ lvl:'success', msg: `✓ 순매출 달성률 ${fmtP(c.achievement||0)} — 목표 초과 달성` });
  if ((usageValue(c)) > 110)  alerts.push({ lvl:'info',    msg: `ℹ 가동률 ${fmtP(usageValue(c))} — 100% 초과, 설비 과부하 모니터링 권장` });
  else if ((usageValue(c)) < 50) alerts.push({ lvl:'danger', msg: `⚠ 가동률 ${fmtP(usageValue(c))} — 50% 미달, 운영 효율화 필요` });
  if ((c.churn||0) > 10)         alerts.push({ lvl:'danger',  msg: `⚠ 이탈률 ${fmtP(c.churn||0)} — 긴급 해지 방어 캠페인 검토` });
  else if ((c.churn||0) > 6)     alerts.push({ lvl:'warn',    msg: `△ 이탈률 ${fmtP(c.churn||0)} — 경계 수준, 리텐션 점검 권장` });
  if ((c.refundRate||0) > 15)    alerts.push({ lvl:'warn',    msg: `△ 환불율 ${fmtP(c.refundRate||0)} — CS 이슈 점검 필요` });

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
function sparkline(values, color='#8f4219', height=28, width=80, partial=[]) {
  const valid = value => value !== null && value !== undefined && Number.isFinite(Number(value));
  const cleanValues = (values || []).filter(valid);
  if (cleanValues.length < 2) return '';
  const min = Math.min(...cleanValues), max = Math.max(...cleanValues);
  const range = max - min || 1;
  const points = values.map((value,i)=>valid(value) ? {
    x:(i/(values.length-1)*width).toFixed(1),
    y:(height-((value-min)/range*(height-4)+2)).toFixed(1)
  } : null);
  const lines = points.map((point,i)=>point && points[i-1]
    ? `<line x1="${points[i-1].x}" y1="${points[i-1].y}" x2="${point.x}" y2="${point.y}" stroke="${color}" stroke-width="1.8"${partial[i] || partial[i-1] ? ' stroke-dasharray="3 2"' : ''}/>` : '').join('');
  const dots = points.map(point=>point ? `<circle cx="${point.x}" cy="${point.y}" r="1.8" fill="${color}"/>` : '').join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${lines}${dots}
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
    if (filtMs.some(m=>m.hasUsageData === false || m.hasArpwData === false)) {
      return { name:storeName, hasUsageData:false, capacity:null, usage:null, utilization:null,
        lossEstimate:null, idleCount:null, conservativePrice:null, confirmedLoss:null, mtdLoss:null,
        projLoss:null, confirmedIdle:null, mtdIdle:null, monthCount:filtMs.length };
    }
    const sourceMonthCap = filtMs.reduce((max, m) => Math.max(max, +m.capacity || 0), 0);
    const rawCap   = sourceMonthCap || STORE_CAPACITY_RAW[storeName] || 0;
    const monthCap = rawCap; // 하위 렌더러 호환 필드
    const mtdDay   = getMtdDay();

    const confirmedMs = filtMs.filter(m => m.status === 'confirmed');
    const confirmedCapacityMs = confirmedMs;
    const mtdM        = filtMs.find(m  => m.status === 'mtd') || null;
    const hasMtdData  = !!mtdM && Number.isFinite(mtdM.usage) && mtdM.usage >= 0;
    const opportunityRows = filtMs.map(opportunityMonth);
    const confirmedOpportunity = confirmedCapacityMs.map(opportunityMonth);
    const mtdOpportunity = mtdM ? opportunityMonth(mtdM) : null;
    const sumLoss = rows => rows.every(row=>row.ready) ? rows.reduce((sum,row)=>sum+row.loss,0) : null;
    const totalLoss = sumLoss(opportunityRows);
    const totalIdle = opportunityRows.filter(row=>row.ready).reduce((sum,row)=>sum+row.idle,0);
    const consPrice = totalLoss == null ? null : totalIdle > 0 ? totalLoss/totalIdle
      : opportunityRows.length ? opportunityRows.reduce((sum,row)=>sum+row.price*row.capacity,0)/opportunityRows.reduce((sum,row)=>sum+row.capacity,0) : null;
    const priceSource = 'monthly_source_weighted';

    // ── 확정월 집계 ─────────────────────────────────────────────
    const confirmedUsage = confirmedCapacityMs.reduce((s, m) => s + (m.usage || 0), 0);
    const confirmedDesignCap = confirmedCapacityMs.reduce(
      (s, m) => s + (+m.mtdCapacity || +m.capacity ||
        (m.utilization > 0 ? m.usage / (m.utilization / 100) : proratedCapacity(rawCap, storeName, m.monthNum))), 0
    );
    const confirmedAdjustedCap = confirmedDesignCap;
    const confirmedIdle = confirmedCapacityMs.reduce((sum,m)=>sum+Math.max(0,(m.mtdCapacity ?? m.capacity)-m.usage),0);
    const confirmedDesignUtil = confirmedDesignCap > 0 ? confirmedUsage / confirmedDesignCap * 100 : 0;
    const confirmedAdjustedUtil = confirmedAdjustedCap > 0 ? confirmedUsage / confirmedAdjustedCap * 100 : 0;
    const confirmedLoss = sumLoss(confirmedOpportunity);

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
    const mtdLoss = mtdOpportunity ? (mtdOpportunity.ready ? mtdOpportunity.loss : null) : 0;

    // ── 당월 예상 (MTD → 월말 환산) ─────────────────────────────
    const projUsage  = hasMtdData
      ? (mtdM.projectedUsage ?? (mtdActiveDays > 0 ? Math.round(mtdUsage / mtdActiveDays * mtdMonthActiveDays) : null))
      : 0;
    const projDesignCap = hasMtdData ? (+mtdM.capacity || proratedCapacity(rawCap, storeName, mtdM.monthNum)) : 0;
    const projAdjustedCap = projDesignCap;
    const projIdle   = hasMtdData ? Math.max(0, projDesignCap - projUsage) : 0;
    const projDesignUtil = projDesignCap > 0 ? projUsage / projDesignCap * 100 : 0;
    const projAdjustedUtil = projAdjustedCap > 0 ? projUsage / projAdjustedCap * 100 : 0;
    const projLoss = mtdOpportunity ? (mtdOpportunity.ready ? mtdOpportunity.projectedLoss : null) : 0;

    // ── 계절 지수 (확정월만 = 공식 계절지수) ──────────────────────
    const confirmedSeasonIdx = confirmedCapacityMs.map(m => {
      const point=seasonPoint(m);
      return {month:m.month,monthNum:m.monthNum,usage:point.usage,base:point.base,idx:point.index};
    });
    const confirmedSeasonUsage = confirmedSeasonIdx.reduce((sum,m)=>sum+(m.base>0?m.usage:0),0);
    const confirmedSeasonBase = confirmedSeasonIdx.reduce((s, m) => s + (m.base || 0), 0);
    // MTD 계절 추이 (진행률 기준 지수) / 예상 계절지수
    const mtdSeasonIdx = hasMtdData ? {
      month: mtdM.month, monthNum: mtdM.monthNum,
      usage: mtdUsage, days: mtdActiveDays, daysInMonth: mtdMonthActiveDays,
      idx_mtd: seasonPoint(mtdM).index,
      idx_proj: seasonPoint(mtdM).projectedIndex
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
    const repLoss = confirmedLoss == null || mtdLoss == null ? null : confirmedLoss + mtdLoss;
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
function selectedStoreMonths(ent) {
  return (ent.isAll ? getActiveStores().map(store=>({name:store.name,months:filterMonths(store.months)}))
    : [{name:ent.name,months:ent.months||[]}]).filter(store=>store.months.length);
}
function capacityScope(months) {
  const rows=months.map(month=>{
    const capacity=month.mtdCapacity ?? (month.status==='confirmed'?month.capacity:null);
    const full=month.hasUsageData!==false && Number.isFinite(month.usage) && month.usage>=0;
    const usage=full ? month.usage : Number.isFinite(month.observedUsage) && month.observedUsage>=0 ? month.observedUsage : null;
    return {month,capacity,usage,full,opportunity:opportunityMonth(month)};
  });
  const capacityReady=rows.every(row=>Number.isFinite(row.capacity)&&row.capacity>0);
  const received=rows.filter(row=>row.usage!=null);
  const confirmed=rows.filter(row=>row.full && Number.isFinite(row.capacity) && row.capacity>0);
  const money=rows.filter(row=>row.opportunity.ready);
  const capacity=rows.length && capacityReady ? rows.reduce((sum,row)=>sum+row.capacity,0) : null;
  const observed=received.length ? received.reduce((sum,row)=>sum+row.usage,0) : null;
  const seasonPoints=months.map(seasonPoint);
  const base=seasonPoints.reduce((sum,point)=>sum+(point.base>0&&point.progress>0?point.base*point.progress:0),0);
  return {total:rows.length,received:received.length,completeCount:confirmed.length,
    complete:rows.length>0&&confirmed.length===rows.length,capacity,observed,
    utilization:capacity>0&&received.length===rows.length ? observed/capacity*100 : null,
    idle:confirmed.length ? confirmed.reduce((sum,row)=>sum+Math.max(0,row.capacity-row.usage),0) : null,
    moneyCount:money.length,loss:money.length ? money.reduce((sum,row)=>sum+row.opportunity.loss,0) : null,
    seasonIndex:base>0&&received.length===rows.length&&seasonPoints.every(point=>point.base>0&&point.progress>0) ? observed/base : null};
}
function buildCapacityReview(ent) {
  const stores=selectedStoreMonths(ent);
  const months=stores.flatMap(store=>store.months);
  return {stores:stores.map(store=>({...store,scope:capacityScope(store.months)})),
    total:capacityScope(months),closed:capacityScope(months.filter(month=>month.status==='confirmed')),
    mtd:capacityScope(months.filter(month=>month.status==='mtd')),opportunity:buildOpportunityReview(ent)};
}
function renderCapacityPanel(ent) {
  const el=$('capacityPanel');if (!el) return;
  const review=buildCapacityReview(ent);
  const number=value=>value==null?'—':fmtN(value)+'회',money=value=>value==null?'—':fmtS(value);
  const utilization=scope=>scope.utilization==null?'—':(scope.complete?'':'잠정 ')+fmtP(scope.utilization);
  const item=(label,value,note='')=>`<div class="cap-sum-item"><div class="cap-sum-label">${label}</div><div class="cap-sum-val">${value}</div><div class="cap-sum-sub">${note}</div></div>`;
  const section=(title,scope)=>`<div class="cap-section-divider">${title} / ${scope.total}개 매장-월</div><div class="cap-summary">
    ${item('가동률',utilization(scope),'관측 사용 ÷ 기간 전체 Capacity')}
    ${item('기간 Capacity',number(scope.capacity),'누락일을 분모에서 제외하지 않음')}
    ${item('관측 사용 (수신분)',number(scope.observed),`완전 수신 ${scope.completeCount}/${scope.total}개 매장-월`)}
    ${item('유휴 Capacity (확인 구간)',number(scope.idle),`이용량 완전 수신 ${scope.completeCount}/${scope.total}개 매장-월`)}
    ${item('기회금액 상한 (확인 구간)',money(scope.loss),`금액 산출 ${scope.moneyCount}/${scope.total}개 매장-월`)}
  </div>`;
  let html='<p class="analysis-note">관측 사용량은 수신분 합계이며, 잠정 가동률은 누락을 포함한 기간 전체 Capacity로 계산합니다. 유휴 Capacity와 기회금액은 필요한 원천이 완전히 확인된 매장-월만 합산합니다.</p>';
  html+=section('선택 기간 합산',review.total);
  if (review.closed.total && review.mtd.total) html+=section('마감월',review.closed);
  if (review.mtd.total) {
    if (review.closed.total) html+=section('당월 MTD',review.mtd);
    const opportunity=review.opportunity;
    html+=`<div class="cap-basis-note">당월 월말 예상 기회금액 (참고):
      <strong>${opportunity.projectionCount?fmtS(opportunity.projectedLoss):'—'}</strong>
      / 예상 산출 ${opportunity.projectionCount}/${review.mtd.total}개 매장-월.
      MTD 산출분에 월말 예상 금액을 더하지 않습니다.</div>`;
  }
  if (!review.total.total) html+='<p class="analysis-note">선택 기간에 수신된 운영 매장-월이 없습니다. 미운영 또는 미수신을 가동률 0%로 표시하지 않습니다.</p>';
  html+='<details class="cap-details"><summary>매장별 상세 보기</summary><div class="cap-store-grid">'+
    review.stores.map(store=>{
      const scope=store.scope;
      return `<div class="cap-store-card"><div class="cap-store-head"><strong>${esc(store.name)}</strong><span>${utilization(scope)}</span></div>
        <div class="cap-store-meta">관측 사용 ${number(scope.observed)} / Capacity ${number(scope.capacity)}</div>
        <div class="cap-store-meta">유휴 Capacity (확인 구간) ${number(scope.idle)}</div>
        <div class="cap-store-meta">기회금액 (확인 구간) ${money(scope.loss)} / ${scope.moneyCount}/${scope.total}개 매장-월</div></div>`;
    }).join('')+'</div></details>';
  html+='<p class="cap-basis-note">월별 MAX(0, Capacity − 사용량) × 해당 월 손실단가를 합산합니다. 초과 가동 월은 다른 월의 유휴분을 상쇄하지 않습니다. 실제 손실이나 회수 가능한 매출이 아니며, 단가를 산출할 수 없는 구간은 제외합니다.</p>';
  el.innerHTML=html;
}

// Source baselines and elapsed days, not a fixed historical series, define the index.
function seasonPoint(month) {
  const full=month.hasUsageData!==false && Number.isFinite(month.usage);
  const usage=full ? month.usage : Number.isFinite(month.observedUsage)?month.observedUsage:null;
  const progress=month.status==='mtd' ? month.elapsedDays>0&&month.daysInSourceMonth>0
    ? month.elapsedDays/month.daysInSourceMonth : null : 1;
  const base=month.seasonBase>0 ? month.seasonBase : null;
  const index=usage!=null&&base>0&&progress>0 ? usage/(base*progress) : null;
  const forecast=full&&month.status==='mtd' ? month.projectedUsage ??
    (progress>0 ? Math.round(usage/progress) : null) : null;
  const previous=month.priorUsageApplicable===false ? null : month.hasUsagePrevData!==false&&Number.isFinite(month.usagePrev)
    ? month.usagePrev : Number.isFinite(month.observedUsagePrev) ? month.observedUsagePrev : null;
  const yoy=full&&month.hasUsagePrevData===true&&month.usageComparable!==false&&previous>0
    && month.usageSourceDate && month.usagePrevSourceDate
    && month.usageSourceDate.slice(5)===month.usagePrevSourceDate.slice(5) ? (usage/previous-1)*100 : null;
  return {usage,partial:!full,index,base,progress,previous,previousPartial:month.hasUsagePrevData===false,
    projectedIndex:forecast!=null&&base>0?forecast/base:null,yoy,status:month.status};
}
function renderSeasonChart(ent) {
  if (!$('seasonChart')) return;
  const points=ent.months.map(seasonPoint),labels=ent.months.map(chartMonthLabel);
  const line=(label,data,color,extra={})=>({type:'line',label,data,borderColor:color,borderWidth:2,
    pointRadius:4,fill:false,spanGaps:false,tension:.2,yAxisID:'idx',...extra});
  const datasets=[
      {type:'bar',label:'전년 사용 (수신분)',data:points.map(point=>point.previous),
        backgroundColor:'rgba(160,148,136,.2)',borderColor:'rgba(160,148,136,.6)',borderWidth:1,
        yAxisID:'cnt',order:3,borderRadius:3},
      {type:'bar',label:'사용 (마감월)',data:points.map(point=>point.status==='confirmed'&&!point.partial?point.usage:null),
        backgroundColor:'rgba(36,52,79,.65)',yAxisID:'cnt',order:2,borderRadius:4},
      {type:'bar',label:'사용 (MTD)',data:points.map(point=>point.status==='mtd'&&!point.partial?point.usage:null),
        backgroundColor:'rgba(36,52,79,.3)',yAxisID:'cnt',order:2,borderRadius:4},
      {type:'bar',label:'관측 사용 (일부 수신)',data:points.map(point=>point.partial?point.usage:null),
        backgroundColor:'rgba(192,123,72,.28)',borderColor:PALETTE.amber,borderWidth:1,
        yAxisID:'cnt',order:2,borderRadius:4},
      line('계절 지수 (마감월)',points.map(point=>point.status==='confirmed'&&!point.partial?point.index:null),PALETTE.accent),
      line('계절 지수 (MTD)',points.map(point=>point.status==='mtd'&&!point.partial?point.index:null),PALETTE.teal,{borderDash:[5,4],pointStyle:'triangle'}),
      line('계절 지수 (일부 수신 참고)',points.map(point=>point.partial?point.index:null),PALETTE.amber,{borderDash:[4,4],pointStyle:'triangle'}),
      line('월말 예상 계절 지수',points.map(point=>point.projectedIndex),PALETTE.navy,{borderDash:[3,3],pointStyle:'rectRot'})
    ].filter(dataset=>dataset.data.some(Number.isFinite));
  mkChart('seasonChart',{
    data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',labels:{boxWidth:10,padding:10}},
        tooltip:{callbacks:{label:ctx=>{
          const point=points[ctx.dataIndex],unit=ctx.dataset.yAxisID==='cnt'?'회':'';
          const qualifier=ctx.dataset.label.startsWith('전년') && point.previousPartial ? ' (일부 수신)' : '';
          return ` ${ctx.dataset.label}${qualifier}: ${unit?fmtN(ctx.raw):Number(ctx.raw).toFixed(3)}${unit}`;
        },afterBody:items=>{
          const point=points[items[0]?.dataIndex];
          return point ? [`원천 계절 기준선 ${point.base==null?'미확인':fmtN(point.base)+'회'}`,
            point.yoy==null?'YoY는 비교 원천 및 기준일 확인 시에만 산출':`사용 YoY ${fmtP(point.yoy)}`] : [];
        }}},datalabels:{display:false}},
      scales:{cnt:{position:'left',beginAtZero:true,ticks:{callback:fmtN},grid:{color:'#f0ebe3'}},
        idx:{position:'right',min:0,suggestedMax:1.5,grid:{drawOnChartArea:false}},x:{grid:{display:false}}}}
  });
  if ($('seasonSub')) $('seasonSub').textContent='원천 월별 계절 기준선 적용 / 마감월, MTD, 일부 수신 참고와 월말 예상 분리';
  if ($('seasonNote')) $('seasonNote').textContent='지수 1.0은 해당 월 원천 기준선 수준입니다. 일부 수신 지수는 관측 사용량 ÷ 원천 기준선(진행월은 경과율 반영)이며 완전 실적이 아닙니다. 전년 막대는 같은 월 원천 수신분으로, 미수신을 0으로 채우지 않습니다.';
}

/* ── 15-D. 구독 현황 패널 ───────────────────────────────────── */
function renderSubscriptionPipeline(ent) {
  const el = $('subPipeline');
  if (!el) return;
  const ms = subscriptionMonthsFor(ent.months);
  if (!ms.length) {
    el.innerHTML = '<div class="pipe-summary-card"><div><div class="pipe-label">구독 데이터</div><div class="pipe-main-val">원천 미수신</div></div></div>';
    return;
  }

  // 가장 최근 달 기준
  const last = ms[ms.length-1];
  const retained   = last.retained   || 0;
  const newSubs    = last.newSubs    || 0;
  const cancelSubs = last.cancelSubs || 0;
  const netAdds    = last.netAdds != null ? last.netAdds : newSubs - cancelSubs;
  const flowBase   = Math.max(newSubs, cancelSubs, Math.abs(netAdds), 1);
  const churnPct   = last.churn || 0;
  const acquisitionPct = retained > 0 ? newSubs / retained * 100 : 0;
  const flowRows = [
    { label:'월중 신규', val: newSubs, color:'#1d7a8a', note:`유지 대비 단순비율 ${fmtP(acquisitionPct)}` },
    { label:'월중 해지', val: cancelSubs, color:'#b24c58', note:`월환산 이탈률 ${fmtP(churnPct)}` },
    { label:'순증감', val: netAdds, color:netAdds===0?'#697386':netAdds>0?'#216552':'#b24c58', note:netAdds===0 ? '변동 없음' : netAdds>0 ? '신규 우위' : '해지 우위' }
  ];

  el.innerHTML = `
    <div class="pipe-summary-card">
      <div>
        <div class="pipe-label">${last.status === 'mtd' ? '기준일' : '월말'} 매장PASS 유지 구독</div>
        <div class="pipe-main-val">${fmtN(retained)}건</div>
      </div>
      <div class="pipe-summary-note">${last.subscriptionSourceDate || last.month} 수신 기준</div>
    </div>
    <div class="pipe-flow-title">월중 변동 흐름</div>
    ${flowRows.map(s => {
      const absVal = Math.abs(s.val || 0);
      const w = (absVal / flowBase * 100).toFixed(1);
      const signVal = s.label === '순증감' && s.val > 0 ? `+${fmtN(s.val)}` : fmtN(s.val);
      return `<div class="pipe-row">
        <div class="pipe-label-row">
          <span class="pipe-label">${s.label}</span>
          <span class="pipe-note">${s.note}</span>
        </div>
        <div class="pipe-bar-wrap">
          <div class="pipe-bar" style="width:${w}%;background:${s.color}88"></div>
          <span class="pipe-val" style="color:${s.color}">${signVal}건</span>
        </div>
      </div>`;
    }).join('')}
    <div class="pipe-footnote">매장PASS 유지는 수신 기준일 스냅샷, 신규/해지는 월중 발생 건수입니다. ALL PASS는 전사 MRR과 전체 활성 구독 범위에 별도 포함됩니다.</div>
  `;

  // MoM 변화 요약
  if (ms.length >= 2 && last.status === 'confirmed' && ms[ms.length-2].status === 'confirmed') {
    const prev = ms[ms.length-2];
    const delta = (last.netAdds||0) - (prev.netAdds||0);
    const trend = delta >= 0 ? `<span style="color:#216552">▲ ${delta > 0 ? '+' : ''}${fmtN(delta)}</span>` : `<span style="color:#b24c58">▼ ${fmtN(delta)}</span>`;
    el.innerHTML += `<div class="pipe-footer">순증감 ${(last.netAdds||0)>=0?'+':''}${fmtN(last.netAdds||0)}건 / 전월 대비 ${trend}</div>`;
  }
}

/* ── 15-D2. 이탈 사유 데이터 상태 ─────────────────────────────── */
function renderChurnClassification(ent) {
  const el = $('churnClassPanel');
  if (!el) return;
  const c  = ent.current;
  const ms = subscriptionMonthsFor(ent.months);
  const latest = ms.length ? ms[ms.length - 1] : null;
  if (!latest) {
    el.innerHTML = '<div class="pipe-summary-card"><div><div class="pipe-label">이탈 분석</div><div class="pipe-main-val">구독 원천 미수신</div></div></div>';
    return;
  }
  const periodCancel = c.cancelSubs || 0;
  const latestCancel = latest?.cancelSubs || 0;
  const latestChurn = latest?.churn || 0;
  const periodLabel = ms.length > 1
    ? `${ms[0].month}~${latest?.month || ''}`
    : latest?.month || '선택 기간';

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div>
        <h2 style="font-size:14px;font-weight:800;margin:0 0 3px">이탈 사유 데이터 상태</h2>
        <p class="sub" style="margin:0">확정 해지 건수와 사유 데이터 연결 여부</p>
      </div>
      <span class="section-tag" style="background:var(--rose-soft);color:var(--rose)">구독 엔진</span>
    </div>

    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--surface-soft);border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:12px">
      <div>
        <div style="font-size:12px;font-weight:900;color:var(--text);margin-bottom:3px">해지 사유 원천 미연결</div>
        <div style="font-size:11.5px;color:var(--text-2);line-height:1.55">
          현재 시트에는 자발 해지·결제 실패를 구분하는 컬럼이 없습니다.
          확인되지 않은 비율 추정은 표시하지 않으며, 아래에는 원천에서 확인되는 해지 합계만 제공합니다.
        </div>
      </div>
    </div>

    <div class="churn-status-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div style="background:var(--surface-soft);border:1px solid var(--border);border-left:3px solid var(--rose);border-radius:var(--r-md);padding:14px 16px">
        <div style="font-size:10.5px;font-weight:700;color:var(--rose);letter-spacing:.05em;margin-bottom:6px">최근월 해지</div>
        <div style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:2px">${fmtN(latestCancel)}명</div>
        <div style="font-size:11px;color:var(--muted)">${latest?.month || '최근월'} · 월환산 이탈률 ${fmtP(latestChurn)}</div>
      </div>
      <div style="background:var(--surface-soft);border:1px solid var(--border);border-left:3px solid var(--navy);border-radius:var(--r-md);padding:14px 16px">
        <div style="font-size:10.5px;font-weight:700;color:var(--navy);letter-spacing:.05em;margin-bottom:6px">선택 기간 해지 합계</div>
        <div style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:2px">${fmtN(periodCancel)}명</div>
        <div style="font-size:11px;color:var(--muted)">${periodLabel} 원천 합계</div>
      </div>
    </div>

    <div style="padding:8px 12px;background:var(--surface-soft);border:1px solid var(--border);border-radius:var(--r-sm);font-size:11px;color:var(--muted);line-height:1.6">
      <strong>필요 원천:</strong> CRM 해지 사유 코드와 PG 결제 실패 로그가 시트에 연결되면
      자발·비자발 이탈을 실제 수치로 분류할 수 있습니다.
    </div>
  `;
}

/* ── 15-E. 결제 단가 / ARPU 상세 패널 ─────────────────────────── */
function buildPaymentReview(ent) {
  const rows=Array.isArray(ent.months) ? selectedStoreMonths(ent).flatMap(store=>store.months) : [ent.current];
  const paired=rows.filter(row=>row.hasSalesData!==false&&row.hasUsageData!==false&&row.hasArpwData!==false
    && Number.isFinite(row.gross)&&Number.isFinite(row.net)&&Number.isFinite(row.usage)&&row.usage>=0);
  const usage=paired.reduce((sum,row)=>sum+row.usage,0);
  const gross=paired.reduce((sum,row)=>sum+row.gross,0),net=paired.reduce((sum,row)=>sum+row.net,0);
  const arpuRows=rows.filter(row=>row.hasSalesData!==false&&row.hasSubscriptionData!==false&&row.hasArpuData!==false
    && Number.isFinite(row.storePassRevenue)&&row.retainedExposure>0);
  const exposure=arpuRows.reduce((sum,row)=>sum+row.retainedExposure,0);
  const c=ent.current,fullArpu=c.hasSubscriptionData!==false&&c.hasArpuData!==false&&Number.isFinite(c.arpu);
  return {count:paired.length,total:rows.length,complete:rows.length>0&&paired.length===rows.length,usage,
    grossPerWash:usage>0?gross/usage:null,netPerWash:usage>0?net/usage:null,
    arpu:fullArpu?c.arpu:exposure>0?arpuRows.reduce((sum,row)=>sum+row.storePassRevenue,0)/exposure:null,
    arpuComplete:fullArpu,arpuCount:arpuRows.length};
}
function renderPaymentPanel(ent) {
  const el=$('paymentPanel');if (!el) return;
  const c=ent.current,review=buildPaymentReview(ent),money=value=>value==null?'—':fmtS(value);
  const scope=review.complete ? '선택 기간 전체' : `확인 구간 ${review.count}/${review.total}개 매장-월`;
  const last=subscriptionMonthsFor(ent.months||[]).at(-1)||c;
  const ltv=c.hasSubscriptionData!==false&&Number.isFinite(c.ltv)&&(c.ltv>0||last.cancelSubs>0) ? c.ltv : null;
  const arr=c.hasSubscriptionData!==false&&Number.isFinite(c.arr) ? c.arr : null;
  const items=[
    {label:'건당 매출',value:review.grossPerWash,note:review.grossPerWash==null?'동일 구간 매출과 사용량 또는 양수 분모 확인 필요':`${scope} / 실결제매출 ÷ 사용 ${fmtN(review.usage)}회`,color:'navy'},
    {label:'건당 순매출',value:review.netPerWash,note:review.netPerWash==null?'매출 원천과 사용 원천이 같은 구간이어야 산출 가능':`${scope} / 순매출 ÷ 사용 ${fmtN(review.usage)}회`,color:'green'},
    {label:'매장PASS ARPU',value:review.arpu,note:review.arpuComplete?`${arpuBasisLabel(c)} / ${subscriptionBasisLabel(c)}`:
      review.arpu!=null?`확인 구간 ${review.arpuCount}/${review.total}개 매장-월 / 매장PASS 매출 ÷ 구독-월 노출량`:'매장PASS 매출과 구독-월 노출량 및 기준일 확인 필요',color:'accent'},
    {label:'ARR',value:arr,note:`최신 수신 MRR × 12 / ${subscriptionBasisLabel(c)}`,color:'accent'},
    {label:'LTV (추정)',value:ltv,note:ltv==null?'MRR 또는 양수 월환산 해지수 확인 필요':'최신 수신 MRR ÷ 월환산 해지수 / 방향성 참고값',color:'navy'}
  ];
  el.innerHTML=items.map(item=>`<div class="pay-item ${item.color}"><div class="pay-label">${item.label}</div>
    <div class="pay-val">${item.label==='LTV (추정)'&&item.value!=null?fmtW(item.value):money(item.value)}</div>
    <div class="pay-note">${item.note}</div></div>`).join('');
}

/* ── 16. 히트맵 ─────────────────────────────────────────────── */
// ★ Priority 8: 기본 5개 지표 + 토글 3개 / 순위 hover 표시 / 안성 별도 행
let _hmShowExtra = false;  // 추가 지표 토글 상태

function renderHeatmap(ent) {
  // [Change 3] 히트맵은 포트폴리오 비교 목적 — 항상 전체 매장 표시 (필터 쿼터는 반영)
  const storeAgg = getActiveStores().map(s => {
    const filtMs = filterMonths(s.months);
    const agg    = aggMonths(filtMs) || {};
    const ops    = s.ops || {};
    const scope  = capacityScope(filtMs);
    const usage  = usagePresentation(agg);
    return {
      name:        s.name,
      status:      ops.status || '',
      achievement: agg.hasSalesData === false ? null : agg.achievement ?? null,
      utilization: usage.value,
      utilizationPartial: usage.partial,
      churn:       agg.hasSubscriptionData === false ? null : agg.churn ?? null,
      refundRate:  agg.hasSalesData === false ? null : agg.refundRate ?? null,
      netAdds:     agg.netAdds ?? null,
      arpu:        agg.arpu ?? null,
      gross:       agg.gross ?? null,
      monthCount:  filtMs.length,
      lossEstimate:scope.loss,
      lossEstimatePartial:scope.moneyCount<scope.total,
      lossCoverage:`금액 산출 ${scope.moneyCount}/${scope.total}개 매장-월`
    };
  });

  // ★ 오픈 전 매장 분리: 운영 매장만 히트맵 본문에, 오픈 예정은 하단 요약 행
  // Keep received zero-activity operating months in the comparison.
  const activeStores  = storeAgg.filter(s => s.status !== '오픈 전' && s.monthCount > 0);
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
    { key:'arpu',     label:'매장PASS ARPU', fmt:fmtS, inv:false },
    { key:'gross',    label:'실결제매출', fmt:fmtS,  inv:false }
  ];
  const metrics = _hmShowExtra ? [...metricsCore, ...metricsExtra] : metricsCore;

  // 열별 min/max — 운영 매장 기준 정규화
  const cols = metrics.map(m=>{
    const vals = activeStores.filter(s=>!s[m.key+'Partial']).map(s=>s[m.key]).filter(Number.isFinite);
    return vals.length ? { min:Math.min(...vals), max:Math.max(...vals) } : { min:0, max:0 };
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
        const v = s[m.key];
        if (!Number.isFinite(v)) return '<div class="hm-cell" title="원천 자료 확인 후 표시">—</div>';
        if (s[m.key+'Partial']) return `<div class="hm-cell hm-reference" title="${m.key==='lossEstimate'?s.lossCoverage:'관측 사용 ÷ 기간 전체 Capacity / 순위 제외'}"><span class="hm-cell-top">${m.key==='lossEstimate'?'부분':'잠정'} ${m.fmt(v)}</span></div>`;
        const {min,max} = cols[i];
        const norm = max>min?(v-min)/(max-min):0.5;
        const {bg,text} = cellColor(norm, m.inv);
        // ★ 항상 내림차순 정렬 — inv:true(이탈률·손실 등)에서 rank 1 = 가장 위험한 매장
        const ranked = activeStores.filter(store => !store[m.key+'Partial'] && Number.isFinite(store[m.key])).sort((a,b)=>b[m.key]-a[m.key]);
        const rank = ranked.findIndex(st=>st.name===s.name)+1;
        const rankLabel = m.inv ? `위험 ${rank}위 / ${ranked.length}개 매장` : `${rank}위 / ${ranked.length}개 매장`;
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

/* ── 17. 매장 스냅샷 ────────────────────────────────────────── */
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
    const capMetric = capMetricMap[s.name] || {};
    const utilizationRaw = capMetric.capacity > 0 ? capMetric.utilization : 0;
    return {
      name:        s.name,
      gross:       agg.gross,
      achievement: agg.achievement,
      net:         agg.net,
      usage:       agg.usage,
      utilization: agg.utilization,
      usageLabel:usagePresentation(agg).label,
      utilizationRaw,
      refundRate:  agg.refundRate,
      churn:       agg.churn,
      netAdds:     agg.netAdds,
      arpu:        agg.arpu,
      hasSalesData:agg.hasSalesData,
      hasUsageData:agg.hasUsageData,
      hasSubscriptionData:agg.hasSubscriptionData,
      subscriptionFlowComplete:agg.subscriptionFlowComplete,
      lossEstimate:capMetric.lossEstimate ?? null,
      opsStatus:   ops.status       || '—',   // 시트 원본 상태 (참고용)
    };
  });

  // ★ v3: 파생 상태 계산 함수 — 실데이터 기반 다중 조건
  // 우선 점검 매장 로직과 동일 기준 사용
  function deriveStoreStatus(s) {
    if (s.opsStatus === '오픈 전') return { text:'오픈 전', cls:'open' };
    const labels={refundRate:'환불 점검',churn:'이탈 점검',achievement:'목표 미달',utilization:'저가동'};
    const signals=operationalSignals(s);
    if (signals.length) return {text:signals.slice(0,2).map(signal=>labels[signal.key]).join(' + '),cls:'warn'};
    if (s.hasUsageData !== false && s.utilization > 105) return {text:'Capacity 검토',cls:'warn'};
    const missing=OPERATIONAL_RULES.some(rule=>!operationalMetricAvailable(s,rule));
    return missing ? {text:'일부 자료 확인 중',cls:'warn'} : {text:'정상',cls:'good'};
  }

  const rows = tableStores.map(s=>{
    const ach = s.achievement;
    // ★ Change 4: color-coded 달성률 셀
    const achBg    = ach>=100?'var(--green-soft)':ach>=80?'var(--amber-soft)':'var(--rose-soft)';
    const achColor = ach>=100?'var(--green)':ach>=80?'var(--amber)':'var(--rose)';
    const achBold  = ach < 80 ? 'font-weight:900;' : '';
    const achCell = ach == null ? '—' : `<div class="ach-wrap" style="background:${achBg}">
      <span style="color:${achColor};${achBold}">${fmtP(ach)}</span>
      <div class="ach-bar-bg"><div class="ach-bar-fill" style="width:${Math.min(100,ach)}%;background:${ach>=100?'#216552':ach>=80?'#c07b48':'#b24c58'}"></div></div>
    </div>`;

    // 원천 MTD Capacity 기준 가동률
    const util = s.utilization||0;
    const utilRaw = s.utilizationRaw||0;
    const utilCell = s.usageLabel;

    // ★ v3: 파생 상태 표시 (시트 판정 대신 실데이터 기반)
    const derivedSt = deriveStoreStatus(s);

    const selected = s.name===selName?'selected':'';
    return `<tr class="${selected}" data-store="${s.name}" role="button" tabindex="0"
      aria-label="${s.name} 매장 선택 / 순매출 달성률 ${ach == null ? '—' : fmtP(ach)} / 가동률 ${utilCell} / 이탈률 ${s.churn == null ? '—' : fmtP(s.churn)}">
      <td data-label="매장">${s.name}</td>
      <td data-label="순매출 달성률">${achCell}</td>
      <td data-label="가동률">${utilCell}</td>
      <td data-label="이탈률">${s.churn == null ? '—' : fmtP(s.churn)}</td>
      <td data-label="순증감" class="${s.netAdds == null ? '' : s.netAdds>=0?'snapshot-positive':'snapshot-negative'}">${s.netAdds == null ? '—' : (s.netAdds>=0?'+':'')+fmtN(s.netAdds)}</td>
      <td data-label="상태"><span class="verdict-chip ${derivedSt.cls}" title="원천 상태 기준: 환불율 >5%, 이탈률 >5%, 순매출 달성률 <90%, 가동률 <70%. 미수신 지표는 제외">${derivedSt.text}</span></td>
    </tr>`;
  }).join('');
  $('storeTableBody').innerHTML = rows;

  $('storeTableBody').querySelectorAll('tr').forEach(tr=>{
    const selectStore = ()=>{
      const name = tr.dataset.store;
      const key = Object.keys(GID.stores).find(k=>GID.stores[k].name===name);
      if (key) {
        state.store = key;
        $('storeSelect').value = key;
        renderAll();
        syncHash();
        setTimeout(() => $('inlineStoreDetail')?.scrollIntoView({ behavior:'smooth', block:'nearest' }), 80);
      }
    };
    tr.addEventListener('click', selectStore);
    tr.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectStore();
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
  const hasSubscriptionData = Boolean(c.hasSubscriptionData);
  const hasSalesData = c.hasSalesData !== false;
  const hasUsageData = c.hasUsageData !== false;
  const existing = $('detailDrilldown');
  if (existing) existing.remove();

  // 기본 지표 그리드
  const items = [
    { label:'실결제매출', val:hasSalesData ? fmtS(c.gross) : '—', sub:hasSalesData ? `실결제매출 달성 ${fmtP(c.grossAchievement||0)}` : '매출 자료 확인 중' },
    { label:'순매출', val:hasSalesData ? fmtS(c.net) : '—', sub:!hasSalesData ? '매출 자료 확인 중' : c.hasDiscountData ? `실결제매출−환불 · 쿠폰할인 실결제매출 대비 ${fmtP(c.discountShare||0)}${couponCoverageSuffix(c)}` : `실결제매출−환불 · ${couponUnavailableLabel(c)}` },
    { label:'MRR',      val:hasSubscriptionData ? fmtS(c.mrr||0) : '—', sub:hasSubscriptionData ? `MRR YoY ${fmtYoY(c.mrrYoY, c.hasMrrYoY)} / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c) },
    { label:'순매출 달성률', val:hasSalesData ? fmtP(c.achievement) : '—', sub:hasSalesData ? `순매출 ${fmtS(c.net||0)} / 목표 ${fmtS(c.target||0)}` : '매출 자료 확인 중' },
    { label:'운영 가동률', val:usagePresentation(c).label, sub:!hasUsageData ? usagePresentation(c).note : (()=>{
        const capAll = buildCapacityData(ent);
        const cr = ent.isAll
          ? { idleCount: capAll.reduce((s,d)=>s+(d.idleCount||0),0) }
          : (capAll[0]||{});
        return `총사용 ${fmtN(c.usage||0)}대 · 기간 누적 유휴 Capacity ${fmtN(cr.idleCount||0)}대`;
      })() },
    { label:'이탈률',   val:hasSubscriptionData ? fmtP(c.churn||0) : '—', sub:hasSubscriptionData ? `해지 ${fmtN(c.cancelSubs||0)}건 / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c) },
    (()=>{
      const dRefund   = c.refundRate||0;
      return { label:'환불율', val:hasSalesData ? fmtP(dRefund) : '—', sub:hasSalesData ? '실결제매출 기준' : '매출 자료 확인 중' };
    })(),
    { label:'순증감',   val:hasSubscriptionData ? `${(c.netAdds||0)>=0?'+':''}${fmtN(c.netAdds||0)}` : '—', sub:hasSubscriptionData ? `신규 ${fmtN(c.newSubs||0)} / 해지 ${fmtN(c.cancelSubs||0)} / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c) },
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
                      : `실결제매출 대비 · ${fmtS(c.discountAmount||0)}${couponCoverageSuffix(c)}`;
      return { label:`지정 쿠폰 비중${badge}`, val:dispVal, sub:dispSub };
    })(),
    { label:'매장PASS ARPU', val:hasSubscriptionData&&c.hasArpuData!==false?fmtS(c.arpu):'—', sub:hasSubscriptionData ? `${arpuBasisLabel(c)} / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c) },
    { label:'ARR',      val:hasSubscriptionData?fmtS(c.arr):'—', sub:`ARR YoY ${fmtYoY(c.arrYoY,c.hasMrrYoY)} (연간 반복매출)` },
    { label:'LTV(추정)', val:hasSubscriptionData&&Number.isFinite(c.ltv)&&(c.ltv>0||subscriptionMonthsFor(ms).at(-1)?.cancelSubs>0)?fmtW(c.ltv):'—', sub:`MRR ÷ 월환산 해지수` }
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
  if (ent.isAll || !hasUsageData || !hasSalesData) return;

  // 트렌드 헬퍼 (최근 2개월 변화)
  const lastM = ms.length ? ms[ms.length-1] : null;
  const prevM = ms.length >= 2 ? ms[ms.length-2] : null;
  const subscriptionTrendMonths = subscriptionMonthsFor(ms);
  const lastSubscription = subscriptionTrendMonths[subscriptionTrendMonths.length - 1] || null;
  const prevSubscription = subscriptionTrendMonths[subscriptionTrendMonths.length - 2] || null;
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
  const util = usageValue(c);
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
  if (lastM?.status === 'confirmed' && prevM?.status === 'confirmed') {
    const momGross = prevM.gross > 0 ? (lastM.gross - prevM.gross) / prevM.gross * 100 : 0;
    const momUtil  = lastM.utilization - prevM.utilization;
    trends.push({ label:'실결제매출 MoM',  val:`${momGross>=0?'+':''}${momGross.toFixed(1)}%`, good: momGross >= 0 });
    trends.push({ label:'가동률 변화', val:`${momUtil>=0?'+':''}${momUtil.toFixed(1)}%p`, good: momUtil >= 0 });
  }
  if (lastSubscription?.status === 'confirmed' && prevSubscription?.status === 'confirmed') {
    const momChurn = lastSubscription.churn - prevSubscription.churn;
    trends.push({ label:`이탈률 변화 (${lastSubscription.month})`, val:`${momChurn>=0?'+':''}${momChurn.toFixed(1)}%p`, good: momChurn <= 0, invert:true });
    trends.push({ label:`순증감 (${lastSubscription.month})`, val:`${(lastSubscription.netAdds||0)>=0?'+':''}${lastSubscription.netAdds||0}건`, good: (lastSubscription.netAdds||0) >= 0 });
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
  const wrapper = document.createElement('div');
  wrapper.id = 'detailDrilldown';
  wrapper.innerHTML = drilldownHtml;
  $('detailGrid').insertAdjacentElement('afterend', wrapper);
}

/* ── 18-B. Action Command Center ────────────────────────────── */
// Opportunity amounts use verified store-months, never a filled-in missing month.
function opportunityMonth(month) {
  const hold = reason => ({ready:false,reason});
  if (month.hasUsageData === false) return hold('이용량 일부 미수신');
  if (month.hasSalesData === false) return hold('매출 일부 미수신');
  if (month.hasArpwData === false) return hold('매출과 이용량 기준일 불일치');
  if (!['confirmed','mtd'].includes(month.status)) return hold('집계 기간 미확인');
  const capacity = month.mtdCapacity ?? (month.status === 'confirmed' ? month.capacity : null);
  if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(month.usage) || month.usage < 0)
    return hold('이용량 또는 Capacity 미확인');
  const price = Number.isFinite(month.lossUnitPrice) && month.lossUnitPrice >= 0 ? month.lossUnitPrice
    : month.usage > 0 && Number.isFinite(month.net) && month.net >= 0 ? month.net / month.usage : null;
  if (price == null) return hold('손실단가 산출 불가');
  const idle = Math.max(0,capacity-month.usage);
  const loss = idle*price;
  const differs = (value,expected) => Number.isFinite(value) && Math.abs(value-expected) > Math.max(1,Math.abs(expected)*1e-6);
  if (differs(month.idleMtd,idle) || differs(month.lossMtd,loss)) return hold('원천 기회금액 산식 불일치');
  let projectedLoss = null;
  if (month.status === 'mtd' && month.capacity > 0) {
    const projectedUsage = Number.isFinite(month.projectedUsage) && month.projectedUsage >= 0 ? month.projectedUsage
      : month.elapsedDays > 0 && month.daysInSourceMonth > 0 ? Math.round(month.usage/month.elapsedDays*month.daysInSourceMonth) : null;
    if (projectedUsage != null) {
      const calculated = Math.max(0,month.capacity-projectedUsage)*price;
      if (!differs(month.lossProjected,calculated)) projectedLoss = calculated;
    }
  }
  return {ready:true,capacity,usage:month.usage,idle,price,loss,projectedLoss,status:month.status};
}

function buildOpportunityReview(ent) {
  const selected = ent.isAll ? getActiveStores().map(store=>({name:store.name,months:filterMonths(store.months)}))
    : [{name:ent.name,months:ent.months}];
  const stores = selected.filter(store=>store.months.length).map(store=>{
    const rows = store.months.map(month=>({month,...opportunityMonth(month)}));
    const ready = rows.filter(row=>row.ready);
    const confirmed = ready.filter(row=>row.status==='confirmed');
    const mtd = ready.filter(row=>row.status==='mtd');
    const sum = (items,key) => items.reduce((total,row)=>total+row[key],0);
    return {name:store.name,totalCount:rows.length,readyCount:ready.length,excluded:rows.filter(row=>!row.ready),
      loss:sum(ready,'loss'),idle:sum(ready,'idle'),capacity:sum(ready,'capacity'),usage:sum(ready,'usage'),
      confirmedLoss:sum(confirmed,'loss'),confirmedCount:confirmed.length,mtdLoss:sum(mtd,'loss'),mtdCount:mtd.length,
      projectedLoss:sum(mtd.filter(row=>row.projectedLoss!=null),'projectedLoss'),
      projectionCount:mtd.filter(row=>row.projectedLoss!=null).length};
  });
  const total = {stores};
  for (const key of ['totalCount','readyCount','loss','idle','capacity','usage','confirmedLoss','confirmedCount',
    'mtdLoss','mtdCount','projectedLoss','projectionCount']) total[key]=stores.reduce((sum,store)=>sum+store[key],0);
  total.complete=total.totalCount>0 && total.readyCount===total.totalCount;
  return total;
}

// Source: 지표 정의 / 상태, checked 2026-10-02, gid=1792811614.
const OPERATIONAL_RULES = [
  {key:'refundRate',label:'환불율',threshold:5,high:true,source:'sales',action:'환불 사유와 서비스 품질을 점검하세요.'},
  {key:'churn',label:'이탈률',threshold:5,high:true,source:'subscription',action:'해지 사유와 구독 유지 방안을 점검하세요.'},
  {key:'achievement',label:'순매출 달성률',threshold:90,high:false,source:'sales',action:'매출 채널과 목표 차이를 점검하세요.'},
  {key:'utilization',label:'가동률',threshold:70,high:false,source:'usage',action:'수요와 유휴 시간대를 확인한 후 운영 개선을 검토하세요.'}
];
function operationalMetricAvailable(current,rule) {
  const flag = {sales:'hasSalesData',subscription:'hasSubscriptionData',usage:'hasUsageData'}[rule.source];
  return current[flag] !== false && (rule.source !== 'subscription' || current.subscriptionFlowComplete !== false)
    && Number.isFinite(current[rule.key]);
}
function operationalSignals(current,rules=OPERATIONAL_RULES) {
  return rules.filter(rule=>operationalMetricAvailable(current,rule)).flatMap(rule=>{
    const value=current[rule.key];
    if (rule.high ? value<=rule.threshold : value>=rule.threshold) return [];
    const deviation=rule.high ? value/rule.threshold-1 : 1-value/rule.threshold;
    return [{...rule,value,deviation}];
  });
}
function buildPriorityReview(ent) {
  const stores=ent.isAll ? getActiveStores().map(store=>({name:store.name,months:filterMonths(store.months)}))
    : [{name:ent.name,months:ent.months}];
  const rows=stores.filter(store=>store.months.length).map(store=>({...store,current:aggMonths(store.months)||{}}));
  const common=OPERATIONAL_RULES.filter(rule=>rows.length && rows.every(row=>operationalMetricAvailable(row.current,rule)));
  const ranked=rows.map(row=>{
    const signals=operationalSignals(row.current,common);
    return {...row,signals,deviation:Math.max(0,...signals.map(signal=>signal.deviation))};
  }).sort((a,b)=>b.signals.length-a.signals.length || b.deviation-a.deviation || a.name.localeCompare(b.name,'ko'));
  return {common,rows:ranked,comparable:common.length>0};
}

function renderActionCenter(ent) {
  const c=ent.current;
  const review=buildOpportunityReview(ent);
  const priority=buildPriorityReview(ent);
  const first=ent.months[0], last=ent.months[ent.months.length-1];
  const period=first ? `${first===last ? first.month : first.month+'~'+last.month}${last.status==='mtd'?' MTD':''}` : '선택 기간 수신 데이터 없음';
  const signals=operationalSignals(c);
  const actions=signals.map(signal=>({text:`${signal.label} ${fmtP(signal.value)} / 점검 기준 ${signal.high?'>':'<'}${signal.threshold}%`,
    action:signal.action}));
  if (c.hasSubscriptionData !== false && c.subscriptionFlowComplete !== false && Number.isFinite(c.netAdds) && c.netAdds<0)
    actions.push({text:`구독 순증감 ${fmtN(c.netAdds)}건`,action:'신규 유입과 해지 원인을 함께 점검하세요.'});
  $('acActionCount').textContent=String(actions.length);
  const missing=OPERATIONAL_RULES.filter(rule=>!operationalMetricAvailable(c,rule)).map(rule=>rule.label);
  $('acActionList').innerHTML=`<p class="ac-basis">${esc(period)} / 자동 점검 제안</p>`+
    (actions.length ? actions.map(item=>`<div class="ac-item"><span class="ac-item-dot warning"></span>
      <div class="ac-item-text"><strong>${esc(item.text)}</strong><div class="ac-recommendation">${esc(item.action)}</div></div></div>`).join('')
      : '<div class="ac-item"><div class="ac-item-text">확인된 지표에서 자동 점검 기준에 해당하는 항목은 없습니다.</div></div>')+
    (missing.length ? `<p class="ac-basis">${esc(missing.join(' / '))}은 자료 확인 전 조치 판정에서 제외합니다.</p>` : '')+
    '<details class="ac-criteria"><summary>표시 및 점검 기준</summary><p>원천 지표 정의의 상태 기준: 환불율 >5%, 이탈률 >5%, 순매출 달성률 <90%, 가동률 <70%. 필요한 원천이 확인된 지표만 사용합니다. 잠정 가동률은 판정에 사용하지 않습니다.</p><p>권장 점검이며 담당자 배정이나 실행 일정의 확정을 뜻하지 않습니다.</p><a href="https://docs.google.com/spreadsheets/d/1QasrQPOZqq3ljxCXQWnGYEy40D8jhojJRFOWkVa6uxo/edit#gid=1792811614" target="_blank" rel="noopener noreferrer">원천 지표 정의 확인</a></details>';

  const dangerTitle=document.querySelector('.ac-danger .ac-title');
  if (dangerTitle) dangerTitle.textContent=ent.isAll ? '우선 점검 매장 3곳' : `${ent.name} 운영 현황`;
  const candidates=priority.rows.filter(row=>row.signals.length);
  const shown=ent.isAll ? candidates.slice(0,3) : priority.rows;
  $('acDangerCount').textContent=priority.comparable ? String(candidates.length>3 && ent.isAll ? 3 : candidates.length) : '—';
  const basis=priority.common.map(rule=>rule.label).join(' / ');
  $('acDangerList').innerHTML=`<p class="ac-basis">${esc(period)} / ${priority.comparable ? esc(basis)+' 공통 수신 지표 기준' : '공통 비교 지표 수신 확인 중'}</p>`+
    (shown.length ? shown.map((row,index)=>{
      const key=Object.keys(GID.stores).find(key=>GID.stores[key].name===row.name);
      const values=priority.common.map(rule=>`${rule.label} ${fmtP(row.current[rule.key])}`).join(' / ');
      return `<button type="button" class="ac-danger-store" data-store="${esc(key||'')}" aria-label="${esc(row.name)} 매장 선택">
        <span class="ac-danger-rank">${index+1}</span><span class="ac-store-summary">
        <strong class="ac-danger-name">${esc(row.name)}</strong><span class="ac-danger-issues">${esc(values)}</span>
        <span class="ac-recommendation">${row.signals.length ? esc(row.signals.map(signal=>signal.label).join(' / '))+' 점검' : '수신된 지표 내 점검 기준 해당 없음'}</span></span>
        <span class="ac-danger-score">${row.signals.length}개 신호</span></button>`;
    }).join('') : `<div class="ac-item"><div class="ac-item-text">${priority.comparable ? '공통 수신 지표에서 점검 기준에 해당하는 매장이 없습니다.' : '비교 가능한 공통 지표가 없어 순위를 산정하지 않습니다. 확인 가능한 값은 매장 스냅샷에서 볼 수 있습니다.'}</div></div>`)+
    (priority.comparable && ent.isAll ? '<p class="ac-basis">점검 신호 수를 우선하며, 같은 경우 기준 이탈 폭이 큰 매장을 먼저 표시합니다. 종합 운영 점수가 아닙니다.</p>' : '');
  $('acDangerList').querySelectorAll('[data-store]').forEach(button=>button.addEventListener('click',()=>{
    if (!button.dataset.store) return;
    state.store=button.dataset.store;
    $('storeSelect').value=state.store;
    renderAll();syncHash();
  }));

  const lossTitle=document.querySelector('.ac-loss .ac-title');
  if (lossTitle) lossTitle.textContent=ent.isAll ? '누적 기회금액 상한' : `${ent.name} 누적 기회금액 상한`;
  const ready=review.readyCount>0;
  $('acLossBody').innerHTML=`<div class="ac-loss-total">${ready?fmtS(review.loss):'—'}</div>
    <p class="ac-basis">${esc(period)} / ${review.complete?'선택 기간 전체 산출':'산출 가능한 구간 합계'}</p>
    <div class="ac-loss-sub">확인 ${review.readyCount}/${review.totalCount}개 매장-월${ready?' / 유휴 Capacity '+fmtN(review.idle)+'회':''}</div>
    ${review.confirmedCount?'<div class="ac-loss-row"><span>마감월 산출분</span><strong>'+fmtS(review.confirmedLoss)+'</strong></div>':''}
    ${review.mtdCount?'<div class="ac-loss-row"><span>당월 MTD 산출분</span><strong>'+fmtS(review.mtdLoss)+'</strong></div>':''}
    ${review.projectionCount?'<div class="ac-loss-row"><span>당월 월말 예상 (참고)</span><strong>'+fmtS(review.projectedLoss)+'</strong></div>':''}
    <p class="ac-basis">${ready?'월별 MAX(0, 원천 Capacity − 사용량) × 해당 월 손실단가를 합산합니다. 단가 원천이 비어 있으면 같은 월의 순매출 ÷ 사용량으로 산출 가능한 경우만 사용합니다.':'기회금액 계산에 필요한 원천을 확인할 수 없습니다.'}
      ${review.totalCount>review.readyCount?(review.totalCount-review.readyCount)+'개 매장-월은 제외했습니다. 누락분은 0으로 채우거나 추정하지 않습니다.':''}
      실제 손실이나 회수 가능한 매출이 아닙니다.</p>
    <details class="ac-opportunity-detail"><summary>매장별 산출 범위 보기 (${review.stores.length}개 매장)</summary>
      ${review.stores.map(store=>`<div class="ac-loss-row"><span>${esc(store.name)} / ${store.readyCount}/${store.totalCount}개 매장-월</span><strong>${store.readyCount?fmtS(store.loss):'—'}</strong></div>
        ${store.excluded.length?`<p class="ac-basis">${store.excluded.map(row=>esc(row.month.month)+' '+esc(row.reason)).join(' / ')}</p>`:''}`).join('')}
    </details>`;
}

/* ── 18-C. 인라인 매장 드릴다운 (히트맵·랭킹·테이블 클릭 직후 노출) ── */
function renderInlineStoreDetail(ent) {
  const el = $('inlineStoreDetail');
  if (!el) return;

  // 전체 뷰이면 패널 숨김
  if (ent.isAll || !ent.months.length) { el.style.display = 'none'; return; }

  const c  = ent.current;
  const ms = ent.months;
  const hasSubscriptionData = Boolean(c.hasSubscriptionData);
  if (c.hasUsageData===false || c.hasSalesData===false) {
    const usage=usagePresentation(c),payment=buildPaymentReview(ent);
    const items=[
      {label:'실결제매출',value:c.hasSalesData===false?'—':fmtS(c.gross)},
      {label:'순매출 달성률',value:c.hasSalesData===false?'—':fmtP(c.achievement)},
      {label:'가동률 (관측 참고)',value:usage.label},
      {label:'이탈률',value:hasSubscriptionData?fmtP(c.churn):'—'},
      {label:'매장PASS ARPU',value:fmtS(payment.arpu)},
      {label:'건당 순매출 (확인 구간)',value:fmtS(payment.netPerWash)}
    ];
    el.style.display='';
    el.innerHTML=`<h2>${esc(ent.name)} 드릴다운</h2><p class="analysis-note">선택 기간 ${ms.length}개월 / 확인 가능한 지표를 유지합니다. 일부 수신 가동률은 확정 위험 판정에서 제외하며, 건당 단가는 확인 ${payment.count}/${payment.total}개 매장-월 기준입니다.</p>
      <div class="inline-kpi-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">${items.map(item=>`<div class="d-item"><div class="d-label">${item.label}</div><div class="d-val">${item.value}</div></div>`).join('')}</div>`;
    return;
  }

  // 트렌드 헬퍼
  const lastM = ms.length ? ms[ms.length-1] : null;
  const prevM = ms.length >= 2 ? ms[ms.length-2] : null;
  const subscriptionTrendMonths = subscriptionMonthsFor(ms);
  const lastSubscription = subscriptionTrendMonths[subscriptionTrendMonths.length - 1] || null;
  const prevSubscription = subscriptionTrendMonths[subscriptionTrendMonths.length - 2] || null;

  // 점검 포인트
  const issues = [];
  const ach    = c.achievement || 0;
  const churn  = c.churn       || 0;
  const util   = usageValue(c);
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
  if (lastM?.status === 'confirmed' && prevM?.status === 'confirmed') {
    const momGross = prevM.gross > 0 ? (lastM.gross - prevM.gross) / prevM.gross * 100 : 0;
    const momUtil  = (lastM.utilization||0) - (prevM.utilization||0);
    trends.push({ label:'실결제매출 MoM',  val:`${momGross>=0?'+':''}${momGross.toFixed(1)}%`,  good:momGross>=0 });
    trends.push({ label:'가동률 변화', val:`${momUtil>=0?'+':''}${momUtil.toFixed(1)}%p`,   good:momUtil>=0 });
  }
  if (lastSubscription?.status === 'confirmed' && prevSubscription?.status === 'confirmed') {
    const momChurn = (lastSubscription.churn||0) - (prevSubscription.churn||0);
    const momNetA  = (lastSubscription.netAdds||0) - (prevSubscription.netAdds||0);
    trends.push({ label:`이탈률 변화 (${lastSubscription.month})`, val:`${momChurn>=0?'+':''}${momChurn.toFixed(1)}%p`, good:momChurn<=0 });
    trends.push({ label:`순증감 변화 (${lastSubscription.month})`, val:`${momNetA>=0?'+':''}${momNetA}건`, good:momNetA>=0 });
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
      ${score==null?'':`<span class="score-badge" style="background:${scoreColor};color:#fff;padding:3px 12px;border-radius:99px;font-size:12px;font-weight:800">${score}점 / 6개 지표</span>`}
      <strong style="font-size:15px;color:var(--text)">${ent.name} 드릴다운</strong>
      <span style="font-size:11.5px;color:var(--muted)">${ms.length}개월 집계 · ${ms.length?ms[0].month:''} ~ ${ms.length?ms[ms.length-1].month:''}</span>
      <button class="inline-detail-close" id="inlineDetailClose">✕ 닫기</button>
    </div>

    <div class="inline-kpi-grid inline-kpi-grid-primary" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
      ${[
        {l:'실결제매출',      v:fmtS(c.gross),        s:`실결제매출 달성 ${fmtP(c.grossAchievement||0)}`},
        {l:'순매출 달성률',      v:fmtP(ach),             s:`순매출 ${fmtS(c.net||0)} / 목표 ${fmtS(c.target||0)}`},
        {l:'운영 가동률', v:fmtP(util),            s:`기간 누적 유휴 Capacity ${fmtN(capRow.idleCount||0)}대`},
        {l:'이탈률',      v:hasSubscriptionData ? fmtP(churn) : '—', s:hasSubscriptionData ? `해지 ${fmtN(c.cancelSubs||0)}건 / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c)},
        {l:'순증감',   v:hasSubscriptionData ? `${netAdds>=0?'+':''}${fmtN(netAdds)}` : '—', s:hasSubscriptionData ? `신규 ${fmtN(c.newSubs||0)} / 해지 ${fmtN(c.cancelSubs||0)} / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c)},
      ].map(i=>`
        <div class="d-item">
          <div class="d-label">${i.l}</div>
          <div class="d-val">${i.v}</div>
          <div class="d-sub">${i.s}</div>
        </div>`).join('')}
    </div>
    <div class="inline-kpi-grid inline-kpi-grid-secondary" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
      ${[
        {l:'MRR',         v:hasSubscriptionData ? fmtS(c.mrr||0) : '—', s:hasSubscriptionData ? `MRR YoY ${fmtYoY(c.mrrYoY, c.hasMrrYoY)} / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c)},
        {l:'ARPU',        v:hasSubscriptionData&&c.hasArpuData!==false?fmtS(c.arpu):'—', s:hasSubscriptionData ? `${arpuBasisLabel(c)} / ${subscriptionBasisLabel(c)}` : subscriptionBasisLabel(c)},
        {l:'ARR',         v:hasSubscriptionData?fmtS(c.arr):'—', s:`ARR YoY ${fmtYoY(c.arrYoY,c.hasMrrYoY)}`},
        {l:'LTV(추정)',    v:hasSubscriptionData&&Number.isFinite(c.ltv)&&(c.ltv>0||lastSubscription?.cancelSubs>0)?fmtW(c.ltv):'—', s:`MRR ÷ 월환산 해지수`},
      ].map(i=>`
        <div class="d-item">
          <div class="d-label">${i.l}</div>
          <div class="d-val">${i.v}</div>
          <div class="d-sub">${i.s}</div>
        </div>`).join('')}
    </div>

    <div class="inline-analysis-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
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
function setReviewPlaceholder(element, complete, note) {
  const placeholderId = `${element.id}Review`;
  $(placeholderId)?.remove();
  const isChart = element.tagName === 'CANVAS';
  element.hidden = isChart && !complete;
  if (complete) return;
  if (isChart) {
    charts[element.id]?.destroy();
    delete charts[element.id];
  } else {
    element.innerHTML = '';
  }
  const placeholder = document.createElement('div');
  placeholder.id = placeholderId;
  placeholder.className = 'review-empty';
  placeholder.innerHTML = `<strong>선택 기간 자료 확인 후 표시</strong><span>${esc(note)}</span>`;
  (isChart ? element.parentElement : element).appendChild(placeholder);
}

function renderReviewed(renderer, ent, ids, complete) {
  const standalone = new Set(['scoreChart','healthChart','seasonChart','capacityPanel','detailGrid']);
  const notes = {
    scoreChart:'이용량이 일부 누락되어 종합 점수를 산출하지 않습니다.',
    healthChart:'비교 대상의 이용량이 모두 확인되면 건강도를 표시합니다.',
    seasonChart:'당해 및 전년 이용량이 확인된 기간에 계절 지수를 표시합니다.',
    capacityPanel:'이용량과 월별 기회금액 원천이 모두 확인되면 전체 심층 분석을 표시합니다. 산출 가능한 범위는 상단 기회금액 카드에서 확인할 수 있습니다.'
  };
  for (const id of ids) {
    const element = $(id);
    if (!element) continue;
    if (id === 'inlineStoreDetail') {
      element.hidden = !complete;
      continue;
    }
    const host = id === 'capacityPanel' ? element.closest('section') || element
      : standalone.has(id) ? element.closest('article') || element : element;
    host.hidden = false;
    if (id === 'detailGrid' && $('detailTitle')) $('detailTitle').hidden = false;
    setReviewPlaceholder(element,complete,notes[id] || '확인된 원천 자료가 부족하여 이 분석은 표시하지 않습니다.');
    if (id === 'scoreChart' && $('scoreTitle')) $('scoreTitle').textContent = ent.isAll ? '매장별 운영 스코어' : `${ent.name} 운영 레버 스코어`;
  }
  if (complete) renderer(ent);
}

function renderSourceCoverage(ent) {
  const panel = $('sourceCoverage');
  const reference = $('dataReference');
  if (!panel || !reference) return;
  const stores = ent.isAll ? getActiveStores() : [{name:ent.name,months:ent.months}];
  const rows = stores.flatMap(store => filterMonths(store.months).filter(m=>m.hasUsageData===false)
    .map(m=>({name:store.name,month:m.month,quality:m.usageQuality,observed:m.observedUsage})));
  const warnings = dashboard.dataQuality?.warnings || [];
  const pending = dashboard.dataQuality?.sourceCheckPending;
  reference.hidden = !rows.length && !warnings.length && !pending;
  $('qualitySummary').textContent = rows.length
    ? `데이터 참고사항 / 이용량 ${rows.length}개 매장-월 일부 수신 / 상세 보기`
    : pending ? '데이터 참고사항 / 원천 점검 대기 / 상세 보기'
    : `데이터 참고사항 ${warnings.length}건 / 상세 보기`;
  panel.hidden = rows.length === 0;
  panel.innerHTML = rows.length ? `<p>관측 사용량은 수신분 합계입니다. 참고 가동률은 관측 사용량을 선택 기간 전체 Capacity로 나눈 값으로, 완전 실적이나 순위에 사용하지 않습니다. 누락분은 추정하지 않습니다.</p>
    <div class="coverage-grid"><strong>매장 / 월</strong><strong>수신일 / 기대일</strong><strong>관측 사용(회)</strong>
    ${rows.map(r=>`<span>${esc(r.name)} / ${esc(r.month)}</span><span>${r.quality?.received ?? '—'} / ${r.quality?.expected ?? '—'}</span><span>${r.observed == null ? '—' : fmtN(r.observed)}</span>`).join('')}</div>
    <p class="sub">모든 기간에서 같은 분석 항목을 유지합니다. 조치 제안과 매장 우선순위는 확인된 지표로 산정합니다. 기회금액과 건당 단가는 확인 구간, 스코어는 공통 확인 지표, 레이더는 축별 확인 매장 수를 표시합니다. 미수신 값은 0으로 대체하지 않습니다.</p>` : '';
  $('auditList').innerHTML = warnings.map(c=>`<div class="quality-item"><strong>${esc(c.name)}</strong><span>${esc(c.value || c.status)}</span></div>`).join('') +
    (pending ? '<p>원천 최종 점검이 완료되지 않았습니다.</p>' : '') +
    '<a class="source-link" href="https://docs.google.com/spreadsheets/d/1QasrQPOZqq3ljxCXQWnGYEy40D8jhojJRFOWkVa6uxo/edit#gid=830227479" target="_blank" rel="noopener noreferrer">원천 데이터 점검 열기</a>';
}

function renderAll() {
  renderSourceNotice();
  if (!dashboard) return;
  const ent = getEntity();
  if (!ent) return;
  renderSourceCoverage(ent);

  renderHeroKpis(ent);
  renderAlerts(ent);
  renderActionCenter(ent);
  renderGauges(ent);
  renderKpis(ent);
  renderReviewed(renderSignals,ent,['signalGrid'],true);
  renderInsights(ent);
  renderPerformanceChart(ent);
  renderReviewed(renderScoreChart,ent,['scoreChart'],true);
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
  renderReviewed(renderHealthChart,ent,['healthChart'],true);
  renderQuarterChart(ent);
  renderScatterChart(ent);
  renderMomentumChart(ent);
  renderMixChart(ent);
  renderSubscriptionPipeline(ent);
  renderReviewed(renderCapacityPanel,ent,['capacityPanel'],true);
  renderReviewed(renderSeasonChart,ent,['seasonChart'],true);
  renderPaymentPanel(ent);
  renderHeatmap(ent);
  renderTable(ent);
  renderReviewed(renderDetail,ent,['detailGrid'],true);
  renderReviewed(renderInlineStoreDetail,ent,['inlineStoreDetail'],true);
}

function renderSourceNotice() {
  const el=$('refreshNotice');
  if (!el) return;
  const cached=sourceSnapshot?.delivery?.mode==='cached';
  const partial=sourceSnapshot?.readiness?.mode==='partial';
  el.hidden=!cached && !partial;
  el.textContent=cached
    ? `마지막 확인 데이터를 표시합니다. ${sourceSnapshot.delivery.reason || '다음 자동 조회에서 갱신합니다.'}`
    : partial ? '원천 갱신 중입니다. 수신 상태와 합계가 확인된 데이터부터 표시합니다. 쿠폰 및 운영귀속매출은 최종 점검 후 반영합니다.' : '';
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
  if (init.running) return;
  init.running = true;
  const previousDashboard = dashboard;
  const previousSnapshot = sourceSnapshot;
  if (showLoading) $('loadingOverlay').style.display = 'flex';
  const errBannerEl = $('errBanner');
  if (errBannerEl) errBannerEl.style.display = 'none';
  _failedSheets.clear();
  try {
    await loadData();
    sourceRefreshFailed = false;
    renderAll();
    saveCachedSnapshot(sourceSnapshot);
    $('loadingOverlay').style.display = 'none';
  } catch(e) {
    dashboard = previousDashboard;
    sourceSnapshot = previousSnapshot;
    sourceRefreshFailed = true;
    const connectionStatus = $('connectionStatus');
    if (connectionStatus) { connectionStatus.textContent = dashboard ? '갱신 보류 / 마지막 정상 조회값' : '조회 보류 / 수신 데이터 없음'; connectionStatus.className = 'meta-pill warn'; }
    if (!dashboard) {
      for (const [id, text] of Object.entries({focusLabel:'데이터 조회 보류', statusText:'조회 실패 / 재시도 가능', auditBadge:'원천 조회 후 점검 가능'})) {
        if ($(id)) $(id).textContent = text;
      }
    }
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
      const safeMessage = String(e.message).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      errEl.innerHTML = `<span style="font-weight:800">데이터 갱신 보류${dashboard ? ' / 마지막 정상 조회 화면 유지' : ''}${failedStr}</span>
        <br><span style="font-size:11.5px;opacity:.85">${safeMessage}</span>
        <button id="errRetryBtn" style="margin-left:14px;padding:4px 14px;border-radius:99px;border:1px solid currentColor;background:transparent;color:inherit;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer">↻ 재시도</button>`;
      document.getElementById('errRetryBtn')?.addEventListener('click', loadAll);
    }
  } finally { init.running = false; }
}

parseHash();
bindEvents();
init();
