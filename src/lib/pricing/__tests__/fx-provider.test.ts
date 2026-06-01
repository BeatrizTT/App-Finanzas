// P2c-3: FX provider tests + EODHD integration tests.
//
// Tests:
//  1–4:  computeFreshness boundaries (pure, deterministic)
//  5:    getFxRate — fresh network response → cached, freshness=fresh
//  6:    getFxRate — network error, no cache → freshness=unavailable, rate=0, warning set
//  7:    getFxRate — network error, stale cache → returns cached stale
//  8:    getFxRate — fresh cache → no network call (fast path)
//  9:    EODHD integration — validated_exact_eur (ASML) → raw EUR, no FX called
// 10:    EODHD integration — validated_usd_needs_fx (NVDA) + fresh FX → EUR price, exact P&L true
// 11:    EODHD integration — validated_usd_needs_fx (QQQ) + fresh FX → BUY suitable true
// 12:    EODHD integration — validated_usd_needs_fx (NVDA) + stale FX → currentPrice=null, no BUY
// 13:    EODHD integration — validated_usd_needs_fx (NVDA) + no FX → currentPrice=null, no P&L
// 14:    No hardcoded FX rate constants in fx-provider source
// 15:    No double conversion — ASML EUR price not multiplied by any FX factor

import {
  computeFreshness,
  getFxRate,
  resetFxCache,
  FX_FRESH_HOURS,
  FX_STALE_MAX_HOURS,
} from '../fx-provider';
import { EodhdPriceProvider, resetEodhdBudget } from '../eodhd-provider';
import fs from 'fs';
import path from 'path';

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

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

type MockFetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function mockFetch(handler: (url: string) => unknown): MockFetchFn {
  return async (rawUrl) => {
    const url = typeof rawUrl === 'string' ? rawUrl : String(rawUrl);
    const body = handler(url);
    return { ok: true, json: async () => body } as Response;
  };
}

function errorFetch(): MockFetchFn {
  return async () => { throw new Error('network error'); };
}

function makeFrankfurterResponse(rate: number, daysOld = 0): unknown {
  const d = new Date();
  d.setDate(d.getDate() - daysOld);
  return { base: 'USD', date: d.toISOString().split('T')[0], rates: { EUR: rate } };
}

function makeEodhdRows(rows: { date: string; close: number; high?: number }[]): unknown {
  // EODHD returns newest-first
  return [...rows].reverse().map(r => ({
    date: r.date,
    open: r.close * 0.99,
    high: r.high ?? r.close * 1.01,
    low: r.close * 0.98,
    close: r.close,
    adjusted_close: r.close,
    volume: 1_000_000,
  }));
}

// ---------------------------------------------------------------------------
// 1–4: computeFreshness (pure, deterministic via nowMs injection)
// ---------------------------------------------------------------------------

test('1. computeFreshness — 1h old → fresh', () => {
  const ts = hoursAgoIso(1);
  const r = computeFreshness(ts);
  assert('freshness=fresh', r.freshness === 'fresh');
  assert('ageHours ~1', r.ageHours >= 0.99 && r.ageHours <= 1.1);
  assert('no warning', r.warning === undefined);
});

test('2. computeFreshness — exactly at FX_FRESH_HOURS → fresh', () => {
  const nowMs = Date.now();
  const ts = new Date(nowMs - FX_FRESH_HOURS * 3_600_000).toISOString();
  const r = computeFreshness(ts, nowMs);
  assert('at boundary: freshness=fresh', r.freshness === 'fresh');
});

test('3. computeFreshness — FX_FRESH_HOURS+1h → stale', () => {
  const hours = FX_FRESH_HOURS + 1;
  const ts = hoursAgoIso(hours);
  const r = computeFreshness(ts);
  assert('freshness=stale', r.freshness === 'stale');
  assert('warning set', typeof r.warning === 'string' && r.warning.length > 0);
  assert('ageHours correct', r.ageHours >= hours - 0.1 && r.ageHours <= hours + 0.1);
});

