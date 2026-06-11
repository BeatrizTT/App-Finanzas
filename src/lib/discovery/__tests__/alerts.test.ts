// P3-3d: Discovery alert trigger and dedupe tests
// Tests use a temp DATA_DIR so no files are written to src/data/.
// process.env.DATA_DIR must be set BEFORE any app module is required.

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-test-'));
process.env.DATA_DIR = tmpDir;

// App modules loaded AFTER env is set so file-store picks up the temp dir
const {
  generateDiscoveryAlerts,
  isAlertSuppressed,
  pruneDiscoveryAlerts,
  dedupeDiscoveryAlerts,
  buildPreviousSnapshotByTicker,
  readDiscoveryAlerts,
  writeDiscoveryAlerts,
  DISCOVERY_ALERT_COOLDOWNS,
  SCORE_ALERT_THRESHOLD,
  DRAWDOWN_SWEET_SPOT_MIN,
  DRAWDOWN_SWEET_SPOT_MAX,
  PERSISTENT_CANDIDATE_MIN_RUNS,
} = require('../alerts');

const { readWatchlist, writeWatchlist } = require('../watchlist');
const { readDiscoverySnapshots, writeDiscoverySnapshots } = require('../snapshots');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    results.push(`  ✓ ${msg}`);
  } else {
    failed++;
    results.push(`  ✗ ${msg}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}: threw ${e instanceof Error ? e.message : e}`);
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeScore(total: number) {
  return {
    total,
    breakdown: {
      assetQuality: 1, drawdownOpportunity: 1, trendQuality: 1,
      relativeStrength: 1, diversificationFit: 1, sectorFit: 1,
      riskReward: 1, portfolioFit: 1, marketRegimeFit: 1,
    },
  };
}

function makeDrawdown(d90: number) {
  return { drawdown30d: d90 * 0.8, drawdown60d: d90 * 0.9, drawdown90d: d90, maxDrawdown: d90, primaryWindow: '90d' as const };
}

function makeQualityGates(allPass = true) {
  return { liquidity: allPass, quality: allPass, volatility: allPass, portfolioFit: allPass, riskReward: allPass, notSpeculative: allPass };
}

function makeOpp(overrides: Record<string, unknown> = {}) {
  return {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    type: 'stock' as const,
    tags: [],
    isSeedUniverse: true,
    score: makeScore(7.0),
    state: 'BUY' as const,
    currentPrice: 215.0,
    currency: 'USD',
    pricingMethod: 'usd_converted' as const,
    pricingDataAvailable: true,
    drawdown: makeDrawdown(18),
    reasons: ['strong quality score'],
    suggestedAmountEur: { min: 500, max: 1000 },
    confidence: 'high' as const,
    qualityGates: makeQualityGates(true),
    ...overrides,
  };
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  const runId = '2026-06-01T10:00:00.000Z';
  return {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    type: 'stock' as const,
    watchlistState: 'WATCH_RESEARCH' as const,
    firstSeenAt: runId,
    lastSeenAt: runId,
    lastUpdatedAt: runId,
    consecutiveRunsSeen: 1,
    consecutiveRunsAbsent: 0,
    highestScore: 7.0,
    latestScore: 7.0,
    latestOpportunityState: 'BUY' as const,
    latestPricingMethod: 'usd_converted' as const,
    latestPricingDataAvailable: true,
    pricingUnlockedAt: runId,
    promotedToBuyAt: null,
    latestReasons: [],
    latestConfidence: 'high' as const,
    dataQualityScore: null,
    watchlistVersion: 1 as const,
    ...overrides,
  };
}

function makeTransition(overrides: Record<string, unknown> = {}) {
  return {
    ticker: 'AAPL',
    from: 'WATCH_RESEARCH' as const,
    to: 'BUY_CANDIDATE' as const,
    reason: 'Opportunity reached buy-ready state with buy-safe pricing',
    occurredAt: '2026-06-02T10:00:00.000Z',
    ...overrides,
  };
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    runId: '2026-06-01T10:00:00.000Z',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    type: 'stock' as const,
    score: makeScore(6.0),
    state: 'WATCH' as const,
    previousState: null,
    pricingMethod: 'usd_converted' as const,
    pricingDataAvailable: true,
    currentPrice: 210.0,
    drawdown30d: 14, drawdown60d: 16, drawdown90d: 10,
    qualityGates: makeQualityGates(false),
    reasons: [],
    suggestedAmountEur: { min: 500, max: 1000 },
    confidence: 'medium' as const,
    dataQualityScore: null,
    visibility: 'surfaced_top5' as const,
    snapshotVersion: 1 as const,
    ...overrides,
  };
}

