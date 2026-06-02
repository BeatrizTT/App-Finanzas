// P3-3c: discovery watchlist lifecycle.
// Run with: npx tsx src/lib/discovery/__tests__/watchlist.test.ts
//
// Verifies:
//  deriveWatchlistState (pure):
//    - new entry + pricing blocked → WATCH_PRICING_BLOCKED
//    - new entry + WATCH + pricing ok → WATCH_RESEARCH
//    - new entry + BUY/READY + pricing ok → BUY_CANDIDATE
//    - BUY/READY + pricingDataAvailable=false → NOT BUY_CANDIDATE
//    - BUY/READY + pricingDataAvailable=true but currentPrice=null → NOT BUY_CANDIDATE
//    - WATCH_PRICING_BLOCKED → WATCH_RESEARCH on pricing unlock
//    - WATCH_PRICING_BLOCKED → BUY_CANDIDATE on unlock + BUY state
//    - BUY_CANDIDATE → WATCH_PRICING_BLOCKED on pricing degradation
//    - REJECTED / BOUGHT are terminal regardless of opportunity state
//  updateWatchlistFromDiscoveries (pure):
//    - highestScore keeps historical max; latestScore updates
//    - firstSeenAt preserved; lastSeenAt updated each run
//    - pricingUnlockedAt set once, not overwritten
//    - promotedToBuyAt set once, not overwritten
//    - absent entries increment consecutiveRunsAbsent, reset consecutiveRunsSeen
//    - absent ≥ threshold → STALE transition
//    - already-STALE absent entries don't re-fire STALE transition
//    - STALE reappears → WATCH_PRICING_BLOCKED / WATCH_RESEARCH / BUY_CANDIDATE
//    - REJECTED not auto-promoted; observational metadata updates
//    - BOUGHT not auto-promoted; observational metadata updates
//    - transitions include from/to/reason/occurredAt; from=null for new entries
//    - no transition when state unchanged
//    - WATCH_RESEARCH → BUY_CANDIDATE transition recorded
//    - WATCH_RESEARCH → WATCH_PRICING_BLOCKED on pricing degradation
//  File I/O (temp DATA_DIR — never touches src/data):
//    - missing watchlist.json → default (no crash)
//    - corrupted JSON → default (no crash)
//    - persistWatchlist write+read round-trips correctly

import os from 'os';
import path from 'path';
import fs from 'fs';

// Set DATA_DIR before any app module loads.
// tsx compiles static imports to CJS require() calls executed in order,
// so this assignment runs before the app modules are first required.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchlist-test-'));
process.env.DATA_DIR = tmpDir;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  deriveWatchlistState,
  updateWatchlistFromDiscoveries,
  readWatchlist,
  writeWatchlist,
  persistWatchlist,
  WATCHLIST_STALE_AFTER_RUNS,
} = require('../watchlist') as typeof import('../watchlist');

import type {
  Opportunity,
  OpportunityScore,
  WatchlistEntry,
  WatchlistFile,
  WatchlistState,
} from '../../types';

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

function makeEntry(
  overrides: Partial<WatchlistEntry> & { ticker: string; watchlistState: WatchlistState },
): WatchlistEntry {
  return {
    name: overrides.name ?? overrides.ticker,
    type: 'stock',
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    lastUpdatedAt: '2026-05-30T00:00:00.000Z',
    consecutiveRunsSeen: 1,
    consecutiveRunsAbsent: 0,
    highestScore: 7.4,
    latestScore: 7.4,
    latestOpportunityState: 'WATCH',
    latestPricingMethod: 'usd_no_fx',
    latestPricingDataAvailable: false,
    pricingUnlockedAt: null,
    promotedToBuyAt: null,
    latestReasons: ['Drawdown: -18%'],
    latestConfidence: 'low',
    dataQualityScore: null,
    watchlistVersion: 1,
    ...overrides,
  };
}

function emptyFile(): WatchlistFile {
  return { lastUpdatedAt: new Date(0).toISOString(), entries: [] };
}

function fileWith(entries: WatchlistEntry[]): WatchlistFile {
  return { lastUpdatedAt: '2026-05-30T00:00:00.000Z', entries };
}

const RUN1 = '2026-06-01T09:00:00.000Z';
const RUN2 = '2026-06-02T09:00:00.000Z';
const RUN3 = '2026-06-03T09:00:00.000Z';

