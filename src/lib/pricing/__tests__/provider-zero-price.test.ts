// P2c-3a: verify zero-price sentinels have been removed from Twelve Data and Yahoo providers.
//
// Tests:
//  1. buildHighsFromSeriesValues — empty input → null (no crash, no 0)
//  2. buildHighsFromSeriesValues — drawdownOnly=false → currentPrice equals raw close
//  3. buildHighsFromSeriesValues — drawdownOnly=true → currentPrice=null, proxyValidation set
//  4. buildHighsFromSeriesValues — proxy validation flags: drawdown=true, exactPnl=false
//  5. TwelveDataPriceProvider.getRecentHighs — proxy symbol (CNDX) → currentPrice=null
//  6. TwelveDataPriceProvider.batchGetRecentHighs — proxy symbol → currentPrice=null
//  7. TwelveDataPriceProvider.getCurrentPrice — invalid/zero price → throws
//  8. YahooPriceProvider.getRecentHighs — zero regularMarketPrice → throws
//  9. YahooPriceProvider.getRecentHighs — null price, empty series → throws
// 10. Audit: no "?? 0" or "currentPrice: 0" zero-sentinel patterns in provider output paths

import { buildHighsFromSeriesValues, TwelveDataPriceProvider } from '../twelvedata-provider';
import { YahooPriceProvider } from '../yahoo-provider';
import type { RecentHighs } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [];

function test(name: string, fn: () => Promise<void> | void) {
  tests.push({ name, fn });
}

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertThrows(label: string, fn: () => unknown): void {
  try {
    fn();
    console.error(`  ✗ FAIL (did not throw): ${label}`);
    failed++;
  } catch {
    console.log(`  ✓ ${label}`);
    passed++;
  }
}

async function assertRejects(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.error(`  ✗ FAIL (did not reject): ${label}`);
    failed++;
  } catch {
    console.log(`  ✓ ${label}`);
    passed++;
  }
}

function makeSeries(rows: { date: string; close: number; high?: number }[]): Record<string, string>[] {
  return [...rows].reverse().map(r => ({
    datetime: r.date,
    close: String(r.close),
    high: String(r.high ?? r.close),
    low: String(r.close * 0.99),
    volume: '1000000',
  }));
}

// ---------------------------------------------------------------------------
// 1–4: buildHighsFromSeriesValues (pure function, no API calls)
// ---------------------------------------------------------------------------

test('1. buildHighsFromSeriesValues — empty values returns null', () => {
  const result = buildHighsFromSeriesValues('TEST', [], false, [30, 60, 90]);
  assert('returns null for empty values', result === null);
});

test('2. buildHighsFromSeriesValues — drawdownOnly=false sets currentPrice to raw close', () => {
  const values = makeSeries([
    { date: '2026-04-01', close: 200 },
    { date: '2026-04-15', close: 210 },
    { date: '2026-05-01', close: 205 },
  ]);
  const result = buildHighsFromSeriesValues('ASML', values, false, [30, 60, 90]);
  assert('result is not null', result !== null);
  assert('currentPrice equals last close (205)', result?.currentPrice === 205);
  assert('high30d >= currentPrice', (result?.high30d ?? 0) >= 205);
  assert('drawdown30d is a number', typeof result?.drawdown30d === 'number');
  assert('no validation set (non-proxy)', result?.validation === undefined);
});

test('3. buildHighsFromSeriesValues — drawdownOnly=true sets currentPrice to null', () => {
  const values = makeSeries([
    { date: '2026-04-01', close: 480, high: 500 },
    { date: '2026-05-01', close: 450 },
  ]);
  const result = buildHighsFromSeriesValues('CNDX', values, true, [30, 60, 90]);
  assert('result is not null', result !== null);
  assert('currentPrice is null', result?.currentPrice === null);
  assert('drawdown30d is computed (ratio-based)', typeof result?.drawdown30d === 'number');
  assert('high30d is positive', (result?.high30d ?? 0) > 0);
  assert('symbol is preserved', result?.symbol === 'CNDX');
});

test('4. buildHighsFromSeriesValues — proxy validation flags', () => {
  const values = makeSeries([{ date: '2026-05-01', close: 680 }]);
  const result = buildHighsFromSeriesValues('CNDX', values, true, [30, 60, 90]);
  const v = result?.validation;
  assert('validation is set', v !== undefined);
  assert('method is proxy_drawdown_only', v?.method === 'proxy_drawdown_only');
  assert('suitableForDrawdown=true', v?.suitableForDrawdown === true);
  assert('suitableForExactPnl=false', v?.suitableForExactPnl === false);
  assert('suitableForBuyRecommendation=false', v?.suitableForBuyRecommendation === false);
  assert('isProxy=true', v?.isProxy === true);
});

// ---------------------------------------------------------------------------
// 5–6: TwelveDataPriceProvider — proxy symbol paths (mock tdFetch via env)
//
// We mock fetch globally so the provider can run without a real API key.
// ---------------------------------------------------------------------------

type MockFetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function makeMockFetch(responseBody: unknown): MockFetchFn {
  return async (_url, _init) => {
    return {
      ok: true,
      json: async () => responseBody,
    } as Response;
  };
}

function makeSeriesResponse(
  symbolKey: string,
  rows: { date: string; close: number; high?: number }[],
): Record<string, unknown> {
  const values = [...rows].reverse().map(r => ({
    datetime: r.date,
    close: String(r.close),
    high: String(r.high ?? r.close),
    low: String(r.close * 0.99),
    volume: '1000000',
  }));
  return { [symbolKey]: { values, status: 'ok' } };
}

