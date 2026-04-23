// Alert generator — compares current engine output with previous state
// Only generates alerts for meaningful changes to avoid spam

import { createAlert, getPreviousStates, savePreviousStates, shouldSendAlert } from './history';
import type {
  PortfolioAnalysis,
  Opportunity,
  AllocationRecommendation,
  ConcentrationData,
  Alert,
  PreviousStates,
  PortfolioState,
  OpportunityState,
} from '../types';

// States that trigger alerts when entered or changed
const ALERT_PORTFOLIO_STATES: PortfolioState[] = ['BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL', 'REVIEW', 'REDUCE'];
const ALERT_OPPORTUNITY_STATES: OpportunityState[] = ['BUY', 'READY_TO_BUY', 'REVIEW_FOR_TRIM', 'EXIT'];

// --------------------------------------------------------------------------
// Portfolio change alerts
// --------------------------------------------------------------------------

function generatePortfolioAlerts(
  analyses: PortfolioAnalysis[],
  prev: PreviousStates
): Alert[] {
  const alerts: Alert[] = [];

  for (const analysis of analyses) {
    if (analysis.priceError) continue;
    const assetId = analysis.holding.id;
    const prevEntry = prev.portfolio[assetId];
    const currentState = analysis.state;
    const prevState = prevEntry?.state as PortfolioState | undefined;

    // Alert only when state actually changes into an actionable state,
    // or when this asset has no previous record at all (first run).
    const stateChanged = prevState !== undefined && prevState !== currentState;
    const newlyActionable = prevState === undefined && ALERT_PORTFOLIO_STATES.includes(currentState);

    if (!stateChanged && !newlyActionable) continue;
    if (!ALERT_PORTFOLIO_STATES.includes(currentState) && !stateChanged) continue;
    if (!shouldSendAlert(assetId, prev)) continue;

    const ticker = analysis.holding.ticker ?? analysis.holding.id.toUpperCase();
    const drawdownStr = `-${analysis.drawdown.maxDrawdown.toFixed(1)}%`;
    const priceStr = `${analysis.holding.currency === 'EUR' ? '€' : '$'}${analysis.currentPrice.toFixed(2)}`;

    let message = `📊 *${ticker}* — Portfolio Alert\n`;
    message += `Mode: CORE_PORTFOLIO | Type: ${analysis.holding.type.toUpperCase()}\n`;
    message += `State: \`${currentState}\`${stateChanged ? ` (was: ${prevState})` : ''}\n`;
    message += `Price: ${priceStr} | Drawdown: ${drawdownStr} from ${analysis.drawdown.primaryWindow} high\n\n`;
    message += `*Why:*\n${analysis.reasons.slice(0, 3).map((r) => `• ${r}`).join('\n')}\n\n`;
    if (analysis.suggestedAmountEur.max > 0) {
      message += `*Suggested:* Consider adding €${analysis.suggestedAmountEur.min}–€${analysis.suggestedAmountEur.max}\n`;
    }
    message += `*Confidence:* ${analysis.confidence.toUpperCase()}`;

    alerts.push(
      createAlert({
        type: 'portfolio_state_change',
        asset: ticker,
        assetName: analysis.holding.name,
        assetType: analysis.holding.type,
        oldState: prevState,
        newState: currentState,
        message,
      })
    );
  }

  return alerts;
}

// --------------------------------------------------------------------------
// Opportunity alerts
// --------------------------------------------------------------------------

function generateOpportunityAlerts(
  opportunities: Opportunity[],
  prev: PreviousStates,
  alertType: 'new_opportunity' | 'etf_opportunity' | 'discovery'
): Alert[] {
  const alerts: Alert[] = [];

  for (const opp of opportunities) {
    const assetId = opp.ticker.toLowerCase();
    const prevEntry = prev.opportunities[assetId];
    const currentState = opp.state;
    const prevState = prevEntry?.state as OpportunityState | undefined;

    const stateChanged = prevState && prevState !== currentState;
    const isActionable = ALERT_OPPORTUNITY_STATES.includes(currentState);

    if (!isActionable && !stateChanged) continue;
    if (!shouldSendAlert(assetId, prev)) continue;

    const drawdownStr = `-${opp.drawdown.maxDrawdown.toFixed(1)}%`;
    const priceStr = `${opp.currency === 'EUR' ? '€' : '$'}${opp.currentPrice.toFixed(2)}`;

    let message = '';
    if (alertType === 'discovery') {
      message = `🔍 *${opp.ticker}* — New Discovery\n`;
      message += `Mode: OPPORTUNITY_SCANNER | Type: ${opp.type.toUpperCase()} | *Extended Universe*\n`;
    } else {
      message = `${opp.type === 'etf' ? '📦' : '📈'} *${opp.ticker}* — ${opp.name}\n`;
      message += `Mode: OPPORTUNITY_SCANNER | Type: ${opp.type.toUpperCase()}\n`;
    }

    message += `State: \`${currentState}\`${stateChanged ? ` (was: ${prevState})` : ''}\n`;
    message += `Score: ${opp.score.total}/10 | Price: ${priceStr} | Drawdown: ${drawdownStr}\n\n`;
    message += `*Why:*\n${opp.reasons.slice(0, 3).map((r) => `• ${r}`).join('\n')}\n\n`;
    if (opp.suggestedAmountEur.max > 0) {
      message += `*Suggested:* Consider €${opp.suggestedAmountEur.min}–€${opp.suggestedAmountEur.max}\n`;
    }
    message += `*Confidence:* ${opp.confidence.toUpperCase()}`;

    if (alertType === 'discovery') {
      const gates = opp.qualityGates;
      message += `\n\n*Quality gates passed:* liquidity ✓ quality ✓ volatility ✓ portfolio-fit ✓`;
    }

    alerts.push(
      createAlert({
        type: alertType,
        asset: opp.ticker,
        assetName: opp.name,
        assetType: opp.type,
        oldState: prevState,
        newState: currentState,
        message,
        score: opp.score.total,
      })
    );
  }

  return alerts;
}

