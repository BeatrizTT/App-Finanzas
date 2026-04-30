// Yahoo Finance price provider using yahoo-finance2 (free, no API key)
// Set PRICE_PROVIDER=yahoo in .env.local or Vercel env vars to use real data
// yahoo-finance2 is declared as serverExternalPackage so Next.js loads it at runtime

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _yfModule = require('yahoo-finance2') as { default?: Record<string, (...a: unknown[]) => unknown> } & Record<string, (...a: unknown[]) => unknown>;
// yahoo-finance2 may export the client as default (ESM) or directly (CJS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yahooFinance = (_yfModule.default ?? _yfModule) as any;

import { calcDrawdownPct } from '../utils/math';
import type { PriceProvider } from './interface';
import type { PriceData, HistoricalPrices, RecentHighs, HistoricalPrice } from '../types';

// European UCITS ETF ticker mapping for Yahoo Finance
const TICKER_MAP: Record<string, string> = {
  ASML: 'ASML.AS',   // Euronext Amsterdam
  CNDX: 'CNDX.AS',
  IWDA: 'IWDA.AS',
  IWVL: 'IWVL.AS',
  CSPX: 'CSPX.L',   // London Stock Exchange
  EMIM: 'EMIM.L',
  VWCE: 'VWCE.DE',  // Xetra Frankfurt
  SEMI: 'VSEM.L',   // VanEck Semiconductor UCITS
};

function resolveYahooTicker(symbol: string): string {
  return TICKER_MAP[symbol] ?? symbol;
}

// 200ms minimum between requests to avoid Yahoo rate limiting
let _lastCall = 0;
async function rateLimit(): Promise<void> {
  const gap = 200 - (Date.now() - _lastCall);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  _lastCall = Date.now();
}

// Exponential backoff: 1s, 2s, 4s
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error('unreachable');
}

export class YahooPriceProvider implements PriceProvider {
  readonly providerName = 'yahoo';

  async getCurrentPrice(symbol: string): Promise<PriceData> {
    const ticker = resolveYahooTicker(symbol);
    await rateLimit();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote = await withRetry(() => yahooFinance.quote(ticker)) as any;

    return {
      symbol,
      currentPrice: quote.regularMarketPrice ?? 0,
      currency: quote.currency ?? 'USD',
      timestamp: new Date(),
      change1d: quote.regularMarketChangePercent ?? 0,
      marketCap: quote.marketCap,
      volume: quote.regularMarketVolume,
    };
  }

  async getHistoricalPrices(symbol: string, days: number): Promise<HistoricalPrices> {
    const ticker = resolveYahooTicker(symbol);
    await rateLimit();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 5);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await withRetry(() => yahooFinance.historical(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    })) as any[];

    const prices: HistoricalPrice[] = rows.map((row) => ({
      date: new Date(row.date).toISOString().split('T')[0],
      close: row.close ?? 0,
      high:  row.high  ?? 0,
      low:   row.low   ?? 0,
      volume: row.volume ?? 0,
    }));

    return { symbol, prices };
  }

  async getRecentHighs(symbol: string, windows = [30, 60, 90]): Promise<RecentHighs> {
    const maxWindow = Math.max(...windows);
    const hist = await this.getHistoricalPrices(symbol, maxWindow + 5);
    const current = await this.getCurrentPrice(symbol);
    const currentPrice = current.currentPrice;

    const now = new Date();
    const getHigh = (days: number) => {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      return hist.prices
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
