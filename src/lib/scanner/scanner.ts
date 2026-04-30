// OPPORTUNITY_SCANNER
// Scans seed universe + extended discovery universe for ranked opportunities
// Handles both stocks and ETFs as first-class assets

import { calcOpportunityScore, stateFromScore, buildOpportunityReasons } from './scoring';
import { runQualityGates, filterDiscoveryUniverse } from './discovery';
import { getAllocationConfig, getOverridesConfig, getRulesConfig } from '../utils/config-loader';
import { clamp } from '../utils/math';
import type {
  UniverseConfig,
  PortfolioConfig,
  ConcentrationData,
  RecentHighs,
  Opportunity,
  AllocationConfig,
} from '../types';

// --------------------------------------------------------------------------
// Calc suggested amount for an opportunity
// --------------------------------------------------------------------------

function calcOpportunitySuggestedAmount(
  score: number,
  state: import('../types').OpportunityState,
  cashAvailable: number,
  targetReserve: number,
  isEtf: boolean,
  concentrationPenalty: number,
  allocConfig: AllocationConfig
): { min: number; max: number } {
  const deployable = Math.max(0, cashAvailable - targetReserve);
  const tier = allocConfig.tiers.find((t) => t.state === state);
  if (!tier || deployable <= 0 || state === 'WATCH' || state === 'AVOID') {
    return { min: 0, max: 0 };
  }

  let minPct = tier.minPctOfDeployable / 100;
  let maxPct = tier.maxPctOfDeployable / 100;

  // ETF bonus
  if (isEtf) {
    maxPct += allocConfig.etfConcentrationBonus;
    minPct += allocConfig.etfConcentrationBonus / 2;
  }

  // Concentration penalty
  if (concentrationPenalty > 0.3) {
    const reduction = 1 - concentrationPenalty * (1 - allocConfig.concentrationPenaltyReduction);
    minPct *= reduction;
    maxPct *= reduction;
  }

  let minAmount = Math.round(deployable * minPct);
  let maxAmount = Math.round(deployable * maxPct);

  minAmount = clamp(minAmount, allocConfig.minSingleTradeEur, allocConfig.maxSingleTradeEur);
  maxAmount = clamp(maxAmount, allocConfig.minSingleTradeEur, allocConfig.maxSingleTradeEur);

  return { min: Math.min(minAmount, maxAmount), max: maxAmount };
}

// --------------------------------------------------------------------------
// Calculate concentration penalty for scanner (simpler than portfolio engine)
// --------------------------------------------------------------------------

function calcScannerConcentrationPenalty(
  tags: string[],
  concentration: ConcentrationData
): number {
  const rules = getRulesConfig();
  let penalty = 0;

  for (const tag of tags) {
    const weight = concentration.themeWeights[tag] ?? 0;
    if (tag === 'semis' && weight > rules.concentration.maxSemisWeightPct * 0.8) penalty = Math.max(penalty, 0.6);
    if (tag === 'AI' && weight > rules.concentration.maxAiWeightPct * 0.8) penalty = Math.max(penalty, 0.4);
    if (tag === 'tech' && weight > rules.concentration.maxTechWeightPct * 0.85) penalty = Math.max(penalty, 0.3);
  }

  return clamp(penalty, 0, 1);
}

// --------------------------------------------------------------------------
// Score and classify a single asset
// --------------------------------------------------------------------------

