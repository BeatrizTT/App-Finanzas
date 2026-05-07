// Price provider interface — all providers must implement this
// Swap out the active provider by changing PRICE_PROVIDER env var

import type { PriceData, HistoricalPrices, RecentHighs, PricingPurpose } from '../types';

export interface PriceProvider {
  /** Get the latest price and basic quote data for a symbol */
  getCurrentPrice(symbol: string): Promise<PriceData>;

  /** Get historical OHLCV data for the last N calendar days */
  getHistoricalPrices(symbol: string, days: number): Promise<HistoricalPrices>;

  /** Calculate recent highs and drawdowns for the configured windows */
  getRecentHighs(symbol: string, windows?: number[]): Promise<RecentHighs>;

  /**
   * Purpose-aware variant of getRecentHighs — optional; implemented by ChainedPriceProvider.
   * When present, the engine calls this for portfolio holdings ('exact_pnl') and universe
   * scanning ('buy_recommendation') so the chain continues past lower-quality results
   * (e.g. currency_unconfirmed) when a confirmed price is needed.
   * Providers that don't implement this fall back to getRecentHighs.
   */
  getRecentHighsForPurpose?(symbol: string, purpose: PricingPurpose, windows?: number[]): Promise<RecentHighs>;

  /**
   * Batch version of getRecentHighs — optional; providers that support it
   * (e.g. Twelve Data) can fetch all symbols in one HTTP request.
   */
  batchGetRecentHighs?(symbols: string[], windows?: number[]): Promise<Record<string, RecentHighs>>;

  /** Provider name for logging/debugging */
  readonly providerName: string;
}

/** Default windows used throughout the engine */
export const DEFAULT_WINDOWS = [30, 60, 90];
