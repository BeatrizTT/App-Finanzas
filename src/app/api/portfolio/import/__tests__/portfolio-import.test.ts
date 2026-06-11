// Tests for POST /api/portfolio/import
// Covers: pure builder (preserves manual fields, computes closed positions)
//         + wiring (route saves to KV → saved:true, saveSource:kv)

import { buildUpdatedPortfolioConfig, findUnknownIsins, POST } from '../route';
import type { PortfolioConfig } from '@/lib/types';
import type { ComputedHolding } from '@/lib/portfolio/csv-importer';

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

// ── Fixtures ──────────────────────────────────────────────────────────────

const baseConfig: PortfolioConfig = {
  cashAvailableEur: 5000,
  targetCashReserveEur: 1000,
  holdings: [
    {
      id: 'nvda', ticker: 'NVDA', isin: 'US67066G1040',
      name: 'NVIDIA', type: 'stock',
      avgPrice: 85, units: 10,
      currency: 'USD',
      convictionScore: 9,
      dcaMonthlyEur: 200,
      core: true,
      tags: ['semis', 'AI'],
      maxWeightPercent: 15,
      noBuyOverride: false,
      manualThesisRisk: 'low',
    } as any,
  ],
};

const computedNvda: ComputedHolding = {
  isin: 'US67066G1040',
  name: 'NVIDIA Corp',
  assetClass: 'STOCK',
  shares: 12,
  totalCostEur: 1200,
  avgCostEur: 100,
  realizedPnl: 0,
};

const computedNew: ComputedHolding = {
  isin: 'US5949181045', // MSFT
  name: 'Microsoft',
  assetClass: 'STOCK',
  shares: 5,
  totalCostEur: 2000,
  avgCostEur: 400,
  realizedPnl: 0,
};

const closedCrm: ComputedHolding = {
  isin: 'US79466L3024',
  name: 'Salesforce',
  assetClass: 'STOCK',
  shares: 0,
  totalCostEur: 0,
  avgCostEur: 0,
  realizedPnl: 350.75,
};

console.log('\n▶ src/app/api/portfolio/import/__tests__/portfolio-import.test.ts\n');

// ── Pure function: buildUpdatedPortfolioConfig ─────────────────────────────

