// Pure validation logic for EODHD symbol validation.
// No API calls, no side effects — all decision-making is testable in isolation.
//
// Used by: scripts/validate-eodhd-symbols.ts
// Tests:   src/lib/pricing/__tests__/eodhd-validator.test.ts
//
// A symbol is only considered validated when EODHD metadata explicitly confirms
// the currency. Exchange suffixes (.AS, .XETRA, .LSE, .US) are hints, not proof.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EodhdValidationStatus =
  | 'validated_exact_eur'      // EUR confirmed by metadata — suitable for exact P&L
  | 'validated_usd_needs_fx'   // USD confirmed — engine must apply EUR/USD rate
  | 'validated_gbp_needs_fx'   // GBP confirmed (pounds, not pence) — engine must apply GBP/EUR rate
  | 'suspected_gbx_pence'      // Currency is GBX/GBp, or price heuristic suggests pence
  | 'currency_missing'         // Symbol found but EODHD returned no currency field
  | 'symbol_not_found'         // EODHD returned no results for this symbol
  | 'ambiguous_symbol'         // Multiple matches on same exchange, or match on wrong exchange
  | 'rejected_mismatch'        // Currency confirmed but differs from expectedCurrency
  | 'quota_or_rate_limited'    // API quota or rate limit hit — no validation attempted
  | 'provider_error';          // HTTP / parse error from EODHD — no validation attempted

/** What we know about a symbol before making API calls. */
export interface SymbolValidationInput {
  internalTicker: string;    // e.g. 'CNDX' — the internal app ticker
  eodhdSymbol: string;       // e.g. 'CNDX.LSE' — the EODHD ticker
  exchange: string;          // e.g. 'LSE', 'AS', 'XETRA', 'US'
  expectedCurrency: string;  // e.g. 'GBP', 'EUR', 'USD' — what SYMBOL_MAP currently infers
}

/** Shape of one entry in the EODHD search API response array. */
export interface EodhdSearchResult {
  Code: string;
  Exchange: string;
  Name: string;
  Type: string;
  Currency: string;
  ISIN: string | null;
  previousClose: number | null;
  previousCloseDate: string | null;
}

/** EOD price entry (only the fields we use). */
export interface EodhdSamplePrice {
  close: number;
  date: string;
}

/** Structured error from the API layer — API key must be stripped before creating this. */
export interface EodhdErrorContext {
  isQuota: boolean;
  isNotFound: boolean;
  isTimeout: boolean;
  isAuth: boolean;
  message: string;   // must be pre-sanitized (no API key)
}

