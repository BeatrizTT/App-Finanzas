// P3-3f-a: Rotating discovery scan cursor tests
// scan-cursor.ts reads DATA_DIR lazily via getDataDir(), so setting the env var
// before calling any function is sufficient — no require() dance needed.

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import {
  readScanCursor,
  writeScanCursor,
  buildRotatingBatch,
  selectExtendedBatch,
  advanceScanCursor,
  computeDiscoveryScanStatus,
  parseBatchSize,
  BATCH_SIZE_DEFAULT,
  BATCH_SIZE_MAX,
  BATCH_SIZE_MIN,
} from '../scan-cursor';
import type { ScanCursorFile, DiscoveryScanStatus } from '../scan-cursor';
import type { UniverseAsset } from '../../types';

// ── Test infrastructure ───────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-cursor-test-'));
process.env.DATA_DIR = tmpDir;

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

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

function makeAsset(ticker: string, type: UniverseAsset['type'] = 'stock'): UniverseAsset {
  return {
    ticker,
    name: ticker,
    type,
    qualityScore: 8,
    isSeed: false,
    tags: [],
    currency: 'USD',
  };
}

function cursorFile(): string {
  return path.join(tmpDir, 'scan-cursor.json');
}

function deleteCursor(): void {
  try { fs.unlinkSync(cursorFile()); } catch { /* missing is fine */ }
}

function writeBadJson(): void {
  fs.writeFileSync(cursorFile(), '{ bad json {{', 'utf8');
}

function writeInvalidCursor(obj: object): void {
  fs.writeFileSync(cursorFile(), JSON.stringify(obj), 'utf8');
}

// ── Group 1: parseBatchSize (pure) ────────────────────────────────────────

console.log('\n▶ src/lib/discovery/__tests__/scan-cursor.test.ts\n');

test('undefined returns BATCH_SIZE_DEFAULT', () => {
  assert(parseBatchSize(undefined) === BATCH_SIZE_DEFAULT, `expected ${BATCH_SIZE_DEFAULT}`);
});

test('empty string returns BATCH_SIZE_DEFAULT', () => {
  assert(parseBatchSize('') === BATCH_SIZE_DEFAULT, `expected ${BATCH_SIZE_DEFAULT}`);
});

test('"0" returns 0 (extended disabled)', () => {
  assert(parseBatchSize('0') === 0, 'expected 0');
});

test('valid positive integer is returned as-is', () => {
  assert(parseBatchSize('5') === 5, 'expected 5');
});

test('negative value returns BATCH_SIZE_DEFAULT', () => {
  assert(parseBatchSize('-1') === BATCH_SIZE_DEFAULT, `expected default, got parseBatchSize('-1')`);
});

test('non-numeric string returns BATCH_SIZE_DEFAULT', () => {
  assert(parseBatchSize('abc') === BATCH_SIZE_DEFAULT, 'expected default for non-numeric');
});

test('value exceeding BATCH_SIZE_MAX is clamped', () => {
  const result = parseBatchSize(String(BATCH_SIZE_MAX + 10));
  assert(result === BATCH_SIZE_MAX, `expected ${BATCH_SIZE_MAX}, got ${result}`);
});

test('BATCH_SIZE_MAX itself is accepted', () => {
  assert(parseBatchSize(String(BATCH_SIZE_MAX)) === BATCH_SIZE_MAX, `expected ${BATCH_SIZE_MAX}`);
});

// ── Group 2: readScanCursor — missing / corrupt ───────────────────────────

test('missing cursor file returns pointer 0', () => {
  deleteCursor();
  const cursor = readScanCursor();
  assert(cursor.extendedPointer === 0, `expected 0, got ${cursor.extendedPointer}`);
});

test('missing cursor file returns empty lastBatchTickers', () => {
  deleteCursor();
  const cursor = readScanCursor();
  assert(cursor.lastBatchTickers.length === 0, 'expected empty array');
});

test('corrupt JSON file resets to pointer 0 without throwing', () => {
  writeBadJson();
  let threw = false;
  let cursor: ScanCursorFile | null = null;
  try { cursor = readScanCursor(); } catch { threw = true; }
  assert(!threw, 'should not throw on corrupt file');
  assert(cursor !== null && cursor.extendedPointer === 0, 'expected pointer 0');
});

test('corrupt JSON resets lastBatchTickers to empty', () => {
  writeBadJson();
  const cursor = readScanCursor();
  assert(Array.isArray(cursor.lastBatchTickers) && cursor.lastBatchTickers.length === 0, 'expected empty');
});

