import { COOKIE_NAME, SESSION_DAYS, createSession, isValidSession, passwordMatches } from '../session';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch { failed++; console.error(`  ✗ ${name}`); }
}
async function main() {
  const secret = 'testsecret';
  await test('valid token uses expected format and 30-day expiry', async () => {
    const before = Date.now();
    const token = await createSession(secret);
    assert(COOKIE_NAME === 'bh_session' && SESSION_DAYS === 30, 'cookie contract');
    assert(/^\d+\.[a-f0-9]{64}$/.test(token), 'token format');
    const expiry = Number(token.split('.')[0]);
    assert(expiry >= before + 30 * 86400000 && expiry <= Date.now() + 30 * 86400000, 'expiry');
    assert(await isValidSession(token, secret), 'valid token');
  });
  await test('expired signed token is rejected', async () => {
    const originalNow = Date.now;
    let token: string;
    try {
      Date.now = () => originalNow() - 31 * 86400000;
      token = await createSession(secret);
    } finally { Date.now = originalNow; }
    assert(!await isValidSession(token!, secret), 'expired');
  });
  await test('tampered signature and expiry are rejected', async () => {
    const token = await createSession(secret);
    const [expiry, signature] = token.split('.');
    const tampered = signature[0] === 'a' ? 'b' : 'a';
    assert(!await isValidSession(`${expiry}.${tampered}${signature.slice(1)}`, secret), 'signature');
    assert(!await isValidSession(`${Number(expiry) + 1000}.${signature}`, secret), 'expiry');
    assert(!await isValidSession(token, 'different-secret'), 'wrong key');
  });
  await test('missing secret or token fails closed', async () => {
    const token = await createSession(secret);
    for (const value of [undefined, null, '']) {
      assert(!await isValidSession(token, value), 'missing secret');
      assert(!await isValidSession(value, secret), 'missing token');
    }
  });
  await test('malformed tokens are rejected', async () => {
    for (const value of ['bad', 'NaN.' + 'a'.repeat(64), 'Infinity.' + 'a'.repeat(64), (await createSession(secret)) + '.extra']) {
      assert(!await isValidSession(value, secret), 'malformed');
    }
  });
  await test('password comparison accepts only the expected nonempty password', async () => {
    assert(await passwordMatches('test123', 'test123'), 'correct');
    for (const value of ['wrong', '', 'test123longer', 'test12', 'Test123']) {
      assert(!await passwordMatches(value, 'test123'), 'wrong password');
    }
    assert(!await passwordMatches('', undefined), 'missing');
    assert(!await passwordMatches('', ''), 'empty configuration');
  });
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
void main();
