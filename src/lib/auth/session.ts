export const COOKIE_NAME = 'bh_session';
export const SESSION_DAYS = 30;
const encoder = new TextEncoder();

// Compare every byte, without returning early on a mismatched byte.
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

async function sign(expires: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(expires));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createSession(secret: string): Promise<string> {
  if (!secret) throw new Error('Session signing is not configured');
  const expires = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${expires}.${await sign(expires, secret)}`;
}

export async function isValidSession(
  token: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!token || !secret) return false;
  const match = /^(\d{1,16})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const [, expires, signature] = match;
  if (!Number.isSafeInteger(Number(expires)) || Number(expires) <= Date.now()) return false;
  return equalBytes(encoder.encode(signature), encoder.encode(await sign(expires, secret)));
}

export async function passwordMatches(
  input: string,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!expected) return false;
  // Hash to fixed-size buffers before comparison so differing password lengths
  // don't cause an early return or alter the number of comparison iterations.
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(input)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return equalBytes(new Uint8Array(a), new Uint8Array(b));
}
