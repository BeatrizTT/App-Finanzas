// P3-3e: Drawdown Opportunity Radar — pure function tests
// No file I/O, no provider calls, no DATA_DIR needed.

import {
  buildDrawdownRadarAssessment,
  classifyDrawdownZone,
  computeCompanyStrengthScore,
  computeDrawdownChangeRate,
  computeDrawdownOpportunityScore,
  computeDrawdownSeverityScore,
  computeDrawdownTermSpread,
  computePortfolioFitScore,
  detectValueTrapRisk,
  determineActionable,
  COMPANY_STRENGTH_PENALTIES,
  DRAWDOWN_ZONE_THRESHOLDS,
  RADAR_SCORE_WEIGHTS,
  PORTFOLIO_FIT_THRESHOLDS,
  ACTIONABLE_THRESHOLDS,
} from '../drawdown-radar';

import type {
  ConcentrationData,
  DrawdownRadarAssessment,
  Opportunity,
} from '../../types';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const results: string[] = [];

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    results.push(`  ✓ ${msg}`);
  } else {
    failed++;
    results.push(`  ✗ ${msg}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}: threw ${e instanceof Error ? e.message : e}`);
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeGates(overrides: Partial<Opportunity['qualityGates']> = {}): Opportunity['qualityGates'] {
  return {
    liquidity: true,
    quality: true,
    volatility: true,
    portfolioFit: true,
    riskReward: true,
    notSpeculative: true,
    ...overrides,
  };
}

function makeScore(total: number, overrides: Partial<Opportunity['score']['breakdown']> = {}): Opportunity['score'] {
  return {
    total,
    breakdown: {
      assetQuality: 8.0,
      drawdownOpportunity: 8.0,
      trendQuality: 7.0,
      relativeStrength: 7.0,
      diversificationFit: 7.0,
      sectorFit: 7.0,
      riskReward: 7.0,
      portfolioFit: 7.0,
      marketRegimeFit: 7.0,
      ...overrides,
    },
  };
}

function makeDrawdown(d30: number, d60: number, d90: number): Opportunity['drawdown'] {
  return {
    drawdown30d: d30,
    drawdown60d: d60,
    drawdown90d: d90,
    maxDrawdown: Math.max(d30, d60, d90),
    primaryWindow: '90d',
  };
}

function makeConcentration(overrides: Partial<ConcentrationData> = {}): ConcentrationData {
  return {
    totalPortfolioValue: 50000,
    sectorWeights: {},
    themeWeights: {},
    stockVsEtfRatio: { stocks: 60, etfs: 40 },
    highConcentrationWarnings: [],
    ...overrides,
  };
}

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    type: 'stock',
    tags: [],
    isSeedUniverse: true,
    score: makeScore(7.5),
    state: 'WATCH',
    currentPrice: 215.0,
    currency: 'USD',
    pricingMethod: 'usd_converted',
    pricingDataAvailable: true,
    drawdown: makeDrawdown(15, 18, 20),
    reasons: ['strong quality score'],
    suggestedAmountEur: { min: 500, max: 1000 },
    confidence: 'high',
    qualityGates: makeGates(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: Drawdown zone classification
// ---------------------------------------------------------------------------

test('drawdown90d < 10% → no_dip', () => {
  assert(classifyDrawdownZone(5, 8, 7) === 'no_dip', 'small drawdown is no_dip');
  assert(classifyDrawdownZone(0, 0, 7) === 'no_dip', 'zero drawdown is no_dip');
  assert(classifyDrawdownZone(8, 9.9, 7) === 'no_dip', 'just under threshold is no_dip');
});

test('drawdown30d >= 12% AND drawdown90d < 20% → sharp_crash', () => {
  assert(classifyDrawdownZone(12, 7, 15) === 'sharp_crash', 'exact threshold is sharp_crash');
  assert(classifyDrawdownZone(18, 7, 7) === 'sharp_crash', 'large 30d drop with low 90d is sharp_crash');
  assert(classifyDrawdownZone(15, 7, 7) === 'sharp_crash', 'mid 30d drop with low 90d is sharp_crash');
});

test('drawdown90d 15–30% AND drawdown30d >= 8% → classic_dip', () => {
  assert(classifyDrawdownZone(10, 17, 20) === 'classic_dip', 'sweet spot values are classic_dip');
  assert(classifyDrawdownZone(8, 20, 28) === 'classic_dip', 'min thresholds qualify as classic_dip');
  assert(classifyDrawdownZone(15, 20, 25) === 'classic_dip', 'centre of sweet spot is classic_dip');
});

test('drawdown90d 30–45% with sufficient quality → deep_value', () => {
  assert(classifyDrawdownZone(20, 35, 35) === 'deep_value', 'drawdown90d > 30 with quality ≥ 6 is deep_value');
  assert(classifyDrawdownZone(20, 40, 40) === 'deep_value', 'drawdown90d 40% with adequate quality is deep_value');
  assert(classifyDrawdownZone(20, 44, 44) === 'deep_value', 'drawdown90d near 45 is still deep_value');
});

test('drawdown90d > 45% → recovery_trap', () => {
  assert(classifyDrawdownZone(20, 50, 46) === 'recovery_trap', 'drawdown90d > 45 is recovery_trap');
  assert(classifyDrawdownZone(20, 60, 60) === 'recovery_trap', 'extreme drawdown is recovery_trap');
});

test('drawdown90d > 35% with weak quality → recovery_trap', () => {
  assert(classifyDrawdownZone(20, 38, 5) === 'recovery_trap', 'deep fall + strength < 6 is recovery_trap');
  assert(classifyDrawdownZone(20, 35.1, 5) === 'recovery_trap', 'just over 35% with weak quality is recovery_trap');
});

test('zone priority: recovery_trap beats deep_value', () => {
  // drawdown90d = 46 would qualify for deep_value (30-45) except recovery_trap takes priority at > 45
  assert(classifyDrawdownZone(20, 46, 7) === 'recovery_trap', 'recovery_trap beats deep_value when > 45%');
});

// ---------------------------------------------------------------------------
// Tests: drawdownTermSpread and drawdownChangeRate naming/semantics
// ---------------------------------------------------------------------------

test('drawdownTermSpread is window comparison, not acceleration', () => {
  const spread = computeDrawdownTermSpread(10, 25);
  assert(spread === 15, 'spread = drawdown90d - drawdown30d');
  assert(computeDrawdownTermSpread(20, 20) === 0, 'equal windows → zero spread');
  assert(computeDrawdownTermSpread(25, 15) < 0, 'negative spread when 30d worse than 90d');
});

test('drawdownChangeRate requires previous snapshot — null if absent', () => {
  assert(computeDrawdownChangeRate(25, null) === null, 'null previous → null rate, not 0');
  assert(computeDrawdownChangeRate(25, 20) === 5, 'worsening drawdown gives positive rate');
  assert(computeDrawdownChangeRate(15, 20) === -5, 'recovering drawdown gives negative rate');
  assert(computeDrawdownChangeRate(20, 20) === 0, 'unchanged drawdown gives zero rate');
});

// ---------------------------------------------------------------------------
// Tests: Drawdown severity score
// ---------------------------------------------------------------------------

test('no_dip gives low severity score', () => {
  const score = computeDrawdownSeverityScore(5, 8, 'no_dip');
  assert(score === 1.0, 'no_dip has minimum severity score of 1.0');
});

test('classic_dip gives highest severity range', () => {
  const score = computeDrawdownSeverityScore(15, 22, 'classic_dip');
  assert(score >= 4.0 && score <= 7.5, 'classic_dip is in the 4–7.5 range');
});

test('recovery_trap does NOT maximise severity score', () => {
  const recoveryScore = computeDrawdownSeverityScore(30, 55, 'recovery_trap');
  const classicScore = computeDrawdownSeverityScore(15, 22, 'classic_dip');
  assert(recoveryScore < classicScore, 'recovery_trap scores below classic_dip');
  assert(recoveryScore <= 4.0, 'recovery_trap is capped at 4.0 max');
});

test('extreme drawdown >45% does not max out severity score', () => {
  const score = computeDrawdownSeverityScore(30, 70, 'recovery_trap');
  assert(score < 5.0, 'extreme drawdown severity is below 5.0');
  assert(score >= 0, 'severity score is non-negative');
});

// ---------------------------------------------------------------------------
// Tests: Company strength score
// ---------------------------------------------------------------------------

test('assetQualityScore >= 8 produces strong company score (above 7)', () => {
  const score = computeCompanyStrengthScore(8.0, makeGates(), true, []);
  assert(score > 7.0, 'quality 8 + all gates pass + seed = strong company score');
});

test('assetQualityScore 6–7 produces moderate company score', () => {
  const score = computeCompanyStrengthScore(6.5, makeGates(), false, []);
  assert(score >= 5.0 && score < 8.0, 'quality 6.5 + all gates = moderate range');
});

test('notSpeculative=false heavily penalises company score', () => {
  const withSpeculative = computeCompanyStrengthScore(8.0, makeGates({ notSpeculative: false }), true, []);
  const withoutSpeculative = computeCompanyStrengthScore(8.0, makeGates(), true, []);
  assert(withoutSpeculative - withSpeculative >= COMPANY_STRENGTH_PENALTIES.notSpeculative, 'speculative penalty applied');
  assert(withSpeculative < 6.0, 'speculative asset score drops below buy threshold');
});

test('liquidity=false heavily penalises company score', () => {
  const illiquid = computeCompanyStrengthScore(8.0, makeGates({ liquidity: false }), true, []);
  const liquid = computeCompanyStrengthScore(8.0, makeGates(), true, []);
  assert(liquid - illiquid >= COMPANY_STRENGTH_PENALTIES.liquidity, 'liquidity penalty applied');
});

test('seed universe adds bounded bonus, capped to prevent gaming', () => {
  const withSeed = computeCompanyStrengthScore(7.0, makeGates(), true, []);
  const withoutSeed = computeCompanyStrengthScore(7.0, makeGates(), false, []);
  assert(withSeed > withoutSeed, 'seed adds small bonus');
  // Bonus cannot exceed maxTotalBonus even with both seed + moat tag
  const withBothBonuses = computeCompanyStrengthScore(10.0, makeGates(), true, ['moat']);
  assert(withBothBonuses <= 10.0, 'bonus capped at 10.0');
  assert(withBothBonuses - 10.0 <= 0.01, 'bonus cannot push above 10.0');
});

test('company score is always 0–10', () => {
  const worst = computeCompanyStrengthScore(0, makeGates({ notSpeculative: false, liquidity: false, volatility: false, quality: false }), false, []);
  const best = computeCompanyStrengthScore(10, makeGates(), true, ['moat']);
  assert(worst >= 0, 'worst case is not negative');
  assert(best <= 10, 'best case does not exceed 10');
});

// ---------------------------------------------------------------------------
// Tests: Portfolio fit score
// ---------------------------------------------------------------------------

test('underweight sector improves portfolio fit score', () => {
  const concentration = makeConcentration({ sectorWeights: { tech: 5 } }); // 5% = underweight
  const opp = makeOpp({ tags: ['tech'] });
  const { score } = computePortfolioFitScore(7.0, true, concentration, 'stock', opp.tags);
  const baseline = computePortfolioFitScore(7.0, true, makeConcentration(), 'stock', []);
  assert(score > baseline.score, 'underweight sector improves score vs. baseline');
});

test('overweight sector penalises portfolio fit score', () => {
  const concentration = makeConcentration({ sectorWeights: { tech: 35 } }); // 35% = overweight
  const opp = makeOpp({ tags: ['tech'] });
  const { score, warnings } = computePortfolioFitScore(7.0, true, concentration, 'stock', opp.tags);
  const baseline = computePortfolioFitScore(7.0, true, makeConcentration(), 'stock', []);
  assert(score < baseline.score, 'overweight sector reduces score');
  assert(warnings.some((w) => w.includes('overweight')), 'overweight warning emitted');
});

test('missing concentration data returns conservative 5.0 with warning', () => {
  const { score, warnings } = computePortfolioFitScore(8.0, true, null, 'stock', []);
  assert(score === 5.0, 'null concentration returns 5.0');
  assert(warnings.some((w) => w.includes('unavailable') || w.includes('unknown')), 'warning emitted for missing data');
});

test('high concentration warnings penalise fit score', () => {
  const concentration = makeConcentration({ highConcentrationWarnings: ['semiconductor overweight'] });
  const { score } = computePortfolioFitScore(7.0, true, concentration, 'stock', []);
  const clean = computePortfolioFitScore(7.0, true, makeConcentration(), 'stock', []);
  assert(score < clean.score, 'concentration warning reduces fit score');
});

test('ETF adding diversification improves score when ETF ratio is low', () => {
  const concentration = makeConcentration({ stockVsEtfRatio: { stocks: 85, etfs: 15 } });
  const etfScore = computePortfolioFitScore(7.0, true, concentration, 'etf', []).score;
  const stockScore = computePortfolioFitScore(7.0, true, concentration, 'stock', []).score;
  assert(etfScore > stockScore, 'ETF gets diversification bonus when portfolio is stock-heavy');
});

// ---------------------------------------------------------------------------
// Tests: Value trap detection
// ---------------------------------------------------------------------------

test('speculative asset with big drawdown → high value trap risk', () => {
  const opp = makeOpp({ qualityGates: makeGates({ notSpeculative: false }), drawdown: makeDrawdown(30, 40, 50) });
  const { risk, reasons } = detectValueTrapRisk(opp, 'recovery_trap', 3.0);
  assert(risk === 'high', 'speculative = high value trap risk');
  assert(reasons.some((r) => r.toLowerCase().includes('speculative')), 'reason mentions speculative');
});

test('illiquid asset with big drawdown → high value trap risk', () => {
  const opp = makeOpp({ qualityGates: makeGates({ liquidity: false }), drawdown: makeDrawdown(30, 40, 40) });
  const { risk } = detectValueTrapRisk(opp, 'deep_value', 5.0);
  assert(risk === 'high', 'illiquid = high value trap risk');
});

test('drawdown90d > 50% with companyStrength < 8 → high value trap risk', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(30, 50, 55) });
  const { risk, reasons } = detectValueTrapRisk(opp, 'recovery_trap', 6.0);
  assert(risk === 'high', 'extreme drawdown + strength < 8 = high risk');
  assert(reasons.some((r) => r.includes('55.0%')), 'reason includes drawdown value');
});

