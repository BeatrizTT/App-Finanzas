// CAPITAL_ALLOCATOR
// Compares all current opportunities (portfolio adds + external) and ranks best use of cash
// Outputs AllocationRecommendation for each configured deployable amount

import { clamp } from '../utils/math';
import { getAllocationConfig, getOverridesConfig } from '../utils/config-loader';
import type {
  PortfolioAnalysis,
  Opportunity,
  AllocationRecommendation,
  AllocationOption,
  AllocationState,
  PortfolioState,
  OpportunityState,
  AssetType,
} from '../types';

// --------------------------------------------------------------------------
// Score each candidate for allocation ranking
// --------------------------------------------------------------------------

interface AllocCandidate {
  asset: string;
  assetName: string;
  type: AssetType;
  state: PortfolioState | OpportunityState;
  score: number;
  isExistingHolding: boolean;
  suggestedAmountEur: { min: number; max: number };
  baseScore: number;
}

function portfolioStateToScore(state: PortfolioState): number {
  const map: Record<PortfolioState, number> = {
    BUY_MORE: 9,
    BUY_PARTIAL: 7.5,
    BUY_SMALL: 6,
    WAIT: 3,
    DO_NOTHING: 0,
    REVIEW: 0,
    REDUCE: -5,
  };
  return map[state] ?? 0;
}

function opportunityStateToScore(state: OpportunityState): number {
  const map: Record<OpportunityState, number> = {
    BUY: 9,
    READY_TO_BUY: 7,
    HOLD: 5,
    WATCH: 2,
    REVIEW_FOR_TRIM: -2,
    EXIT: -5,
    AVOID: -10,
  };
  return map[state] ?? 0;
}

