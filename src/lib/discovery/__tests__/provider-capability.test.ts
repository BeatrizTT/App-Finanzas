// P3-3f-0: Multi-source discovery provider capability tests
// Pure module — no HTTP, no file I/O. Static imports work directly.

import {
  sanitizeString,
  validateReportSecurity,
  buildMissingKeyResult,
  buildNetworkErrorResult,
  parseEodhdScreenerResponse,
  parseFmpScreenerResponse,
  parseFinnhubResponse,
  parseAlphaVantageResponse,
  parseTwelveDataResponse,
  yahooFallbackResult,
  buildSummary,
} from '../provider-capability';
import type { ProviderCapabilityResult, SmokeSummary } from '../provider-capability';

// ── Infrastructure ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ── Mock responses ────────────────────────────────────────────────────────

const EODHD_OK = {
  total: 100,
  data: [
    { code: 'AAPL', name: 'Apple Inc', Exchange: 'NASDAQ', Currency: 'USD', Sector: 'Technology', market_capitalization: '3000000000000', last_price: '180' },
    { code: 'MSFT', name: 'Microsoft', Exchange: 'NASDAQ', Currency: 'USD', Sector: 'Technology', market_capitalization: '2800000000000', last_price: '390' },
    { code: 'NVDA', name: 'NVIDIA',    Exchange: 'NASDAQ', Currency: 'USD', Sector: 'Technology', market_capitalization: '2600000000000', last_price: '108' },
  ],
};

const FMP_OK = [
  { symbol: 'AAPL', companyName: 'Apple Inc.', marketCap: 3000000000000, sector: 'Technology', industry: 'Consumer Electronics', beta: 1.2, price: 180, volume: 50000000, exchange: 'NASDAQ', exchangeShortName: 'NASDAQ', country: 'US', isEtf: false, isActivelyTrading: true },
  { symbol: 'MSFT', companyName: 'Microsoft Corp', marketCap: 2800000000000, sector: 'Technology', industry: 'Software', beta: 0.9, price: 390, volume: 20000000, exchange: 'NASDAQ', exchangeShortName: 'NASDAQ', country: 'US', isEtf: false, isActivelyTrading: true },
];

const FINNHUB_QUOTE_OK = { c: 108.5, h: 110.2, l: 107.8, o: 109.0, pc: 109.5, t: 1712000000 };

const ALPHA_VANTAGE_OK = {
  'Meta Data': { '1. Information': 'Daily Adjusted', '2. Symbol': 'IBM' },
  'Time Series (Daily)': { '2026-06-03': { '1. open': '150.00', '4. close': '152.00' } },
};

const ALPHA_VANTAGE_QUOTA = { Note: 'Thank you for using Alpha Vantage! Our standard API call frequency is 25 requests per day.' };

const TWELVE_DATA_OK = { price: '108.5' };
const TWELVE_DATA_ERROR = { code: 429, message: 'Daily API limit exceeded.' };

console.log('\n▶ src/lib/discovery/__tests__/provider-capability.test.ts\n');

// ── Group 1: sanitizeString ───────────────────────────────────────────────

test('sanitizer removes api_token param value', () => {
  const url = 'https://eodhd.com/api/screener?api_token=SECRET123&limit=3';
  const result = sanitizeString(url);
  assert(!result.includes('SECRET123'), 'key value must be removed');
  assert(result.includes('api_token=[REDACTED]'), 'param name must remain');
});

test('sanitizer removes apikey param value', () => {
  const url = 'https://fmp.com/v3/screener?apikey=MYFMPKEY&limit=3';
  const result = sanitizeString(url);
  assert(!result.includes('MYFMPKEY'), 'key must be removed');
});

test('sanitizer redacts known secret passed in keysToRedact', () => {
  const result = sanitizeString('error: auth failed for token MYSECRETKEY', ['MYSECRETKEY']);
  assert(!result.includes('MYSECRETKEY'), 'known secret must be removed');
  assert(result.includes('[REDACTED]'), 'placeholder must be present');
});

test('sanitizer leaves normal strings unchanged', () => {
  const s = 'status=200, no keys here';
  assert(sanitizeString(s) === s, 'safe string should not be altered');
});

