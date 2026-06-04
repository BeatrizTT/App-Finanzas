// Tests for GET /api/portfolio
// Covers: pure response builder + wiring (handler reads from KV via loadEngineOutput)

import { buildPortfolioResponse, GET } from '../route';
import type { DailyEngineOutput, PortfolioConfig } from '@/lib/types';

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

const minimalConfig: PortfolioConfig = {
  holdings: [],
  cashAvailableEur: 5000,
  targetCashReserveEur: 1000,
};

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

console.log('\n▶ src/app/api/portfolio/__tests__/portfolio.test.ts\n');

async function main(): Promise<void> {
  // ── Pure function tests ────────────────────────────────────────────────

  await test('null output → empty analyses, null concentration, null lastRunAt', () => {
    const r = buildPortfolioResponse(minimalConfig, null);
    assert(r.config === minimalConfig, 'config passed through');
    assert(Array.isArray(r.analyses) && r.analyses.length === 0, 'analyses empty');
    assert(r.concentration === null, 'concentration null');
    assert(r.lastRunAt === null, 'lastRunAt null');
  });

  await test('complete output → analyses and concentration mapped correctly', () => {
    const mockAnalysis = { holding: { id: 'AAPL' } } as any;
    const mockConcentration = {
      totalPortfolioValue: 50000,
      sectorWeights: { tech: 0.8 },
      themeWeights: {},
      stockVsEtfRatio: { stocks: 0.9, etfs: 0.1 },
      highConcentrationWarnings: ['tech > 75%'],
    };
    const output = makeOutput({
      portfolioAnalyses: [mockAnalysis],
      concentration: mockConcentration,
      runAt: '2024-06-01T10:00:00.000Z',
    });
    const r = buildPortfolioResponse(minimalConfig, output);
    assert(r.analyses.length === 1, 'analyses mapped');
    assert(r.concentration?.totalPortfolioValue === 50000, 'concentration mapped');
    assert(r.lastRunAt === '2024-06-01T10:00:00.000Z', 'lastRunAt mapped');
  });

  await test('config is passed through unchanged', () => {
    const config: PortfolioConfig = {
      holdings: [{ id: 'NVDA' } as any],
      cashAvailableEur: 16000,
      targetCashReserveEur: 2000,
    };
    const r = buildPortfolioResponse(config, null);
    assert(r.config.cashAvailableEur === 16000, 'cashAvailableEur passed through');
    assert(r.config.holdings.length === 1, 'holdings passed through');
  });

  await test('output with missing portfolioAnalyses → defaults to []', () => {
    const output = makeOutput({ portfolioAnalyses: undefined as any });
    const r = buildPortfolioResponse(minimalConfig, output);
    assert(Array.isArray(r.analyses), 'analyses defaults to array');
  });

  // ── Wiring tests: GET handler reads from KV via loadEngineOutput ───────

  await test('GET handler reads analyses from KV when KV is configured (wiring)', async () => {
    const originalFetch = global.fetch;
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;

    try {
      const kvOutput = makeOutput({
        portfolioAnalyses: [{ holding: { id: 'KV_PORTFOLIO_SENTINEL' } } as any],
        concentration: {
          totalPortfolioValue: 99999,
          sectorWeights: {},
          themeWeights: {},
          stockVsEtfRatio: { stocks: 1, etfs: 0 },
          highConcentrationWarnings: [],
        },
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
        Array.isArray(body.analyses) && body.analyses.length === 1,
        `expected 1 analysis, got ${body.analyses?.length}`
      );
      assert(
        body.analyses[0].holding?.id === 'KV_PORTFOLIO_SENTINEL',
        `expected KV_PORTFOLIO_SENTINEL, got ${body.analyses[0]?.holding?.id}`
      );
      assert(
        body.concentration?.totalPortfolioValue === 99999,
        `expected 99999, got ${body.concentration?.totalPortfolioValue}`
      );
      assert(
        body.lastRunAt === '2024-06-04T07:00:00.000Z',
        `expected KV runAt, got ${body.lastRunAt}`
      );
      // config always comes from committed portfolio.json regardless of KV state
      assert(body.config !== null && body.config !== undefined, 'config present');
      assert(typeof body.config.cashAvailableEur === 'number', 'config has cashAvailableEur');
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('GET handler returns empty analyses when KV has no data and file-store is empty', async () => {
    const originalFetch = global.fetch;
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const savedDataDir = process.env.DATA_DIR;

    try {
      global.fetch = async () =>
        new Response(JSON.stringify({ result: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';
      process.env.DATA_DIR = '/tmp/nonexistent-app-finanzas-test-dir';

      const response = await GET();
      const body = await response.json();

      assert(Array.isArray(body.analyses) && body.analyses.length === 0, 'analyses empty');
      assert(body.concentration === null, 'concentration null');
      assert(body.lastRunAt === null, 'lastRunAt null');
      // config always present from committed portfolio.json
      assert(body.config !== null, 'config always present');
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