test('4. computeFreshness — FX_STALE_MAX_HOURS+1h → unavailable', () => {
  const hours = FX_STALE_MAX_HOURS + 1;
  const ts = hoursAgoIso(hours);
  const r = computeFreshness(ts);
  assert('freshness=unavailable', r.freshness === 'unavailable');
  assert('warning set', typeof r.warning === 'string');
});

// ---------------------------------------------------------------------------
// 5–8: getFxRate (network mocked via globalThis.fetch)
// ---------------------------------------------------------------------------

test('5. getFxRate — fresh network response → freshness=fresh, rate>0, cached', async () => {
  resetFxCache();
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = mockFetch(() => makeFrankfurterResponse(0.9234));
  try {
    const r = await getFxRate('USD', 'EUR');
    assert('pair is USD_EUR', r.pair === 'USD_EUR');
    assert('rate > 0', r.rate > 0);
    assert('rate is 0.9234', Math.abs(r.rate - 0.9234) < 0.0001);
    assert('freshness=fresh', r.freshness === 'fresh');
    assert('provider=frankfurter_ecb', r.provider === 'frankfurter_ecb');
    assert('no warning', r.warning === undefined);
    // Second call should use cache (in-memory) without hitting network again
    (globalThis as Record<string, unknown>).fetch = errorFetch();
    const r2 = await getFxRate('USD', 'EUR');
    assert('cached: same rate', r2.rate === r.rate);
    assert('cached: freshness=fresh', r2.freshness === 'fresh');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    resetFxCache();
  }
});

test('6. getFxRate — network error, no cache → unavailable, rate=0, warning set', async () => {
  resetFxCache();
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = errorFetch();
  try {
    const r = await getFxRate('USD', 'EUR');
    assert('freshness=unavailable', r.freshness === 'unavailable');
    assert('rate=0', r.rate === 0);
    assert('provider=none', r.provider === 'none');
    assert('warning set', typeof r.warning === 'string' && r.warning.includes('unavailable'));
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    resetFxCache();
  }
});

test('7. getFxRate — network error + stale cache → returns stale cached rate', async () => {
  // Write the stale file AFTER resetFxCache so resetFxCache doesn't delete it
  resetFxCache();
  const cachePath = path.resolve(process.cwd(), '.fx-cache.json');
  const cacheData = {
    rates: {
      USD_EUR: {
        rate: 0.88,
        timestamp: hoursAgoIso(FX_FRESH_HOURS + 5), // stale
        provider: 'frankfurter_ecb',
      },
    },
  };
  fs.writeFileSync(cachePath, JSON.stringify(cacheData));
  // _memCache is already null from resetFxCache; loadFxCache will re-read the file
  const origFetch = globalThis.fetch;

  (globalThis as Record<string, unknown>).fetch = errorFetch();
  try {
    const r = await getFxRate('USD', 'EUR');
    assert('returns cached rate 0.88', Math.abs(r.rate - 0.88) < 0.001);
    assert('freshness=stale', r.freshness === 'stale');
    assert('warning set (stale)', typeof r.warning === 'string');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    try { fs.unlinkSync(cachePath); } catch {}
    resetFxCache();
  }
});

test('8. getFxRate — fresh cache → no network call', async () => {
  resetFxCache();
  const origFetch = globalThis.fetch;
  // Prime with fresh rate
  (globalThis as Record<string, unknown>).fetch = mockFetch(() => makeFrankfurterResponse(0.91));
  await getFxRate('USD', 'EUR');
  // Now block network — should still return cached value
  let networkCalled = false;
  (globalThis as Record<string, unknown>).fetch = async () => {
    networkCalled = true;
    throw new Error('should not reach network');
  };
  try {
    const r = await getFxRate('USD', 'EUR');
    assert('fresh cache: no network call', !networkCalled);
    assert('fresh cache: rate preserved', Math.abs(r.rate - 0.91) < 0.001);
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    resetFxCache();
  }
});