function makeAlert(overrides: Record<string, unknown> = {}) {
  const runId = '2026-06-02T10:00:00.000Z';
  const runDate = runId.slice(0, 10);
  const type = 'WATCH_TO_BUY_CANDIDATE';
  return {
    id: `AAPL_${type}_${runId}`,
    ticker: 'AAPL',
    name: 'Apple Inc.',
    type,
    severity: 'high',
    createdAt: runId,
    runId,
    title: 'AAPL became a buy candidate',
    message: 'Apple Inc. is now actionable.',
    fromState: 'WATCH_RESEARCH',
    toState: 'BUY_CANDIDATE',
    score: 7.0,
    pricingDataAvailable: true,
    dedupeKey: `AAPL__${type}__${runDate}`,
    cooldownUntil: new Date(new Date(runId).getTime() + 24 * 3600 * 1000).toISOString(),
    alertVersion: 1,
    ...overrides,
  };
}

const RUN_ID = '2026-06-02T10:00:00.000Z';
const PREV_RUN_ID = '2026-06-01T10:00:00.000Z';

// ---------------------------------------------------------------------------
// Tests: Trigger generation
// ---------------------------------------------------------------------------

test('WATCH_RESEARCH → BUY_CANDIDATE generates WATCH_TO_BUY_CANDIDATE', () => {
  const transition = makeTransition({ from: 'WATCH_RESEARCH', to: 'BUY_CANDIDATE' });
  const entry = makeEntry({ watchlistState: 'BUY_CANDIDATE', firstSeenAt: PREV_RUN_ID });
  // drawdown below sweet spot (< 15%) so DRAWDOWN_SWEET_SPOT doesn't also fire
  const opp = makeOpp({ pricingDataAvailable: true, drawdown: makeDrawdown(10) });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  assert(alerts.length === 1, 'exactly 1 alert generated');
  assert(alerts[0].type === 'WATCH_TO_BUY_CANDIDATE', 'type is WATCH_TO_BUY_CANDIDATE');
  assert(alerts[0].severity === 'high', 'severity is high');
  assert(alerts[0].fromState === 'WATCH_RESEARCH', 'fromState is WATCH_RESEARCH');
  assert(alerts[0].toState === 'BUY_CANDIDATE', 'toState is BUY_CANDIDATE');
  assert(alerts[0].pricingDataAvailable === true, 'pricingDataAvailable is true');
  assert(alerts[0].message.includes('actionable'), 'message explains why it is actionable');
});

test('WATCH_TO_BUY_CANDIDATE not generated if pricingDataAvailable is false', () => {
  const transition = makeTransition({ from: 'WATCH_RESEARCH', to: 'BUY_CANDIDATE' });
  const entry = makeEntry({ watchlistState: 'BUY_CANDIDATE', firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ pricingDataAvailable: false, currentPrice: null });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  assert(
    alerts.every((a: any) => a.type !== 'WATCH_TO_BUY_CANDIDATE'),
    'no WATCH_TO_BUY_CANDIDATE when pricing is unavailable',
  );
});

test('WATCH_PRICING_BLOCKED → BUY_CANDIDATE generates both WATCH_TO_BUY_CANDIDATE and PRICING_UNLOCKED', () => {
  const transition = makeTransition({ from: 'WATCH_PRICING_BLOCKED', to: 'BUY_CANDIDATE' });
  const entry = makeEntry({ watchlistState: 'BUY_CANDIDATE', firstSeenAt: PREV_RUN_ID });
  // drawdown below sweet spot so DRAWDOWN_SWEET_SPOT doesn't also fire
  const opp = makeOpp({ pricingDataAvailable: true, drawdown: makeDrawdown(10) });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  const types = alerts.map((a: any) => a.type);
  assert(types.includes('WATCH_TO_BUY_CANDIDATE'), 'includes WATCH_TO_BUY_CANDIDATE');
  assert(types.includes('PRICING_UNLOCKED'), 'includes PRICING_UNLOCKED');
  assert(alerts.length === 2, 'exactly 2 alerts');
});

