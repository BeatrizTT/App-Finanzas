// Pure presentation mapping for PriceMethod → pricing-reliability badge.
// No React, no side effects — kept in lib so it can be unit-tested without a render framework.
// Consumed by src/components/ui/badge.tsx (PricingMethodBadge).
//
// Colour semantics:
//   green = price converted to EUR with a real rate, safe for P&L/sizing
//   amber = price exists but not EUR-usable; only drawdown % is valid
//   red   = no usable price at all
//
// Returns null (no badge) for:
//   - direct_eur_quote — clean native EUR quote, nothing to warn about
//   - absent metadata   — legacy provider without validation; stay silent

import type { PriceMethod } from '../types';

export interface PricingBadgeConfig {
  label: string;
  color: string;
  tooltip: string;
}

const PRICING_METHOD_BADGE: Record<string, PricingBadgeConfig> = {
  usd_converted:        { label: 'USD→EUR ✓',           color: 'bg-green-900/50 text-green-300', tooltip: 'Precio en USD convertido a EUR con un tipo de cambio real. Apto para P&L y sizing.' },
  gbp_converted:        { label: 'GBP→EUR ✓',           color: 'bg-green-900/50 text-green-300', tooltip: 'Precio en GBP convertido a EUR con un tipo de cambio real. Apto para P&L y sizing.' },
  gbp_pence_converted:  { label: 'GBX→EUR ✓',           color: 'bg-green-900/50 text-green-300', tooltip: 'Precio en peniques (GBX) convertido a EUR. Apto para P&L y sizing.' },
  usd_no_fx:            { label: 'USD · sin FX',         color: 'bg-amber-900/50 text-amber-300', tooltip: 'Precio en USD confirmado pero sin tipo de cambio EUR/USD fresco. Solo el % de caída es válido; P&L y sizing bloqueados.' },
  proxy_drawdown_only:  { label: 'Solo caída %',         color: 'bg-amber-900/50 text-amber-300', tooltip: 'El precio es un proxy USD de un instrumento EUR. Solo el % de caída es válido; no usar para P&L ni sizing.' },
  currency_unconfirmed: { label: 'Moneda no confirmada', color: 'bg-amber-900/50 text-amber-300', tooltip: 'El proveedor no devolvió la divisa. Solo el % de caída es válido hasta confirmar la moneda.' },
  cached_last_valid:    { label: 'Caché',                color: 'bg-amber-900/50 text-amber-300', tooltip: 'Precio servido desde caché — puede estar desactualizado. Sin BUY hasta refrescar.' },
  unavailable:          { label: 'Sin precio',           color: 'bg-red-900/50 text-red-300',     tooltip: 'Sin datos de precio de ningún proveedor. Solo análisis cualitativo.' },
};

/** Returns the badge config for a pricing method, or null when no badge should render. */
export function pricingMethodBadgeConfig(method?: PriceMethod): PricingBadgeConfig | null {
  if (!method || method === 'direct_eur_quote') return null;
  return PRICING_METHOD_BADGE[method] ?? null;
}
