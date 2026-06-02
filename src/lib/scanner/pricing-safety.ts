// Pure pricing-safety guard for scanner output.
// No config or provider dependencies — depends only on types.
//
// Rule: if validation.suitableForBuyRecommendation !== true, the scanner must not
// return BUY/READY_TO_BUY with suggestedAmountEur > 0. Degrade to WATCH and zero
// sizing. Legacy providers without validation metadata are trusted (backward compat).
//
// Callers: scoreAsset() in scanner.ts (applied after scoring, before returning Opportunity).
// Tests: scanner/__tests__/scanner-safety.test.ts

import type { OpportunityState, PriceValidation } from '../types';

export interface PricingSafetyResult {
  state: OpportunityState;
  suggestedAmountEur: { min: number; max: number };
  reasons: string[];
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Apply pricing suitability check to a scored scanner opportunity.
 * When the price is not suitable for buy recommendation, BUY/READY_TO_BUY are
 * degraded to WATCH, sizing is zeroed, and confidence drops to low.
 * All other states (WATCH, AVOID, HOLD, etc.) are left as-is even if price is degraded
 * — they don't imply buy sizing, so no additional risk.
 */
export function applyPricingSafety(
  state: OpportunityState,
  suggestedAmountEur: { min: number; max: number },
  reasons: string[],
  confidence: 'low' | 'medium' | 'high',
  validation: PriceValidation | undefined
): PricingSafetyResult {
  // No validation (legacy provider like Twelve Data) or already suitable → pass through
  if (!validation || validation.suitableForBuyRecommendation) {
    return { state, suggestedAmountEur, reasons, confidence };
  }

  // Price is not buy-safe (currency_unconfirmed, usd_no_fx, proxy_drawdown_only, etc.)
  // Degrade BUY/READY_TO_BUY → WATCH; all other states unchanged (they don't imply sizing)
  const degraded: OpportunityState =
    state === 'BUY' || state === 'READY_TO_BUY' ? 'WATCH' : state;

  const warning =
    `Precio no apto para recomendación de compra (${validation.method}) — solo análisis de caída`;

  return {
    state: degraded,
    suggestedAmountEur: { min: 0, max: 0 },
    // Prepend warning only when state actually changed (prevents duplicate reasons for WATCH)
    reasons: degraded !== state ? [warning, ...reasons] : reasons,
    confidence: 'low',
  };
}

/**
 * Derive a single boolean for "do we have a usable EUR-denominated price?".
 *
 * Rules:
 *  - currentPrice === null               → false (nothing usable)
 *  - no validation (legacy provider)     → true  (price present, trusted for backward compat)
 *  - validation present                  → true only if EUR-usable for exact P&L or buy sizing
 *
 * Returns false for usd_no_fx, proxy_drawdown_only, currency_unconfirmed, unavailable, and
 * stale non-EUR cache — all of which leave currentPrice null upstream anyway, but the explicit
 * check keeps this safe if a provider ever sets a price it shouldn't.
 */
export function derivePricingDataAvailable(
  currentPrice: number | null,
  validation: PriceValidation | undefined,
): boolean {
  if (currentPrice == null) return false;
  if (!validation) return true; // legacy/unknown provider — price present is enough
  return validation.suitableForExactPnl || validation.suitableForBuyRecommendation;
}

/**
 * For a final WATCH opportunity whose pricing is not buy-safe, return a single
 * "why this isn't a BUY" reason explaining the pricing limitation — otherwise null.
 *
 * Returns null when:
 *  - state is not WATCH (AVOID and actionable states don't need buy-context here)
 *  - validation is absent (legacy) or already buy-safe (no limitation to explain)
 *  - reasons already contain the applyPricingSafety degradation warning (avoid duplicate
 *    for the BUY→WATCH path — Scenario A)
 *
 * Fires for WATCH assets that never reached BUY (Scenario B) and for WATCH assets whose
 * state did not change but whose pricing is degraded (Scenario C).
 */
export function buildWhyNotBuyPricingReason(
  state: OpportunityState,
  reasons: string[],
  validation: PriceValidation | undefined,
): string | null {
  if (state !== 'WATCH') return null;
  if (!validation || validation.suitableForBuyRecommendation) return null;
  // applyPricingSafety already prepended a "no apto" warning for the BUY→WATCH path.
  if (reasons.some((r) => r.includes('no apto'))) return null;

  switch (validation.method) {
    case 'usd_no_fx':
      return 'USD confirmado · sin FX fresco — sizing y P&L exacto bloqueados; solo análisis de caída válido';
    case 'proxy_drawdown_only':
      return 'Precio es proxy USD — solo % de caída válido; sin precio EUR no hay BUY ni sizing';
    case 'currency_unconfirmed':
      return 'Moneda no confirmada por el proveedor — sin BUY ni P&L exacto hasta validar divisa';
    case 'cached_last_valid':
      return 'Precio desde caché (posiblemente desactualizado) — sin BUY hasta refrescar precio';
    case 'unavailable':
      return 'Sin precio disponible — solo análisis cualitativo; no es recomendación de compra';
    default:
      return 'Precio no apto para recomendación de compra — solo análisis de caída';
  }
}
