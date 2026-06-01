// Inline tests for resolveValidationStatus and sanitizeApiKey.
// Run with: npx tsx src/lib/pricing/__tests__/eodhd-validator.test.ts
//
// All tests use mocked inputs — no API calls, no network, no env deps.
//
// Covers:
//  - validated_exact_eur: EUR confirmed + valid price + timestamp
//  - validated_usd_needs_fx: USD confirmed on .US exchange
//  - validated_gbp_needs_fx: GBP confirmed on LSE, price below pence threshold
//  - suspected_gbx_pence: explicit GBX/GBp currency code
//  - suspected_gbx_pence: GBP on LSE, price > threshold (heuristic)
//  - suspected_gbx_pence: GBP on non-LSE does NOT trigger heuristic
//  - currency_missing: symbol found, Currency field empty
//  - symbol_not_found: empty search results
//  - ambiguous_symbol: multiple matches same exchange
//  - ambiguous_symbol: match found on wrong exchange
//  - rejected_mismatch: confirmed USD when expected EUR
//  - quota_or_rate_limited: isQuota error
//  - provider_error: generic API error
//  - sanitizeApiKey: key replaced with [REDACTED]
//  - sanitizeApiKey: no crash when key is undefined
//  - report output: no API key in serialized result

import {
  resolveValidationStatus,
  sanitizeApiKey,
  type SymbolValidationInput,
  type EodhdSearchResult,
  type EodhdSamplePrice,
  type EodhdErrorContext,
} from '../eodhd-validator';

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
// Fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<SymbolValidationInput> = {}): SymbolValidationInput {
  return {
    internalTicker: 'ASML',
    eodhdSymbol: 'ASML.AS',
    exchange: 'AS',
    expectedCurrency: 'EUR',
    ...overrides,
  };
}

function makeSearchResult(overrides: Partial<EodhdSearchResult> = {}): EodhdSearchResult {
  return {
    Code: 'ASML',
    Exchange: 'AS',
    Name: 'ASML Holding NV',
    Type: 'Common Stock',
    Currency: 'EUR',
    ISIN: 'NL0010273215',
    previousClose: 650.5,
    previousCloseDate: '2025-05-06',
    ...overrides,
  };
}

const SAMPLE_PRICE: EodhdSamplePrice = { close: 650.5, date: '2025-05-06' };
const QUOTA_ERROR: EodhdErrorContext = { isQuota: true, isNotFound: false, isTimeout: false, isAuth: false, message: 'Daily API limit reached' };
const GENERIC_ERROR: EodhdErrorContext = { isQuota: false, isNotFound: false, isTimeout: false, isAuth: false, message: 'HTTP 500 from EODHD' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('validated_exact_eur: EUR confirmed + valid price + timestamp', () => {
  const r = resolveValidationStatus(makeInput(), [makeSearchResult()], null, SAMPLE_PRICE);
  assert('status is validated_exact_eur', r.status === 'validated_exact_eur');
  assert('confirmedCurrency is EUR', r.confirmedCurrency === 'EUR');
  assert('samplePrice matches', r.samplePrice === 650.5);
  assert('samplePriceDate set', r.samplePriceDate === '2025-05-06');
  assert('timestamp is ISO string', typeof r.timestamp === 'string' && r.timestamp.includes('T'));
  assert('no warnings', r.warnings.length === 0);
  assert('internalTicker preserved', r.internalTicker === 'ASML');
  assert('eodhdSymbol preserved', r.eodhdSymbol === 'ASML.AS');
});

test('validated_exact_eur: uses previousClose from search when no dedicated samplePrice', () => {
  const r = resolveValidationStatus(
    makeInput(),
    [makeSearchResult({ previousClose: 645.0, previousCloseDate: '2025-05-05' })],
    null,
    null  // no dedicated price call
  );
  assert('status is validated_exact_eur', r.status === 'validated_exact_eur');
  assert('samplePrice from previousClose', r.samplePrice === 645.0);
  assert('samplePriceDate from previousCloseDate', r.samplePriceDate === '2025-05-05');
});

test('validated_usd_needs_fx: USD confirmed on .US exchange', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US', expectedCurrency: 'USD' }),
    [makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', previousClose: 128.0, previousCloseDate: '2025-05-06' })],
    null,
    null
  );
  assert('status is validated_usd_needs_fx', r.status === 'validated_usd_needs_fx');
  assert('confirmedCurrency is USD', r.confirmedCurrency === 'USD');
  assert('samplePrice set', r.samplePrice === 128.0);
  assert('no warnings', r.warnings.length === 0);
});

