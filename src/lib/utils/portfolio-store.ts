// KV-first store for portfolio config.
// Production (Vercel + KV): reads/writes Vercel KV (Upstash REST).
// Local dev without KV: falls back to config/portfolio.json via file-store.
//
// Mirrors the pattern of engine-store.ts — same non-fatal error handling,
// same KV client, same sanitization. Key: 'portfolio:config'.

import { getEffectivePortfolioConfig } from './config-loader';
import type { PortfolioConfig } from '../types';

const PORTFOLIO_KEY = 'portfolio:config';
const KV_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Internal KV helpers (mirrors engine-store.ts — kept local to avoid
// premature abstraction; extract to kv-client.ts if a third store is added)
// ---------------------------------------------------------------------------

function getKvConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return { url, token };
  return null;
}

function sanitizeKvError(msg: string): string {
  const token = process.env.KV_REST_API_TOKEN;
  if (token && token.length > 8) msg = msg.replaceAll(token, '[REDACTED]');
  const url = process.env.KV_REST_API_URL;
  if (url) msg = msg.replace(url, '[KV_URL]');
  return msg;
}

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
  await upstashCommand(url, token, ['SET', key, JSON.stringify(value)]);
}

async function kvGet<T>(url: string, token: string, key: string): Promise<T | null> {
  const result = await upstashCommand(url, token, ['GET', key]);
  if (result === null || result === undefined) return null;
  return JSON.parse(result as string) as T;
}

// Apply CASH_AVAILABLE_EUR / TARGET_CASH_RESERVE_EUR env overrides.
// Used when loading from KV (getEffectivePortfolioConfig already does this for the file path).
function applyEnvOverrides(config: PortfolioConfig): PortfolioConfig {
  return {
    ...config,
    cashAvailableEur: process.env.CASH_AVAILABLE_EUR
      ? parseFloat(process.env.CASH_AVAILABLE_EUR)
      : config.cashAvailableEur,
    targetCashReserveEur: process.env.TARGET_CASH_RESERVE_EUR
      ? parseFloat(process.env.TARGET_CASH_RESERVE_EUR)
      : config.targetCashReserveEur,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load portfolio config.
 * Reads KV first (key: 'portfolio:config'), falls back to committed config/portfolio.json.
 * Env overrides (CASH_AVAILABLE_EUR, TARGET_CASH_RESERVE_EUR) are applied in both paths.
 */
export async function loadPortfolioConfig(): Promise<{
  config: PortfolioConfig;
  source: 'kv' | 'config';
}> {
  const kv = getKvConfig();

  if (kv) {
    try {
      const stored = await kvGet<PortfolioConfig>(kv.url, kv.token, PORTFOLIO_KEY);
      if (stored) {
        return { config: applyEnvOverrides(stored), source: 'kv' };
      }
      // KV returned null (key not set yet) — fall through to file
    } catch (err) {
      const msg = sanitizeKvError(err instanceof Error ? err.message : String(err));
      console.warn('[PortfolioStore] KV read failed, using config file:', msg);
    }
  }

  // Fallback: committed config/portfolio.json (stable, always present)
  return { config: getEffectivePortfolioConfig(), source: 'config' };
}

/**
 * Save portfolio config.
 * Writes to KV (if configured). Falls back to local file-store in dev.
 * Never throws — returns saved:false + warning on failure.
 */
export async function savePortfolioConfig(config: PortfolioConfig): Promise<{
  saved: boolean;
  source: 'kv' | 'file' | 'none';
  warning?: string;
}> {
  const kv = getKvConfig();

  if (kv) {
    try {
      await kvSet(kv.url, kv.token, PORTFOLIO_KEY, config);
      console.log('[PortfolioStore] Config saved to KV');
      return { saved: true, source: 'kv' };
    } catch (err) {
      const msg = sanitizeKvError(err instanceof Error ? err.message : String(err));
      console.warn('[PortfolioStore] KV write failed (non-fatal):', msg);
      return { saved: false, source: 'none', warning: `KV_WRITE_FAILED: ${msg}` };
    }
  }

  // No KV: try local file-store (works in local dev; fails silently on Vercel)
  try {
    const { writeJsonFile } = await import('./file-store');
    writeJsonFile('../../config/portfolio.json', config);
    console.log('[PortfolioStore] Config saved to file-store (local dev)');
    return { saved: true, source: 'file' };
  } catch {
    return {
      saved: false,
      source: 'none',
      warning: 'No KV configured and filesystem write failed (expected on Vercel without KV)',
    };
  }
}
