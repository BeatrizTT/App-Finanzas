// Inline tests for applyPricingSafety — scanner BUY degradation when pricing is unsuitable.
// Run with: npx tsx src/lib/scanner/__tests__/scanner-safety.test.ts
//
// Verifies:
//  - BUY + unconfirmed currency → WATCH, sizing zeroed, confidence low, warning prepended
//  - READY_TO_BUY + proxy → WATCH, sizing zeroed
//  - WATCH + unconfirmed → WATCH (no state change, no extra reason)
//  - AVOID unchanged regardless of validation
//  - BUY + confirmed EUR → unchanged (pass through)
//  - BUY + usd_converted → unchanged (pass through)
//  - BUY + no validation (legacy) → unchanged (backward compat)
//  - usd_no_fx with BUY → WATCH, zeroed

import { applyPricingSafety } from '../pricing-safety';
import {
  confirmedEurValidation,
  usdConvertedValidation,
  unconfirmedCurrencyValidation,
  proxyValidation,
  usdNoFxValidation,
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

const FULL_SIZING = { min: 100, max: 200 };
const ZERO_SIZING = { min: 0, max: 0 };
const REASONS = ['drawdown -15%', 'high quality asset'];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('BUY + currency_unconfirmed → WATCH, sizing zeroed, confidence low', () => {
  const r = applyPricingSafety(
    'BUY', FULL_SIZING, [...REASONS], 'high',
    unconfirmedCurrencyValidation('ASML', 'eodhd', 'EUR')
  );
  assert('state degraded to WATCH', r.state === 'WATCH');
  assert('suggestedAmountEur.min = 0', r.suggestedAmountEur.min === 0);
  assert('suggestedAmountEur.max = 0', r.suggestedAmountEur.max === 0);
  assert('confidence degraded to low', r.confidence === 'low');
  assert('warning reason prepended', r.reasons[0].includes('no apto'));
  assert('original reasons preserved after warning', r.reasons.length === 3);
});

test('READY_TO_BUY + proxy_drawdown_only → WATCH, sizing zeroed', () => {
  const r = applyPricingSafety(
    'READY_TO_BUY', FULL_SIZING, [...REASONS], 'medium',
    proxyValidation('CNDX', 'twelvedata')
  );
  assert('READY_TO_BUY → WATCH', r.state === 'WATCH');
  assert('sizing zeroed', r.suggestedAmountEur.max === 0);
  assert('confidence low', r.confidence === 'low');
  assert('warning reason prepended', r.reasons[0].includes('proxy_drawdown_only'));
});

test('BUY + usd_no_fx → WATCH, sizing zeroed', () => {
  const r = applyPricingSafety(
    'BUY', FULL_SIZING, [...REASONS], 'high',
    usdNoFxValidation('NVDA', 'eodhd')
  );
  assert('BUY → WATCH (no FX)', r.state === 'WATCH');
  assert('sizing zeroed', r.suggestedAmountEur.max === 0);
});

test('WATCH + unconfirmed → WATCH (no state change, no extra reason prepended)', () => {
  const r = applyPricingSafety(
    'WATCH', ZERO_SIZING, [...REASONS], 'low',
    unconfirmedCurrencyValidation('NVDA', 'eodhd', 'USD')
  );
  assert('WATCH stays WATCH', r.state === 'WATCH');
  assert('sizing stays zero', r.suggestedAmountEur.max === 0);
  // No state change → no warning prepended (would be confusing for already-WATCH state)
  assert('no extra reason added', r.reasons.length === REASONS.length);
  assert('confidence low', r.confidence === 'low');
});

test('AVOID + unconfirmed → AVOID (non-buy state unchanged)', () => {
  const r = applyPricingSafety(
    'AVOID', ZERO_SIZING, [...REASONS], 'low',
    unconfirmedCurrencyValidation('X', 'eodhd', 'USD')
  );
  assert('AVOID unchanged', r.state === 'AVOID');
});

test('BUY + confirmed EUR → unchanged (pass through)', () => {
  const r = applyPricingSafety(
    'BUY', FULL_SIZING, [...REASONS], 'high',
    confirmedEurValidation('ASML', 'twelvedata')
  );
  assert('BUY preserved', r.state === 'BUY');
  assert('sizing preserved', r.suggestedAmountEur.max === 200);
  assert('confidence preserved', r.confidence === 'high');
  assert('reasons unchanged', r.reasons.length === REASONS.length);
});

test('BUY + usd_converted → unchanged (USD converted to EUR by chain)', () => {
  const r = applyPricingSafety(
    'BUY', FULL_SIZING, [...REASONS], 'high',
    usdConvertedValidation('NVDA', 'twelvedata')
  );
  assert('BUY preserved (usd_converted is buy-safe)', r.state === 'BUY');
  assert('sizing preserved', r.suggestedAmountEur.max === 200);
});

test('BUY + no validation (legacy provider) → unchanged (backward compat)', () => {
  const r = applyPricingSafety(
    'BUY', FULL_SIZING, [...REASONS], 'high',
    undefined  // no validation = legacy Twelve Data, Yahoo, mock
  );
  assert('BUY preserved for legacy provider', r.state === 'BUY');
  assert('sizing preserved', r.suggestedAmountEur.max === 200);
  assert('confidence preserved', r.confidence === 'high');
});

test('BUY + unavailable → WATCH, sizing zeroed', () => {
  const r = applyPricingSafety(
    'BUY', FULL_SIZING, [...REASONS], 'high',
    unavailableValidation('NVDA')
  );
  assert('BUY → WATCH (unavailable)', r.state === 'WATCH');
  assert('sizing zeroed', r.suggestedAmountEur.max === 0);
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
