#!/usr/bin/env ts-node
// Local test script — runs the engine in mock mode and prints a full report
// No internet connection needed. No Telegram needed.
// Usage: npm run test:local

// Force mock mode for this test
process.env.MOCK_MODE = 'true';
process.env.PRICE_PROVIDER = 'mock';

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { runDailyEngine } from '../src/lib/engine/daily-engine';
import { formatDigestMessage } from '../src/lib/alerts/digest';

console.log('=== App Finanzas — Local Test Run ===');
console.log('Using: MOCK price data (no internet required)');
console.log('');

runDailyEngine({ sendDigest: false, sendAlertMessages: false })
  .then((output) => {
    console.log('=== Portfolio Analysis ===\n');

    for (const a of output.portfolioAnalyses) {
      const ticker = a.holding.ticker ?? a.holding.id.toUpperCase();
      const flag =
        a.state === 'BUY_MORE' ? '🟢' :
        a.state === 'BUY_PARTIAL' ? '🟡' :
        a.state === 'BUY_SMALL' ? '🔵' :
        a.state === 'REVIEW' ? '🔴' :
        a.state === 'REDUCE' ? '🔴' : '⚪';

      console.log(`${flag} ${ticker.padEnd(8)} [${a.state.padEnd(12)}] DD: -${a.drawdown.maxDrawdown.toFixed(1).padStart(4)}% | Price: ${a.currentPrice.toFixed(2).padStart(8)} | PnL: ${a.unrealizedPnlPct >= 0 ? '+' : ''}${a.unrealizedPnlPct.toFixed(1)}%`);
    }

    console.log('\n=== Concentration ===\n');
    const c = output.concentration;
    console.log(`Total Portfolio: ~€${c.totalPortfolioValue.toLocaleString('en', { maximumFractionDigits: 0 })}`);
    console.log(`Stocks: ${c.stockVsEtfRatio.stocks.toFixed(0)}% | ETFs: ${c.stockVsEtfRatio.etfs.toFixed(0)}%`);
    if (c.highConcentrationWarnings.length > 0) {
      console.log('\n⚠ Warnings:');
      c.highConcentrationWarnings.forEach((w) => console.log('  -', w));
    }

    console.log('\n=== Top Stock Opportunities ===\n');
    const topStocks = output.stockOpportunities.filter((o) => ['BUY', 'READY_TO_BUY'].includes(o.state)).slice(0, 5);
    if (topStocks.length === 0) {
      console.log('  None currently actionable');
    } else {
      topStocks.forEach((o) => {
        console.log(`  ${o.ticker.padEnd(8)} [${o.state.padEnd(12)}] Score: ${o.score.total}/10 | DD: -${o.drawdown.maxDrawdown.toFixed(1)}%`);
      });
    }

    console.log('\n=== Top ETF Opportunities ===\n');
    const topEtfs = output.etfOpportunities.filter((o) => ['BUY', 'READY_TO_BUY'].includes(o.state)).slice(0, 5);
    if (topEtfs.length === 0) {
      console.log('  None currently actionable');
    } else {
      topEtfs.forEach((o) => {
        console.log(`  ${o.ticker.padEnd(8)} [${o.state.padEnd(12)}] Score: ${o.score.total}/10 | DD: -${o.drawdown.maxDrawdown.toFixed(1)}%`);
      });
    }

    if (output.discoveredOpportunities.length > 0) {
      console.log('\n=== Discovered (Extended Universe) ===\n');
      output.discoveredOpportunities.forEach((o) => {
        console.log(`  🔍 ${o.ticker.padEnd(8)} [${o.state.padEnd(12)}] Score: ${o.score.total}/10 | ${o.name}`);
      });
    }

    console.log('\n=== Capital Allocation ===\n');
    for (const rec of output.allocationRecommendations) {
      if (rec.holdCash) {
        console.log(`  €${rec.forAmount}: HOLD CASH — ${rec.holdCashReason}`);
      } else {
        const best = rec.options[0];
        if (best) {
          console.log(`  €${rec.forAmount}: #1 ${best.asset} (${best.type}) → €${best.amountEur} [${best.state}]`);
        }
      }
    }

    console.log('\n=== Daily Digest Preview ===\n');
    const digestMsg = formatDigestMessage(
      output.portfolioAnalyses,
      output.stockOpportunities,
      output.etfOpportunities,
      output.discoveredOpportunities,
      output.allocationRecommendations,
      output.concentration
    );
    // Strip Markdown for console readability
    console.log(digestMsg.replace(/\*/g, '').replace(/`/g, '').replace(/_/g, ''));

    console.log('\n✅ Local test complete. Check src/data/engine-output.json for full results.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  });
