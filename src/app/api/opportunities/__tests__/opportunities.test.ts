// Tests for GET /api/opportunities
// Covers: pure response builder + wiring (handler reads from KV via loadEngineOutput)

import { buildOpportunitiesResponse, GET } from '../route';
import type { DailyEngineOutput } from '@/lib/types';

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

function makeOutput(overrides: Partial<DailyEngineOutput> = {}): DailyEngineOutput {
  return {
    runAt: '2024-01-15T08:00:00.000Z',
    marketRegime: 'neutral',
    portfolioAnalyses: [],
    concentration: {
      totalPortfolioValue: 0,
      sectorWeights: {},
      themeWeights: {},
      stockVsEtfRatio: { stocks: 0, etfs: 0 },
      highConcentrationWarnings: [],
    },
    stockOpportunities: [],
    etfOpportunities: [],
    discoveredOpportunities: [],
    allocationRecommendations: [],
    alertsGenerated: [],
    errors: [],
    ...overrides,
  };
}

console.log('\n▶ src/app/api/opportunities/__tests__/opportunities.test.ts\n');

async function main(): Promise<void> {
  // ── Pure function tests ────────────────────────────────────────────────

  await test('null output → empty arrays + message', () => {
    const r = buildOpportunitiesResponse(null);
    assert(r.stocks.length === 0, 'stocks should be empty');
    assert(r.etfs.length === 0, 'etfs should be empty');
    assert(r.discovered.length === 0, 'discovered should be empty');
    assert(r.lastRunAt === null, 'lastRunAt should be null');
    assert('message' in r, 'should include message');
  });

  await test('output without runAt → treated as empty', () => {
    const r = buildOpportunitiesResponse({ ...makeOutput(), runAt: '' });
    assert(r.stocks.length === 0, 'stocks should be empty');
    assert(r.lastRunAt === null, 'lastRunAt should be null');
  });

  await test('complete output → fields mapped correctly', () => {
    const output = makeOutput({
      stockOpportunities: [{ ticker: 'AAPL' } as any],
      etfOpportunities: [{ ticker: 'IWDA' } as any],
      discoveredOpportunities: [{ ticker: 'NVDA' } as any],
      runAt: '2024-06-01T10:00:00.000Z',
    });
    const r = buildOpportunitiesResponse(output);
    assert(r.stocks.length === 1 && (r.stocks[0] as any).ticker === 'AAPL', 'stocks mapped');
    assert(r.etfs.length === 1 && (r.etfs[0] as any).ticker === 'IWDA', 'etfs mapped');
    assert(r.discovered.length === 1 && (r.discovered[0] as any).ticker === 'NVDA', 'discovered mapped');
    assert(r.lastRunAt === '2024-06-01T10:00:00.000Z', 'lastRunAt mapped');
    assert(!('message' in r), 'should not include message when data present');
  });

  await test('output with missing optional arrays → defaults to []', () => {
    const output = makeOutput({
      stockOpportunities: undefined as any,
      etfOpportunities: undefined as any,
      discoveredOpportunities: undefined as any,
    });
    const r = buildOpportunitiesResponse(output);
    assert(Array.isArray(r.stocks), 'stocks defaults to array');
    assert(Array.isArray(r.etfs), 'etfs defaults to array');
    assert(Array.isArray(r.discovered), 'discovered defaults to array');
  });

  // ── Wiring tests: GET handler reads from KV via loadEngineOutput ───────
  //
  // Strategy: set KV env vars + mock global.fetch to return a simulated Upstash
  // response. If the handler returns the mocked ticker, the route is calling
  // loadEngineOutput() (KV-aware) — not readJsonFile().

  await test('GET handler reads from KV when KV is configured (wiring)', async () => {
    const originalFetch = global.fetch;
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;

    try {
      const kvOutput = makeOutput({
        stockOpportunities: [{ ticker: 'KV_WIRING_SENTINEL' } as any],
        runAt: '2024-06-04T07:00:00.000Z',
      });

      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';

      // Upstash REST GET returns { result: "<serialised json>" }
      global.fetch = async () =>
        new Response(JSON.stringify({ result: JSON.stringify(kvOutput) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      const response = await GET();
      const body = await response.json();

      assert(
        Array.isArray(body.stocks) && body.stocks.length === 1,
        `expected 1 stock, got ${body.stocks?.length}`
      );
      assert(
        body.stocks[0].ticker === 'KV_WIRING_SENTINEL',
        `expected KV_WIRING_SENTINEL, got ${body.stocks[0]?.ticker}`
      );
      assert(
        body.lastRunAt === '2024-06-04T07:00:00.000Z',
        `expected KV runAt, got ${body.lastRunAt}`
      );
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('GET handler returns empty response when KV has no data and file-store is empty', async () => {
    const originalFetch = global.fetch;
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const savedDataDir = process.env.DATA_DIR;

    try {
      // KV returns null (key doesn't exist yet)
      global.fetch = async () =>
        new Response(JSON.stringify({ result: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';
      // Point DATA_DIR away from real data to ensure file-store has nothing
      process.env.DATA_DIR = '/tmp/nonexistent-app-finanzas-test-dir';

      const response = await GET();
      const body = await response.json();

      assert(Array.isArray(body.stocks) && body.stocks.length === 0, 'stocks empty');
      assert(Array.isArray(body.etfs) && body.etfs.length === 0, 'etfs empty');
      assert(body.lastRunAt === null, 'lastRunAt null');
      assert(typeof body.message === 'string', 'message present');
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
      if (savedDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = savedDataDir;
    }
  });

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
