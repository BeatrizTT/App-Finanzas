// Inline tests for buildPortfolioHighs — FX source-of-truth logic.
// Run with: npx tsx src/lib/engine/__tests__/portfolio-highs.test.ts
//
// Verifies:
//  - usd_converted (suitableForExactPnl=true) is NOT double-converted
//  - usd_no_fx (suitableForExactPnl=false) is nulled for portfolio P&L
//  - currency_unconfirmed (suitableForExactPnl=false) is nulled
//  - proxy_drawdown_only (suitableForExactPnl=false) is nulled
//  - confirmed EUR (suitableForExactPnl=true) passes through unchanged
//  - legacy provider (no validation) applies FX for USD holdings
//  - legacy provider EUR holding skips FX

import { buildPortfolioHighs } from '../portfolio-highs';
import {
  usdConvertedValidation,
  usdNoFxValidation,
  unconfirmedCurrencyValidation,
  confirmedEurValidation,
  proxyValidation,
} from '../../pricing/price-validation';
import type { RecentHighs } from '../../types';

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

function makeHighs(symbol: string, overrides: Partial<RecentHighs> = {}): RecentHighs {
  return {
    symbol,
    high30d: 110, high60d: 115, high90d: 120,
    currentPrice: 95,
    drawdown30d: 13, drawdown60d: 17, drawdown90d: 21,
    ...overrides,
  };
}

const EUR_USD = 1.1;
const USD_TICKERS = new Set(['NVDA', 'MSFT', 'AMZN']);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('usd_converted: NOT double-converted (price already EUR)', () => {
  // Chain applied FX inside the provider → currentPrice is already EUR
  // Engine must NOT divide again by eurUsdRate
  const allHighs = {
    NVDA: makeHighs('NVDA', {
      currentPrice: 85.0,  // already in EUR (e.g., $93.5 / 1.1 = 85.0)
      validation: usdConvertedValidation('NVDA', 'twelvedata'),
    }),
  };
  const result = buildPortfolioHighs(allHighs, USD_TICKERS, EUR_USD);
  assert('currentPrice passed through unchanged (85.0)', result.NVDA.currentPrice === 85.0);
  assert('not divided again (would be 77.27 if double-converted)', result.NVDA.currentPrice !== 85.0 / EUR_USD);
});

test('usd_no_fx: nulled out for portfolio P&L', () => {
  const allHighs = {
    NVDA: makeHighs('NVDA', {
      currentPrice: 450,
      validation: usdNoFxValidation('NVDA', 'eodhd'),
    }),
  };
  const result = buildPortfolioHighs(allHighs, USD_TICKERS, EUR_USD);
  assert('currentPrice is null (not suitable for exact P&L)', result.NVDA.currentPrice === null);
  assert('drawdowns preserved (currency-independent)', result.NVDA.drawdown30d === 13);
});

test('currency_unconfirmed: nulled out for portfolio P&L', () => {
  const allHighs = {
    ASML: makeHighs('ASML', {
      currentPrice: null,  // EODHD EUR instruments already return null
      validation: unconfirmedCurrencyValidation('ASML', 'eodhd', 'EUR'),
    }),
  };
  const result = buildPortfolioHighs(allHighs, new Set(), EUR_USD);
  assert('currentPrice remains null', result.ASML.currentPrice === null);
});

test('proxy_drawdown_only: nulled out for portfolio P&L', () => {
  const allHighs = {
    CNDX: makeHighs('CNDX', {
      currentPrice: 480,  // USD proxy price — not usable for EUR P&L
      validation: proxyValidation('CNDX', 'twelvedata'),
    }),
  };
  const result = buildPortfolioHighs(allHighs, USD_TICKERS, EUR_USD);
  assert('proxy currentPrice is null for P&L', result.CNDX.currentPrice === null);
});

test('confirmed EUR: passes through unchanged (no FX applied)', () => {
  const allHighs = {
    ASML: makeHighs('ASML', {
      currentPrice: 650.0,  // EUR directly from provider
      validation: confirmedEurValidation('ASML', 'twelvedata'),
    }),
  };
  const result = buildPortfolioHighs(allHighs, new Set(), EUR_USD);
  assert('EUR price unchanged', result.ASML.currentPrice === 650.0);
});

test('legacy provider: FX applied for USD holding', () => {
  // Twelve Data returns USD price, no validation metadata
  const allHighs = {
    NVDA: makeHighs('NVDA', { currentPrice: 110.0 }),  // no validation
  };
  const result = buildPortfolioHighs(allHighs, USD_TICKERS, EUR_USD);
  const expected = 110.0 / EUR_USD;  // 100.0
  assert('legacy USD: FX applied', Math.abs((result.NVDA.currentPrice ?? -1) - expected) < 0.01);
  assert('legacy USD: not same as raw', result.NVDA.currentPrice !== 110.0);
});

test('legacy provider: EUR holding skips FX', () => {
  // ASML in config has currency=EUR, so not in usdTickers
  const allHighs = {
    ASML: makeHighs('ASML', { currentPrice: 650.0 }),  // no validation
  };
  const result = buildPortfolioHighs(allHighs, new Set() /* ASML not USD */, EUR_USD);
  assert('legacy EUR: price passed through', result.ASML.currentPrice === 650.0);
});

test('legacy provider: null currentPrice stays null', () => {
  const allHighs = {
    NVDA: makeHighs('NVDA', { currentPrice: null }),  // no validation, no price
  };
  const result = buildPortfolioHighs(allHighs, USD_TICKERS, EUR_USD);
  assert('null stays null (no FX on null)', result.NVDA.currentPrice === null);
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
