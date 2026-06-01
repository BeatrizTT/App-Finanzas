// Tests for eodhd-symbol-config.ts — curated validation loader and suitability resolver.
// Run with: npx tsx src/lib/pricing/__tests__/eodhd-symbol-config.test.ts
//
// All pure-logic tests use manually constructed EodhdCuratedEntry objects — no file I/O.
// Integration tests use getEodhdCuratedEntry() which reads config/eodhd-symbol-validation.json.
//
// Covers:
//  - validated_exact_eur → suitableForExactPnl=true, suitableForBuyRecommendation=true
//  - validated_usd_needs_fx without FX → suitableForExactPnl=false, note mentions "FX missing"
//  - validated_usd_needs_fx with FX → suitableForExactPnl=true (usdConvertedValidation)
//  - rejected_mismatch → suitableForExactPnl=false, fetchedCurrency matches confirmed
//  - rejected_mismatch → currentPrice semantically blocked (status drives currentPriceUsable=false)
//  - config JSON clean of secrets/API key patterns
//  - default production unchanged (PRICE_PROVIDER not in curated data)
//  - getEodhdCuratedEntry: all 5 curated symbols found, unknown returns null

import fs from 'fs';
import path from 'path';
import {
  buildValidationFromCurated,
  getEodhdCuratedEntry,
  isCuratedCurrentPriceUsable,
  resetCuratedConfigCache,
  type EodhdCuratedEntry,
} from '../eodhd-symbol-config';

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