// ---------------------------------------------------------------------------
// 9–13: EODHD integration — provider calls mocked via globalThis.fetch
// ---------------------------------------------------------------------------

function makeDualFetch(
  fxRate: number | null,      // null = FX network error
  eodhRows: { date: string; close: number; high?: number }[],
  fxDaysOld = 0,
): MockFetchFn {
  return async (rawUrl) => {
    const url = typeof rawUrl === 'string' ? rawUrl : String(rawUrl);
    if (url.includes('frankfurter')) {
      if (fxRate === null) throw new Error('FX network error');
      return { ok: true, json: async () => makeFrankfurterResponse(fxRate, fxDaysOld) } as Response;
    }
    // EODHD
    return { ok: true, json: async () => makeEodhdRows(eodhRows) } as Response;
  };
}

const EUR_ROWS = [
  { date: '2026-04-01', close: 700, high: 720 },
  { date: '2026-05-12', close: 730, high: 735 },
];

const USD_ROWS = [
  { date: '2026-04-01', close: 200, high: 215 },
  { date: '2026-05-12', close: 207.83, high: 210 },
];

test('9. EODHD: ASML (validated_exact_eur) → raw EUR price, FX not called', async () => {
  resetFxCache();
  resetEodhdBudget();
  process.env.EODHD_API_KEY = 'test-key';
  let fxCalled = false;
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (rawUrl: string | URL | Request) => {
    const url = String(rawUrl);
    if (url.includes('frankfurter')) { fxCalled = true; }
    return { ok: true, json: async () => makeEodhdRows(EUR_ROWS) } as Response;
  };
  try {
    const provider = new EodhdPriceProvider();
    const r = await provider.getRecentHighs('ASML');
    assert('ASML currentPrice=730 (raw EUR, no FX)', r.currentPrice === 730);
    assert('ASML validation.suitableForExactPnl=true', r.validation?.suitableForExactPnl === true);
    assert('ASML FX not called', !fxCalled);
    assert('ASML method=direct_eur_quote', r.validation?.method === 'direct_eur_quote');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
  }
});

test('10. EODHD: NVDA (validated_usd_needs_fx) + fresh FX → EUR price, suitableForExactPnl=true', async () => {
  resetFxCache();
  resetEodhdBudget();
  process.env.EODHD_API_KEY = 'test-key';
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = makeDualFetch(0.92, USD_ROWS, 0); // fresh
  try {
    const provider = new EodhdPriceProvider();
    const r = await provider.getRecentHighs('NVDA');
    const expectedEur = 207.83 * 0.92;
    assert('NVDA currentPrice converted to EUR', r.currentPrice !== null);
    assert('NVDA currentPrice ≈ 207.83 × 0.92', Math.abs((r.currentPrice ?? 0) - expectedEur) < 0.01);
    assert('NVDA suitableForExactPnl=true', r.validation?.suitableForExactPnl === true);
    assert('NVDA suitableForBuyRecommendation=true', r.validation?.suitableForBuyRecommendation === true);
    assert('NVDA method=usd_converted', r.validation?.method === 'usd_converted');
    assert('NVDA drawdown30d computed', typeof r.drawdown30d === 'number');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
  }
});

test('11. EODHD: QQQ (validated_usd_needs_fx) + fresh FX → suitableForBuyRecommendation=true', async () => {
  resetFxCache();
  resetEodhdBudget();
  process.env.EODHD_API_KEY = 'test-key';
  const origFetch = globalThis.fetch;
  const qqq_rows = [
    { date: '2026-04-01', close: 470, high: 500 },
    { date: '2026-05-12', close: 460, high: 465 },
  ];
  (globalThis as Record<string, unknown>).fetch = makeDualFetch(0.915, qqq_rows, 0);
  try {
    const provider = new EodhdPriceProvider();
    const r = await provider.getRecentHighs('QQQ');
    assert('QQQ currentPrice in EUR', r.currentPrice !== null && (r.currentPrice ?? 0) > 0);
    assert('QQQ suitableForBuyRecommendation=true', r.validation?.suitableForBuyRecommendation === true);
    assert('QQQ currentPrice ≈ 460 × 0.915', Math.abs((r.currentPrice ?? 0) - 460 * 0.915) < 0.01);
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
  }
});