async function main(): Promise<void> {
  await test('preserves manual fields from existing config (convictionScore, dcaMonthlyEur, core, etc.)', () => {
    const result = buildUpdatedPortfolioConfig(baseConfig, [computedNvda], []);
    const nvda = result.holdings.find(h => h.isin === 'US67066G1040');
    assert(nvda !== undefined, 'NVDA holding should exist');
    assert((nvda as any).convictionScore === 9, 'convictionScore preserved');
    assert((nvda as any).dcaMonthlyEur === 200, 'dcaMonthlyEur preserved');
    assert((nvda as any).core === true, 'core preserved');
    assert((nvda as any).noBuyOverride === false, 'noBuyOverride preserved');
    assert((nvda as any).manualThesisRisk === 'low', 'manualThesisRisk preserved');
  });

  await test('updates avgPrice and units from CSV, keeps manual id', () => {
    const result = buildUpdatedPortfolioConfig(baseConfig, [computedNvda], []);
    const nvda = result.holdings.find(h => h.isin === 'US67066G1040');
    assert(nvda?.avgPrice === 100, `avgPrice should be 100, got ${nvda?.avgPrice}`);
    assert(nvda?.units === 12, `units should be 12, got ${nvda?.units}`);
    assert(nvda?.id === 'nvda', 'id preserved from existing config');
  });

  await test('new holding gets defaults when not in existing config', () => {
    const result = buildUpdatedPortfolioConfig(baseConfig, [computedNew], []);
    const msft = result.holdings.find(h => h.isin === 'US5949181045');
    assert(msft !== undefined, 'MSFT holding should exist');
    assert(msft?.ticker === 'MSFT', 'ticker from ISIN_TO_TICKER map');
    assert((msft as any).convictionScore === 7, 'default convictionScore 7');
    assert((msft as any).core === false, 'default core false');
    assert((msft as any).dcaMonthlyEur === 0, 'default dcaMonthlyEur 0');
  });

  await test('closed positions computed correctly with realizedPnl', () => {
    const result = buildUpdatedPortfolioConfig(baseConfig, [], [closedCrm]);
    assert(result.closedPositions?.length === 1, 'should have 1 closed position');
    const closed = result.closedPositions![0];
    assert(closed.isin === 'US79466L3024', 'correct ISIN');
    assert(closed.ticker === 'CRM', 'ticker resolved from ISIN');
    assert(result.totalRealizedPnl === 350.75, `totalRealizedPnl should be 350.75, got ${result.totalRealizedPnl}`);
  });

  await test('multiple closed positions: totalRealizedPnl sums and rounds', () => {
    const closed2: ComputedHolding = { ...closedCrm, isin: 'US5951121038', realizedPnl: 99.257 };
    const result = buildUpdatedPortfolioConfig(baseConfig, [], [closedCrm, closed2]);
    assert(
      result.totalRealizedPnl === 450.01,
      `expected 450.01, got ${result.totalRealizedPnl}`
    );
  });

  await test('preserves cashAvailableEur and targetCashReserveEur from existing config', () => {
    const result = buildUpdatedPortfolioConfig(baseConfig, [computedNvda], []);
    assert(result.cashAvailableEur === 5000, 'cashAvailableEur preserved');
    assert(result.targetCashReserveEur === 1000, 'targetCashReserveEur preserved');
  });

  // ── ISIN mapping: US46120E6023 → ISRG (Intuitive Surgical) ──────────────

  await test('US46120E6023 maps to ISRG (Intuitive Surgical)', () => {
    const computedIsrg: ComputedHolding = {
      isin: 'US46120E6023',
      name: 'Intuitive Surgical',
      assetClass: 'STOCK',
      shares: 2,
      totalCostEur: 800,
      avgCostEur: 400,
      realizedPnl: 0,
    };
    const result = buildUpdatedPortfolioConfig(baseConfig, [computedIsrg], []);
    const isrg = result.holdings.find(h => h.isin === 'US46120E6023');
    assert(isrg !== undefined, 'ISRG holding should exist');
    assert(isrg?.ticker === 'ISRG', `ticker should be ISRG, got ${isrg?.ticker}`);
    assert(isrg?.id === 'isrg', `id should be isrg, got ${isrg?.id}`);
    assert((isrg as any).currency === 'USD', 'currency should be USD');
    assert((isrg as any).type === 'stock', 'type should be stock');
  });

  // ── Unknown ISIN detection (findUnknownIsins) ────────────────────────────

  await test('findUnknownIsins flags ISINs with no ticker mapping', () => {
    const unknown: ComputedHolding = {
      isin: 'XX0000000000',
      name: 'Mystery Corp',
      assetClass: 'STOCK',
      shares: 1,
      totalCostEur: 100,
      avgCostEur: 100,
      realizedPnl: 0,
    };
    const result = findUnknownIsins(baseConfig, [unknown, computedNvda]);
    assert(result.length === 1, `expected 1 unknown ISIN, got ${result.length}`);
    assert(result[0].isin === 'XX0000000000', 'unknown ISIN identified');
    assert(result[0].name === 'Mystery Corp', 'name carried through');
  });

  await test('findUnknownIsins does not flag mapped or already-tickered ISINs', () => {
    // NVDA: in ISIN_TO_TICKER. ISRG: now in ISIN_TO_TICKER.
    const computedIsrg: ComputedHolding = {
      isin: 'US46120E6023', name: 'Intuitive Surgical', assetClass: 'STOCK',
      shares: 2, totalCostEur: 800, avgCostEur: 400, realizedPnl: 0,
    };
    // Existing config holding with manual ticker but ISIN not in the map
    const configWithManualTicker: PortfolioConfig = {
      ...baseConfig,
      holdings: [
        ...baseConfig.holdings,
        { id: 'cust', ticker: 'CUST', isin: 'ZZ9999999999', name: 'Custom', type: 'stock', avgPrice: 1, units: 1 } as any,
      ],
    };
    const computedCustom: ComputedHolding = {
      isin: 'ZZ9999999999', name: 'Custom', assetClass: 'STOCK',
      shares: 1, totalCostEur: 1, avgCostEur: 1, realizedPnl: 0,
    };
    const result = findUnknownIsins(configWithManualTicker, [computedNvda, computedIsrg, computedCustom]);
    assert(result.length === 0, `expected 0 unknown ISINs, got ${result.length}: ${JSON.stringify(result)}`);
  });

  await test('unknown ISIN holding enters config without ticker (documented behavior)', () => {
    const unknown: ComputedHolding = {
      isin: 'XX0000000000', name: 'Mystery Corp', assetClass: 'STOCK',
      shares: 1, totalCostEur: 100, avgCostEur: 100, realizedPnl: 0,
    };
    const result = buildUpdatedPortfolioConfig(baseConfig, [unknown], []);
    const h = result.holdings.find(x => x.isin === 'XX0000000000');
    assert(h !== undefined, 'holding should still be imported (P&L valid)');
    assert(h?.ticker === undefined, 'ticker stays undefined — must be surfaced via findUnknownIsins');
    assert(h?.id === 'xx0000000000', 'id falls back to lowercase ISIN');
  });

  // ── Wiring: POST handler saves to KV → saved:true, saveSource:kv ────────

  await test('POST with KV configured returns saved:true and saveSource:kv', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    try {
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';

      const stored: Record<string, unknown> = {};

      // KV mock: GET portfolio:config → null (no existing KV config, use committed file)
      //          SET portfolio:config → OK
      global.fetch = async (_url, init) => {
        const cmd = JSON.parse((init?.body as string) ?? '[]') as string[];
        const method = cmd[0];
        const key = cmd[1];
        if (method === 'SET') {
          stored[key] = JSON.parse(cmd[2]);
          return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // GET — return null for all keys so loadPortfolioConfig falls back to file
        return new Response(JSON.stringify({ result: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      // Minimal valid Trade Republic CSV (two BUY rows produce one open holding)
      const csvContent = [
        'type,asset_class,name,symbol,shares,amount,fee',
        'BUY,STOCK,NVIDIA Corp,US67066G1040,10,-850,0',
        'BUY,STOCK,NVIDIA Corp,US67066G1040,2,-200,0',
      ].join('\n');

      const formData = new FormData();
      formData.append('csv', new File([csvContent], 'trades.csv', { type: 'text/csv' }));

      const { NextRequest } = await import('next/server');
      const req = new NextRequest('http://localhost/api/portfolio/import', {
        method: 'POST',
        body: formData,
      });

      const response = await POST(req);
      const body = await response.json();

      assert(body.success === true, `expected success:true, got ${body.success}`);
      assert(body.saved === true, `expected saved:true, got ${body.saved} (is KV SET being called?)`);
      assert(body.saveSource === 'kv', `expected saveSource:kv, got ${body.saveSource}`);
      assert(body.holdingsUpdated === 1, `expected 1 holding, got ${body.holdingsUpdated}`);
      assert(
        stored['portfolio:config'] !== undefined,
        'portfolio:config should have been SET in KV'
      );
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('POST surfaces unknown ISINs in response (unknownIsins + warnings)', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    try {
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';

      global.fetch = async (_url, init) => {
        const cmd = JSON.parse((init?.body as string) ?? '[]') as string[];
        if (cmd[0] === 'SET') {
          return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ result: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const csvContent = [
        'type,asset_class,name,symbol,shares,amount,fee',
        'BUY,STOCK,NVIDIA Corp,US67066G1040,10,-850,0',
        'BUY,STOCK,Mystery Corp,XX0000000000,3,-300,0',
      ].join('\n');

      const formData = new FormData();
      formData.append('csv', new File([csvContent], 'trades.csv', { type: 'text/csv' }));

      const { NextRequest } = await import('next/server');
      const req = new NextRequest('http://localhost/api/portfolio/import', {
        method: 'POST',
        body: formData,
      });

      const response = await POST(req);
      const body = await response.json();

      assert(body.success === true, 'import should still succeed');
      assert(Array.isArray(body.unknownIsins), 'unknownIsins should be an array');
      assert(body.unknownIsins.length === 1, `expected 1 unknown ISIN, got ${body.unknownIsins.length}`);
      assert(body.unknownIsins[0].isin === 'XX0000000000', 'unknown ISIN reported');
      assert(Array.isArray(body.warnings) && body.warnings.length === 1, 'warnings array populated');
      assert(body.warnings[0].includes('XX0000000000'), 'warning mentions the ISIN');
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('POST without KV returns saved:false without crashing', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const savedDataDir = process.env.DATA_DIR;
    try {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      // Restrict fs so local file write also fails
      process.env.DATA_DIR = '/tmp/nonexistent-import-test-dir';

      const csvContent = [
        'type,asset_class,name,symbol,shares,amount,fee',
        'BUY,STOCK,NVIDIA Corp,US67066G1040,5,-500,0',
      ].join('\n');

      const formData = new FormData();
      formData.append('csv', new File([csvContent], 'trades.csv', { type: 'text/csv' }));

      const { NextRequest } = await import('next/server');
      const req = new NextRequest('http://localhost/api/portfolio/import', {
        method: 'POST',
        body: formData,
      });

      const response = await POST(req);
      const body = await response.json();

      assert(body.success === true, 'should still parse CSV successfully');
      assert(body.saved === false, `expected saved:false without KV, got ${body.saved}`);
      assert(body.holdingsUpdated >= 1, 'should still report parsed holdings');
    } finally {
      if (savedUrl !== undefined) process.env.KV_REST_API_URL = savedUrl;
      if (savedToken !== undefined) process.env.KV_REST_API_TOKEN = savedToken;
      if (savedDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = savedDataDir;
    }
  });

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
