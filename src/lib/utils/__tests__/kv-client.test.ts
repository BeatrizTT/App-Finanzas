// Tests for kv-client.ts: getKvConfig, sanitizeKvError, kvGet, kvSet,
// HTTP errors, Upstash-level errors, and secret sanitization.

import { getKvConfig, sanitizeKvError, kvGet, kvSet } from '../kv-client';

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

// Helper: mock fetch responding to GET / SET commands
function makeFetch(kvData: Record<string, unknown>): typeof global.fetch {
  return async (_url, init) => {
    const cmd = JSON.parse((init?.body as string) ?? '[]') as string[];
    const method = cmd[0];
    if (method === 'SET') {
      return new Response(JSON.stringify({ result: 'OK' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    const key = cmd[1];
    const value = kvData[key] ?? null;
    const result = value !== null ? JSON.stringify(value) : null;
    return new Response(JSON.stringify({ result }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
}

console.log('\n▶ src/lib/utils/__tests__/kv-client.test.ts\n');

async function main(): Promise<void> {
  // ── getKvConfig ────────────────────────────────────────────────────────

  await test('getKvConfig returns null when env vars are absent', () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    try {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      assert(getKvConfig() === null, 'expected null when no env vars');
    } finally {
      if (savedUrl !== undefined) process.env.KV_REST_API_URL = savedUrl;
      if (savedToken !== undefined) process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('getKvConfig returns null when only URL is set', () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    try {
      process.env.KV_REST_API_URL = 'https://fake.upstash.io';
      delete process.env.KV_REST_API_TOKEN;
      assert(getKvConfig() === null, 'expected null with missing token');
    } finally {
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken !== undefined) process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('getKvConfig returns { url, token } when both env vars are set', () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    try {
      process.env.KV_REST_API_URL = 'https://fake.upstash.io';
      process.env.KV_REST_API_TOKEN = 'fake-token';
      const cfg = getKvConfig();
      assert(cfg !== null, 'expected non-null config');
      assert(cfg!.url === 'https://fake.upstash.io', 'url mismatch');
      assert(cfg!.token === 'fake-token', 'token mismatch');
    } finally {
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  // ── sanitizeKvError ───────────────────────────────────────────────────

  await test('sanitizeKvError redacts token from error message', () => {
    const savedToken = process.env.KV_REST_API_TOKEN;
    try {
      process.env.KV_REST_API_TOKEN = 'super-secret-kv-token-xyz';
      const result = sanitizeKvError('Auth failed with super-secret-kv-token-xyz in header');
      assert(!result.includes('super-secret-kv-token-xyz'), 'token must be redacted');
      assert(result.includes('[REDACTED]'), 'must contain [REDACTED] placeholder');
    } finally {
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('sanitizeKvError redacts URL from error message', () => {
    const savedUrl = process.env.KV_REST_API_URL;
    const savedToken = process.env.KV_REST_API_TOKEN;
    try {
      process.env.KV_REST_API_URL = 'https://my-kv-endpoint.upstash.io';
      delete process.env.KV_REST_API_TOKEN;
      const result = sanitizeKvError('Failed to reach https://my-kv-endpoint.upstash.io/v1');
      assert(!result.includes('my-kv-endpoint.upstash.io'), 'URL must be redacted');
      assert(result.includes('[KV_URL]'), 'must contain [KV_URL] placeholder');
    } finally {
      if (savedUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = savedUrl;
      if (savedToken !== undefined) process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  await test('sanitizeKvError does not redact short tokens (≤8 chars)', () => {
    const savedToken = process.env.KV_REST_API_TOKEN;
    try {
      process.env.KV_REST_API_TOKEN = 'short';
      const msg = 'error with short token';
      const result = sanitizeKvError(msg);
      assert(result === msg, 'short token must not be redacted');
    } finally {
      if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = savedToken;
    }
  });

  // ── kvGet ─────────────────────────────────────────────────────────────

  await test('kvGet returns parsed value when key exists', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = makeFetch({ 'test:key': { count: 42 } });
      const result = await kvGet<{ count: number }>('https://fake.io', 'tok', 'test:key');
      assert(result !== null, 'expected non-null result');
      assert(result!.count === 42, `expected 42, got ${result!.count}`);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('kvGet returns null when key does not exist', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = makeFetch({});
      const result = await kvGet<{ count: number }>('https://fake.io', 'tok', 'missing:key');
      assert(result === null, 'expected null for missing key');
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('kvGet throws on non-ok HTTP response', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = async () => new Response('Internal Server Error', { status: 500 });
      let threw = false;
      try {
        await kvGet('https://fake.io', 'tok', 'any:key');
      } catch (err) {
        threw = true;
        const msg = err instanceof Error ? err.message : String(err);
        assert(msg.includes('500'), `error message should include status code, got: ${msg}`);
      }
      assert(threw, 'expected kvGet to throw on HTTP 500');
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('kvGet throws on Upstash-level error in response body', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = async () => new Response(
        JSON.stringify({ result: null, error: 'WRONGTYPE Operation on wrong key type' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
      let threw = false;
      try {
        await kvGet('https://fake.io', 'tok', 'any:key');
      } catch (err) {
        threw = true;
        const msg = err instanceof Error ? err.message : String(err);
        assert(msg.includes('WRONGTYPE'), `expected Upstash error in message, got: ${msg}`);
      }
      assert(threw, 'expected kvGet to throw on Upstash error body');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ── kvSet ─────────────────────────────────────────────────────────────

  await test('kvSet sends correct SET command to Upstash', async () => {
    const originalFetch = global.fetch;
    const calls: { url: string; body: unknown }[] = [];
    try {
      global.fetch = async (url, init) => {
        calls.push({ url: url as string, body: JSON.parse((init?.body as string) ?? '[]') });
        return new Response(JSON.stringify({ result: 'OK' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      };
      await kvSet('https://fake.io', 'tok', 'engine:latest_output', { version: 1 });
      assert(calls.length === 1, 'expected exactly one fetch call');
      const [cmd] = calls[0].body as string[];
      const body = calls[0].body as string[];
      assert(body[0] === 'SET', `expected SET command, got ${body[0]}`);
      assert(body[1] === 'engine:latest_output', `key mismatch: ${body[1]}`);
      const stored = JSON.parse(body[2]) as { version: number };
      assert(stored.version === 1, `stored value mismatch: ${stored.version}`);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test('kvSet throws on non-ok HTTP response', async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = async () => new Response('Bad Gateway', { status: 502 });
      let threw = false;
      try {
        await kvSet('https://fake.io', 'tok', 'any:key', { data: true });
      } catch (err) {
        threw = true;
        const msg = err instanceof Error ? err.message : String(err);
        assert(msg.includes('502'), `error message should include status code, got: ${msg}`);
      }
      assert(threw, 'expected kvSet to throw on HTTP 502');
    } finally {
      global.fetch = originalFetch;
    }
  });

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