function scoreAsset(
  ticker: string,
  assetDef: import('../types').UniverseAsset,
  highs: RecentHighs,
  portfolioConfig: PortfolioConfig,
  concentration: ConcentrationData,
  marketMaxDrawdown: number,
  allocConfig: AllocationConfig
): Opportunity | null {
  const overrides = getOverridesConfig();

  // Skip if overridden
  if (overrides.overrides.some((o) => o.assetId === ticker.toLowerCase() && o.type === 'skip_scanner')) {
    return null;
  }

  const existingTickers = portfolioConfig.holdings.map((h) => h.ticker ?? h.id).filter(Boolean) as string[];
  const score = calcOpportunityScore(assetDef, highs, concentration, existingTickers, marketMaxDrawdown);
  const state = stateFromScore(score.total, assetDef.isSeed, assetDef.type);

  // Skip assets that AVOID or score too low to be useful
  if (state === 'AVOID') return null;

  const concentrationPenalty = calcScannerConcentrationPenalty(assetDef.tags, concentration);
  const reasons = buildOpportunityReasons(assetDef, highs, score, concentration);

  const suggestedAmountEur = calcOpportunitySuggestedAmount(
    score.total,
    state,
    portfolioConfig.cashAvailableEur,
    portfolioConfig.targetCashReserveEur,
    assetDef.type === 'etf',
    concentrationPenalty,
    allocConfig
  );

  const qualityGates = assetDef.isSeed
    ? { liquidity: true, quality: true, volatility: true, portfolioFit: true, riskReward: true, notSpeculative: true }
    : runQualityGates(assetDef, highs, concentration);

  const maxDD = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);
  const primaryWindow = highs.drawdown90d === maxDD ? '90d' : highs.drawdown60d === maxDD ? '60d' : '30d';

  let confidence: 'low' | 'medium' | 'high' = 'medium';
  if (score.total >= 8 && concentrationPenalty < 0.3) confidence = 'high';
  if (score.total < 6 || concentrationPenalty > 0.6 || !assetDef.isSeed) confidence = 'low';

  return {
    ticker: assetDef.ticker,
    name: assetDef.name,
    type: assetDef.type,
    tags: assetDef.tags,
    isin: assetDef.isin,
    isSeedUniverse: assetDef.isSeed,
    score,
    state,
    currentPrice: highs.currentPrice,
    currency: assetDef.currency ?? 'USD',
    drawdown: {
      drawdown30d: highs.drawdown30d,
      drawdown60d: highs.drawdown60d,
      drawdown90d: highs.drawdown90d,
      maxDrawdown: maxDD,
      primaryWindow,
    },
    reasons,
    suggestedAmountEur,
    confidence,
    qualityGates: {
      liquidity: qualityGates.liquidity ?? true,
      quality: qualityGates.quality ?? true,
      volatility: qualityGates.volatility ?? true,
      portfolioFit: qualityGates.portfolioFit ?? true,
      riskReward: qualityGates.riskReward ?? true,
      notSpeculative: qualityGates.notSpeculative ?? true,
    },
  };
}

// --------------------------------------------------------------------------
// Main scanner entry point
// --------------------------------------------------------------------------

export interface ScannerResult {
  stockOpportunities: Opportunity[];
  etfOpportunities: Opportunity[];
  discoveredOpportunities: Opportunity[];
}

export async function runOpportunityScanner(
  universeConfig: UniverseConfig,
  portfolioConfig: PortfolioConfig,
  allHighs: Record<string, RecentHighs>,
  concentration: ConcentrationData,
  marketMaxDrawdown = 10  // approximate broad market drawdown for relative strength scoring
): Promise<ScannerResult> {
  const allocConfig = getAllocationConfig();
  const overrides = getOverridesConfig();

  if (overrides.globalNoBuy) {
    return { stockOpportunities: [], etfOpportunities: [], discoveredOpportunities: [] };
  }

  // Combine all assets to scan
  const allSeedAssets = [...universeConfig.seedStocks, ...universeConfig.seedEtfs];
  const allExtendedAssets = [...universeConfig.extendedStocks, ...universeConfig.extendedEtfs];

  const stockOpportunities: Opportunity[] = [];
  const etfOpportunities: Opportunity[] = [];
  const discoveredOpportunities: Opportunity[] = [];

  // --- Scan seed universe ---
  for (const asset of allSeedAssets) {
    const highs = allHighs[asset.ticker];
    if (!highs) continue;

    const opp = scoreAsset(asset.ticker, asset, highs, portfolioConfig, concentration, marketMaxDrawdown, allocConfig);
    if (!opp) continue;
    if (opp.state === 'WATCH' && opp.score.total < 5) continue; // too low to surface

    if (asset.type === 'stock') stockOpportunities.push(opp);
    else etfOpportunities.push(opp);
  }

  // --- Scan extended discovery universe ---
  const qualifiedDiscovery = filterDiscoveryUniverse(allExtendedAssets, allHighs, concentration);
  for (const { asset } of qualifiedDiscovery) {
    const highs = allHighs[asset.ticker];
    if (!highs) continue;

    const opp = scoreAsset(asset.ticker, asset, highs, portfolioConfig, concentration, marketMaxDrawdown, allocConfig);
    if (!opp) continue;
    // Extended assets need higher bar — only surface if genuinely strong
    if (opp.score.total < 6.5) continue;

    discoveredOpportunities.push(opp);
  }

  // Sort by score descending
  const byScore = (a: Opportunity, b: Opportunity) => b.score.total - a.score.total;
  stockOpportunities.sort(byScore);
  etfOpportunities.sort(byScore);
  discoveredOpportunities.sort(byScore);

  return {
    stockOpportunities: stockOpportunities.slice(0, 15),  // top N
    etfOpportunities: etfOpportunities.slice(0, 10),
    discoveredOpportunities: discoveredOpportunities.slice(0, 5),
  };
}
