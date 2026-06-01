// Factory functions for PriceValidation audit objects.
// Providers create these alongside price data; engine consumers check suitableFor* flags.
// No API calls here — pure construction logic only.

import type { PriceProviderId, PriceMethod, PricingPurpose, PriceValidation } from '../types';

/**
 * No price data available from any provider or cache.
 * All suitableFor* = false. Engine must show "—" for P&L and skip buy sizing.
 */
export function unavailableValidation(symbol: string): PriceValidation {
  return {
    symbol,
    provider: 'none',
    method: 'unavailable',
    fetchedCurrency: null,
    expectedCurrency: null,
    currencyConfirmed: false,
    suitableForExactPnl: false,
    suitableForBuyRecommendation: false,
    suitableForDrawdown: false,
    isProxy: false,
    note: 'No price data available from any provider',
  };
}

/**
 * USD proxy for a EUR-denominated instrument (e.g. QQQ standing in for CNDX).
 * Drawdown % is valid and currency-independent.
 * The USD currentPrice must never be used for P&L or buy sizing.
 */
export function proxyValidation(symbol: string, provider: PriceProviderId): PriceValidation {
  return {
    symbol,
    provider,
    method: 'proxy_drawdown_only',
    fetchedCurrency: 'USD',
    expectedCurrency: 'EUR',
    currencyConfirmed: false,
    suitableForExactPnl: false,
    suitableForBuyRecommendation: false,
    suitableForDrawdown: true,
    isProxy: true,
    note: 'USD proxy — drawdown % valid, currentPrice must not be used for P&L or sizing',
  };
}

/**
 * USD price that has been successfully converted to EUR using a live or cached FX rate.
 * Suitable for all purposes including exact P&L.
 */
export function usdConvertedValidation(symbol: string, provider: PriceProviderId): PriceValidation {
  return {
    symbol,
    provider,
    method: 'usd_converted',
    fetchedCurrency: 'USD',
    expectedCurrency: 'EUR',
    currencyConfirmed: true,
    suitableForExactPnl: true,
    suitableForBuyRecommendation: true,
    suitableForDrawdown: true,
    isProxy: false,
  };
}

/**
 * Provider returned a price but did NOT include currency in the response.
 * Currency is inferred from exchange code or config — not confirmed.
 * Only drawdown % is safe. P&L and buy sizing blocked until P2c validation confirms
 * the actual currency from a real provider response.
 */
export function unconfirmedCurrencyValidation(
  symbol: string,
  provider: PriceProviderId,
  inferredCurrency: string,
  note?: string
): PriceValidation {
  return {
    symbol,
    provider,
    method: 'currency_unconfirmed',
    fetchedCurrency: null,           // provider response did not include currency
    expectedCurrency: inferredCurrency,
    currencyConfirmed: false,
    suitableForExactPnl: false,
    suitableForBuyRecommendation: false,
    suitableForDrawdown: true,
    isProxy: false,
    note: note ?? `Currency inferred as ${inferredCurrency} from exchange code — not confirmed by provider response`,
  };
}

/**
 * USD price is available but no valid EUR/USD FX rate could be obtained.
 * Drawdown % is still valid. P&L and buy sizing are blocked until FX is available.
 * Never use a hardcoded fallback rate — leave P&L as "—" instead.
 */
export function usdNoFxValidation(symbol: string, provider: PriceProviderId): PriceValidation {
  return {
    symbol,
    provider,
    method: 'usd_no_fx',
    fetchedCurrency: 'USD',
    expectedCurrency: 'EUR',
    currencyConfirmed: false,
    suitableForExactPnl: false,
    suitableForBuyRecommendation: false,
    suitableForDrawdown: true,
    isProxy: false,
    note: 'USD price available but no valid EUR/USD FX rate — P&L unavailable',
  };
}

/**
 * Price confirmed in EUR directly from the provider (e.g. EODHD for Euronext instruments).
 * Suitable for all purposes — exact P&L, buy recommendations, drawdown.
 */