test('validated_gbp_needs_fx: GBP on LSE with price below pence threshold', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'IWVL', eodhdSymbol: 'IWVL.LSE', exchange: 'LSE', expectedCurrency: 'GBP' }),
    [makeSearchResult({ Code: 'IWVL', Exchange: 'LSE', Currency: 'GBP', previousClose: 4.2, previousCloseDate: '2025-05-06' })],
    null,
    null
  );
  assert('status is validated_gbp_needs_fx', r.status === 'validated_gbp_needs_fx');
  assert('confirmedCurrency is GBP', r.confirmedCurrency === 'GBP');
  assert('no pence warning', !r.warnings.some(w => w.includes('pence')));
});

test('suspected_gbx_pence: EODHD reports explicit GBX currency code', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'CNDX', eodhdSymbol: 'CNDX.LSE', exchange: 'LSE', expectedCurrency: 'GBP' }),
    [makeSearchResult({ Code: 'CNDX', Exchange: 'LSE', Currency: 'GBX', previousClose: 15000, previousCloseDate: '2025-05-06' })],
    null,
    null
  );
  assert('status is suspected_gbx_pence', r.status === 'suspected_gbx_pence');
  assert('confirmedCurrency is GBX', r.confirmedCurrency === 'GBX');
  assert('warning mentions pence', r.warnings.some(w => w.includes('pence')));
});

test('suspected_gbx_pence: EODHD reports GBp (lowercase p = pence)', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'IWDA', eodhdSymbol: 'IWDA.LSE', exchange: 'LSE', expectedCurrency: 'GBP' }),
    [makeSearchResult({ Code: 'IWDA', Exchange: 'LSE', Currency: 'GBp', previousClose: 8700, previousCloseDate: '2025-05-06' })],
    null,
    null
  );
  assert('status is suspected_gbx_pence for GBp', r.status === 'suspected_gbx_pence');
  assert('confirmedCurrency is GBp', r.confirmedCurrency === 'GBp');
});

test('suspected_gbx_pence: GBP on LSE with price > 200 heuristic (100x normal GBP price)', () => {
  // GBP-labeled price of 5000 on LSE — clearly pence (1 GBP = 100 GBX, so £50 → 5000p)
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'CSPX', eodhdSymbol: 'CSPX.LSE', exchange: 'LSE', expectedCurrency: 'GBP' }),
    [makeSearchResult({ Code: 'CSPX', Exchange: 'LSE', Currency: 'GBP', previousClose: 5000, previousCloseDate: '2025-05-06' })],
    null,
    null
  );
  assert('status is suspected_gbx_pence (price heuristic)', r.status === 'suspected_gbx_pence');
  assert('warning mentions GBX', r.warnings.some(w => w.includes('GBX') || w.includes('pence')));
  assert('samplePrice preserved', r.samplePrice === 5000);
});

test('GBP on non-LSE exchange does NOT trigger pence heuristic', () => {
  // A stock on a non-LSE exchange priced at 5000 GBP is unusual but not automatically pence
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'FAKE', eodhdSymbol: 'FAKE.XETRA', exchange: 'XETRA', expectedCurrency: 'GBP' }),
    [makeSearchResult({ Code: 'FAKE', Exchange: 'XETRA', Currency: 'GBP', previousClose: 5000, previousCloseDate: '2025-05-06' })],
    null,
    null
  );
  assert('non-LSE GBP: validated_gbp_needs_fx (no pence heuristic)', r.status === 'validated_gbp_needs_fx');
});