test('sanitizer handles token= param pattern', () => {
  const url = 'https://finnhub.io/v1/quote?symbol=NVDA&token=mytoken123';
  const result = sanitizeString(url);
  assert(!result.includes('mytoken123'), 'token value must be removed');
});

// ── Group 2: validateReportSecurity ──────────────────────────────────────

test('clean report JSON is considered safe', () => {
  const json = JSON.stringify({ provider: 'eodhd_screener', supported: true, warnings: [] });
  assert(validateReportSecurity(json), 'clean report should be safe');
});

test('report with api_token=... is flagged as unsafe', () => {
  const json = '{"url":"https://api.com?api_token=SECRETVAL123&limit=3"}';
  assert(!validateReportSecurity(json), 'report with leaked key param should fail');
});

test('report containing known key value is flagged', () => {
  const json = JSON.stringify({ warnings: ['ACTUALSECRET in error'] });
  assert(!validateReportSecurity(json, ['ACTUALSECRET']), 'known secret in report must fail');
});

test('report without known keys is safe even with generic words', () => {
  const json = JSON.stringify({ warnings: ['auth_failed', 'missing_key'] });
  assert(validateReportSecurity(json, ['SUPERSECRETKEY']), 'should pass when key not present');
});

// ── Group 3: buildMissingKeyResult ────────────────────────────────────────

test('missing key result for EODHD has supported=false', () => {
  const r = buildMissingKeyResult('eodhd_screener');
  assert(r.supported === false, 'should be unsupported');
});

test('missing key result includes missing_key warning', () => {
  const r = buildMissingKeyResult('fmp_screener');
  assert(r.warnings.includes('missing_key'), 'must have missing_key warning');
});

test('missing key result has usableFor=not_usable', () => {
  const r = buildMissingKeyResult('finnhub');
  assert(r.usableFor === 'not_usable', 'expected not_usable');
});

test('EODHD missing key still sets callUnitsEstimated=5', () => {
  const r = buildMissingKeyResult('eodhd_screener');
  assert(r.callUnitsEstimated === 5, 'EODHD always costs 5 units even when key missing');
});

// ── Group 4: buildNetworkErrorResult ─────────────────────────────────────

test('network error produces a result row, no throw', () => {
  let threw = false;
  let r: ProviderCapabilityResult | null = null;
  try {
    r = buildNetworkErrorResult('eodhd_screener', 'Connection refused');
  } catch { threw = true; }
  assert(!threw, 'must not throw');
  assert(r !== null, 'must return a result');
});

test('network error result has supported=false', () => {
  const r = buildNetworkErrorResult('fmp_screener', 'timeout');
  assert(r.supported === false, 'expected false');
});

test('network error result warning contains sanitised error message', () => {
  const r = buildNetworkErrorResult('finnhub', 'Connection refused');
  assert(r.warnings.some(w => w.includes('Connection refused')), 'error message in warning');
});

// ── Group 5: parseEodhdScreenerResponse ──────────────────────────────────

test('EODHD 200 OK with data → supported=true', () => {
  const r = parseEodhdScreenerResponse(EODHD_OK, 200);
  assert(r.supported === true, 'should be supported');
});

test('EODHD 200 OK → resultCount=3', () => {
  const r = parseEodhdScreenerResponse(EODHD_OK, 200);
  assert(r.resultCount === 3, `expected 3, got ${r.resultCount}`);
});

test('EODHD 200 OK → fieldsAvailable from first hit', () => {
  const r = parseEodhdScreenerResponse(EODHD_OK, 200);
  assert(r.fieldsAvailable.includes('code'), 'expected code field');
  assert(r.fieldsAvailable.includes('Sector'), 'expected Sector field');
});

test('EODHD 200 OK → sampleTickers extracted', () => {
  const r = parseEodhdScreenerResponse(EODHD_OK, 200);
  assert(r.sampleTickers.length > 0, 'expected sample tickers');
  assert(r.sampleTickers.includes('AAPL'), 'expected AAPL');
});

test('EODHD 200 OK → usableFor=candidate_discovery', () => {
  const r = parseEodhdScreenerResponse(EODHD_OK, 200);
  assert(r.usableFor === 'candidate_discovery', `got ${r.usableFor}`);
});

