// FX rate provider — Frankfurter API (ECB reference rates, no API key required)
// Used by EODHD provider to convert validated USD prices to EUR.
//
// Freshness policy:
//   fresh     : age ≤ FX_FRESH_HOURS (26h) — suitable for exact P&L and BUY sizing
//   stale     : 26h < age ≤ FX_STALE_MAX_HOURS (72h) — NOT suitable for exact P&L or BUY
//   unavailable: age > 72h or no data at all — blocks P&L and BUY
//
// Cache: .fx-cache.json in process.cwd() (file + in-memory; never re-read per process)

import fs from 'fs';
import path from 'path';

export const FX_FRESH_HOURS = 26;       // ECB updates once/day; 26h covers weekends
export const FX_STALE_MAX_HOURS = 72;   // beyond this treat as unavailable

export interface FxRate {
  pair: string;         // e.g. 'USD_EUR'
  rate: number;         // multiply from-currency amount by this to get to-currency
  timestamp: string;    // ISO string of when the ECB published this rate
  provider: string;     // 'frankfurter_ecb' | 'none'
  freshness: 'fresh' | 'stale' | 'unavailable';
  ageHours: number;
  warning?: string;     // set when stale or unavailable
}

interface FxCacheEntry {
  rate: number;
  timestamp: string;
  provider: string;
}

interface FxCacheFile {
  rates: Record<string, FxCacheEntry>;
}

const CACHE_PATH = path.resolve(process.cwd(), '.fx-cache.json');

let _memCache: FxCacheFile | null = null;

function loadFxCache(): FxCacheFile {
  if (_memCache) return _memCache;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      _memCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as FxCacheFile;
      return _memCache;
    }
  } catch {}
  _memCache = { rates: {} };
  return _memCache;
}

function saveFxCache(cache: FxCacheFile): void {
  _memCache = cache;
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {}
}

/** Reset in-memory cache and delete cache file. Tests only — never call in production code. */
export function resetFxCache(): void {
  _memCache = null;
  try { fs.unlinkSync(CACHE_PATH); } catch {}
}

/**
 * Compute freshness from an ISO timestamp.
 * nowMs is injectable for deterministic tests.
 */
export function computeFreshness(
  timestamp: string,
  nowMs: number = Date.now(),
): { freshness: 'fresh' | 'stale' | 'unavailable'; ageHours: number; warning?: string } {
  const ageHours = (nowMs - new Date(timestamp).getTime()) / 3_600_000;
  if (ageHours <= FX_FRESH_HOURS) {
    return { freshness: 'fresh', ageHours };
  }
  if (ageHours <= FX_STALE_MAX_HOURS) {
    return {
      freshness: 'stale',
      ageHours,
      warning: `FX rate is ${ageHours.toFixed(1)}h old — stale (limit: ${FX_FRESH_HOURS}h); exact P&L and buy sizing unavailable`,
    };
  }
  return {
    freshness: 'unavailable',
    ageHours,
    warning: `FX rate is ${ageHours.toFixed(1)}h old — too stale to use (limit: ${FX_STALE_MAX_HOURS}h)`,
  };
}

async function fetchFreshRate(
  from: string,
  to: string,
): Promise<{ rate: number; timestamp: string }> {
  const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const data = await res.json() as { date: string; rates: Record<string, number> };
    const rate = data.rates[to];
    if (!(rate > 0)) throw new Error(`No ${from}/${to} rate in Frankfurter response`);
    // ECB publishes a date string; treat as noon UTC for consistent age comparisons
    const timestamp = new Date(`${data.date}T12:00:00Z`).toISOString();
    return { rate, timestamp };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get an FX rate for the given currency pair.
 * Never throws — returns freshness:'unavailable' on total failure.
 *
 * Cache strategy:
 *   - If cached and fresh → return immediately (no network call)
 *   - Otherwise → try network; on success update cache; on failure return best cached or unavailable
 */
export async function getFxRate(from: string, to: string): Promise<FxRate> {
  const pair = `${from}_${to}`;
  const cache = loadFxCache();
  const cached = cache.rates[pair];

  // Fast path: cached and fresh
  if (cached) {
    const cf = computeFreshness(cached.timestamp);
    if (cf.freshness === 'fresh') {
      return { pair, rate: cached.rate, timestamp: cached.timestamp, provider: cached.provider, ...cf };
    }
  }

  // Try network refresh
  try {
    const { rate, timestamp } = await fetchFreshRate(from, to);
    const updated: FxCacheFile = {
      rates: { ...cache.rates, [pair]: { rate, timestamp, provider: 'frankfurter_ecb' } },
    };
    saveFxCache(updated);
    const cf = computeFreshness(timestamp);
    console.log(`[FX] Fetched ${pair}: ${rate} from frankfurter_ecb (${cf.freshness})`);
    return { pair, rate, timestamp, provider: 'frankfurter_ecb', ...cf };
  } catch (err) {
    // Network failed — return best available cache or unavailable
    if (cached) {
      const cf = computeFreshness(cached.timestamp);
      console.warn(`[FX] Network fetch failed for ${pair}; using cached (${cf.freshness})`);
      return { pair, rate: cached.rate, timestamp: cached.timestamp, provider: cached.provider, ...cf };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      pair,
      rate: 0,
      timestamp: new Date(0).toISOString(),
      provider: 'none',
      freshness: 'unavailable',
      ageHours: Infinity,
      warning: `FX unavailable: ${msg}`,
    };
  }
}