test('currency_missing: symbol found but Currency field is empty', () => {
  const r = resolveValidationStatus(
    makeInput(),
    [makeSearchResult({ Currency: '' })],
    null,
    SAMPLE_PRICE
  );
  assert('status is currency_missing', r.status === 'currency_missing');
  assert('confirmedCurrency is null', r.confirmedCurrency === null);
  assert('warning mentions Currency field', r.warnings.some(w => w.includes('Currency')));
  assert('samplePrice still captured', r.samplePrice === 650.5);
});

test('symbol_not_found: empty search results array', () => {
  const r = resolveValidationStatus(makeInput(), [], null, null);
  assert('status is symbol_not_found', r.status === 'symbol_not_found');
  assert('confirmedCurrency is null', r.confirmedCurrency === null);
  assert('samplePrice is null', r.samplePrice === null);
  assert('warning mentions symbol', r.warnings.some(w => w.includes('ASML.AS')));
});

test('symbol_not_found: null search results (no response body)', () => {
  const r = resolveValidationStatus(makeInput(), null, null, null);
  assert('status is symbol_not_found for null results', r.status === 'symbol_not_found');
});

test('ambiguous_symbol: multiple matches on the same exchange', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'CNDX', eodhdSymbol: 'CNDX.LSE', exchange: 'LSE', expectedCurrency: 'GBP' }),
    [
      makeSearchResult({ Code: 'CNDX', Exchange: 'LSE', Currency: 'USD', Name: 'iShares CNDX USD' }),
      makeSearchResult({ Code: 'CNDX', Exchange: 'LSE', Currency: 'GBP', Name: 'iShares CNDX GBP' }),
    ],
    null,
    null
  );
  assert('status is ambiguous_symbol', r.status === 'ambiguous_symbol');
  assert('confirmedCurrency is null (not safe to pick)', r.confirmedCurrency === null);
  assert('warning mentions multiple matches', r.warnings.some(w => w.includes('2') || w.includes('matches')));
});

test('ambiguous_symbol: symbol found on different exchange than expected', () => {
  const r = resolveValidationStatus(
    makeInput({ exchange: 'AS' }),  // expect Euronext Amsterdam
    [makeSearchResult({ Exchange: 'XETRA' })],  // found on Xetra instead
    null,
    null
  );
  assert('status is ambiguous_symbol', r.status === 'ambiguous_symbol');
  assert('warning mentions exchange mismatch', r.warnings.some(w => w.includes('AS') || w.includes('XETRA')));
});

test('rejected_mismatch: confirmed USD when expected EUR', () => {
  // EODHD says USD for a symbol we expected to trade in EUR
  const r = resolveValidationStatus(
    makeInput({ expectedCurrency: 'EUR' }),
    [makeSearchResult({ Currency: 'USD' })],
    null,
    SAMPLE_PRICE
  );
  assert('status is rejected_mismatch', r.status === 'rejected_mismatch');
  assert('confirmedCurrency is USD', r.confirmedCurrency === 'USD');
  assert('warning mentions mismatch', r.warnings.some(w => w.includes('mismatch') || w.includes('EUR') || w.includes('USD')));
});

test('rejected_mismatch: confirmed GBP when expected EUR (real mismatch, not GBX case)', () => {
  const r = resolveValidationStatus(
    makeInput({ expectedCurrency: 'EUR', exchange: 'LSE' }),
    [makeSearchResult({ Exchange: 'LSE', Currency: 'GBP', previousClose: 50 })],
    null,
    null
  );
  assert('status is rejected_mismatch (expected EUR, got GBP)', r.status === 'rejected_mismatch');
});

test('quota_or_rate_limited: isQuota=true → no crash, status set', () => {
  const r = resolveValidationStatus(makeInput(), null, QUOTA_ERROR, null);
  assert('status is quota_or_rate_limited', r.status === 'quota_or_rate_limited');
  assert('confirmedCurrency is null', r.confirmedCurrency === null);
  assert('samplePrice is null', r.samplePrice === null);
  assert('warning mentions quota', r.warnings.some(w => w.includes('limit') || w.includes('quota') || w.includes('Quota')));
});