function makeEntry(overrides: Partial<EodhdCuratedEntry> = {}): EodhdCuratedEntry {
  return {
    internalTicker: 'ASML',
    eodhdSymbol: 'ASML.AS',
    exchange: 'AS',
    status: 'validated_exact_eur',
    confirmedCurrency: 'EUR',
    expectedCurrency: 'EUR',
    samplePrice: 1300,
    samplePriceDate: '2026-05-07',
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure-logic tests (no file I/O — constructed entries)
// ---------------------------------------------------------------------------

test('validated_exact_eur: ASML → suitableForExactPnl=true, suitableForBuyRecommendation=true', () => {
  const v = buildValidationFromCurated('ASML', makeEntry(), false);
  assert('method is direct_eur_quote', v.method === 'direct_eur_quote');
  assert('fetchedCurrency is EUR', v.fetchedCurrency === 'EUR');
  assert('expectedCurrency is EUR', v.expectedCurrency === 'EUR');
  assert('currencyConfirmed=true', v.currencyConfirmed === true);
  assert('suitableForExactPnl=true', v.suitableForExactPnl === true);
  assert('suitableForBuyRecommendation=true', v.suitableForBuyRecommendation === true);
  assert('suitableForDrawdown=true', v.suitableForDrawdown === true);
  assert('isProxy=false', v.isProxy === false);
});

test('validated_usd_needs_fx without FX: NVDA → suitableForExactPnl=false, note mentions FX missing', () => {
  const entry = makeEntry({
    internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US',
    status: 'validated_usd_needs_fx', confirmedCurrency: 'USD', expectedCurrency: 'USD',
    samplePrice: 207.83, samplePriceDate: '2026-05-06',
  });
  const v = buildValidationFromCurated('NVDA', entry, false);
  assert('method is usd_no_fx', v.method === 'usd_no_fx');
  assert('fetchedCurrency is USD', v.fetchedCurrency === 'USD');
  assert('suitableForExactPnl=false (no FX)', v.suitableForExactPnl === false);
  assert('suitableForBuyRecommendation=false (no FX)', v.suitableForBuyRecommendation === false);
  assert('suitableForDrawdown=true', v.suitableForDrawdown === true);
  assert('note mentions FX missing', typeof v.note === 'string' && v.note.includes('FX missing'));
  assert('note mentions USD quote validated', v.note!.includes('USD quote validated'));
  assert('isProxy=false', v.isProxy === false);
});

test('validated_usd_needs_fx without FX: QQQ → same semantics as NVDA', () => {
  const entry = makeEntry({
    internalTicker: 'QQQ', eodhdSymbol: 'QQQ.US', exchange: 'US',
    status: 'validated_usd_needs_fx', confirmedCurrency: 'USD', expectedCurrency: 'USD',
    samplePrice: 695.77, samplePriceDate: '2026-05-06',
  });
  const v = buildValidationFromCurated('QQQ', entry, false);
  assert('method is usd_no_fx', v.method === 'usd_no_fx');
  assert('suitableForExactPnl=false', v.suitableForExactPnl === false);
  assert('suitableForBuyRecommendation=false', v.suitableForBuyRecommendation === false);
  assert('suitableForDrawdown=true', v.suitableForDrawdown === true);
  assert('note mentions FX missing', typeof v.note === 'string' && v.note.includes('FX missing'));
});

test('validated_usd_needs_fx WITH FX: → usdConvertedValidation, suitableForExactPnl=true', () => {
  const entry = makeEntry({
    internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US',
    status: 'validated_usd_needs_fx', confirmedCurrency: 'USD', expectedCurrency: 'USD',
    samplePrice: 207.83, samplePriceDate: '2026-05-06',
  });
  const v = buildValidationFromCurated('NVDA', entry, true);
  assert('method is usd_converted', v.method === 'usd_converted');
  assert('suitableForExactPnl=true (FX available)', v.suitableForExactPnl === true);
  assert('suitableForBuyRecommendation=true (FX available)', v.suitableForBuyRecommendation === true);
  assert('suitableForDrawdown=true', v.suitableForDrawdown === true);
  assert('currencyConfirmed=true', v.currencyConfirmed === true);
});

test('rejected_mismatch: CNDX → suitableForExactPnl=false, fetchedCurrency=USD, expectedCurrency=GBP', () => {
  const entry = makeEntry({
    internalTicker: 'CNDX', eodhdSymbol: 'CNDX.LSE', exchange: 'LSE',
    status: 'rejected_mismatch', confirmedCurrency: 'USD', expectedCurrency: 'GBP',
    samplePrice: null, samplePriceDate: null,
    warnings: ['Currency mismatch: expected GBP, EODHD reports USD'],
  });
  const v = buildValidationFromCurated('CNDX', entry, false);
  assert('method is unavailable', v.method === 'unavailable');
  assert('fetchedCurrency is USD (wrong currency confirmed by EODHD)', v.fetchedCurrency === 'USD');
  assert('expectedCurrency is GBP', v.expectedCurrency === 'GBP');
  assert('currencyConfirmed=false', v.currencyConfirmed === false);
  assert('suitableForExactPnl=false', v.suitableForExactPnl === false);
  assert('suitableForBuyRecommendation=false', v.suitableForBuyRecommendation === false);
  assert('suitableForDrawdown=true (ratio is currency-independent)', v.suitableForDrawdown === true);
  assert('note mentions mismatch', typeof v.note === 'string' && v.note.toLowerCase().includes('mismatch'));
});

test('rejected_mismatch: IWVL → same semantics as CNDX', () => {
  const entry = makeEntry({
    internalTicker: 'IWVL', eodhdSymbol: 'IWVL.LSE', exchange: 'LSE',
    status: 'rejected_mismatch', confirmedCurrency: 'USD', expectedCurrency: 'GBP',
    samplePrice: null, samplePriceDate: null,
    warnings: ['Currency mismatch: expected GBP, EODHD reports USD'],
  });
  const v = buildValidationFromCurated('IWVL', entry, false);
  assert('method is unavailable', v.method === 'unavailable');
  assert('suitableForExactPnl=false', v.suitableForExactPnl === false);
  assert('suitableForBuyRecommendation=false', v.suitableForBuyRecommendation === false);
  assert('fetchedCurrency=USD', v.fetchedCurrency === 'USD');
  assert('expectedCurrency=GBP', v.expectedCurrency === 'GBP');
});

test('rejected_mismatch: status drives currentPriceUsable=false (raw price must not be used)', () => {
  // The provider checks curated.status === 'rejected_mismatch' to set currentPriceUsable=false.
  // Verify the validation object itself confirms the price is unsuitable.
  const entry = makeEntry({
    status: 'rejected_mismatch', confirmedCurrency: 'USD', expectedCurrency: 'GBP',
  });
  const v = buildValidationFromCurated('CNDX', entry, false);
  // A price built from this validation must not feed currentPriceEur
  assert('not suitable for exact P&L', !v.suitableForExactPnl);
  assert('not suitable for buy recommendation', !v.suitableForBuyRecommendation);
  assert('display method is unavailable (not a meaningful price)', v.method === 'unavailable');
});

test('unknown status falls back to unavailableValidation', () => {
  const entry = makeEntry({ status: 'symbol_not_found' as never });
  const v = buildValidationFromCurated('UNKNOWN', entry, false);
  assert('method is unavailable', v.method === 'unavailable');
  assert('suitableForExactPnl=false', v.suitableForExactPnl === false);
  assert('suitableForBuyRecommendation=false', v.suitableForBuyRecommendation === false);
});

test('provider override is respected', () => {
  const v = buildValidationFromCurated('ASML', makeEntry(), false, 'mock');
  assert('provider is mock when overridden', v.provider === 'mock');
});

// ---------------------------------------------------------------------------
// Config JSON content tests (reads actual file)
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.resolve(process.cwd(), 'config', 'eodhd-symbol-validation.json');

test('config JSON file exists', () => {
  assert('config/eodhd-symbol-validation.json exists', fs.existsSync(CONFIG_PATH));
});

test('config JSON: no forbidden secret-related strings', () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    assert('skipped (file absent)', true);
    return;
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const forbidden = ['api_token', 'EODHD_API_KEY', 'api_key'];
  for (const pattern of forbidden) {
    assert(`config does not contain '${pattern}'`, !raw.toLowerCase().includes(pattern.toLowerCase()));
  }
});

test('config JSON: does not contain PRICE_PROVIDER (production default untouched)', () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    assert('skipped (file absent)', true);
    return;
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  assert('config does not reference PRICE_PROVIDER', !raw.includes('PRICE_PROVIDER'));
});

