// CORE_PORTFOLIO_ENGINE
// Analyzes existing holdings and recommends add/hold/review actions
// Uses drawdown zones, conviction, DCA, concentration, and thesis risk

import { calcDrawdownPct, calcPnlPct, pctOfTotal, clamp } from '../utils/math';
import { safeFetchHighs } from '../pricing/factory';
import { getRulesConfig, getAllocationConfig, getOverridesConfig } from '../utils/config-loader';
import type {
  PortfolioConfig,
  PortfolioHolding,
  PortfolioAnalysis,
  PortfolioState,
  DrawdownData,
  ConcentrationData,
  RecentHighs,
} from '../types';

// --------------------------------------------------------------------------
// Drawdown state mapping
// --------------------------------------------------------------------------

function stateFromDrawdown(
  maxDrawdown: number,
  holding: PortfolioHolding
): PortfolioState {
  const rules = getRulesConfig();
  const isHighConviction = holding.convictionScore >= rules.highConvictionThreshold;

  for (const zone of rules.drawdownZones) {
    if (maxDrawdown >= zone.minPct && maxDrawdown < zone.maxPct) {
      if (isHighConviction && zone.highConvictionState) {
        return zone.highConvictionState as PortfolioState;
      }
      return zone.baseState as PortfolioState;
    }
  }
  return 'REVIEW'; // fallback for extreme drawdown
}

// --------------------------------------------------------------------------
// Thesis risk adjustment
// --------------------------------------------------------------------------

function adjustForThesisRisk(
  state: PortfolioState,
  holding: PortfolioHolding
): PortfolioState {
  const rules = getRulesConfig();
  const risk = holding.manualThesisRisk ?? 'none';
  if (risk === 'none' || risk === 'low') return state;

  const penalty = rules.thesisRiskAdjustment[risk] ?? 0;
  if (risk === 'high') {
    // High thesis risk: never recommend adding, push to REVIEW
    if (['BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL'].includes(state)) return 'REVIEW';
  } else if (risk === 'medium' && penalty >= 1.5) {
    // Medium thesis risk: downgrade by one level
    const downgrade: Record<PortfolioState, PortfolioState> = {
      BUY_MORE: 'BUY_PARTIAL',
      BUY_PARTIAL: 'BUY_SMALL',
      BUY_SMALL: 'WAIT',
      WAIT: 'DO_NOTHING',
      DO_NOTHING: 'DO_NOTHING',
      REVIEW: 'REVIEW',
      REDUCE: 'REDUCE',
    };
    return downgrade[state] ?? state;
  }
  return state;
}

// --------------------------------------------------------------------------
// Concentration penalty calculation
// --------------------------------------------------------------------------

function calcConcentrationPenalty(
  holding: PortfolioHolding,
  concentration: ConcentrationData
): number {
  const rules = getRulesConfig();
  const limits = rules.concentration;
  let penalty = 0;

  // Check if any of the asset's tags exceed concentration limits
  for (const tag of holding.tags) {
    const tagWeight = concentration.themeWeights[tag] ?? 0;
    if (tag === 'semis' && tagWeight > limits.maxSemisWeightPct) penalty = Math.max(penalty, 0.6);
    if (tag === 'AI' && tagWeight > limits.maxAiWeightPct) penalty = Math.max(penalty, 0.4);
    if (tag === 'tech' && tagWeight > limits.maxTechWeightPct) penalty = Math.max(penalty, 0.3);
    const sectorWeight = concentration.sectorWeights[tag] ?? 0;
    if (sectorWeight > limits.maxSectorWeightPct) penalty = Math.max(penalty, 0.5);
  }

  // Check single-asset concentration
  if (holding.type === 'stock') {
    const assetWeight = concentration.sectorWeights[`asset:${holding.id}`] ?? 0;
    if (assetWeight > limits.maxSingleStockWeightPct) penalty = Math.max(penalty, 0.7);
  }

  return clamp(penalty, 0, 1);
}

// --------------------------------------------------------------------------
// Suggested deployment amount
// --------------------------------------------------------------------------

