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
