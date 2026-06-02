// P3-2: pure pricing-reliability helpers + pricing-method badge mapping.
// Run with: npx tsx src/lib/scanner/__tests__/pricing-reliability.test.ts
//
// Verifies:
//  derivePricingDataAvailable:
//    - null price → false (any validation)
//    - legacy (no validation) + price → true
//    - usd_no_fx / proxy / unconfirmed / unavailable → false
//    - usd_converted / direct_eur_quote (price present) → true
//  buildWhyNotBuyPricingReason:
//    - WATCH + usd_no_fx (no prior degradation) → reason mentions FX / caída
//    - WATCH whose reasons already contain applyPricingSafety's "no apto" → null (no duplicate)
//    - non-WATCH (AVOID) → null
//    - buy-safe validation → null
//    - legacy (no validation) → null
//  pricingMethodBadgeConfig:
//    - direct_eur_quote and absent → null (silent)
//    - usd_converted / usd_no_fx / proxy_drawdown_only / unavailable → labelled config

import { derivePricingDataAvailable, buildWhyNotBuyPricingReason } from '../pricing-safety';
import { pricingMethodBadgeConfig } from '../../pricing/pricing-method-display';
import {
  confirmedEurValidation,
  usdConvertedValidation,
  usdNoFxValidation,
  proxyValidation,
  unconfirmedCurrencyValidation,
  unavailableValidation,
} from '../../pricing/price-validation';

// ---------------------------------------------------------------------------
// Micro-test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => void }> = [];

function assert(description: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    failed++;
  }
}

function test(name: string, fn: () => void): void {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// derivePricingDataAvailable
// ---------------------------------------------------------------------------

test('derivePricingDataAvailable: null price → false', () => {
  assert('null + eur validation → false', derivePricingDataAvailable(null, confirmedEurValidation('ASML', 'eodhd')) === false);
  assert('null + no validation → false', derivePricingDataAvailable(null, undefined) === false);
});

test('derivePricingDataAvailable: legacy provider with price → true', () => {
  assert('price + no validation → true', derivePricingDataAvailable(123.45, undefined) === true);
});

test('derivePricingDataAvailable: EUR-usable methods → true', () => {
  assert('direct_eur_quote → true', derivePricingDataAvailable(100, confirmedEurValidation('ASML', 'eodhd')) === true);
  assert('usd_converted → true', derivePricingDataAvailable(100, usdConvertedValidation('NVDA', 'eodhd')) === true);
});

test('derivePricingDataAvailable: degraded methods → false', () => {
  assert('usd_no_fx → false', derivePricingDataAvailable(100, usdNoFxValidation('AAPL', 'eodhd')) === false);
  assert('proxy_drawdown_only → false', derivePricingDataAvailable(100, proxyValidation('CNDX', 'twelvedata')) === false);
  assert('currency_unconfirmed → false', derivePricingDataAvailable(100, unconfirmedCurrencyValidation('X', 'eodhd', 'USD')) === false);
  assert('unavailable → false', derivePricingDataAvailable(null, unavailableValidation('X')) === false);
});

// ---------------------------------------------------------------------------
// buildWhyNotBuyPricingReason
// ---------------------------------------------------------------------------

test('buildWhyNotBuyPricingReason: WATCH + usd_no_fx (no prior warning) → FX reason', () => {
  const reason = buildWhyNotBuyPricingReason('WATCH', ['Drawdown: -20%'], usdNoFxValidation('AAPL', 'eodhd'));
  assert('reason is non-null', reason != null);
  assert('mentions FX', !!reason && reason.toLowerCase().includes('fx'));
  assert('explains only caída válida', !!reason && reason.includes('caída'));
});

test('buildWhyNotBuyPricingReason: reasons already contain "no apto" → null (no duplicate)', () => {
  const reasons = ['Precio no apto para recomendación de compra (usd_no_fx) — solo análisis de caída', 'Drawdown: -20%'];
  const reason = buildWhyNotBuyPricingReason('WATCH', reasons, usdNoFxValidation('AAPL', 'eodhd'));
  assert('returns null when degradation warning present', reason === null);
});

test('buildWhyNotBuyPricingReason: non-WATCH state → null', () => {
  assert('AVOID → null', buildWhyNotBuyPricingReason('AVOID', ['x'], usdNoFxValidation('AAPL', 'eodhd')) === null);
  assert('BUY → null', buildWhyNotBuyPricingReason('BUY', ['x'], usdNoFxValidation('AAPL', 'eodhd')) === null);
});

test('buildWhyNotBuyPricingReason: buy-safe or legacy validation → null', () => {
  assert('usd_converted (buy-safe) → null', buildWhyNotBuyPricingReason('WATCH', ['x'], usdConvertedValidation('NVDA', 'eodhd')) === null);
  assert('no validation (legacy) → null', buildWhyNotBuyPricingReason('WATCH', ['x'], undefined) === null);
});

test('buildWhyNotBuyPricingReason: proxy and unconfirmed get method-specific reasons', () => {
  const proxy = buildWhyNotBuyPricingReason('WATCH', ['x'], proxyValidation('CNDX', 'twelvedata'));
  const unconf = buildWhyNotBuyPricingReason('WATCH', ['x'], unconfirmedCurrencyValidation('X', 'eodhd', 'USD'));
  assert('proxy → mentions proxy', !!proxy && proxy.toLowerCase().includes('proxy'));
  assert('unconfirmed → mentions moneda', !!unconf && unconf.toLowerCase().includes('moneda'));
});

// ---------------------------------------------------------------------------
// pricingMethodBadgeConfig
// ---------------------------------------------------------------------------

test('pricingMethodBadgeConfig: silent for clean EUR and absent metadata', () => {
  assert('direct_eur_quote → null', pricingMethodBadgeConfig('direct_eur_quote') === null);
  assert('undefined → null', pricingMethodBadgeConfig(undefined) === null);
});

test('pricingMethodBadgeConfig: labelled config for noteworthy methods', () => {
  assert('usd_converted has USD→EUR label', pricingMethodBadgeConfig('usd_converted')?.label === 'USD→EUR ✓');
  assert('usd_no_fx has sin FX label', pricingMethodBadgeConfig('usd_no_fx')?.label === 'USD · sin FX');
  assert('proxy_drawdown_only has caída label', pricingMethodBadgeConfig('proxy_drawdown_only')?.label === 'Solo caída %');
  assert('unavailable has Sin precio label', pricingMethodBadgeConfig('unavailable')?.label === 'Sin precio');
  assert('usd_no_fx is amber', pricingMethodBadgeConfig('usd_no_fx')?.color.includes('amber') === true);
  assert('unavailable is red', pricingMethodBadgeConfig('unavailable')?.color.includes('red') === true);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function main(): void {
  for (const { name, fn } of tests) {
    console.log(`\n${name}`);
    try {
      fn();
    } catch (err) {
      console.error(`  ✗ THREW: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
