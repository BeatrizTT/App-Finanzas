// P0: Cron auth — 4 required cases verified
// Tests checkCronAuth pure function without HTTP infrastructure.

import { checkCronAuth } from '../daily/route';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

console.log('\n▶ src/app/api/cron/__tests__/cron-auth.test.ts\n');

// Case 1: CRON_SECRET missing → 503, fail closed
test('missing CRON_SECRET → 503 CRON_SECRET_MISSING', () => {
  const result = checkCronAuth(undefined, null);
  assert(!result.ok, 'should not be ok');
  if (!result.ok) {
    assert(result.status === 503, `expected 503, got ${result.status}`);
    assert(result.code === 'CRON_SECRET_MISSING', `expected CRON_SECRET_MISSING, got ${result.code}`);
  }
});

// Case 2: CRON_SECRET missing, header present — still 503 (secret missing is the first check)
test('missing CRON_SECRET even with header → 503', () => {
  const result = checkCronAuth(undefined, 'Bearer somesecret');
  assert(!result.ok, 'should not be ok');
  if (!result.ok) {
    assert(result.status === 503, `expected 503, got ${result.status}`);
  }
});

// Case 3: CRON_SECRET present, no Authorization → 401
test('CRON_SECRET set, no Authorization header → 401', () => {
  const result = checkCronAuth('mysecret', null);
  assert(!result.ok, 'should not be ok');
  if (!result.ok) {
    assert(result.status === 401, `expected 401, got ${result.status}`);
    assert(result.code === 'UNAUTHORIZED', `expected UNAUTHORIZED, got ${result.code}`);
  }
});

// Case 4: CRON_SECRET present, wrong Authorization → 401
test('CRON_SECRET set, wrong Authorization → 401', () => {
  const result = checkCronAuth('mysecret', 'Bearer wrongsecret');
  assert(!result.ok, 'should not be ok');
  if (!result.ok) {
    assert(result.status === 401, `expected 401, got ${result.status}`);
  }
});

// Case 5: CRON_SECRET present, malformed header (no Bearer prefix) → 401
test('CRON_SECRET set, malformed header (no Bearer) → 401', () => {
  const result = checkCronAuth('mysecret', 'mysecret');
  assert(!result.ok, 'should not be ok');
  if (!result.ok) {
    assert(result.status === 401, `expected 401, got ${result.status}`);
  }
});

// Case 6: CRON_SECRET present, correct Authorization → ok
test('CRON_SECRET set, correct Authorization → ok', () => {
  const result = checkCronAuth('mysecret', 'Bearer mysecret');
  assert(result.ok, 'should be ok');
});

// Case 7: empty string CRON_SECRET is treated as missing (falsy)
test('empty string CRON_SECRET → 503 (falsy, treated as missing)', () => {
  const result = checkCronAuth('', 'Bearer ');
  assert(!result.ok, 'should not be ok');
  if (!result.ok) {
    assert(result.status === 503, `expected 503, got ${result.status}`);
  }
});

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
