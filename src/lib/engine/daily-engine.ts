// Daily engine orchestrator — runs all three engines and produces output
// Called by the scheduler, API route, or CLI script

import { runPortfolioEngine } from '../portfolio/engine';
import { runOpportunityScanner } from '../scanner/scanner';
import { runCapitalAllocator } from '../allocator/allocator';
import { generateAlerts } from '../alerts/generator';
import { sendAlerts } from '../alerts/telegram';
import { sendDailyDigest } from '../alerts/digest';
import { saveAlerts } from '../alerts/history';
import { getPriceProvider, resetPriceProvider } from '../pricing/factory';
import { resetEodhdBudget } from '../pricing/eodhd-provider';
import { loadPriceCache, savePriceCache, getCached, setCached, countStale, getEurUsdRate, setEurUsdRate } from '../pricing/price-cache';
import {
  getEffectivePortfolioConfig,
  getUniverseConfig,
  getOverridesConfig,
  clearConfigCache,
  applyOverridesToPortfolio,
} from '../utils/config-loader';
import { saveEngineOutput } from '../utils/engine-store';
import type {
  DailyEngineOutput,
  RecentHighs,
  UniverseAsset,
  ConcentrationData,
  PricingPurpose,
} from '../types';

const EMPTY_CONCENTRATION: ConcentrationData = {
  totalPortfolioValue: 0,
  sectorWeights: {},
  themeWeights: {},
  stockVsEtfRatio: { stocks: 0, etfs: 0 },
  highConcentrationWarnings: [],
};

// --------------------------------------------------------------------------
// Fetch all prices needed for one engine run
// --------------------------------------------------------------------------

// Free-tier Twelve Data allows 8 symbols/minute (each symbol = 1 credit).
// We cache prices for 4 hours so most runs use zero API credits.
const BATCH_CREDIT_LIMIT = 8;
const CACHE_TTL_LABEL = '4h';