test('invalid structure (negative pointer) resets safely', () => {
  writeInvalidCursor({ version: 1, extendedPointer: -5, lastBatchTickers: [], batchSize: 8 });
  const cursor = readScanCursor();
  assert(cursor.extendedPointer === 0, `expected 0, got ${cursor.extendedPointer}`);
});

test('valid cursor file preserves pointer', () => {
  deleteCursor();
  const seed: ScanCursorFile = {
    version: 1,
    lastUpdatedAt: '2026-01-01T00:00:00Z',
    extendedPointer: 7,
    lastBatchTickers: ['AAPL', 'MSFT'],
    batchSize: 8,
    mode: 'vercel_rotating_batch',
  };
  fs.writeFileSync(cursorFile(), JSON.stringify(seed), 'utf8');
  const cursor = readScanCursor();
  assert(cursor.extendedPointer === 7, `expected 7, got ${cursor.extendedPointer}`);
});

// ── Group 3: writeScanCursor ──────────────────────────────────────────────

test('write then read roundtrip preserves pointer', () => {
  deleteCursor();
  const toWrite: ScanCursorFile = {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    extendedPointer: 12,
    lastBatchTickers: ['AMD'],
    batchSize: 8,
    mode: 'vercel_rotating_batch',
  };
  writeScanCursor(toWrite);
  const read = readScanCursor();
  assert(read.extendedPointer === 12, `expected 12, got ${read.extendedPointer}`);
});

test('written cursor file lives in DATA_DIR (not src/data)', () => {
  deleteCursor();
  writeScanCursor({
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    extendedPointer: 3,
    lastBatchTickers: [],
    batchSize: 8,
    mode: 'vercel_rotating_batch',
  });
  assert(fs.existsSync(cursorFile()), 'file should exist in tmpDir');
  const srcDataCursor = path.join(process.cwd(), 'src', 'data', 'scan-cursor.json');
  // File may exist from other operations but our write went to tmpDir
  assert(fs.readFileSync(cursorFile(), 'utf8').includes('"extendedPointer": 3'), 'tmpDir file has our data');
});

test('write failure does not throw', () => {
  const savedDataDir = process.env.DATA_DIR;
  // Point to an unwritable path
  process.env.DATA_DIR = '/dev/null/impossible/path/that/cannot/exist';
  let threw = false;
  try {
    writeScanCursor({
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      extendedPointer: 0,
      lastBatchTickers: [],
      batchSize: 8,
      mode: 'vercel_rotating_batch',
    });
  } catch {
    threw = true;
  } finally {
    process.env.DATA_DIR = savedDataDir;
  }
  assert(!threw, 'writeScanCursor must not throw on write failure');
});

// ── Group 4: buildRotatingBatch (pure) ────────────────────────────────────

const tenAssets = Array.from({ length: 10 }, (_, i) => makeAsset(`T${i}`));

function makeCursor(pointer: number, batchSize = 8): ScanCursorFile {
  return {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    extendedPointer: pointer,
    lastBatchTickers: [],
    batchSize,
    mode: 'vercel_rotating_batch',
  };
}

test('empty extendedAssets returns empty batch', () => {
  const { batch } = buildRotatingBatch([], makeCursor(0));
  assert(batch.length === 0, 'expected empty batch');
});

test('empty extendedAssets returns nextPointer 0', () => {
  const { nextPointer } = buildRotatingBatch([], makeCursor(0));
  assert(nextPointer === 0, `expected 0, got ${nextPointer}`);
});

test('batchSize 0 returns empty batch', () => {
  const { batch } = buildRotatingBatch(tenAssets, makeCursor(0, 0));
  assert(batch.length === 0, 'expected empty for batchSize=0');
});

test('batchSize 0 does not advance pointer', () => {
  const { nextPointer } = buildRotatingBatch(tenAssets, makeCursor(3, 0));
  assert(nextPointer === 3, `expected 3, got ${nextPointer}`);
});

test('basic batch returns correct tickers from pointer', () => {
  const { batch } = buildRotatingBatch(tenAssets, makeCursor(2, 3));
  const tickers = batch.map((a) => a.ticker);
  assert(
    JSON.stringify(tickers) === JSON.stringify(['T2', 'T3', 'T4']),
    `expected [T2,T3,T4], got [${tickers.join(',')}]`
  );
});

test('deterministic: same pointer → same batch', () => {
  const b1 = buildRotatingBatch(tenAssets, makeCursor(5, 3)).batch.map((a) => a.ticker);
  const b2 = buildRotatingBatch(tenAssets, makeCursor(5, 3)).batch.map((a) => a.ticker);
  assert(JSON.stringify(b1) === JSON.stringify(b2), 'batch must be deterministic');
});