test('WATCH_PRICING_BLOCKED → WATCH_RESEARCH generates PRICING_UNLOCKED only', () => {
  const transition = makeTransition({ from: 'WATCH_PRICING_BLOCKED', to: 'WATCH_RESEARCH' });
  const entry = makeEntry({ watchlistState: 'WATCH_RESEARCH', firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ state: 'WATCH', pricingDataAvailable: true });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  const types = alerts.map((a: any) => a.type);
  assert(types.includes('PRICING_UNLOCKED'), 'includes PRICING_UNLOCKED');
  assert(!types.includes('WATCH_TO_BUY_CANDIDATE'), 'no WATCH_TO_BUY_CANDIDATE');
  const ul = alerts.find((a: any) => a.type === 'PRICING_UNLOCKED')!;
  assert(ul.message.toLowerCase().includes('eur'), 'PRICING_UNLOCKED message mentions EUR');
  assert(ul.message.toLowerCase().includes('pricing') || ul.message.toLowerCase().includes('fx'), 'message mentions pricing/FX');
});

test('WATCH_RESEARCH → WATCH_PRICING_BLOCKED generates PRICING_DEGRADED', () => {
  const transition = makeTransition({ from: 'WATCH_RESEARCH', to: 'WATCH_PRICING_BLOCKED' });
  const entry = makeEntry({ watchlistState: 'WATCH_PRICING_BLOCKED', firstSeenAt: PREV_RUN_ID });
  // drawdown below sweet spot so DRAWDOWN_SWEET_SPOT doesn't also fire
  const opp = makeOpp({ pricingDataAvailable: false, currentPrice: null, drawdown: makeDrawdown(10) });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  assert(alerts.length === 1, 'exactly 1 alert');
  assert(alerts[0].type === 'PRICING_DEGRADED', 'type is PRICING_DEGRADED');
  assert(alerts[0].severity === 'low', 'severity is low');
  assert(alerts[0].pricingDataAvailable === false, 'pricingDataAvailable is false');
  assert(alerts[0].message.includes('blocked') || alerts[0].message.includes('blocked'), 'message mentions BUY blocked');
});

test('score crosses 6.5 from below → SCORE_CROSSED_THRESHOLD', () => {
  const opp = makeOpp({ score: makeScore(7.2) });
  const prevSnap = makeSnapshot({ score: makeScore(6.0), ticker: 'AAPL', runId: PREV_RUN_ID });
  const entry = makeEntry({ firstSeenAt: PREV_RUN_ID });

  const alerts = generateDiscoveryAlerts([], [entry], [opp], { AAPL: prevSnap }, [], RUN_ID);

  const found = alerts.find((a: any) => a.type === 'SCORE_CROSSED_THRESHOLD');
  assert(found !== undefined, 'SCORE_CROSSED_THRESHOLD generated');
  assert(found?.severity === 'medium', 'severity is medium');
  assert((found?.scoreDelta ?? 0) > 0, 'scoreDelta is positive');
  assert((found?.previousScore ?? 0) < SCORE_ALERT_THRESHOLD, 'previousScore is below threshold');
  assert((found?.score ?? 0) >= SCORE_ALERT_THRESHOLD, 'score is at or above threshold');
});

test('score already >= 6.5 → no SCORE_CROSSED_THRESHOLD', () => {
  const opp = makeOpp({ score: makeScore(7.5) });
  const prevSnap = makeSnapshot({ score: makeScore(7.0), ticker: 'AAPL', runId: PREV_RUN_ID });
  const entry = makeEntry({ firstSeenAt: PREV_RUN_ID });

  const alerts = generateDiscoveryAlerts([], [entry], [opp], { AAPL: prevSnap }, [], RUN_ID);

  assert(
    alerts.every((a: any) => a.type !== 'SCORE_CROSSED_THRESHOLD'),
    'no SCORE_CROSSED_THRESHOLD when score was already above threshold',
  );
});

