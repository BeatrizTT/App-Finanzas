// Twelve Data price provider (free tier: 800 req/day, 8 req/min)
// Set PRICE_PROVIDER=twelvedata and TWELVE_DATA_API_KEY in Vercel env vars
// Works reliably from cloud IPs unlike Yahoo Finance

import { calcDrawdownPct } from '../utils/math';
import type { PriceProvider } from './interface';
import type { PriceData, HistoricalPrices, RecentHighs, HistoricalPrice } from '../types';

// Twelve Data uses different symbol formats for EU-listed securities
const SYMBOL_MAP: Record<string, { symbol: string; exchange?: string }> = {
  ASML:  { symbol: 'ASML',   exchange: 'XAMS' },  // Euronext Amsterdam
  CNDX:  { symbol: 'CNDX',   exchange: 'XAMS' },
  IWDA:  { symbol: 'IWDA',   exchange: 'XAMS' },
  IWVL:  { symbol: 'IWVL',   exchange: 'XAMS' },
  CSPX:  { symbol: 'CSPX',   exchange: 'XLON' },  // London Stock Exchange
  EMIM:  { symbol: 'EMIM',   exchange: 'XLON' },
  VWCE:  { symbol: 'VWCE',   exchange: 'XETR' },  // Xetra Frankfurt
  SEMI:  { symbol: 'VSEM',   exchange: 'XLON' },  // VanEck Semi UCITS
};

function resolveSymbol(symbol: string): { symbol: string; exchange?: string } {
  return SYMBOL_MAP[symbol] ?? { symbol };
}

function buildParams(symbol: string): string {
  const mapped = resolveSymbol(symbol);
  const base = `symbol=${mapped.symbol}`;
  return mapped.exchange ? `${base}&exchange=${mapped.exchange}` : base;
}

// Twelve Data batch: symbols with exchanges must be passed as "SYM:XAMS" format
function buildBatchSymbolList(symbols: string[]): string {
  return symbols.map(s => {
    const m = resolveSymbol(s);
    return m.exchange ? `${m.symbol}:${m.exchange}` : m.symbol;
  }).join(',');
}

const BASE = 'https://api.twelvedata.com';

// 8 requests/min free tier → 7.5s apart per HTTP call in single-symbol mode
let _nextCallTime = 0;
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, _nextCallTime);
  _nextCallTime = slot + 7500;
  if (slot > now) await new Promise(r => setTimeout(r, slot - now));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error('unreachable');
}

async function tdFetch(path: string): Promise<unknown> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY not set');
  const url = `${BASE}${path}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  // Single-symbol responses have a top-level `status` field; batch responses don't
  if (data.status === 'error') throw new Error(String(data.message ?? 'Twelve Data error'));
  return data;
}

function parseSeriesValues(values: Record<string, string>[]): HistoricalPrice[] {
  return values
    .map(row => ({
      date:   String(row.datetime ?? '').split(' ')[0],
      close:  parseFloat(row.close  ?? '0'),
      high:   parseFloat(row.high   ?? '0'),
      low:    parseFloat(row.low    ?? '0'),
      volume: parseFloat(row.volume ?? '0'),
    }))
    .filter(p => p.close > 0)
    .reverse(); // Twelve Data returns newest first
}

function calcHighs(prices: HistoricalPrice[], currentPrice: number, windows: number[]) {
  const now = new Date();
  const getHigh = (days: number) => {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return prices
      .filter(p => new Date(p.date) >= cutoff)
      .reduce((max, p) => Math.max(max, p.high), currentPrice);
  };
  return windows.map(getHigh);
}

export class TwelveDataPriceProvider implements PriceProvider {
  readonly providerName = 'twelvedata';

  async getCurrentPrice(symbol: string): Promise<PriceData> {
    await rateLimit();
    const params = buildParams(symbol);
    const data = await withRetry(() => tdFetch(`/price?${params}`)) as Record<string, unknown>;
    return {
      symbol,
      currentPrice: parseFloat(String(data.price ?? '0')),
      currency: 'USD',
      timestamp: new Date(),
    };
  }

  async getHistoricalPrices(symbol: string, days: number): Promise<HistoricalPrices> {
    await rateLimit();
    const params = buildParams(symbol);
    const outputsize = Math.min(days + 5, 90);
    const data = await withRetry(
      () => tdFetch(`/time_series?${params}&interval=1day&outputsize=${outputsize}`)
    ) as { values?: Record<string, string>[] };
    return { symbol, prices: parseSeriesValues(data.values ?? []) };
  }

  async getRecentHighs(symbol: string, windows = [30, 60, 90]): Promise<RecentHighs> {
    await rateLimit();
    const params = buildParams(symbol);
    const data = await withRetry(
      () => tdFetch(`/time_series?${params}&interval=1day&outputsize=90`)
    ) as { values?: Record<string, string>[] };

    const prices = parseSeriesValues(data.values ?? []);
    const currentPrice = prices[prices.length - 1]?.close ?? 0;
    const [high30d, high60d, high90d] = calcHighs(prices, currentPrice, windows);

    return {
      symbol,
      high30d, high60d, high90d,
      currentPrice,
      drawdown30d: calcDrawdownPct(high30d, currentPrice),
      drawdown60d: calcDrawdownPct(high60d, currentPrice),
      drawdown90d: calcDrawdownPct(high90d, currentPrice),
    };
  }

  /**
   * Batch fetch: one HTTP request for all symbols.
   * Twelve Data accepts comma-separated symbols (with exchange suffix like SYM:XAMS).
   * This completes in seconds regardless of how many symbols are requested.
   */
  async batchGetRecentHighs(
    symbols: string[],
    windows = [30, 60, 90]
  ): Promise<Record<string, RecentHighs>> {
    if (symbols.length === 0) return {};

    // Twelve Data batch limit: 120 symbols per request on all plans
    const BATCH_SIZE = 55; // stay well within limits and response size
    const results: Record<string, RecentHighs> = {};

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const symbolList = buildBatchSymbolList(batch);

      await rateLimit();
      const raw = await withRetry(
        () => tdFetch(`/time_series?symbol=${symbolList}&interval=1day&outputsize=90`)
      ) as Record<string, unknown>;

      for (const batch_sym of batch) {
        const resolved = resolveSymbol(batch_sym);
        // Twelve Data keys the response by the full "SYM:EXCHANGE" or just "SYM"
        const key = resolved.exchange
          ? `${resolved.symbol}:${resolved.exchange}`
          : resolved.symbol;

        const entry = (raw[key] ?? raw[resolved.symbol]) as
          | { values?: Record<string, string>[]; status?: string }
          | undefined;

        if (!entry || entry.status === 'error' || !entry.values) {
          console.warn(`[TwelveData] No batch data for ${batch_sym} (key: ${key})`);
          continue;
        }

        const prices = parseSeriesValues(entry.values);
        if (prices.length === 0) continue;

        const currentPrice = prices[prices.length - 1].close;
        const [high30d, high60d, high90d] = calcHighs(prices, currentPrice, windows);

        results[batch_sym] = {
          symbol: batch_sym,
          high30d, high60d, high90d,
          currentPrice,
          drawdown30d: calcDrawdownPct(high30d, currentPrice),
          drawdown60d: calcDrawdownPct(high60d, currentPrice),
          drawdown90d: calcDrawdownPct(high90d, currentPrice),
        };
      }
    }

    console.log(`[TwelveData] Batch fetch: ${Object.keys(results).length}/${symbols.length} symbols ok`);
    return results;
  }
}
