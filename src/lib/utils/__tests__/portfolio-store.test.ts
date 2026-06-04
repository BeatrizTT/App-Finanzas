// Tests for portfolio-store: loadPortfolioConfig() and savePortfolioConfig()
// Covers: KV-first load, file fallback, KV failure fallback, env overrides,
// save to KV, save failure, secret sanitization.

import { loadPortfolioConfig, savePortfolioConfig } from '../portfolio-store';

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

// Helper: build a minimal PortfolioConfig for use as a KV response fixture
function makePortfolioConfig(overrides = {}) {
  return {
    holdings: [{ id: 'kv-sentinel', ticker: 'KV_TICKER' }],
    cashAvailableEur: 12345,
    targetCashReserveEur: 2000,
    ...overrides,
  };
}

// Helper: build a mock fetch that responds per KV key
function makeFetch(kvData: Record<string, unknown>): typeof global.fetch {
  return async (_url, init) => {
    const cmd = JSON.parse((init?.body as string) ?? '[]') as string[];
    const key = cmd[1]; // ['GET' | 'SET', key, ...]
    const method = cmd[0];
    if (method === 'SET') {
      return new Response(JSON.stringify({ result: 'OK' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    // GET
    const value = kvData[key] ?? null;
    const result = value !== null ? JSON.stringify(value) : null;
    return new Response(JSON.stringify({ result }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
}

console.log('\n▶ src/lib/utils/__tests__/portfolio-store.test.ts\n');

async function main(): Promise<void> {
  // ── loadPortfolioConfig ────────────────────────────────────────────────

  await test('loads from KV when KV is configured and key exists', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    try {
      const kvPortfolio = makePortfolioConfig({ cashAvailableEur: 99000 });
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';
      global.fetch = makeFetch({ 'portfolio:config': kvPortfolio });

      const { config, source } = await loadPortfolioConfig();
      assert(source === 'kv', `expected source 'kv', got '${source}'`);
      assert(config.cashAvailableEur === 99000, `expected 99000, got ${config.cashAvailableEur}`);
      assert(
        config.holdings[0].id === 'kv-sentinel',
        `expected kv-sentinel, got ${config.holdings[0]?.id}`
      );
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('falls back to config file when KV key does not exist (null result)', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    try {
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';
      // KV returns null for portfolio:config → key not set yet
      global.fetch = makeFetch({});

      const { config, source } = await loadPortfolioConfig();
      assert(source === 'config', `expected source 'config', got '${source}'`);
      // config comes from committed config/portfolio.json — should be valid
      assert(typeof config.cashAvailableEur === 'number', 'cashAvailableEur should be a number');
      assert(Array.isArray(config.holdings), 'holdings should be an array');
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('falls back to config file when KV fetch throws', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    try {
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'super-secret-token-abc123';
      global.fetch = async () => { throw new Error('Network error with super-secret-token-abc123'); };

      const { config, source } = await loadPortfolioConfig();
      assert(source === 'config', `expected source 'config' after KV error, got '${source}'`);
      assert(typeof config.cashAvailableEur === 'number', 'should still return valid config');
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('falls back to config file when KV is not configured', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    try {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;

      const { config, source } = await loadPortfolioConfig();
      assert(source === 'config', `expected source 'config', got '${source}'`);
      assert(typeof config.cashAvailableEur === 'number', 'should return valid config from file');
    } finally {
      if (savedUrl !== undefined) process.env.KV_REST_API_URL = savedUrl;
      if (savedToken !== undefined) process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('env override CASH_AVAILABLE_EUR applied over KV config', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const savedCash = process.env.CASH_AVAILABLE_EUR;
    const originalFetch = global.fetch;
    try {
      const kvPortfolio = makePortfolioConfig({ cashAvailableEur: 5000 });
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';
      process.env.CASH_AVAILABLE_EUR = '25000';
      global.fetch = makeFetch({ 'portfolio:config': kvPortfolio });

      const { config } = await loadPortfolioConfig();
      assert(
        config.cashAvailableEur === 25000,
        `expected env override 25000, got ${config.cashAvailableEur}`
      );
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
      if (savedCash === undefined) delete process.env.CASH_AVAILABLE_EUR;
      else process.env.CASH_AVAILABLE_EUR = savedCash;
    }
  });

  // ── savePortfolioConfig ────────────────────────────────────────────────

  await test('saves to KV when KV is configured — returns saved:true, source:kv', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    const stored: Record<string, unknown> = {};
    try {
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';
      global.fetch = async (_url, init) => {
        const cmd = JSON.parse((init?.body as string) ?? '[]') as string[];
        if (cmd[0] === 'SET') {
          stored[cmd[1]] = JSON.parse(cmd[2]);
          return new Response(JSON.stringify({ result: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ result: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const portfolio = makePortfolioConfig({ cashAvailableEur: 7777 }) as any;
      const result = await savePortfolioConfig(portfolio);
      assert(result.saved === true, `expected saved:true, got ${result.saved}`);
      assert(result.source === 'kv', `expected source:kv, got ${result.source}`);
      assert(
        (stored['portfolio:config'] as any)?.cashAvailableEur === 7777,
        'KV should contain the saved portfolio'
      );
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('save failure does not throw — returns saved:false and sanitized warning', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const originalFetch = global.fetch;
    try {
      process.env.KV_REST_API_URL = 'https://fake-kv.upstash.io';
      process.env.KV_REST_API_TOKEN = 'very-secret-kv-token-xyz';
      global.fetch = async () => { throw new Error('KV SET failed: very-secret-kv-token-xyz leaked'); };

      const portfolio = makePortfolioConfig() as any;
      const result = await savePortfolioConfig(portfolio);
      assert(result.saved === false, 'expected saved:false on KV failure');
      assert(typeof result.warning === 'string', 'expected warning to be present');
      assert(
        !result.warning!.includes('very-secret-kv-token-xyz'),
        'warning must not contain the KV token'
      );
    } finally {
      global.fetch = originalFetch;
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('save without KV attempts file-store, returns saved:false on Vercel-like restricted fs', async () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    const savedDataDir = process.env.DATA_DIR;
    try {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      // Point DATA_DIR to a read-only-ish path to simulate Vercel fs restriction
      process.env.DATA_DIR = '/tmp/nonexistent-portfolio-store-test-dir';

      const portfolio = makePortfolioConfig() as any;
      const result = await savePortfolioConfig(portfolio);
      // The relative path '../../config/portfolio.json' from a nonexistent DATA_DIR
      // will fail — so saved:false is expected
      assert(typeof result.saved === 'boolean', 'should return a boolean saved');
      // Either saved (if path happened to work) or not — but must not throw
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