test('drawdown90d enters 15–25% → DRAWDOWN_SWEET_SPOT', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(18) });
  const prevSnap = makeSnapshot({ drawdown90d: 10, ticker: 'AAPL', runId: PREV_RUN_ID });
  const entry = makeEntry({ firstSeenAt: PREV_RUN_ID });

  const alerts = generateDiscoveryAlerts([], [entry], [opp], { AAPL: prevSnap }, [], RUN_ID);

  const found = alerts.find((a: any) => a.type === 'DRAWDOWN_SWEET_SPOT');
  assert(found !== undefined, 'DRAWDOWN_SWEET_SPOT generated');
  assert(found?.severity === 'medium', 'severity is medium');
  assert(found?.message.includes('18.0%') || (found?.message.includes('18') ?? false), 'message includes drawdown value');
});

test('drawdown already in sweet spot → no DRAWDOWN_SWEET_SPOT', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(20) });
  const prevSnap = makeSnapshot({ drawdown90d: 20, ticker: 'AAPL', runId: PREV_RUN_ID });
  const entry = makeEntry({ firstSeenAt: PREV_RUN_ID });

  const alerts = generateDiscoveryAlerts([], [entry], [opp], { AAPL: prevSnap }, [], RUN_ID);

  assert(
    alerts.every((a: any) => a.type !== 'DRAWDOWN_SWEET_SPOT'),
    'no DRAWDOWN_SWEET_SPOT when already in sweet spot',
  );
});

test('transition to STALE generates STALE_CANDIDATE', () => {
  const transition = makeTransition({ from: 'WATCH_RESEARCH', to: 'STALE', ticker: 'MSFT' });
  const entry = makeEntry({ ticker: 'MSFT', name: 'Microsoft Corp.', watchlistState: 'STALE', firstSeenAt: PREV_RUN_ID });

  const alerts = generateDiscoveryAlerts([transition], [entry], [], {}, [], RUN_ID);

  const found = alerts.find((a: any) => a.type === 'STALE_CANDIDATE');
  assert(found !== undefined, 'STALE_CANDIDATE generated');
  assert(found?.severity === 'low', 'severity is low');
  // Message must not sound like a sell/negative recommendation
  const msg = found?.message.toLowerCase() ?? '';
  assert(!msg.includes('sell') && !msg.includes('exit') && !msg.includes('avoid'), 'STALE message has no negative recommendation words');
  assert(found?.toState === 'STALE', 'toState is STALE');
});

test('consecutiveRunsSeen >= 5 && score >= 6.5 → PERSISTENT_CANDIDATE', () => {
  const entry = makeEntry({ consecutiveRunsSeen: 5, firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ score: makeScore(7.0) });

  const alerts = generateDiscoveryAlerts([], [entry], [opp], {}, [], RUN_ID);

  const found = alerts.find((a: any) => a.type === 'PERSISTENT_CANDIDATE');
  assert(found !== undefined, 'PERSISTENT_CANDIDATE generated');
  assert(found?.message.includes('5') ?? false, 'message includes run count');
});

test('consecutiveRunsSeen < 5 → no PERSISTENT_CANDIDATE', () => {
  const entry = makeEntry({ consecutiveRunsSeen: 4, firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ score: makeScore(7.0) });

  const alerts = generateDiscoveryAlerts([], [entry], [opp], {}, [], RUN_ID);

  assert(
    alerts.every((a: any) => a.type !== 'PERSISTENT_CANDIDATE'),
    'no PERSISTENT_CANDIDATE when consecutiveRunsSeen < 5',
  );
});

