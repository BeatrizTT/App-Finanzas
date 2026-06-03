// Multi-source discovery provider capability module.
// Pure functions only — no HTTP, no file I/O.
// All network calls live in scripts/smoke-discovery-providers.ts.

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type ProviderName =
  | 'eodhd_screener'
  | 'fmp_screener'
  | 'finnhub'
  | 'alpha_vantage'
  | 'twelve_data'
  | 'yahoo_fallback';

export type UsableFor =
  | 'candidate_discovery'
  | 'pricing_validation'
  | 'historical_drawdown'
  | 'research_only'
  | 'not_usable';

export interface ProviderCapabilityResult {
  provider: ProviderName;
  supported: boolean;
  statusCode?: number;
  resultCount: number;
  fieldsAvailable: string[];
  limitsKnown: string[];
  warnings: string[];
  usableFor: UsableFor;
  sampleTickers: string[];
  callUnitsEstimated?: number;
}

export interface SmokeSummary {
  candidateDiscoveryProviders: string[];
  pricingValidationProviders: string[];
  historicalDrawdownProviders: string[];
  researchOnlyProviders: string[];
  recommendedNextProvider: string | null;
  warnings: string[];
}

export interface ProviderCapabilitySmokeReport {
  version: 1;
  runAt: string;
  results: ProviderCapabilityResult[];
  summary: SmokeSummary;
}

// --------------------------------------------------------------------------
// Sanitiser — strips API key patterns from any string
// --------------------------------------------------------------------------

/**
 * Removes API key values from URL query strings and known secret values.
 * Pass `keysToRedact` with the actual env var values so they never appear
 * in logs or persisted reports.
 */
