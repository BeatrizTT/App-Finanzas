// P3-2: end-to-end propagation of pricing reliability through runOpportunityScanner.
// Run with: npx tsx src/lib/scanner/__tests__/scanner-pricing-propagation.test.ts
//
// Verifies the scanner wires the pure helpers onto the returned Opportunity:
//  - extended USD asset with usd_no_fx validation → state WATCH (degraded), pricingMethod
//    'usd_no_fx', pricingDataAvailable false, and a "why not BUY" reason mentioning FX
//  - seed asset from a legacy provider (no validation) with a real price → pricingMethod
//    undefined, pricingDataAvailable true (backward compat, trusted)

import { runOpportunityScanner } from '../scanner';
import { usdNoFxValidation } from '../../pricing/price-validation';
import type {
  UniverseConfig, PortfolioConfig, RecentHighs, ConcentrationData, UniverseAsset,
} from '../../types';

// ---------------------------------------------------------------------------
// Micro-test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const seedStock: UniverseAsset = {
  ticker: 'SEEDX', name: 'Seed Legacy', type: 'stock', tags: ['tech', 'quality'],
  qualityScore: 9, isSeed: true, currency: 'EUR',
};

const extStock: UniverseAsset = {
  ticker: 'EXTUSD', name: 'Extended USD', type: 'stock', tags: ['tech', 'quality'],
  qualityScore: 9, isSeed: false, currency: 'USD',
};

const universe: UniverseConfig = {
  seedStocks: [seedStock],
  seedEtfs: [],
  extendedStocks: [extStock],
  extendedEtfs: [],
  discoveryGates: { minQualityScore: 7, minDrawdownForAlert: 8, maxDrawdownForAlert: 50, minLiquidityScore: 7, maxVolatilityPenalty: 3 },
};

const portfolio: PortfolioConfig = {
  holdings: [],
  cashAvailableEur: 5000,
  targetCashReserveEur: 1000,
};

const concentration: ConcentrationData = {
  totalPortfolioValue: 10000,
  sectorWeights: {},
  themeWeights: {},
  stockVsEtfRatio: { stocks: 50, etfs: 50 },
  highConcentrationWarnings: [],
};

// Strong drawdown profile (18%) → passes gates and scores well above the 6.5 discovery bar.
function strongHighs(ticker: string, currentPrice: number | null, validation?: RecentHighs['validation']): RecentHighs {
  return {
    symbol: ticker,
    high30d: 100, high60d: 100, high90d: 100,
    currentPrice,
    drawdown30d: 18, drawdown60d: 15, drawdown90d: 12,
    validation,
  };
}

const allHighs: Record<string, RecentHighs> = {
  // Seed: legacy provider, real EUR price, no validation metadata.
  SEEDX: strongHighs('SEEDX', 82),
  // Extended: USD price exists upstream but no FX → currentPrice null + usd_no_fx validation.
  EXTUSD: strongHighs('EXTUSD', null, usdNoFxValidation('EXTUSD', 'eodhd')),
};

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const result = await runOpportunityScanner(universe, portfolio, allHighs, concentration);

  console.log('\nExtended USD asset (usd_no_fx) propagation');
  const ext = result.discoveredOpportunities.find((o) => o.ticker === 'EXTUSD');
  assert('extended asset surfaced as a discovery', ext != null);
  if (ext) {
    assert('state degraded to WATCH (not buy-safe)', ext.state === 'WATCH');
    assert('pricingMethod === usd_no_fx', ext.pricingMethod === 'usd_no_fx');
    assert('pricingDataAvailable === false', ext.pricingDataAvailable === false);
    assert('currentPrice stays null (no raw USD as EUR)', ext.currentPrice === null);
    assert('suggestedAmountEur zeroed', ext.suggestedAmountEur.max === 0);
    assert('has a why-not-BUY reason mentioning FX', ext.reasons.some((r) => r.toLowerCase().includes('fx')));
  }

  console.log('\nSeed legacy asset (no validation) propagation');
  const seed = result.stockOpportunities.find((o) => o.ticker === 'SEEDX');
  assert('seed asset surfaced', seed != null);
  if (seed) {
    assert('pricingMethod is undefined (legacy)', seed.pricingMethod === undefined);
    assert('pricingDataAvailable === true (price present, trusted)', seed.pricingDataAvailable === true);
    assert('no FX why-not-buy reason injected for legacy', !seed.reasons.some((r) => r.toLowerCase().includes('sin fx fresco')));
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