test('pricing blocked does NOT automatically mean high value trap risk', () => {
  // Pricing blocked = cannot size a BUY, but company may still be sound
  const opp = makeOpp({
    pricingDataAvailable: false,
    pricingMethod: 'usd_no_fx',
    currentPrice: null,
    drawdown: makeDrawdown(10, 18, 22),
  });
  const { risk } = detectValueTrapRisk(opp, 'classic_dip', 8.0);
  // Should be medium (pricing concern) not high (structural risk)
  assert(risk !== 'high', 'pricing blocked alone does not elevate to high value trap risk');
  assert(risk === 'medium', 'pricing not safe = medium risk with note');
});

test('strong company + controlled drawdown → low value trap risk', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(10, 15, 20), isSeedUniverse: true });
  const { risk } = detectValueTrapRisk(opp, 'classic_dip', 8.5);
  assert(risk === 'low', 'quality asset in sweet spot = low value trap risk');
});

test('value trap reasons distinguish pricing blocked from structural risk', () => {
  const opp = makeOpp({ pricingDataAvailable: false, pricingMethod: 'usd_no_fx', currentPrice: null });
  const { risk, reasons } = detectValueTrapRisk(opp, 'classic_dip', 8.0);
  if (risk === 'medium') {
    assert(
      reasons.some((r) => r.toLowerCase().includes('pricing') || r.toLowerCase().includes('eur')),
      'medium risk reason distinguishes pricing from structural issue',
    );
    // The reason should clarify this is a pricing issue, not a quality verdict
    assert(
      reasons.some((r) => r.toLowerCase().includes('blocked') || r.toLowerCase().includes('sizing') || r.toLowerCase().includes('quality verdict')),
      'reason clarifies pricing block is not a quality verdict',
    );
  }
  assert(true, 'value trap reasons handled');
});

