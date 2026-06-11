'use client';

import { useState } from 'react';
import type { OpportunityScore } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardBody, DrawdownDisplay, SectionEmpty } from '@/components/ui/card';
import { StateBadge, TypeBadge, ConfidenceBadge, ScoreBar, PricingMethodBadge } from '@/components/ui/badge';
import { getTopDiscoveries } from '@/lib/ranking/ranker';
import type { Opportunity } from '@/lib/types';

function IsinCopy({ isin }: { isin?: string }) {
  const [copied, setCopied] = useState(false);
  if (!isin) return null;
  const copy = () => {
    navigator.clipboard.writeText(isin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="text-xs text-slate-600 hover:text-blue-400 font-mono transition-colors cursor-pointer block mt-0.5"
      title="ISIN: código único que identifica este activo en Trade Republic. Haz clic para copiar."
    >
      {copied ? '✓ copiado' : isin}
    </button>
  );
}

export function ScoreBreakdown({ score, pricingDataAvailable }: { score: OpportunityScore; pricingDataAvailable?: boolean }) {
  // riskReward depends on a real EUR price. When pricing data is missing (usd_no_fx, proxy,
  // unconfirmed, unavailable → pricingDataAvailable === false), scoreRiskReward() falls back to a
  // neutral 5 that is NOT a real signal. Render it as "N/A" with a grey bar so the user does not
  // read 5/10 as a genuine risk-reward assessment. Explicit false only — undefined (legacy) shows normally.
  const riskRewardNa = pricingDataAvailable === false;
  const items: { label: string; value: number; na?: boolean }[] = [
    { label: 'Calidad del activo', value: score.breakdown.assetQuality },
    { label: 'Caída desde máximo', value: score.breakdown.drawdownOpportunity },
    { label: 'Tendencia', value: score.breakdown.trendQuality },
    { label: 'Fuerza relativa', value: score.breakdown.relativeStrength },
    { label: 'Encaje en cartera', value: score.breakdown.diversificationFit },
    { label: 'Sector', value: score.breakdown.sectorFit },
    { label: 'Riesgo/beneficio', value: score.breakdown.riskReward, na: riskRewardNa },
    { label: 'Ajuste mercado', value: score.breakdown.marketRegimeFit },
  ];
  return (
    <div className="px-4 pb-3 pt-1 bg-[#1a2233]/60 border-t border-[#2a3445]/30">
      <div className="text-xs text-slate-500 mb-2">Por qué puntúa {score.total.toFixed(1)}/10:</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {items.map(({ label, value, na }) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 truncate">{label}</span>
            {na ? (
              <span
                className="text-xs text-slate-500 shrink-0 italic"
                title="No evaluable sin un precio en EUR. Falta tipo de cambio o precio fiable."
              >
                N/A (sin EUR)
              </span>
            ) : (
              <div className="flex items-center gap-1 shrink-0">
                <div className="w-12 h-1 rounded-full bg-slate-700">
                  <div
                    className={`h-full rounded-full ${value >= 7 ? 'bg-green-500' : value >= 5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, value * 10)}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 w-5 text-right">{value.toFixed(0)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function OpportunityRow({ opp, showDiscoveryBadge = false }: { opp: Opportunity; showDiscoveryBadge?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const currency = opp.currency === 'EUR' ? '€' : '$';
  return (
    <div className="hover:bg-[#222b3a] transition-colors">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div
              className="flex items-center gap-2 flex-wrap cursor-pointer"
              onClick={() => setExpanded((v) => !v)}
            >
              <span className="font-mono text-slate-200 font-medium">{opp.ticker}</span>
              <TypeBadge type={opp.type} />
              <StateBadge state={opp.state} showTooltip />
              {showDiscoveryBadge && !opp.isSeedUniverse && (
                <span className="text-xs bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded">DESCUBIERTO</span>
              )}
              <span className="text-xs text-slate-600 ml-auto">{expanded ? '▲' : '▼'}</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">{opp.name}</div>
            <IsinCopy isin={opp.isin} />
            <div className="mt-1">
              <ScoreBar score={opp.score.total} />
            </div>
            <div className="mt-1">
              <DrawdownDisplay
                d30={opp.drawdown.drawdown30d}
                d60={opp.drawdown.drawdown60d}
                d90={opp.drawdown.drawdown90d}
              />
            </div>
            <div className="mt-1.5 space-y-0.5">
              {opp.reasons.slice(0, 2).map((r, i) => (
                <div key={i} className="text-xs text-slate-400">• {r}</div>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-slate-300 text-sm">{opp.currentPrice != null ? `${currency}${opp.currentPrice.toFixed(2)}` : '—'}</div>
            {opp.suggestedAmountEur.max > 0 ? (
              <div className="text-green-400 font-mono text-sm font-semibold">
                €{opp.suggestedAmountEur.min}–{opp.suggestedAmountEur.max}
              </div>
            ) : null}
            <div className="mt-1 flex flex-col items-end gap-1">
              <PricingMethodBadge method={opp.pricingMethod} />
              <ConfidenceBadge confidence={opp.confidence} />
            </div>
          </div>
        </div>
      </div>
      {expanded && <ScoreBreakdown score={opp.score} pricingDataAvailable={opp.pricingDataAvailable} />}
    </div>
  );
}

interface StockPanelProps { opportunities: Opportunity[] }
interface EtfPanelProps { opportunities: Opportunity[] }
interface DiscoveryPanelProps { opportunities: Opportunity[] }

export function StockOpportunities({ opportunities }: StockPanelProps) {
  const actionable = opportunities.filter((o) => ['BUY', 'READY_TO_BUY', 'WATCH'].includes(o.state)).slice(0, 8);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Oportunidades en Acciones</CardTitle>
        <span className="text-xs text-slate-500">{actionable.length} activas</span>
      </CardHeader>
      <CardBody className="p-0">
        {actionable.length === 0 ? (
          <SectionEmpty message="Sin oportunidades destacadas en acciones ahora mismo" />
        ) : (
          <div className="divide-y divide-[#2a3445]/50">
            {actionable.map((o) => <OpportunityRow key={o.ticker} opp={o} />)}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function EtfOpportunities({ opportunities }: EtfPanelProps) {
  const actionable = opportunities.filter((o) => ['BUY', 'READY_TO_BUY', 'WATCH'].includes(o.state)).slice(0, 6);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Oportunidades en ETFs</CardTitle>
        <span className="text-xs text-slate-500">{actionable.length} activos</span>
      </CardHeader>
      <CardBody className="p-0">
        {actionable.length === 0 ? (
          <SectionEmpty message="Sin oportunidades destacadas en ETFs ahora mismo" />
        ) : (
          <div className="divide-y divide-[#2a3445]/50">
            {actionable.map((o) => <OpportunityRow key={o.ticker} opp={o} />)}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function DiscoveryMonitor({ opportunities }: DiscoveryPanelProps) {
  // Enforce the display contract: BUY/READY_TO_BUY first, then WATCH (each carries its own
  // "why not BUY" reason), capped at 5. WATCH is shown so the panel is never falsely empty just
  // because pricing/FX degraded everything — but it must never look like a buy recommendation.
  const ranked = getTopDiscoveries(opportunities);
  const firstWatchIdx = ranked.findIndex((o) => o.state === 'WATCH');
  const hasActionable = ranked.some((o) => o.state !== 'WATCH');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Descubrimientos</CardTitle>
        <span className="text-xs text-slate-500">Activos fuera de tu cartera</span>
      </CardHeader>
      <CardBody className="p-0">
        {ranked.length === 0 ? (
          <SectionEmpty message="Sin candidatos en el universo extendido con los filtros actuales" />
        ) : (
          <>
            <div className="divide-y divide-[#2a3445]/50">
              {ranked.map((o, idx) => (
                <div key={o.ticker}>
                  {/* Separator before the first WATCH item so vigilancia is not mixed with compra */}
                  {idx === firstWatchIdx && hasActionable && (
                    <div className="px-4 py-1.5 bg-[#161d2b] text-xs text-slate-500 border-y border-[#2a3445]/40">
                      En vigilancia — todavía no es recomendación de compra
                    </div>
                  )}
                  <OpportunityRow opp={o} showDiscoveryBadge />
                  <div className="px-4 pb-2 flex flex-wrap gap-1">
                    {Object.entries(o.qualityGates).map(([gate, passed]) => (
                      <span
                        key={gate}
                        className={`text-xs px-1.5 py-0.5 rounded ${passed ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}
                      >
                        {gate} {passed ? '✓' : '✗'}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Data-limitations note — honest about what the score does and does not include. */}
            <div className="px-4 py-2 text-xs text-slate-600 border-t border-[#2a3445]/40">
              Score basado en precio, caída desde máximos y metadata editorial. Fundamentales
              (P/E, ingresos, beneficios) todavía no incluidos.
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