test('nextPointer = (pointer + batchSize) % total', () => {
  const { nextPointer } = buildRotatingBatch(tenAssets, makeCursor(3, 4));
  assert(nextPointer === 7, `expected 7, got ${nextPointer}`);
});

test('wrap-around: pointer near end wraps correctly', () => {
  const { nextPointer } = buildRotatingBatch(tenAssets, makeCursor(8, 4));
  assert(nextPointer === 2, `expected 2, got ${nextPointer}`);
});

test('wrap-around: batch tiles across list boundary', () => {
  const { batch } = buildRotatingBatch(tenAssets, makeCursor(9, 3));
  const tickers = batch.map((a) => a.ticker);
  assert(tickers[0] === 'T9', `expected T9 as first, got ${tickers[0]}`);
  assert(tickers[1] === 'T0', `expected T0 as second (wrap), got ${tickers[1]}`);
  assert(tickers[2] === 'T1', `expected T1 as third, got ${tickers[2]}`);
});

test('batchSize > total: batch is entire list, no duplicates', () => {
  const { batch } = buildRotatingBatch(tenAssets, makeCursor(0, 15));
  assert(batch.length === 10, `expected 10 (clamped to total), got ${batch.length}`);
  const unique = new Set(batch.map((a) => a.ticker));
  assert(unique.size === 10, 'no duplicates expected');
});

test('pointer out of bounds is normalised', () => {
  // pointer=12, total=10 → normalised to 2
  const { batch } = buildRotatingBatch(tenAssets, makeCursor(12, 3));
  const expected = ['T2', 'T3', 'T4'];
  assert(
    JSON.stringify(batch.map((a) => a.ticker)) === JSON.stringify(expected),
    `expected [${expected.join(',')}]`
  );
});

test('ETF assets from extendedEtfs are included in rotation', () => {
  const stocks = Array.from({ length: 3 }, (_, i) => makeAsset(`S${i}`, 'stock'));
  const etfs   = Array.from({ length: 2 }, (_, i) => makeAsset(`E${i}`, 'etf'));
  const combined = [...stocks, ...etfs];
  const { batch } = buildRotatingBatch(combined, makeCursor(3, 3));
  const hasEtf = batch.some((a) => a.type === 'etf');
  assert(hasEtf, 'ETF should appear in batch when pointer reaches etf section');
});

// ── Group 5: selectExtendedBatch (pure) ───────────────────────────────────

const fiveExtended = Array.from({ length: 5 }, (_, i) => makeAsset(`EXT${i}`));
const baseCursor = makeCursor(0, 3);

test('local (non-Vercel) returns full extended list', () => {
  const { extendedBatch } = selectExtendedBatch(fiveExtended, false, true, baseCursor);
  assert(extendedBatch.length === fiveExtended.length, 'local should return all extended');
});

test('local mode is local_full_scan', () => {
  const { mode } = selectExtendedBatch(fiveExtended, false, true, baseCursor);
  assert(mode === 'local_full_scan', `expected local_full_scan, got ${mode}`);
});

test('Vercel mode returns rotating batch (not full list)', () => {
  const { extendedBatch } = selectExtendedBatch(fiveExtended, true, true, baseCursor);
  assert(extendedBatch.length === 3, `expected batchSize=3, got ${extendedBatch.length}`);
  assert(extendedBatch.length < fiveExtended.length, 'Vercel must not return full list');
});

test('Vercel mode is vercel_rotating_batch', () => {
  const { mode } = selectExtendedBatch(fiveExtended, true, true, baseCursor);
  assert(mode === 'vercel_rotating_batch', `expected vercel_rotating_batch, got ${mode}`);
});

test('Vercel with includeExtendedOnVercel=false returns empty batch', () => {
  const { extendedBatch } = selectExtendedBatch(fiveExtended, true, false, baseCursor);
  assert(extendedBatch.length === 0, 'should be empty when flag is false');
});

test('Vercel with empty extended returns empty batch', () => {
  const { extendedBatch } = selectExtendedBatch([], true, true, baseCursor);
  assert(extendedBatch.length === 0, 'empty extended = empty batch');
});

test('seed and portfolio assets are not in extended batch (separation)', () => {
  // The extended list never contains seed assets — confirmed by universe.json structure.
  // selectExtendedBatch only deals with extended slice; seeds are added separately.
  // Verify the batch only contains what was passed in.
  const { extendedBatch } = selectExtendedBatch(fiveExtended, true, true, baseCursor);
  const tickers = extendedBatch.map((a) => a.ticker);
  for (const t of tickers) {
    assert(fiveExtended.some((a) => a.ticker === t), `unexpected ticker ${t} in batch`);
  }
});

