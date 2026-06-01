// Purpose-aware provider chain.
//
// Chain order per instrument:
//   1. Fresh cache (must satisfy requested purpose)
//   2. Each provider in order — stops at first result that satisfies purpose
//   3. Fresh cache ignoring purpose (at least for drawdown)
//   4. Stale cache (marked as cached_last_valid)
//   5. Unavailable
//
// Key rule: a result with method=currency_unconfirmed (e.g. EODHD) does NOT stop the
// chain for exact_pnl or buy_recommendation purposes — the chain continues to the next
// provider to find a better result.
//
// Activated via PRICE_PROVIDER=chain in env. Sub-providers parsed from PRICE_PROVIDER_CHAIN.

import {
  loadPriceCache,
  savePriceCache,
  setCached,
  getCachedForPurpose,
  getCachedStale,
  getCached,
} from './price-cache';
import {
  isSuitableFor,
  unavailableValidation,
  cachedLastValidValidation,
} from './price-validation';
import type { PriceProvider } from './interface';
import type { PriceData, HistoricalPrices, RecentHighs, PricingPurpose } from '../types';
// PricingPurpose is also re-exported via interface.ts — import from types to avoid indirection

// Numeric level for comparing partial results when no provider satisfies the full purpose.
// exact_pnl(4) > buy_recommendation(3) > drawdown(2) > display(1) > unavailable(0)
function validationLevel(highs: RecentHighs): number {
  const v = highs.validation;
  if (!v || v.method === 'unavailable') return 0;
  if (v.suitableForExactPnl) return 4;
  if (v.suitableForBuyRecommendation) return 3;
  if (v.suitableForDrawdown) return 2;
  return 1;
}

/**
 * Resolve a price for one instrument using purpose-aware provider fallback.
 * Exported so callers can request a specific purpose (e.g. 'exact_pnl' for portfolio engine).
 */
export async function resolvePriceForInstrument(
  symbol: string,
  purpose: PricingPurpose,
  providers: PriceProvider[],
  windows?: number[]
): Promise<RecentHighs> {
  const cache = loadPriceCache();

  // 1. Fast path: fresh cache entry that already satisfies the requested purpose
  const freshSuitable = getCachedForPurpose(cache, symbol, purpose);
  if (freshSuitable) return freshSuitable;

  let bestFromProviders: RecentHighs | null = null;

  // 2. Try each provider in order; stop as soon as purpose is satisfied
  for (const provider of providers) {
    let result: RecentHighs;
    try {
      result = await provider.getRecentHighs(symbol, windows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Chain] ${provider.providerName} threw for ${symbol}: ${msg}`);
      continue;
    }

    // Persist any non-unavailable result for future runs
    if (result.validation?.method !== 'unavailable') {
      setCached(cache, symbol, result);
      savePriceCache(cache);
    }

    // Return immediately if this result satisfies the requested purpose
    if (isSuitableFor(result.validation, purpose)) {
      return result;
    }

    // Track the best partial result in case no provider fully satisfies the purpose
    if (!bestFromProviders || validationLevel(result) > validationLevel(bestFromProviders)) {
      bestFromProviders = result;
    }

    console.log(
      `[Chain] ${provider.providerName}: ${result.validation?.method ?? 'unknown'} for ${symbol}` +
      ` — not suitable for ${purpose}, continuing chain`
    );
  }

  // 3. No provider satisfied purpose. Choose best available fallback:

  // 3a. Best live result (at least drawdown-capable) — used for scanner/display
  if (bestFromProviders && isSuitableFor(bestFromProviders.validation, 'drawdown')) {
    if (purpose === 'exact_pnl' || purpose === 'buy_recommendation') {
      console.warn(
        `[Chain] ${symbol}: no provider satisfied ${purpose} — ` +
        `using best available (${bestFromProviders.validation?.method ?? 'unknown'}, drawdown-only)`
      );
    }
    return bestFromProviders;
  }

  // 3b. Fresh cache, ignoring purpose mismatch — all providers failed so use what we have
  const freshAny = getCached(cache, symbol);
  if (freshAny && isSuitableFor(freshAny.validation, 'drawdown')) {
    console.warn(
      `[Chain] ${symbol}: all providers failed/insufficient, falling back to fresh cache` +
      ` (${freshAny.validation?.method ?? 'unknown'})`
    );
    return freshAny;
  }

  // 3c. Best partial live result (even display-only) — better than stale or nothing
  if (bestFromProviders) {
    return bestFromProviders;
  }

  // 3d. Stale cache — last resort before returning unavailable
  const stale = getCachedStale(cache, symbol);
  if (stale && stale.validation?.method !== 'unavailable') {
    const staleV = cachedLastValidValidation(
      symbol,
      stale.validation?.fetchedCurrency ?? null,
      stale.validation?.expectedCurrency ?? null
    );
    console.warn(`[Chain] ${symbol}: using stale cache as last resort`);
    return { ...stale, validation: staleV };
  }

  // 3e. Completely unavailable
  console.warn(`[Chain] ${symbol}: no price data from any provider or cache`);
  return {
    symbol,
    high30d: 0, high60d: 0, high90d: 0,
    currentPrice: null,
    drawdown30d: 0, drawdown60d: 0, drawdown90d: 0,
    validation: unavailableValidation(symbol),
  };
}

// ---------------------------------------------------------------------------
// ChainedPriceProvider — wraps resolvePriceForInstrument as a PriceProvider
// ---------------------------------------------------------------------------

export class ChainedPriceProvider implements PriceProvider {
  readonly providerName = 'chain';
  private readonly providers: PriceProvider[];

  constructor(providers: PriceProvider[]) {
    if (providers.length === 0) {
      throw new Error('[ChainedPriceProvider] requires at least one sub-provider');
    }
    this.providers = providers;
  }

  async getCurrentPrice(symbol: string): Promise<PriceData> {
    const highs = await this.getRecentHighs(symbol);
    if (highs.currentPrice == null) {
      throw new Error(
        `[Chain] No usable price for ${symbol}` +
        ` (method: ${highs.validation?.method ?? 'unknown'})` +
        ` — suitableForExactPnl=${highs.validation?.suitableForExactPnl ?? false}`
      );
    }
    return {
      symbol,
      currentPrice: highs.currentPrice,
      currency:
        highs.validation?.fetchedCurrency ??
        highs.validation?.expectedCurrency ??
        'USD',
      timestamp: new Date(),
    };
  }

  async getHistoricalPrices(symbol: string, days: number): Promise<HistoricalPrices> {
    for (const p of this.providers) {
      try {
        return await p.getHistoricalPrices(symbol, days);
      } catch {
        continue;
      }
    }
    return { symbol, prices: [] };
  }

  async getRecentHighs(symbol: string, windows?: number[]): Promise<RecentHighs> {
    // Default purpose when caller doesn't specify: buy_recommendation.
    // The engine should prefer getRecentHighsForPurpose for portfolio (exact_pnl) vs scanner.
    return resolvePriceForInstrument(symbol, 'buy_recommendation', this.providers, windows);
  }

  async getRecentHighsForPurpose(
    symbol: string,
    purpose: PricingPurpose,
    windows?: number[]
  ): Promise<RecentHighs> {
    return resolvePriceForInstrument(symbol, purpose, this.providers, windows);
  }

  // No batchGetRecentHighs — chain resolution is inherently sequential per symbol.
  // The engine falls back to sequential fetching when batchGetRecentHighs is absent.
}
