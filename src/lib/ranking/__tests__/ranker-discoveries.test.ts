// P3-2: getTopDiscoveries WATCH visibility + ordering contract.
// Run with: npx tsx src/lib/ranking/__tests__/ranker-discoveries.test.ts
//
// Verifies:
//  - WATCH-only list is returned (not empty) when no BUY/READY exists
//  - BUY/READY_TO_BUY always rank above WATCH, even when a WATCH has a higher score
//  - within a group, higher score ranks first
//  - cap of 5 is enforced
//  - empty input → empty output
//  - AVOID/REVIEW_FOR_TRIM are excluded

import { getTopDiscoveries } from '../ranker';
import type { Opportunity, OpportunityState, OpportunityScore } from '../../types';

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
      assetQuality: 0, drawdownOpportunity: 0, trendQuality: 0, relativeStrength: 0,
      diversificationFit: 0, sectorFit: 0, riskReward: 0, portfolioFit: 0, marketRegimeFit: 0,
    },
  };
}

function opp(ticker: string, state: OpportunityState, total: number): Opportunity {
  return {
    ticker,
    name: ticker,
    type: 'stock',
    tags: [],
    isSeedUniverse: false,
    score: score(total),
    state,
    currentPrice: null,
    currency: 'USD',
    drawdown: { drawdown30d: 0, drawdown60d: 0, drawdown90d: 0, maxDrawdown: 0, primaryWindow: '90d' },
    reasons: [],
    suggestedAmountEur: { min: 0, max: 0 },
    confidence: 'low',
    qualityGates: { liquidity: true, quality: true, volatility: true, portfolioFit: true, riskReward: true, notSpeculative: true },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('WATCH-only list is surfaced (panel never falsely empty)', () => {
  const result = getTopDiscoveries([opp('A', 'WATCH', 7.0), opp('B', 'WATCH', 6.8)]);
  assert('returns 2 WATCH items', result.length === 2);
  assert('highest WATCH first', result[0].ticker === 'A');
});

test('BUY/READY rank above WATCH even when WATCH scores higher', () => {
  const result = getTopDiscoveries([
    opp('WATCH_HI', 'WATCH', 9.5),
    opp('BUY_LO', 'BUY', 7.6),
    opp('READY_MID', 'READY_TO_BUY', 6.6),
  ]);
  assert('BUY first', result[0].ticker === 'BUY_LO');
  assert('READY second', result[1].ticker === 'READY_MID');
  assert('WATCH last despite highest score', result[2].ticker === 'WATCH_HI');
});

test('within a group, higher score ranks first', () => {
  const result = getTopDiscoveries([opp('B', 'BUY', 7.6), opp('A', 'BUY', 8.2)]);
  assert('A (8.2) before B (7.6)', result[0].ticker === 'A' && result[1].ticker === 'B');
});

test('cap of 5 is enforced', () => {
  const many = Array.from({ length: 8 }, (_, i) => opp(`W${i}`, 'WATCH', 7 - i * 0.1));
  const result = getTopDiscoveries(many);
  assert('returns at most 5', result.length === 5);
});

test('empty input → empty output', () => {
  assert('empty stays empty', getTopDiscoveries([]).length === 0);
});

test('AVOID and REVIEW_FOR_TRIM are excluded', () => {
  const result = getTopDiscoveries([opp('AV', 'AVOID', 9), opp('RT', 'REVIEW_FOR_TRIM', 9), opp('W', 'WATCH', 6)]);
  assert('only WATCH survives', result.length === 1 && result[0].ticker === 'W');
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
