// Opportunity scoring engine for the OPPORTUNITY_SCANNER
// Produces a 0-10 score for any stock or ETF using weighted dimensions

import { scoreDrawdown, clamp } from '../utils/math';
import { getScoringConfig, getRulesConfig, getOverridesConfig } from '../utils/config-loader';
import type {
  UniverseAsset,
  ConcentrationData,
  RecentHighs,
  OpportunityScore,
  AssetType,
} from '../types';

// --------------------------------------------------------------------------
// Individual scoring dimensions
// --------------------------------------------------------------------------

function scoreAssetQuality(asset: UniverseAsset): number {
  // Direct quality score from universe config (1-10)
  return asset.qualityScore;
}

function scoreDrawdownOpportunity(highs: RecentHighs): number {
  const scoringConfig = getScoringConfig();
  const maxDrawdown = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);
  return scoreDrawdown(maxDrawdown, scoringConfig.drawdownScoring);
}

function scoreTrendQuality(highs: RecentHighs): number {
  // Penalize if current price is more than 50% below its 90d high (structural collapse risk)
  // Prefer assets in correction (10-35%) vs structural collapse (>45%)
  const maxDrawdown = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);

  if (maxDrawdown > 45) return 3.0;   // potential structural break
  if (maxDrawdown > 35) return 6.0;   // steep correction, watch carefully
  if (maxDrawdown > 15) return 9.0;   // meaningful pullback in trend — ideal
  if (maxDrawdown > 8)  return 8.0;   // mild pullback
  return 5.0;                          // not much of a correction yet
}

function scoreRelativeStrength(
  asset: UniverseAsset,
  highs: RecentHighs,
  marketMaxDrawdown: number
): number {
  // Relative strength: asset drawdown vs market drawdown
  // If asset is pulling back less than the market, it's showing relative strength
  const assetMaxDD = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);
  const relStrength = marketMaxDrawdown > 0 ? assetMaxDD / marketMaxDrawdown : 1;

  if (relStrength < 0.7) return 9.0;   // holding up much better than market
  if (relStrength < 1.0) return 7.5;   // slightly better than market
  if (relStrength < 1.3) return 6.0;   // roughly in line with market
  if (relStrength < 1.6) return 4.5;   // underperforming
  return 3.0;                           // significant underperformer
}

function scoreDiversificationFit(
  asset: UniverseAsset,
  concentration: ConcentrationData
): number {
  // Higher score if the asset reduces existing concentration risk
  const rules = getRulesConfig();
  let score = 5.0; // baseline

  const isEtf = asset.type === 'etf';

  // ETF bonus for broad-index and value tags
  if (isEtf && (asset.tags.includes('broad-index') || asset.tags.includes('value') || asset.tags.includes('diversification'))) {
    score += 2.0;
  }

  // Penalize if adding would worsen high concentrations
  const semiConc = concentration.themeWeights['semis'] ?? 0;
  const aiConc = concentration.themeWeights['AI'] ?? 0;
  const techConc = concentration.themeWeights['tech'] ?? 0;

  if (asset.tags.includes('semis') && semiConc > rules.concentration.maxSemisWeightPct * 0.8) {
    score -= 2.5;
  }
  if (asset.tags.includes('AI') && aiConc > rules.concentration.maxAiWeightPct * 0.8) {
    score -= 1.5;
  }
  if (asset.tags.includes('tech') && techConc > rules.concentration.maxTechWeightPct * 0.85) {
    score -= 1.0;
  }

  // Bonus for defensive/value/dividend tags when portfolio is tech-heavy
  if (techConc > 55 && (asset.tags.includes('value') || asset.tags.includes('defensive') || asset.tags.includes('dividend'))) {
    score += 2.5;
  }

  // Bonus for ETF type in general (built-in diversification)
  if (isEtf) score += 1.0;

  return clamp(score, 0, 10);
}

function scoreSectorFit(asset: UniverseAsset): number {
  // Preference scores for different sector themes
  const tagScores: Record<string, number> = {
    'broad-index': 9,
    'diversification': 9,
    'value': 8,
    'growth': 8,
    'AI': 8,
    'semis': 7,
    'software': 8,
    'cybersecurity': 8,
    'cloud': 7,
    'defensive': 7,
    'dividend': 7,
    'healthcare': 7,
    'fintech': 7,
    'payments': 7,
    'infrastructure': 7,
    'energy': 5,
    'commodities': 5,
    'thematic': 5,
    'emerging-markets': 5,
  };

  let maxScore = 5;
  for (const tag of asset.tags) {
    maxScore = Math.max(maxScore, tagScores[tag] ?? 5);
  }
  return maxScore;
}

function scoreRiskReward(highs: RecentHighs, asset: UniverseAsset): number {
  // Simple risk-reward: upside potential (mean-reversion to recent high) vs downside
  const maxDrawdown = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);
  const currentPrice = highs.currentPrice;
  const high90d = highs.high90d;

  if (currentPrice == null || currentPrice <= 0 || high90d <= 0) return 5;

  const upsideToHigh = ((high90d - currentPrice) / currentPrice) * 100;
  const estimatedDownside = maxDrawdown * 0.5; // rough estimate: risk = half current drawdown deeper

  const rr = estimatedDownside > 0 ? upsideToHigh / estimatedDownside : upsideToHigh;

  if (rr > 3.0) return 9;
  if (rr > 2.0) return 8;
  if (rr > 1.5) return 7;
  if (rr > 1.0) return 6;
  if (rr > 0.5) return 4;
  return 3;
}