// ---------------------------------------------------------------------------
// deriveWatchlistState — pure function tests
// ---------------------------------------------------------------------------

test('new entry: pricingDataAvailable=false → WATCH_PRICING_BLOCKED', () => {
  const result = deriveWatchlistState(makeOpp({ ticker: 'AAPL', pricingDataAvailable: false, currentPrice: null }), null);
  assert('state is WATCH_PRICING_BLOCKED', result === 'WATCH_PRICING_BLOCKED');
});

test('new entry: WATCH state + pricing ok → WATCH_RESEARCH', () => {
  const opp = makeOpp({ ticker: 'MSFT', state: 'WATCH', pricingDataAvailable: true, currentPrice: 420.0, pricingMethod: 'usd_converted' });
  assert('state is WATCH_RESEARCH', deriveWatchlistState(opp, null) === 'WATCH_RESEARCH');
});

test('new entry: BUY state + pricing ok → BUY_CANDIDATE', () => {
  const opp = makeOpp({ ticker: 'NVDA', state: 'BUY', pricingDataAvailable: true, currentPrice: 900.0, pricingMethod: 'usd_converted' });
  assert('state is BUY_CANDIDATE', deriveWatchlistState(opp, null) === 'BUY_CANDIDATE');
});

test('new entry: READY_TO_BUY + pricing ok → BUY_CANDIDATE', () => {
  const opp = makeOpp({ ticker: 'V', state: 'READY_TO_BUY', pricingDataAvailable: true, currentPrice: 280.0, pricingMethod: 'usd_converted' });
  assert('state is BUY_CANDIDATE', deriveWatchlistState(opp, null) === 'BUY_CANDIDATE');
});

test('BUY + pricingDataAvailable=false → WATCH_PRICING_BLOCKED, never BUY_CANDIDATE', () => {
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: false, currentPrice: null });
  const result = deriveWatchlistState(opp, null);
  assert('state is WATCH_PRICING_BLOCKED', result === 'WATCH_PRICING_BLOCKED');
  assert('state is NOT BUY_CANDIDATE', result !== 'BUY_CANDIDATE');
});

test('BUY + pricingDataAvailable=true but currentPrice=null → WATCH_PRICING_BLOCKED', () => {
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: null });
  const result = deriveWatchlistState(opp, null);
  assert('currentPrice=null blocks BUY_CANDIDATE', result === 'WATCH_PRICING_BLOCKED');
  assert('state is NOT BUY_CANDIDATE', result !== 'BUY_CANDIDATE');
});

test('WATCH_PRICING_BLOCKED + WATCH + pricing ok → WATCH_RESEARCH (pricing unlock)', () => {
  const existing = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_PRICING_BLOCKED' });
  const opp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  assert('unlocked → WATCH_RESEARCH', deriveWatchlistState(opp, existing) === 'WATCH_RESEARCH');
});

test('WATCH_PRICING_BLOCKED + BUY + pricing ok → BUY_CANDIDATE (unlock + buy-ready)', () => {
  const existing = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_PRICING_BLOCKED' });
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  assert('unlocked + BUY → BUY_CANDIDATE', deriveWatchlistState(opp, existing) === 'BUY_CANDIDATE');
});

test('BUY_CANDIDATE + pricing degraded → WATCH_PRICING_BLOCKED', () => {
  const existing = makeEntry({ ticker: 'AAPL', watchlistState: 'BUY_CANDIDATE', latestPricingDataAvailable: true, promotedToBuyAt: RUN1 });
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: false, currentPrice: null });
  assert('pricing degraded → WATCH_PRICING_BLOCKED', deriveWatchlistState(opp, existing) === 'WATCH_PRICING_BLOCKED');
});

test('REJECTED is terminal — BUY + buy-safe pricing does not promote', () => {
  const existing = makeEntry({ ticker: 'AAPL', watchlistState: 'REJECTED' });
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  assert('REJECTED preserved', deriveWatchlistState(opp, existing) === 'REJECTED');
});

test('BOUGHT is terminal — BUY + buy-safe pricing does not change state', () => {
  const existing = makeEntry({ ticker: 'AAPL', watchlistState: 'BOUGHT' });
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  assert('BOUGHT preserved', deriveWatchlistState(opp, existing) === 'BOUGHT');
});

// ---------------------------------------------------------------------------
// updateWatchlistFromDiscoveries — score and timestamp tracking
// ---------------------------------------------------------------------------

