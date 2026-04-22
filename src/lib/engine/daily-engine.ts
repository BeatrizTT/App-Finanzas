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

async function fetchAllPrices(
  portfolioTickers: string[],
  universeTickers: string[]
): Promise<{ allHighs: Record<string, RecentHighs>; errors: string[] }> {
  const provider = getPriceProvider();
  const allTickers = Array.from(new Set([...portfolioTickers, ...universeTickers]));
  const allHighs: Record<string, RecentHighs> = {};
  const errors: string[] = [];

  console.log(`[Engine] Fetching prices for ${allTickers.length} assets...`);

  // Fetch in parallel with a concurrency limit to avoid rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < allTickers.length; i += BATCH_SIZE) {
    const batch = allTickers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (ticker) => {
        const highs = await provider.getRecentHighs(ticker);
        return { ticker, highs };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allHighs[result.value.ticker] = result.value.highs;
      } else {
        const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`Price fetch failed: ${err}`);
      }
    }

    // Small delay between batches for live provider
    if (process.env.PRICE_PROVIDER === 'yahoo' && i + BATCH_SIZE < allTickers.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`[Engine] Prices fetched: ${Object.keys(allHighs).length}/${allTickers.length} succeeded`);
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

  const allUniverseAssets: UniverseAsset[] = [
    ...universeConfig.seedStocks,
    ...universeConfig.seedEtfs,
    ...universeConfig.extendedStocks,
    ...universeConfig.extendedEtfs,
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