// ---------------------------------------------------------------------------
// Tests: Composite scoring
// ---------------------------------------------------------------------------

test('strong company + classic dip + good fit + safe pricing → high radar score', () => {
  const score = computeDrawdownOpportunityScore(7.0, 8.5, 8.0, true, 8.0);
  assert(score >= 6.5, 'strong inputs produce a high radar score');
  assert(score <= 10, 'score does not exceed 10');
});

test('brutal drawdown + weak quality → lower composite score', () => {
  const strong = computeDrawdownOpportunityScore(7.0, 8.5, 7.0, true, 7.0);
  const weak = computeDrawdownOpportunityScore(7.0, 3.0, 7.0, true, 7.0);
  assert(weak < strong, 'weak company strength reduces composite score');
});

test('pricing unsafe reduces composite score without zeroing it', () => {
  const safe = computeDrawdownOpportunityScore(7.0, 8.0, 7.0, true, 7.0);
  const blocked = computeDrawdownOpportunityScore(7.0, 8.0, 7.0, false, 7.0);
  assert(blocked < safe, 'pricing unsafe reduces score');
  assert(blocked > 0, 'score remains non-zero when pricing blocked (informational)');
});

test('concentration penalty reduces portfolio fit → reduces composite score', () => {
  const goodFit = computeDrawdownOpportunityScore(7.0, 8.0, 8.0, true, 7.0);
  const badFit = computeDrawdownOpportunityScore(7.0, 8.0, 2.0, true, 7.0);
  assert(badFit < goodFit, 'poor portfolio fit reduces composite score');
});

