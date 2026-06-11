// Discovery scan cursor — rotating batch state for extended universe
// Runtime file: src/data/scan-cursor.json (not committed to git)
// All file I/O reads DATA_DIR lazily so tests can override via process.env.

import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { UniverseAsset } from '../types';

const CURSOR_FILE = 'scan-cursor.json';

export const BATCH_SIZE_DEFAULT = 8;
export const BATCH_SIZE_MIN = 0; // 0 = disabled
export const BATCH_SIZE_MAX = 20;

function getDataDir(): string {
  return process.env.DATA_DIR ?? join(process.cwd(), 'src/data');
}

function cursorPath(): string {
  return join(getDataDir(), CURSOR_FILE);
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface ScanCursorFile {
  version: 1;
  lastUpdatedAt: string;
  extendedPointer: number;
  lastBatchTickers: string[];
  batchSize: number;
  mode: 'vercel_rotating_batch' | 'local_full_scan';
}

export interface DiscoveryScanStatus {
  mode: string;
  batchSize: number;
  batchTickers: string[];
  extendedTotal: number;
  extendedCoveredThisRun: number;
  estimatedRunsPerFullSweep: number;
}

// --------------------------------------------------------------------------
// Cursor helpers
// --------------------------------------------------------------------------

function defaultCursor(batchSize: number): ScanCursorFile {
  return {
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    extendedPointer: 0,
    lastBatchTickers: [],
    batchSize,
    mode: 'vercel_rotating_batch',
  };
}

function isValidCursor(obj: unknown): obj is ScanCursorFile {
  if (!obj || typeof obj !== 'object') return false;
  const c = obj as Record<string, unknown>;
  return (
    c.version === 1 &&
    typeof c.extendedPointer === 'number' &&
    Number.isInteger(c.extendedPointer) &&
    c.extendedPointer >= 0 &&
    typeof c.batchSize === 'number' &&
    c.batchSize >= 0 &&
    Array.isArray(c.lastBatchTickers)
  );
}

/**
 * Parse DISCOVERY_EXTENDED_BATCH_SIZE env value.
 * 0  = extended disabled.
 * <0 or non-numeric = invalid → BATCH_SIZE_DEFAULT.
 * >BATCH_SIZE_MAX = clamped to BATCH_SIZE_MAX.
 */
export function parseBatchSize(raw: string | undefined): number {
  if (raw === undefined || raw === '') return BATCH_SIZE_DEFAULT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < BATCH_SIZE_MIN) {
    console.warn(
      `[ScanCursor] Invalid DISCOVERY_EXTENDED_BATCH_SIZE="${raw}" — using default ${BATCH_SIZE_DEFAULT}`
    );
    return BATCH_SIZE_DEFAULT;
  }
  if (n > BATCH_SIZE_MAX) {
    console.warn(
      `[ScanCursor] DISCOVERY_EXTENDED_BATCH_SIZE=${n} exceeds max ${BATCH_SIZE_MAX} — clamping`
    );
    return BATCH_SIZE_MAX;
  }
  return n;
}

// --------------------------------------------------------------------------
// File I/O
// --------------------------------------------------------------------------

export function readScanCursor(): ScanCursorFile {
  const batchSize = parseBatchSize(process.env.DISCOVERY_EXTENDED_BATCH_SIZE);
  try {
    const raw = readFileSync(cursorPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidCursor(parsed)) {
      console.warn('[ScanCursor] Corrupt or invalid cursor file — resetting to pointer 0');
      return defaultCursor(batchSize);
    }
    // Always use env batchSize (not persisted one) so env changes take effect
    return { ...parsed, batchSize };
  } catch {
    // Missing file or parse error — start fresh
    return defaultCursor(batchSize);
  }
}

export function writeScanCursor(cursor: ScanCursorFile): void {
  try {
    mkdirSync(getDataDir(), { recursive: true });
    writeFileSync(cursorPath(), JSON.stringify(cursor, null, 2), 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[ScanCursor] Failed to write cursor file:', msg);
    // Never crash — cursor is advisory state only
  }
}

// --------------------------------------------------------------------------
// Batch selection (pure — no I/O)
// --------------------------------------------------------------------------

/**
 * Select the next rotating slice of extended assets.
 * Deterministic: same pointer + same assets → same batch.
 * Pointer is normalised defensively in case universe shrank.
 */
export function buildRotatingBatch(
  extendedAssets: UniverseAsset[],
  cursor: ScanCursorFile
): { batch: UniverseAsset[]; nextPointer: number } {
  if (extendedAssets.length === 0 || cursor.batchSize === 0) {
    return { batch: [], nextPointer: cursor.extendedPointer };
  }

  const total = extendedAssets.length;
  const batchSize = Math.min(cursor.batchSize, total);
  const pointer = cursor.extendedPointer % total; // normalise if universe shrank

  const batch: UniverseAsset[] = [];
  for (let i = 0; i < batchSize; i++) {
    batch.push(extendedAssets[(pointer + i) % total]);
  }

  const nextPointer = (pointer + batchSize) % total;
  return { batch, nextPointer };
}

/**
 * Pure selection helper — wraps isVercel + flag logic so it is testable
 * without running the full engine.
 */
export function selectExtendedBatch(
  extendedAssets: UniverseAsset[],
  isVercel: boolean,
  includeExtendedOnVercel: boolean,
  cursor: ScanCursorFile
): { extendedBatch: UniverseAsset[]; mode: ScanCursorFile['mode']; nextPointer: number } {
  if (!isVercel) {
    return {
      extendedBatch: extendedAssets,
      mode: 'local_full_scan',
      nextPointer: cursor.extendedPointer,
    };
  }
  if (!includeExtendedOnVercel || extendedAssets.length === 0) {
    return {
      extendedBatch: [],
      mode: 'vercel_rotating_batch',
      nextPointer: cursor.extendedPointer,
    };
  }
  const { batch, nextPointer } = buildRotatingBatch(extendedAssets, cursor);
  return { extendedBatch: batch, mode: 'vercel_rotating_batch', nextPointer };
}

/**
 * Advance the cursor after a successful batch selection and persist it.
 * Failure to persist is logged but never thrown.
 */
export function advanceScanCursor(
  cursor: ScanCursorFile,
  batch: UniverseAsset[],
  nextPointer: number,
  mode: ScanCursorFile['mode']
): ScanCursorFile {
  const updated: ScanCursorFile = {
    ...cursor,
    lastUpdatedAt: new Date().toISOString(),
    extendedPointer: nextPointer,
    lastBatchTickers: batch.map((a) => a.ticker),
    mode,
  };
  writeScanCursor(updated);
  return updated;
}

// --------------------------------------------------------------------------
// Status (pure — no I/O)
// --------------------------------------------------------------------------

export function computeDiscoveryScanStatus(
  mode: ScanCursorFile['mode'],
  batchTickers: string[],
  extendedTotal: number,
  batchSize: number
): DiscoveryScanStatus {
  return {
    mode,
    batchSize,
    batchTickers,
    extendedTotal,
    extendedCoveredThisRun: batchTickers.length,
    estimatedRunsPerFullSweep:
      extendedTotal === 0 || batchSize === 0 ? 0 : Math.ceil(extendedTotal / batchSize),
  };
}
