// P3-3b: discovery snapshot persistence — pure helpers + file I/O.
// Run with: npx tsx src/lib/discovery/__tests__/snapshots.test.ts
//
// Verifies:
//  buildDiscoverySnapshotsFromOpportunities:
//    - maps all required fields from Opportunity
//    - pricingMethod and pricingDataAvailable are preserved exactly
//    - currentPrice null is preserved as null (never 0)
//    - dataQualityScore is always null (P3-3g pending)
//    - previousState is null on first appearance, state on subsequent
//  pruneSnapshotsByAge:
//    - keeps snapshots within the window, removes older ones
//  File I/O (uses temp DATA_DIR — never touches src/data):
//    - append adds new snapshots without removing recent ones
//    - corrupted / missing file returns default without throwing
//    - write + read round-trips correctly

import os from 'os';
import path from 'path';
import fs from 'fs';

// Set DATA_DIR to a temp directory BEFORE any app module is loaded.
// tsx compiles static imports to CJS require() calls executed in order,
// so setting process.env here guarantees file-store.ts sees our test dir.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshots-test-'));
process.env.DATA_DIR = tmpDir;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  buildDiscoverySnapshotsFromOpportunities,
  pruneSnapshotsByAge,
  readDiscoverySnapshots,
  writeDiscoverySnapshots,
  persistDiscoverySnapshots,
} = require('../snapshots') as typeof import('../snapshots');

import type { Opportunity, OpportunityScore, OpportunityState } from '../../types';

// ---------------------------------------------------------------------------
// Micro-test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => void }> = [];

function assert(description: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    failed++;
  }
}