test('highestScore keeps historical maximum, latestScore updates', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_RESEARCH', highestScore: 8.5, latestScore: 8.5, latestPricingDataAvailable: true });
  const opp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: true, currentPrice: 215.0, score: score(7.0) }); // lower
  const { entries } = updateWatchlistFromDiscoveries([opp], fileWith([entry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert('highestScore stays 8.5 (not overwritten by 7.0)', u.highestScore === 8.5);
  assert('latestScore updates to 7.0', u.latestScore === 7.0);
});

test('highestScore updates when new score exceeds current max', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_RESEARCH', highestScore: 7.4, latestPricingDataAvailable: true });
  const opp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: true, currentPrice: 215.0, score: score(9.2) });
  const { entries } = updateWatchlistFromDiscoveries([opp], fileWith([entry]), RUN2);
  assert('highestScore updated to 9.2', entries.find((e) => e.ticker === 'AAPL')!.highestScore === 9.2);
});

test('firstSeenAt preserved; lastSeenAt updated each run', () => {
  const entry = makeEntry({
    ticker: 'AAPL', watchlistState: 'WATCH_PRICING_BLOCKED',
    firstSeenAt: '2026-05-01T00:00:00.000Z', lastSeenAt: '2026-05-30T00:00:00.000Z',
  });
  const opp = makeOpp({ ticker: 'AAPL' });
  const { entries } = updateWatchlistFromDiscoveries([opp], fileWith([entry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert('firstSeenAt preserved', u.firstSeenAt === '2026-05-01T00:00:00.000Z');
  assert('lastSeenAt updated to RUN2', u.lastSeenAt === RUN2);
});

// ---------------------------------------------------------------------------
// pricingUnlockedAt — set once
// ---------------------------------------------------------------------------

test('pricingUnlockedAt: null when pricing blocked; set once on first unlock; not overwritten', () => {
  const blockedOpp = makeOpp({ ticker: 'AAPL', pricingDataAvailable: false, currentPrice: null });

  // Run 1: new entry, pricing blocked → pricingUnlockedAt=null
  const { entries: r1 } = updateWatchlistFromDiscoveries([blockedOpp], emptyFile(), RUN1);
  assert('pricingUnlockedAt null when blocked at first appearance', r1[0].pricingUnlockedAt === null);

  // Run 2: pricing unlocks → pricingUnlockedAt set to RUN2
  const unlockedOpp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  const { entries: r2 } = updateWatchlistFromDiscoveries([unlockedOpp], fileWith(r1), RUN2);
  assert('pricingUnlockedAt set to RUN2 on first unlock', r2[0].pricingUnlockedAt === RUN2);

  // Run 3: pricing still ok → pricingUnlockedAt NOT changed
  const { entries: r3 } = updateWatchlistFromDiscoveries([unlockedOpp], fileWith(r2), RUN3);
  assert('pricingUnlockedAt not overwritten on subsequent unlock', r3[0].pricingUnlockedAt === RUN2);
});

test('pricingUnlockedAt set on new entry when pricing immediately ok', () => {
  const opp = makeOpp({ ticker: 'NVDA', state: 'WATCH', pricingDataAvailable: true, currentPrice: 900.0, pricingMethod: 'usd_converted' });
  const { entries } = updateWatchlistFromDiscoveries([opp], emptyFile(), RUN1);
  assert('pricingUnlockedAt set to RUN1 for new entry with immediate pricing', entries[0].pricingUnlockedAt === RUN1);
});

// ---------------------------------------------------------------------------
// promotedToBuyAt — set once
// ---------------------------------------------------------------------------

test('promotedToBuyAt: null before BUY_CANDIDATE; set once on first promotion; not overwritten', () => {
  const watchOpp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });

  // Run 1: new WATCH_RESEARCH entry
  const { entries: r1 } = updateWatchlistFromDiscoveries([watchOpp], emptyFile(), RUN1);
  assert('promotedToBuyAt null before BUY_CANDIDATE', r1[0].promotedToBuyAt === null);

  // Run 2: state improves to BUY → promoted to BUY_CANDIDATE
  const buyOpp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  const { entries: r2 } = updateWatchlistFromDiscoveries([buyOpp], fileWith(r1), RUN2);
  assert('promotedToBuyAt set to RUN2', r2[0].promotedToBuyAt === RUN2);

  // Run 3: still BUY_CANDIDATE → promotedToBuyAt unchanged
  const { entries: r3 } = updateWatchlistFromDiscoveries([buyOpp], fileWith(r2), RUN3);
  assert('promotedToBuyAt not overwritten', r3[0].promotedToBuyAt === RUN2);
});

test('promotedToBuyAt set on new entry that immediately qualifies as BUY_CANDIDATE', () => {
  const buyOpp = makeOpp({ ticker: 'NVDA', state: 'BUY', pricingDataAvailable: true, currentPrice: 900.0, pricingMethod: 'usd_converted' });
  const { entries } = updateWatchlistFromDiscoveries([buyOpp], emptyFile(), RUN1);
  assert('promotedToBuyAt set to RUN1 for immediate BUY_CANDIDATE', entries[0].promotedToBuyAt === RUN1);
});

// ---------------------------------------------------------------------------
// Absent entries — stale logic
// ---------------------------------------------------------------------------

test('absent entry increments consecutiveRunsAbsent; resets consecutiveRunsSeen', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_RESEARCH', consecutiveRunsSeen: 3, consecutiveRunsAbsent: 0, latestPricingDataAvailable: true });
  const { entries } = updateWatchlistFromDiscoveries([], fileWith([entry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert('consecutiveRunsAbsent incremented to 1', u.consecutiveRunsAbsent === 1);
  assert('consecutiveRunsSeen reset to 0', u.consecutiveRunsSeen === 0);
  assert('watchlistState unchanged (below threshold)', u.watchlistState === 'WATCH_RESEARCH');
});

test('absent entry reaching stale threshold → STALE + transition recorded', () => {
  const threshold = WATCHLIST_STALE_AFTER_RUNS as number;
  const entry = makeEntry({
    ticker: 'AAPL',
    watchlistState: 'WATCH_RESEARCH',
    consecutiveRunsAbsent: threshold - 1, // one more absent run triggers STALE
    latestPricingDataAvailable: true,
  });
  const { entries, transitions } = updateWatchlistFromDiscoveries([], fileWith([entry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert(`state is STALE after ${threshold} absent runs`, u.watchlistState === 'STALE');
  assert('STALE transition recorded', transitions.some((t) => t.ticker === 'AAPL' && t.to === 'STALE'));
  assert('consecutiveRunsAbsent equals threshold', u.consecutiveRunsAbsent === threshold);
});

test('already-STALE entry remains STALE without re-firing transition', () => {
  const staleEntry = makeEntry({ ticker: 'AAPL', watchlistState: 'STALE', consecutiveRunsAbsent: 7 });
  const { entries, transitions } = updateWatchlistFromDiscoveries([], fileWith([staleEntry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert('stays STALE', u.watchlistState === 'STALE');
  assert('no duplicate STALE transition', !transitions.some((t) => t.ticker === 'AAPL' && t.to === 'STALE'));
  assert('consecutiveRunsAbsent keeps incrementing', u.consecutiveRunsAbsent === 8);
});

// ---------------------------------------------------------------------------
// STALE reappearance
// ---------------------------------------------------------------------------

test('STALE reappears with pricing blocked → WATCH_PRICING_BLOCKED + transition + counter reset', () => {
  const staleEntry = makeEntry({ ticker: 'AAPL', watchlistState: 'STALE', consecutiveRunsAbsent: 5 });
  const opp = makeOpp({ ticker: 'AAPL', pricingDataAvailable: false, currentPrice: null });
  const { entries, transitions } = updateWatchlistFromDiscoveries([opp], fileWith([staleEntry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert('STALE → WATCH_PRICING_BLOCKED', u.watchlistState === 'WATCH_PRICING_BLOCKED');
  assert('transition from STALE recorded', transitions.some((t) => t.ticker === 'AAPL' && t.from === 'STALE' && t.to === 'WATCH_PRICING_BLOCKED'));
  assert('consecutiveRunsAbsent reset to 0', u.consecutiveRunsAbsent === 0);
});

test('STALE reappears with pricing ok + WATCH → WATCH_RESEARCH', () => {
  const staleEntry = makeEntry({ ticker: 'AAPL', watchlistState: 'STALE', consecutiveRunsAbsent: 5 });
  const opp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  const { entries } = updateWatchlistFromDiscoveries([opp], fileWith([staleEntry]), RUN2);
  assert('STALE → WATCH_RESEARCH', entries.find((e) => e.ticker === 'AAPL')!.watchlistState === 'WATCH_RESEARCH');
});

test('STALE reappears with pricing ok + BUY → BUY_CANDIDATE', () => {
  const staleEntry = makeEntry({ ticker: 'AAPL', watchlistState: 'STALE', consecutiveRunsAbsent: 5 });
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  const { entries } = updateWatchlistFromDiscoveries([opp], fileWith([staleEntry]), RUN2);
  assert('STALE → BUY_CANDIDATE', entries.find((e) => e.ticker === 'AAPL')!.watchlistState === 'BUY_CANDIDATE');
});

// ---------------------------------------------------------------------------
// Terminal state entries
// ---------------------------------------------------------------------------

test('REJECTED: state not auto-promoted; observational metadata updates', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'REJECTED', latestScore: 5.0, highestScore: 5.0 });
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: 215.0, score: score(9.5), pricingMethod: 'usd_converted' });
  const { entries, transitions } = updateWatchlistFromDiscoveries([opp], fileWith([entry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert('REJECTED state preserved', u.watchlistState === 'REJECTED');
  assert('no auto-promotion transition', !transitions.some((t) => t.ticker === 'AAPL'));
  assert('latestScore updated observationally', u.latestScore === 9.5);
  assert('highestScore updated observationally', u.highestScore === 9.5);
  assert('lastSeenAt updated', u.lastSeenAt === RUN2);
});

test('BOUGHT: state not auto-promoted; observational metadata updates', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'BOUGHT', latestScore: 7.0, highestScore: 7.0 });
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: 215.0, score: score(9.0), pricingMethod: 'usd_converted' });
  const { entries, transitions } = updateWatchlistFromDiscoveries([opp], fileWith([entry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert('BOUGHT state preserved', u.watchlistState === 'BOUGHT');
  assert('no auto-promotion transition', !transitions.some((t) => t.ticker === 'AAPL'));
  assert('latestScore updated observationally', u.latestScore === 9.0);
});

test('REJECTED absent: entry kept; consecutiveRunsAbsent NOT incremented (terminal frozen)', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'REJECTED', consecutiveRunsAbsent: 2 });
  const { entries } = updateWatchlistFromDiscoveries([], fileWith([entry]), RUN2);
  const u = entries.find((e) => e.ticker === 'AAPL')!;
  assert('REJECTED entry kept', u !== undefined);
  assert('consecutiveRunsAbsent not incremented for terminal', u.consecutiveRunsAbsent === 2);
});

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

test('transitions include correct from/to/occurredAt/reason fields', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_PRICING_BLOCKED' });
  const opp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  const { transitions } = updateWatchlistFromDiscoveries([opp], fileWith([entry]), RUN2);
  assert('exactly one transition', transitions.length === 1);
  assert('from is WATCH_PRICING_BLOCKED', transitions[0].from === 'WATCH_PRICING_BLOCKED');
  assert('to is WATCH_RESEARCH', transitions[0].to === 'WATCH_RESEARCH');
  assert('occurredAt is RUN2', transitions[0].occurredAt === RUN2);
  assert('reason is non-empty string', typeof transitions[0].reason === 'string' && transitions[0].reason.length > 0);
});

test('no transition emitted when state unchanged', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_PRICING_BLOCKED' });
  const opp = makeOpp({ ticker: 'AAPL', pricingDataAvailable: false, currentPrice: null }); // still blocked
  const { transitions } = updateWatchlistFromDiscoveries([opp], fileWith([entry]), RUN2);
  assert('no transition when state unchanged', transitions.length === 0);
});

test('new entry transition has from=null', () => {
  const opp = makeOpp({ ticker: 'AAPL', pricingDataAvailable: false, currentPrice: null });
  const { transitions } = updateWatchlistFromDiscoveries([opp], emptyFile(), RUN1);
  assert('transition recorded for new entry', transitions.length === 1);
  assert('from is null for new entry', transitions[0].from === null);
  assert('to is WATCH_PRICING_BLOCKED', transitions[0].to === 'WATCH_PRICING_BLOCKED');
});

test('WATCH_RESEARCH → BUY_CANDIDATE transition recorded when state improves', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_RESEARCH', latestPricingDataAvailable: true });
  const opp = makeOpp({ ticker: 'AAPL', state: 'BUY', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  const { entries, transitions } = updateWatchlistFromDiscoveries([opp], fileWith([entry]), RUN2);
  assert('transition to BUY_CANDIDATE', transitions.some((t) => t.from === 'WATCH_RESEARCH' && t.to === 'BUY_CANDIDATE'));
  assert('entry is BUY_CANDIDATE', entries.find((e) => e.ticker === 'AAPL')!.watchlistState === 'BUY_CANDIDATE');
});

test('WATCH_RESEARCH → WATCH_PRICING_BLOCKED when pricing degrades', () => {
  const entry = makeEntry({ ticker: 'AAPL', watchlistState: 'WATCH_RESEARCH', latestPricingDataAvailable: true, pricingUnlockedAt: RUN1 });
  const degradedOpp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: false, currentPrice: null });
  const { entries, transitions } = updateWatchlistFromDiscoveries([degradedOpp], fileWith([entry]), RUN2);
  assert('degraded → WATCH_PRICING_BLOCKED', entries.find((e) => e.ticker === 'AAPL')!.watchlistState === 'WATCH_PRICING_BLOCKED');
  assert('transition recorded', transitions.some((t) => t.from === 'WATCH_RESEARCH' && t.to === 'WATCH_PRICING_BLOCKED'));
});

// ---------------------------------------------------------------------------
// File I/O tests — temp DATA_DIR
// ---------------------------------------------------------------------------

test('readWatchlist: missing file returns empty default without throwing', () => {
  try { fs.unlinkSync(path.join(tmpDir, 'watchlist.json')); } catch { /* ok */ }
  let threw = false;
  let result;
  try { result = readWatchlist(); } catch { threw = true; }
  assert('no exception thrown', !threw);
  assert('entries is empty array', Array.isArray(result?.entries) && result!.entries.length === 0);
});

test('readWatchlist: corrupted JSON returns default without throwing', () => {
  fs.writeFileSync(path.join(tmpDir, 'watchlist.json'), '{ NOT VALID!!! ', 'utf-8');
  let threw = false;
  let result;
  try { result = readWatchlist(); } catch { threw = true; }
  try { fs.unlinkSync(path.join(tmpDir, 'watchlist.json')); } catch { /* ok */ }
  assert('no exception thrown', !threw);
  assert('returns default entries array', Array.isArray(result?.entries));
});

test('persistWatchlist: write+read round-trips correctly', () => {
  try { fs.unlinkSync(path.join(tmpDir, 'watchlist.json')); } catch { /* ok */ }

  const opp = makeOpp({ ticker: 'NVDA', pricingDataAvailable: false, currentPrice: null });
  persistWatchlist([opp], RUN1);

  const result = readWatchlist();
  const entry = result.entries.find((e) => e.ticker === 'NVDA')!;
  assert('entry persisted', entry !== undefined);
  assert('watchlistState round-trips', entry.watchlistState === 'WATCH_PRICING_BLOCKED');
  assert('dataQualityScore is null', entry.dataQualityScore === null);
  assert('watchlistVersion is 1', entry.watchlistVersion === 1);
  assert('pricingUnlockedAt is null (pricing blocked)', entry.pricingUnlockedAt === null);
  assert('lastUpdatedAt updated', result.lastUpdatedAt === RUN1);
});

test('persistWatchlist: second run appends and transitions state', () => {
  try { fs.unlinkSync(path.join(tmpDir, 'watchlist.json')); } catch { /* ok */ }

  // Run 1: blocked
  const blockedOpp = makeOpp({ ticker: 'AAPL', pricingDataAvailable: false, currentPrice: null });
  persistWatchlist([blockedOpp], RUN1);

  // Run 2: pricing unlocks
  const unlockedOpp = makeOpp({ ticker: 'AAPL', state: 'WATCH', pricingDataAvailable: true, currentPrice: 215.0, pricingMethod: 'usd_converted' });
  persistWatchlist([unlockedOpp], RUN2);

  const result = readWatchlist();
  const entry = result.entries.find((e) => e.ticker === 'AAPL')!;
  assert('state transitioned to WATCH_RESEARCH', entry.watchlistState === 'WATCH_RESEARCH');
  assert('pricingUnlockedAt set to RUN2', entry.pricingUnlockedAt === RUN2);
  assert('firstSeenAt preserved as RUN1', entry.firstSeenAt === RUN1);
  assert('consecutiveRunsSeen is 2', entry.consecutiveRunsSeen === 2);
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

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Temp dir: ${tmpDir} (cleaned up)`);
  if (failed > 0) process.exit(1);
}

main();