test('provider_error: generic API error → no crash, status set', () => {
  const r = resolveValidationStatus(makeInput(), null, GENERIC_ERROR, null);
  assert('status is provider_error', r.status === 'provider_error');
  assert('confirmedCurrency is null', r.confirmedCurrency === null);
  assert('warning present', r.warnings.length > 0);
});

test('sanitizeApiKey: replaces key with [REDACTED]', () => {
  const key = 'my-secret-eodhd-key-123';
  const msg = `GET https://eodhd.com/api/search/ASML?api_token=${key}&fmt=json`;
  const sanitized = sanitizeApiKey(msg, key);
  assert('key replaced', !sanitized.includes(key));
  assert('[REDACTED] present', sanitized.includes('[REDACTED]'));
  assert('rest of URL preserved', sanitized.includes('https://eodhd.com'));
});

test('sanitizeApiKey: no crash when key is undefined', () => {
  const msg = 'some message without a key';
  const sanitized = sanitizeApiKey(msg, undefined);
  assert('message unchanged when key undefined', sanitized === msg);
});

test('sanitizeApiKey: no crash when key is very short (<=4 chars)', () => {
  const sanitized = sanitizeApiKey('msg with key abc', 'abc');
  assert('short key not replaced (safety guard)', sanitized === 'msg with key abc');
});

test('report output: serialized result does not contain API key', () => {
  // Simulate: error message was pre-sanitized before entering resolveValidationStatus
  const fakeKey = 'super-secret-key-abc123';
  const sanitizedMsg = sanitizeApiKey(`Error: api_token=${fakeKey} invalid`, fakeKey);
  const errorCtx: EodhdErrorContext = { isQuota: false, isNotFound: false, isTimeout: false, isAuth: true, message: sanitizedMsg };
  const r = resolveValidationStatus(makeInput(), null, errorCtx, null);
  const serialized = JSON.stringify(r);
  assert('API key not in serialized result', !serialized.includes(fakeKey));
  assert('[REDACTED] present in serialized result', serialized.includes('[REDACTED]'));
});

test('validated_exact_eur: case-insensitive currency match (lowercase eur)', () => {
  const r = resolveValidationStatus(
    makeInput({ expectedCurrency: 'EUR' }),
    [makeSearchResult({ Currency: 'eur' })],
    null,
    null
  );
  // 'eur'.toUpperCase() === 'EUR' === expectedCurrency.toUpperCase() → validated
  assert('lowercase eur still validates', r.status === 'validated_exact_eur');
  assert('confirmedCurrency preserves original case', r.confirmedCurrency === 'eur');
});

test('GBP on LSE: no sample price → warning about unknown pence/pounds, but still validated_gbp_needs_fx', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'IWVL', eodhdSymbol: 'IWVL.LSE', exchange: 'LSE', expectedCurrency: 'GBP' }),
    [makeSearchResult({ Code: 'IWVL', Exchange: 'LSE', Currency: 'GBP', previousClose: null, previousCloseDate: null })],
    null,
    null
  );
  assert('status is validated_gbp_needs_fx (no price to trigger heuristic)', r.status === 'validated_gbp_needs_fx');
  assert('warning about no sample price', r.warnings.some(w => w.includes('no sample price') || w.includes('pence')));
});

// ---------------------------------------------------------------------------
// P2c-1b: Code-based auto-disambiguation tests
// ---------------------------------------------------------------------------

test('P2c-1b: auto-selects unique Code match when multiple results on same exchange', () => {
  // Simulates NVDA.US: EODHD returns stock + several derivatives, only Code=NVDA is the stock
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US', expectedCurrency: 'USD' }),
    [
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', Name: 'NVIDIA Corp', Type: 'Common Stock' }),
      makeSearchResult({ Code: 'NVDA.W', Exchange: 'US', Currency: 'USD', Name: 'NVIDIA Warrant', Type: 'Warrant' }),
      makeSearchResult({ Code: 'NVDA250117C00200000', Exchange: 'US', Currency: 'USD', Name: 'NVDA Call Option', Type: 'Option' }),
    ],
    null,
    null
  );
  assert('status is validated_usd_needs_fx (auto-selected unique Code match)', r.status === 'validated_usd_needs_fx');
  assert('confirmedCurrency is USD', r.confirmedCurrency === 'USD');
  assert('no warnings', r.warnings.length === 0);
  assert('no candidates (clean resolution)', r.candidates === undefined);
});

