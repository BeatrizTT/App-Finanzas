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
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let msg = `📅 *Daily Digest — ${date}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // --- Top Portfolio Adds ---
  const topAdds = portfolioAnalyses
    .filter((a) => ['BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL'].includes(a.state))
    .sort((a, b) => b.drawdown.maxDrawdown - a.drawdown.maxDrawdown)
    .slice(0, 3);

  msg += `*📊 Top Portfolio Adds (${topAdds.length})*\n`;
  if (topAdds.length === 0) {
    msg += `• No actionable adds in current portfolio\n`;
  } else {
    for (const a of topAdds) {
      const ticker = a.holding.ticker ?? a.holding.id.toUpperCase();
      const dd = `-${a.drawdown.maxDrawdown.toFixed(1)}%`;
      const amtStr = a.suggestedAmountEur.max > 0
        ? `€${a.suggestedAmountEur.min}–€${a.suggestedAmountEur.max}`
        : 'review size';
      msg += `• *${ticker}* | \`${a.state}\` | DD: ${dd} | ${amtStr}\n`;
    }
  }
  msg += '\n';

  // --- Top Stock Opportunities ---
  const topStocks = stockOpportunities
    .filter((o) => ['BUY', 'READY_TO_BUY'].includes(o.state))
    .slice(0, 3);

  msg += `*📈 Top Stock Opportunities (${topStocks.length})*\n`;
  if (topStocks.length === 0) {
    msg += `• No strong stock entries detected\n`;
  } else {
    for (const o of topStocks) {
      const dd = `-${o.drawdown.maxDrawdown.toFixed(1)}%`;
      msg += `• *${o.ticker}* | Score: ${o.score.total}/10 | \`${o.state}\` | DD: ${dd}\n`;
    }
  }
  msg += '\n';

  // --- Top ETF Opportunities ---
  const topEtfs = etfOpportunities
    .filter((o) => ['BUY', 'READY_TO_BUY'].includes(o.state))
    .slice(0, 3);

  msg += `*📦 Top ETF Opportunities (${topEtfs.length})*\n`;
  if (topEtfs.length === 0) {
    msg += `• No strong ETF entries detected\n`;
  } else {
    for (const o of topEtfs) {
      const dd = `-${o.drawdown.maxDrawdown.toFixed(1)}%`;
      msg += `• *${o.ticker}* | Score: ${o.score.total}/10 | \`${o.state}\` | DD: ${dd}\n`;
    }
  }
  msg += '\n';

  // --- Discoveries ---
  const topDiscovered = discoveredOpportunities
    .filter((o) => ['BUY', 'READY_TO_BUY'].includes(o.state))
    .slice(0, 2);

  if (topDiscovered.length > 0) {
    msg += `*🔍 New Discoveries (${topDiscovered.length})*\n`;
    for (const o of topDiscovered) {
      msg += `• *${o.ticker}* (${o.name}) | Score: ${o.score.total}/10 | \`${o.state}\`\n`;
    }
    msg += '\n';
  }

  // --- Best Use of Cash ---
  msg += `*💰 Best Use of Cash*\n`;
  for (const rec of allocationRecommendations.slice(0, 3)) {
    if (rec.holdCash) {
      msg += `• €${rec.forAmount}: HOLD CASH — ${rec.holdCashReason ?? 'no strong opportunities'}\n`;
    } else {
      const best = rec.options[0];
      const second = rec.options[1];
      if (best) {
        msg += `• *€${rec.forAmount}:* ${best.asset} (€${best.amountEur})`;
        if (second) msg += ` + ${second.asset} option`;
        msg += '\n';
      }
    }
  }
  msg += '\n';

  // --- Concentration Warnings ---
  if (concentration.highConcentrationWarnings.length > 0) {
    msg += `*⚠️ Concentration Warnings*\n`;
    for (const w of concentration.highConcentrationWarnings) {
      msg += `• ${w}\n`;
    }
    msg += '\n';
  }

  // --- Stock vs ETF balance ---
  const { stocks, etfs } = concentration.stockVsEtfRatio;
  msg += `*⚖️ Balance:* Stocks ${stocks.toFixed(0)}% | ETFs ${etfs.toFixed(0)}%\n`;

  // --- No-action summary ---
  const noActionCount = portfolioAnalyses.filter((a) => a.state === 'DO_NOTHING').length;
  if (noActionCount > 0) {
    msg += `\n_${noActionCount} portfolio positions at or near highs — no action needed_\n`;
  }

  msg += `\n_Run at ${new Date().toLocaleTimeString('en-GB')}_`;

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
