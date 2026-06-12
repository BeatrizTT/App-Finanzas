// Tests for alert generator — state-change semantics and cooldown bypass.
//
// Key invariant: a defensive transition (e.g. BUY_MORE → REDUCE) must always
// fire an alert even when the previous alert is still within the cooldown window.
// Cooldown only suppresses repetitions of the SAME state.
//
// Also verifies: previous_states preserves "last alerted state" rather than
// "last observed state" — ensuring non-alerted transitions don't silently block
// future alerts.

import type { PortfolioAnalysis, PreviousStates } from '../../types';

const SUITE_DATA_DIR = `/tmp/alert-generator-test-${process.pid}`;
process.env.DATA_DIR = SUITE_DATA_DIR;

type GeneratorModule = typeof import('../generator');
let G: GeneratorModule;

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

function mkAnalysis(id: string, state: import('../../types').PortfolioState): PortfolioAnalysis {
  return {
    holding: {
      id,
      name: id.toUpperCase(),
      ticker: id.toUpperCase(),
      isin: 'XXTEST0001',
      type: 'stock',
      dcaMonthlyEur: 0,
      avgPrice: 100,
      core: true,
      convictionScore: 7,
      tags: [],
      currency: 'USD',
    },
    currentPrice: 90,
    avgPrice: 100,
    unrealizedPnlPct: -10,
    drawdown: { drawdown30d: 10, drawdown60d: 12, drawdown90d: 12, maxDrawdown: 12, primaryWindow: '90d' },
    state,
    suggestedAmountEur: { min: 200, max: 500 },
    reasons: ['test reason'],
    concentrationPenalty: 0,
    confidence: 'medium',
  };
}

const EMPTY_CONCENTRATION = {
  totalPortfolioValue: 10000,
  sectorWeights: {},
  themeWeights: {},
  stockVsEtfRatio: { stocks: 100, etfs: 0 },
  highConcentrationWarnings: [],
};

console.log('\n▶ src/lib/alerts/__tests__/generator.test.ts\n');

async function main(): Promise<void> {
  G = await import('../generator');

  // ── State-change bypasses cooldown ──────────────────────────────────────

  await test('BUY_MORE → REDUCE within 24h fires an alert (bypasses cooldown)', async () => {
    const prev: PreviousStates = {
      updatedAt: '',
      portfolio: {
        nvda: {
          assetId: 'nvda',
          state: 'BUY_MORE',
          lastAlertAt: new Date(Date.now() - 3600 * 1000).toISOString(), // 1h ago
        },
      },
      opportunities: {},
    };
    await withKv({ 'alerts:previous_states': prev, 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REDUCE')],
        [], [], [],
        EMPTY_CONCENTRATION,
        [],
      );
      assert(alerts.length === 1, `expected 1 alert for REDUCE transition, got ${alerts.length}`);
      assert(alerts[0].newState === 'REDUCE', `expected newState REDUCE, got ${String(alerts[0].newState)}`);
      assert(alerts[0].oldState === 'BUY_MORE', `expected oldState BUY_MORE, got ${String(alerts[0].oldState)}`);
    });
  });

  await test('REDUCE → REDUCE within 24h does not fire (same state)', async () => {
    const prev: PreviousStates = {
      updatedAt: '',
      portfolio: {
        nvda: {
          assetId: 'nvda',
          state: 'REDUCE',
          lastAlertAt: new Date(Date.now() - 3600 * 1000).toISOString(), // 1h ago
        },
      },
      opportunities: {},
    };
    await withKv({ 'alerts:previous_states': prev, 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REDUCE')],
        [], [], [],
        EMPTY_CONCENTRATION,
        [],
      );
      assert(alerts.length === 0, `expected 0 alerts for same-state REDUCE, got ${alerts.length}`);
    });
  });

  await test('non-alertable state does not overwrite last-alerted state in previous_states', async () => {
    // BUY_MORE was the last alerted state. Now state = DO_NOTHING (not alertable).
    // previous_states.state must remain BUY_MORE so a future REDUCE is detected as a change.
    const prev: PreviousStates = {
      updatedAt: '',
      portfolio: {
        nvda: {
          assetId: 'nvda',
          state: 'BUY_MORE',
          lastAlertAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        },
      },
      opportunities: {},
    };
    await withKv({ 'alerts:previous_states': prev, 'alerts:history': [] }, async (store) => {
      await G.generateAlerts(
        [mkAnalysis('nvda', 'DO_NOTHING')],
        [], [], [],
        EMPTY_CONCENTRATION,
        [],
      );
      const saved = store['alerts:previous_states'] as PreviousStates;
      assert(
        saved.portfolio['nvda']?.state === 'BUY_MORE',
        `expected last-alerted state BUY_MORE preserved, got ${String(saved.portfolio['nvda']?.state)}`,
      );
    });
  });

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
