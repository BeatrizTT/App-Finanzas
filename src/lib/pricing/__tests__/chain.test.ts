// Inline tests for P2b-3: purpose-aware provider chain and validation flags.
// No test framework required. Run with: npx tsx src/lib/pricing/__tests__/chain.test.ts
//
// Tests verify:
//  1. isSuitableFor behaves correctly for all validation types and purposes
//  2. EODHD currency_unconfirmed does NOT block chain for buy_recommendation
//  3. Chain stops at first suitable provider result
//  4. Provider errors produce fallback, never crash
//  5. All providers fail → unavailable result (no crash)
//  6. Purpose bar: exact_pnl requires more than drawdown
//  7. Stale cache logic: stale EUR-confirmed can serve exact_pnl
//  8. usd_no_fx blocks exact_pnl

import {
  isSuitableFor,
  unconfirmedCurrencyValidation,
  proxyValidation,
  usdNoFxValidation,
  confirmedEurValidation,
  usdConvertedValidation,
  unavailableValidation,
  cachedLastValidValidation,
} from '../price-validation';
import { resolvePriceForInstrument } from '../chain-provider';
import type { RecentHighs } from '../../types';
import type { PriceProvider } from '../interface';

// ---------------------------------------------------------------------------
// Micro-test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function assert(description: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    failed++;
  }
}

function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHighs(symbol: string, overrides: Partial<RecentHighs> = {}): RecentHighs {
  return {
    symbol,
    high30d: 110, high60d: 115, high90d: 120,
    currentPrice: 95,
    drawdown30d: 13.6, drawdown60d: 17.4, drawdown90d: 20.8,
    ...overrides,
  };
}

function makeProvider(
  name: string,
  getHighsFn: (symbol: string) => Promise<RecentHighs>
): PriceProvider {
  return {
    providerName: name,
    async getCurrentPrice() { throw new Error('not used in chain tests'); },
    async getHistoricalPrices() { return { symbol: '', prices: [] }; },
    getRecentHighs: getHighsFn,
  };
}

// ---------------------------------------------------------------------------
// Section 1: isSuitableFor — validation factory correctness
// ---------------------------------------------------------------------------

test('isSuitableFor: currency_unconfirmed (EODHD)', () => {
  const v = unconfirmedCurrencyValidation('ASML', 'eodhd', 'EUR');
  assert('fails exact_pnl', !isSuitableFor(v, 'exact_pnl'));
  assert('fails buy_recommendation', !isSuitableFor(v, 'buy_recommendation'));
  assert('passes drawdown', isSuitableFor(v, 'drawdown'));
  assert('passes display', isSuitableFor(v, 'display'));
});

test('isSuitableFor: proxy_drawdown_only', () => {
  const v = proxyValidation('CNDX', 'twelvedata');
  assert('fails exact_pnl', !isSuitableFor(v, 'exact_pnl'));
  assert('fails buy_recommendation', !isSuitableFor(v, 'buy_recommendation'));
  assert('passes drawdown', isSuitableFor(v, 'drawdown'));
  assert('passes display', isSuitableFor(v, 'display'));
});

test('isSuitableFor: usd_no_fx blocks P&L and buy sizing', () => {
  const v = usdNoFxValidation('NVDA', 'eodhd');
  assert('fails exact_pnl', !isSuitableFor(v, 'exact_pnl'));
  assert('fails buy_recommendation', !isSuitableFor(v, 'buy_recommendation'));
  assert('passes drawdown', isSuitableFor(v, 'drawdown'));
});

test('isSuitableFor: confirmed EUR — all purposes', () => {
  const v = confirmedEurValidation('ASML', 'twelvedata');
  assert('passes exact_pnl', isSuitableFor(v, 'exact_pnl'));
  assert('passes buy_recommendation', isSuitableFor(v, 'buy_recommendation'));
  assert('passes drawdown', isSuitableFor(v, 'drawdown'));
  assert('passes display', isSuitableFor(v, 'display'));
});

test('isSuitableFor: usd_converted — all purposes', () => {
  const v = usdConvertedValidation('NVDA', 'twelvedata');
  assert('passes exact_pnl', isSuitableFor(v, 'exact_pnl'));
  assert('passes buy_recommendation', isSuitableFor(v, 'buy_recommendation'));
  assert('passes drawdown', isSuitableFor(v, 'drawdown'));
});

test('isSuitableFor: unavailable — nothing', () => {
  const v = unavailableValidation('NVDA');
  assert('fails exact_pnl', !isSuitableFor(v, 'exact_pnl'));
  assert('fails buy_recommendation', !isSuitableFor(v, 'buy_recommendation'));
  assert('fails drawdown', !isSuitableFor(v, 'drawdown'));
  assert('fails display', !isSuitableFor(v, 'display'));
});

test('isSuitableFor: stale EUR-confirmed cache → exact_pnl OK', () => {
  const v = cachedLastValidValidation('ASML', 'EUR', 'EUR');
  assert('passes exact_pnl', isSuitableFor(v, 'exact_pnl'));
  assert('passes buy_recommendation', isSuitableFor(v, 'buy_recommendation'));
  assert('passes drawdown', isSuitableFor(v, 'drawdown'));
});

test('isSuitableFor: stale USD→EUR cache → drawdown only', () => {
  const v = cachedLastValidValidation('NVDA', 'USD', 'EUR');
  assert('fails exact_pnl', !isSuitableFor(v, 'exact_pnl'));
  assert('fails buy_recommendation', !isSuitableFor(v, 'buy_recommendation'));
  assert('passes drawdown', isSuitableFor(v, 'drawdown'));
});

