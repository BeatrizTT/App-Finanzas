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
  currencyMismatchValidation,
} from '../price-validation';
import { resolvePriceForInstrument, ChainedPriceProvider } from '../chain-provider';
import { safeFetchPrice } from '../factory';
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
  // Unique symbol per run to avoid cache hits from previous test executions
  const sym = `__TEST_CHAIN_EODHD_FALLBACK_${Date.now()}__`;
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
// Section 3: getRecentHighsForPurpose integration (engine calls with purpose)
// ---------------------------------------------------------------------------

test('getRecentHighsForPurpose: exact_pnl skips unconfirmed, uses confirmed', async () => {
  const sym = '__TEST_FOR_PURPOSE_EXACT__';
  const calls: string[] = [];

  const eodhdProvider: PriceProvider = {
    providerName: 'eodhd',
    getCurrentPrice: async () => { throw new Error('not used'); },
    getHistoricalPrices: async () => ({ symbol: '', prices: [] }),
    getRecentHighs: async () => {
      calls.push('eodhd-getRecentHighs');
      return makeHighs(sym, {
        currentPrice: null,
        validation: unconfirmedCurrencyValidation(sym, 'eodhd', 'EUR'),
      });
    },
  };

  const tdProvider: PriceProvider = {
    providerName: 'twelvedata',
    getCurrentPrice: async () => { throw new Error('not used'); },
    getHistoricalPrices: async () => ({ symbol: '', prices: [] }),
    getRecentHighs: async () => {
      calls.push('td-getRecentHighs');
      return makeHighs(sym, {
        currentPrice: 95,
        validation: confirmedEurValidation(sym, 'twelvedata'),
      });
    },
  };

  const { ChainedPriceProvider } = await import('../chain-provider');
  const chain = new ChainedPriceProvider([eodhdProvider, tdProvider]);

  const result = await chain.getRecentHighsForPurpose(sym, 'exact_pnl');

  assert('chain resolved to twelvedata (exact_pnl-suitable)', result.validation?.provider === 'twelvedata');
  assert('currentPrice non-null for confirmed EUR', result.currentPrice !== null);
  assert('suitableForExactPnl on result', result.validation?.suitableForExactPnl === true);
});

test('getRecentHighsForPurpose: buy_recommendation stops at TD (no need for exact_pnl bar)', async () => {
  const sym = '__TEST_FOR_PURPOSE_BUY__';

  const tdProvider: PriceProvider = {
    providerName: 'twelvedata',
    getCurrentPrice: async () => { throw new Error('not used'); },
    getHistoricalPrices: async () => ({ symbol: '', prices: [] }),
    getRecentHighs: async () =>
      makeHighs(sym, {
        currentPrice: 95,
        validation: usdConvertedValidation(sym, 'twelvedata'),
      }),
  };

  const { ChainedPriceProvider } = await import('../chain-provider');
  const chain = new ChainedPriceProvider([tdProvider]);

  const result = await chain.getRecentHighsForPurpose(sym, 'buy_recommendation');

  assert('buy_recommendation satisfied by usd_converted', isSuitableFor(result.validation, 'buy_recommendation'));
  assert('currentPrice non-null', result.currentPrice !== null);
});

// ---------------------------------------------------------------------------
// P2c-2b: ChainedPriceProvider.getCurrentPrice — no zero fallback
// ---------------------------------------------------------------------------

test('P2c-2b: getCurrentPrice throws when currentPrice=null (no price: 0)', async () => {
  const nullPriceProvider = makeProvider('eodhd', async () =>
    makeHighs('TEST', {
      currentPrice: null,
      validation: unavailableValidation('TEST'),
    })
  );
  const chain = new ChainedPriceProvider([nullPriceProvider]);
  let threw = false;
  let result: { currentPrice: number } | null = null;
  try {
    result = await chain.getCurrentPrice('TEST');
  } catch {
    threw = true;
  }
  assert('getCurrentPrice throws when currentPrice=null', threw);
  assert('no price: 0 emitted', result === null);
});

test('P2c-2b: validated_usd_needs_fx without FX → getCurrentPrice throws (not price: 0)', async () => {
  const usdNoFxProvider = makeProvider('eodhd', async () =>
    makeHighs('NVDA', {
      currentPrice: null,
      validation: { ...usdNoFxValidation('NVDA', 'eodhd'), note: 'USD quote validated but FX missing' },
    })
  );
  const chain = new ChainedPriceProvider([usdNoFxProvider]);
  let threw = false;
  try {
    await chain.getCurrentPrice('NVDA');
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : '';
    assert('error message names the symbol', msg.includes('NVDA'));
    assert('error message names the method', msg.includes('usd_no_fx'));
  }
  assert('throws for validated_usd_needs_fx without FX', threw);
});

test('P2c-2b: rejected_mismatch → getCurrentPrice throws (not price: 0)', async () => {
  const mismatchProvider = makeProvider('eodhd', async () =>
    makeHighs('CNDX', {
      currentPrice: null,
      validation: currencyMismatchValidation('CNDX', 'eodhd', 'USD', 'GBP'),
    })
  );
  const chain = new ChainedPriceProvider([mismatchProvider]);
  let threw = false;
  try {
    await chain.getCurrentPrice('CNDX');
  } catch {
    threw = true;
  }
  assert('throws for rejected_mismatch (CNDX USD/GBP mismatch)', threw);
});

test('P2c-2b: safeFetchPrice returns null when chain throws (no price: 0 escapes)', async () => {
  const nullPriceProvider: PriceProvider = {
    providerName: 'null-price-mock',
    async getCurrentPrice() {
      throw new Error('[Chain] No usable price for TEST (method: unavailable)');
    },
    async getHistoricalPrices() { return { symbol: '', prices: [] }; },
    async getRecentHighs() {
      return makeHighs('TEST', { currentPrice: null, validation: unavailableValidation('TEST') });
    },
  };
  const result = await safeFetchPrice('TEST', nullPriceProvider);
  assert('safeFetchPrice returns null when getCurrentPrice throws', result === null);
  assert('no price: 0 from safeFetchPrice', result !== null ? result.price !== 0 : true);
});

test('P2c-2b: getCurrentPrice works correctly for validated_exact_eur (EUR price non-null)', async () => {
  const eurProvider = makeProvider('eodhd', async () =>
    makeHighs('ASML', {
      currentPrice: 1300,
      validation: confirmedEurValidation('ASML', 'eodhd'),
    })
  );
  const chain = new ChainedPriceProvider([eurProvider]);
  const result = await chain.getCurrentPrice('ASML');
  assert('currentPrice is 1300', result.currentPrice === 1300);
  assert('currency is EUR', result.currency === 'EUR');
  assert('currentPrice is not 0', result.currentPrice !== 0);
  assert('currentPrice is not null', result.currentPrice != null);
});

test('P2c-2b: legacy provider with non-null currentPrice still works via chain', async () => {
  // Legacy providers (Yahoo, mock) set currentPrice directly — chain must not break them
  const legacyProvider = makeProvider('yahoo', async () =>
    makeHighs('MSFT', {
      currentPrice: 415.5,
    })
  );
  const chain = new ChainedPriceProvider([legacyProvider]);
  const result = await chain.getCurrentPrice('MSFT');
  assert('legacy provider: currentPrice 415.5 passes through', result.currentPrice === 415.5);
  assert('legacy provider: no crash', result !== null);
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