export function sanitizeString(s: string, keysToRedact: string[] = []): string {
  // Strip URL query param values matching common API key param names
  let result = s.replace(
    /([?&](api_token|apikey|api_key|token|key|access_key|secret|appid))=[^&\s"')\]]+/gi,
    '$1=[REDACTED]'
  );
  // Strip known secret values
  for (const key of keysToRedact) {
    if (typeof key === 'string' && key.length > 4) {
      result = result.split(key).join('[REDACTED]');
    }
  }
  return result;
}

/**
 * Validates that a serialised report JSON contains no obvious API key leaks.
 * Returns false if a leak is detected.
 */
export function validateReportSecurity(
  reportJson: string,
  keysToCheck: string[] = []
): boolean {
  // Reject if URL param with key-like value is present
  if (/[?&](api_token|apikey|api_key|token|key|secret|access_key)=[^&\s"')\]]{8,}/i.test(reportJson)) {
    return false;
  }
  // Reject if known secret value appears verbatim
  for (const key of keysToCheck) {
    if (typeof key === 'string' && key.length > 4 && reportJson.includes(key)) {
      return false;
    }
  }
  return true;
}

// --------------------------------------------------------------------------
// Generic result builders
// --------------------------------------------------------------------------

export function buildMissingKeyResult(provider: ProviderName): ProviderCapabilityResult {
  return {
    provider,
    supported: false,
    resultCount: 0,
    fieldsAvailable: [],
    limitsKnown: [],
    warnings: ['missing_key'],
    usableFor: 'not_usable',
    sampleTickers: [],
    ...(provider === 'eodhd_screener' ? { callUnitsEstimated: 5 } : {}),
  };
}

export function buildNetworkErrorResult(
  provider: ProviderName,
  sanitizedError: string
): ProviderCapabilityResult {
  return {
    provider,
    supported: false,
    resultCount: 0,
    fieldsAvailable: [],
    limitsKnown: [],
    warnings: [`network_error: ${sanitizedError}`],
    usableFor: 'not_usable',
    sampleTickers: [],
    ...(provider === 'eodhd_screener' ? { callUnitsEstimated: 5 } : {}),
  };
}

// --------------------------------------------------------------------------
// EODHD Screener parser
// NOTE: Each screener request consumes 5 EODHD API call units.
// --------------------------------------------------------------------------

export function parseEodhdScreenerResponse(
  body: unknown,
  statusCode: number
): ProviderCapabilityResult {
  const base: Pick<ProviderCapabilityResult, 'provider' | 'callUnitsEstimated'> = {
    provider: 'eodhd_screener',
    callUnitsEstimated: 5,
  };

  if (statusCode === 401 || statusCode === 403) {
    return {
      ...base,
      supported: false,
      statusCode,
      resultCount: 0,
      fieldsAvailable: [],
      limitsKnown: ['screener_requires_eligible_plan'],
      warnings: ['auth_or_plan_required'],
      usableFor: 'not_usable',
      sampleTickers: [],
    };
  }

  if (statusCode === 402) {
    return {
      ...base,
      supported: false,
      statusCode,
      resultCount: 0,
      fieldsAvailable: [],
      limitsKnown: ['screener_not_included_in_current_plan'],
      warnings: ['plan_upgrade_required'],
      usableFor: 'not_usable',
      sampleTickers: [],
    };
  }

  if (statusCode !== 200 || !body || typeof body !== 'object') {
    return {
      ...base,
      supported: false,
      statusCode,
      resultCount: 0,
      fieldsAvailable: [],
      limitsKnown: [],
      warnings: [`unexpected_status_or_body:${statusCode}`],
      usableFor: 'not_usable',
      sampleTickers: [],
    };
  }

  // EODHD screener may return { total, data: [...] } or a bare array
  const obj = body as Record<string, unknown>;
  let hits: unknown[] = [];
  if (Array.isArray(body)) {
    hits = body;
  } else if (Array.isArray(obj.data)) {
    hits = obj.data as unknown[];
  } else if (Array.isArray(obj.hits)) {
    hits = obj.hits as unknown[];
  }

  const fieldsAvailable = hits.length > 0
    ? Object.keys(hits[0] as Record<string, unknown>)
    : [];

  const sampleTickers: string[] = [];
  for (const hit of hits.slice(0, 3)) {
    const h = hit as Record<string, unknown>;
    const ticker = h.code ?? h.ticker ?? h.symbol ?? h.Code ?? h.Symbol;
    if (typeof ticker === 'string') sampleTickers.push(ticker);
  }

  const supported = hits.length > 0;

  return {
    ...base,
    supported,
    statusCode,
    resultCount: hits.length,
    fieldsAvailable,
    limitsKnown: ['5_call_units_per_screener_request'],
    warnings: supported ? [] : ['zero_results_check_filters_or_plan'],
    usableFor: supported ? 'candidate_discovery' : 'not_usable',
    sampleTickers,
  };
}

// --------------------------------------------------------------------------
// FMP Screener parser
// --------------------------------------------------------------------------

export function parseFmpScreenerResponse(
  body: unknown,
  statusCode: number
): ProviderCapabilityResult {
  const provider: ProviderName = 'fmp_screener';

  if (statusCode === 401 || statusCode === 403) {
    return {
      provider, supported: false, statusCode, resultCount: 0,
      fieldsAvailable: [], limitsKnown: [],
      warnings: ['auth_failed'], usableFor: 'not_usable', sampleTickers: [],
    };
  }

  if (statusCode !== 200 || !Array.isArray(body)) {
    return {
      provider, supported: false, statusCode, resultCount: 0,
      fieldsAvailable: [], limitsKnown: [],
      warnings: [`unexpected_response:${statusCode}`], usableFor: 'not_usable', sampleTickers: [],
    };
  }

  const hits = body as Record<string, unknown>[];
  const fieldsAvailable = hits.length > 0 ? Object.keys(hits[0]) : [];
  const sampleTickers = hits.slice(0, 3)
    .map(h => h.symbol as string)
    .filter(Boolean);

  const supported = hits.length > 0;
  const fmpExpectedFields = ['symbol', 'companyName', 'marketCap', 'sector', 'industry', 'beta', 'price', 'volume'];
  const presentExpected = fmpExpectedFields.filter(f => fieldsAvailable.includes(f));

  return {
    provider, supported, statusCode,
    resultCount: hits.length,
    fieldsAvailable,
    limitsKnown: ['250_requests_per_day_free_tier'],
    warnings: presentExpected.length < 4 ? ['fewer_fields_than_expected'] : [],
    usableFor: supported ? 'candidate_discovery' : 'not_usable',
    sampleTickers,
  };
}

// --------------------------------------------------------------------------
// Finnhub parser
// --------------------------------------------------------------------------

export function parseFinnhubResponse(
  body: unknown,
  statusCode: number
): ProviderCapabilityResult {
  const provider: ProviderName = 'finnhub';

  if (statusCode === 401 || statusCode === 403) {
    return {
      provider, supported: false, statusCode, resultCount: 0,
      fieldsAvailable: [], limitsKnown: [],
      warnings: ['auth_failed'], usableFor: 'not_usable', sampleTickers: [],
    };
  }

  if (statusCode !== 200 || !body || typeof body !== 'object') {
    return {
      provider, supported: false, statusCode, resultCount: 0,
      fieldsAvailable: [], limitsKnown: [],
      warnings: [`unexpected_response:${statusCode}`], usableFor: 'not_usable', sampleTickers: [],
    };
  }

  const obj = body as Record<string, unknown>;
  const fieldsAvailable = Object.keys(obj);

  // Finnhub's free screener is limited — mainly useful for enrichment/quotes
  // A successful profile or quote response indicates pricing_validation use
  const hasQuoteFields = fieldsAvailable.some(f => ['c', 'h', 'l', 'o', 'pc'].includes(f));
  const hasSymbolList = Array.isArray(obj.result) || Array.isArray(obj.data);

  const usableFor: UsableFor = hasSymbolList
    ? 'candidate_discovery'
    : 'pricing_validation';

  return {
    provider, supported: true, statusCode,
    resultCount: hasSymbolList
      ? ((obj.result ?? obj.data) as unknown[]).length
      : (hasQuoteFields ? 1 : 0),
    fieldsAvailable,
    limitsKnown: ['60_api_calls_per_minute_free', 'limited_screener_on_free_plan'],
    warnings: hasSymbolList ? [] : ['no_screener_endpoint_on_free_plan_enrichment_only'],
    usableFor,
    sampleTickers: [],
  };
}

// --------------------------------------------------------------------------
// Alpha Vantage parser
// --------------------------------------------------------------------------

export function parseAlphaVantageResponse(
  body: unknown,
  statusCode: number
): ProviderCapabilityResult {
  const provider: ProviderName = 'alpha_vantage';

  if (statusCode !== 200 || !body || typeof body !== 'object') {
    return {
      provider, supported: false, statusCode, resultCount: 0,
      fieldsAvailable: [], limitsKnown: [],
      warnings: [`unexpected_response:${statusCode}`], usableFor: 'not_usable', sampleTickers: [],
    };
  }

  const obj = body as Record<string, unknown>;

  // Alpha Vantage rate-limit response: { "Note": "..." } or { "Information": "..." }
  if (typeof obj.Note === 'string' || typeof obj.Information === 'string') {
    return {
      provider, supported: false, statusCode,
      resultCount: 0, fieldsAvailable: [], sampleTickers: [],
      limitsKnown: ['25_requests_per_day_free_tier'],
      warnings: ['quota_or_rate_limit_hit'],
      usableFor: 'not_usable',
    };
  }

  const fieldsAvailable = Object.keys(obj);
  // Alpha Vantage returns historical data — useful for drawdown calculation, not screening
  const hasTimeSeries = fieldsAvailable.some(f => f.includes('Time Series'));
  const hasMetaData = 'Meta Data' in obj;

  return {
    provider, supported: true, statusCode,
    resultCount: hasTimeSeries ? 1 : 0,
    fieldsAvailable,
    limitsKnown: ['25_requests_per_day_free_tier', 'no_screener_with_filters'],
    warnings: ['not_suitable_as_main_screener', 'drawdown_calculation_only'],
    usableFor: hasTimeSeries || hasMetaData ? 'historical_drawdown' : 'research_only',
    sampleTickers: [],
  };
}

// --------------------------------------------------------------------------
// Twelve Data parser
// --------------------------------------------------------------------------

export function parseTwelveDataResponse(
  body: unknown,
  statusCode: number
): ProviderCapabilityResult {
  const provider: ProviderName = 'twelve_data';

  if (statusCode !== 200 || !body || typeof body !== 'object') {
    return {
      provider, supported: false, statusCode, resultCount: 0,
      fieldsAvailable: [], limitsKnown: [],
      warnings: [`unexpected_response:${statusCode}`], usableFor: 'not_usable', sampleTickers: [],
    };
  }

  const obj = body as Record<string, unknown>;

  // Twelve Data quota error: { "code": 429, "message": "..." } or { "status": "error" }
  if (obj.code === 429 || obj.status === 'error') {
    return {
      provider, supported: false, statusCode,
      resultCount: 0, fieldsAvailable: [], sampleTickers: [],
      limitsKnown: ['credits_based_pricing'],
      warnings: ['quota_exceeded_or_error'],
      usableFor: 'not_usable',
    };
  }

  const fieldsAvailable = Object.keys(obj);
  const hasValues = Array.isArray(obj.values) && (obj.values as unknown[]).length > 0;
  const hasPrice = typeof obj.price === 'string' || typeof obj.price === 'number';

  return {
    provider,
    supported: hasValues || hasPrice,
    statusCode,
    resultCount: hasValues ? (obj.values as unknown[]).length : (hasPrice ? 1 : 0),
    fieldsAvailable,
    limitsKnown: ['credits_based_pricing', 'no_screener_with_drawdown_filters'],
    warnings: ['pricing_and_historical_only', 'not_suitable_as_discovery_screener'],
    usableFor: hasValues || hasPrice ? 'pricing_validation' : 'research_only',
    sampleTickers: [],
  };
}

// --------------------------------------------------------------------------
// Yahoo fallback — static assessment, no HTTP call
// --------------------------------------------------------------------------

export function yahooFallbackResult(): ProviderCapabilityResult {
  return {
    provider: 'yahoo_fallback',
    supported: true,
    resultCount: 0,
    fieldsAvailable: ['price', 'previousClose', 'regularMarketChange', 'fiftyTwoWeekHigh', 'fiftyTwoWeekLow'],
    limitsKnown: ['unofficial_api', 'rate_limited', 'no_screener_endpoint', 'unstable_for_production'],
    warnings: [
      'unofficial_source',
      'not_stable_for_production_use',
      'research_only',
      'never_candidate_discovery',
    ],
    usableFor: 'research_only',
    sampleTickers: [],
  };
}

// --------------------------------------------------------------------------
// Summary builder
// --------------------------------------------------------------------------

export function buildSummary(results: ProviderCapabilityResult[]): SmokeSummary {
  const byUsage = (u: UsableFor): string[] =>
    results.filter(r => r.usableFor === u).map(r => r.provider);

  const discoveryProviders = byUsage('candidate_discovery');
  const warnings: string[] = [];

  let recommendedNextProvider: string | null = null;
  if (discoveryProviders.includes('eodhd_screener')) {
    recommendedNextProvider = 'eodhd_screener';
  } else if (discoveryProviders.includes('fmp_screener')) {
    recommendedNextProvider = 'fmp_screener';
  } else if (discoveryProviders.length > 0) {
    recommendedNextProvider = discoveryProviders[0];
  } else {
    warnings.push('no_candidate_discovery_provider_available');
    warnings.push('consider_paid_plan_or_evaluate_fmp_trial_key');
  }

  return {
    candidateDiscoveryProviders: discoveryProviders,
    pricingValidationProviders: byUsage('pricing_validation'),
    historicalDrawdownProviders: byUsage('historical_drawdown'),
    researchOnlyProviders: byUsage('research_only'),
    recommendedNextProvider,
    warnings,
  };
}
