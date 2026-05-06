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
import { loadPriceCache, savePriceCache, getCached, setCached, countStale } from '../pricing/price-cache';
import {
  getEffectivePortfolioConfig,
  getUniverseConfig,
  getOverridesConfig,
  clearConfigCache,
  applyOverridesToPortfolio,
} from '../utils/config-loader';
import { writeJsonFile } from '../utils/file-store';
import type {
  DailyEngineOutput,
  RecentHighs,
  UniverseAsset,
} from '../types';

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
        batch.map(async (ticker) => ({ ticker, highs: await provider.getRecentHighs(ticker) }))
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

  // Estimate market regime from price data
  const marketMaxDrawdown = estimateMarketDrawdown(allHighs);
  const marketRegime = overrides.marketRegime ?? 'neutral';

  console.log(`[Engine] Market regime: ${marketRegime}, avg market drawdown: ${marketMaxDrawdown.toFixed(1)}%`);

  // --- CORE_PORTFOLIO_ENGINE ---
  const { analyses: portfolioAnalyses, concentration } = await runPortfolioEngine(
    portfolioConfig,
    allHighs
  );

  // --- OPPORTUNITY_SCANNER ---
  const { stockOpportunities, etfOpportunities, discoveredOpportunities } =
    await runOpportunityScanner(
      universeConfig,
      portfolioConfig,
      allHighs,
      concentration,
      marketMaxDrawdown
    );

  // --- CAPITAL_ALLOCATOR ---
  const allocationRecommendations = runCapitalAllocator(
    portfolioAnalyses,
    stockOpportunities,
    etfOpportunities,
    discoveredOpportunities,
    portfolioConfig.cashAvailableEur,
    portfolioConfig.targetCashReserveEur
  );

  // --- Alert generation ---
  const generatedAlerts = generateAlerts(
    portfolioAnalyses,
    stockOpportunities,
    etfOpportunities,
    discoveredOpportunities,
    concentration,
    allocationRecommendations
  );

  // --- Send alerts ---
  let sentAlerts = generatedAlerts;
  if (options?.sendAlertMessages !== false) {
    sentAlerts = await sendAlerts(generatedAlerts);
    saveAlerts(sentAlerts);
  }

  // --- Daily digest ---
  if (options?.sendDigest !== false) {
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
  }

  const output: DailyEngineOutput = {
    runAt,
    marketRegime,
    portfolioAnalyses,
    concentration,
    stockOpportunities,
    etfOpportunities,
    discoveredOpportunities,
    allocationRecommendations,
    alertsGenerated: sentAlerts,
    errors,
  };

  // Persist output for the dashboard to read
  writeJsonFile('engine-output.json', output);

  console.log(`[Engine] Run complete. Alerts: ${sentAlerts.length}, Errors: ${errors.length}`);
  return output;
}