test('QUALITY_GATES_PASSED when all gates pass now and one failed before', () => {
  const opp = makeOpp({ qualityGates: makeQualityGates(true) });
  const prevSnap = makeSnapshot({ qualityGates: makeQualityGates(false), ticker: 'AAPL', runId: PREV_RUN_ID });
  const entry = makeEntry({ firstSeenAt: PREV_RUN_ID });

  const alerts = generateDiscoveryAlerts([], [entry], [opp], { AAPL: prevSnap }, [], RUN_ID);

  const found = alerts.find((a: any) => a.type === 'QUALITY_GATES_PASSED');
  assert(found !== undefined, 'QUALITY_GATES_PASSED generated');
  assert(found?.severity === 'medium', 'severity is medium');
  assert(found?.message.includes('quality gates') || (found?.message.includes('gates') ?? false), 'message mentions gates');
});

test('QUALITY_GATES_PASSED not fired if all gates already passed before', () => {
  const opp = makeOpp({ qualityGates: makeQualityGates(true) });
  const prevSnap = makeSnapshot({ qualityGates: makeQualityGates(true), ticker: 'AAPL', runId: PREV_RUN_ID });
  const entry = makeEntry({ firstSeenAt: PREV_RUN_ID });

  const alerts = generateDiscoveryAlerts([], [entry], [opp], { AAPL: prevSnap }, [], RUN_ID);

  assert(
    alerts.every((a: any) => a.type !== 'QUALITY_GATES_PASSED'),
    'no QUALITY_GATES_PASSED when gates were already passing',
  );
});

test('RANKING_TOP5_ENTRY on first appearance (firstSeenAt === runId)', () => {
  const entry = makeEntry({ firstSeenAt: RUN_ID });
  const opp = makeOpp();

  const alerts = generateDiscoveryAlerts([], [entry], [opp], {}, [], RUN_ID);

  const found = alerts.find((a: any) => a.type === 'RANKING_TOP5_ENTRY');
  assert(found !== undefined, 'RANKING_TOP5_ENTRY generated for new entry');
  assert(found?.severity === 'low', 'severity is low');
});

