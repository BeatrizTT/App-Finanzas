// Yahoo Finance price provider using yahoo-finance2 (free, no API key)
// Set PRICE_PROVIDER=yahoo in .env.local to use real market data
// Note: Yahoo Finance data may have delays and occasional failures

import { calcDrawdownPct } from '../utils/math';
import type { PriceProvider } from './interface';
import type { PriceData, HistoricalPrices, RecentHighs, HistoricalPrice } from '../types';

// Some tickers need a suffix for European exchanges
function resolveYahooTicker(symbol: string): string {
  const europeMap: Record<string, string> = {
    ASML: 'ASML.AS',   // Amsterdam exchange
    IWDA: 'IWDA.L',    // London Stock Exchange
    IWVL: 'IWVL.L',
    CSPX: 'CSPX.L',
  };
  return europeMap[symbol] ?? symbol;
}

// Lazy-loaded module reference
let _yf: Record<string, (...args: unknown[]) => unknown> | null = null;

async function getYf(): Promise<Record<string, (...args: unknown[]) => unknown>> {
  if (_yf) return _yf;
  // Dynamic import handles ESM-only package correctly
  const mod = await import('yahoo-finance2' as string);
  _yf = (mod.default ?? mod) as Record<string, (...args: unknown[]) => unknown>;
  return _yf;
}

export class YahooPriceProvider implements PriceProvider {
  readonly providerName = 'yahoo';

  async getCurrentPrice(symbol: string): Promise<PriceData> {
    const ticker = resolveYahooTicker(symbol);
    const yf = await getYf();

    const quote = await (yf['quote'] as (ticker: string) => Promise<Record<string, unknown>>)(ticker);

    return {
      symbol,
      currentPrice: (quote['regularMarketPrice'] as number) ?? 0,
      currency: (quote['currency'] as string) ?? 'USD',
      timestamp: new Date(),
      change1d: (quote['regularMarketChangePercent'] as number) ?? 0,
      marketCap: quote['marketCap'] as number | undefined,
      volume: quote['regularMarketVolume'] as number | undefined,
    };
  }

  async getHistoricalPrices(symbol: string, days: number): Promise<HistoricalPrices> {
    const ticker = resolveYahooTicker(symbol);
    const yf = await getYf();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days - 5);

    type HistRow = { date: Date | string; close?: number; high?: number; low?: number; volume?: number };
    const result = await (yf['historical'] as (
      ticker: string,
      opts: Record<string, unknown>
    ) => Promise<HistRow[]>)(ticker, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    });

    const prices: HistoricalPrice[] = result.map((row) => ({
      date: new Date(row.date).toISOString().split('T')[0],
      close: row.close ?? 0,
      high: row.high ?? 0,
      low: row.low ?? 0,
      volume: row.volume ?? 0,
    }));

    return { symbol, prices };
  }

  async getRecentHighs(symbol: string, windows = [30, 60, 90]): Promise<RecentHighs> {
    const maxWindow = Math.max(...windows);
    const historical = await this.getHistoricalPrices(symbol, maxWindow + 5);
    const currentData = await this.getCurrentPrice(symbol);
    const currentPrice = currentData.currentPrice;

    const allPrices = historical.prices;
    const now = new Date();

    function getHighForWindow(days: number): number {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      const windowPrices = allPrices.filter((p) => new Date(p.date) >= cutoff);
      return windowPrices.reduce((max, p) => Math.max(max, p.high), currentPrice);
    }

    const [high30d, high60d, high90d] = windows.map(getHighForWindow);

    return {
      symbol,
      high30d,
      high60d,
      high90d,
      currentPrice,
      drawdown30d: calcDrawdownPct(high30d, currentPrice),
      drawdown60d: calcDrawdownPct(high60d, currentPrice),
      drawdown90d: calcDrawdownPct(high90d, currentPrice),
    };
  }
}