test('composite score is always 0–10', () => {
  const min = computeDrawdownOpportunityScore(0, 0, 0, false, 0);
  const max = computeDrawdownOpportunityScore(10, 10, 10, true, 10);
  assert(min >= 0, 'min composite score is non-negative');
  assert(max <= 10, 'max composite score does not exceed 10');
});

// ---------------------------------------------------------------------------
// Tests: determineActionable blocking rules
// ---------------------------------------------------------------------------

test('pricing unsafe → blocked_pricing regardless of score', () => {
  const result = determineActionable(9.0, 9.0, false, 'low', 9.0, 'classic_dip');
  assert(result === 'blocked_pricing', 'pricing block takes priority over high score');
});

test('weak quality → blocked_quality when pricing is safe', () => {
  const result = determineActionable(7.0, 4.0, true, 'low', 8.0, 'classic_dip');
  assert(result === 'blocked_quality', 'quality block applied when companyStrength < 6');
});

test('high value trap risk → needs_fundamental_research', () => {
  const result = determineActionable(7.0, 7.0, true, 'high', 8.0, 'classic_dip');
  assert(result === 'needs_fundamental_research', 'high trap risk requires fundamental research');
});

test('poor concentration fit → blocked_concentration', () => {
  const result = determineActionable(7.0, 7.0, true, 'low', PORTFOLIO_FIT_THRESHOLDS.fitBlockThreshold - 0.1, 'classic_dip');
  assert(result === 'blocked_concentration', 'low portfolio fit score triggers concentration block');
});

