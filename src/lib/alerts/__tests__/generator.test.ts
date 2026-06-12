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

function mkAnalysis(
  id: string,
  state: import('../../types').PortfolioState,
  overrides: Partial<Omit<PortfolioAnalysis, 'holding'>> = {},
): PortfolioAnalysis {
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
    ...overrides,
  };
}

function mkPrev(state: import('../../types').PortfolioState, hoursAgo: number): PreviousStates {
  return {
    updatedAt: '',
    portfolio: {
      nvda: {
        assetId: 'nvda',
        state,
        lastAlertAt: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString(),
      },
    },
    opportunities: {},
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

  // ── P1-4b: REDUCE reminder window ────────────────────────────────────────

  await test('REDUCE → REDUCE at 2 days does not fire (within 3-day reminder window)', async () => {
    const saved = process.env.ALERT_REDUCE_REMINDER_DAYS;
    try {
      delete process.env.ALERT_REDUCE_REMINDER_DAYS; // default 3
      await withKv({ 'alerts:previous_states': mkPrev('REDUCE', 48), 'alerts:history': [] }, async () => {
        const alerts = await G.generateAlerts(
          [mkAnalysis('nvda', 'REDUCE')], [], [], [], EMPTY_CONCENTRATION, [],
        );
        assert(alerts.length === 0, `expected 0 alerts at 2 days, got ${alerts.length}`);
      });
    } finally {
      if (saved === undefined) delete process.env.ALERT_REDUCE_REMINDER_DAYS;
      else process.env.ALERT_REDUCE_REMINDER_DAYS = saved;
    }
  });

  await test('REDUCE → REDUCE at 4 days fires a reminder with 🔁 prefix', async () => {
    const saved = process.env.ALERT_REDUCE_REMINDER_DAYS;
    try {
      delete process.env.ALERT_REDUCE_REMINDER_DAYS;
      await withKv({ 'alerts:previous_states': mkPrev('REDUCE', 96), 'alerts:history': [] }, async (store) => {
        const alerts = await G.generateAlerts(
          [mkAnalysis('nvda', 'REDUCE')], [], [], [], EMPTY_CONCENTRATION, [],
        );
        assert(alerts.length === 1, `expected 1 reminder alert at 4 days, got ${alerts.length}`);
        assert(alerts[0].message.includes('🔁'), 'reminder must carry the 🔁 prefix');
        assert(alerts[0].message.includes('Recordatorio'), 'reminder must say Recordatorio');
        // Reminder resets the clock: lastAlertAt must be refreshed for the next 3-day window.
        const savedStates = store['alerts:previous_states'] as PreviousStates;
        const entry = savedStates.portfolio['nvda'];
        assert(entry?.state === 'REDUCE', 'state stays REDUCE after reminder');
        const hoursSince = (Date.now() - new Date(entry!.lastAlertAt!).getTime()) / 3600000;
        assert(hoursSince < 1, 'lastAlertAt must be refreshed when the reminder fires');
      });
    } finally {
      if (saved === undefined) delete process.env.ALERT_REDUCE_REMINDER_DAYS;
      else process.env.ALERT_REDUCE_REMINDER_DAYS = saved;
    }
  });

  await test('REDUCE → REDUCE with ALERT_REDUCE_REMINDER_DAYS=0: no reminder ever', async () => {
    const saved = process.env.ALERT_REDUCE_REMINDER_DAYS;
    try {
      process.env.ALERT_REDUCE_REMINDER_DAYS = '0';
      await withKv({ 'alerts:previous_states': mkPrev('REDUCE', 240), 'alerts:history': [] }, async () => {
        const alerts = await G.generateAlerts(
          [mkAnalysis('nvda', 'REDUCE')], [], [], [], EMPTY_CONCENTRATION, [],
        );
        assert(alerts.length === 0, `reminders disabled → expected 0 alerts after 10 days, got ${alerts.length}`);
      });
    } finally {
      if (saved === undefined) delete process.env.ALERT_REDUCE_REMINDER_DAYS;
      else process.env.ALERT_REDUCE_REMINDER_DAYS = saved;
    }
  });

  await test('REVIEW → REVIEW does not re-alert (no reminder for REVIEW in P1-4b)', async () => {
    await withKv({ 'alerts:previous_states': mkPrev('REVIEW', 96), 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REVIEW')], [], [], [], EMPTY_CONCENTRATION, [],
      );
      assert(alerts.length === 0, `expected 0 alerts for persistent REVIEW, got ${alerts.length}`);
    });
  });

  // ── P1-4b: defensive copy ────────────────────────────────────────────────

  await test('REDUCE template: no buy copy ("añadir"), suggestive sell guidance', async () => {
    await withKv({ 'alerts:previous_states': mkPrev('DO_NOTHING', 96), 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REDUCE', {
          unrealizedPnlPct: 73,
          reasons: ['Ganancia en papel de +73% — cerca de máximos. Considera vender un 20-30% para asegurar beneficios y liberar capital'],
          suggestedAmountEur: { min: 1200, max: 1500 },
        })], [], [], [], EMPTY_CONCENTRATION, [],
      );
      assert(alerts.length === 1, `expected 1 REDUCE alert, got ${alerts.length}`);
      const msg = alerts[0].message;
      assert(!msg.includes('añadir'), 'REDUCE message must never contain buy copy ("añadir")');
      assert(msg.includes('🟡'), 'REDUCE message uses 🟡 (action, not panic)');
      assert(msg.includes('reducir'), 'REDUCE message mentions reducir');
      assert(msg.includes('podrías vender un 20-25%'), 'sell guidance is suggestive, not imperative');
      assert(msg.includes('€1200–€1500'), 'sell amounts come from suggestedAmountEur');
      assert(msg.includes('no significa vender todo'), 'must clarify partial reduction');
      assert(msg.includes('Antes era: DO_NOTHING'), 'transition shows previous state');
    });
  });

  await test('REDUCE template: engine sell-guidance reason is not duplicated in Por qué', async () => {
    await withKv({ 'alerts:previous_states': mkPrev('DO_NOTHING', 96), 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REDUCE', {
          reasons: [
            'Has superado tu precio objetivo (+40% de ganancia). Es un buen momento para vender una parte y asegurar beneficios.',
            'Vende el 20-25% ahora = aprox. €1200–€1500. El resto: el motor te avisará si toca reducir de nuevo. También puedes poner un stop-loss del 10% desde el precio actual para proteger ganancias.',
          ],
        })], [], [], [], EMPTY_CONCENTRATION, [],
      );
      assert(alerts.length === 1, `expected 1 alert, got ${alerts.length}`);
      const msg = alerts[0].message;
      assert(msg.includes('precio objetivo'), 'cause reason (target price) is shown');
      assert(!msg.includes('Vende el 20-25% ahora'), 'imperative engine sell line is replaced by the softer template action line');
    });
  });

  await test('REVIEW template: deep drawdown (>35%) uses urgent copy with caída', async () => {
    await withKv({ 'alerts:previous_states': mkPrev('BUY_PARTIAL', 96), 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REVIEW', {
          drawdown: { drawdown30d: 20, drawdown60d: 30, drawdown90d: 38.2, maxDrawdown: 38.2, primaryWindow: '90d' },
          reasons: ['Bajó un 38.2% desde el máximo de 90 días'],
        })], [], [], [], EMPTY_CONCENTRATION, [],
      );
      assert(alerts.length === 1, `expected 1 REVIEW alert, got ${alerts.length}`);
      const msg = alerts[0].message;
      assert(msg.includes('Caída fuerte'), 'deep-drop REVIEW headline is urgent');
      assert(msg.includes('38.2%'), 'shows the drawdown percentage');
      assert(msg.includes('revisa') || msg.includes('Revisa'), 'tells the user to review');
      assert(msg.includes('no compres más todavía'), 'explicit: do not buy more yet');
      assert(msg.includes('no significa vender automáticamente'), 'explicit: not an automatic sell');
    });
  });

  await test('REVIEW template: thesis risk (no deep drop) uses preventive copy with tesis', async () => {
    await withKv({ 'alerts:previous_states': mkPrev('DO_NOTHING', 96), 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REVIEW', {
          reasons: ['Riesgo en tesis de inversión: media', 'Revisa tu tesis antes de añadir más'],
        })], [], [], [], EMPTY_CONCENTRATION, [],
      );
      assert(alerts.length === 1, `expected 1 REVIEW alert, got ${alerts.length}`);
      const msg = alerts[0].message;
      assert(msg.includes('tesis'), 'preventive REVIEW mentions tesis');
      assert(msg.includes('No es urgente'), 'preventive tone, not alarmist');
      assert(!msg.includes('Caída fuerte'), 'no urgent headline without deep drawdown');
    });
  });

  // ── P1-4b: data-quality guards ───────────────────────────────────────────

  await test('priceError: no defensive alert is generated', async () => {
    await withKv({ 'alerts:previous_states': mkPrev('BUY_MORE', 1), 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REDUCE', { priceError: 'No price data for NVDA', currentPrice: null, unrealizedPnlPct: null })],
        [], [], [], EMPTY_CONCENTRATION, [],
      );
      assert(alerts.length === 0, `expected 0 alerts with priceError, got ${alerts.length}`);
    });
  });

  await test('currentPrice null (no priceError): defensive alert without misleading figures', async () => {
    await withKv({ 'alerts:previous_states': mkPrev('DO_NOTHING', 96), 'alerts:history': [] }, async () => {
      const alerts = await G.generateAlerts(
        [mkAnalysis('nvda', 'REDUCE', {
          currentPrice: null,
          unrealizedPnlPct: null,
          reasons: ['Concentración elevada en semis — reducir esta posición equilibra la cartera'],
          suggestedAmountEur: { min: 0, max: 0 },
        })], [], [], [], EMPTY_CONCENTRATION, [],
      );
      assert(alerts.length === 1, `expected 1 concentration-driven REDUCE alert, got ${alerts.length}`);
      const msg = alerts[0].message;
      assert(!msg.includes('€'), 'no EUR figures when price is unconfirmed');
      assert(msg.includes('Sin precio EUR confirmado'), 'explains why no figures are shown');
      assert(msg.includes('reducir'), 'still gives the defensive guidance');
    });
  });

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
