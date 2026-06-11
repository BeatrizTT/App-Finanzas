// Build EUR-equivalent prices for the portfolio engine.
//
// Source of truth rules:
//   validation present, suitableForExactPnl=true  → provider/chain already confirmed EUR price,
//                                                   pass through unchanged (no second FX step)
//   validation present, suitableForExactPnl=false → price is not EUR-safe (unconfirmed currency,
//                                                   usd_no_fx, proxy, mismatch): null out
//   validation absent (legacy: Twelve Data, Yahoo, mock)
//                                                 → apply eurUsdRate for USD holdings, as before
//
// This prevents double FX conversion (chain converts USD→EUR inside the provider, then the
// engine incorrectly divides again) and blocks usd_no_fx/currency_unconfirmed/proxy from
// feeding into P&L or state decisions.

import type { RecentHighs } from '../types';

export function buildPortfolioHighs(
  allHighs: Record<string, RecentHighs>,
  usdTickers: Set<string>,
  eurUsdRate: number
): Record<string, RecentHighs> {
  const result: Record<string, RecentHighs> = {};

  for (const [ticker, highs] of Object.entries(allHighs)) {
    const v = highs.validation;

    if (v) {
      // Provider carries validation — chain is the source of truth for currency conversion
      result[ticker] = v.suitableForExactPnl
        ? highs                                   // already EUR-equivalent — no conversion
        : { ...highs, currentPrice: null };        // not suitable — null for P&L safety
    } else {
      // Legacy provider (Twelve Data, Yahoo, mock) — apply EUR/USD for USD holdings
      if (usdTickers.has(ticker) && highs.currentPrice != null && highs.currentPrice > 0) {
        // Guard: an invalid/unavailable FX rate (0 or negative) must not produce Infinity
        // or a nonsense negative price. Return null to force P&L unavailable.
        if (eurUsdRate <= 0) {
          result[ticker] = { ...highs, currentPrice: null };
        } else {
          result[ticker] = { ...highs, currentPrice: highs.currentPrice / eurUsdRate };
        }
      } else {
        result[ticker] = highs;
      }
    }
  }

  return result;
}
