// Ranker utility — produces sorted ranked views across engines
// Used by the dashboard to show top-N lists

import type {
  PortfolioAnalysis,
  Opportunity,
  AllocationRecommendation,
  PortfolioState,
  OpportunityState,
} from '../types';

// States that are "actionable" — worth highlighting on dashboard
const ACTIONABLE_PORTFOLIO_STATES: PortfolioState[] = [
  'BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL',
];

const ACTIONABLE_OPPORTUNITY_STATES: OpportunityState[] = [
  'BUY', 'READY_TO_BUY',
];

const REVIEW_STATES: OpportunityState[] = [
  'REVIEW_FOR_TRIM', 'EXIT',
];

export function getTopPortfolioAdds(
  analyses: PortfolioAnalysis[],
  n = 5
): PortfolioAnalysis[] {
  return analyses
    .filter((a) => ACTIONABLE_PORTFOLIO_STATES.includes(a.state) && !a.priceError)
    .sort((a, b) => {
      // Rank by: state severity, then drawdown, then conviction
      const stateRank: Record<PortfolioState, number> = {
        BUY_MORE: 3, BUY_PARTIAL: 2, BUY_SMALL: 1,
        WAIT: 0, DO_NOTHING: 0, REVIEW: 0, REDUCE: 0,
      };
      const sDiff = stateRank[b.state] - stateRank[a.state];
      if (sDiff !== 0) return sDiff;
      return b.drawdown.maxDrawdown - a.drawdown.maxDrawdown;
    })
    .slice(0, n);
}

export function getTopStockOpportunities(
  opportunities: Opportunity[],
  n = 5
): Opportunity[] {
  return opportunities
    .filter((o) => o.type === 'stock' && ACTIONABLE_OPPORTUNITY_STATES.includes(o.state))
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, n);
}

export function getTopEtfOpportunities(
  opportunities: Opportunity[],
  n = 5
): Opportunity[] {
  return opportunities
    .filter((o) => o.type === 'etf' && ACTIONABLE_OPPORTUNITY_STATES.includes(o.state))
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, n);
}

export function getTopDiscoveries(
  discoveries: Opportunity[],
  n = 3
): Opportunity[] {
  return discoveries
    .filter((o) => ACTIONABLE_OPPORTUNITY_STATES.includes(o.state))
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, n);
}

export function getReviewItems(
  opportunities: Opportunity[]
): Opportunity[] {
  return opportunities
    .filter((o) => REVIEW_STATES.includes(o.state))
    .sort((a, b) => b.score.total - a.score.total);
}

export function getBestUseOfCash(
  recommendations: AllocationRecommendation[]
): AllocationRecommendation[] {
  return recommendations.sort((a, b) => a.forAmount - b.forAmount);
}
