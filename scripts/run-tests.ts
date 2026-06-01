#!/usr/bin/env tsx
// Test runner: discovers all *.test.ts files under src/lib/**/__tests__/
// and runs each with tsx. Streams output, accumulates pass/fail totals,
// exits 1 if any suite fails.

import { spawnSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';

const ROOT = resolve(__dirname, '..');

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (entry.endsWith('.test.ts') && full.includes('__tests__')) {
      results.push(full);
    }
  }
  return results.sort();
}

const testFiles = findTestFiles(join(ROOT, 'src'));

if (testFiles.length === 0) {
  console.error('No test files found under src/');
  process.exit(1);
}

console.log(`Running ${testFiles.length} test suite(s)\n${'─'.repeat(60)}`);

let totalPassed = 0;
let totalFailed = 0;
const failedSuites: string[] = [];

for (const file of testFiles) {
  const label = relative(ROOT, file);
  console.log(`\n▶ ${label}`);

  const result = spawnSync('npx', ['tsx', file], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Stream captured output so it's visible
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  // Parse "Results: X passed, Y failed" from this suite's output
  const match = result.stdout?.match(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
  if (match) {
    totalPassed += parseInt(match[1], 10);
    totalFailed += parseInt(match[2], 10);
  }

  if (result.status !== 0 || (match && parseInt(match[2], 10) > 0)) {
    failedSuites.push(label);
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`Suites : ${testFiles.length - failedSuites.length}/${testFiles.length} passed`);
console.log(`Asserts: ${totalPassed} passed, ${totalFailed} failed`);

if (failedSuites.length > 0) {
  console.error('\nFailed suites:');
  for (const s of failedSuites) console.error(`  ✗ ${s}`);
  process.exit(1);
} else {
  console.log(`\nAll ${testFiles.length} suites green.`);
}
