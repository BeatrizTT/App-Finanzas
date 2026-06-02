// Drawdown Opportunity Radar — pure scoring functions for discovered opportunities.
// No I/O, no API calls, no provider calls, no alert side effects.
//
// Objective: detect attractive drawdowns in strong assets that fit the portfolio,
// while penalising value traps and blocking BUY when pricing or data are unsafe.
//
// Key invariants:
//  - Blocking rules (pricing, quality, concentration, value trap) override scores unconditionally.
//  - drawdownTermSpread = window comparison (drawdown90d - drawdown30d). NOT temporal acceleration.
//  - drawdownChangeRate = temporal signal from snapshots (null if no prior snapshot, never 0).
//  - companyStrengthScore uses editorial/gate signals only — no revenue, earnings, or margins.
//  - Extreme drawdowns (>45%) do NOT maximise drawdownSeverityScore — the inverted curve is intentional.

import type {
  AssetType,
  ConcentrationData,
  DrawdownRadarActionable,
  DrawdownRadarAssessment,
  DrawdownZoneClassification,
  Opportunity,
  ValueTrapRisk,
} from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DRAWDOWN_ZONE_THRESHOLDS = {
  noDipMax90d: 10,
  sharpCrashMin30d: 12,
  sharpCrashMax90d: 20,
  classicDipMin90d: 15,
  classicDipMax90d: 30,
  classicDipMin30d: 8,
  deepValueMin90d: 30,
  deepValueMax90d: 45,
  recoveryTrapMin90d: 45,
  recoveryTrapWeakQualityMin90d: 35,
  recoveryTrapWeakQualityMaxStrength: 6,
} as const;

export const COMPANY_STRENGTH_PENALTIES = {
  notSpeculative: 4.0,  // speculative/meme assets are value-trap-prone
  liquidity: 2.5,       // illiquid assets trap capital
  volatility: 1.0,
  quality: 1.0,
} as const;

export const COMPANY_STRENGTH_BONUSES = {
  seedUniverse: 0.5,
  moatTag: 0.5,
  maxTotalBonus: 1.0,  // cap to prevent bonus stacking
} as const;

export const RADAR_SCORE_WEIGHTS = {
  drawdownSeverity: 0.30,
  companyStrength: 0.30,
  portfolioFit: 0.20,
  pricingSafety: 0.10,
  riskReward: 0.10,
} as const;

export const PORTFOLIO_FIT_THRESHOLDS = {
  sectorOverweightPct: 25,   // sector weight in portfolio above this = overweight
  sectorUnderweightPct: 10,  // sector weight in portfolio below this = underweight
  fitBlockThreshold: 3.5,    // portfolioFitScore below this → blocked_concentration
} as const;

export const ACTIONABLE_THRESHOLDS = {
  minStrengthForBuy: 6,    // companyStrengthScore below this → blocked_quality
  minScoreForBuy: 6.5,     // drawdownOpportunityScore threshold for buy_candidate_possible
} as const;

// Pricing safety scores used in composite calculation
const PRICING_SAFETY_SAFE = 10.0;
const PRICING_SAFETY_BLOCKED = 2.0;

// Moat / defensive editorial tags that add a quality bonus
const MOAT_TAGS = new Set(['moat', 'wide-moat', 'defensive', 'quality-compounder']);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Best-effort match of asset tags against portfolio sector weight keys.
 * Returns the matched sector and its current portfolio weight, or null if no match.
 */
