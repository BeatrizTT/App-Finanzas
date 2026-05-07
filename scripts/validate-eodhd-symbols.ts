#!/usr/bin/env ts-node
// P2c-1: Controlled EODHD symbol validator
// Validates currency metadata for specific symbols without changing any
// production provider, scanner, allocator, or P&L logic.
//
// Usage:
//   npx tsx scripts/validate-eodhd-symbols.ts --symbol CNDX
//   npx tsx scripts/validate-eodhd-symbols.ts --symbols CNDX,IWVL,ASML
//   npx tsx scripts/validate-eodhd-symbols.ts              # default core set
//   npx tsx scripts/validate-eodhd-symbols.ts --out config/eodhd-symbol-validation.json
//
// Required env: EODHD_API_KEY
// Budget:       EODHD_MAX_CALLS_PER_RUN (default 10)
// Output:       src/data/eodhd-validation-report.json (gitignored)
//
// What it does NOT change: SYMBOL_MAP, price provider, engine, scanner, P&L.

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import * as fs from 'fs';
import * as path from 'path';

import {
  resolveValidationStatus,
  sanitizeApiKey,
  type SymbolValidationInput,
  type EodhdSearchResult,
  type EodhdErrorContext,
  type EodhdSymbolValidationResult,
} from '../src/lib/pricing/eodhd-validator';

// ---------------------------------------------------------------------------
// Validation targets — mirrors SYMBOL_MAP in eodhd-provider.ts
// All validated=false until this script confirms them with real API responses.
// ---------------------------------------------------------------------------

interface ValidationTarget extends SymbolValidationInput {
  description: string;
}

const ALL_VALIDATION_TARGETS: ValidationTarget[] = [
  // --- EUR instruments (Euronext / Xetra) ---
  { internalTicker: 'ASML',  eodhdSymbol: 'ASML.AS',    exchange: 'AS',    expectedCurrency: 'EUR', description: 'ASML Holding — Euronext Amsterdam' },
  { internalTicker: 'VWCE',  eodhdSymbol: 'VWCE.XETRA', exchange: 'XETRA', expectedCurrency: 'EUR', description: 'Vanguard FTSE All-World UCITS ETF — Xetra' },
  // --- LSE instruments — GBP or GBX (pence), unconfirmed until validated ---
  { internalTicker: 'CNDX',  eodhdSymbol: 'CNDX.LSE',   exchange: 'LSE',   expectedCurrency: 'GBP', description: 'iShares MSCI World Consumer Discretionary ETF — LSE' },
  { internalTicker: 'IWDA',  eodhdSymbol: 'IWDA.LSE',   exchange: 'LSE',   expectedCurrency: 'GBP', description: 'iShares Core MSCI World ETF — LSE' },
  { internalTicker: 'IWVL',  eodhdSymbol: 'IWVL.LSE',   exchange: 'LSE',   expectedCurrency: 'GBP', description: 'iShares Edge MSCI World Value Factor ETF — LSE' },
  { internalTicker: 'CSPX',  eodhdSymbol: 'CSPX.LSE',   exchange: 'LSE',   expectedCurrency: 'GBP', description: 'iShares Core S&P 500 UCITS ETF — LSE' },
  { internalTicker: 'EMIM',  eodhdSymbol: 'EMIM.LSE',   exchange: 'LSE',   expectedCurrency: 'GBP', description: 'iShares Core EM IMI UCITS ETF — LSE' },
  { internalTicker: 'SEMI',  eodhdSymbol: 'VSEM.LSE',   exchange: 'LSE',   expectedCurrency: 'GBP', description: 'Vaneck Semiconductor ETF (VSEM) — LSE' },
  // --- USD instruments (.US) ---
  { internalTicker: 'NVDA',  eodhdSymbol: 'NVDA.US',    exchange: 'US',    expectedCurrency: 'USD', description: 'NVIDIA Corp — NASDAQ' },
  { internalTicker: 'MSFT',  eodhdSymbol: 'MSFT.US',    exchange: 'US',    expectedCurrency: 'USD', description: 'Microsoft Corp — NASDAQ' },
  { internalTicker: 'AMZN',  eodhdSymbol: 'AMZN.US',    exchange: 'US',    expectedCurrency: 'USD', description: 'Amazon.com Inc — NASDAQ' },
  { internalTicker: 'SMCI',  eodhdSymbol: 'SMCI.US',    exchange: 'US',    expectedCurrency: 'USD', description: 'Super Micro Computer — NASDAQ' },
  { internalTicker: 'CRM',   eodhdSymbol: 'CRM.US',     exchange: 'US',    expectedCurrency: 'USD', description: 'Salesforce Inc — NYSE' },
  { internalTicker: 'NOW',   eodhdSymbol: 'NOW.US',     exchange: 'US',    expectedCurrency: 'USD', description: 'ServiceNow Inc — NYSE' },
  { internalTicker: 'ADBE',  eodhdSymbol: 'ADBE.US',    exchange: 'US',    expectedCurrency: 'USD', description: 'Adobe Inc — NASDAQ' },
  { internalTicker: 'ORCL',  eodhdSymbol: 'ORCL.US',    exchange: 'US',    expectedCurrency: 'USD', description: 'Oracle Corp — NYSE' },
  { internalTicker: 'MU',    eodhdSymbol: 'MU.US',      exchange: 'US',    expectedCurrency: 'USD', description: 'Micron Technology — NASDAQ' },
];