test('12. EODHD: NVDA + stale FX → currentPrice=null, suitableForExactPnl=false', async () => {
  resetFxCache();
  resetEodhdBudget();
  process.env.EODHD_API_KEY = 'test-key';
  const origFetch = globalThis.fetch;
  // fxDaysOld=2 → timestamp is 48h ago → stale
  (globalThis as Record<string, unknown>).fetch = makeDualFetch(0.92, USD_ROWS, 2);
  try {
    const provider = new EodhdPriceProvider();
    const r = await provider.getRecentHighs('NVDA');
    assert('NVDA stale FX: currentPrice=null', r.currentPrice === null);
    assert('NVDA stale FX: suitableForExactPnl=false', r.validation?.suitableForExactPnl === false);
    assert('NVDA stale FX: suitableForBuyRecommendation=false', r.validation?.suitableForBuyRecommendation === false);
    assert('NVDA stale FX: drawdown30d still computed', typeof r.drawdown30d === 'number');
    assert('NVDA stale FX: method=usd_no_fx', r.validation?.method === 'usd_no_fx');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
  }
});

test('13. EODHD: NVDA + FX network error (no cache) → currentPrice=null, no P&L, no BUY', async () => {
  resetFxCache();
  resetEodhdBudget();
  process.env.EODHD_API_KEY = 'test-key';
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = makeDualFetch(null, USD_ROWS);
  try {
    const provider = new EodhdPriceProvider();
    const r = await provider.getRecentHighs('NVDA');
    assert('NVDA no-FX: currentPrice=null', r.currentPrice === null);
    assert('NVDA no-FX: suitableForExactPnl=false', r.validation?.suitableForExactPnl === false);
    assert('NVDA no-FX: suitableForBuyRecommendation=false', r.validation?.suitableForBuyRecommendation === false);
    assert('NVDA no-FX: method=usd_no_fx', r.validation?.method === 'usd_no_fx');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
  }
});

// ---------------------------------------------------------------------------
// 14–15: Structural audits
// ---------------------------------------------------------------------------

test('14. No hardcoded FX rate constants in fx-provider source', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/pricing/fx-provider.ts'),
    'utf-8'
  );
  // No hardcoded decimal rate like "= 1.08" or "= 0.92" (but allow the rate variable itself)
  // Check that we don't have numeric literals that look like exchange rates assigned as defaults
  const hardcoded = /(?:const|let|var)\s+\w*[Rr]ate\w*\s*=\s*[01]\.\d+/.test(src);
  assert('no hardcoded rate assignment', !hardcoded);
  assert('uses frankfurter URL', src.includes('frankfurter.app'));
  assert('no EODHD_API_KEY in FX file', !src.includes('EODHD_API_KEY'));
  assert('no api_token in FX file', !src.includes('api_token'));
});

test('15. No double conversion — ASML EUR price not multiplied by any FX factor', async () => {
  resetFxCache();
  resetEodhdBudget();
  process.env.EODHD_API_KEY = 'test-key';
  const aslmClose = 725.50;
  let fxRateSeen: number | null = null;
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (rawUrl: string | URL | Request) => {
    const url = String(rawUrl);
    if (url.includes('frankfurter')) {
      fxRateSeen = 0.93;
      return { ok: true, json: async () => makeFrankfurterResponse(0.93) } as Response;
    }
    return { ok: true, json: async () => makeEodhdRows([{ date: '2026-05-12', close: aslmClose }]) } as Response;
  };
  try {
    const provider = new EodhdPriceProvider();
    const r = await provider.getRecentHighs('ASML');
    assert('ASML currentPrice equals raw close (not multiplied)', r.currentPrice === aslmClose);
    // If FX had been incorrectly applied (rate=0.93), price would be 675.715, not 725.50
    assert('ASML currentPrice != close × 0.93 (no FX multiplication)', r.currentPrice !== aslmClose * 0.93);
    assert('FX was not called for ASML', fxRateSeen === null);
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
  }
});

