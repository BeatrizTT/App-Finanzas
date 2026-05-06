// Factory functions for PriceValidation audit objects.
// Providers create these alongside price data; engine consumers check suitableFor* flags.
// No API calls here — pure construction logic only.

import type { PriceSource, PriceValidation } from '../types';

/**
 * No price data available from any provider or cache.
 * Nothing is suitable; engine should show "—" and skip this holding in buy sizing.
 */
export function unavailableValidation(symbol: string): PriceValidation {
  return {
    symbol,
    source: 'unavailable',
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
 * Drawdown % is valid; the USD price must never be used for P&L or buy sizing.
 */
export function proxyValidation(symbol: string, source: PriceSource): PriceValidation {
  return {
    symbol,
    source,
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
 * Price fetched in USD from a US-listed security via Twelve Data or Yahoo.
 * Drawdown is valid. P&L requires a EUR/USD conversion step (done in the engine).
 * Buy recommendation is valid only after FX conversion — mark as false here;
 * the engine sets this to true once it applies the rate.
 */
export function usdUnconvertedValidation(symbol: string, source: PriceSource): PriceValidation {
  return {
    symbol,
    source,
    fetchedCurrency: 'USD',
    expectedCurrency: 'USD',
    currencyConfirmed: true,
    suitableForExactPnl: false,      // needs EUR/USD conversion first
    suitableForBuyRecommendation: false, // set to true by engine after FX conversion
    suitableForDrawdown: true,
    isProxy: false,
    note: 'USD price — needs EUR/USD FX conversion before use in P&L or sizing',
  };
}

/**
 * Price confirmed in EUR directly from the provider (EODHD, LSE in GBX→GBP→EUR, etc.).
 * Suitable for all purposes — exact P&L, buy recommendations, drawdown.
 */
export function confirmedEurValidation(symbol: string, source: PriceSource): PriceValidation {
  return {
    symbol,
    source,
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
 * Price in GBX (pence) that has been converted to GBP and then to EUR.
 * After conversion, equivalent to a confirmed EUR validation.
 */
export function gbxConvertedValidation(symbol: string, source: PriceSource): PriceValidation {
  return {
    symbol,
    source,
    fetchedCurrency: 'GBX',
    expectedCurrency: 'EUR',
    currencyConfirmed: true,
    suitableForExactPnl: true,
    suitableForBuyRecommendation: true,
    suitableForDrawdown: true,
    isProxy: false,
    note: 'GBX (pence) converted to EUR via GBP/EUR rate',
  };
}

/**
 * Currency mismatch — provider returned a currency different from what config expects.
 * Only drawdown is safe to use. P&L and sizing are blocked until mismatch is resolved.
 */
export function currencyMismatchValidation(
  symbol: string,
  source: PriceSource,
  fetchedCurrency: string,
  expectedCurrency: string
): PriceValidation {
  return {
    symbol,
    source,
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
 * Returns true if validation says this price can be used for the given purpose.
 */
export function isSuitableFor(
  validation: PriceValidation | undefined,
  purpose: import('../types').PricingPurpose
): boolean {
  if (!validation) return false;
  switch (purpose) {
    case 'exact_pnl':           return validation.suitableForExactPnl;
    case 'buy_recommendation':  return validation.suitableForBuyRecommendation;
    case 'drawdown':            return validation.suitableForDrawdown;
    case 'display':             return validation.source !== 'unavailable';
  }
}
