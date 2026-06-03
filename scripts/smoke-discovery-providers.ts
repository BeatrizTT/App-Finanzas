#!/usr/bin/env tsx
// P3-3f-0: Multi-source discovery provider capability smoke
// Checks which providers support candidate discovery using real API keys.
// Output: src/data/provider-capability-smoke.json (not committed)
//
// Run: npx tsx scripts/smoke-discovery-providers.ts
//
// Safety:
//   - Missing key → result with missing_key warning, no crash
//   - Network error → result with network_error warning, no crash
//   - No API keys in output
//   - No raw provider payload stored
//   - Sanitizes all URLs and strings before logging or writing

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  sanitizeString,
  validateReportSecurity,
  buildMissingKeyResult,
  buildNetworkErrorResult,
  parseEodhdScreenerResponse,
  parseFmpScreenerResponse,
  parseFinnhubResponse,
  parseAlphaVantageResponse,
  parseTwelveDataResponse,
  yahooFallbackResult,
  buildSummary,
} from '../src/lib/discovery/provider-capability';
import type {
  ProviderCapabilityResult,
  ProviderCapabilitySmokeReport,
} from '../src/lib/discovery/provider-capability';

// ---------------------------------------------------------------------------
// Secret values to redact from any string/URL
// ---------------------------------------------------------------------------

const keysToRedact = [
  process.env.EODHD_API_KEY,
  process.env.FMP_API_KEY,
  process.env.FINNHUB_API_KEY,
  process.env.ALPHA_VANTAGE_API_KEY,
  process.env.TWELVE_DATA_API_KEY,
].filter((k): k is string => typeof k === 'string' && k.length > 4);

function san(s: string): string {
  return sanitizeString(s, keysToRedact);
}

// ---------------------------------------------------------------------------
// HTTP helper — never logs the URL (contains key), always sanitises errors
// ---------------------------------------------------------------------------

async function safeFetch(url: string, timeoutMs = 8000): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(san(msg));
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Per-provider smoke functions
// ---------------------------------------------------------------------------

async function smokeEodhd(): Promise<ProviderCapabilityResult> {
  const key = process.env.EODHD_API_KEY;
  if (!key) return buildMissingKeyResult('eodhd_screener');

  const filters = JSON.stringify([
    ['exchange', '=', 'US'],
    ['market_capitalization', '>', 2000000000],
  ]);
  const url = `https://eodhd.com/api/screener?api_token=${key}&filters=${encodeURIComponent(filters)}&sort=price_change_30d%20asc&limit=3`;

  try {
    console.log('[smoke] EODHD Screener: calling (5 call units)...');
    const { status, body } = await safeFetch(url);
    console.log(`[smoke] EODHD Screener: status=${status}`);
    return parseEodhdScreenerResponse(body, status);
  } catch (err) {
    return buildNetworkErrorResult('eodhd_screener', err instanceof Error ? err.message : String(err));
  }
}

async function smokeFmp(): Promise<ProviderCapabilityResult> {
  const key = process.env.FMP_API_KEY;
  if (!key) return buildMissingKeyResult('fmp_screener');

  const url = `https://financialmodelingprep.com/api/v3/stock-screener?marketCapMoreThan=2000000000&exchange=NASDAQ&limit=3&apikey=${key}`;

  try {
    console.log('[smoke] FMP Screener: calling...');
    const { status, body } = await safeFetch(url);
    console.log(`[smoke] FMP Screener: status=${status}`);
    return parseFmpScreenerResponse(body, status);
  } catch (err) {
    return buildNetworkErrorResult('fmp_screener', err instanceof Error ? err.message : String(err));
  }
}

