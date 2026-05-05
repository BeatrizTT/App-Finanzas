// Price cache — stores recent highs in /tmp to avoid redundant API calls.
// Free-tier APIs (e.g. Twelve Data) limit 8 symbols/minute; with caching,
// most engine runs use zero API credits and complete in milliseconds.

import { readJsonFile, writeJsonFile } from '../utils/file-store';
import type { RecentHighs } from '../types';

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

/** How many symbols need fresh data (cache miss or expired) */
export function countStale(cache: PriceCache, symbols: string[]): number {
  return symbols.filter(s => !isCacheFresh(cache[s])).length;
}