test('RANKING_TOP5_ENTRY not generated for existing entry', () => {
  const entry = makeEntry({ firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp();

  const alerts = generateDiscoveryAlerts([], [entry], [opp], {}, [], RUN_ID);

  assert(
    alerts.every((a: any) => a.type !== 'RANKING_TOP5_ENTRY'),
    'no RANKING_TOP5_ENTRY for existing entry',
  );
});

test('currentPrice: null not coerced to 0 in scoring context — WATCH_TO_BUY_CANDIDATE blocked', () => {
  // When currentPrice is null, pricingDataAvailable should be false → no BUY_CANDIDATE alert
  const transition = makeTransition({ from: 'WATCH_RESEARCH', to: 'BUY_CANDIDATE' });
  const entry = makeEntry({ watchlistState: 'BUY_CANDIDATE', firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ currentPrice: null, pricingDataAvailable: false });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  assert(
    alerts.every((a: any) => a.type !== 'WATCH_TO_BUY_CANDIDATE'),
    'WATCH_TO_BUY_CANDIDATE not generated when currentPrice is null',
  );
});

// ---------------------------------------------------------------------------
// Tests: Dedupe / cooldown
// ---------------------------------------------------------------------------

test('same (ticker, type, date) → suppressed by same-day dedupe', () => {
  const runDate = RUN_ID.slice(0, 10);
  const existing = [makeAlert({ dedupeKey: `AAPL__WATCH_TO_BUY_CANDIDATE__${runDate}`, cooldownUntil: null })];

  assert(
    isAlertSuppressed('AAPL', 'WATCH_TO_BUY_CANDIDATE', RUN_ID, existing),
    'same dedupeKey is suppressed',
  );
});

test('active cooldown → suppressed', () => {
  const future = new Date(new Date(RUN_ID).getTime() + 12 * 3600 * 1000).toISOString();
  const existing = [makeAlert({ cooldownUntil: future, dedupeKey: 'AAPL__WATCH_TO_BUY_CANDIDATE__2026-06-01' })];

  assert(
    isAlertSuppressed('AAPL', 'WATCH_TO_BUY_CANDIDATE', RUN_ID, existing),
    'active cooldown suppresses new alert',
  );
});

test('expired cooldown → allowed', () => {
  const past = new Date(new Date(RUN_ID).getTime() - 2 * 3600 * 1000).toISOString();
  const existing = [makeAlert({ cooldownUntil: past, dedupeKey: 'AAPL__WATCH_TO_BUY_CANDIDATE__2026-06-01' })];

  assert(
    !isAlertSuppressed('AAPL', 'WATCH_TO_BUY_CANDIDATE', RUN_ID, existing),
    'expired cooldown allows new alert',
  );
});

test('maxPerWeek reached → suppressed', () => {
  // PRICING_UNLOCKED has maxPerWeek: 1
  const recentRun = new Date(new Date(RUN_ID).getTime() - 2 * 24 * 3600 * 1000).toISOString();
  const existing = [makeAlert({
    type: 'PRICING_UNLOCKED',
    createdAt: recentRun,
    cooldownUntil: null,
    dedupeKey: `AAPL__PRICING_UNLOCKED__${recentRun.slice(0, 10)}`,
  })];

  assert(
    isAlertSuppressed('AAPL', 'PRICING_UNLOCKED', RUN_ID, existing),
    'maxPerWeek=1 suppresses second alert in same week',
  );
});

test('maxPerWeek not yet reached → allowed', () => {
  // WATCH_TO_BUY_CANDIDATE has maxPerWeek: 3 — 2 alerts this week should still allow a third
  const day1 = new Date(new Date(RUN_ID).getTime() - 6 * 24 * 3600 * 1000).toISOString();
  const day2 = new Date(new Date(RUN_ID).getTime() - 3 * 24 * 3600 * 1000).toISOString();
  const existing = [
    makeAlert({ createdAt: day1, cooldownUntil: null, dedupeKey: `AAPL__WATCH_TO_BUY_CANDIDATE__${day1.slice(0, 10)}` }),
    makeAlert({ createdAt: day2, cooldownUntil: null, dedupeKey: `AAPL__WATCH_TO_BUY_CANDIDATE__${day2.slice(0, 10)}` }),
  ];

  assert(
    !isAlertSuppressed('AAPL', 'WATCH_TO_BUY_CANDIDATE', RUN_ID, existing),
    'only 2 of 3 maxPerWeek used — not suppressed',
  );
});

test('different ticker → not suppressed', () => {
  const runDate = RUN_ID.slice(0, 10);
  const existing = [makeAlert({ ticker: 'NVDA', dedupeKey: `NVDA__WATCH_TO_BUY_CANDIDATE__${runDate}`, cooldownUntil: null })];

  assert(
    !isAlertSuppressed('AAPL', 'WATCH_TO_BUY_CANDIDATE', RUN_ID, existing),
    'different ticker is not suppressed',
  );
});

test('different alert type → not suppressed', () => {
  const runDate = RUN_ID.slice(0, 10);
  const existing = [makeAlert({ type: 'WATCH_TO_BUY_CANDIDATE', dedupeKey: `AAPL__WATCH_TO_BUY_CANDIDATE__${runDate}`, cooldownUntil: null })];

  assert(
    !isAlertSuppressed('AAPL', 'PRICING_UNLOCKED', RUN_ID, existing),
    'different type is not suppressed',
  );
});

test('within-run dedupe: same alert generated only once per run', () => {
  // Two transitions for same ticker+type in same run → only 1 alert
  const t1 = makeTransition({ from: 'WATCH_RESEARCH', to: 'BUY_CANDIDATE' });
  const t2 = makeTransition({ from: 'WATCH_RESEARCH', to: 'BUY_CANDIDATE' }); // duplicate
  const entry = makeEntry({ watchlistState: 'BUY_CANDIDATE', firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ pricingDataAvailable: true });

  const alerts = generateDiscoveryAlerts([t1, t2], [entry], [opp], {}, [], RUN_ID);

  const buyAlerts = alerts.filter((a: any) => a.type === 'WATCH_TO_BUY_CANDIDATE');
  assert(buyAlerts.length === 1, 'within-run dedupe: only 1 WATCH_TO_BUY_CANDIDATE for same ticker');
});

// ---------------------------------------------------------------------------
// Tests: Storage / file I/O
// ---------------------------------------------------------------------------

test('missing discovery-alerts.json → returns default (no crash)', () => {
  const alertPath = path.join(tmpDir, 'discovery-alerts.json');
  if (fs.existsSync(alertPath)) fs.unlinkSync(alertPath);

  const file = readDiscoveryAlerts();

  assert(Array.isArray(file.alerts), 'alerts is an array');
  assert(file.alerts.length === 0, 'default has no alerts');
  assert(file.maxAgeDays === 30, 'default maxAgeDays is 30');
});

test('corrupt JSON discovery-alerts.json → returns default (no crash)', () => {
  const alertPath = path.join(tmpDir, 'discovery-alerts.json');
  fs.writeFileSync(alertPath, '{invalid json{{');

  const file = readDiscoveryAlerts();

  assert(Array.isArray(file.alerts), 'alerts is an array after corrupt JSON');
  assert(file.alerts.length === 0, 'no alerts after corrupt JSON');
});

test('write and read round-trip preserves alert fields', () => {
  const alert = makeAlert();
  writeDiscoveryAlerts({ lastUpdatedAt: RUN_ID, maxAgeDays: 30, alerts: [alert] });
  const file = readDiscoveryAlerts();

  assert(file.alerts.length === 1, 'one alert read back');
  assert(file.alerts[0].ticker === 'AAPL', 'ticker preserved');
  assert(file.alerts[0].type === 'WATCH_TO_BUY_CANDIDATE', 'type preserved');
  assert(file.alerts[0].alertVersion === 1, 'alertVersion preserved');
  assert(file.alerts[0].dedupeKey.includes('AAPL'), 'dedupeKey preserved');
});

test('append preserves existing alerts', () => {
  const a1 = makeAlert({ id: 'alert-1', dedupeKey: 'AAPL__WATCH_TO_BUY_CANDIDATE__2026-06-01' });
  const a2 = makeAlert({ id: 'alert-2', type: 'PRICING_UNLOCKED', dedupeKey: 'AAPL__PRICING_UNLOCKED__2026-06-02' });
  writeDiscoveryAlerts({ lastUpdatedAt: RUN_ID, maxAgeDays: 30, alerts: [a1, a2] });
  const file = readDiscoveryAlerts();

  assert(file.alerts.length === 2, 'two alerts present after append');
});

test('pruneDiscoveryAlerts removes alerts older than maxAgeDays', () => {
  const now = new Date('2026-06-02T10:00:00.000Z');
  const old = makeAlert({ createdAt: new Date(now.getTime() - 31 * 24 * 3600 * 1000).toISOString() });
  const recent = makeAlert({ createdAt: now.toISOString(), dedupeKey: 'AAPL__WATCH_TO_BUY_CANDIDATE__2026-06-02' });

  const pruned = pruneDiscoveryAlerts([old, recent], 30, now);

  assert(pruned.length === 1, 'old alert removed');
  assert(pruned[0].createdAt === recent.createdAt, 'recent alert kept');
});

test('pruneDiscoveryAlerts keeps alerts within maxAgeDays window', () => {
  const now = new Date('2026-06-02T10:00:00.000Z');
  const alert29d = makeAlert({ createdAt: new Date(now.getTime() - 29 * 24 * 3600 * 1000).toISOString() });

  const pruned = pruneDiscoveryAlerts([alert29d], 30, now);

  assert(pruned.length === 1, 'alert within 30 days is kept');
});

test('dedupeDiscoveryAlerts removes duplicate dedupeKeys keeping first occurrence', () => {
  const a1 = makeAlert({ id: 'first', dedupeKey: 'AAPL__WATCH_TO_BUY_CANDIDATE__2026-06-02' });
  const a2 = makeAlert({ id: 'second', dedupeKey: 'AAPL__WATCH_TO_BUY_CANDIDATE__2026-06-02' });

  const result = dedupeDiscoveryAlerts([a1, a2]);

  assert(result.length === 1, 'duplicate removed');
  assert(result[0].id === 'first', 'first occurrence kept');
});

// ---------------------------------------------------------------------------
// Tests: buildPreviousSnapshotByTicker
// ---------------------------------------------------------------------------

test('buildPreviousSnapshotByTicker excludes snapshots from currentRunId', () => {
  const prev = makeSnapshot({ runId: PREV_RUN_ID, ticker: 'AAPL' });
  const curr = makeSnapshot({ runId: RUN_ID, ticker: 'AAPL', score: makeScore(8.0) });

  const result = buildPreviousSnapshotByTicker([prev, curr], RUN_ID);

  assert(result['AAPL'] !== undefined, 'AAPL entry exists');
  assert(result['AAPL'].runId === PREV_RUN_ID, 'returns snapshot from previous run, not current');
});

test('buildPreviousSnapshotByTicker returns most-recent prior snapshot when multiple exist', () => {
  const s1 = makeSnapshot({ runId: '2026-05-30T10:00:00.000Z', ticker: 'AAPL', score: makeScore(5.0) });
  const s2 = makeSnapshot({ runId: PREV_RUN_ID, ticker: 'AAPL', score: makeScore(6.2) });
  const curr = makeSnapshot({ runId: RUN_ID, ticker: 'AAPL', score: makeScore(7.0) });

  const result = buildPreviousSnapshotByTicker([s1, s2, curr], RUN_ID);

  assert(result['AAPL'].score.total === 6.2, 'most-recent prior snapshot returned');
});

// ---------------------------------------------------------------------------
// Tests: Safety
// ---------------------------------------------------------------------------

test('generateDiscoveryAlerts is pure — returns array, has no Telegram side effects', () => {
  const alerts = generateDiscoveryAlerts([], [], [], {}, [], RUN_ID);

  assert(Array.isArray(alerts), 'returns array');
  assert(alerts.length === 0, 'empty input produces empty output');
});

test('no alert record contains an API key, secret, or password', () => {
  const transition = makeTransition({ from: 'WATCH_RESEARCH', to: 'BUY_CANDIDATE' });
  const entry = makeEntry({ watchlistState: 'BUY_CANDIDATE', firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ pricingDataAvailable: true });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  for (const a of alerts) {
    const serialized = JSON.stringify(a).toLowerCase();
    assert(!serialized.includes('api_key'), 'no api_key in alert');
    assert(!serialized.includes('secret'), 'no secret in alert');
    assert(!serialized.includes('password'), 'no password in alert');
  }
});

test('DISCOVERY_ALERT_COOLDOWNS defines all 10 alert types', () => {
  const keys = Object.keys(DISCOVERY_ALERT_COOLDOWNS);
  assert(keys.length === 10, 'all 10 alert types have cooldown config');
  assert(keys.includes('WATCH_TO_BUY_CANDIDATE'), 'WATCH_TO_BUY_CANDIDATE defined');
  assert(keys.includes('SHARP_DRAWDOWN_QUALITY'), 'SHARP_DRAWDOWN_QUALITY defined (reserved for P3-3g)');
});

test('alert id is deterministic ticker_type_runId format', () => {
  const transition = makeTransition({ from: 'WATCH_RESEARCH', to: 'BUY_CANDIDATE' });
  const entry = makeEntry({ watchlistState: 'BUY_CANDIDATE', firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ pricingDataAvailable: true });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  assert(alerts.length > 0, 'at least one alert');
  assert(alerts[0].id === `AAPL_WATCH_TO_BUY_CANDIDATE_${RUN_ID}`, 'id follows ticker_type_runId pattern');
});

test('cooldownUntil is set on generated alerts and is in the future relative to runId', () => {
  const transition = makeTransition({ from: 'WATCH_RESEARCH', to: 'BUY_CANDIDATE' });
  const entry = makeEntry({ watchlistState: 'BUY_CANDIDATE', firstSeenAt: PREV_RUN_ID });
  const opp = makeOpp({ pricingDataAvailable: true });

  const alerts = generateDiscoveryAlerts([transition], [entry], [opp], {}, [], RUN_ID);

  const a = alerts.find((x: any) => x.type === 'WATCH_TO_BUY_CANDIDATE')!;
  assert(a.cooldownUntil !== null, 'cooldownUntil is set');
  assert(new Date(a.cooldownUntil!).getTime() > new Date(RUN_ID).getTime(), 'cooldownUntil is in the future');
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function main(): void {
  console.log('\n▶ src/lib/discovery/__tests__/alerts.test.ts\n');
  for (const r of results) console.log(r);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
