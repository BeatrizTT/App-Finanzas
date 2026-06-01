// Price cache — stores recent highs in /tmp to avoid redundant API calls.
// Free-tier APIs (e.g. Twelve Data) limit 8 symbols/minute; with caching,
// most engine runs use zero API credits and complete in milliseconds.

import { readJsonFile, writeJsonFile } from '../utils/file-store';
import { isSuitableFor } from './price-validation';
import type { RecentHighs, PricingPurpose } from '../types';

interface CacheEntry {
  data: RecentHighs;
  fetchedAt: string; // ISO timestamp
}

export type PriceCache = Record<string, CacheEntry>;

const CACHE_FILE = 'price-cache.json';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function loadPriceCache(): PriceCache {
  return readJsonFile<PriceCache>(CACHE_FILE, {});
}

export function savePriceCache(cache: PriceCache): void {
  writeJsonFile(CACHE_FILE, cache);
}

export function isCacheFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - new Date(entry.fetchedAt).getTime() < CACHE_TTL_MS;
}

export function getCached(cache: PriceCache, symbol: string): RecentHighs | null {
  const entry = cache[symbol];
  return isCacheFresh(entry) ? entry.data : null;
}

export function setCached(cache: PriceCache, symbol: string, data: RecentHighs): void {
  cache[symbol] = { data, fetchedAt: new Date().toISOString() };
}

/**
 * Returns fresh cache entry only if it also satisfies the requested purpose.
 * Used by the provider chain to skip live fetches when cache is good enough.
 */
export function getCachedForPurpose(
  cache: PriceCache,
  symbol: string,
  purpose: PricingPurpose
): RecentHighs | null {
  const entry = cache[symbol];
  if (!entry || !isCacheFresh(entry)) return null;
  if (!isSuitableFor(entry.data.validation, purpose)) return null;
  return entry.data;
}

/**
 * Returns any cached entry regardless of freshness, or null if absent.
 * Used by the provider chain as a last-resort fallback after all live fetches fail.
 */
export function getCachedStale(cache: PriceCache, symbol: string): RecentHighs | null {
  return cache[symbol]?.data ?? null;
}

/** How many symbols need fresh data (cache miss or expired) */
export function countStale(cache: PriceCache, symbols: string[]): number {
  return symbols.filter(s => !isCacheFresh(cache[s])).length;
}

const EUR_USD_KEY = '__EURUSD__';

export function getEurUsdRate(cache: PriceCache): number | null {
  const entry = cache[EUR_USD_KEY];
  if (!entry || !isCacheFresh(entry)) return null;
  return entry.data.currentPrice;
}

export function setEurUsdRate(cache: PriceCache, rate: number): void {
  cache[EUR_USD_KEY] = {
    data: {
      symbol: EUR_USD_KEY,
      high30d: rate, high60d: rate, high90d: rate,
      currentPrice: rate,
      drawdown30d: 0, drawdown60d: 0, drawdown90d: 0,
    },
    fetchedAt: new Date().toISOString(),
  };
}