function calcSuggestedAmount(
  state: PortfolioState,
  holding: PortfolioHolding,
  cashAvailable: number,
  targetReserve: number,
  concentrationPenalty: number
): { min: number; max: number } {
  const allocConfig = getAllocationConfig();
  const deployable = Math.max(0, cashAvailable - targetReserve);

  const tier = allocConfig.tiers.find((t) => t.state === state);
  if (!tier || deployable <= 0) return { min: 0, max: 0 };

  let minPct = tier.minPctOfDeployable / 100;
  let maxPct = tier.maxPctOfDeployable / 100;

  // High conviction multiplier
  if (holding.convictionScore >= 9) {
    maxPct *= allocConfig.highConvictionMultiplier;
  }

  // ETF diversification bonus
  if (holding.type === 'etf') {
    maxPct += allocConfig.etfConcentrationBonus;
    minPct += allocConfig.etfConcentrationBonus / 2;
  }

  // Concentration penalty
  if (concentrationPenalty > 0) {
    const reduction = 1 - concentrationPenalty * (1 - allocConfig.concentrationPenaltyReduction);
    minPct *= reduction;
    maxPct *= reduction;
  }

  let minAmount = Math.round(deployable * minPct);
  let maxAmount = Math.round(deployable * maxPct);

  // Respect hard limits
  minAmount = clamp(minAmount, allocConfig.minSingleTradeEur, allocConfig.maxSingleTradeEur);
  maxAmount = clamp(maxAmount, allocConfig.minSingleTradeEur, allocConfig.maxSingleTradeEur);

  return { min: Math.min(minAmount, maxAmount), max: maxAmount };
}

// --------------------------------------------------------------------------
// Build reasons array
// --------------------------------------------------------------------------

function buildReasons(
  holding: PortfolioHolding,
  drawdown: DrawdownData,
  state: PortfolioState,
  concentrationPenalty: number,
  concentration: ConcentrationData
): string[] {
  const reasons: string[] = [];

  const windowLabel = drawdown.primaryWindow === '90d' ? '90 días' : drawdown.primaryWindow === '60d' ? '60 días' : '30 días';
  reasons.push(
    `Bajó un ${drawdown.maxDrawdown.toFixed(1)}% desde el máximo de ${windowLabel} (${drawdown.drawdown30d.toFixed(1)}% / ${drawdown.drawdown60d.toFixed(1)}% / ${drawdown.drawdown90d.toFixed(1)}% en 30/60/90d)`
  );

  if (holding.core) reasons.push('Posición central a largo plazo con alta convicción');
  if (holding.dcaMonthlyEur > 0) reasons.push(`Aportación DCA de €${holding.dcaMonthlyEur}/mes ya activa`);
  if (holding.type === 'etf') reasons.push('ETF con diversificación incorporada');

  if (concentrationPenalty > 0.5) {
    const heavyTags = holding.tags.filter((t) =>
      (concentration.themeWeights[t] ?? 0) > 30 || (concentration.sectorWeights[t] ?? 0) > 40
    );
    if (heavyTags.length > 0) {
      reasons.push(`Alta concentración en ${heavyTags.join(', ')} — posición reducida`);
    }
  }

  if (holding.manualThesisRisk && holding.manualThesisRisk !== 'none') {
    const riskLabel = holding.manualThesisRisk === 'high' ? 'alta' : holding.manualThesisRisk === 'medium' ? 'media' : holding.manualThesisRisk;
    reasons.push(`Riesgo en tesis de inversión: ${riskLabel}`);
  }

  if (state === 'REVIEW') reasons.push('Revisa tu tesis antes de añadir más');
  if (state === 'DO_NOTHING') reasons.push('Precio cercano a máximos recientes — sin acción');

  return reasons;
}

function buildReduceReasons(
  holding: PortfolioHolding,
  unrealizedPnlPct: number,
  concentrationPenalty: number,
  concentration: ConcentrationData
): string[] {
  const reasons: string[] = [];

  if (unrealizedPnlPct >= 60) {
    reasons.push(
      `Ganancia en papel de +${unrealizedPnlPct.toFixed(0)}% — cerca de máximos. ` +
      `Considera vender un 20-30% para asegurar beneficios y liberar capital`
    );
  }

  if (concentrationPenalty > 0.65) {
    const assetWeight = concentration.sectorWeights[`asset:${holding.id}`] ?? 0;
    if (assetWeight > 0) {
      reasons.push(
        `Esta posición pesa un ${assetWeight.toFixed(0)}% de tu cartera. ` +
        `Reducir un poco mejora el equilibrio y baja el riesgo total`
      );
    } else {
      const heavyTags = holding.tags.filter(
        (t) => (concentration.themeWeights[t] ?? 0) > 35
      );
      if (heavyTags.length > 0) {
        reasons.push(
          `Concentración elevada en ${heavyTags.join(', ')} — reducir esta posición equilibra la cartera`
        );
      }
    }
  }

  if (holding.manualThesisRisk === 'high') {
    reasons.push('Riesgo alto en la tesis de inversión — considera salir o reducir significativamente');
  }

  return reasons;
}