test('config JSON is valid JSON and has expected top-level keys', () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    assert('skipped (file absent)', true);
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    assert('config is valid JSON', true);
  } catch {
    assert('config is valid JSON', false);
    return;
  }
  assert('has generatedAt', typeof parsed.generatedAt === 'string');
  assert('has source', typeof parsed.source === 'string');
  assert('has note', typeof parsed.note === 'string');
  assert('has symbols array', Array.isArray(parsed.symbols));
  assert('has 5 symbols', (parsed.symbols as unknown[]).length === 5);
});

// ---------------------------------------------------------------------------
// Integration tests — getEodhdCuratedEntry with real JSON
// ---------------------------------------------------------------------------

test('getEodhdCuratedEntry: all 5 smoke symbols are present and correctly keyed', () => {
  resetCuratedConfigCache();
  if (!fs.existsSync(CONFIG_PATH)) {
    assert('skipped (file absent)', true);
    return;
  }

  const asml = getEodhdCuratedEntry('ASML');
  assert('ASML entry found', asml !== null);
  assert('ASML status is validated_exact_eur', asml?.status === 'validated_exact_eur');
  assert('ASML confirmedCurrency is EUR', asml?.confirmedCurrency === 'EUR');

  const nvda = getEodhdCuratedEntry('NVDA');
  assert('NVDA entry found', nvda !== null);
  assert('NVDA status is validated_usd_needs_fx', nvda?.status === 'validated_usd_needs_fx');
  assert('NVDA confirmedCurrency is USD', nvda?.confirmedCurrency === 'USD');

  const qqq = getEodhdCuratedEntry('QQQ');
  assert('QQQ entry found', qqq !== null);
  assert('QQQ status is validated_usd_needs_fx', qqq?.status === 'validated_usd_needs_fx');

  const cndx = getEodhdCuratedEntry('CNDX');
  assert('CNDX entry found', cndx !== null);
  assert('CNDX status is rejected_mismatch', cndx?.status === 'rejected_mismatch');
  assert('CNDX confirmedCurrency is USD (the wrong one)', cndx?.confirmedCurrency === 'USD');
  assert('CNDX expectedCurrency is GBP', cndx?.expectedCurrency === 'GBP');

  const iwvl = getEodhdCuratedEntry('IWVL');
  assert('IWVL entry found', iwvl !== null);
  assert('IWVL status is rejected_mismatch', iwvl?.status === 'rejected_mismatch');
});

