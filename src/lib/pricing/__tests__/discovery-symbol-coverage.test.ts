// P3-1 Phase A: integrity tests for discovery-universe symbol coverage.
// Run with: npx tsx src/lib/pricing/__tests__/discovery-symbol-coverage.test.ts
//
// These are SMOKE-INDEPENDENT structural checks. They verify that every USD
// extended-discovery stock in universe.json is wired into:
//   1. SYMBOL_MAP (eodhd-provider.ts) — so getRecentHighs() can fetch it
//   2. ALL_VALIDATION_TARGETS (validate-eodhd-symbols.ts) — so the smoke can validate it
//
// They deliberately do NOT assert curated-config membership or `validated`
// status — those are flipped only by a real EODHD smoke (Phase B/C) and would
// otherwise make this suite phase-dependent.

import fs from 'fs';
import path from 'path';
import { listEodhdMappedTickers } from '../eodhd-provider';

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
// Fixtures — read real config + source files (no network, no smoke)
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const UNIVERSE_PATH = path.resolve(ROOT, 'config', 'universe.json');
const VALIDATOR_PATH = path.resolve(ROOT, 'scripts', 'validate-eodhd-symbols.ts');

interface UniverseAsset { ticker: string; currency: string; type: string }

function loadExtendedUsdStocks(): string[] {
  const raw = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8')) as {
    extendedStocks: UniverseAsset[];
  };
  return raw.extendedStocks.filter(a => a.currency === 'USD').map(a => a.ticker);
}

// Parse the validator's ALL_VALIDATION_TARGETS by matching `internalTicker: 'X'`
// entries in the source. This avoids importing the script (which runs main()).
function loadValidationTargetTickers(): Set<string> {
  const src = fs.readFileSync(VALIDATOR_PATH, 'utf-8');
  const tickers = new Set<string>();
  const re = /internalTicker:\s*'([A-Z0-9.]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    tickers.add(m[1]);
  }
  return tickers;
}

// The 13 stocks added in P3-1 Phase A (CRM/MRVL/SMCI were already covered in P2c-4).
const P3_1_NEW_SYMBOLS = [
  'AAPL', 'AMAT', 'LRCX', 'KLAC', 'INTU', 'SHOP',
  'SNOW', 'NET', 'V', 'MA', 'UNH', 'JNJ', 'COST',
];

// Already validated in P2c-4 — must remain covered.
const ALREADY_VALIDATED = ['CRM', 'MRVL', 'SMCI'];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('universe.json: extendedStocks USD set is non-empty and includes known names', () => {
  const usd = loadExtendedUsdStocks();
  assert('at least 17 USD extended stocks', usd.length >= 17);
  assert('contains AAPL', usd.includes('AAPL'));
  assert('contains V', usd.includes('V'));
  assert('contains MU', usd.includes('MU'));
});

test('SYMBOL_MAP covers every USD extended-discovery stock', () => {
  const mapped = new Set(listEodhdMappedTickers());
  const usd = loadExtendedUsdStocks();
  for (const ticker of usd) {
    assert(`SYMBOL_MAP contains ${ticker}`, mapped.has(ticker));
  }
});

test('ALL_VALIDATION_TARGETS covers every USD extended-discovery stock', () => {
  const targets = loadValidationTargetTickers();
  const usd = loadExtendedUsdStocks();
  for (const ticker of usd) {
    assert(`validation targets contain ${ticker}`, targets.has(ticker));
  }
});

test('P3-1 Phase A: all 13 newly-prepared symbols present in SYMBOL_MAP', () => {
  const mapped = new Set(listEodhdMappedTickers());
  for (const ticker of P3_1_NEW_SYMBOLS) {
    assert(`SYMBOL_MAP contains new symbol ${ticker}`, mapped.has(ticker));
  }
});

test('P3-1 Phase A: all 13 newly-prepared symbols present in validation targets', () => {
  const targets = loadValidationTargetTickers();
  for (const ticker of P3_1_NEW_SYMBOLS) {
    assert(`validation targets contain new symbol ${ticker}`, targets.has(ticker));
  }
});

test('P2c-4 regression: already-validated extended stocks remain wired', () => {
  const mapped = new Set(listEodhdMappedTickers());
  const targets = loadValidationTargetTickers();
  for (const ticker of ALREADY_VALIDATED) {
    assert(`${ticker} still in SYMBOL_MAP`, mapped.has(ticker));
    assert(`${ticker} still in validation targets`, targets.has(ticker));
  }
});

test('MU is wired for smoke (in map + targets) but not asserted validated here', () => {
  const mapped = new Set(listEodhdMappedTickers());
  const targets = loadValidationTargetTickers();
  assert('MU in SYMBOL_MAP', mapped.has('MU'));
  assert('MU in validation targets', targets.has('MU'));
});

test('Phase A is config-only: curated config NOT modified for new symbols', () => {
  // P3-1 Phase A must not add new symbols to the curated config — that happens
  // only after a real smoke (Phase C). Curated config must still have 15 symbols.
  const configPath = path.resolve(ROOT, 'config', 'eodhd-symbol-validation.json');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { symbols: unknown[] };
  assert('curated config still has exactly 15 symbols (no premature additions)', cfg.symbols.length === 15);
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