/** Full result for one symbol — written to the validation report. */
export interface EodhdSymbolValidationResult {
  internalTicker: string;
  eodhdSymbol: string;
  exchange: string;
  expectedCurrency: string;
  confirmedCurrency: string | null;
  samplePrice: number | null;
  samplePriceDate: string | null;
  status: EodhdValidationStatus;
  warnings: string[];
  sourceEndpoint: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// GBX / pence suspicion: LSE instruments often quote in pence (1 GBP = 100 GBX).
// A price >200 in "GBP" on LSE almost certainly means pence — no ETF trades at £200+.
const GBX_PRICE_THRESHOLD = 200;

function isGbxCurrencyCode(currency: string): boolean {
  const c = currency.trim();
  return c === 'GBX' || c === 'GBx' || c === 'GBp';
}

function normalizeExchange(exchange: string): string {
  return exchange.toUpperCase().trim();
}

/** Remove API key from any string before it enters a report or log line. */
export function sanitizeApiKey(text: string, apiKey: string | undefined): string {
  if (!apiKey || apiKey.length <= 4) return text;
  return text.replaceAll(apiKey, '[REDACTED]');
}

// ---------------------------------------------------------------------------
// Core decision function
// ---------------------------------------------------------------------------

/**
 * Decide the validation status for a symbol given raw API data.
 *
 * All inputs are plain data — no I/O, no config access.
 * The API layer is responsible for sanitizing error messages before calling this.
 */
export function resolveValidationStatus(
  input: SymbolValidationInput,
  searchResults: EodhdSearchResult[] | null,
  searchError: EodhdErrorContext | null,
  samplePrice: EodhdSamplePrice | null,
): EodhdSymbolValidationResult {
  const timestamp = new Date().toISOString();
  const sourceEndpoint = 'eodhd/search';
  const base = {
    internalTicker: input.internalTicker,
    eodhdSymbol: input.eodhdSymbol,
    exchange: input.exchange,
    expectedCurrency: input.expectedCurrency,
    timestamp,
    sourceEndpoint,
  };

  // --- Error paths ---
  if (searchError) {
    if (searchError.isQuota) {
      return {
        ...base,
        confirmedCurrency: null,
        samplePrice: null,
        samplePriceDate: null,
        status: 'quota_or_rate_limited',
        warnings: [`Quota/rate limit: ${searchError.message}`],
      };
    }
    return {
      ...base,
      confirmedCurrency: null,
      samplePrice: null,
      samplePriceDate: null,
      status: 'provider_error',
      warnings: [`API error: ${searchError.message}`],
    };
  }

  if (!searchResults || searchResults.length === 0) {
    return {
      ...base,
      confirmedCurrency: null,
      samplePrice: null,
      samplePriceDate: null,
      status: 'symbol_not_found',
      warnings: [`No results returned for ${input.eodhdSymbol}`],
    };
  }

  // --- Match to expected exchange ---
  const expectedExchange = normalizeExchange(input.exchange);
  const matchingExchange = searchResults.filter(
    r => normalizeExchange(r.Exchange) === expectedExchange
  );

  if (matchingExchange.length === 0) {
    const found = [...new Set(searchResults.map(r => r.Exchange))].join(', ');
    return {
      ...base,
      confirmedCurrency: null,
      samplePrice: null,
      samplePriceDate: null,
      status: 'ambiguous_symbol',
      warnings: [
        `Symbol found on [${found}] but not on expected exchange ${input.exchange}`,
      ],
    };
  }

  if (matchingExchange.length > 1) {
    const currencies = [...new Set(matchingExchange.map(r => r.Currency))].join(', ');
    return {
      ...base,
      confirmedCurrency: null,
      samplePrice: null,
      samplePriceDate: null,
      status: 'ambiguous_symbol',
      warnings: [
        `${matchingExchange.length} matches on ${input.exchange} (currencies: ${currencies}) — cannot select unambiguously`,
      ],
    };
  }

  const match = matchingExchange[0];
  const rawCurrency = match.Currency?.trim() ?? '';

  // Prefer the dedicated EOD sample price; fall back to previousClose from search
  const effectivePrice: EodhdSamplePrice | null =
    samplePrice ??
    (match.previousClose != null && match.previousClose > 0
      ? { close: match.previousClose, date: match.previousCloseDate ?? '' }
      : null);

  const warnings: string[] = [];

  if (!rawCurrency) {
    return {
      ...base,
      confirmedCurrency: null,
      samplePrice: effectivePrice?.close ?? null,
      samplePriceDate: effectivePrice?.date ?? null,
      status: 'currency_missing',
      warnings: ['Symbol found but EODHD returned no Currency field'],
    };
  }

  // --- Explicit GBX / pence currency code ---
  if (isGbxCurrencyCode(rawCurrency)) {
    warnings.push(
      `EODHD reports currency '${rawCurrency}' (pence) — price must be ÷100 then converted GBP→EUR`
    );
    return {
      ...base,
      confirmedCurrency: rawCurrency,
      samplePrice: effectivePrice?.close ?? null,
      samplePriceDate: effectivePrice?.date ?? null,
      status: 'suspected_gbx_pence',
      warnings,
    };
  }

  const confirmedNorm = rawCurrency.toUpperCase();
  const expectedNorm = input.expectedCurrency.toUpperCase();

  // --- Currency mismatch ---
  if (confirmedNorm !== expectedNorm) {
    warnings.push(
      `Currency mismatch: expected ${input.expectedCurrency}, EODHD reports ${rawCurrency}`
    );
    return {
      ...base,
      confirmedCurrency: rawCurrency,
      samplePrice: effectivePrice?.close ?? null,
      samplePriceDate: effectivePrice?.date ?? null,
      status: 'rejected_mismatch',
      warnings,
    };
  }

  // --- GBP price heuristic (reported as GBP but price suggests pence) ---
  // Only applies on LSE — non-LSE GBP instruments are assumed to be in pounds.
  if (confirmedNorm === 'GBP' && expectedExchange === 'LSE') {
    const price = effectivePrice?.close;
    if (price != null && price > GBX_PRICE_THRESHOLD) {
      warnings.push(
        `GBP price ${price} > ${GBX_PRICE_THRESHOLD} on LSE — likely GBX (pence); ` +
        `divide by 100 before GBP→EUR conversion`
      );
      return {
        ...base,
        confirmedCurrency: rawCurrency,
        samplePrice: price,
        samplePriceDate: effectivePrice?.date ?? null,
        status: 'suspected_gbx_pence',
        warnings,
      };
    }
    if (price == null) {
      warnings.push('GBP on LSE — no sample price to confirm pounds vs pence');
    }
  }

  // --- Validated success paths ---
  if (confirmedNorm === 'EUR') {
    return {
      ...base,
      confirmedCurrency: rawCurrency,
      samplePrice: effectivePrice?.close ?? null,
      samplePriceDate: effectivePrice?.date ?? null,
      status: 'validated_exact_eur',
      warnings,
    };
  }

  if (confirmedNorm === 'USD') {
    return {
      ...base,
      confirmedCurrency: rawCurrency,
      samplePrice: effectivePrice?.close ?? null,
      samplePriceDate: effectivePrice?.date ?? null,
      status: 'validated_usd_needs_fx',
      warnings,
    };
  }

  if (confirmedNorm === 'GBP') {
    return {
      ...base,
      confirmedCurrency: rawCurrency,
      samplePrice: effectivePrice?.close ?? null,
      samplePriceDate: effectivePrice?.date ?? null,
      status: 'validated_gbp_needs_fx',
      warnings,
    };
  }

  // Unrecognized currency — confirmed but not actionable
  warnings.push(`Unrecognized currency '${rawCurrency}' — manual review required`);
  return {
    ...base,
    confirmedCurrency: rawCurrency,
    samplePrice: effectivePrice?.close ?? null,
    samplePriceDate: effectivePrice?.date ?? null,
    status: 'currency_missing',
    warnings,
  };
}
