// Persistent storage for the latest engine output.
// Production (Vercel): writes and reads from Vercel KV (Upstash REST API).
// Development / local: falls back to file-store (src/data or DATA_DIR).
//
// KV is detected at runtime from env vars — the app runs without KV configured.
// If KV is configured but the call fails, errors are non-fatal and file-store
// is used as a secondary fallback. Neither failure path crashes the engine.

import { writeJsonFile, readJsonFile } from './file-store';
import type { DailyEngineOutput } from '../types';

const ENGINE_OUTPUT_FILE = 'engine-output.json';
const ENGINE_OUTPUT_KEY = 'engine:latest_output';
const KV_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getKvConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return { url, token };
  return null;
}

// Strip KV credentials from error messages before logging or surfacing them
function sanitizeKvError(msg: string): string {
  const token = process.env.KV_REST_API_TOKEN;
  if (token && token.length > 8) msg = msg.replaceAll(token, '[REDACTED]');
  const url = process.env.KV_REST_API_URL;
  if (url) msg = msg.replace(url, '[KV_URL]');
  return msg;
}

// Upstash Redis REST API — single command format:
// POST {url}  body: ["COMMAND", arg1, arg2, ...]
// Returns: { result: ..., error?: string }
async function upstashCommand(
  url: string,
  token: string,
  command: string[]
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KV_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    const data = await res.json() as { result: unknown; error?: string };
    if (data.error) throw new Error(data.error);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function kvSet(url: string, token: string, key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  await upstashCommand(url, token, ['SET', key, serialized]);
}

async function kvGet<T>(url: string, token: string, key: string): Promise<T | null> {
  const result = await upstashCommand(url, token, ['GET', key]);
  if (result === null || result === undefined) return null;
  return JSON.parse(result as string) as T;
}

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
