// P3-2 visual QA — renders the discovery UI to a self-contained HTML file.
// Environment has no browser, so this produces real component output (React SSR) that can be
// opened in any browser. Styling via the Tailwind Play CDN so the badges/colours are faithful.
//
//   npx tsx scripts/p3-2-visual-qa.tsx   →   writes /tmp/p3-2-visual-qa.html
//
// Shows: USD→EUR ✓ and USD · sin FX badges, WATCH "why not BUY" reasons, BUY/WATCH separator,
// quality gates, the data-limitations note, and the risk/reward "N/A (sin EUR)" breakdown.

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { writeFileSync } from 'fs';
import { DiscoveryMonitor, ScoreBreakdown } from '../src/components/dashboard/OpportunitiesPanel';
import type { Opportunity, OpportunityScore, OpportunityState } from '../src/lib/types';

function score(total: number, riskReward: number): OpportunityScore {
  return {
    total,
    breakdown: {
      assetQuality: 9, drawdownOpportunity: 9, trendQuality: 9, relativeStrength: 7,
      diversificationFit: 6, sectorFit: 8, riskReward, portfolioFit: 7.5, marketRegimeFit: 5,
    },
  };
}

function opp(p: Partial<Opportunity> & { ticker: string; state: OpportunityState }): Opportunity {
  return {
    name: p.name ?? p.ticker, type: 'stock', tags: ['tech'], isin: 'US0000000000',
    isSeedUniverse: false, currency: 'USD',
    score: p.score ?? score(7.4, 5),
    drawdown: { drawdown30d: 18, drawdown60d: 15, drawdown90d: 12, maxDrawdown: 18, primaryWindow: '30d' },
    reasons: p.reasons ?? [], suggestedAmountEur: { min: 0, max: 0 }, confidence: 'low',
    qualityGates: { liquidity: true, quality: true, volatility: true, portfolioFit: true, riskReward: true, notSpeculative: true },
    currentPrice: null, ...p,
  };
}

const discoveries: Opportunity[] = [
  // Actionable BUY with a real EUR-converted price → green USD→EUR ✓ badge, sizing shown.
  opp({
    ticker: 'EXMP', name: 'Example EUR-converted Corp', state: 'BUY',
    score: score(8.1, 8), currentPrice: 312.06, currency: 'EUR',
    pricingMethod: 'usd_converted', pricingDataAvailable: true,
    suggestedAmountEur: { min: 150, max: 320 }, confidence: 'high',
    reasons: ['Drawdown: -18.0% (30d: -18.0%, 60d: -15.0%, 90d: -12.0%)', 'Favorable risk-reward: meaningful upside vs controlled downside'],
  }),
  // WATCH degraded by missing FX → amber "USD · sin FX" badge + why-not-BUY reason, price "—".
  opp({
    ticker: 'AAPL', name: 'Apple Inc (USD, no FX)', state: 'WATCH',
    score: score(7.4, 5), pricingMethod: 'usd_no_fx', pricingDataAvailable: false,
    reasons: [
      'USD confirmado · sin FX fresco — sizing y P&L exacto bloqueados; solo análisis de caída válido',
      'Drawdown: -18.0% (30d: -18.0%, 60d: -15.0%, 90d: -12.0%)',
    ],
  }),
  // Another WATCH, proxy pricing → amber "Solo caída %".
  opp({
    ticker: 'CNDX', name: 'Proxy-priced ETF', state: 'WATCH', type: 'etf', tags: ['broad-index'],
    score: score(6.9, 5), pricingMethod: 'proxy_drawdown_only', pricingDataAvailable: false,
    reasons: [
      'Precio es proxy USD — solo % de caída válido; sin precio EUR no hay BUY ni sizing',
      'Drawdown: -18.0% (30d: -18.0%, 60d: -15.0%, 90d: -12.0%)',
    ],
  }),
];

const panel = renderToStaticMarkup(h(DiscoveryMonitor, { opportunities: discoveries }));
const breakdownNa = renderToStaticMarkup(h(ScoreBreakdown, { score: score(7.4, 5), pricingDataAvailable: false }));
const breakdownOk = renderToStaticMarkup(h(ScoreBreakdown, { score: score(8.1, 8), pricingDataAvailable: true }));

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>P3-2 Visual QA</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-[#0d131f] text-slate-200 p-8">
  <div class="max-w-2xl mx-auto space-y-8">
    <h1 class="text-lg font-semibold">P3-2 — Discovery pricing reliability + why-not-buy</h1>

    <section>
      <h2 class="text-sm text-slate-400 mb-2">1. DiscoveryMonitor — badges, why-not-BUY, BUY/WATCH separator, gates, data note</h2>
      ${panel}
    </section>

    <section>
      <h2 class="text-sm text-slate-400 mb-2">2. ScoreBreakdown (expanded) — risk/reward N/A when EUR price is missing</h2>
      <div class="rounded border border-[#2a3445]/50 overflow-hidden">${breakdownNa}</div>
    </section>

    <section>
      <h2 class="text-sm text-slate-400 mb-2">3. ScoreBreakdown (expanded) — risk/reward shown normally when EUR price is available</h2>
      <div class="rounded border border-[#2a3445]/50 overflow-hidden">${breakdownOk}</div>
    </section>
  </div>
</body></html>`;

const out = '/tmp/p3-2-visual-qa.html';
writeFileSync(out, html, 'utf-8');
console.log('Wrote', out);

// Assertions on the rendered markup so QA is self-checking even without a screenshot.
const checks: Array<[string, boolean]> = [
  ['USD→EUR ✓ badge present', panel.includes('USD→EUR ✓')],
  ['USD · sin FX badge present', panel.includes('USD · sin FX')],
  ['Solo caída % badge present', panel.includes('Solo caída %')],
  ['why-not-BUY FX reason present', panel.includes('sin FX fresco')],
  ['BUY/WATCH separator present', panel.includes('todavía no es recomendación de compra')],
  ['quality gates rendered', panel.includes('liquidity ✓')],
  ['data-limitations note present', panel.includes('Fundamentales')],
  ['empty-state message NOT shown (has candidates)', !panel.includes('Sin candidatos')],
  ['risk/reward N/A shown when no EUR price', breakdownNa.includes('N/A (sin EUR)')],
  ['risk/reward N/A NOT shown when EUR price available', !breakdownOk.includes('N/A (sin EUR)')],
];
let ok = true;
for (const [label, cond] of checks) {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${label}`);
  if (!cond) ok = false;
}
if (!ok) process.exit(1);
