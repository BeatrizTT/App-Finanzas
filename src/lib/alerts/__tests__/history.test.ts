// Tests for alerts/history: KV-first alert history + previous-states store (PR-1).
// Covers: KV round-trips (read/write), ring buffer cap, default when key missing,
// KV failure fallback (no throw), secret sanitization, and the pure helpers
// shouldSendAlert (cooldown) + createAlert (shape).
//
// Note: history is imported DYNAMICALLY after pointing DATA_DIR at an empty temp
// dir. file-store captures DATA_DIR in a module-level const at import time, so the
// env var must be set before the (transitive) import — otherwise KV-miss fallbacks
// would read leftover src/data/*.json from local runs and the tests wouldn't be
// hermetic.

import type { Alert, PreviousStates } from '../../types';

const SUITE_DATA_DIR = `/tmp/alert-history-test-${process.pid}`;
process.env.DATA_DIR = SUITE_DATA_DIR;

// Filled in by main() via dynamic import (after DATA_DIR is set).
type HistoryModule = typeof import('../history');
let H: HistoryModule;

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function mkAlert(id: string): Alert {
  return { id, timestamp: new Date().toISOString(), type: 'daily_digest', message: `m-${id}`, telegramSent: false };
}

// Stateful in-memory KV mock: GET serves from store, SET writes to store.
// Lets us exercise the read-modify-write round-trips of the ring buffer.
function makeKv(initial: Record<string, unknown> = {}): { fetch: typeof global.fetch; store: Record<string, unknown> } {
  const store: Record<string, unknown> = { ...initial };
  const fetch = (async (_url: unknown, init: { body?: string } = {}) => {
    const cmd = JSON.parse(init.body ?? '[]') as string[];
    const [method, key, value] = cmd;
    if (method === 'SET') {
      store[key] = JSON.parse(value);
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const v = store[key];
    const result = v !== undefined && v !== null ? JSON.stringify(v) : null;
    return new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof global.fetch;
  return { fetch, store };
}

async function withKv(
  initial: Record<string, unknown>,
  fn: (store: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const savedUrl = process.env.KV_REST_API_URL;
  const savedToken = process.env.KV_REST_API_TOKEN;
  const originalFetch = global.fetch;
  const { fetch, store } = makeKv(initial);
  try {
    process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
    process.env.KV_REST_API_TOKEN = 'fake-token';
    global.fetch = fetch;
    await fn(store);
  } finally {
    global.fetch = originalFetch;
    if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = savedUrl;
    if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = savedToken;
  }
}

console.log('\n▶ src/lib/alerts/__tests__/history.test.ts\n');

async function main(): Promise<void> {
  // Dynamic import so file-store picks up the temp DATA_DIR set above.
  H = await import('../history');

  // ── Alert history (KV round-trips) ──────────────────────────────────────

  await test('getAlertHistory reads from KV, most-recent-first, respects limit', async () => {
    await withKv({ 'alerts:history': [mkAlert('a1'), mkAlert('a2'), mkAlert('a3')] }, async () => {
      const recent = await H.getAlertHistory(2);
      assert(recent.length === 2, `expected 2, got ${recent.length}`);
      assert(recent[0].id === 'a3', `expected a3 first, got ${recent[0].id}`);
      assert(recent[1].id === 'a2', `expected a2 second, got ${recent[1].id}`);
    });
  });

  await test('saveAlert appends to KV (read-modify-write round-trip)', async () => {
    await withKv({ 'alerts:history': [] }, async (store) => {
      await H.saveAlert(mkAlert('a1'));
      await H.saveAlert(mkAlert('a2'));
      const stored = store['alerts:history'] as Alert[];
      assert(stored.length === 2, `expected 2 stored, got ${stored.length}`);
      assert(stored[0].id === 'a1' && stored[1].id === 'a2', 'order should be append');
    });
  });

  await test('saveAlert caps the ring buffer at 500 (drops oldest)', async () => {
    const seed = Array.from({ length: 500 }, (_, i) => mkAlert(`seed-${i}`));
    await withKv({ 'alerts:history': seed }, async (store) => {
      await H.saveAlert(mkAlert('newest'));
      const stored = store['alerts:history'] as Alert[];
      assert(stored.length === 500, `expected cap 500, got ${stored.length}`);
      assert(stored[stored.length - 1].id === 'newest', 'newest should be last');
      assert(stored[0].id === 'seed-1', `oldest (seed-0) should be dropped, got ${stored[0].id}`);
    });
  });

  await test('saveAlerts appends a batch to existing history', async () => {
    await withKv({ 'alerts:history': [mkAlert('a1')] }, async (store) => {
      await H.saveAlerts([mkAlert('a2'), mkAlert('a3')]);
      const stored = store['alerts:history'] as Alert[];
      assert(stored.length === 3, `expected 3, got ${stored.length}`);
      assert(stored.map((a) => a.id).join(',') === 'a1,a2,a3', 'batch should append in order');
    });
  });

  // ── Previous states (KV round-trips) ────────────────────────────────────

  await test('getPreviousStates returns empty default when KV key is missing', async () => {
    // Empty KV store → key missing → file-store fallback reads empty temp dir → default.
    await withKv({}, async () => {
      const prev = await H.getPreviousStates();
      assert(prev.updatedAt === '', 'updatedAt should be empty string');
      assert(Object.keys(prev.portfolio).length === 0, 'portfolio should be empty');
      assert(Object.keys(prev.opportunities).length === 0, 'opportunities should be empty');
    });
  });

  await test('getPreviousStates reads from KV when present', async () => {
    const seeded: PreviousStates = {
      updatedAt: '2026-06-12T00:00:00.000Z',
      portfolio: { nvda: { assetId: 'nvda', state: 'REDUCE', lastAlertAt: '2026-06-11T00:00:00.000Z' } },
      opportunities: {},
    };
    await withKv({ 'alerts:previous_states': seeded }, async () => {
      const prev = await H.getPreviousStates();
      assert(prev.portfolio['nvda']?.state === 'REDUCE', 'should load nvda state from KV');
      assert(prev.updatedAt === '2026-06-12T00:00:00.000Z', 'should preserve updatedAt');
    });
  });

  await test('savePreviousStates writes to KV and stamps updatedAt', async () => {
    await withKv({}, async (store) => {
      const states: PreviousStates = {
        updatedAt: '',
        portfolio: { aapl: { assetId: 'aapl', state: 'DO_NOTHING' } },
        opportunities: {},
      };
      await H.savePreviousStates(states);
      const stored = store['alerts:previous_states'] as PreviousStates;
      assert(stored.portfolio['aapl']?.state === 'DO_NOTHING', 'should persist portfolio entry');
      assert(stored.updatedAt !== '', 'updatedAt should be stamped on save');
    });
  });

  // ── Failure handling ────────────────────────────────────────────────────

  await test('KV read failure falls back without throwing (returns default)', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    try {
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';
      global.fetch = (async () => { throw new Error('KV down'); }) as unknown as typeof global.fetch;

      const prev = await H.getPreviousStates();
      assert(prev.updatedAt === '' && Object.keys(prev.portfolio).length === 0, 'should return default on KV read failure');
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('KV write failure does not throw and never leaks the token in logs', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    const originalWarn = console.warn;
    const warnings: string[] = [];
    try {
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'super-secret-token-xyz';
      console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
      global.fetch = (async () => { throw new Error('boom leaking super-secret-token-xyz'); }) as unknown as typeof global.fetch;

      // Must not throw even though the KV write fails (file-store fallback to temp dir).
      await H.saveAlert(mkAlert('a1'));

      const joined = warnings.join('\n');
      assert(!joined.includes('super-secret-token-xyz'), 'warnings must not contain the raw KV token');
    } finally {
      console.warn = originalWarn;
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  // ── Pure helpers ─────────────────────────────────────────────────────────

  await test('shouldSendAlert: true when no previous alert recorded (no currentState)', () => {
    const prev: PreviousStates = { updatedAt: '', portfolio: {}, opportunities: {} };
    assert(H.shouldSendAlert('nvda', prev) === true, 'should allow first alert');
  });

  await test('shouldSendAlert: false within cooldown, true after cooldown (same state)', () => {
    const savedCooldown = process.env.ALERT_COOLDOWN_HOURS;
    try {
      delete process.env.ALERT_COOLDOWN_HOURS; // default 24h
      const recent: PreviousStates = {
        updatedAt: '',
        portfolio: { nvda: { assetId: 'nvda', state: 'REDUCE', lastAlertAt: new Date().toISOString() } },
        opportunities: {},
      };
      assert(H.shouldSendAlert('nvda', recent, 'REDUCE') === false, 'should suppress within 24h cooldown for same state');

      const old: PreviousStates = {
        updatedAt: '',
        portfolio: { nvda: { assetId: 'nvda', state: 'REDUCE', lastAlertAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() } },
        opportunities: {},
      };
      assert(H.shouldSendAlert('nvda', old, 'REDUCE') === true, 'should allow after cooldown elapsed');
    } finally {
      if (savedCooldown === undefined) delete process.env.ALERT_COOLDOWN_HOURS;
      else process.env.ALERT_COOLDOWN_HOURS = savedCooldown;
    }
  });

  await test('shouldSendAlert: state change bypasses cooldown (BUY_MORE → REDUCE)', () => {
    const savedCooldown = process.env.ALERT_COOLDOWN_HOURS;
    try {
      delete process.env.ALERT_COOLDOWN_HOURS;
      // lastAlertAt = 1 hour ago — well within the 24h cooldown
      const prev: PreviousStates = {
        updatedAt: '',
        portfolio: {
          nvda: { assetId: 'nvda', state: 'BUY_MORE', lastAlertAt: new Date(Date.now() - 3600 * 1000).toISOString() },
        },
        opportunities: {},
      };
      // Same state → suppressed
      assert(H.shouldSendAlert('nvda', prev, 'BUY_MORE') === false, 'same state within cooldown must be suppressed');
      // State change → bypass cooldown → must send
      assert(H.shouldSendAlert('nvda', prev, 'REDUCE') === true, 'BUY_MORE→REDUCE must bypass cooldown');
    } finally {
      if (savedCooldown === undefined) delete process.env.ALERT_COOLDOWN_HOURS;
      else process.env.ALERT_COOLDOWN_HOURS = savedCooldown;
    }
  });

  await test('shouldSendAlert: REDUCE → REDUCE within cooldown is suppressed', () => {
    const savedCooldown = process.env.ALERT_COOLDOWN_HOURS;
    try {
      delete process.env.ALERT_COOLDOWN_HOURS;
      const prev: PreviousStates = {
        updatedAt: '',
        portfolio: {
          nvda: { assetId: 'nvda', state: 'REDUCE', lastAlertAt: new Date(Date.now() - 3600 * 1000).toISOString() },
        },
        opportunities: {},
      };
      assert(H.shouldSendAlert('nvda', prev, 'REDUCE') === false, 'REDUCE→REDUCE within cooldown must be suppressed');
    } finally {
      if (savedCooldown === undefined) delete process.env.ALERT_COOLDOWN_HOURS;
      else process.env.ALERT_COOLDOWN_HOURS = savedCooldown;
    }
  });

  await test('shouldSendAlert: REDUCE → REDUCE after cooldown is allowed', () => {
    const savedCooldown = process.env.ALERT_COOLDOWN_HOURS;
    try {
      delete process.env.ALERT_COOLDOWN_HOURS;
      const prev: PreviousStates = {
        updatedAt: '',
        portfolio: {
          nvda: { assetId: 'nvda', state: 'REDUCE', lastAlertAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() },
        },
        opportunities: {},
      };
      // shouldSendAlert allows it; generator still blocks via stateChanged=false
      assert(H.shouldSendAlert('nvda', prev, 'REDUCE') === true, 'REDUCE→REDUCE after cooldown should return true from shouldSendAlert');
    } finally {
      if (savedCooldown === undefined) delete process.env.ALERT_COOLDOWN_HOURS;
      else process.env.ALERT_COOLDOWN_HOURS = savedCooldown;
    }
  });

  await test('createAlert: fills id/timestamp and defaults telegramSent to false', () => {
    const a = H.createAlert({ type: 'daily_digest', message: 'hello' });
    assert(typeof a.id === 'string' && a.id.length > 0, 'id should be a non-empty string');
    assert(!Number.isNaN(Date.parse(a.timestamp)), 'timestamp should be a valid ISO date');
    assert(a.telegramSent === false, 'telegramSent should default to false');
  });

  await test('createAlert: respects explicit telegramSent', () => {
    const a = H.createAlert({ type: 'daily_digest', message: 'hello', telegramSent: true });
    assert(a.telegramSent === true, 'telegramSent should be true when provided');
  });

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