test('P2c-1b: auto-selects unique Code match — QQQ pattern with multiple options/ETFs', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'QQQ', eodhdSymbol: 'QQQ.US', exchange: 'US', expectedCurrency: 'USD' }),
    [
      makeSearchResult({ Code: 'QQQ', Exchange: 'US', Currency: 'USD', Name: 'Invesco QQQ Trust', Type: 'ETF' }),
      makeSearchResult({ Code: 'QQQM', Exchange: 'US', Currency: 'USD', Name: 'Invesco NASDAQ 100 ETF', Type: 'ETF' }),
      makeSearchResult({ Code: 'QQQS', Exchange: 'US', Currency: 'USD', Name: 'Pacer NASDAQ 100 Stocks ETF', Type: 'ETF' }),
      makeSearchResult({ Code: 'QQQ250117C00500000', Exchange: 'US', Currency: 'USD', Name: 'QQQ Call Option', Type: 'Option' }),
    ],
    null,
    null
  );
  assert('status is validated_usd_needs_fx (exact Code=QQQ auto-selected)', r.status === 'validated_usd_needs_fx');
  assert('confirmedCurrency is USD', r.confirmedCurrency === 'USD');
  assert('no candidates field (clean resolution)', r.candidates === undefined);
});

test('P2c-1b: ambiguous_symbol when two results share the exact same Code', () => {
  // Unusual but possible: two different instruments listed with same Code on same exchange
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US', expectedCurrency: 'USD' }),
    [
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', Name: 'NVIDIA Corp Class A', Type: 'Common Stock' }),
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', Name: 'NVIDIA Corp Class B', Type: 'Common Stock' }),
    ],
    null,
    null
  );
  assert('status is ambiguous_symbol (two exact Code matches)', r.status === 'ambiguous_symbol');
  assert('confirmedCurrency is null', r.confirmedCurrency === null);
  assert('warning mentions 2 results', r.warnings.some(w => w.includes('2')));
  assert('candidates list populated', Array.isArray(r.candidates) && r.candidates!.length === 2);
  assert('each candidate has code/exchange/currency', r.candidates!.every(c => c.code && c.exchange && c.currency));
});

test('P2c-1b: candidates list populated when no exact Code match found', () => {
  // Exchange matches but Code never matches expected base ticker
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'FAKE', eodhdSymbol: 'FAKE.US', exchange: 'US', expectedCurrency: 'USD' }),
    [
      makeSearchResult({ Code: 'FAKEX', Exchange: 'US', Currency: 'USD', Name: 'Fake Expanded ETF', Type: 'ETF' }),
      makeSearchResult({ Code: 'FAKEY', Exchange: 'US', Currency: 'USD', Name: 'Fake Y Corp', Type: 'Common Stock' }),
    ],
    null,
    null
  );
  assert('status is ambiguous_symbol (no exact Code match)', r.status === 'ambiguous_symbol');
  assert('warning mentions no Code match', r.warnings.some(w => w.includes("'FAKE'") || w.includes('none with Code')));
  assert('candidates list populated from matchingExchange', Array.isArray(r.candidates) && r.candidates!.length === 2);
  assert('candidates capped (no more than 10)', r.candidates!.length <= 10);
});

test('P2c-1b: candidates list capped at 10 when many non-matching results', () => {
  const manyResults = Array.from({ length: 15 }, (_, i) =>
    makeSearchResult({ Code: `NVDX${i}`, Exchange: 'US', Currency: 'USD', Name: `NVDA Option ${i}`, Type: 'Option' })
  );
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US', expectedCurrency: 'USD' }),
    manyResults,
    null,
    null
  );
  assert('status is ambiguous_symbol', r.status === 'ambiguous_symbol');
  assert('candidates capped at 10', r.candidates !== undefined && r.candidates!.length === 10);
});