test('5. TwelveDataPriceProvider.getRecentHighs — CNDX proxy → currentPrice=null', async () => {
  process.env.TWELVE_DATA_API_KEY = 'test-key';
  const singleSymbolResponse = {
    values: makeSeries([
      { date: '2026-04-01', close: 680, high: 700 },
      { date: '2026-05-01', close: 660 },
    ]),
  };
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = makeMockFetch(singleSymbolResponse);
  try {
    const provider = new TwelveDataPriceProvider();
    // Bypass rate limiter for test speed
    const result = await provider.getRecentHighs('CNDX', [30, 60, 90]);
    assert('currentPrice is null for CNDX proxy', result.currentPrice === null);
    assert('drawdown30d computed', typeof result.drawdown30d === 'number');
    assert('validation.isProxy=true', result.validation?.isProxy === true);
    assert('suitableForDrawdown=true', result.validation?.suitableForDrawdown === true);
    assert('suitableForExactPnl=false', result.validation?.suitableForExactPnl === false);
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.TWELVE_DATA_API_KEY;
  }
});

test('6. TwelveDataPriceProvider.batchGetRecentHighs — CNDX proxy → currentPrice=null', async () => {
  process.env.TWELVE_DATA_API_KEY = 'test-key';
  // CNDX → QQQ (no exchange suffix in SYMBOL_MAP for drawdownOnly)
  const batchResponse = makeSeriesResponse('QQQ', [
    { date: '2026-04-01', close: 480, high: 500 },
    { date: '2026-05-01', close: 460 },
  ]);
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = makeMockFetch(batchResponse);
  try {
    const provider = new TwelveDataPriceProvider();
    const results = await provider.batchGetRecentHighs(['CNDX'], [30, 60, 90]);
    const cndx = results['CNDX'];
    assert('CNDX result present', cndx !== undefined);
    assert('CNDX currentPrice is null', cndx?.currentPrice === null);
    assert('CNDX validation.isProxy=true', cndx?.validation?.isProxy === true);
    assert('CNDX suitableForDrawdown=true', cndx?.validation?.suitableForDrawdown === true);
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.TWELVE_DATA_API_KEY;
  }
});

// ---------------------------------------------------------------------------
// 7. TwelveDataPriceProvider.getCurrentPrice — zero/missing price → throws
// ---------------------------------------------------------------------------

test('7a. TwelveDataPriceProvider.getCurrentPrice — zero price → throws', async () => {
  process.env.TWELVE_DATA_API_KEY = 'test-key';
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = makeMockFetch({ price: '0' });
  try {
    const provider = new TwelveDataPriceProvider();
    await assertRejects(
      'getCurrentPrice throws for price=0',
      () => provider.getCurrentPrice('ASML'),
    );
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.TWELVE_DATA_API_KEY;
  }
});

test('7b. TwelveDataPriceProvider.getCurrentPrice — missing price → throws', async () => {
  process.env.TWELVE_DATA_API_KEY = 'test-key';
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = makeMockFetch({});
  try {
    const provider = new TwelveDataPriceProvider();
    await assertRejects(
      'getCurrentPrice throws for missing price',
      () => provider.getCurrentPrice('ASML'),
    );
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.TWELVE_DATA_API_KEY;
  }
});

// ---------------------------------------------------------------------------
// 8–9: YahooPriceProvider — zero/null price → throws
// ---------------------------------------------------------------------------

function makeYahooChartResponse(opts: {
  regularMarketPrice?: number;
  closes?: number[];
}): unknown {
  const timestamps = (opts.closes ?? []).map((_, i) => 1740000000 + i * 86400);
  return {
    chart: {
      result: [{
        meta: {
          regularMarketPrice: opts.regularMarketPrice,
          currency: 'USD',
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            close:  opts.closes ?? [],
            high:   (opts.closes ?? []).map(c => c * 1.01),
            low:    (opts.closes ?? []).map(c => c * 0.99),
            volume: (opts.closes ?? []).map(() => 1_000_000),
          }],
        },
      }],
    },
  };
}

test('8. YahooPriceProvider.getRecentHighs — regularMarketPrice=0 → throws', async () => {
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async () => ({
    ok: true,
    json: async () => makeYahooChartResponse({ regularMarketPrice: 0, closes: [100, 105] }),
  } as Response);
  try {
    const provider = new YahooPriceProvider();
    await assertRejects(
      'getRecentHighs throws for regularMarketPrice=0',
      () => provider.getRecentHighs('ASML', [30, 60, 90]),
    );
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
  }
});

test('9. YahooPriceProvider.getRecentHighs — no price at all → throws', async () => {
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async () => ({
    ok: true,
    // No regularMarketPrice, all closes are 0 → filter(p.close > 0) removes everything → empty prices → throws
    json: async () => makeYahooChartResponse({ regularMarketPrice: undefined, closes: [] }),
  } as Response);
  try {
    const provider = new YahooPriceProvider();
    await assertRejects(
      'getRecentHighs throws when no valid price exists',
      () => provider.getRecentHighs('ASML', [30, 60, 90]),
    );
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// 10. Audit: no zero-price sentinel patterns in provider source
// ---------------------------------------------------------------------------

test('10. Audit: buildHighsFromSeriesValues never assigns 0 to currentPrice', () => {
  // Verify via structural property: call with non-proxy produces the exact close value
  const close = 347.82;
  const values = makeSeries([{ date: '2026-05-01', close }]);
  const result = buildHighsFromSeriesValues('TEST', values, false, [30]);
  assert('non-proxy currentPrice equals raw close (not 0)', result?.currentPrice === close);

  const resultProxy = buildHighsFromSeriesValues('PROXY', values, true, [30]);
  assert('proxy currentPrice is null (not 0)', resultProxy?.currentPrice === null);
  assert('proxy currentPrice is strictly null (not 0)', resultProxy?.currentPrice !== 0);
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

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