test('EODHD 200 OK → callUnitsEstimated=5', () => {
  const r = parseEodhdScreenerResponse(EODHD_OK, 200);
  assert(r.callUnitsEstimated === 5, 'always 5 units');
});

test('EODHD 401 → supported=false, no crash', () => {
  let threw = false;
  let r: ProviderCapabilityResult | null = null;
  try { r = parseEodhdScreenerResponse({}, 401); } catch { threw = true; }
  assert(!threw, 'must not throw');
  assert(r !== null && r.supported === false, 'should be unsupported');
});

test('EODHD 401 → callUnitsEstimated=5 (plan check failed, still costs units)', () => {
  const r = parseEodhdScreenerResponse({}, 401);
  assert(r.callUnitsEstimated === 5, 'always 5');
});

test('EODHD 402 → plan_upgrade_required warning', () => {
  const r = parseEodhdScreenerResponse({}, 402);
  assert(r.warnings.includes('plan_upgrade_required'), 'expected upgrade warning');
});

// ── Group 6: parseFmpScreenerResponse ────────────────────────────────────

test('FMP 200 OK → supported=true', () => {
  const r = parseFmpScreenerResponse(FMP_OK, 200);
  assert(r.supported === true, 'expected supported');
});

test('FMP 200 OK → fieldsAvailable includes sector', () => {
  const r = parseFmpScreenerResponse(FMP_OK, 200);
  assert(r.fieldsAvailable.includes('sector'), 'expected sector field');
});

test('FMP 200 OK → fieldsAvailable includes marketCap', () => {
  const r = parseFmpScreenerResponse(FMP_OK, 200);
  assert(r.fieldsAvailable.includes('marketCap'), 'expected marketCap field');
});

test('FMP 200 OK → sampleTickers contains AAPL', () => {
  const r = parseFmpScreenerResponse(FMP_OK, 200);
  assert(r.sampleTickers.includes('AAPL'), 'expected AAPL');
});

test('FMP missing key (missing_key result) has supported=false + missing_key warning', () => {
  const r = buildMissingKeyResult('fmp_screener');
  assert(r.supported === false, 'unsupported');
  assert(r.warnings.includes('missing_key'), 'has missing_key warning');
});

// ── Group 7: parseFinnhubResponse ────────────────────────────────────────

test('Finnhub 200 quote response → supported=true', () => {
  const r = parseFinnhubResponse(FINNHUB_QUOTE_OK, 200);
  assert(r.supported === true, 'expected supported');
});

test('Finnhub quote fields available', () => {
  const r = parseFinnhubResponse(FINNHUB_QUOTE_OK, 200);
  assert(r.fieldsAvailable.includes('c'), 'current price field c expected');
});

test('Finnhub missing key → supported=false, missing_key warning', () => {
  const r = buildMissingKeyResult('finnhub');
  assert(!r.supported && r.warnings.includes('missing_key'), 'missing key handling');
});

// ── Group 8: parseAlphaVantageResponse ───────────────────────────────────

test('Alpha Vantage time-series response → historical_drawdown', () => {
  const r = parseAlphaVantageResponse(ALPHA_VANTAGE_OK, 200);
  assert(r.usableFor === 'historical_drawdown', `got ${r.usableFor}`);
});

test('Alpha Vantage quota exceeded → supported=false, no crash', () => {
  let threw = false;
  let r: ProviderCapabilityResult | null = null;
  try { r = parseAlphaVantageResponse(ALPHA_VANTAGE_QUOTA, 200); } catch { threw = true; }
  assert(!threw, 'must not throw');
  assert(r !== null && r.supported === false, 'should be unsupported on quota hit');
});

test('Alpha Vantage missing key → missing_key warning', () => {
  const r = buildMissingKeyResult('alpha_vantage');
  assert(r.warnings.includes('missing_key'), 'must have missing_key');
});

// ── Group 9: parseTwelveDataResponse ─────────────────────────────────────

test('Twelve Data price response → pricing_validation', () => {
  const r = parseTwelveDataResponse(TWELVE_DATA_OK, 200);
  assert(r.usableFor === 'pricing_validation', `got ${r.usableFor}`);
  assert(r.supported === true, 'should be supported');
});