// --------------------------------------------------------------------------
// Main engine: analyze a single holding
// --------------------------------------------------------------------------

export async function analyzeHolding(
  holding: PortfolioHolding,
  cashAvailable: number,
  targetReserve: number,
  concentration: ConcentrationData,
  recentHighs?: RecentHighs | null
): Promise<PortfolioAnalysis> {
  const overrides = getOverridesConfig();

  // Use provided highs or fetch them
  let highs = recentHighs;
  let priceError: string | undefined;

  if (!highs) {
    const ticker = holding.ticker ?? holding.id.toUpperCase();
    highs = await safeFetchHighs(ticker);
    if (!highs) {
      priceError = `Failed to fetch price data for ${ticker}`;
      // Return a neutral analysis if price fetch fails
      return {
        holding,
        currentPrice: 0,
        avgPrice: holding.avgPrice,
        unrealizedPnlPct: 0,
        drawdown: { drawdown30d: 0, drawdown60d: 0, drawdown90d: 0, maxDrawdown: 0, primaryWindow: '30d' },
        state: 'DO_NOTHING',
        suggestedAmountEur: { min: 0, max: 0 },
        reasons: [priceError],
        concentrationPenalty: 0,
        confidence: 'low',
        priceError,
      };
    }
  }

  const currentPrice = highs.currentPrice;
  const maxDrawdown = Math.max(highs.drawdown30d, highs.drawdown60d, highs.drawdown90d);
  const primaryWindow =
    highs.drawdown90d === maxDrawdown ? '90d' :
    highs.drawdown60d === maxDrawdown ? '60d' : '30d';

  const drawdown: DrawdownData = {
    drawdown30d: highs.drawdown30d,
    drawdown60d: highs.drawdown60d,
    drawdown90d: highs.drawdown90d,
    maxDrawdown,
    primaryWindow,
  };

  // Base state from drawdown
  let state = stateFromDrawdown(maxDrawdown, holding);

  // Override: no-buy flag
  if (holding.noBuyOverride || overrides.globalNoBuy) {
    if (['BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL'].includes(state)) {
      state = 'DO_NOTHING';
    }
  }

  // Override: extremely deep drawdown gets REVIEW instead of BUY_MORE
  if (maxDrawdown > 50) {
    state = 'REVIEW';
  }

  // Thesis risk adjustment
  state = adjustForThesisRisk(state, holding);

  // Market regime adjustment (bearish → downgrade buy signals)
  const marketRegime = overrides.marketRegime ?? 'neutral';
  if (marketRegime === 'bearish' && state === 'BUY_MORE') state = 'BUY_PARTIAL';

  // Concentration check
  const concentrationPenalty = calcConcentrationPenalty(holding, concentration);
  const unrealizedPnlPct = calcPnlPct(holding.avgPrice, currentPrice);

  // --- Sell / Reduce signals ---
  // Only check when not already in a buy state (price is near highs)
  const isNearHigh = maxDrawdown < 5;
  const profitThreshold = holding.core ? 120 : 70; // higher bar for core long-term holdings

  if (!['BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL', 'REVIEW'].includes(state)) {
    // Profit-taking: big gain AND near recent high
    if (isNearHigh && unrealizedPnlPct >= profitThreshold) {
      state = 'REDUCE';
    }
    // Heavy concentration override (position too large regardless of price)
    if (concentrationPenalty > 0.65 && state !== 'REDUCE') {
      state = 'REDUCE';
    }
  }

  // Suggested amount
  const suggestedAmountEur = calcSuggestedAmount(
    state, holding, cashAvailable, targetReserve, concentrationPenalty
  );

  // Confidence
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  if (holding.convictionScore >= 9 && maxDrawdown >= 10 && concentrationPenalty < 0.5) confidence = 'high';
  if (concentrationPenalty > 0.6 || (holding.manualThesisRisk ?? 'none') !== 'none') confidence = 'low';

  // Build reasons — use dedicated REDUCE reasons when applicable
  const reasons = state === 'REDUCE'
    ? [
        ...buildReduceReasons(holding, unrealizedPnlPct, concentrationPenalty, concentration),
        ...buildReasons(holding, drawdown, state, concentrationPenalty, concentration).slice(0, 1),
      ]
    : buildReasons(holding, drawdown, state, concentrationPenalty, concentration);

  return {
    holding,
    currentPrice,
    avgPrice: holding.avgPrice,
    unrealizedPnlPct,
    drawdown,
    state,
    suggestedAmountEur,
    reasons,
    concentrationPenalty,
    confidence,
    priceError,
  };
}