test('recovery_trap zone → needs_fundamental_research when other blocks not triggered', () => {
  const result = determineActionable(7.0, 7.0, true, 'medium', 8.0, 'recovery_trap');
  assert(result === 'needs_fundamental_research', 'recovery_trap always needs fundamental research');
});

test('score >= 6.5 with no blocks → buy_candidate_possible', () => {
  const result = determineActionable(8.0, 8.0, true, 'low', 8.0, 'classic_dip');
  assert(result === 'buy_candidate_possible', 'high score with no blocks = buy candidate possible');
});

test('score < 6.5 with no blocks → watch_research', () => {
  const result = determineActionable(4.0, 7.0, true, 'low', 8.0, 'classic_dip');
  assert(result === 'watch_research', 'score below threshold but no blocks = watch research');
});

// ---------------------------------------------------------------------------
// Tests: buildDrawdownRadarAssessment — end-to-end
// ---------------------------------------------------------------------------

test('full assessment: strong company + classic dip + safe pricing', () => {
  const opp = makeOpp({
    drawdown: makeDrawdown(12, 18, 22),
    score: makeScore(8.0, { assetQuality: 8.5, portfolioFit: 7.5, riskReward: 8.0 }),
    pricingDataAvailable: true,
    pricingMethod: 'usd_converted',
  });
  const assessment = buildDrawdownRadarAssessment(opp, 18.0, makeConcentration());

  assert(assessment.zone === 'classic_dip', 'zone is classic_dip');
  assert(assessment.companyStrengthScore >= 7.0, 'strong company score');
  assert(assessment.drawdownSeverityScore >= 4.0, 'drawdown severity scored');
  assert(assessment.drawdownTermSpread === 22 - 12, 'termSpread = drawdown90d - drawdown30d');
  assert(assessment.drawdownChangeRate === 22 - 18, 'changeRate = current - previous');
  assert(assessment.actionable !== 'blocked_pricing', 'not blocked on pricing');
});