// ---------------------------------------------------------------------------
// Budget — separate from the production engine budget (this is a CLI tool)
// ---------------------------------------------------------------------------

let budgetUsed = 0;

function budgetLimit(): number {
  const v = parseInt(process.env.EODHD_MAX_CALLS_PER_RUN ?? '10', 10);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

function tryConsumeBudget(): boolean {
  if (budgetUsed >= budgetLimit()) {
    console.warn(`[Validator] Budget limit (${budgetLimit()}) reached — remaining symbols marked quota_or_rate_limited`);
    return false;
  }
  budgetUsed++;
  return true;
}

// ---------------------------------------------------------------------------
// EODHD search API — key appended last, never logged
// ---------------------------------------------------------------------------

const SEARCH_BASE = 'https://eodhd.com/api/search';
const FETCH_TIMEOUT_MS = 15_000;

async function fetchEodhdSearch(
  baseTicker: string,
  apiKey: string
): Promise<{ results: EodhdSearchResult[] | null; error: EodhdErrorContext | null }> {
  const params = new URLSearchParams({ fmt: 'json', limit: '20' });
  // Log path without key — only the sanitized URL is visible
  console.log(`[Validator] GET /api/search/${baseTicker}?${params}`);

  const url = `${SEARCH_BASE}/${encodeURIComponent(baseTicker)}?${params}&api_token=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const raw = err instanceof Error ? err.message : String(err);
    const msg = sanitizeApiKey(raw, apiKey);
    const isTimeout = raw.includes('abort') || raw.includes('timeout');
    return {
      results: null,
      error: { isQuota: false, isNotFound: false, isTimeout, isAuth: false, message: msg },
    };
  }
  clearTimeout(timer);

  if (res.status === 401 || res.status === 403) {
    return {
      results: null,
      error: { isQuota: false, isNotFound: false, isTimeout: false, isAuth: true, message: 'Unauthorized — check EODHD_API_KEY' },
    };
  }
  if (res.status === 402 || res.status === 429) {
    return {
      results: null,
      error: { isQuota: true, isNotFound: false, isTimeout: false, isAuth: false, message: 'API quota or rate limit exceeded' },
    };
  }
  if (res.status === 404) {
    return {
      results: [],  // treat as symbol_not_found, not an error
      error: null,
    };
  }
  if (!res.ok) {
    const msg = sanitizeApiKey(`HTTP ${res.status}`, apiKey);
    return {
      results: null,
      error: { isQuota: false, isNotFound: false, isTimeout: false, isAuth: false, message: msg },
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      results: null,
      error: { isQuota: false, isNotFound: false, isTimeout: false, isAuth: false, message: 'Invalid JSON in EODHD response' },
    };
  }

  // EODHD sometimes wraps errors in a 200 response
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    const msg = sanitizeApiKey(String(obj.message ?? obj.error ?? ''), apiKey);
    const isQuota = String(obj.status) === '402' || msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('quota');
    if (isQuota) {
      return { results: null, error: { isQuota: true, isNotFound: false, isTimeout: false, isAuth: false, message: 'Quota exceeded (in 200 response)' } };
    }
    if (msg) {
      return { results: null, error: { isQuota: false, isNotFound: false, isTimeout: false, isAuth: false, message: msg } };
    }
    return { results: [], error: null };
  }

  if (!Array.isArray(body)) {
    return { results: [], error: null };
  }

  return { results: body as EodhdSearchResult[], error: null };
}

// ---------------------------------------------------------------------------
// Validate a single symbol
// ---------------------------------------------------------------------------

async function validateTarget(
  target: ValidationTarget,
  apiKey: string
): Promise<EodhdSymbolValidationResult> {
  if (!tryConsumeBudget()) {
    return resolveValidationStatus(
      target,
      null,
      { isQuota: true, isNotFound: false, isTimeout: false, isAuth: false, message: `Budget limit (${budgetLimit()}) reached before this symbol` },
      null
    );
  }

  // Search by base ticker (without exchange suffix) to get all exchange matches
  const baseTicker = target.internalTicker;
  const { results, error } = await fetchEodhdSearch(baseTicker, apiKey);

  return resolveValidationStatus(target, results, error, null);
}

// ---------------------------------------------------------------------------
// Report structure
// ---------------------------------------------------------------------------

interface ValidationReport {
  generatedAt: string;
  budgetUsed: number;
  budgetLimit: number;
  totalSymbols: number;
  results: EodhdSymbolValidationResult[];
  summary: Record<string, number>;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Collect symbol filter
  let symbolFilter: Set<string> | null = null;
  let outputPath = 'src/data/eodhd-validation-report.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol' && args[i + 1]) {
      symbolFilter = new Set([args[i + 1].toUpperCase()]);
      i++;
    } else if (args[i] === '--symbols' && args[i + 1]) {
      symbolFilter = new Set(args[i + 1].split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
      i++;
    } else if (args[i] === '--out' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    }
  }

  const apiKey = process.env.EODHD_API_KEY;
  if (!apiKey) {
    console.error('[Validator] EODHD_API_KEY is not set — cannot validate symbols.');
    console.error('  Set it in .env.local: EODHD_API_KEY=your_key_here');
    process.exit(1);
  }

  const targets = symbolFilter
    ? ALL_VALIDATION_TARGETS.filter(t => symbolFilter!.has(t.internalTicker))
    : ALL_VALIDATION_TARGETS;

  if (targets.length === 0) {
    const available = ALL_VALIDATION_TARGETS.map(t => t.internalTicker).join(', ');
    console.error(`[Validator] No matching symbols found. Available: ${available}`);
    process.exit(1);
  }

  console.log('=== EODHD Symbol Validator (P2c-1) ===');
  console.log(`Symbols:     ${targets.map(t => t.internalTicker).join(', ')}`);
  console.log(`Budget:      ${budgetLimit()} calls max`);
  console.log(`Output:      ${outputPath}`);
  console.log('');

  const results: EodhdSymbolValidationResult[] = [];

  for (const target of targets) {
    console.log(`\n→ ${target.internalTicker} (${target.eodhdSymbol}) — ${target.description}`);
    const result = await validateTarget(target, apiKey);
    results.push(result);

    const icon = result.status.startsWith('validated') ? '✓' : result.status === 'suspected_gbx_pence' ? '⚠' : '✗';
    console.log(`  ${icon} ${result.status}`);
    if (result.confirmedCurrency) console.log(`    currency: ${result.confirmedCurrency}`);
    if (result.samplePrice != null) console.log(`    price: ${result.samplePrice} (${result.samplePriceDate})`);
    if (result.warnings.length > 0) {
      result.warnings.forEach(w => console.log(`    warning: ${w}`));
    }
  }

  // Summary counts
  const summary: Record<string, number> = {};
  for (const r of results) {
    summary[r.status] = (summary[r.status] ?? 0) + 1;
  }

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    budgetUsed,
    budgetLimit: budgetLimit(),
    totalSymbols: results.length,
    results,
    summary,
  };

  // Write report — create parent dir if needed
  const outDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Verify no API key leaked into the report
  const reportText = fs.readFileSync(outputPath, 'utf-8');
  if (apiKey.length > 4 && reportText.includes(apiKey)) {
    console.error('\n[Validator] SECURITY: API key found in report output — aborting and deleting report');
    fs.unlinkSync(outputPath);
    process.exit(2);
  }

  console.log('\n=== Summary ===');
  for (const [status, count] of Object.entries(summary).sort()) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`\nBudget used: ${budgetUsed}/${budgetLimit()}`);
  console.log(`Report written: ${outputPath}`);

  const hasErrors = results.some(r =>
    r.status === 'provider_error' || r.status === 'rejected_mismatch'
  );
  process.exit(hasErrors ? 1 : 0);
}

main().catch(err => {
  const safe = sanitizeApiKey(
    err instanceof Error ? err.message : String(err),
    process.env.EODHD_API_KEY
  );
  console.error('[Validator] Fatal error:', safe);
  process.exit(1);
});
