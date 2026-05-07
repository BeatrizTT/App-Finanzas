// EODHD Historical Data provider
// Requires: EODHD_API_KEY + EODHD_ENABLED=true
// Budget: EODHD_MAX_CALLS_PER_RUN (default 10) — enforced per engine run
//
// All SYMBOL_MAP entries are validated=false until P2c confirms tickers with
// real API responses. The EODHD EOD endpoint does not return currency, so all
// prices from this provider use unconfirmedCurrencyValidation — drawdown only.
// currentPrice is null for any result where currency cannot be confirmed.

import { calcDrawdownPct } from '../utils/math';
import type { PriceProvider } from './interface';
import type { PriceValidation } from '../types';
import type { PriceData, HistoricalPrices, RecentHighs, HistoricalPrice } from '../types';
import {
  unavailableValidation,
  unconfirmedCurrencyValidation,
  usdNoFxValidation,
} from './price-validation';

// ---------------------------------------------------------------------------
// Symbol map — best-guess EODHD tickers, all validated=false until P2c
// ---------------------------------------------------------------------------

interface EodhdSymbolEntry {
  eodhdTicker: string;       // "TICKER.EXCHANGE" format used by EODHD API
  inferredCurrency: string;  // derived from exchange code
  lseMaybePence: boolean;    // true = LSE-listed, price may be in GBX (pence)
  validated: boolean;        // false until a real API response confirms this ticker
}