function test(name: string, fn: () => void): void {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function score(total: number): OpportunityScore {
  return {
    total,
    breakdown: {
      assetQuality: 9, drawdownOpportunity: 8, trendQuality: 7, relativeStrength: 6,
      diversificationFit: 5, sectorFit: 7, riskReward: 6, portfolioFit: 7, marketRegimeFit: 5,
    },
  };
}

function makeOpp(overrides: Partial<Opportunity> & { ticker: string }): Opportunity {
  return {
    name: overrides.name ?? overrides.ticker,
    type: 'stock',
    tags: ['tech'],
    isSeedUniverse: false,
    score: score(7.4),
    state: 'WATCH',
    currentPrice: null,
    currency: 'USD',
    pricingMethod: 'usd_no_fx',
    pricingDataAvailable: false,
    drawdown: { drawdown30d: 18, drawdown60d: 15, drawdown90d: 12, maxDrawdown: 18, primaryWindow: '30d' },
    reasons: ['Drawdown: -18%'],
    suggestedAmountEur: { min: 0, max: 0 },
    confidence: 'low',
    qualityGates: { liquidity: true, quality: true, volatility: true, portfolioFit: true, riskReward: true, notSpeculative: true },
    ...overrides,
  };
}

const RUN_ID = '2026-06-02T09:00:00.000Z';

// ---------------------------------------------------------------------------
// buildDiscoverySnapshotsFromOpportunities — pure function tests
// ---------------------------------------------------------------------------

test('maps all required fields from Opportunity', () => {
  const opp = makeOpp({ ticker: 'AAPL' });
  const [snap] = buildDiscoverySnapshotsFromOpportunities([opp], RUN_ID);
  assert('runId preserved', snap.runId === RUN_ID);
  assert('ticker preserved', snap.ticker === 'AAPL');
  assert('name preserved', snap.name === 'AAPL');
  assert('type preserved', snap.type === 'stock');
  assert('state preserved', snap.state === 'WATCH');
  assert('score.total preserved', snap.score.total === 7.4);
  assert('drawdown30d preserved', snap.drawdown30d === 18);
  assert('drawdown60d preserved', snap.drawdown60d === 15);
  assert('drawdown90d preserved', snap.drawdown90d === 12);
  assert('snapshotVersion is 1', snap.snapshotVersion === 1);
  assert('visibility is surfaced_top5', snap.visibility === 'surfaced_top5');
});

test('pricingMethod and pricingDataAvailable are preserved exactly', () => {
  const blocked = makeOpp({ ticker: 'NVDA', pricingMethod: 'usd_no_fx', pricingDataAvailable: false });
  const converted = makeOpp({ ticker: 'MSFT', pricingMethod: 'usd_converted', pricingDataAvailable: true, currentPrice: 420.5 });
  const legacy = makeOpp({ ticker: 'ASML', pricingMethod: undefined, pricingDataAvailable: true, currentPrice: 750 });

  const snaps = buildDiscoverySnapshotsFromOpportunities([blocked, converted, legacy], RUN_ID);
  assert('usd_no_fx method preserved', snaps[0].pricingMethod === 'usd_no_fx');
  assert('pricingDataAvailable false preserved', snaps[0].pricingDataAvailable === false);
  assert('usd_converted method preserved', snaps[1].pricingMethod === 'usd_converted');
  assert('pricingDataAvailable true preserved', snaps[1].pricingDataAvailable === true);
  assert('legacy method (undefined) preserved', snaps[2].pricingMethod === undefined);
});

test('currentPrice null preserved as null — never coerced to 0', () => {
  const nullPrice = makeOpp({ ticker: 'AAPL', currentPrice: null });
  const realPrice = makeOpp({ ticker: 'MSFT', currentPrice: 415.5, pricingDataAvailable: true });

  const snaps = buildDiscoverySnapshotsFromOpportunities([nullPrice, realPrice], RUN_ID);
  assert('null price stays null', snaps[0].currentPrice === null);
  assert('null price is NOT 0', snaps[0].currentPrice !== 0);
  assert('real price preserved', snaps[1].currentPrice === 415.5);
});

test('dataQualityScore is always null (P3-3g pending)', () => {
  const opps = [makeOpp({ ticker: 'A' }), makeOpp({ ticker: 'B' })];
  const snaps = buildDiscoverySnapshotsFromOpportunities(opps, RUN_ID);
  assert('first ticker dataQualityScore is null', snaps[0].dataQualityScore === null);
  assert('second ticker dataQualityScore is null', snaps[1].dataQualityScore === null);
});

test('previousState is null on first appearance, set on subsequent', () => {
  const opps = [makeOpp({ ticker: 'AAPL' }), makeOpp({ ticker: 'NVDA' })];
  const previous: Record<string, OpportunityState> = { AAPL: 'BUY' };

  const snaps = buildDiscoverySnapshotsFromOpportunities(opps, RUN_ID, previous);
  assert('AAPL previousState is BUY (was seen before)', snaps[0].previousState === 'BUY');
  assert('NVDA previousState is null (first appearance)', snaps[1].previousState === null);
});

test('empty opportunities array produces empty snapshot array', () => {
  const snaps = buildDiscoverySnapshotsFromOpportunities([], RUN_ID);
  assert('empty in → empty out', snaps.length === 0);
});

// ---------------------------------------------------------------------------
// pruneSnapshotsByAge — pure function tests
// ---------------------------------------------------------------------------

test('prune: keeps recent, removes snapshots older than maxAgeDays', () => {
  const now = new Date('2026-06-02T12:00:00Z');
  const oldRunId = '2026-04-30T00:00:00.000Z';    // 33 days ago — beyond 30d window
  const recentRunId = '2026-05-10T00:00:00.000Z'; // 23 days ago — within 30d window
  const todayRunId = '2026-06-02T00:00:00.000Z';  // today

  const opp = makeOpp({ ticker: 'X' });
  const [oldSnap] = buildDiscoverySnapshotsFromOpportunities([opp], oldRunId);
  const [recentSnap] = buildDiscoverySnapshotsFromOpportunities([opp], recentRunId);
  const [todaySnap] = buildDiscoverySnapshotsFromOpportunities([opp], todayRunId);

  const result = pruneSnapshotsByAge([oldSnap, recentSnap, todaySnap], 30, now);
  assert('old snapshot removed', !result.some((s) => s.runId === oldRunId));
  assert('recent snapshot kept', result.some((s) => s.runId === recentRunId));
  assert('today snapshot kept', result.some((s) => s.runId === todayRunId));
  assert('2 snapshots remain', result.length === 2);
});

test('prune: empty array stays empty', () => {
  assert('empty in → empty out', pruneSnapshotsByAge([], 30, new Date()).length === 0);
});

// ---------------------------------------------------------------------------
// File I/O tests — use tmpDir (process.env.DATA_DIR set at module load)
// ---------------------------------------------------------------------------

test('readDiscoverySnapshots: missing file returns empty default without throwing', () => {
  // tmpDir is fresh; file does not exist yet
  const result = readDiscoverySnapshots();
  assert('returns object', typeof result === 'object');
  assert('snapshots is empty array', Array.isArray(result.snapshots) && result.snapshots.length === 0);
  assert('maxAgeDays is 30', result.maxAgeDays === 30);
});

test('readDiscoverySnapshots: corrupted JSON returns default without throwing', () => {
  const corruptPath = path.join(tmpDir, 'discovery-snapshots.json');
  fs.writeFileSync(corruptPath, '{ NOT VALID JSON !!!', 'utf-8');
  let threw = false;
  let result;
  try {
    result = readDiscoverySnapshots();
  } catch {
    threw = true;
  }
  // Clean up
  try { fs.unlinkSync(corruptPath); } catch { /* ignore */ }
  assert('no exception thrown', !threw);
  assert('returns default snapshots array', Array.isArray(result?.snapshots));
});

test('writeDiscoverySnapshots + readDiscoverySnapshots round-trips correctly', () => {
  const opp = makeOpp({ ticker: 'AAPL', currentPrice: null });
  const [snap] = buildDiscoverySnapshotsFromOpportunities([opp], RUN_ID);
  const fileToWrite = { lastUpdatedAt: RUN_ID, maxAgeDays: 30, snapshots: [snap] };

  writeDiscoverySnapshots(fileToWrite);
  const read = readDiscoverySnapshots();

  assert('ticker round-trips', read.snapshots[0]?.ticker === 'AAPL');
  assert('currentPrice null round-trips as null (not 0)', read.snapshots[0]?.currentPrice === null);
  assert('pricingMethod round-trips', read.snapshots[0]?.pricingMethod === 'usd_no_fx');
  assert('pricingDataAvailable false round-trips', read.snapshots[0]?.pricingDataAvailable === false);
  assert('dataQualityScore null round-trips', read.snapshots[0]?.dataQualityScore === null);
  assert('snapshotVersion round-trips', read.snapshots[0]?.snapshotVersion === 1);
  assert('maxAgeDays round-trips', read.maxAgeDays === 30);
});

test('persistDiscoverySnapshots: appends without removing recent snapshots', () => {
  // Reset store so this test is not affected by the round-trip test above
  writeDiscoverySnapshots({ lastUpdatedAt: new Date(0).toISOString(), maxAgeDays: 30, snapshots: [] });

  // Write a "yesterday" snapshot first
  const run1 = '2026-06-01T09:00:00.000Z';
  const run2 = '2026-06-02T09:00:00.000Z';

  const opp1 = makeOpp({ ticker: 'NVDA', state: 'WATCH' });
  const opp2 = makeOpp({ ticker: 'AAPL', state: 'BUY', currentPrice: 215.0, pricingDataAvailable: true });

  persistDiscoverySnapshots([opp1], run1);
  persistDiscoverySnapshots([opp2], run2);

  const result = readDiscoverySnapshots();
  assert('both snapshots present', result.snapshots.length === 2);
  assert('run1 snapshot preserved', result.snapshots.some((s) => s.runId === run1 && s.ticker === 'NVDA'));
  assert('run2 snapshot present', result.snapshots.some((s) => s.runId === run2 && s.ticker === 'AAPL'));
  assert('lastUpdatedAt reflects latest run', result.lastUpdatedAt === run2);
});

test('persistDiscoverySnapshots: previousState populated from prior run', () => {
  // run1 left NVDA as WATCH; run2 should see previousState = WATCH for NVDA
  const result = readDiscoverySnapshots();
  const nvdaRun2 = result.snapshots.find((s) => s.ticker === 'NVDA');
  // NVDA was only in run1, so there's no run2 snapshot for it yet — check run1 has null previousState
  assert('run1 NVDA previousState is null (first appearance)', nvdaRun2?.previousState === null);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function main(): void {
  for (const { name, fn } of tests) {
    console.log(`\n${name}`);
    try {
      fn();
    } catch (err) {
      console.error(`  ✗ THREW: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // Cleanup temp dir
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Temp dir used: ${tmpDir} (cleaned up)`);
  if (failed > 0) process.exit(1);
}

main();
