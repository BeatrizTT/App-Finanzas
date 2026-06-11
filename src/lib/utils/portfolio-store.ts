// KV-first store for portfolio config.
// Production (Vercel + KV): reads/writes Vercel KV (Upstash REST).
// Local dev without KV: falls back to config/portfolio.json via file-store.
//
// Key: 'portfolio:config'. KV client shared via kv-client.ts (PR-0).

import { getEffectivePortfolioConfig } from './config-loader';
import { getKvConfig, sanitizeKvError, kvSet, kvGet } from './kv-client';
import type { PortfolioConfig } from '../types';

const PORTFOLIO_KEY = 'portfolio:config';

// Apply CASH_AVAILABLE_EUR / TARGET_CASH_RESERVE_EUR env overrides.
// Used when loading from KV (getEffectivePortfolioConfig already does this for the file path).
function applyEnvOverrides(config: PortfolioConfig): PortfolioConfig {
  const cashOverride = process.env['CASH_AVAILABLE_EUR'];
  const reserveOverride = process.env['TARGET_CASH_RESERVE_EUR'];
  return {
    ...config,
    cashAvailableEur: cashOverride ? parseFloat(cashOverride) : config.cashAvailableEur,
    targetCashReserveEur: reserveOverride
      ? parseFloat(reserveOverride)
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