// ---------------------------------------------------------------------------
// 16–17: G2 — getFxRate with invalid rate values from API (0, null)
// ---------------------------------------------------------------------------

test('16. getFxRate — API returns rate:0 → unavailable, not cached as fresh', async () => {
  resetFxCache();
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = mockFetch(() => ({
    base: 'USD', date: '2026-06-01', rates: { EUR: 0 },
  }));
  try {
    const r = await getFxRate('USD', 'EUR');
    assert('rate:0 → freshness=unavailable', r.freshness === 'unavailable');
    assert('rate:0 → rate=0 (sentinel)', r.rate === 0);
    assert('rate:0 → provider=none', r.provider === 'none');
    assert('rate:0 → warning set', typeof r.warning === 'string' && r.warning.length > 0);
    // Not cached as fresh — second call with blocked network must still be unavailable
    (globalThis as Record<string, unknown>).fetch = mockFetch(() => ({
      base: 'USD', date: '2026-06-01', rates: { EUR: 0 },
    }));
    const r2 = await getFxRate('USD', 'EUR');
    assert('rate:0 → second call also unavailable (not cached as fresh)', r2.freshness === 'unavailable');
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    resetFxCache();
  }
});

test('17. getFxRate — API returns rate:null → unavailable, not cached as fresh', async () => {
  resetFxCache();
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = mockFetch(() => ({
    base: 'USD', date: '2026-06-01', rates: { EUR: null },
  }));
  try {
    const r = await getFxRate('USD', 'EUR');
    assert('rate:null → freshness=unavailable', r.freshness === 'unavailable');
    assert('rate:null → rate=0 (sentinel)', r.rate === 0);
    assert('rate:null → provider=none', r.provider === 'none');
    assert('rate:null → warning set', typeof r.warning === 'string' && r.warning.length > 0);
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    resetFxCache();
  }
});

// ---------------------------------------------------------------------------
// 18: G3 — Sweep all validated_usd_needs_fx symbols: no raw USD exposed when FX absent
// ---------------------------------------------------------------------------

test('18. EODHD sweep: all validated_usd_needs_fx symbols → currentPrice=null when FX unavailable', async () => {
  const configPath = path.resolve(process.cwd(), 'config', 'eodhd-symbol-validation.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    symbols: Array<{ status: string; internalTicker: string }>;
  };
  const usdSymbols = config.symbols.filter(s => s.status === 'validated_usd_needs_fx');
  assert(`sweep: curated config contains at least 12 validated_usd_needs_fx symbols`, usdSymbols.length >= 12);

  // Guard: every one of these 12 known symbols must be present — if any is accidentally
  // removed from the curated config, this assert catches it regardless of total count.
  const EXPECTED_USD_SYMBOLS = new Set([
    'NVDA', 'QQQ', 'MSFT', 'AMZN', 'SMCI', 'CRM',
    'NOW', 'ADBE', 'ORCL', 'GOOGL', 'FTNT', 'MRVL',
  ]);
  const foundTickers = new Set(usdSymbols.map(s => s.internalTicker));
  for (const ticker of EXPECTED_USD_SYMBOLS) {
    assert(`sweep: expected symbol ${ticker} present in curated config`, foundTickers.has(ticker));
  }

  process.env.EODHD_API_KEY = 'test-key';
  const origFetch = globalThis.fetch;
  try {
    for (const entry of usdSymbols) {
      const symbol = entry.internalTicker;
      resetFxCache();
      resetEodhdBudget();
      // FX network error (no cache) — EODHD returns valid rows
      (globalThis as Record<string, unknown>).fetch = makeDualFetch(null, USD_ROWS);
      const provider = new EodhdPriceProvider();
      const r = await provider.getRecentHighs(symbol);
      assert(`${symbol}: currentPrice=null (no raw USD as EUR)`, r.currentPrice === null);
      assert(`${symbol}: suitableForExactPnl=false`, r.validation?.suitableForExactPnl === false);
      assert(`${symbol}: suitableForBuyRecommendation=false`, r.validation?.suitableForBuyRecommendation === false);
      assert(`${symbol}: suitableForDrawdown=true (drawdown unaffected by FX)`, r.validation?.suitableForDrawdown === true);
      assert(`${symbol}: method=usd_no_fx`, r.validation?.method === 'usd_no_fx');
    }
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
    resetEodhdBudget();
  }
});

