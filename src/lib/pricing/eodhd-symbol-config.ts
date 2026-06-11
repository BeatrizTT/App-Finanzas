// Curated EODHD symbol validation config loader and suitability resolver.
// Loaded lazily from config/eodhd-symbol-validation.json on first call.
// No API calls, no side effects after init.
//
// Used by: eodhd-provider.ts (buildValidation), eodhd-symbol-config.test.ts
// Source:  config/eodhd-symbol-validation.json (P2c-1b smoke results)

import fs from 'fs';
import path from 'path';

import type { PriceValidation, PriceProviderId } from '../types';
import type { EodhdValidationStatus } from './eodhd-validator';
import {
  confirmedEurValidation,
  usdNoFxValidation,
  usdConvertedValidation,
  currencyMismatchValidation,
  unavailableValidation,
} from './price-validation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EodhdCuratedEntry {
  internalTicker: string;
  eodhdSymbol: string;
  exchange: string;
  status: EodhdValidationStatus;
  confirmedCurrency: string | null;
  expectedCurrency: string;
  samplePrice: number | null;
  samplePriceDate: string | null;
  warnings: string[];
  note?: string;
  // Provenance from the EODHD smoke artifact (P3-1+). Optional — older entries omit these.
  timestamp?: string;
  sourceEndpoint?: string;
}

interface EodhdCuratedConfig {
  generatedAt: string;
  source: string;
  note: string;
  symbols: EodhdCuratedEntry[];
}

// ---------------------------------------------------------------------------
// Lazy loader — reads config/eodhd-symbol-validation.json once from process.cwd()
// ---------------------------------------------------------------------------

let _cache: Map<string, EodhdCuratedEntry> | null = null;

function loadConfig(): Map<string, EodhdCuratedEntry> {
  if (_cache) return _cache;

  const configPath = path.resolve(process.cwd(), 'config', 'eodhd-symbol-validation.json');
  if (!fs.existsSync(configPath)) {
    _cache = new Map();
    return _cache;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const data = JSON.parse(raw) as EodhdCuratedConfig;
    _cache = new Map(
      (data.symbols ?? []).map(e => [e.internalTicker.toUpperCase(), e])
    );
  } catch {
    _cache = new Map();
  }

  return _cache;
}

/** Reset the in-memory cache. Tests only — never call in production code. */
export function resetCuratedConfigCache(): void {
  _cache = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the curated validation entry for the given internal ticker, or null.
 * Caches the full config on first call.
 */
export function getEodhdCuratedEntry(internalTicker: string): EodhdCuratedEntry | null {
  return loadConfig().get(internalTicker.toUpperCase()) ?? null;
}

/**
 * Returns true only when the EODHD raw close price can be set as currentPrice.
 *
 * Only validated_exact_eur is safe: the price is already in EUR (Euronext/Xetra),
 * no FX conversion needed, no ambiguity.
 *
 * validated_usd_needs_fx → false:
 *   The raw price is in USD. Without a real EUR/USD FX rate the number is
 *   meaningless in an EUR portfolio. Setting currentPrice=null forces every
 *   downstream consumer (scanner, display, portfolio engine) to show "—"
 *   instead of silently treating 207.83 USD as €207.83.
 *
 * rejected_mismatch → false:
 *   The currency is wrong; exposing the raw price would be misleading.
 *
 * All other statuses → false (conservative default).
 *
 * NOTE: drawdown % is still computed from the raw price in getRecentHighs —
 * the ratio is currency-independent and remains valid even when currentPrice is null.
 */
export function isCuratedCurrentPriceUsable(status: EodhdValidationStatus): boolean {
  return status === 'validated_exact_eur';
}

/**
 * Build a PriceValidation from a curated entry.
 *
 * Statuses and their outcomes:
 * - validated_exact_eur      → confirmedEurValidation  (suitable for exact P&L and BUY)
 * - validated_usd_needs_fx   → usdConvertedValidation  (if hasFxRate)
 *                            → usdNoFxValidation       (if !hasFxRate; note: "USD quote validated but FX missing")
 * - rejected_mismatch        → currencyMismatchValidation (never suitable for P&L or BUY)
 * - all other statuses       → unavailableValidation
 *
 * hasFxRate: the EODHD provider always passes false — it does not perform FX conversion.
 * The parameter exists so callers with a real FX rate can obtain usdConvertedValidation.
 * Never pass true with a hardcoded fallback rate.
 */
export function buildValidationFromCurated(
  symbol: string,
  entry: EodhdCuratedEntry,
  hasFxRate: boolean,
  provider: PriceProviderId = 'eodhd',
): PriceValidation {
  switch (entry.status) {
    case 'validated_exact_eur':
      return confirmedEurValidation(symbol, provider);

    case 'validated_usd_needs_fx':
      if (hasFxRate) {
        return usdConvertedValidation(symbol, provider);
      }
      return {
        ...usdNoFxValidation(symbol, provider),
        note: 'USD quote validated but FX missing — exact P&L and buy sizing unavailable until EUR/USD FX rate is available',
      };

    case 'rejected_mismatch': {
      const fetched = entry.confirmedCurrency ?? 'unknown';
      const expected = entry.expectedCurrency;
      return currencyMismatchValidation(symbol, provider, fetched, expected);
    }

    default:
      return unavailableValidation(symbol);
  }
}