function findSectorMatch(
  tags: string[],
  sectorWeights: Record<string, number>,
): { sector: string; weight: number } | null {
  for (const tag of tags) {
    const tagLower = tag.toLowerCase();
    for (const [sector, weight] of Object.entries(sectorWeights)) {
      const sectorLower = sector.toLowerCase();
      if (sectorLower.includes(tagLower) || tagLower.includes(sectorLower)) {
        return { sector, weight };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pure exported functions
// ---------------------------------------------------------------------------

/**
 * Spread between the 90d and 30d drawdown windows.
 * A positive result means long-term losses exceed recent losses (accumulated decline).
 *
 * This is a WINDOW COMPARISON, not temporal acceleration.
 * For temporal rate-of-change, use computeDrawdownChangeRate.
 */
export function computeDrawdownTermSpread(drawdown30d: number, drawdown90d: number): number {
  return drawdown90d - drawdown30d;
}

/**
 * Rate of change in drawdown90d between the current engine run and the most-recent prior snapshot.
 * Returns null when no prior snapshot is available — never coerced to 0.
 *
 * Positive = drawdown worsening (still falling).
 * Negative = drawdown recovering (stabilising or rebounding).
 */
export function computeDrawdownChangeRate(
  currentDrawdown90d: number,
  previousDrawdown90d: number | null,
): number | null {
  if (previousDrawdown90d === null) return null;
  return currentDrawdown90d - previousDrawdown90d;
}

/**
 * Classifies the current drawdown into one of five zones.
 *
 * Priority (highest wins when multiple conditions overlap):
 *   recovery_trap > deep_value > sharp_crash > classic_dip > no_dip
 *
 * @param drawdown30d         % below 30d high
 * @param drawdown90d         % below 90d high
 * @param companyStrengthScore 0–10 from computeCompanyStrengthScore
 */
export function classifyDrawdownZone(
  drawdown30d: number,
  drawdown90d: number,
  companyStrengthScore: number,
): DrawdownZoneClassification {
  const t = DRAWDOWN_ZONE_THRESHOLDS;

  // recovery_trap: extreme fall OR deep fall with weak quality
  if (
    drawdown90d > t.recoveryTrapMin90d ||
    (drawdown90d > t.recoveryTrapWeakQualityMin90d && companyStrengthScore < t.recoveryTrapWeakQualityMaxStrength)
  ) {
    return 'recovery_trap';
  }

  // deep_value: sustained deep drawdown with quality required to avoid recovery_trap
  if (drawdown90d > t.deepValueMin90d && drawdown90d <= t.deepValueMax90d) {
    return 'deep_value';
  }

  // sharp_crash: fast recent drop (short-term shock)
  if (drawdown30d >= t.sharpCrashMin30d && drawdown90d < t.sharpCrashMax90d) {
    return 'sharp_crash';
  }

  // classic_dip: sustained moderate drawdown — the sweet spot
  if (drawdown90d >= t.classicDipMin90d && drawdown90d <= t.classicDipMax90d && drawdown30d >= t.classicDipMin30d) {
    return 'classic_dip';
  }

  return 'no_dip';
}

/**
 * Scores how attractive the drawdown depth is as an entry opportunity (0–10).
 *
 * Intentional design:
 * - Classic dip (15–30%) and deep value score highest.
 * - Recovery trap (>45%) uses an inverted curve — extreme falls are NOT rewarded without
 *   separate quality evidence. High severity score alone does not justify a buy.
 */
export function computeDrawdownSeverityScore(
  drawdown30d: number,
  drawdown90d: number,
  zone: DrawdownZoneClassification,
): number {
  switch (zone) {
    case 'no_dip':
      return 1.0;

    case 'sharp_crash':
      // Rises with short-term drop depth; capped at 7.0
      return clamp(5.0 + (drawdown30d - 12) * 0.2, 4.0, 7.0);

    case 'classic_dip':
      // Sweet spot: centre around 20-22%; max 7.5
      return clamp(4.0 + (drawdown90d - 15) * 0.15, 4.0, 7.5);

    case 'deep_value':
      // Higher floor than classic_dip; capped at 7.0 (more risk)
      return clamp(5.5 + (drawdown90d - 30) * 0.1, 5.5, 7.0);

    case 'recovery_trap':
      // Inverted curve: extreme falls are not opportunities without quality proof
      return clamp(4.0 - Math.max(0, drawdown90d - 45) * 0.15, 0, 4.0);
  }
}

/**
 * Company strength score (0–10) from editorial and gate signals only.
 *
 * Inputs:
 *   assetQualityScore — score.breakdown.assetQuality from OpportunityScore (raw 0–10 component)
 *   qualityGates      — liquidity, quality, volatility, notSpeculative
 *   isSeedUniverse    — editorial pre-screening signal
 *   tags              — moat/wide-moat/defensive tags add a bounded bonus
 *
 * IMPORTANT: This score reflects editorial quality and technical gate signals only.
 * It does NOT assess revenue trends, margins, earnings, cash flow, or debt.
 * Avoid language that implies fundamental causality ("AMD took share", "margins collapsing").
 * Interpret as: "available signals suggest quality" — not as a fundamental verdict.
 */
export function computeCompanyStrengthScore(
  assetQualityScore: number,
  qualityGates: {
    liquidity: boolean;
    quality: boolean;
    volatility: boolean;
    notSpeculative: boolean;
  },
  isSeedUniverse: boolean,
  tags: string[],
): number {
  let score = clamp(assetQualityScore, 0, 10);

  // Editorial bonuses — bounded so a moat tag can't offset a failed gate
  let bonus = 0;
  if (isSeedUniverse) bonus += COMPANY_STRENGTH_BONUSES.seedUniverse;
  if (tags.some((t) => MOAT_TAGS.has(t.toLowerCase()))) bonus += COMPANY_STRENGTH_BONUSES.moatTag;
  score += Math.min(bonus, COMPANY_STRENGTH_BONUSES.maxTotalBonus);

  // Hard penalties for quality gate failures
  if (!qualityGates.notSpeculative) score -= COMPANY_STRENGTH_PENALTIES.notSpeculative;
  if (!qualityGates.liquidity) score -= COMPANY_STRENGTH_PENALTIES.liquidity;
  if (!qualityGates.volatility) score -= COMPANY_STRENGTH_PENALTIES.volatility;
  if (!qualityGates.quality) score -= COMPANY_STRENGTH_PENALTIES.quality;

  return clamp(score, 0, 10);
}

/**
 * Portfolio fit score (0–10).
 *
 * Uses the scanner's portfolioFit breakdown component as the base — it already integrates
 * sector fit and diversification signals. Then applies adjustments from ConcentrationData.
 *
 * If concentration data is unavailable, returns a conservative 5.0 with a warning.
 * Best-effort sector matching via tags — returns base + adjustments if no match found.
 */
export function computePortfolioFitScore(
  portfolioFitComponent: number,
  portfolioFitGate: boolean,
  concentration: ConcentrationData | null,
  assetType: AssetType,
  tags: string[],
): { score: number; warnings: string[] } {
  const warnings: string[] = [];

  if (concentration === null) {
    warnings.push('Portfolio fit partially unknown — concentration data unavailable');
    return { score: 5.0, warnings };
  }

  let score = clamp(portfolioFitComponent, 0, 10);

  if (!portfolioFitGate) score -= 1.5;

  // Concentration warnings from the portfolio engine
  if (concentration.highConcentrationWarnings.length > 0) {
    score -= concentration.highConcentrationWarnings.length * 1.0;
    warnings.push(`High concentration: ${concentration.highConcentrationWarnings[0]}`);
  }

  // Asset type balance: ETFs add diversification when ETF ratio is low; extra stocks when heavy penalise
  if (assetType === 'etf' && concentration.stockVsEtfRatio.etfs < 30) {
    score += 0.5;
  } else if (assetType === 'stock' && concentration.stockVsEtfRatio.stocks > 70) {
    score -= 0.5;
  }

  // Best-effort sector over/underweight from tags
  const sectorMatch = findSectorMatch(tags, concentration.sectorWeights);
  if (sectorMatch !== null) {
    if (sectorMatch.weight > PORTFOLIO_FIT_THRESHOLDS.sectorOverweightPct) {
      score -= 1.5;
      warnings.push(
        `Sector already overweight: ${sectorMatch.sector} at ${sectorMatch.weight.toFixed(1)}% of portfolio`,
      );
    } else if (sectorMatch.weight < PORTFOLIO_FIT_THRESHOLDS.sectorUnderweightPct) {
      score += 1.5;
    }
  }

  return { score: clamp(score, 0, 10), warnings };
}

/**
 * Detects value trap risk from technical and editorial signals.
 *
 * HIGH risk = fundamental research required before any BUY consideration.
 * MEDIUM risk = pricing or zone concerns; watch only.
 * LOW risk = available signals look favourable.
 *
 * IMPORTANT: pricing blocked is NOT automatically a value trap.
 * A pricing issue means we cannot size a BUY — it does not mean the company is broken.
 * These are tracked separately: valueTrapRisk vs. actionable = blocked_pricing.
 *
 * Without fundamentals (revenue, earnings, margins, debt), we cannot determine whether
 * a fall is structural or a temporary opportunity. This function provides a risk proxy only.
 */
export function detectValueTrapRisk(
  opp: Opportunity,
  zone: DrawdownZoneClassification,
  companyStrengthScore: number,
): { risk: ValueTrapRisk; reasons: string[] } {
  const highReasons: string[] = [];

  if (!opp.qualityGates.notSpeculative) {
    highReasons.push('Speculative/meme asset — fundamental research required before buying');
  }
  if (!opp.qualityGates.liquidity) {
    highReasons.push('Liquidity gate failed — capital may be trapped');
  }
  if (opp.drawdown.drawdown90d > 50 && companyStrengthScore < 8) {
    highReasons.push(
      `Extreme drawdown (${opp.drawdown.drawdown90d.toFixed(1)}%) without strong quality evidence`,
    );
  }
  if (opp.pricingMethod === 'unavailable') {
    highReasons.push('Price data completely unavailable — cannot assess fair value');
  }

  if (highReasons.length > 0) return { risk: 'high', reasons: highReasons };

  const mediumReasons: string[] = [];

  if (zone === 'recovery_trap') {
    mediumReasons.push('Recovery trap zone — fundamental research required before buying');
  }
  // Pricing not EUR-safe is a BUY blocker, not a value trap — note the distinction
  if (opp.pricingDataAvailable !== true && opp.pricingMethod !== 'unavailable') {
    mediumReasons.push(
      `Pricing not EUR-safe (${opp.pricingMethod ?? 'unknown'}) — buy sizing blocked; not a quality verdict`,
    );
  }
  if (opp.drawdown.drawdown90d > 35 && !opp.isSeedUniverse) {
    mediumReasons.push('Deep drawdown in extended-discovery asset — requires extra scrutiny');
  }

  if (mediumReasons.length > 0) return { risk: 'medium', reasons: mediumReasons };

  return { risk: 'low', reasons: [] };
}

/**
 * Composite drawdown opportunity score (0–10).
 *
 * Weights (must sum to 1.0):
 *   drawdownSeverity 30% + companyStrength 30% + portfolioFit 20% + pricingSafety 10% + riskReward 10%
 *
 * Pricing unavailability is weighted as PRICING_SAFETY_BLOCKED (2.0), reducing the score
 * but not zeroing it — the score remains informational even when actionable = blocked_pricing.
 */
export function computeDrawdownOpportunityScore(
  drawdownSeverityScore: number,
  companyStrengthScore: number,
  portfolioFitScore: number,
  pricingDataAvailable: boolean | undefined,
  riskRewardScore: number,
): number {
  const pricingSafety = pricingDataAvailable === true ? PRICING_SAFETY_SAFE : PRICING_SAFETY_BLOCKED;

  const raw =
    drawdownSeverityScore * RADAR_SCORE_WEIGHTS.drawdownSeverity +
    companyStrengthScore * RADAR_SCORE_WEIGHTS.companyStrength +
    portfolioFitScore * RADAR_SCORE_WEIGHTS.portfolioFit +
    pricingSafety * RADAR_SCORE_WEIGHTS.pricingSafety +
    riskRewardScore * RADAR_SCORE_WEIGHTS.riskReward;

  return clamp(raw, 0, 10);
}

/**
 * Determines the recommended interpretation of the drawdown opportunity.
 * Blocking rules are applied in priority order and always override the raw score.
 *
 * Priority: blocked_pricing > blocked_quality > needs_fundamental_research >
 *           blocked_concentration > score-based
 */
export function determineActionable(
  drawdownOpportunityScore: number,
  companyStrengthScore: number,
  pricingDataAvailable: boolean | undefined,
  valueTrapRisk: ValueTrapRisk,
  portfolioFitScore: number,
  zone: DrawdownZoneClassification,
): DrawdownRadarActionable {
  if (pricingDataAvailable !== true) return 'blocked_pricing';
  if (companyStrengthScore < ACTIONABLE_THRESHOLDS.minStrengthForBuy) return 'blocked_quality';
  if (valueTrapRisk === 'high') return 'needs_fundamental_research';
  if (portfolioFitScore < PORTFOLIO_FIT_THRESHOLDS.fitBlockThreshold) return 'blocked_concentration';
  if (zone === 'recovery_trap') return 'needs_fundamental_research';
  if (drawdownOpportunityScore >= ACTIONABLE_THRESHOLDS.minScoreForBuy) return 'buy_candidate_possible';
  return 'watch_research';
}

/**
 * Builds a full DrawdownRadarAssessment for a single discovered opportunity.
 * Pure function — no I/O, no provider calls, no alert writes.
 *
 * @param opp                Opportunity from scanner output.
 * @param previousDrawdown90d Most-recent prior drawdown90d for this ticker; null if no prior snapshot.
 * @param concentration       Current portfolio concentration; null if unavailable.
 */
export function buildDrawdownRadarAssessment(
  opp: Opportunity,
  previousDrawdown90d: number | null,
  concentration: ConcentrationData | null,
): DrawdownRadarAssessment {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // score.breakdown.assetQuality is the raw 0–10 quality component (pre-weighting)
  const companyStrengthScore = computeCompanyStrengthScore(
    opp.score.breakdown.assetQuality,
    opp.qualityGates,
    opp.isSeedUniverse,
    opp.tags,
  );

  const zone = classifyDrawdownZone(
    opp.drawdown.drawdown30d,
    opp.drawdown.drawdown90d,
    companyStrengthScore,
  );

  const drawdownSeverityScore = computeDrawdownSeverityScore(
    opp.drawdown.drawdown30d,
    opp.drawdown.drawdown90d,
    zone,
  );

  // score.breakdown.portfolioFit is the raw 0–10 portfolio fit component
  const portfolioFitResult = computePortfolioFitScore(
    opp.score.breakdown.portfolioFit,
    opp.qualityGates.portfolioFit,
    concentration,
    opp.type,
    opp.tags,
  );

  const valueTrapResult = detectValueTrapRisk(opp, zone, companyStrengthScore);

  // score.breakdown.riskReward is the raw 0–10 risk/reward component
  const drawdownOpportunityScore = computeDrawdownOpportunityScore(
    drawdownSeverityScore,
    companyStrengthScore,
    portfolioFitResult.score,
    opp.pricingDataAvailable,
    opp.score.breakdown.riskReward,
  );

  const actionable = determineActionable(
    drawdownOpportunityScore,
    companyStrengthScore,
    opp.pricingDataAvailable,
    valueTrapResult.risk,
    portfolioFitResult.score,
    zone,
  );

  // Build human-readable reasons
  if (zone !== 'no_dip') {
    reasons.push(
      `${zone.replace(/_/g, ' ')} zone (drawdown90d: ${opp.drawdown.drawdown90d.toFixed(1)}%, drawdown30d: ${opp.drawdown.drawdown30d.toFixed(1)}%)`,
    );
  }

  if (companyStrengthScore >= 8) {
    reasons.push(`Strong company quality signals (${companyStrengthScore.toFixed(1)}/10 — editorial/gate data only)`);
  } else if (companyStrengthScore >= 6) {
    reasons.push(`Moderate company quality signals (${companyStrengthScore.toFixed(1)}/10)`);
  } else {
    reasons.push(`Weak company quality signals (${companyStrengthScore.toFixed(1)}/10) — quality gate blocked`);
  }

  if (opp.pricingDataAvailable === true) {
    reasons.push(`Pricing safe for EUR sizing (${opp.pricingMethod ?? 'unknown'})`);
  } else {
    warnings.push(
      `Pricing not EUR-safe (${opp.pricingMethod ?? 'unknown'}) — buy sizing unavailable; currentPrice is null`,
    );
  }

  return {
    ticker: opp.ticker,
    drawdownOpportunityScore,
    companyStrengthScore,
    portfolioFitScore: portfolioFitResult.score,
    drawdownSeverityScore,
    drawdownTermSpread: computeDrawdownTermSpread(opp.drawdown.drawdown30d, opp.drawdown.drawdown90d),
    drawdownChangeRate: computeDrawdownChangeRate(opp.drawdown.drawdown90d, previousDrawdown90d),
    zone,
    valueTrapRisk: valueTrapResult.risk,
    reasons: [...reasons, ...valueTrapResult.reasons],
    warnings: [...warnings, ...portfolioFitResult.warnings],
    actionable,
  };
}