function scorePortfolioFit(
  asset: UniverseAsset,
  existingTickers: string[]
): number {
  // Bonus if asset is not already in portfolio (new diversification)
  const alreadyHeld = existingTickers.some(
    (t) => t.toUpperCase() === asset.ticker.toUpperCase()
  );
  return alreadyHeld ? 5.0 : 7.5;
}

function scoreMarketRegimeFit(): number {
  const overrides = getOverridesConfig();
  const rules = getRulesConfig();
  const regime = overrides.marketRegime ?? 'neutral';
  const adjustment = rules.marketRegimeAdjustment[regime] ?? 0;
  // Map -1.5 to +0.5 adjustment to a 0-10 score offset (base = 5)
  return clamp(5 + adjustment * 2, 0, 10);
}

// --------------------------------------------------------------------------
// Composite score calculation
// --------------------------------------------------------------------------

export function calcOpportunityScore(
  asset: UniverseAsset,
  highs: RecentHighs,
  concentration: ConcentrationData,
  existingTickers: string[],
  marketMaxDrawdown = 10
): OpportunityScore {
  const config = getScoringConfig();
  const w = config.weights;

  const breakdown = {
    assetQuality: scoreAssetQuality(asset),
    drawdownOpportunity: scoreDrawdownOpportunity(highs),
    trendQuality: scoreTrendQuality(highs),
    relativeStrength: scoreRelativeStrength(asset, highs, marketMaxDrawdown),
    diversificationFit: scoreDiversificationFit(asset, concentration),
    sectorFit: scoreSectorFit(asset),
    riskReward: scoreRiskReward(highs, asset),
    portfolioFit: scorePortfolioFit(asset, existingTickers),
    marketRegimeFit: scoreMarketRegimeFit(),
  };

  const total =
    w.assetQuality * breakdown.assetQuality +
    w.drawdownOpportunity * breakdown.drawdownOpportunity +
    w.trendQuality * breakdown.trendQuality +
    w.relativeStrength * breakdown.relativeStrength +
    w.diversificationFit * breakdown.diversificationFit +
    w.sectorFit * breakdown.sectorFit +
    w.riskReward * breakdown.riskReward +
    w.portfolioFit * breakdown.portfolioFit +
    w.marketRegimeFit * breakdown.marketRegimeFit;

  return {
    total: clamp(Math.round(total * 10) / 10, 0, 10),
    breakdown,
  };
}

// --------------------------------------------------------------------------
// Map score to opportunity state
// --------------------------------------------------------------------------

export function stateFromScore(
  score: number,
  isSeed: boolean,
  assetType: AssetType
): import('../types').OpportunityState {
  const config = getScoringConfig();
  const thresholds = config.stateThresholds;
  const penalty = isSeed ? 0 : (config.discoveryScorePenalty ?? 0.5);
  const adjustedScore = score - penalty;

  if (adjustedScore <= thresholds.avoid) return 'AVOID';
  if (adjustedScore <= thresholds.watch) return 'WATCH';
  if (adjustedScore >= thresholds.buy) return 'BUY';
  if (adjustedScore >= thresholds.readyToBuy) return 'READY_TO_BUY';
  return 'WATCH';
}

// --------------------------------------------------------------------------
// Build reasons for the opportunity
// --------------------------------------------------------------------------

export function buildOpportunityReasons(
  asset: UniverseAsset,
  highs: RecentHighs,
  score: OpportunityScore,
  concentration: ConcentrationData
): string[] {
  const reasons: string[] = [];
  const maxDD = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);

  reasons.push(
    `Drawdown: -${maxDD.toFixed(1)}% (30d: -${highs.drawdown30d.toFixed(1)}%, 60d: -${highs.drawdown60d.toFixed(1)}%, 90d: -${highs.drawdown90d.toFixed(1)}%)`
  );

  if (score.breakdown.assetQuality >= 9) reasons.push(`High-quality asset (quality score ${asset.qualityScore}/10)`);
  if (score.breakdown.diversificationFit >= 7) {
    const techConc = concentration.themeWeights['tech'] ?? 0;
    if (asset.type === 'etf') reasons.push(`ETF improves portfolio diversification (current tech: ${techConc.toFixed(0)}%)`);
    else reasons.push('Good portfolio diversification fit');
  }
  if (score.breakdown.diversificationFit < 5) {
    const overlappingTags = asset.tags.filter((t) => (concentration.themeWeights[t] ?? 0) > 30);
    if (overlappingTags.length > 0) reasons.push(`Adds to already-elevated ${overlappingTags.join(', ')} exposure`);
  }
  if (score.breakdown.riskReward >= 7) reasons.push('Favorable risk-reward: meaningful upside vs controlled downside');
  if (score.breakdown.trendQuality >= 9) reasons.push('Pullback within still-intact trend');
  if (score.breakdown.trendQuality <= 4) reasons.push('Caution: trend shows signs of deeper breakdown');
  if (score.breakdown.relativeStrength >= 8) reasons.push('Relative strength: holding up better than broader market');
  if (!asset.isSeed) reasons.push('Discovered via extended quality universe — passed all quality gates');

  return reasons;
}
