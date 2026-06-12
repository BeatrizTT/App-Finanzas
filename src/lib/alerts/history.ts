// Alert history store — KV-first with file-store fallback (PR-1, Fase 2).
//
// Persists two things across serverless invocations:
//   1. Alert history (ring buffer, last 500) — KV key `alerts:history`
//   2. Previous-states store for change detection / dedupe — KV key
//      `alerts:previous_states`
//
// Production (Vercel + KV): reads/writes Vercel KV (Upstash REST).
// Local dev without KV: falls back to file-store (src/data or DATA_DIR).
//
// Why KV: before PR-1 these lived only in file-store → `/tmp` on Vercel, which
// resets on every cold start. Dedupe (don't re-send the same unchanged alert)
// only works if previous-states survives between cron runs. KV makes it durable.
// In production KV is the source of truth; file-store is the local-dev fallback.
//
// KV client shared via kv-client.ts (PR-0) — no copy-pasted helpers.

import { readJsonFile, writeJsonFile } from '../utils/file-store';
import { getKvConfig, sanitizeKvError, kvSet, kvGet } from '../utils/kv-client';
import type { Alert, PreviousStates } from '../types';

const ALERT_HISTORY_FILE = 'alert-history.json';
const PREVIOUS_STATES_FILE = 'previous-states.json';

const ALERT_HISTORY_KEY = 'alerts:history';
const PREVIOUS_STATES_KEY = 'alerts:previous_states';

// Keep at most this many alerts in the ring buffer.
const MAX_ALERTS = 500;

// Simple ID generator without uuid dependency
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --------------------------------------------------------------------------
// Internal KV-first read / write helpers
// --------------------------------------------------------------------------

// Read KV first (if configured); on miss or error fall back to file-store.
async function loadJson<T>(kvKey: string, fileKey: string, fallback: T): Promise<T> {
  const kv = getKvConfig();
  if (kv) {
    try {
      const stored = await kvGet<T>(kv.url, kv.token, kvKey);
      if (stored !== null && stored !== undefined) return stored;
      // KV returned null (key not set yet) — fall through to file-store
    } catch (err) {
      const msg = sanitizeKvError(err instanceof Error ? err.message : String(err));
      console.warn('[AlertHistory] KV read failed, using file-store:', msg);
    }
  }
  return readJsonFile<T>(fileKey, fallback);
}

// Write to KV if configured; otherwise (or on KV failure) to file-store.
// Never throws — persistence failures must not crash the engine.
async function saveJson(kvKey: string, fileKey: string, value: unknown): Promise<void> {
  const kv = getKvConfig();
  if (kv) {
    try {
      await kvSet(kv.url, kv.token, kvKey, value);
      return;
    } catch (err) {
      const msg = sanitizeKvError(err instanceof Error ? err.message : String(err));
      console.warn('[AlertHistory] KV write failed (non-fatal), trying file-store:', msg);
      // fall through to file-store as a secondary attempt
    }
  }
  try {
    writeJsonFile(fileKey, value);
  } catch (err) {
    console.warn('[AlertHistory] file-store write failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

// --------------------------------------------------------------------------
// Alert history
// --------------------------------------------------------------------------

export async function getAlertHistory(limit = 100): Promise<Alert[]> {
  const all = await loadJson<Alert[]>(ALERT_HISTORY_KEY, ALERT_HISTORY_FILE, []);
  return all.slice(-limit).reverse(); // most recent first
}

export async function saveAlert(alert: Alert): Promise<void> {
  const existing = await loadJson<Alert[]>(ALERT_HISTORY_KEY, ALERT_HISTORY_FILE, []);
  existing.push(alert);
  await saveJson(ALERT_HISTORY_KEY, ALERT_HISTORY_FILE, existing.slice(-MAX_ALERTS));
}

export async function saveAlerts(alerts: Alert[]): Promise<void> {
  const existing = await loadJson<Alert[]>(ALERT_HISTORY_KEY, ALERT_HISTORY_FILE, []);
  const updated = [...existing, ...alerts].slice(-MAX_ALERTS);
  await saveJson(ALERT_HISTORY_KEY, ALERT_HISTORY_FILE, updated);
}

// --------------------------------------------------------------------------
// Previous states store (for change detection)
// --------------------------------------------------------------------------

export async function getPreviousStates(): Promise<PreviousStates> {
  return loadJson<PreviousStates>(PREVIOUS_STATES_KEY, PREVIOUS_STATES_FILE, {
    updatedAt: '',
    portfolio: {},
    opportunities: {},
  });
}

export async function savePreviousStates(states: PreviousStates): Promise<void> {
  await saveJson(PREVIOUS_STATES_KEY, PREVIOUS_STATES_FILE, {
    ...states,
    updatedAt: new Date().toISOString(),
  });
}

// --------------------------------------------------------------------------
// Check if an alert should be sent (respects cooldown)
// --------------------------------------------------------------------------
// Pure function — operates on the `prev` snapshot passed in, reads no storage.

export function shouldSendAlert(assetId: string, prev: PreviousStates): boolean {
  const cooldownHours = parseInt(process.env['ALERT_COOLDOWN_HOURS'] ?? '24', 10);
  const portfolio = prev.portfolio[assetId];
  const opp = prev.opportunities[assetId];
  const entry = portfolio ?? opp;

  if (!entry?.lastAlertAt) return true;

  const lastAlert = new Date(entry.lastAlertAt);
  const hoursSince = (Date.now() - lastAlert.getTime()) / (1000 * 60 * 60);
  return hoursSince >= cooldownHours;
}

// --------------------------------------------------------------------------
// Create a typed alert object
// --------------------------------------------------------------------------
// Pure factory — synchronous.

export function createAlert(
  params: Omit<Alert, 'id' | 'timestamp' | 'telegramSent'> & { telegramSent?: boolean }
): Alert {
  return {
    ...params,
    id: genId(),
    timestamp: new Date().toISOString(),
    telegramSent: params.telegramSent ?? false,
  };
}
