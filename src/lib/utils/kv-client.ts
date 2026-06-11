// Shared Upstash/Vercel KV client.
// Extracted from engine-store.ts and portfolio-store.ts (PR-0).
// Bracket notation on all env var reads — prevents Turbopack from inlining
// process.env.KV_REST_API_URL/TOKEN as undefined at build time.

export const KV_TIMEOUT_MS = 5000;

export function getKvConfig(): { url: string; token: string } | null {
  const url = process.env['KV_REST_API_URL'];
  const token = process.env['KV_REST_API_TOKEN'];
  if (url && token) return { url, token };
  return null;
}

// Strip KV credentials from error messages before logging or surfacing them.
export function sanitizeKvError(msg: string): string {
  const token = process.env['KV_REST_API_TOKEN'];
  if (token && token.length > 8) msg = msg.replaceAll(token, '[REDACTED]');
  const url = process.env['KV_REST_API_URL'];
  if (url) msg = msg.replace(url, '[KV_URL]');
  return msg;
}

// Upstash Redis REST API — single command format:
// POST {url}  body: ["COMMAND", arg1, arg2, ...]
// Returns: { result: ..., error?: string }
export async function upstashCommand(
  url: string,
  token: string,
  command: string[],
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KV_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}`);
    const data = await res.json() as { result: unknown; error?: string };
    if (data.error) throw new Error(data.error);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function kvSet(url: string, token: string, key: string, value: unknown): Promise<void> {
  await upstashCommand(url, token, ['SET', key, JSON.stringify(value)]);
}

export async function kvGet<T>(url: string, token: string, key: string): Promise<T | null> {
  const result = await upstashCommand(url, token, ['GET', key]);
  if (result === null || result === undefined) return null;
  return JSON.parse(result as string) as T;
}
