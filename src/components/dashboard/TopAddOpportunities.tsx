'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody, DrawdownDisplay, SectionEmpty } from '@/components/ui/card';
import { StateBadge, TypeBadge, ConfidenceBadge } from '@/components/ui/badge';
import type { PortfolioAnalysis } from '@/lib/types';
import { getTopPortfolioAdds } from '@/lib/ranking/ranker';

function IsinCopy({ isin }: { isin: string }) {
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
      className="text-xs text-slate-600 hover:text-blue-400 font-mono transition-colors cursor-pointer block"
      title="Haz clic para copiar el ISIN y usarlo en Trade Republic"
    >
      {copied ? '✓ copiado' : isin}
    </button>
  );
}

interface Props {
  analyses: PortfolioAnalysis[];
}

export function TopAddOpportunities({ analyses }: Props) {
  const topAdds = getTopPortfolioAdds(analyses, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>¿Dónde añadir ahora?</CardTitle>
        <span className="text-xs text-slate-500" title="De lo que ya tienes, estas posiciones han bajado más desde su precio más alto reciente. Son las mejores oportunidades para comprar más de lo que ya posees.">
          Tus posiciones actuales más baratas respecto a su máximo reciente
        </span>
      </CardHeader>
      <CardBody className="p-0">
        {topAdds.length === 0 ? (
          <SectionEmpty message="Sin oportunidades claras — tus posiciones están cerca de sus máximos recientes" />
        ) : (
          <>
            <div className="px-4 pt-3 pb-2 bg-[#1a2233]/50 border-b border-[#2a3445]/30 space-y-1.5">
              <p className="text-xs text-slate-500">
                Estas son las acciones y ETFs que <strong className="text-slate-400">ya tienes</strong> y que han bajado más desde su precio más alto reciente.
                Si el motor dice <strong className="text-slate-400">COMPRAR</strong>, es una buena oportunidad para añadir más cantidad.
                El importe en verde es lo que el motor sugiere invertir.
              </p>
              <p className="text-xs text-slate-600">
                <strong className="text-slate-500">¿Y el DCA?</strong> El DCA es tu aportación mensual fija y automática (ej. €128/mes en NVDA).
                Esta sección recomienda una compra <em>extra</em> puntual cuando el precio baja mucho — puedes hacer las dos cosas a la vez.
                El DCA no sustituye a una compra oportunista cuando hay una caída significativa.
              </p>
            </div>
            <div className="divide-y divide-[#2a3445]/50">
              {topAdds.map((a) => {
                const ticker = a.holding.ticker ?? a.holding.id.toUpperCase();
                const isin = (a.holding as any).isin as string | undefined;
                return (
                  <div key={a.holding.id} className="px-4 py-3 hover:bg-[#222b3a] transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-slate-200 font-medium">{ticker}</span>
                          <TypeBadge type={a.holding.type} />
                          <StateBadge state={a.state} showTooltip />
                          <span className="text-xs text-slate-500" title="Cuánta confianza tienes puesta en esta posición (lo que configuraste al comprarla)">
                            Convicción: {a.holding.convictionScore}/10
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">{a.holding.name}</div>
                        {isin && <IsinCopy isin={isin} />}
                        <div className="mt-1">
                          <DrawdownDisplay
                            d30={a.drawdown.drawdown30d}
                            d60={a.drawdown.drawdown60d}
                            d90={a.drawdown.drawdown90d}
                          />
                        </div>
                        <div className="mt-1.5 space-y-0.5">
                          {a.reasons.slice(0, 2).map((r, i) => (
                            <div key={i} className="text-xs text-slate-400">• {r}</div>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {a.suggestedAmountEur.max > 0 ? (
                          <div className="text-green-400 font-mono text-sm font-semibold">
                            €{a.suggestedAmountEur.min}–{a.suggestedAmountEur.max}
                          </div>
                        ) : null}
                        <div className="mt-1">
                          <ConfidenceBadge confidence={a.confidence} />
                        </div>
                        {a.holding.dcaMonthlyEur > 0 && (
                          <div className="text-xs text-blue-400 mt-0.5">DCA activo</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
