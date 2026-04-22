#!/usr/bin/env ts-node
// Run the daily engine once from the command line
// Usage: npm run engine
// Add --no-digest to skip the daily digest message
// Add --no-alerts to skip sending Telegram alerts

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { runDailyEngine } from '../src/lib/engine/daily-engine';

const args = process.argv.slice(2);
const sendDigest = !args.includes('--no-digest');
const sendAlertMessages = !args.includes('--no-alerts');

console.log('=== App Finanzas — Engine Run ===');
console.log(`Price provider: ${process.env.PRICE_PROVIDER ?? 'mock'}`);
console.log(`Mock mode: ${process.env.MOCK_MODE ?? 'false'}`);
console.log(`Send digest: ${sendDigest}`);
console.log(`Send alerts: ${sendAlertMessages}`);
console.log('');

runDailyEngine({ sendDigest, sendAlertMessages })
  .then((output) => {
    console.log('\n=== Engine Run Summary ===');
    console.log(`Run at:      ${output.runAt}`);
    console.log(`Market:      ${output.marketRegime}`);
    console.log(`Portfolio:   ${output.portfolioAnalyses.length} holdings analyzed`);
    console.log(`Stocks:      ${output.stockOpportunities.length} opportunities`);
    console.log(`ETFs:        ${output.etfOpportunities.length} opportunities`);
    console.log(`Discovered:  ${output.discoveredOpportunities.length} new finds`);
    console.log(`Alerts:      ${output.alertsGenerated.length} generated`);
    console.log(`Errors:      ${output.errors.length}`);

    if (output.errors.length > 0) {
      console.log('\nErrors:');
      output.errors.forEach((e) => console.log('  -', e));
    }

    // Print top portfolio adds
    const topAdds = output.portfolioAnalyses
      .filter((a) => ['BUY_MORE', 'BUY_PARTIAL', 'BUY_SMALL'].includes(a.state))
      .sort((a, b) => b.drawdown.maxDrawdown - a.drawdown.maxDrawdown);

    if (topAdds.length > 0) {
      console.log('\nTop Portfolio Adds:');
      topAdds.slice(0, 3).forEach((a) => {
        const ticker = a.holding.ticker ?? a.holding.id.toUpperCase();
        console.log(`  ${ticker}: ${a.state} (drawdown: -${a.drawdown.maxDrawdown.toFixed(1)}%) → €${a.suggestedAmountEur.min}-${a.suggestedAmountEur.max}`);
      });
    }

    // Print top external opportunities
    const buyOpps = [...output.stockOpportunities, ...output.etfOpportunities]
      .filter((o) => o.state === 'BUY')
      .sort((a, b) => b.score.total - a.score.total);

    if (buyOpps.length > 0) {
      console.log('\nTop BUY Opportunities:');
      buyOpps.slice(0, 3).forEach((o) => {
        console.log(`  ${o.ticker} (${o.type}): score ${o.score.total}/10, drawdown -${o.drawdown.maxDrawdown.toFixed(1)}%`);
      });
    }

    // Print capital allocation
    const bestRec = output.allocationRecommendations.find((r) => r.forAmount === 1000);
    if (bestRec && !bestRec.holdCash && bestRec.options[0]) {
      console.log('\nBest use of €1000:');
      console.log(' ', bestRec.options[0].asset, '→ €' + bestRec.options[0].amountEur);
    }

    console.log('\n✅ Engine run complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Engine run failed:', err);
    process.exit(1);
  });
