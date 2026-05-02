// Yahoo Finance price provider using yahoo-finance2 (free, no API key)
// Set PRICE_PROVIDER=yahoo in .env.local or Vercel env vars to use real data
// yahoo-finance2 is declared as serverExternalPackage so Next.js loads it at runtime
// Dynamic import avoids Turbopack static-analysis failures with ESM-only packages

import { calcDrawdownPct } from '../utils/math';
import type { PriceProvider } from './interface';
import type { PriceData, HistoricalPrices, RecentHighs, HistoricalPrice } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getClient(): Promise<any> {
  if (_client) return _client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('yahoo-finance2') as any;
  _client = mod.default ?? mod;
  return _client;
}

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

// 500ms minimum between requests — sequential slot reservation prevents
// concurrent calls from bypassing the limit
let _nextCallTime = 0;
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, _nextCallTime);
  _nextCallTime = slot + 500;
  if (slot > now) await new Promise(r => setTimeout(r, slot - now));
}

// Exponential backoff; 429 Too Many Requests gets a longer pause
async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === retries - 1) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes('Too Many Requests') || msg.includes('429');
      const delay = isRateLimit ? 8000 * (i + 1) : 1000 * 2 ** i;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export class YahooPriceProvider implements PriceProvider {
  readonly providerName = 'yahoo';

  async getCurrentPrice(symbol: string): Promise<PriceData> {
    const ticker = resolveYahooTicker(symbol);
    await rateLimit();
    const yf = await getClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote = await withRetry(() => yf.quote(ticker)) as any;

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
    const yf = await getClient();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 5);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await withRetry(() => yf.historical(ticker, {
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