// --------------------------------------------------------------------------
// Concentration warning alerts
// --------------------------------------------------------------------------

function generateConcentrationAlerts(
  concentration: ConcentrationData,
  prev: PreviousStates
): Alert[] {
  if (concentration.highConcentrationWarnings.length === 0) return [];

  const lastWarning = prev.opportunities['__concentration_warning__']?.lastAlertAt;
  if (lastWarning) {
    const hours = (Date.now() - new Date(lastWarning).getTime()) / 3600000;
    if (hours < 24) return [];
  }

  let message = `⚠️ *Portfolio Concentration Warning*\n\n`;
  message += concentration.highConcentrationWarnings.map((w) => `• ${w}`).join('\n');
  message += `\n\n*Suggestion:* Consider diversified ETF adds before adding more single-stock tech exposure.`;

  return [
    createAlert({
      type: 'concentration_warning',
      message,
    }),
  ];
}

// --------------------------------------------------------------------------
// Main alert generator
// --------------------------------------------------------------------------

export function generateAlerts(
  portfolioAnalyses: PortfolioAnalysis[],
  stockOpportunities: Opportunity[],
  etfOpportunities: Opportunity[],
  discoveredOpportunities: Opportunity[],
  concentration: ConcentrationData,
  allocationRecommendations: AllocationRecommendation[]
): Alert[] {
  const prev = getPreviousStates();
  const allAlerts: Alert[] = [];

  // Portfolio state changes
  allAlerts.push(...generatePortfolioAlerts(portfolioAnalyses, prev));

  // New stock opportunities
  const buyStocks = stockOpportunities.filter((o) => ALERT_OPPORTUNITY_STATES.includes(o.state));
  allAlerts.push(...generateOpportunityAlerts(buyStocks, prev, 'new_opportunity'));

  // New ETF opportunities
  const buyEtfs = etfOpportunities.filter((o) => ALERT_OPPORTUNITY_STATES.includes(o.state));
  allAlerts.push(...generateOpportunityAlerts(buyEtfs, prev, 'etf_opportunity'));

  // Discoveries
  const buyDiscoveries = discoveredOpportunities.filter((o) => ALERT_OPPORTUNITY_STATES.includes(o.state));
  allAlerts.push(...generateOpportunityAlerts(buyDiscoveries, prev, 'discovery'));

  // Concentration warnings
  allAlerts.push(...generateConcentrationAlerts(concentration, prev));

  // Update previous states
  const newPrev: PreviousStates = {
    updatedAt: new Date().toISOString(),
    portfolio: { ...prev.portfolio },
    opportunities: { ...prev.opportunities },
  };

  for (const analysis of portfolioAnalyses) {
    // Use the same ticker derivation used when creating the alert
    const ticker = analysis.holding.ticker ?? analysis.holding.id.toUpperCase();
    newPrev.portfolio[analysis.holding.id] = {
      assetId: analysis.holding.id,
      state: analysis.state,
      lastAlertAt: allAlerts.some((a) => a.asset === ticker)
        ? new Date().toISOString()
        : (prev.portfolio[analysis.holding.id]?.lastAlertAt ?? ''),
    };
  }

  for (const opp of [...stockOpportunities, ...etfOpportunities, ...discoveredOpportunities]) {
    const id = opp.ticker.toLowerCase();
    newPrev.opportunities[id] = {
      assetId: id,
      state: opp.state,
      score: opp.score.total,
      lastAlertAt: allAlerts.some((a) => a.asset === opp.ticker)
        ? new Date().toISOString()
        : (prev.opportunities[id]?.lastAlertAt ?? ''),
    };
  }

  if (allAlerts.some((a) => a.type === 'concentration_warning')) {
    newPrev.opportunities['__concentration_warning__'] = {
      assetId: '__concentration_warning__',
      state: 'WATCH',
      lastAlertAt: new Date().toISOString(),
    };
  }

  savePreviousStates(newPrev);

  return allAlerts;
}