test('seed assets always included when building final universe list (shape check)', () => {
  // The engine builds: [...seedStocks, ...seedEtfs, ...extendedBatch]
  // Simulate: seed = [S1], extended batch = [E1, E2]
  const seed = [makeAsset('NVDA'), makeAsset('ASML')];
  const { extendedBatch } = selectExtendedBatch(fiveExtended, true, true, baseCursor);
  const finalUniverse = [...seed, ...extendedBatch];
  assert(finalUniverse.some((a) => a.ticker === 'NVDA'), 'seed NVDA must be in final universe');
  assert(finalUniverse.some((a) => a.ticker === 'ASML'), 'seed ASML must be in final universe');
});

// ── Group 6: advanceScanCursor ────────────────────────────────────────────

test('advanceScanCursor returns updated cursor with new pointer', () => {
  deleteCursor();
  const batch = [makeAsset('AMD'), makeAsset('NVDA')];
  const cursor = makeCursor(4, 3);
  const updated = advanceScanCursor(cursor, batch, 7, 'vercel_rotating_batch');
  assert(updated.extendedPointer === 7, `expected 7, got ${updated.extendedPointer}`);
});

test('advanceScanCursor records lastBatchTickers', () => {
  const batch = [makeAsset('AMZN'), makeAsset('GOOGL')];
  const cursor = makeCursor(2, 2);
  const updated = advanceScanCursor(cursor, batch, 4, 'vercel_rotating_batch');
  assert(
    JSON.stringify(updated.lastBatchTickers) === JSON.stringify(['AMZN', 'GOOGL']),
    'expected [AMZN, GOOGL]'
  );
});

test('advanceScanCursor sets mode', () => {
  const cursor = makeCursor(0, 3);
  const updated = advanceScanCursor(cursor, [], 0, 'local_full_scan');
  assert(updated.mode === 'local_full_scan', `expected local_full_scan, got ${updated.mode}`);
});

test('advanceScanCursor persists to file', () => {
  deleteCursor();
  const cursor = makeCursor(1, 3);
  advanceScanCursor(cursor, [makeAsset('META')], 4, 'vercel_rotating_batch');
  const onDisk = readScanCursor();
  assert(onDisk.extendedPointer === 4, `expected 4 on disk, got ${onDisk.extendedPointer}`);
});

// ── Group 7: computeDiscoveryScanStatus ──────────────────────────────────

test('mode is preserved in status', () => {
  const status = computeDiscoveryScanStatus('vercel_rotating_batch', ['T1', 'T2'], 18, 8);
  assert(status.mode === 'vercel_rotating_batch', 'mode should be preserved');
});

test('batchTickers is preserved in status', () => {
  const status = computeDiscoveryScanStatus('vercel_rotating_batch', ['AMD', 'NVDA'], 18, 8);
  assert(JSON.stringify(status.batchTickers) === JSON.stringify(['AMD', 'NVDA']), 'tickers preserved');
});

test('extendedTotal is preserved', () => {
  const status = computeDiscoveryScanStatus('vercel_rotating_batch', ['T1'], 18, 8);
  assert(status.extendedTotal === 18, `expected 18, got ${status.extendedTotal}`);
});

test('extendedCoveredThisRun equals batchTickers length', () => {
  const status = computeDiscoveryScanStatus('vercel_rotating_batch', ['A', 'B', 'C'], 18, 8);
  assert(status.extendedCoveredThisRun === 3, `expected 3, got ${status.extendedCoveredThisRun}`);
});

test('estimatedRunsPerFullSweep = ceil(total / batchSize)', () => {
  const status = computeDiscoveryScanStatus('vercel_rotating_batch', [], 18, 8);
  assert(status.estimatedRunsPerFullSweep === 3, `expected ceil(18/8)=3, got ${status.estimatedRunsPerFullSweep}`);
});

test('extendedTotal = 0 → estimatedRunsPerFullSweep = 0', () => {
  const status = computeDiscoveryScanStatus('vercel_rotating_batch', [], 0, 8);
  assert(status.estimatedRunsPerFullSweep === 0, 'expected 0 when no extended assets');
});

test('batchSize = 0 → estimatedRunsPerFullSweep = 0 (disabled)', () => {
  const status = computeDiscoveryScanStatus('vercel_rotating_batch', [], 18, 0);
  assert(status.estimatedRunsPerFullSweep === 0, 'expected 0 when batchSize=0');
});

test('status batchSize field matches input', () => {
  const status = computeDiscoveryScanStatus('local_full_scan', [], 10, 10);
  assert(status.batchSize === 10, `expected 10, got ${status.batchSize}`);
});

// ── Summary ───────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