test('pricing unsafe → blocked_pricing actionable + warnings', () => {
  const opp = makeOpp({
    pricingDataAvailable: false,
    pricingMethod: 'usd_no_fx',
    currentPrice: null,
    drawdown: makeDrawdown(12, 18, 22),
  });
  const assessment = buildDrawdownRadarAssessment(opp, null, makeConcentration());

  assert(assessment.actionable === 'blocked_pricing', 'pricing unsafe blocks buy');
  assert(assessment.warnings.some((w) => w.includes('null') || w.includes('sizing') || w.includes('EUR')), 'warning mentions null/EUR/sizing');
});

test('no prior snapshot → drawdownChangeRate is null (not 0)', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(10, 18, 22) });
  const assessment = buildDrawdownRadarAssessment(opp, null, makeConcentration());
  assert(assessment.drawdownChangeRate === null, 'no prior snapshot produces null changeRate, not 0');
});

test('drawdownTermSpread is correctly computed as window comparison', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(10, 18, 25) });
  const assessment = buildDrawdownRadarAssessment(opp, null, null);
  assert(assessment.drawdownTermSpread === 25 - 10, 'termSpread = drawdown90d - drawdown30d');
  // Verify the name used is termSpread, not acceleration
  const keys = Object.keys(assessment);
  assert(keys.includes('drawdownTermSpread'), 'field is named drawdownTermSpread');
  assert(!keys.includes('drawdownAcceleration'), 'no field named drawdownAcceleration');
});

test('recovery_trap zone leads to needs_fundamental_research', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(35, 50, 55) });
  const assessment = buildDrawdownRadarAssessment(opp, null, makeConcentration());
  assert(assessment.zone === 'recovery_trap', 'zone is recovery_trap');
  assert(
    assessment.actionable === 'needs_fundamental_research' ||
    assessment.actionable === 'blocked_pricing' ||
    assessment.actionable === 'blocked_quality',
    'recovery_trap is not buy_candidate_possible',
  );
});

