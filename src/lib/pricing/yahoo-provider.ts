// Yahoo Finance price provider — direct fetch to /v8/finance/chart
// Uses browser-like headers to avoid aggressive rate limiting on Vercel IPs
// One request per symbol returns current price + 3 months of OHLCV

import { calcDrawdownPct } from '../utils/math';
import type { PriceProvider } from './interface';
import type { PriceData, HistoricalPrices, RecentHighs, HistoricalPrice } from '../types';

const TICKER_MAP: Record<string, string> = {
  ASML: 'ASML.AS',
  CNDX: 'CNDX.AS',
  IWDA: 'IWDA.AS',
  IWVL: 'IWVL.AS',
  CSPX: 'CSPX.L',
  EMIM: 'EMIM.L',
  VWCE: 'VWCE.DE',
  SEMI: 'VSEM.L',
};

function resolveYahooTicker(symbol: string): string {
  return TICKER_MAP[symbol] ?? symbol;
}

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
};

// Sequential slot rate limiter — 1 second between requests respects Yahoo's limits
let _nextCallTime = 0;
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, _nextCallTime);
  _nextCallTime = slot + 1000;
  if (slot > now) await new Promise(r => setTimeout(r, slot - now));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries - 1) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      // 429 = Yahoo is rate limiting this IP — don't retry, fail fast
      if (msg.includes('Too Many') || msg.includes('429')) throw err;
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error('unreachable');
}

interface ChartData {
  currentPrice: number;
  currency: string;
  prices: HistoricalPrice[];
}

async function fetchChart(yahooSymbol: string): Promise<ChartData> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=3mo`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const isTMR = res.status === 429 || body.includes('Too Many');
    throw new Error(isTMR ? 'Too Many Requests' : `HTTP ${res.status}`);
  }
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error('No chart data');

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};

  const prices: HistoricalPrice[] = timestamps
    .map((ts: number, i: number) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      close: (quote.close?.[i] as number) ?? 0,
      high:  (quote.high?.[i]  as number) ?? 0,
      low:   (quote.low?.[i]   as number) ?? 0,
      volume:(quote.volume?.[i] as number) ?? 0,
    }))
    .filter(p => p.close > 0);

  return {
    currentPrice: (result.meta?.regularMarketPrice as number) ?? prices[prices.length - 1]?.close ?? 0,
    currency: (result.meta?.currency as string) ?? 'USD',
    prices,
  };
}

export class YahooPriceProvider implements PriceProvider {
  readonly providerName = 'yahoo';

  async getCurrentPrice(symbol: string): Promise<PriceData> {
    const ticker = resolveYahooTicker(symbol);
    await rateLimit();
    const data = await withRetry(() => fetchChart(ticker));
    return {
      symbol,
      currentPrice: data.currentPrice,
      currency: data.currency,
      timestamp: new Date(),
    };
  }

  async getHistoricalPrices(symbol: string, _days: number): Promise<HistoricalPrices> {
    const ticker = resolveYahooTicker(symbol);
    await rateLimit();
    const data = await withRetry(() => fetchChart(ticker));
    return { symbol, prices: data.prices };
  }

  async getRecentHighs(symbol: string, windows = [30, 60, 90]): Promise<RecentHighs> {
    const ticker = resolveYahooTicker(symbol);
    await rateLimit();
    const { currentPrice, prices } = await withRetry(() => fetchChart(ticker));

    const now = new Date();
    const getHigh = (days: number) => {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      return prices
        .filter(p => new Date(p.date) >= cutoff)
        .reduce((max, p) => Math.max(max, p.high), currentPrice);
    };

    const [high30d, high60d, high90d] = windows.map(getHigh);

    return {
      symbol,
      high30d, high60d, high90d,
      currentPrice,
      drawdown30d: calcDrawdownPct(high30d, currentPrice),
      drawdown60d: calcDrawdownPct(high60d, currentPrice),
      drawdown90d: calcDrawdownPct(high90d, currentPrice),
    };
  }
}