async function fetchAllPrices(
  portfolioTickers: string[],
  universeTickers: string[]
): Promise<{ allHighs: Record<string, RecentHighs>; errors: string[] }> {
  const provider = getPriceProvider();
  // Portfolio symbols have priority — checked first for cache misses
  const allTickers = Array.from(new Set([...portfolioTickers, ...universeTickers]));
  const errors: string[] = [];
  const allHighs: Record<string, RecentHighs> = {};

  // ----- MOCK / providers without batch support: skip cache, fetch directly -----
  if (!provider.batchGetRecentHighs) {
    console.log(`[Engine] ${provider.providerName}: sequential fetch for ${allTickers.length} assets`);
    const BATCH_SIZE = 10;
    for (let i = 0; i < allTickers.length; i += BATCH_SIZE) {
      const batch = allTickers.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (ticker) => {
          // Purpose-aware fetch: portfolio holdings need exact_pnl (confirmed currency, no proxy);
          // universe scanner needs buy_recommendation (will accept USD-converted prices).
          // Non-chain providers ignore this and fall back to standard getRecentHighs.
          const purpose: PricingPurpose = portfolioTickers.includes(ticker)
            ? 'exact_pnl'
            : 'buy_recommendation';
          const highs = provider.getRecentHighsForPurpose
            ? await provider.getRecentHighsForPurpose(ticker, purpose)
            : await provider.getRecentHighs(ticker);
          return { ticker, highs };
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') allHighs[r.value.ticker] = r.value.highs;
        else errors.push(`Price fetch failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      }
      if (process.env.PRICE_PROVIDER === 'yahoo' && i + BATCH_SIZE < allTickers.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    console.log(`[Engine] Prices fetched: ${Object.keys(allHighs).length}/${allTickers.length}`);
    return { allHighs, errors };
  }

  // ----- Batch provider (Twelve Data): use cache to stay within 8 credits/min -----
  const cache = loadPriceCache();
  const staleSymbols: string[] = [];

  // Load fresh prices from cache
  for (const ticker of allTickers) {
    const cached = getCached(cache, ticker);
    if (cached) {
      allHighs[ticker] = cached;
    } else {
      staleSymbols.push(ticker);
    }
  }

  const stalePriority = [
    // portfolio symbols first, then universe
    ...staleSymbols.filter(t => portfolioTickers.includes(t)),
    ...staleSymbols.filter(t => !portfolioTickers.includes(t)),
  ];

  const staleCount = stalePriority.length;
  const toFetch = stalePriority.slice(0, BATCH_CREDIT_LIMIT);
  const deferred = stalePriority.slice(BATCH_CREDIT_LIMIT);

  console.log(
    `[Engine] Price cache: ${allTickers.length - staleCount} fresh (${CACHE_TTL_LABEL} TTL), ` +
    `${staleCount} stale — fetching ${toFetch.length}, deferring ${deferred.length}`
  );

  if (toFetch.length > 0) {
    try {
      const freshHighs = await provider.batchGetRecentHighs(toFetch);
      for (const [sym, highs] of Object.entries(freshHighs)) {
        allHighs[sym] = highs;
        setCached(cache, sym, highs);
      }
      savePriceCache(cache);
      // Only report missing data as errors for portfolio holdings (actionable).
      // Universe scanner misses are expected on free-tier and logged separately.
      const missed = toFetch.filter(t => !freshHighs[t]);
      for (const t of missed) {
        if (portfolioTickers.includes(t)) {
          errors.push(`No data for ${t}`);
        } else {
          console.warn(`[Engine] No price data for universe symbol ${t} (will retry next run)`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Engine] Batch fetch failed: ${msg}`);
      errors.push(`Batch fetch failed: ${msg}`);
    }
  }

  if (deferred.length > 0) {
    console.log(`[Engine] ${deferred.length} universe symbols deferred (rate limit) — will refresh on next run`);
  }

  console.log(`[Engine] Prices available: ${Object.keys(allHighs).length}/${allTickers.length}`);
  return { allHighs, errors };
}

// --------------------------------------------------------------------------
// Estimate market max drawdown (from broad index ETFs if available)
// --------------------------------------------------------------------------

function estimateMarketDrawdown(allHighs: Record<string, RecentHighs>): number {
  const marketProxies = ['SPY', 'QQQ', 'VOO', 'IWDA'];
  const drawdowns: number[] = [];

  for (const proxy of marketProxies) {
    const highs = allHighs[proxy];
    if (highs) {
      drawdowns.push(Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d));
    }
  }

  if (drawdowns.length === 0) return 10; // default assumption
  return drawdowns.reduce((s, d) => s + d, 0) / drawdowns.length;
}

// --------------------------------------------------------------------------
// EUR/USD exchange rate — used to convert USD prices to EUR for P&L accuracy.
// Trade Republic CSV exports all transaction amounts in EUR (avgPrice = EUR cost).
// Twelve Data returns US stock prices in USD. Without conversion, P&L is wrong.
// Rate cached for 4 hours alongside price data (no extra API key required).
// --------------------------------------------------------------------------

async function fetchEurUsdRate(): Promise<number> {
  const cache = loadPriceCache();
  const cached = getEurUsdRate(cache);
  if (cached) {
    console.log(`[Engine] EUR/USD rate: ${cached.toFixed(4)} (cached)`);
    return cached;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/EUR', {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json() as { rates?: Record<string, number> };
      const rate = data.rates?.USD;
      if (rate && rate > 0.5 && rate < 3) { // sanity check
        setEurUsdRate(cache, rate);
        savePriceCache(cache);
        console.log(`[Engine] EUR/USD rate: ${rate.toFixed(4)} (fresh)`);
        return rate;
      }
    }
  } catch (err) {
    console.warn('[Engine] EUR/USD rate fetch failed:', err instanceof Error ? err.message : err);
  }

  const fallback = 1.08;
  console.warn(`[Engine] Using fallback EUR/USD rate: ${fallback}`);
  return fallback;
}

