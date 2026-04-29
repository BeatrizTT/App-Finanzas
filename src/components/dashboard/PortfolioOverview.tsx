'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody, DrawdownDisplay } from '@/components/ui/card';
import { StateBadge, TypeBadge, ConfidenceBadge, STATE_DESCRIPTIONS } from '@/components/ui/badge';
import type { PortfolioAnalysis, ConcentrationData } from '@/lib/types';

function PnlColor({ pct }: { pct: number }) {
  const color = pct >= 0 ? 'text-green-400' : 'text-red-400';
  return (
    <span className={`${color} text-xs font-mono`} title="P&L = Ganancia o pérdida no realizada. Es la diferencia entre el precio actual y tu precio medio de compra, en porcentaje.">
      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

function IsinCopy({ isin }: { isin: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(isin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="text-xs text-slate-500 hover:text-blue-400 font-mono transition-colors cursor-pointer"
      title="ISIN: código único internacional que identifica exactamente este activo. Úsalo en Trade Republic para asegurarte de que compras el correcto. Haz clic para copiar."
    >
      {copied ? '✓ copiado' : isin}
    </button>
  );
}

function ReasonsList({ reasons, state }: { reasons: string[]; state: string }) {
  const [open, setOpen] = useState(false);
  const desc = STATE_DESCRIPTIONS[state];
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
      >
        {open ? '▾' : '▸'} ¿Por qué?
      </button>
      {open && (
        <div className="mt-1.5 bg-[#1a2233] rounded p-2 text-xs text-slate-400 space-y-1 max-w-xs">
          {desc && <p className="text-slate-300 font-medium mb-1">{desc.explain}</p>}
          {reasons.slice(0, 4).map((r, i) => (
            <div key={i} className="flex gap-1.5">
              <span className="text-slate-600 shrink-0">•</span>
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  analyses: PortfolioAnalysis[];
  concentration: ConcentrationData | null;
  lastRunAt: string | null;
}

export function PortfolioOverview({ analyses, concentration, lastRunAt }: Props) {
  if (!analyses || analyses.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Mi Cartera</CardTitle></CardHeader>
        <CardBody>
          <p className="text-slate-500 text-sm">Sin datos todavía. Pulsa "Ejecutar motor" para analizar tu cartera.</p>
        </CardBody>
      </Card>
    );
  }

  const totalValue = concentration?.totalPortfolioValue ?? 0;
  const { stocks, etfs } = concentration?.stockVsEtfRatio ?? { stocks: 0, etfs: 0 };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mi Cartera</CardTitle>
        <div className="flex items-center gap-3 flex-wrap">
          {totalValue > 0 && (
            <span className="text-xs text-slate-400" title="Valor estimado de tu cartera de acciones y ETFs (sin contar efectivo, bonos ni fondos privados)">
              Valor estimado: €{totalValue.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
            </span>
          )}
          <span className="text-xs text-slate-500" title="Proporción de tu cartera entre acciones individuales y ETFs">
            Acciones {stocks.toFixed(0)}% / ETFs {etfs.toFixed(0)}%
          </span>
          {lastRunAt && (
            <span className="text-xs text-slate-600">
              Análisis: {new Date(lastRunAt).toLocaleTimeString('es-ES')}
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3445] text-xs text-slate-500 uppercase">
                <th className="text-left px-4 py-2">Activo / ISIN</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-right px-4 py-2" title="Precio actual de mercado">Precio actual</th>
                <th className="text-right px-4 py-2" title="Tu precio medio de compra — la media ponderada de todas tus compras">Precio medio</th>
                <th className="text-right px-4 py-2" title="Ganancia o pérdida no realizada desde tu precio medio de compra">G/P %</th>
                <th className="text-left px-4 py-2" title="Cuánto ha caído el precio desde su máximo de los últimos 30, 60 y 90 días. Cuanto más haya caído, más atractivo suele ser el precio.">Caída desde máx (30/60/90d)</th>
                <th className="text-left px-4 py-2" title="Recomendación del motor para esta posición">Acción</th>
                <th className="text-right px-4 py-2" title="Cantidad sugerida a invertir si decides actuar">Importe (€)</th>
                <th className="text-left px-4 py-2" title="Plan de aportación mensual automatizado">DCA mensual</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => {
                const ticker = a.holding.ticker ?? a.holding.id.toUpperCase();
                const currency = a.holding.currency === 'EUR' ? '€' : '$';
                const isin = (a.holding as any).isin as string | undefined;
                return (
                  <tr key={a.holding.id} className="border-b border-[#2a3445]/50 hover:bg-[#222b3a] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-mono text-slate-200 font-semibold">{ticker}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[160px]">{a.holding.name}</div>
                      {isin && <IsinCopy isin={isin} />}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={a.holding.type} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-200">
                      {a.currentPrice > 0 ? `${currency}${a.currentPrice.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400 text-xs">
                      {currency}{a.avgPrice.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {a.currentPrice > 0 ? <PnlColor pct={a.unrealizedPnlPct} /> : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <DrawdownDisplay
                        d30={a.drawdown.drawdown30d}
                        d60={a.drawdown.drawdown60d}
                        d90={a.drawdown.drawdown90d}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <StateBadge state={a.state} showTooltip />
                        <ReasonsList reasons={a.reasons} state={a.state} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono">
                      {a.suggestedAmountEur.max > 0
                        ? <span className="text-green-400">€{a.suggestedAmountEur.min}–{a.suggestedAmountEur.max}</span>
                        : <span className="text-slate-600">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {a.holding.dcaMonthlyEur > 0 ? (
                        <span className="text-blue-400">€{a.holding.dcaMonthlyEur}/mes</span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-xs text-slate-600 border-t border-[#2a3445]/30">
          💡 Pasa el ratón por encima de cualquier término para ver su explicación. Haz clic en el ISIN para copiarlo — úsalo en Trade Republic para comprar el activo correcto.
        </div>
      </CardBody>
    </Card>
  );
}