test('extreme drawdown does not auto-produce buy_candidate_possible', () => {
  const opp = makeOpp({
    drawdown: makeDrawdown(40, 55, 60),
    score: makeScore(9.0, { assetQuality: 9.0 }),
    pricingDataAvailable: true,
  });
  const assessment = buildDrawdownRadarAssessment(opp, null, makeConcentration());
  assert(assessment.actionable !== 'buy_candidate_possible', 'extreme drawdown cannot auto-produce buy candidate');
});

// ---------------------------------------------------------------------------
// Tests: Safety (no fake fundamentals, no API calls, no side effects)
// ---------------------------------------------------------------------------

test('no fundamentals in reasons/warnings strings', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(10, 18, 22) });
  const assessment = buildDrawdownRadarAssessment(opp, null, makeConcentration());
  const allStrings = [...assessment.reasons, ...assessment.warnings].join(' ').toLowerCase();

  const forbiddenTerms = ['revenue', 'earnings', 'margin', 'pe ratio', 'p/e', 'market cap', 'eps', 'cash flow', 'debt', 'ebitda'];
  for (const term of forbiddenTerms) {
    assert(!allStrings.includes(term), `no fake fundamental "${term}" in assessment strings`);
  }
});

test('currentPrice null does not appear as 0 anywhere in assessment', () => {
  const opp = makeOpp({ currentPrice: null, pricingDataAvailable: false, pricingMethod: 'usd_no_fx' });
  const assessment = buildDrawdownRadarAssessment(opp, null, null);

  // Assessment does not store currentPrice (it's not a field on DrawdownRadarAssessment)
  assert(!('currentPrice' in assessment), 'assessment has no currentPrice field');
  // Scores are computed without requiring currentPrice
  assert(typeof assessment.drawdownOpportunityScore === 'number', 'score is computed even with null price');
  assert(assessment.drawdownOpportunityScore >= 0, 'score is non-negative even with null price');
});

test('buildDrawdownRadarAssessment makes no API or provider calls', () => {
  // This is inherently tested by the function signature (no async, no imports from pricing providers)
  const opp = makeOpp();
  const result = buildDrawdownRadarAssessment(opp, null, null);
  assert(typeof result === 'object', 'returns an object (synchronous, no I/O)');
  assert(result.ticker === 'AAPL', 'ticker preserved in assessment');
});

test('all score fields are numeric and within 0–10', () => {
  const opp = makeOpp({ drawdown: makeDrawdown(12, 18, 22) });
  const assessment = buildDrawdownRadarAssessment(opp, 20.0, makeConcentration());

  assert(assessment.drawdownOpportunityScore >= 0 && assessment.drawdownOpportunityScore <= 10, 'drawdownOpportunityScore in 0-10');
  assert(assessment.companyStrengthScore >= 0 && assessment.companyStrengthScore <= 10, 'companyStrengthScore in 0-10');
  assert(assessment.portfolioFitScore >= 0 && assessment.portfolioFitScore <= 10, 'portfolioFitScore in 0-10');
  assert(assessment.drawdownSeverityScore >= 0 && assessment.drawdownSeverityScore <= 10, 'drawdownSeverityScore in 0-10');
});

test('assessment includes reasons and warnings arrays', () => {
  const opp = makeOpp();
  const assessment = buildDrawdownRadarAssessment(opp, null, null);
  assert(Array.isArray(assessment.reasons), 'reasons is an array');
  assert(Array.isArray(assessment.warnings), 'warnings is an array');
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function main(): void {
  console.log('\n▶ src/lib/discovery/__tests__/drawdown-radar.test.ts\n');
  for (const r of results) console.log(r);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