// --------------------------------------------------------------------------
// Main engine run function
// --------------------------------------------------------------------------

export async function runDailyEngine(options?: {
  sendDigest?: boolean;
  sendAlertMessages?: boolean;
}): Promise<DailyEngineOutput> {
  const runAt = new Date().toISOString();
  const errors: string[] = [];

  console.log(`[Engine] Starting daily engine run at ${runAt}`);

  // Reload config on each run (supports live config edits)
  clearConfigCache();
  resetPriceProvider();
  resetEodhdBudget(); // reset per-run EODHD call counter (no-op when EODHD not active)

  // Evict cached prices for drawdown-only proxies (CNDX, IWVL) — they were previously
  // stored with a non-zero USD currentPrice which gives wrong P&L vs EUR avgPrice.
  // The fix stores currentPrice=0, but old cache entries must be cleared first.
  {
    const cache = loadPriceCache();
    let evicted = false;
    for (const sym of ['CNDX', 'IWVL']) {
      if (cache[sym] && (cache[sym] as any).data?.currentPrice > 0) {
        delete cache[sym];
        evicted = true;
      }
    }
    if (evicted) savePriceCache(cache);
  }

  const portfolioConfig = applyOverridesToPortfolio(getEffectivePortfolioConfig());
  const universeConfig = getUniverseConfig();
  const overrides = getOverridesConfig();

  // Collect all tickers to fetch
  const portfolioTickers = portfolioConfig.holdings
    .map((h) => h.ticker ?? h.id.toUpperCase())
    .filter(Boolean);

  const isVercel = !!process.env.VERCEL;

  // On Vercel Hobby (60s limit) skip extended universe — seed + portfolio is enough
  const allUniverseAssets: UniverseAsset[] = [
    ...universeConfig.seedStocks,
    ...universeConfig.seedEtfs,
    ...(isVercel ? [] : universeConfig.extendedStocks),
    ...(isVercel ? [] : universeConfig.extendedEtfs),
  ];
  const universeTickers = allUniverseAssets.map((a) => a.ticker);

  // Fetch all prices
  const { allHighs, errors: priceErrors } = await fetchAllPrices(portfolioTickers, universeTickers);
  errors.push(...priceErrors);

  // Fetch EUR/USD rate and apply to USD-denominated portfolio holdings.
  // Trade Republic CSV amounts are always in EUR, so avgPrice is in EUR.
  // Twelve Data returns US stock prices in USD — we must convert to EUR for
  // accurate P&L calculation (otherwise NVDA: avgPrice €85 vs currentPrice $196 = wrong %).
  const eurUsdRate = await fetchEurUsdRate();

  // Build a price-adjusted allHighs for the portfolio engine only.
  // The scanner/allocator still use raw USD prices (display only, no EUR P&L needed there).
  const usdTickers = new Set(
    portfolioConfig.holdings
      .filter(h => (h.currency ?? 'USD') !== 'EUR')
      .map(h => h.ticker ?? h.id.toUpperCase())
  );

  const portfolioHighs: Record<string, import('../types').RecentHighs> = {};
  for (const [ticker, highs] of Object.entries(allHighs)) {
    if (usdTickers.has(ticker) && highs.currentPrice != null && highs.currentPrice > 0) {
      portfolioHighs[ticker] = { ...highs, currentPrice: highs.currentPrice / eurUsdRate };
    } else {
      portfolioHighs[ticker] = highs;
    }
  }

  // Estimate market regime from price data
  const marketMaxDrawdown = estimateMarketDrawdown(allHighs);
  const marketRegime = overrides.marketRegime ?? 'neutral';

  console.log(`[Engine] Market regime: ${marketRegime}, avg market drawdown: ${marketMaxDrawdown.toFixed(1)}%`);

  // --- CORE_PORTFOLIO_ENGINE ---
  let portfolioAnalyses: DailyEngineOutput['portfolioAnalyses'] = [];
  let concentration: ConcentrationData = EMPTY_CONCENTRATION;
  try {
    const result = await runPortfolioEngine(portfolioConfig, portfolioHighs);
    portfolioAnalyses = result.analyses;
    concentration = result.concentration;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Engine] Portfolio engine failed:', msg);
    errors.push(`portfolio_engine: ${msg}`);
  }

  // --- OPPORTUNITY_SCANNER ---
  let stockOpportunities: DailyEngineOutput['stockOpportunities'] = [];
  let etfOpportunities: DailyEngineOutput['etfOpportunities'] = [];
  let discoveredOpportunities: DailyEngineOutput['discoveredOpportunities'] = [];
  try {
    const scanResult = await runOpportunityScanner(
      universeConfig,
      portfolioConfig,
      allHighs,
      concentration,
      marketMaxDrawdown
    );
    stockOpportunities = scanResult.stockOpportunities;
    etfOpportunities = scanResult.etfOpportunities;
    discoveredOpportunities = scanResult.discoveredOpportunities;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Engine] Scanner failed:', msg);
    errors.push(`scanner: ${msg}`);
  }

  // --- CAPITAL_ALLOCATOR ---
  let allocationRecommendations: DailyEngineOutput['allocationRecommendations'] = [];
  try {
    allocationRecommendations = runCapitalAllocator(
      portfolioAnalyses,
      stockOpportunities,
      etfOpportunities,
      discoveredOpportunities,
      portfolioConfig.cashAvailableEur,
      portfolioConfig.targetCashReserveEur
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Engine] Allocator failed:', msg);
    errors.push(`allocator: ${msg}`);
  }

  // --- Alert generation ---
  let generatedAlerts: DailyEngineOutput['alertsGenerated'] = [];
  try {
    generatedAlerts = generateAlerts(
      portfolioAnalyses,
      stockOpportunities,
      etfOpportunities,
      discoveredOpportunities,
      concentration,
      allocationRecommendations
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Engine] Alert generation failed:', msg);
    errors.push(`alert_generation: ${msg}`);
  }

  // --- Send alerts ---
  let sentAlerts = generatedAlerts;
  if (options?.sendAlertMessages !== false) {
    try {
      sentAlerts = await sendAlerts(generatedAlerts);
      saveAlerts(sentAlerts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Engine] Sending alerts failed:', msg);
      errors.push(`telegram_alerts: ${msg}`);
      try { saveAlerts(generatedAlerts); } catch { /* ignore */ }
    }
  }

  // --- Daily digest ---
  if (options?.sendDigest !== false) {
    try {
      const alwaysSend = process.env.ALWAYS_SEND_DIGEST !== 'false';
      if (alwaysSend || generatedAlerts.length > 0) {
        const digestAlert = await sendDailyDigest(
          portfolioAnalyses,
          stockOpportunities,
          etfOpportunities,
          discoveredOpportunities,
          allocationRecommendations,
          concentration
        );
        sentAlerts = [...sentAlerts, digestAlert];
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Engine] Daily digest failed:', msg);
      errors.push(`digest: ${msg}`);
    }
  }

  const output: DailyEngineOutput = {
    runAt,
    marketRegime,
    eurUsdRate,
    portfolioAnalyses,
    concentration,
    stockOpportunities,
    etfOpportunities,
    discoveredOpportunities,
    allocationRecommendations,
    alertsGenerated: sentAlerts,
    errors,
    closedPositions: portfolioConfig.closedPositions ?? [],
    totalRealizedPnl: portfolioConfig.totalRealizedPnl ?? undefined,
  };

  // Persist output — KV in production, file-store in dev; non-fatal either way
  const { warnings: storeWarnings } = await saveEngineOutput(output);
  for (const w of storeWarnings) errors.push(w);

  console.log(`[Engine] Run complete. Alerts: ${sentAlerts.length}, Errors: ${errors.length}`);
  return output;
}