function buildCandidates(
  portfolioAnalyses: PortfolioAnalysis[],
  stockOpportunities: Opportunity[],
  etfOpportunities: Opportunity[],
  discoveredOpportunities: Opportunity[]
): AllocCandidate[] {
  const candidates: AllocCandidate[] = [];

  // From portfolio (add to existing)
  for (const analysis of portfolioAnalyses) {
    if (analysis.priceError) continue;
    const actionableStates: PortfolioState[] = ['BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL'];
    if (!actionableStates.includes(analysis.state)) continue;

    const ticker = analysis.holding.ticker ?? analysis.holding.id.toUpperCase();
    candidates.push({
      asset: ticker,
      assetName: analysis.holding.name,
      type: analysis.holding.type,
      state: analysis.state,
      score: portfolioStateToScore(analysis.state) + analysis.holding.convictionScore,
      isExistingHolding: true,
      suggestedAmountEur: analysis.suggestedAmountEur,
      baseScore: portfolioStateToScore(analysis.state),
    });
  }

  // From scanner (new opportunities)
  const allExternal = [...stockOpportunities, ...etfOpportunities, ...discoveredOpportunities];
  for (const opp of allExternal) {
    const actionableStates: OpportunityState[] = ['BUY', 'READY_TO_BUY'];
    if (!actionableStates.includes(opp.state)) continue;

    candidates.push({
      asset: opp.ticker,
      assetName: opp.name,
      type: opp.type,
      state: opp.state,
      score: opp.score.total + opportunityStateToScore(opp.state) * 0.3,
      isExistingHolding: false,
      suggestedAmountEur: opp.suggestedAmountEur,
      baseScore: opportunityStateToScore(opp.state),
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// --------------------------------------------------------------------------
// Build allocation recommendation for a specific cash amount
// --------------------------------------------------------------------------

function buildRecommendation(
  forAmount: number,
  deployableAmount: number,
  candidates: AllocCandidate[]
): AllocationRecommendation {
  const allocConfig = getAllocationConfig();
  const overrides = getOverridesConfig();

  if (overrides.globalNoBuy || deployableAmount <= allocConfig.minSingleTradeEur) {
    return {
      forAmount,
      deployableAmount,
      options: [],
      holdCash: true,
      holdCashReason:
        deployableAmount <= allocConfig.minSingleTradeEur
          ? 'Deployable cash is below minimum trade size'
          : 'Global no-buy override is active',
      summary: 'Hold cash — no actionable opportunities or override active',
    };
  }

  if (candidates.length === 0) {
    return {
      forAmount,
      deployableAmount,
      options: [],
      holdCash: true,
      holdCashReason: 'No actionable opportunities meet minimum thresholds',
      summary: 'Hold cash — no strong opportunities detected across portfolio and scanner',
    };
  }

  const options: AllocationOption[] = [];
  const top = candidates.slice(0, 5);
  let rank = 1;

  for (const candidate of top) {
    const allocationState: AllocationState =
      rank === 1 ? 'BEST_USE_OF_CASH' : rank === 2 ? 'SECOND_BEST' : 'HOLD_CASH';

    // Scale suggested amount to the target deployment amount
    const scale = Math.min(1, forAmount / deployableAmount);
    const scaledMin = Math.round(candidate.suggestedAmountEur.min * scale);
    const scaledMax = Math.round(candidate.suggestedAmountEur.max * scale);
    const amount = clamp(
      Math.round((scaledMin + scaledMax) / 2),
      allocConfig.minSingleTradeEur,
      Math.min(forAmount, allocConfig.maxSingleTradeEur)
    );

    const percentOfDeployable = (amount / forAmount) * 100;

    const stateLabels: Record<string, string> = {
      BUY_MORE: 'caída fuerte', BUY_PARTIAL: 'caída moderada', BUY_SMALL: 'caída leve',
      BUY: 'señal de entrada fuerte', READY_TO_BUY: 'casi en zona de compra',
    };
    const stateEs = stateLabels[String(candidate.state)] ?? String(candidate.state);
    let reason = '';
    if (candidate.isExistingHolding) {
      reason = `Añadir a posición existente — ${stateEs}, prioridad #${rank} del motor`;
    } else {
      reason = `Nueva oportunidad del escáner — ${stateEs}, puntuación: ${candidate.score.toFixed(1)}`;
    }

    options.push({
      rank,
      asset: candidate.asset,
      assetName: candidate.assetName,
      type: candidate.type,
      state: candidate.state,
      score: Math.round(candidate.score * 10) / 10,
      allocationState,
      isExistingHolding: candidate.isExistingHolding,
      amountEur: amount,
      percentOfDeployable: Math.round(percentOfDeployable),
      reason,
    });

    rank++;
  }

  const best = options[0];
  const hasEtfInTop2 = options.slice(0, 2).some((o) => o.type === 'etf');

  let summary = `Best use of €${forAmount}: `;
  if (best) {
    summary += `${best.asset} (${best.type.toUpperCase()}) — ${best.state}`;
    if (best.amountEur > 0) summary += ` — suggested €${best.amountEur}`;
    if (options.length > 1 && options[1]) {
      summary += `. Also consider: ${options[1].asset}`;
    }
    if (hasEtfInTop2) summary += ' (ETF in top 2 for concentration benefit)';
  }

  return {
    forAmount,
    deployableAmount,
    options,
    holdCash: false,
    summary,
  };
}

// --------------------------------------------------------------------------
// Main allocator
// --------------------------------------------------------------------------

export function runCapitalAllocator(
  portfolioAnalyses: PortfolioAnalysis[],
  stockOpportunities: Opportunity[],
  etfOpportunities: Opportunity[],
  discoveredOpportunities: Opportunity[],
  cashAvailableEur: number,
  targetReserveEur: number
): AllocationRecommendation[] {
  const allocConfig = getAllocationConfig();
  const deployableAmount = Math.max(0, cashAvailableEur - targetReserveEur);

  const candidates = buildCandidates(
    portfolioAnalyses,
    stockOpportunities,
    etfOpportunities,
    discoveredOpportunities
  );

  return allocConfig.deployableAmounts.map((amount) =>
    buildRecommendation(amount, deployableAmount, candidates)
  );
}