test('getEodhdCuratedEntry: case-insensitive lookup', () => {
  resetCuratedConfigCache();
  if (!fs.existsSync(CONFIG_PATH)) {
    assert('skipped (file absent)', true);
    return;
  }
  const lower = getEodhdCuratedEntry('asml');
  assert('lowercase lookup works', lower?.status === 'validated_exact_eur');
});

test('getEodhdCuratedEntry: unknown symbol returns null', () => {
  resetCuratedConfigCache();
  const entry = getEodhdCuratedEntry('FAKEXYZ999');
  assert('unknown ticker returns null', entry === null);
});

test('no rejected/mismatch entry can produce suitableForExactPnl=true', () => {
  resetCuratedConfigCache();
  if (!fs.existsSync(CONFIG_PATH)) {
    assert('skipped (file absent)', true);
    return;
  }
  for (const ticker of ['CNDX', 'IWVL']) {
    const entry = getEodhdCuratedEntry(ticker);
    if (!entry) {
      assert(`${ticker} entry found for check`, false);
      continue;
    }
    const v = buildValidationFromCurated(ticker, entry, false);
    assert(`${ticker} rejected entry does not produce suitableForExactPnl=true`, !v.suitableForExactPnl);
    assert(`${ticker} rejected entry does not produce suitableForBuyRecommendation=true`, !v.suitableForBuyRecommendation);
  }
});

test('default production: loading curated config does not mutate PRICE_PROVIDER env', () => {
  const before = process.env.PRICE_PROVIDER;
  resetCuratedConfigCache();
  getEodhdCuratedEntry('ASML');
  const after = process.env.PRICE_PROVIDER;
  assert('PRICE_PROVIDER unchanged after loading curated config', before === after);
});

// ---------------------------------------------------------------------------
// P2c-2a: isCuratedCurrentPriceUsable — currentPrice null semantics
// ---------------------------------------------------------------------------

test('P2c-2a: validated_exact_eur → currentPrice usable (ASML EUR confirmed)', () => {
  assert('validated_exact_eur: currentPriceUsable=true', isCuratedCurrentPriceUsable('validated_exact_eur') === true);
});

test('P2c-2a: validated_usd_needs_fx → currentPrice NOT usable (NVDA raw USD must not appear as EUR)', () => {
  assert('validated_usd_needs_fx: currentPriceUsable=false', isCuratedCurrentPriceUsable('validated_usd_needs_fx') === false);
});

test('P2c-2a: rejected_mismatch → currentPrice NOT usable (wrong currency)', () => {
  assert('rejected_mismatch: currentPriceUsable=false', isCuratedCurrentPriceUsable('rejected_mismatch') === false);
});

test('P2c-2a: all non-exact-EUR statuses return false', () => {
  const nonEurStatuses = [
    'validated_usd_needs_fx',
    'validated_gbp_needs_fx',
    'suspected_gbx_pence',
    'currency_missing',
    'symbol_not_found',
    'ambiguous_symbol',
    'rejected_mismatch',
    'quota_or_rate_limited',
    'provider_error',
  ] as const;
  for (const status of nonEurStatuses) {
    assert(`${status}: currentPriceUsable=false`, isCuratedCurrentPriceUsable(status) === false);
  }
});

test('P2c-2a: NVDA with no FX — validation says suitableForExactPnl=false AND currentPriceUsable=false', () => {
  const entry = makeEntry({
    internalTicker: 'NVDA', eodhdSymbol: 'NVDA.US', exchange: 'US',
    status: 'validated_usd_needs_fx', confirmedCurrency: 'USD', expectedCurrency: 'USD',
    samplePrice: 207.83, samplePriceDate: '2026-05-06',
  });
  const v = buildValidationFromCurated('NVDA', entry, false);
  const usable = isCuratedCurrentPriceUsable(entry.status);
  assert('NVDA: suitableForExactPnl=false', v.suitableForExactPnl === false);
  assert('NVDA: suitableForBuyRecommendation=false', v.suitableForBuyRecommendation === false);
  assert('NVDA: currentPriceUsable=false (207.83 USD must not be exposed as EUR currentPrice)', usable === false);
  assert('NVDA: note says FX missing', typeof v.note === 'string' && v.note.includes('FX missing'));
});

