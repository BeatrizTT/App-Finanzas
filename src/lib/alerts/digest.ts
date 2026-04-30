// Daily digest generator
// Produces one Telegram message per day summarizing top opportunities, cash plan, and warnings

import { sendTelegramMessage } from './telegram';
import { getAlertHistory, saveAlert, createAlert } from './history';
import { formatPct } from '../utils/math';
import type {
  PortfolioAnalysis,
  Opportunity,
  AllocationRecommendation,
  ConcentrationData,
  Alert,
} from '../types';

export function formatDigestMessage(
  portfolioAnalyses: PortfolioAnalysis[],
  stockOpportunities: Opportunity[],
  etfOpportunities: Opportunity[],
  discoveredOpportunities: Opportunity[],
  allocationRecommendations: AllocationRecommendation[],
  concentration: ConcentrationData
): string {
  const date = new Date().toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let msg = `📅 *Resumen diario — ${date}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // --- Compras recomendadas en cartera ---
  const topAdds = portfolioAnalyses
    .filter((a) => ['BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL'].includes(a.state))
    .sort((a, b) => b.drawdown.maxDrawdown - a.drawdown.maxDrawdown)
    .slice(0, 3);

  msg += `*📊 Compras recomendadas en cartera (${topAdds.length})*\n`;
  if (topAdds.length === 0) {
    msg += `• Ningún activo de tu cartera en punto de compra ahora mismo\n`;
  } else {
    for (const a of topAdds) {
      const ticker = a.holding.ticker ?? a.holding.id.toUpperCase();
      const dd = `-${a.drawdown.maxDrawdown.toFixed(1)}%`;
      const amtStr = a.suggestedAmountEur.max > 0
        ? `€${a.suggestedAmountEur.min}–€${a.suggestedAmountEur.max}`
        : 'revisar tamaño';
      msg += `• *${ticker}* | \`${a.state}\` | Caída: ${dd} | ${amtStr}\n`;
    }
  }
  msg += '\n';

  // --- Oportunidades en acciones ---
  const topStocks = stockOpportunities
    .filter((o) => ['BUY', 'READY_TO_BUY'].includes(o.state))
    .slice(0, 3);

  msg += `*📈 Oportunidades en acciones (${topStocks.length})*\n`;
  if (topStocks.length === 0) {
    msg += `• Sin oportunidades claras en acciones hoy\n`;
  } else {
    for (const o of topStocks) {
      const dd = `-${o.drawdown.maxDrawdown.toFixed(1)}%`;
      msg += `• *${o.ticker}* | Puntuación: ${o.score.total}/10 | \`${o.state}\` | Caída: ${dd}\n`;
    }
  }
  msg += '\n';

  // --- Oportunidades en ETFs ---
  const topEtfs = etfOpportunities
    .filter((o) => ['BUY', 'READY_TO_BUY'].includes(o.state))
    .slice(0, 3);

  msg += `*📦 Oportunidades en ETFs (${topEtfs.length})*\n`;
  if (topEtfs.length === 0) {
    msg += `• Sin oportunidades claras en ETFs hoy\n`;
  } else {
    for (const o of topEtfs) {
      const dd = `-${o.drawdown.maxDrawdown.toFixed(1)}%`;
      msg += `• *${o.ticker}* | Puntuación: ${o.score.total}/10 | \`${o.state}\` | Caída: ${dd}\n`;
    }
  }
  msg += '\n';

  // --- Descubrimientos ---
  const topDiscovered = discoveredOpportunities
    .filter((o) => ['BUY', 'READY_TO_BUY'].includes(o.state))
    .slice(0, 2);

  if (topDiscovered.length > 0) {
    msg += `*🔍 Nuevos descubrimientos (${topDiscovered.length})*\n`;
    for (const o of topDiscovered) {
      msg += `• *${o.ticker}* (${o.name}) | Puntuación: ${o.score.total}/10 | \`${o.state}\`\n`;
    }
    msg += '\n';
  }

  // --- Mejor uso del efectivo ---
  msg += `*💰 Mejor uso del efectivo*\n`;
  for (const rec of allocationRecommendations.slice(0, 3)) {
    if (rec.holdCash) {
      msg += `• €${rec.forAmount}: GUARDAR EFECTIVO — ${rec.holdCashReason ?? 'sin oportunidades claras'}\n`;
    } else {
      const best = rec.options[0];
      const second = rec.options[1];
      if (best) {
        msg += `• *€${rec.forAmount}:* ${best.asset} (€${best.amountEur})`;
        if (second) msg += ` + opción ${second.asset}`;
        msg += '\n';
      }
    }
  }
  msg += '\n';

  // --- Advertencias de concentración ---
  if (concentration.highConcentrationWarnings.length > 0) {
    msg += `*⚠️ Advertencias de concentración*\n`;
    for (const w of concentration.highConcentrationWarnings) {
      msg += `• ${w}\n`;
    }
    msg += '\n';
  }

  // --- Equilibrio acciones vs ETFs ---
  const { stocks, etfs } = concentration.stockVsEtfRatio;
  msg += `*⚖️ Equilibrio:* Acciones ${stocks.toFixed(0)}% | ETFs ${etfs.toFixed(0)}%\n`;

  // --- Sin acción ---
  const noActionCount = portfolioAnalyses.filter((a) => a.state === 'DO_NOTHING').length;
  if (noActionCount > 0) {
    msg += `\n_${noActionCount} posiciones en máximos o cerca — sin acción necesaria_\n`;
  }

  msg += `\n_Ejecutado a las ${new Date().toLocaleTimeString('es-ES')}_`;

  return msg;
}

export async function sendDailyDigest(
  portfolioAnalyses: PortfolioAnalysis[],
  stockOpportunities: Opportunity[],
  etfOpportunities: Opportunity[],
  discoveredOpportunities: Opportunity[],
  allocationRecommendations: AllocationRecommendation[],
  concentration: ConcentrationData
): Promise<Alert> {
  const message = formatDigestMessage(
    portfolioAnalyses,
    stockOpportunities,
    etfOpportunities,
    discoveredOpportunities,
    allocationRecommendations,
    concentration
  );

  const sent = await sendTelegramMessage(message);

  const alert = createAlert({
    type: 'daily_digest',
    message,
    telegramSent: sent,
  });

  saveAlert(alert);
  return alert;
}