// ---------------------------------------------------------------------------
// Section 2: Provider chain resolution
// Uses unique fake symbols per test to avoid cross-test cache collisions.
// ---------------------------------------------------------------------------

test('Chain: EODHD unconfirmed does NOT block chain for buy_recommendation', async () => {
  // EODHD returns unconfirmed (drawdown-only); Twelve Data returns converted (full)
  const sym = '__TEST_CHAIN_EODHD_FALLBACK__';
  let eodhdCalled = false;
  let tdCalled = false;

  const eodhdProvider = makeProvider('eodhd', async () => {
    eodhdCalled = true;
    return makeHighs(sym, {
      currentPrice: null,
      validation: unconfirmedCurrencyValidation(sym, 'eodhd', 'EUR'),
    });
  });

  const tdProvider = makeProvider('twelvedata', async () => {
    tdCalled = true;
    return makeHighs(sym, {
      currentPrice: 90,
      validation: usdConvertedValidation(sym, 'twelvedata'),
    });
  });

  const result = await resolvePriceForInstrument(sym, 'buy_recommendation', [eodhdProvider, tdProvider]);

  assert('EODHD was tried first', eodhdCalled);
  assert('Twelve Data was tried after EODHD insufficient', tdCalled);
  assert('Result provider is twelvedata', result.validation?.provider === 'twelvedata');
  assert('Result is suitable for buy_recommendation', isSuitableFor(result.validation, 'buy_recommendation'));
  assert('currentPrice is non-null', result.currentPrice !== null);
});

test('Chain: stops at first provider that satisfies purpose', async () => {
  const sym = '__TEST_CHAIN_STOP_EARLY__';
  let yahooCalled = false;

  const tdProvider = makeProvider('twelvedata', async () =>
    makeHighs(sym, {
      currentPrice: 90,
      validation: usdConvertedValidation(sym, 'twelvedata'),
    })
  );

  const yahooProvider = makeProvider('yahoo', async () => {
    yahooCalled = true;
    return makeHighs(sym, {});
  });

  await resolvePriceForInstrument(sym, 'buy_recommendation', [tdProvider, yahooProvider]);

  assert('Yahoo was NOT called when Twelve Data already satisfied purpose', !yahooCalled);
});

test('Chain: provider error produces fallback (no crash)', async () => {
  const sym = '__TEST_CHAIN_PROVIDER_ERROR__';

  const failProvider = makeProvider('eodhd', async () => {
    throw new Error('quota exceeded — test error');
  });

  const yahooProvider = makeProvider('yahoo', async () =>
    makeHighs(sym, {
      currentPrice: 150,
      validation: usdConvertedValidation(sym, 'yahoo'),
    })
  );

  let threw = false;
  let result: RecentHighs | null = null;

  try {
    result = await resolvePriceForInstrument(sym, 'buy_recommendation', [failProvider, yahooProvider]);
  } catch {
    threw = true;
  }

  assert('No throw when first provider fails', !threw);
  assert('Result came from fallback provider (yahoo)', result?.validation?.provider === 'yahoo');
  assert('currentPrice available from fallback', (result?.currentPrice ?? 0) > 0);
});

test('Chain: all providers fail → unavailable (no crash)', async () => {
  const sym = '__TEST_CHAIN_ALL_FAIL__';

  const failA = makeProvider('eodhd', async () => { throw new Error('network error'); });
  const failB = makeProvider('twelvedata', async () => { throw new Error('timeout'); });

  let threw = false;
  let result: RecentHighs | null = null;

  try {
    result = await resolvePriceForInstrument(sym, 'buy_recommendation', [failA, failB]);
  } catch {
    threw = true;
  }

  assert('No throw when all providers fail', !threw);
  assert('Validation method is unavailable', result?.validation?.method === 'unavailable');
  assert('currentPrice is null', result?.currentPrice === null);
});

test('Chain: exact_pnl bars unconfirmed; drawdown accepts it', async () => {
  const symDd = '__TEST_CHAIN_PURPOSE_DD__';
  const symPnl = '__TEST_CHAIN_PURPOSE_PNL__';

  const unconfirmedResult = (sym: string) =>
    makeHighs(sym, {
      currentPrice: null,
      validation: unconfirmedCurrencyValidation(sym, 'eodhd', 'USD'),
    });

  const provider = makeProvider('eodhd', async (sym) => unconfirmedResult(sym));

  const resultForDrawdown = await resolvePriceForInstrument(symDd, 'drawdown', [provider]);
  const resultForPnl = await resolvePriceForInstrument(symPnl, 'exact_pnl', [provider]);

  assert('Drawdown: unconfirmed result is returned (satisfies drawdown)', isSuitableFor(resultForDrawdown.validation, 'drawdown'));
  assert('Exact P&L: best available is returned but not suitable', !isSuitableFor(resultForPnl.validation, 'exact_pnl'));
  // The chain still returns something (the best candidate) — it does not crash or return null
  assert('Exact P&L: result object exists', resultForPnl.validation !== undefined);
});

test('Chain: missing FX → usd_no_fx not suitable for exact_pnl', async () => {
  const sym = '__TEST_CHAIN_NO_FX__';

  const provider = makeProvider('eodhd', async () =>
    makeHighs(sym, {
      currentPrice: 450,
      validation: usdNoFxValidation(sym, 'eodhd'),
    })
  );

  const result = await resolvePriceForInstrument(sym, 'exact_pnl', [provider]);

  assert('usd_no_fx: not suitable for exact_pnl', !isSuitableFor(result.validation, 'exact_pnl'));
  assert('usd_no_fx: suitable for drawdown', isSuitableFor(result.validation, 'drawdown'));
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  for (const { name, fn } of tests) {
    console.log(`\n${name}`);
    try {
      await fn();
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