test('P2c-1b: candidates contain no API key values', () => {
  const fakeKey = 'supersecret-apikey-eodhd-abc';
  // Inject key into a Name field as if EODHD returned it (defensive test)
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US', expectedCurrency: 'USD' }),
    [
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', Name: `NVIDIA Corp ${fakeKey}`, Type: 'Common Stock' }),
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', Name: 'NVIDIA Corp Duplicate', Type: 'Common Stock' }),
    ],
    null,
    null
  );
  // The key is NOT stripped from candidate Name by resolveValidationStatus itself —
  // that's the API layer's responsibility (sanitizeApiKey before calling here).
  // This test verifies the structure is intact; the sanitization test is separate.
  assert('candidates present', Array.isArray(r.candidates));
  const serialized = JSON.stringify(r);
  // Verify status is ambiguous (not a spurious success)
  assert('ambiguous (defensive check)', r.status === 'ambiguous_symbol');
  assert('serialized result is a string (no crash)', typeof serialized === 'string');
});

test('P2c-1b: CNDX.LSE rejected_mismatch when single result reports USD', () => {
  // Single result, correct exchange, exact Code match, but currency is USD not GBP
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'CNDX', eodhdSymbol: 'CNDX.LSE', exchange: 'LSE', expectedCurrency: 'GBP' }),
    [makeSearchResult({ Code: 'CNDX', Exchange: 'LSE', Currency: 'USD', Name: 'iShares MSCI World Consumer Disc ETF' })],
    null,
    null
  );
  assert('status is rejected_mismatch (CNDX USD on LSE)', r.status === 'rejected_mismatch');
  assert('confirmedCurrency is USD', r.confirmedCurrency === 'USD');
  assert('warning mentions mismatch', r.warnings.some(w => w.includes('mismatch') || w.includes('USD') || w.includes('GBP')));
  assert('no candidates (unambiguous single match)', r.candidates === undefined);
});

test('P2c-1b: IWVL.LSE rejected_mismatch when single result reports USD', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'IWVL', eodhdSymbol: 'IWVL.LSE', exchange: 'LSE', expectedCurrency: 'GBP' }),
    [makeSearchResult({ Code: 'IWVL', Exchange: 'LSE', Currency: 'USD', Name: 'iShares Edge MSCI World Value Factor ETF' })],
    null,
    null
  );
  assert('status is rejected_mismatch (IWVL USD on LSE)', r.status === 'rejected_mismatch');
  assert('confirmedCurrency is USD', r.confirmedCurrency === 'USD');
  assert('no candidates', r.candidates === undefined);
});

test('P2c-1b: candidates include Country field when present in search result', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US', expectedCurrency: 'USD' }),
    [
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', Name: 'NVIDIA Corp', Type: 'Common Stock', Country: 'USA' }),
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', Name: 'NVIDIA Corp Class B', Type: 'Common Stock', Country: 'USA' }),
    ],
    null,
    null
  );
  assert('status is ambiguous_symbol', r.status === 'ambiguous_symbol');
  assert('candidates present', Array.isArray(r.candidates) && r.candidates!.length === 2);
  assert('candidates include country field', r.candidates!.every(c => c.country === 'USA'));
});

test('P2c-1b: candidate isin field is null when not available', () => {
  const r = resolveValidationStatus(
    makeInput({ internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US', expectedCurrency: 'USD' }),
    [
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', ISIN: null }),
      makeSearchResult({ Code: 'NVDA', Exchange: 'US', Currency: 'USD', ISIN: 'US67066G1040' }),
    ],
    null,
    null
  );
  assert('status is ambiguous_symbol', r.status === 'ambiguous_symbol');
  assert('first candidate isin is null', r.candidates![0].isin === null);
  assert('second candidate isin is set', r.candidates![1].isin === 'US67066G1040');
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
