// Extended discovery universe quality gate
// Before surfacing a non-seed asset, it must pass ALL these checks

import { clamp } from '../utils/math';
import { getUniverseConfig } from '../utils/config-loader';
import type { UniverseAsset, RecentHighs, ConcentrationData } from '../types';

export interface QualityGateResult {
  liquidity: boolean;
  quality: boolean;
  volatility: boolean;
  portfolioFit: boolean;
  riskReward: boolean;
  notSpeculative: boolean;
  passed: boolean;
  failedGates: string[];
}

// --------------------------------------------------------------------------
// Individual quality gate checks
// --------------------------------------------------------------------------

function checkLiquidity(asset: UniverseAsset): boolean {
  // Quality score >= 7 implicitly signals good liquidity for pre-screened assets
  // In a real implementation, you would check volume and bid-ask spread
  return (asset.qualityScore ?? 0) >= 7;
}

function checkQuality(asset: UniverseAsset): boolean {
  const config = getUniverseConfig();
  return asset.qualityScore >= (config.discoveryGates.minQualityScore ?? 7);
}

function checkVolatility(highs: RecentHighs): boolean {
  // Reject if the current drawdown suggests extreme volatility / collapse
  const config = getUniverseConfig();
  const maxDD = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);
  return maxDD <= (config.discoveryGates.maxDrawdownForAlert ?? 50);
}

function checkPortfolioFit(
  asset: UniverseAsset,
  concentration: ConcentrationData
): boolean {
  // Fail if it would make an already-high concentration significantly worse
  const semiConc = concentration.themeWeights['semis'] ?? 0;
  if (asset.tags.includes('semis') && semiConc > 40) return false;

  // Single thematic ETFs with risky themes need to be lower concentration
  if (!asset.isSeed && asset.type === 'etf') {
    const riskyThematic = asset.tags.includes('thematic') && !asset.tags.includes('broad-index');
    if (riskyThematic) return false;
  }

  return true;
}

function checkRiskReward(highs: RecentHighs): boolean {
  const config = getUniverseConfig();
  const maxDD = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);
  return maxDD >= (config.discoveryGates.minDrawdownForAlert ?? 8);
}

function checkNotSpeculative(asset: UniverseAsset): boolean {
  // Reject assets that are explicitly speculative / low quality
  const speculative = ['meme', 'speculative', 'microcap', 'illiquid', 'junk'];
  return !asset.tags.some((t) => speculative.includes(t.toLowerCase()));
}

// --------------------------------------------------------------------------
// Run all quality gates
// --------------------------------------------------------------------------

export function runQualityGates(
  asset: UniverseAsset,
  highs: RecentHighs,
  concentration: ConcentrationData
): QualityGateResult {
  const results = {
    liquidity: checkLiquidity(asset),
    quality: checkQuality(asset),
    volatility: checkVolatility(highs),
    portfolioFit: checkPortfolioFit(asset, concentration),
    riskReward: checkRiskReward(highs),
    notSpeculative: checkNotSpeculative(asset),
  };

  const failedGates = Object.entries(results)
    .filter(([, passed]) => !passed)
    .map(([gate]) => gate);

  return {
    ...results,
    passed: failedGates.length === 0,
    failedGates,
  };
}

// --------------------------------------------------------------------------
// Filter extended universe to only surfaceable assets
// --------------------------------------------------------------------------

export function filterDiscoveryUniverse(
  assets: UniverseAsset[],
  allHighs: Record<string, RecentHighs>,
  concentration: ConcentrationData
): { asset: UniverseAsset; gates: QualityGateResult }[] {
  const results: { asset: UniverseAsset; gates: QualityGateResult }[] = [];

  for (const asset of assets) {
    // Only process non-seed assets through the strict quality gate
    if (asset.isSeed) continue;

    const highs = allHighs[asset.ticker];
    if (!highs) continue;

    const gates = runQualityGates(asset, highs, concentration);
    if (gates.passed) {
      results.push({ asset, gates });
    }
  }

  return results;
}
