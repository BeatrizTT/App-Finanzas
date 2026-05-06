'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody, SectionEmpty } from '@/components/ui/card';
import { StateBadge, TypeBadge } from '@/components/ui/badge';
import type { AllocationRecommendation } from '@/lib/types';

const TICKER_ISIN: Record<string, string> = {
  NVDA: 'US67066G1040', ASML: 'NL0010273215', MSFT: 'US5949181045',
  AMZN: 'US0231351067', SMCI: 'US86800U3023', CRM:  'US79466L3024',
  NOW:  'US81762P1021', ADBE: 'US00724F1012', ORCL: 'US68389X1054',
  TSLA: 'US88160R1014', MU:   'US5951121038', CNDX: 'IE00B53SZB19',
  IWVL: 'IE00BP3QZB59', IWDA: 'IE00B4L5Y983',
};

function IsinCopy({ ticker }: { ticker: string }) {
  const [copied, setCopied] = useState(false);
  const isin = TICKER_ISIN[ticker];
  if (!isin) return null;
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(isin).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="text-xs text-slate-600 hover:text-blue-400 font-mono transition-colors cursor-pointer block"
      title="Copia el ISIN para buscarlo en Trade Republic"
    >
      {copied ? '✓ copiado' : isin}
    </button>
  );
}

interface Props {
  recommendations: AllocationRecommendation[];
}

function AllocationCard({ rec }: { rec: AllocationRecommendation }) {
  return (
    <div className="border border-[#2a3445] rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-lg font-mono font-bold text-slate-200">Si tienes €{rec.forAmount.toLocaleString()} para invertir</span>
      </div>
      <div className="text-xs text-slate-500 mb-3">
        De esos, €{rec.deployableAmount.toLocaleString()} disponibles (reservando tu colchón de seguridad)
      </div>

      {rec.holdCash ? (
        <div className="py-3 text-center bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
          <div className="text-yellow-400 font-semibold text-sm">💰 Guarda el efectivo</div>
          <div className="text-xs text-slate-400 mt-1">{rec.holdCashReason}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {rec.options.slice(0, 5).map((opt) => (
            <div
              key={opt.asset}
              className={`p-2.5 rounded-lg border ${
                opt.rank === 1 ? 'bg-green-900/20 border-green-800/50' :
                opt.rank === 2 ? 'bg-blue-900/20 border-blue-800/40' :
                opt.rank === 3 ? 'bg-[#1e2a3a] border-[#2a3445]' :
                'bg-[#1a2030] border-[#222b3a]/60 opacity-80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-xs text-slate-500 shrink-0">
                    {opt.rank === 1 ? '🥇' : opt.rank === 2 ? '🥈' : opt.rank === 3 ? '🥉' : `${opt.rank}°`}
                  </span>
                  <span className="font-mono text-slate-200 text-sm font-semibold">{opt.asset}</span>
                  <TypeBadge type={opt.type} />
                  <StateBadge state={opt.state} showTooltip />
                  {opt.isExistingHolding && (
                    <span className="text-xs text-slate-500">ya la tienes</span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-green-400 font-mono text-sm font-semibold">€{opt.amountEur}</div>
                  <div className="text-xs text-slate-500">{opt.percentOfDeployable}% del total</div>
                </div>
              </div>
              <IsinCopy ticker={opt.asset} />
              {opt.reason && (
                <div className="text-xs text-slate-500 mt-1">• {opt.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 text-xs text-slate-500 italic border-t border-[#2a3445]/50 pt-2">{rec.summary}</div>
    </div>
  );
}

export function BestUseOfCash({ recommendations }: Props) {
  if (!recommendations || recommendations.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>¿En qué invertir el efectivo?</CardTitle></CardHeader>
        <CardBody>
          <SectionEmpty message="Sin recomendaciones — ejecuta el análisis primero" />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>¿En qué invertir el efectivo?</CardTitle>
        <span className="text-xs text-slate-500">El motor ordena las mejores opciones según tu perfil</span>
      </CardHeader>
      <CardBody>
        <div className="mb-4 bg-[#1a2233] rounded-lg p-3 text-xs text-slate-400">
          <p>
            <strong className="text-slate-300">¿Tengo efectivo, en qué lo pongo?</strong> Esta sección responde exactamente eso.
            El motor analiza todas tus opciones (lo que ya tienes y nuevas ideas) y te dice en qué orden invertir
            dependiendo de cuánto dinero tengas disponible. La opción <strong className="text-slate-300">🥇</strong> es siempre la mejor oportunidad en este momento.
            Haz clic en el ISIN para copiarlo y buscarlo directamente en Trade Republic.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {recommendations.map((rec) => (
            <AllocationCard key={rec.forAmount} rec={rec} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
