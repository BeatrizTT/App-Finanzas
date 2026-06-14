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

// Escapes dynamic text for Telegram parse_mode:"Markdown".
// Replaces _ with - (prevents italic-span conflicts inside _italic_ markers and elsewhere);
// strips * ` [ ] which have no reliable escape sequence in old Markdown mode.
function escapeMd(text: string): string {
  return text.replace(/_/g, '-').replace(/[*`[\]]/g, '');
}

// --------------------------------------------------------------------------
// Defensive Telegram templates (P1-4b) — REDUCE and REVIEW for portfolio
// holdings. Plain language, suggestive tone (never "sell everything"), and
// no buy copy ("Plantéate añadir") on a sell/reduce signal.
// --------------------------------------------------------------------------

const WINDOW_LABELS: Record<string, string> = { '30d': '30 días', '60d': '60 días', '90d': '90 días' };

function buildReduceMessage(
  analysis: PortfolioAnalysis,
  prevState: PortfolioState | undefined,
  stateChanged: boolean,
  isReminder: boolean,
): string {
  const ticker = escapeMd(analysis.holding.ticker ?? analysis.holding.id.toUpperCase());
  const typeEs = analysis.holding.type === 'etf' ? 'ETF' : 'Acción';
  // Engine converts portfolio prices to EUR before analysis — € is always correct here.
  const hasPrice = analysis.currentPrice != null;
  const priceStr = hasPrice ? ` | Precio: €${analysis.currentPrice!.toFixed(2)}` : '';

  // The engine's sell-guidance reason is imperative ("Vende el 20-25% ahora…");
  // the template has its own softer action line, so skip it to avoid duplication.
  const reasons = analysis.reasons
    .filter((r) => !r.startsWith('Vende el 20-25%'))
    .slice(0, 4)
    .map(escapeMd);

  let message = isReminder
    ? `🔁 *Recordatorio* — *${ticker}* sigue en zona de reducir\n`
    : `🟡 *${ticker}* — Considera reducir una parte\n`;
  message += `${escapeMd(analysis.holding.name)} | ${typeEs}${priceStr}\n\n`;
  message += `*Por qué aparece esta alerta:*\n${reasons.map((r) => `• ${r}`).join('\n')}\n\n`;
  if (hasPrice && analysis.suggestedAmountEur.max > 0) {
    message += `*Acción prudente:* podrías vender un 20-25% de la posición (aprox. €${analysis.suggestedAmountEur.min}–€${analysis.suggestedAmountEur.max}).\n`;
  } else {
    // No confirmed EUR price this run — never show figures that could be wrong.
    message += `*Acción prudente:* considera reducir una parte de la posición. Sin precio EUR confirmado en esta ejecución, no se muestran cifras.\n`;
  }
  message += `Esto no significa vender todo: el objetivo es proteger ganancias y bajar el riesgo.`;
  if (stateChanged && prevState) message += `\n\n_Antes era: ${escapeMd(prevState)}_`;
  return message;
}

function buildReviewMessage(
  analysis: PortfolioAnalysis,
  prevState: PortfolioState | undefined,
  stateChanged: boolean,
): string {
  const ticker = escapeMd(analysis.holding.ticker ?? analysis.holding.id.toUpperCase());
  const typeEs = analysis.holding.type === 'etf' ? 'ETF' : 'Acción';
  const priceStr = analysis.currentPrice != null ? ` | Precio: €${analysis.currentPrice.toFixed(2)}` : '';
  // Mirrors the engine's deep-drawdown REVIEW override (engine.ts: maxDrawdown > 35).
  const deepDrop = analysis.drawdown.maxDrawdown > 35;
  const windowLabel = WINDOW_LABELS[analysis.drawdown.primaryWindow] ?? analysis.drawdown.primaryWindow;

  let message = deepDrop
    ? `⚠️ *${ticker}* — Caída fuerte: revisa antes de actuar\n`
    : `⚠️ *${ticker}* — Revisa tu tesis antes de seguir\n`;
  message += `${escapeMd(analysis.holding.name)} | ${typeEs}${priceStr}\n\n`;
  if (deepDrop) {
    message += `*Qué está pasando:* ha caído un ${analysis.drawdown.maxDrawdown.toFixed(1)}% desde su máximo de ${windowLabel}. Una caída así puede deberse a un problema concreto de la empresa (noticias, resultados, regulación), no solo al mercado.\n\n`;
  } else {
    message += `*Qué está pasando:* hay señales de riesgo en la tesis de esta posición. No es urgente, pero conviene revisarla con calma.\n\n`;
  }
  message += `*Por qué:*\n${analysis.reasons.slice(0, 3).map(escapeMd).map((r) => `• ${r}`).join('\n')}\n\n`;
  message += `*Qué hacer:* no compres más todavía. Revisa si la tesis (el motivo por el que invertiste) sigue siendo válida. Esto no significa vender automáticamente.`;
  if (stateChanged && prevState) message += `\n\n_Antes era: ${escapeMd(prevState)}_`;
  return message;
}

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
    // P1-4b: an unresolved REDUCE must reach shouldSendAlert — the reminder
    // window (ALERT_REDUCE_REMINDER_DAYS) decides there whether to re-alert.
    // Without this, stateChanged=false would bury the defensive signal forever.
    const reduceReminder = prevState === 'REDUCE' && currentState === 'REDUCE';

    if (!stateChanged && !newlyActionable && !reduceReminder) continue;
    if (!ALERT_PORTFOLIO_STATES.includes(currentState) && !stateChanged) continue;
    // Bypass cooldown only when transitioning INTO an alertable state (not for DO_NOTHING/WAIT).
    const alertableState = ALERT_PORTFOLIO_STATES.includes(currentState) ? currentState : undefined;
    if (!shouldSendAlert(assetId, prev, alertableState)) continue;

    const ticker = analysis.holding.ticker ?? analysis.holding.id.toUpperCase();

    let message: string;
    if (currentState === 'REDUCE') {
      message = buildReduceMessage(analysis, prevState, stateChanged, reduceReminder);
    } else if (currentState === 'REVIEW') {
      message = buildReviewMessage(analysis, prevState, stateChanged);
    } else {
      const drawdownStr = `-${analysis.drawdown.maxDrawdown.toFixed(1)}%`;
      const priceStr = analysis.currentPrice != null
        ? `${analysis.holding.currency === 'EUR' ? '€' : '$'}${analysis.currentPrice.toFixed(2)}`
        : '—';
      const confidenceEs = analysis.confidence === 'high' ? 'ALTA' : analysis.confidence === 'medium' ? 'MEDIA' : 'BAJA';

      message = `📊 *${escapeMd(ticker)}* — Alerta de cartera\n`;
      message += `Tipo: ${analysis.holding.type === 'etf' ? 'ETF' : 'Acción'}\n`;
      message += `Estado: \`${currentState}\`${stateChanged ? ` (antes: ${escapeMd(prevState ?? '')})` : ''}\n`;
      message += `Precio: ${priceStr} | Caída desde máximo (${analysis.drawdown.primaryWindow}): ${drawdownStr}\n\n`;
      message += `*Por qué:*\n${analysis.reasons.slice(0, 3).map(escapeMd).map((r) => `• ${r}`).join('\n')}\n\n`;
      if (analysis.suggestedAmountEur.max > 0) {
        message += `*Sugerencia:* Plantéate añadir €${analysis.suggestedAmountEur.min}–€${analysis.suggestedAmountEur.max}\n`;
      }
      message += `*Confianza:* ${confidenceEs}`;
    }

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
    // Bypass cooldown only when transitioning INTO an alertable state.
    const alertableState = ALERT_OPPORTUNITY_STATES.includes(currentState) ? currentState : undefined;
    if (!shouldSendAlert(assetId, prev, alertableState)) continue;

    const drawdownStr = `-${opp.drawdown.maxDrawdown.toFixed(1)}%`;
    const priceStr = opp.currentPrice != null
      ? `${opp.currency === 'EUR' ? '€' : '$'}${opp.currentPrice.toFixed(2)}`
      : '—';
    const confidenceEs = opp.confidence === 'high' ? 'ALTA' : opp.confidence === 'medium' ? 'MEDIA' : 'BAJA';
    const typeEs = opp.type === 'etf' ? 'ETF' : 'Acción';

    let message = '';
    if (alertType === 'discovery') {
      message = `🔍 *${escapeMd(opp.ticker)}* — Nuevo descubrimiento\n`;
      message += `Tipo: ${typeEs} | *Universo extendido*\n`;
    } else {
      message = `${opp.type === 'etf' ? '📦' : '📈'} *${escapeMd(opp.ticker)}* — ${escapeMd(opp.name)}\n`;
      message += `Tipo: ${typeEs}\n`;
    }

    message += `Estado: \`${currentState}\`${stateChanged ? ` (antes: ${escapeMd(prevState ?? '')})` : ''}\n`;
    message += `Puntuación: ${opp.score.total}/10 | Precio: ${priceStr} | Caída: ${drawdownStr}\n\n`;
    message += `*Por qué:*\n${opp.reasons.slice(0, 3).map(escapeMd).map((r) => `• ${r}`).join('\n')}\n\n`;
    if (opp.suggestedAmountEur.max > 0) {
      message += `*Sugerencia:* Plantéate €${opp.suggestedAmountEur.min}–€${opp.suggestedAmountEur.max}\n`;
    }
    message += `*Confianza:* ${confidenceEs}`;

    if (alertType === 'discovery') {
      message += `\n\n*Filtros de calidad superados:* liquidez ✓ calidad ✓ volatilidad ✓ encaje en cartera ✓`;
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

  let message = `⚠️ *Advertencia: cartera muy concentrada*\n\n`;
  message += concentration.highConcentrationWarnings.map((w) => `• ${escapeMd(w)}`).join('\n');
  message += `\n\n*Consejo:* Añade ETFs diversificados antes de comprar más acciones individuales de tecnología. Así reduces el riesgo.`;

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

// Everything commitPreviousStates needs to persist dedupe state AFTER we know
// which alerts were actually delivered. generateAlerts no longer writes
// previous_states itself — see commitPreviousStates and P1-4d in CTO_BACKLOG.
export interface PreviousStatesContext {
  prev: PreviousStates;
  portfolioAnalyses: PortfolioAnalysis[];
  opportunities: Opportunity[];
}

export interface AlertGenerationResult {
  alerts: Alert[];
  context: PreviousStatesContext;
}

export async function generateAlerts(
  portfolioAnalyses: PortfolioAnalysis[],
  stockOpportunities: Opportunity[],
  etfOpportunities: Opportunity[],
  discoveredOpportunities: Opportunity[],
  concentration: ConcentrationData,
  allocationRecommendations: AllocationRecommendation[]
): Promise<AlertGenerationResult> {
  const prev = await getPreviousStates();
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

  // previous_states is intentionally NOT persisted here. Advancing the dedupe
  // state on generation alone would mark a defensive signal as "alerted" even
  // when Telegram never delivered it (or sending was disabled), burying the
  // alert until the reminder window. The engine calls commitPreviousStates
  // AFTER sending, passing only the alerts that were actually delivered.
  return {
    alerts: allAlerts,
    context: {
      prev,
      portfolioAnalyses,
      opportunities: [...stockOpportunities, ...etfOpportunities, ...discoveredOpportunities],
    },
  };
}

// --------------------------------------------------------------------------
// Persist dedupe state — only for alerts that were actually delivered (P1-4d)
// --------------------------------------------------------------------------
// previous_states.state means "last NOTIFIED state", not "last generated".
// Rules:
//   • Alertable state delivered successfully → advance state + lastAlertAt.
//   • Alertable state not delivered (Telegram failed / sendAlertMessages:false /
//     partial send) → do NOT advance; keep the last notified state so the next
//     run still detects the transition and re-alerts.
//   • Non-alertable state (DO_NOTHING, WAIT, …) → update the observed baseline
//     without lastAlertAt, so a future transition into an alertable state is
//     still detected as a change.
export async function commitPreviousStates(
  context: PreviousStatesContext,
  deliveredAlerts: Alert[],
): Promise<void> {
  const { prev, portfolioAnalyses, opportunities } = context;
  const now = new Date().toISOString();

  const newPrev: PreviousStates = {
    updatedAt: now,
    portfolio: { ...prev.portfolio },
    opportunities: { ...prev.opportunities },
  };

  for (const analysis of portfolioAnalyses) {
    const ticker = analysis.holding.ticker ?? analysis.holding.id.toUpperCase();
    const delivered = deliveredAlerts.some((a) => a.telegramSent && a.asset === ticker);
    const existingEntry = prev.portfolio[analysis.holding.id];
    newPrev.portfolio[analysis.holding.id] = {
      assetId: analysis.holding.id,
      // Advance only on confirmed delivery; otherwise keep the last notified
      // state (or fall back to the current state as the observed baseline).
      state: delivered ? analysis.state : (existingEntry?.state ?? analysis.state),
      lastAlertAt: delivered
        ? now
        : (existingEntry?.lastAlertAt ?? ''),
    };
  }

  for (const opp of opportunities) {
    const id = opp.ticker.toLowerCase();
    const delivered = deliveredAlerts.some((a) => a.telegramSent && a.asset === opp.ticker);
    const existingEntry = prev.opportunities[id];
    newPrev.opportunities[id] = {
      assetId: id,
      state: delivered ? opp.state : (existingEntry?.state ?? opp.state),
      score: opp.score.total,
      lastAlertAt: delivered
        ? now
        : (existingEntry?.lastAlertAt ?? ''),
    };
  }

  if (deliveredAlerts.some((a) => a.telegramSent && a.type === 'concentration_warning')) {
    newPrev.opportunities['__concentration_warning__'] = {
      assetId: '__concentration_warning__',
      state: 'WATCH',
      lastAlertAt: now,
    };
  }

  await savePreviousStates(newPrev);
}