// --------------------------------------------------------------------------
// Calculate concentration data from portfolio
// --------------------------------------------------------------------------

export function calcConcentration(
  holdings: PortfolioHolding[],
  currentPrices: Record<string, number>
): ConcentrationData {
  const values: Record<string, number> = {};
  let totalValue = 0;

  for (const h of holdings) {
    const ticker = h.ticker ?? h.id.toUpperCase();
    const price = currentPrices[ticker] ?? currentPrices[h.id] ?? h.avgPrice;
    const units = h.units ?? 1;
    const value = price * units;
    values[h.id] = value;
    totalValue += value;
  }

  const sectorWeights: Record<string, number> = {};
  const themeWeights: Record<string, number> = {};
  let stockValue = 0;
  let etfValue = 0;
  const warnings: string[] = [];

  const rules = getRulesConfig();

  for (const h of holdings) {
    const value = values[h.id] ?? 0;
    const pct = pctOfTotal(value, totalValue);

    // Per-asset weight
    sectorWeights[`asset:${h.id}`] = pct;

    // Per-tag weight
    for (const tag of h.tags) {
      themeWeights[tag] = (themeWeights[tag] ?? 0) + pct;
      sectorWeights[tag] = (sectorWeights[tag] ?? 0) + pct;
    }

    if (h.type === 'stock') stockValue += value;
    else etfValue += value;
  }

  // Check for warnings
  if ((themeWeights['semis'] ?? 0) > rules.concentration.maxSemisWeightPct) {
    warnings.push(`Semiconductor concentration at ${themeWeights['semis']?.toFixed(0)}% (limit ${rules.concentration.maxSemisWeightPct}%)`);
  }
  if ((themeWeights['AI'] ?? 0) > rules.concentration.maxAiWeightPct) {
    warnings.push(`AI/theme concentration at ${themeWeights['AI']?.toFixed(0)}% (limit ${rules.concentration.maxAiWeightPct}%)`);
  }
  if ((themeWeights['tech'] ?? 0) > rules.concentration.maxTechWeightPct) {
    warnings.push(`Tech concentration at ${themeWeights['tech']?.toFixed(0)}% (limit ${rules.concentration.maxTechWeightPct}%)`);
  }

  // High single-stock warnings
  for (const h of holdings.filter((h) => h.type === 'stock')) {
    const pct = pctOfTotal(values[h.id] ?? 0, totalValue);
    if (pct > rules.concentration.maxSingleStockWeightPct) {
      warnings.push(`${h.ticker ?? h.id} is at ${pct.toFixed(0)}% of portfolio (limit ${rules.concentration.maxSingleStockWeightPct}%)`);
    }
  }

  return {
    totalPortfolioValue: totalValue,
    sectorWeights,
    themeWeights,
    stockVsEtfRatio: {
      stocks: pctOfTotal(stockValue, totalValue),
      etfs: pctOfTotal(etfValue, totalValue),
    },
    highConcentrationWarnings: warnings,
  };
}

// --------------------------------------------------------------------------
// Run the full portfolio engine
// --------------------------------------------------------------------------

export async function runPortfolioEngine(
  portfolioConfig: PortfolioConfig,
  allHighs: Record<string, RecentHighs>
): Promise<{ analyses: PortfolioAnalysis[]; concentration: ConcentrationData }> {
  const { holdings, cashAvailableEur, targetCashReserveEur } = portfolioConfig;

  // Build current prices map
  const currentPrices: Record<string, number> = {};
  for (const [ticker, highs] of Object.entries(allHighs)) {
    currentPrices[ticker] = highs.currentPrice;
  }

  // Calculate concentration first (used in per-holding analysis)
  const concentration = calcConcentration(holdings, currentPrices);

  // Analyze each holding
  const analyses: PortfolioAnalysis[] = await Promise.all(
    holdings.map((h) => {
      const ticker = h.ticker ?? h.id.toUpperCase();
      const highs = allHighs[ticker] ?? allHighs[h.id];
      return analyzeHolding(h, cashAvailableEur, targetCashReserveEur, concentration, highs);
    })
  );

  return { analyses, concentration };
}