async function smokeFinnhub(): Promise<ProviderCapabilityResult> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return buildMissingKeyResult('finnhub');

  // Test with a basic quote call — free tier supports this
  const url = `https://finnhub.io/api/v1/quote?symbol=NVDA&token=${key}`;

  try {
    console.log('[smoke] Finnhub: calling...');
    const { status, body } = await safeFetch(url);
    console.log(`[smoke] Finnhub: status=${status}`);
    return parseFinnhubResponse(body, status);
  } catch (err) {
    return buildNetworkErrorResult('finnhub', err instanceof Error ? err.message : String(err));
  }
}

async function smokeAlphaVantage(): Promise<ProviderCapabilityResult> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return buildMissingKeyResult('alpha_vantage');

  // TIME_SERIES_DAILY_ADJUSTED for one symbol — minimal call
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=IBM&outputsize=compact&apikey=${key}`;

  try {
    console.log('[smoke] Alpha Vantage: calling...');
    const { status, body } = await safeFetch(url);
    console.log(`[smoke] Alpha Vantage: status=${status}`);
    return parseAlphaVantageResponse(body, status);
  } catch (err) {
    return buildNetworkErrorResult('alpha_vantage', err instanceof Error ? err.message : String(err));
  }
}

async function smokeTwelveData(): Promise<ProviderCapabilityResult> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return buildMissingKeyResult('twelve_data');

  // Minimal call — single price for one symbol
  const url = `https://api.twelvedata.com/price?symbol=NVDA&apikey=${key}`;

  try {
    console.log('[smoke] Twelve Data: calling...');
    const { status, body } = await safeFetch(url);
    console.log(`[smoke] Twelve Data: status=${status}`);
    return parseTwelveDataResponse(body, status);
  } catch (err) {
    return buildNetworkErrorResult('twelve_data', err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const runAt = new Date().toISOString();
  console.log(`\n[smoke] P3-3f-0: Multi-source capability smoke — ${runAt}\n`);

  const results: ProviderCapabilityResult[] = await Promise.all([
    smokeEodhd(),
    smokeFmp(),
    smokeFinnhub(),
    smokeAlphaVantage(),
    smokeTwelveData(),
    Promise.resolve(yahooFallbackResult()),
  ]);

  const summary = buildSummary(results);

  const report: ProviderCapabilitySmokeReport = {
    version: 1,
    runAt,
    results,
    summary,
  };

  // Security validation — fail and abort if any key leaked into the report
  const reportJson = JSON.stringify(report, null, 2);
  if (!validateReportSecurity(reportJson, keysToRedact)) {
    console.error('[smoke] SECURITY VIOLATION: API key detected in report. Aborting write.');
    process.exit(1);
  }

  // Write to src/data/ (not tracked)
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'src', 'data');
  mkdirSync(dataDir, { recursive: true });
  const outPath = join(dataDir, 'provider-capability-smoke.json');
  writeFileSync(outPath, reportJson, 'utf8');

  console.log('\n── Results ────────────────────────────────────────');
  for (const r of results) {
    const flag = r.supported ? '✓' : '✗';
    console.log(`  ${flag} ${r.provider.padEnd(20)} usableFor=${r.usableFor}`);
    if (r.warnings.length) console.log(`       warnings: ${r.warnings.join(', ')}`);
  }

  console.log('\n── Summary ────────────────────────────────────────');
  console.log(`  Recommended: ${summary.recommendedNextProvider ?? 'none'}`);
  console.log(`  Discovery:   ${summary.candidateDiscoveryProviders.join(', ') || 'none'}`);
  console.log(`  Pricing:     ${summary.pricingValidationProviders.join(', ') || 'none'}`);
  console.log(`  Historical:  ${summary.historicalDrawdownProviders.join(', ') || 'none'}`);
  console.log(`  Research:    ${summary.researchOnlyProviders.join(', ') || 'none'}`);
  if (summary.warnings.length) console.log(`  Warnings:    ${summary.warnings.join(', ')}`);

  console.log(`\n[smoke] Report written to: ${outPath.replace(process.cwd(), '.')}\n`);
}

main().catch((err) => {
  console.error('[smoke] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