test('P2c-2a: QQQ with no FX — same guarantees as NVDA', () => {
  const entry = makeEntry({
    internalTicker: 'QQQ', eodhdSymbol: 'QQQ.US', exchange: 'US',
    status: 'validated_usd_needs_fx', confirmedCurrency: 'USD', expectedCurrency: 'USD',
    samplePrice: 695.77, samplePriceDate: '2026-05-06',
  });
  const v = buildValidationFromCurated('QQQ', entry, false);
  const usable = isCuratedCurrentPriceUsable(entry.status);
  assert('QQQ: suitableForExactPnl=false', v.suitableForExactPnl === false);
  assert('QQQ: suitableForBuyRecommendation=false', v.suitableForBuyRecommendation === false);
  assert('QQQ: currentPriceUsable=false (695.77 USD must not be exposed as EUR currentPrice)', usable === false);
});

test('P2c-2a: CNDX rejected_mismatch → currentPrice null and no exact P&L', () => {
  const entry = makeEntry({
    internalTicker: 'CNDX', eodhdSymbol: 'CNDX.LSE', exchange: 'LSE',
    status: 'rejected_mismatch', confirmedCurrency: 'USD', expectedCurrency: 'GBP',
  });
  const v = buildValidationFromCurated('CNDX', entry, false);
  const usable = isCuratedCurrentPriceUsable(entry.status);
  assert('CNDX: currentPriceUsable=false', usable === false);
  assert('CNDX: suitableForExactPnl=false', v.suitableForExactPnl === false);
  assert('CNDX: suitableForBuyRecommendation=false', v.suitableForBuyRecommendation === false);
});

test('P2c-2a: IWVL rejected_mismatch → currentPrice null and no exact P&L', () => {
  const entry = makeEntry({
    internalTicker: 'IWVL', eodhdSymbol: 'IWVL.LSE', exchange: 'LSE',
    status: 'rejected_mismatch', confirmedCurrency: 'USD', expectedCurrency: 'GBP',
  });
  const usable = isCuratedCurrentPriceUsable(entry.status);
  assert('IWVL: currentPriceUsable=false', usable === false);
});

test('P2c-2a: ASML validated_exact_eur — currentPrice usable AND suitableForExactPnl=true', () => {
  const v = buildValidationFromCurated('ASML', makeEntry(), false);
  const usable = isCuratedCurrentPriceUsable('validated_exact_eur');
  assert('ASML: currentPriceUsable=true', usable === true);
  assert('ASML: suitableForExactPnl=true', v.suitableForExactPnl === true);
  assert('ASML: suitableForBuyRecommendation=true', v.suitableForBuyRecommendation === true);
  assert('ASML: method=direct_eur_quote', v.method === 'direct_eur_quote');
});

test('P2c-2a: portfolio-highs safety layer — suitableForExactPnl=false → currentPrice nulled by engine', () => {
  // buildPortfolioHighs nulls currentPrice for suitableForExactPnl=false.
  // Verify the validation objects we produce have the correct flag so that layer works.
  const cases: Array<{ label: string; status: EodhdCuratedEntry['status']; shouldBeNull: boolean }> = [
    { label: 'ASML validated_exact_eur', status: 'validated_exact_eur', shouldBeNull: false },
    { label: 'NVDA validated_usd_needs_fx', status: 'validated_usd_needs_fx', shouldBeNull: true },
    { label: 'QQQ validated_usd_needs_fx', status: 'validated_usd_needs_fx', shouldBeNull: true },
    { label: 'CNDX rejected_mismatch', status: 'rejected_mismatch', shouldBeNull: true },
    { label: 'IWVL rejected_mismatch', status: 'rejected_mismatch', shouldBeNull: true },
  ];
  for (const { label, status, shouldBeNull } of cases) {
    const entry = makeEntry({ status, confirmedCurrency: status === 'validated_exact_eur' ? 'EUR' : 'USD', expectedCurrency: status === 'rejected_mismatch' ? 'GBP' : status === 'validated_exact_eur' ? 'EUR' : 'USD' });
    const v = buildValidationFromCurated(label, entry, false);
    if (shouldBeNull) {
      assert(`${label}: !suitableForExactPnl (portfolio-highs will null currentPrice)`, v.suitableForExactPnl === false);
    } else {
      assert(`${label}: suitableForExactPnl (price passes through)`, v.suitableForExactPnl === true);
    }
  }
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