export function confirmedEurValidation(symbol: string, provider: PriceProviderId): PriceValidation {
  return {
    symbol,
    provider,
    method: 'direct_eur_quote',
    fetchedCurrency: 'EUR',
    expectedCurrency: 'EUR',
    currencyConfirmed: true,
    suitableForExactPnl: true,
    suitableForBuyRecommendation: true,
    suitableForDrawdown: true,
    isProxy: false,
  };
}

/**
 * GBP price (pounds, not pence) converted to EUR using a live or cached GBP/EUR rate.
 * Suitable for all purposes after conversion.
 */
export function gbpConvertedValidation(symbol: string, provider: PriceProviderId): PriceValidation {
  return {
    symbol,
    provider,
    method: 'gbp_converted',
    fetchedCurrency: 'GBP',
    expectedCurrency: 'EUR',
    currencyConfirmed: true,
    suitableForExactPnl: true,
    suitableForBuyRecommendation: true,
    suitableForDrawdown: true,
    isProxy: false,
    note: 'GBP price converted to EUR via GBP/EUR rate',
  };
}

/**
 * GBX or GBp (pence) price converted to EUR: rawPrice / 100 * GBP/EUR rate.
 * Both "GBX" and "GBp" are treated identically — both mean pence sterling.
 * The exact sourceCurrency string from the provider is recorded in fetchedCurrency.
 */
export function gbpPenceConvertedValidation(
  symbol: string,
  provider: PriceProviderId,
  sourceCurrency: 'GBX' | 'GBp' | string
): PriceValidation {
  return {
    symbol,
    provider,
    method: 'gbp_pence_converted',
    fetchedCurrency: sourceCurrency,
    expectedCurrency: 'EUR',
    currencyConfirmed: true,
    suitableForExactPnl: true,
    suitableForBuyRecommendation: true,
    suitableForDrawdown: true,
    isProxy: false,
    note: `${sourceCurrency} (pence) converted to EUR via /100 * GBP/EUR rate`,
  };
}

/**
 * Stale cache value used as a last resort after a live fetch failed.
 * May be hours or days old. Suitable for drawdown and display, but not exact P&L or sizing
 * unless the cached currency was EUR (checked by the engine before setting suitableFor*).
 */
export function cachedLastValidValidation(
  symbol: string,
  fetchedCurrency: string | null,
  expectedCurrency: string | null
): PriceValidation {
  const isSameEur =
    fetchedCurrency === 'EUR' && expectedCurrency === 'EUR';
  return {
    symbol,
    provider: 'cache',
    method: 'cached_last_valid',
    fetchedCurrency,
    expectedCurrency,
    currencyConfirmed: fetchedCurrency === expectedCurrency,
    suitableForExactPnl: isSameEur,
    suitableForBuyRecommendation: isSameEur,
    suitableForDrawdown: true,
    isProxy: false,
    note: 'Stale cache value used — live fetch failed or quota exceeded',
  };
}

/**
 * Currency mismatch — provider returned a currency different from what config expects.
 * Only drawdown % is safe. P&L and sizing are blocked until mismatch is resolved.
 */
export function currencyMismatchValidation(
  symbol: string,
  provider: PriceProviderId,
  fetchedCurrency: string,
  expectedCurrency: string
): PriceValidation {
  return {
    symbol,
    provider,
    method: 'unavailable',
    fetchedCurrency,
    expectedCurrency,
    currencyConfirmed: false,
    suitableForExactPnl: false,
    suitableForBuyRecommendation: false,
    suitableForDrawdown: true,
    isProxy: false,
    note: `Currency mismatch: got ${fetchedCurrency}, expected ${expectedCurrency}`,
  };
}

/**
 * Guard: returns true if a validation object says this price is suitable for the given purpose.
 * Pass undefined when validation is absent (legacy/unknown) — returns false for safety.
 */
export function isSuitableFor(
  validation: PriceValidation | undefined,
  purpose: PricingPurpose
): boolean {
  if (!validation) return false;
  switch (purpose) {
    case 'exact_pnl':           return validation.suitableForExactPnl;
    case 'buy_recommendation':  return validation.suitableForBuyRecommendation;
    case 'drawdown':            return validation.suitableForDrawdown;
    case 'display':             return validation.method !== 'unavailable';
  }
}