test('Twelve Data error response → no crash', () => {
  let threw = false;
  let r: ProviderCapabilityResult | null = null;
  try { r = parseTwelveDataResponse(TWELVE_DATA_ERROR, 200); } catch { threw = true; }
  assert(!threw, 'must not throw on quota error body');
  assert(r !== null && r.supported === false, 'should be unsupported');
});

test('Twelve Data missing key → no crash, result row', () => {
  const r = buildMissingKeyResult('twelve_data');
  assert(r.supported === false, 'unsupported');
  assert(r.resultCount === 0, 'no results');
});

// ── Group 10: yahooFallbackResult ────────────────────────────────────────

test('Yahoo fallback is research_only', () => {
  const r = yahooFallbackResult();
  assert(r.usableFor === 'research_only', `got ${r.usableFor}`);
});

test('Yahoo fallback is never candidate_discovery', () => {
  const r = yahooFallbackResult();
  assert(r.usableFor !== 'candidate_discovery', 'must never be candidate_discovery');
});

test('Yahoo fallback includes unofficial_source warning', () => {
  const r = yahooFallbackResult();
  assert(r.warnings.some(w => w.includes('unofficial')), 'expected unofficial warning');
});

// ── Group 11: buildSummary ────────────────────────────────────────────────

const makeResult = (
  provider: ProviderCapabilityResult['provider'],
  usableFor: ProviderCapabilityResult['usableFor']
): ProviderCapabilityResult => ({
  provider, usableFor, supported: usableFor !== 'not_usable',
  resultCount: 0, fieldsAvailable: [], limitsKnown: [], warnings: [], sampleTickers: [],
});

test('summary recommends EODHD when it is candidate_discovery', () => {
  const results = [
    makeResult('eodhd_screener', 'candidate_discovery'),
    makeResult('fmp_screener', 'not_usable'),
  ];
  const s = buildSummary(results);
  assert(s.recommendedNextProvider === 'eodhd_screener', `expected eodhd, got ${s.recommendedNextProvider}`);
});

test('summary recommends FMP when EODHD is unavailable', () => {
  const results = [
    makeResult('eodhd_screener', 'not_usable'),
    makeResult('fmp_screener', 'candidate_discovery'),
  ];
  const s = buildSummary(results);
  assert(s.recommendedNextProvider === 'fmp_screener', `expected fmp, got ${s.recommendedNextProvider}`);
});

test('EODHD is preferred over FMP even if FMP listed first', () => {
  const results = [
    makeResult('fmp_screener', 'candidate_discovery'),
    makeResult('eodhd_screener', 'candidate_discovery'),
  ];
  const s = buildSummary(results);
  assert(s.recommendedNextProvider === 'eodhd_screener', 'EODHD should take priority');
});

test('no candidate_discovery provider → recommendedNextProvider=null', () => {
  const results = [
    makeResult('eodhd_screener', 'not_usable'),
    makeResult('fmp_screener', 'not_usable'),
    makeResult('yahoo_fallback', 'research_only'),
  ];
  const s = buildSummary(results);
  assert(s.recommendedNextProvider === null, `expected null, got ${s.recommendedNextProvider}`);
});

test('no candidate provider → warning included', () => {
  const results = [makeResult('eodhd_screener', 'not_usable')];
  const s = buildSummary(results);
  assert(s.warnings.some(w => w.includes('no_candidate_discovery_provider')), 'expected no-provider warning');
});

test('candidateDiscoveryProviders list is populated correctly', () => {
  const results = [
    makeResult('eodhd_screener', 'candidate_discovery'),
    makeResult('fmp_screener', 'candidate_discovery'),
    makeResult('finnhub', 'pricing_validation'),
  ];
  const s = buildSummary(results);
  assert(s.candidateDiscoveryProviders.length === 2, `expected 2, got ${s.candidateDiscoveryProviders.length}`);
  assert(s.pricingValidationProviders.includes('finnhub'), 'finnhub should be in pricing');
});

test('researchOnlyProviders contains yahoo_fallback', () => {
  const results = [makeResult('yahoo_fallback', 'research_only')];
  const s = buildSummary(results);
  assert(s.researchOnlyProviders.includes('yahoo_fallback'), 'yahoo must be in research-only');
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