// ---------------------------------------------------------------------------
// 19: G4 — Non-curated USD symbol → currentPrice=null (conservative fallback)
// ---------------------------------------------------------------------------

test('19. EODHD: non-curated USD symbol (TSLA) → currentPrice=null, no raw USD exposed (G4)', async () => {
  resetFxCache();
  resetEodhdBudget();
  process.env.EODHD_API_KEY = 'test-key';
  const origFetch = globalThis.fetch;
  // TSLA is in SYMBOL_MAP but absent from curated config → hits non-curated USD fallback
  (globalThis as Record<string, unknown>).fetch = async (rawUrl: string | URL | Request) => {
    const url = String(rawUrl);
    if (url.includes('frankfurter')) {
      // FX must not be called for the non-curated fallback path
      throw new Error('FX should not be called for non-curated USD symbol (test invariant)');
    }
    return { ok: true, json: async () => makeEodhdRows(USD_ROWS) } as Response;
  };
  try {
    const provider = new EodhdPriceProvider();
    const r = await provider.getRecentHighs('TSLA');
    assert('non-curated USD: currentPrice=null (conservative — raw USD not exposed)', r.currentPrice === null);
    assert('non-curated USD: suitableForExactPnl=false', r.validation?.suitableForExactPnl === false);
    assert('non-curated USD: suitableForBuyRecommendation=false', r.validation?.suitableForBuyRecommendation === false);
    assert('non-curated USD: method=usd_no_fx', r.validation?.method === 'usd_no_fx');
    assert('non-curated USD: suitableForDrawdown=true', r.validation?.suitableForDrawdown === true);
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
  }
});

// ---------------------------------------------------------------------------
// 20: G5 — EodhdPriceProvider.getCurrentPrice returns raw native-currency quote
// ---------------------------------------------------------------------------

test('20. EodhdPriceProvider.getCurrentPrice — raw native-currency quote (USD), no FX conversion (G5)', async () => {
  resetFxCache();
  resetEodhdBudget();
  process.env.EODHD_API_KEY = 'test-key';
  const rawMsftClose = 452.10;
  let fxCalled = false;
  const origFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (rawUrl: string | URL | Request) => {
    const url = String(rawUrl);
    if (url.includes('frankfurter')) {
      fxCalled = true;
      return { ok: true, json: async () => makeFrankfurterResponse(0.92) } as Response;
    }
    return { ok: true, json: async () => makeEodhdRows([{ date: '2026-05-29', close: rawMsftClose }]) } as Response;
  };
  try {
    const provider = new EodhdPriceProvider();
    const r = await provider.getCurrentPrice('MSFT');
    assert('getCurrentPrice: currentPrice equals raw close (not EUR-converted)', r.currentPrice === rawMsftClose);
    assert('getCurrentPrice: currency is USD (native, not EUR)', r.currency === 'USD');
    assert('getCurrentPrice: FX was not called', !fxCalled);
    assert('getCurrentPrice: currentPrice != close × 0.92 (no FX multiplication)', r.currentPrice !== rawMsftClose * 0.92);
  } finally {
    (globalThis as Record<string, unknown>).fetch = origFetch;
    delete process.env.EODHD_API_KEY;
    resetFxCache();
  }
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
