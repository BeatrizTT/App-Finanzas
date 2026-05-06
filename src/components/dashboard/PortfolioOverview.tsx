'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody, DrawdownDisplay } from '@/components/ui/card';
import { StateBadge, TypeBadge, STATE_DESCRIPTIONS } from '@/components/ui/badge';
import type { PortfolioAnalysis, ConcentrationData } from '@/lib/types';

interface ClosedPos { isin: string; ticker?: string; name: string; realizedPnl: number }

function PnlColor({ pct }: { pct: number }) {
  const color = pct >= 0 ? 'text-green-400' : 'text-red-400';
  return (
    <span
      className={`${color} text-xs font-mono`}
      title="Diferencia entre el precio actual y lo que pagaste tú. Si es positivo, vas ganando. Si es negativo, ahora vale menos de lo que pagaste. Es 'en papel' porque no has vendido."
    >
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
  closedPositions?: ClosedPos[];
  totalRealizedPnl?: number | null;
}

function PortfolioSummary({
  analyses, totalValue, totalRealizedPnl,
}: {
  analyses: PortfolioAnalysis[];
  totalValue: number;
  totalRealizedPnl?: number | null;
}) {
  const withPrice = analyses.filter(a => a.currentPrice > 0 && (a.holding.units ?? 0) > 0);
  const inProfit = withPrice.filter(a => a.unrealizedPnlPct > 0);
  const inLoss   = withPrice.filter(a => a.unrealizedPnlPct < 0);

  // Approximate invested from pnlPct (currency-agnostic ratio)
  let sumCurrent = 0, sumInvested = 0;
  for (const a of withPrice) {
    const cur = a.currentPrice * (a.holding.units ?? 0);
    const inv = cur / (1 + a.unrealizedPnlPct / 100);
    sumCurrent += cur;
    sumInvested += inv;
  }
  const investedEur    = sumCurrent > 0 && totalValue > 0 ? (sumInvested / sumCurrent) * totalValue : 0;
  const paperGainEur   = totalValue - investedEur;
  const paperGainPct   = investedEur > 0 ? (paperGainEur / investedEur) * 100 : 0;
  const totalReturnEur = paperGainEur + (totalRealizedPnl ?? 0);

  const best  = withPrice.length > 0 ? withPrice.reduce((a, b) => b.unrealizedPnlPct > a.unrealizedPnlPct ? b : a) : null;
  const worst = withPrice.length > 0 ? withPrice.reduce((a, b) => b.unrealizedPnlPct < a.unrealizedPnlPct ? b : a) : null;

  const hasSold = totalRealizedPnl != null;

  return (
    <div className={`grid gap-3 mb-4 ${hasSold ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
      {/* Card 1: what it's worth now */}
      <div className="bg-[#1a2233] rounded-lg p-3">
        <div className="text-xs text-slate-500 mb-1">Vale ahora</div>
        <div className="text-lg font-mono font-semibold text-slate-200">
          €{totalValue.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
        </div>
        {investedEur > 0 && (
          <div className="text-xs text-slate-500 mt-0.5">
            Pusiste: €{investedEur.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
          </div>
        )}
      </div>

      {/* Card 2: paper gain/loss */}
      <div className="bg-[#1a2233] rounded-lg p-3">
        <div
          className="text-xs text-slate-500 mb-1"
          title="Cuánto ganarías o perderías si vendieras todo ahora mismo. No es dinero real hasta que vendas."
        >
          Si vendieras hoy
        </div>
        <div className={`text-lg font-mono font-semibold ${paperGainEur >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {paperGainEur >= 0 ? '+' : ''}€{paperGainEur.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
        </div>
        {investedEur > 0 && (
          <div className={`text-xs mt-0.5 ${paperGainPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {paperGainPct >= 0 ? '+' : ''}{paperGainPct.toFixed(1)}% de lo que pusiste
          </div>
        )}
      </div>

      {/* Card 3: realized (only if CSV was imported) */}
      {hasSold && (
        <div className="bg-[#1a2233] rounded-lg p-3">
          <div
            className="text-xs text-slate-500 mb-1"
            title="Ganancia o pérdida real de acciones que ya vendiste. Este dinero ya es tuyo (o ya lo perdiste)."
          >
            Ya vendiste y ganaste
          </div>
          <div className={`text-lg font-mono font-semibold ${(totalRealizedPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(totalRealizedPnl ?? 0) >= 0 ? '+' : ''}€{(totalRealizedPnl ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">ganancia real</div>
        </div>
      )}

      {/* Card 4: positions / best+worst */}
      <div className="bg-[#1a2233] rounded-lg p-3">
        <div className="text-xs text-slate-500 mb-1">Posiciones abiertas</div>
        <div className="text-lg font-mono font-semibold text-slate-200">{withPrice.length}</div>
        <div className="text-xs mt-0.5 space-y-0.5">
          {best && (
            <div className="text-green-400 font-mono">
              ↑ {best.holding.ticker ?? best.holding.id.toUpperCase()} {best.unrealizedPnlPct >= 0 ? '+' : ''}{best.unrealizedPnlPct.toFixed(1)}%
            </div>
          )}
          {worst && worst.holding.id !== best?.holding.id && (
            <div className="text-red-400 font-mono">
              ↓ {worst.holding.ticker ?? worst.holding.id.toUpperCase()} {worst.unrealizedPnlPct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PortfolioOverview({ analyses, concentration, lastRunAt, closedPositions, totalRealizedPnl }: Props) {
  if (!analyses || analyses.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Mi Cartera</CardTitle></CardHeader>
        <CardBody>
          <p className="text-slate-500 text-sm">Sin datos todavía. Pulsa "▶ Analizar" para analizar tu cartera.</p>
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
        <div className="px-4 pt-4">
          <PortfolioSummary analyses={analyses} totalValue={totalValue} totalRealizedPnl={totalRealizedPnl} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3445] text-xs text-slate-500 uppercase">
                <th className="text-left px-4 py-2">Activo / ISIN</th>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-right px-4 py-2" title="Precio actual de mercado">Precio hoy</th>
                <th className="text-right px-4 py-2" title="Media ponderada de todos los precios a los que compraste">Lo que pagaste</th>
                <th className="text-right px-4 py-2" title="Si positivo: ahora vale más de lo que pagaste. Si negativo: ahora vale menos. No es real hasta que vendas.">Ganancia en papel</th>
                <th className="text-left px-4 py-2" title="Cuánto ha bajado desde su precio más alto reciente. Cuanto más haya bajado, más barato está.">Bajada desde máximo</th>
                <th className="text-left px-4 py-2" title="Qué hacer con esta posición según el motor">Qué hacer</th>
                <th className="text-right px-4 py-2" title="Cuánto invertir si decides actuar">Cuánto invertir</th>
                <th className="text-left px-4 py-2" title="Lo que aportas cada mes automáticamente">Aportación mensual</th>
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
                        ? a.state === 'REDUCE'
                          ? <span className="text-orange-400">Vender {a.holding.currency === 'EUR' ? '€' : '$'}{a.suggestedAmountEur.min}–{a.holding.currency === 'EUR' ? '€' : '$'}{a.suggestedAmountEur.max}</span>
                          : <span className="text-green-400">€{a.suggestedAmountEur.min}–{a.suggestedAmountEur.max}</span>
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

        {/* Closed / sold positions */}
        {closedPositions && closedPositions.length > 0 && (
          <div className="px-4 py-4 border-t border-[#2a3445]/50">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-2 font-semibold">
              Acciones que ya vendiste
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-600 border-b border-[#2a3445]/40">
                    <th className="text-left py-1">Activo</th>
                    <th className="text-right py-1" title="Ganancia o pérdida real que obtuviste al vender. Este dinero ya entró (o salió) de tu cuenta.">Ganado / Perdido al vender</th>
                  </tr>
                </thead>
                <tbody>
                  {closedPositions.map(p => (
                    <tr key={p.isin} className="border-b border-[#2a3445]/20">
                      <td className="py-1.5">
                        <span className="font-mono text-slate-300">{p.ticker ?? p.isin}</span>
                        <span className="text-slate-600 ml-2">{p.name}</span>
                      </td>
                      <td className={`py-1.5 text-right font-mono ${p.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {p.realizedPnl >= 0 ? '+' : ''}€{p.realizedPnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {closedPositions.length > 1 && (
                    <tr className="font-semibold">
                      <td className="py-1.5 text-slate-400">Total ganado al vender</td>
                      <td className={`py-1.5 text-right font-mono ${(totalRealizedPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {(totalRealizedPnl ?? 0) >= 0 ? '+' : ''}€{(totalRealizedPnl ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-600 mt-2">
              Estas posiciones aparecen al importar tu CSV de Trade Republic. Las ganancias/pérdidas ya son reales.
            </p>
          </div>
        )}

        <div className="px-4 py-2 text-xs text-slate-600 border-t border-[#2a3445]/30">
          💡 Pasa el ratón encima de cualquier título para ver su explicación. Haz clic en el ISIN para copiarlo y usarlo en Trade Republic.
        </div>
      </CardBody>
    </Card>
  );
}
