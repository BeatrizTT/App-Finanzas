// Persistent storage for the latest engine output.
// Production (Vercel): writes and reads from Vercel KV (Upstash REST API).
// Development / local: falls back to file-store (src/data or DATA_DIR).
//
// KV is detected at runtime from env vars — the app runs without KV configured.
// If KV is configured but the call fails, errors are non-fatal and file-store
// is used as a secondary fallback. Neither failure path crashes the engine.

import { writeJsonFile, readJsonFile } from './file-store';
import { getKvConfig, sanitizeKvError, kvSet, kvGet } from './kv-client';
import type { DailyEngineOutput } from '../types';

const ENGINE_OUTPUT_FILE = 'engine-output.json';
const ENGINE_OUTPUT_KEY = 'engine:latest_output';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist the engine output.
 * Writes to KV (if configured) and to file-store (always, for local dev).
 * Errors in either path are non-fatal; warnings are returned for inclusion
 * in the engine output's errors[] array.
 */
export async function saveEngineOutput(
  output: DailyEngineOutput
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const kv = getKvConfig();

  if (kv) {
    try {
      await kvSet(kv.url, kv.token, ENGINE_OUTPUT_KEY, output);
      console.log('[EngineStore] Output saved to Vercel KV');
    } catch (err) {
      const msg = sanitizeKvError(err instanceof Error ? err.message : String(err));
      console.warn('[EngineStore] KV write failed (non-fatal):', msg);
      warnings.push(`KV_WRITE_FAILED: ${msg}`);
    }
  }

  // Always attempt file-store — needed for local dev, acts as secondary backup
  try {
    writeJsonFile(ENGINE_OUTPUT_FILE, output);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[EngineStore] file-store write failed (non-fatal):', msg);
    warnings.push(`FILE_WRITE_FAILED: ${msg}`);
  }

  return { warnings };
}

/**
 * Load the latest engine output.
 * Reads KV first (production), then falls back to file-store.
 * Returns { output: null, source: 'none' } when no data exists anywhere.
 */
export async function loadEngineOutput(): Promise<{
  output: DailyEngineOutput | null;
  source: 'kv' | 'file' | 'none';
}> {
  const kv = getKvConfig();

  if (kv) {
    try {
      const output = await kvGet<DailyEngineOutput>(kv.url, kv.token, ENGINE_OUTPUT_KEY);
      if (output) return { output, source: 'kv' };
      // KV returned null (key doesn't exist yet) — fall through
    } catch (err) {
      const msg = sanitizeKvError(err instanceof Error ? err.message : String(err));
      console.warn('[EngineStore] KV read failed, trying file-store:', msg);
    }
  }

  try {
    const output = readJsonFile<DailyEngineOutput | null>(ENGINE_OUTPUT_FILE, null);
    if (output) return { output, source: 'file' };
  } catch (err) {
    console.warn('[EngineStore] file-store read failed:', err instanceof Error ? err.message : err);
  }

  return { output: null, source: 'none' };
}
