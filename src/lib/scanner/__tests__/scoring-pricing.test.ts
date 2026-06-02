// P3-2: scoreRiskReward reliability when an EUR price is missing.
// Run with: npx tsx src/lib/scanner/__tests__/scoring-pricing.test.ts
//
// scoreRiskReward is internal; we exercise it through calcOpportunityScore and read
// score.breakdown.riskReward. Verifies:
//  - currentPrice = null  → neutral fallback 5 (not a real signal; UI renders it as N/A)
//  - currentPrice = 0     → neutral fallback 5, no inflated risk-reward
//  - valid price + upside → a real value > 5 (genuine signal)
//  - the neutral fallback never produces a BUY on its own (score stays modest)

import { calcOpportunityScore, stateFromScore } from '../scoring';
import type { UniverseAsset, RecentHighs, ConcentrationData } from '../../types';

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

const ASSET: UniverseAsset = {
  ticker: 'TEST',
  name: 'Test Asset',
  type: 'stock',
  tags: ['tech'],
  qualityScore: 8,
  isSeed: false,
};

const CONCENTRATION: ConcentrationData = {
  totalPortfolioValue: 10000,
  sectorWeights: {},
  themeWeights: {},
  stockVsEtfRatio: { stocks: 50, etfs: 50 },
  highConcentrationWarnings: [],
};

function highs(currentPrice: number | null, high90d: number): RecentHighs {
  return {
    symbol: 'TEST',
    high30d: high90d,
    high60d: high90d,
    high90d,
    currentPrice,
    drawdown30d: 20,
    drawdown60d: 20,
    drawdown90d: 20,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('currentPrice = null → riskReward falls back to neutral 5', () => {
  const score = calcOpportunityScore(ASSET, highs(null, 100), CONCENTRATION, []);
  assert('riskReward === 5 (neutral fallback)', score.breakdown.riskReward === 5);
});

test('currentPrice = 0 → riskReward falls back to neutral 5 (no inflated signal)', () => {
  const score = calcOpportunityScore(ASSET, highs(0, 100), CONCENTRATION, []);
  assert('riskReward === 5 (neutral fallback)', score.breakdown.riskReward === 5);
});

test('valid price with upside → riskReward is a real value > 5', () => {
  // price 80, high 100 → +25% upside; drawdown 20 → estimatedDownside 10 → rr 2.5 → 8
  const score = calcOpportunityScore(ASSET, highs(80, 100), CONCENTRATION, []);
  assert('riskReward > 5 (genuine signal)', score.breakdown.riskReward > 5);
  assert('riskReward differs from the null/zero fallback', score.breakdown.riskReward !== 5);
});

test('neutral fallback alone does not manufacture a BUY', () => {
  // A null-price asset still scores on drawdown/quality, but the riskReward=5 fallback must not
  // be what tips it into BUY. With a modest profile it should land WATCH/READY, not BUY.
  const score = calcOpportunityScore(ASSET, highs(null, 100), CONCENTRATION, []);
  const state = stateFromScore(score.total, false, 'stock');
  assert('state is not BUY purely from neutral fallback', state !== 'BUY');
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

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