const SYMBOL_MAP: Record<string, EodhdSymbolEntry> = {
  // --- EUR instruments (Euronext / Xetra) ---
  ASML:  { eodhdTicker: 'ASML.AS',     inferredCurrency: 'EUR', lseMaybePence: false, validated: false },
  VWCE:  { eodhdTicker: 'VWCE.XETRA',  inferredCurrency: 'EUR', lseMaybePence: false, validated: false },
  // --- LSE instruments — GBP or GBX, price zeroed until P2c confirms ---
  CNDX:  { eodhdTicker: 'CNDX.LSE',    inferredCurrency: 'GBP', lseMaybePence: true,  validated: false },
  IWDA:  { eodhdTicker: 'IWDA.LSE',    inferredCurrency: 'GBP', lseMaybePence: true,  validated: false },
  IWVL:  { eodhdTicker: 'IWVL.LSE',    inferredCurrency: 'GBP', lseMaybePence: true,  validated: false },
  CSPX:  { eodhdTicker: 'CSPX.LSE',    inferredCurrency: 'GBP', lseMaybePence: true,  validated: false },
  EMIM:  { eodhdTicker: 'EMIM.LSE',    inferredCurrency: 'GBP', lseMaybePence: true,  validated: false },
  SEMI:  { eodhdTicker: 'VSEM.LSE',    inferredCurrency: 'GBP', lseMaybePence: true,  validated: false },
  // --- USD instruments (.US) ---
  NVDA:  { eodhdTicker: 'NVDA.US',     inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  MSFT:  { eodhdTicker: 'MSFT.US',     inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  AMZN:  { eodhdTicker: 'AMZN.US',     inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  SMCI:  { eodhdTicker: 'SMCI.US',     inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  CRM:   { eodhdTicker: 'CRM.US',      inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  NOW:   { eodhdTicker: 'NOW.US',      inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  ADBE:  { eodhdTicker: 'ADBE.US',     inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  ORCL:  { eodhdTicker: 'ORCL.US',     inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  TSLA:  { eodhdTicker: 'TSLA.US',     inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  MU:    { eodhdTicker: 'MU.US',       inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  // --- Market proxies (USD, drawdown only) ---
  SPY:   { eodhdTicker: 'SPY.US',      inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  QQQ:   { eodhdTicker: 'QQQ.US',      inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  VTV:   { eodhdTicker: 'VTV.US',      inferredCurrency: 'USD', lseMaybePence: false, validated: false },
  VOO:   { eodhdTicker: 'VOO.US',      inferredCurrency: 'USD', lseMaybePence: false, validated: false },
};

// ---------------------------------------------------------------------------
// Budget tracking — scoped per engine run via resetEodhdBudget()
// ---------------------------------------------------------------------------

let _callsThisRun = 0;
let _budgetExhausted = false;

function budgetLimit(): number {
  const v = parseInt(process.env.EODHD_MAX_CALLS_PER_RUN ?? '10', 10);
  return Number.isFinite(v) && v > 0 ? v : 10;
}

/** Call at the start of each engine run (alongside resetPriceProvider). */
export function resetEodhdBudget(): void {
  _callsThisRun = 0;
  _budgetExhausted = false;
}

export function getEodhdBudgetStats(): { used: number; limit: number; exhausted: boolean } {
  return { used: _callsThisRun, limit: budgetLimit(), exhausted: _budgetExhausted };
}

function tryConsumeBudget(): boolean {
  if (_budgetExhausted) return false;
  if (_callsThisRun >= budgetLimit()) {
    _budgetExhausted = true;
    console.warn(`[EODHD] Budget limit (${budgetLimit()}) reached — remaining symbols use cache/fallback`);
    return false;
  }
  _callsThisRun++;
  return true;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

type EodhdErrorKind = 'quota' | 'auth' | 'not_found' | 'timeout' | 'parse' | 'http';

class EodhdError extends Error {
  constructor(
    message: string,
    public readonly kind: EodhdErrorKind
  ) {
    super(message);
    this.name = 'EodhdError';
  }
}

/** Strip API key from any string before logging or rethrowing. */
function sanitizeMsg(msg: string): string {
  const key = process.env.EODHD_API_KEY;
  if (key && key.length > 4) return msg.replaceAll(key, '[REDACTED]');
  return msg;
}

// ---------------------------------------------------------------------------
// HTTP layer — key is appended last, never logged
// ---------------------------------------------------------------------------

const BASE_EOD = 'https://eodhd.com/api/eod';
const FETCH_TIMEOUT_MS = 15_000;

interface EodhdEodRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
}

async function fetchEodHistory(eodhdTicker: string, fromDate: string): Promise<EodhdEodRow[]> {
  const apiKey = process.env.EODHD_API_KEY;
  if (!apiKey) throw new EodhdError('EODHD_API_KEY not set', 'auth');

  const params = new URLSearchParams({ from: fromDate, period: 'd', order: 'd', fmt: 'json' });
  // Log path without key
  console.log(`[EODHD] GET /eod/${eodhdTicker}?${params}`);

  const url = `${BASE_EOD}/${eodhdTicker}?${params}&api_token=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('timeout')) {
      throw new EodhdError('Request timed out', 'timeout');
    }
    throw new EodhdError(sanitizeMsg(msg), 'http');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new EodhdError('Unauthorized — check EODHD_API_KEY', 'auth');
  }
  if (res.status === 404) {
    throw new EodhdError(`Symbol not found: ${eodhdTicker}`, 'not_found');
  }
  if (res.status === 402 || res.status === 429) {
    _budgetExhausted = true;
    throw new EodhdError('API quota exceeded', 'quota');
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new EodhdError('Invalid JSON response', 'parse');
  }

  // EODHD returns error details inside 200 responses in some cases
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    const msg = String(obj.message ?? obj.error ?? '');
    if (obj.status === 402 || msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('quota')) {
      _budgetExhausted = true;
      throw new EodhdError('API quota exceeded', 'quota');
    }
    if (obj.status === 401 || obj.status === 403) {
      throw new EodhdError('Unauthorized', 'auth');
    }
    if (msg) {
      throw new EodhdError(sanitizeMsg(msg), 'http');
    }
    // Unexpected non-array response with no clear error
    return [];
  }

  if (!Array.isArray(body)) return [];
  return body as EodhdEodRow[];
}

// ---------------------------------------------------------------------------
// Price parsing helpers
// ---------------------------------------------------------------------------

function parseRows(rows: EodhdEodRow[]): HistoricalPrice[] {
  return rows
    .map(r => ({
      date:   r.date,
      close:  r.close,
      high:   r.high,
      low:    r.low,
      volume: r.volume,
    }))
    .filter(p => p.close > 0)
    .reverse(); // EODHD returns newest-first (order=d); reverse to oldest-first
}

function calcHighs(
  prices: HistoricalPrice[],
  currentPrice: number,
  windows: number[]
): number[] {
  const now = new Date();
  return windows.map(days => {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return prices
      .filter(p => new Date(p.date) >= cutoff)
      .reduce((max, p) => Math.max(max, p.high), currentPrice);
  });
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Validation selection
// EODHD EOD endpoint never returns currency — all results are currency_unconfirmed.
// Only USD instruments get usdNoFxValidation (semantically accurate: USD raw price,
// engine handles FX conversion). EUR and LSE instruments get unconfirmedCurrencyValidation
// since we cannot confirm their currency without a real-time response (P2c).
// ---------------------------------------------------------------------------

function buildValidation(
  symbol: string,
  entry: EodhdSymbolEntry
): { validation: PriceValidation; currentPriceUsable: boolean } {
  if (entry.inferredCurrency === 'USD') {
    return {
      validation: usdNoFxValidation(symbol, 'eodhd'),
      currentPriceUsable: true, // USD price intact; engine applies FX conversion
    };
  }
  if (entry.inferredCurrency === 'EUR') {
    return {
      validation: unconfirmedCurrencyValidation(
        symbol, 'eodhd', 'EUR',
        `Euronext/Xetra instrument — currency inferred from exchange suffix, not confirmed by EODHD EOD response (validated=false until P2c)`
      ),
      currentPriceUsable: false, // EUR not confirmed; null until P2c validation
    };
  }
  // GBP/GBX (LSE) — price could be in pence; null until P2c confirms
  return {
    validation: unconfirmedCurrencyValidation(
      symbol, 'eodhd', 'GBP',
      `LSE instrument — may be GBX (pence); currency not confirmed by EODHD EOD response (validated=false until P2c)`
    ),
    currentPriceUsable: false,
  };
}

// ---------------------------------------------------------------------------
// EodhdPriceProvider — implements PriceProvider
// ---------------------------------------------------------------------------

export class EodhdPriceProvider implements PriceProvider {
  readonly providerName = 'eodhd';

  async getCurrentPrice(symbol: string): Promise<PriceData> {
    const entry = SYMBOL_MAP[symbol.toUpperCase()];
    if (!entry) throw new Error(`[EODHD] Symbol not in map: ${symbol}`);

    if (!tryConsumeBudget()) {
      throw new Error(`[EODHD] Budget exhausted — cannot fetch ${symbol}`);
    }

    const rows = await fetchEodHistory(entry.eodhdTicker, isoDateDaysAgo(5));
    const latest = rows[rows.length - 1];
    if (!latest) throw new Error(`[EODHD] No data returned for ${entry.eodhdTicker}`);

    return {
      symbol,
      currentPrice: latest.close,
      currency: entry.inferredCurrency,
      timestamp: new Date(latest.date),
    };
  }

  async getHistoricalPrices(symbol: string, days: number): Promise<HistoricalPrices> {
    const entry = SYMBOL_MAP[symbol.toUpperCase()];
    if (!entry) throw new Error(`[EODHD] Symbol not in map: ${symbol}`);

    if (!tryConsumeBudget()) {
      throw new Error(`[EODHD] Budget exhausted — cannot fetch ${symbol}`);
    }

    const fromDate = isoDateDaysAgo(days + 5);
    const rows = await fetchEodHistory(entry.eodhdTicker, fromDate);
    return { symbol, prices: parseRows(rows) };
  }

  async getRecentHighs(symbol: string, windows = [30, 60, 90]): Promise<RecentHighs> {
    const entry = SYMBOL_MAP[symbol.toUpperCase()];
    if (!entry) {
      console.warn(`[EODHD] Symbol not in map: ${symbol} — returning unavailable`);
      return nullHighs(symbol, unavailableValidation(symbol));
    }

    if (!tryConsumeBudget()) {
      console.warn(`[EODHD] Budget exhausted — skipping ${symbol} (${_callsThisRun}/${budgetLimit()} calls used this run); P&L and buy sizing unavailable`);
      return nullHighs(symbol, {
        ...unavailableValidation(symbol),
        note: `EODHD budget exhausted (${_callsThisRun}/${budgetLimit()} calls this run) — use cache or fallback provider`,
      });
    }

    let rows: EodhdEodRow[];
    try {
      rows = await fetchEodHistory(entry.eodhdTicker, isoDateDaysAgo(95));
    } catch (err) {
      const kind = err instanceof EodhdError ? err.kind : 'http';
      const msg = err instanceof Error ? sanitizeMsg(err.message) : String(err);

      if (kind === 'quota') {
        console.warn(`[EODHD] Quota exceeded fetching ${symbol}`);
      } else if (kind === 'not_found') {
        console.warn(`[EODHD] Symbol ${entry.eodhdTicker} not found — update SYMBOL_MAP if ticker is wrong`);
      } else if (kind === 'auth') {
        console.error(`[EODHD] Auth failure — check EODHD_API_KEY`);
      } else {
        console.warn(`[EODHD] Fetch failed for ${symbol}: ${msg}`);
      }

      return nullHighs(symbol, unavailableValidation(symbol));
    }

    const prices = parseRows(rows);
    if (prices.length === 0) {
      console.warn(`[EODHD] Empty response for ${entry.eodhdTicker}`);
      return nullHighs(symbol, unavailableValidation(symbol));
    }

    const rawPrice = prices[prices.length - 1].close;
    const [high30d, high60d, high90d] = calcHighs(prices, rawPrice, windows);

    const { validation, currentPriceUsable } = buildValidation(symbol, entry);
    // currentPrice is null when currency is unconfirmed — engine and UI must show "—"
    const currentPrice = currentPriceUsable ? rawPrice : null;

    return {
      symbol,
      high30d, high60d, high90d,
      currentPrice,
      drawdown30d: calcDrawdownPct(high30d, rawPrice),
      drawdown60d: calcDrawdownPct(high60d, rawPrice),
      drawdown90d: calcDrawdownPct(high90d, rawPrice),
      validation,
    };
  }
}

// Returns a RecentHighs with null currentPrice and zeroed drawdowns (no usable data)
function nullHighs(symbol: string, validation: RecentHighs['validation']): RecentHighs {
  return {
    symbol,
    high30d: 0, high60d: 0, high90d: 0,
    currentPrice: null,
    drawdown30d: 0, drawdown60d: 0, drawdown90d: 0,
    validation,
  };
}
