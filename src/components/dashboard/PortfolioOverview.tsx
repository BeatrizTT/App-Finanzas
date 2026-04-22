'use client';

import { Card, CardHeader, CardTitle, CardBody, DrawdownDisplay } from '@/components/ui/card';
import { StateBadge, TypeBadge, ConfidenceBadge } from '@/components/ui/badge';
import type { PortfolioAnalysis, ConcentrationData } from '@/lib/types';

function PnlColor({ pct }: { pct: number }) {
  const color = pct >= 0 ? 'text-green-400' : 'text-red-400';
  return <span className={`${color} text-xs font-mono`}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>;
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
        <CardHeader><CardTitle>Portfolio Overview</CardTitle></CardHeader>
        <CardBody>
          <p className="text-slate-500 text-sm">No portfolio data yet. Run the engine to analyze your holdings.</p>
        </CardBody>
      </Card>
    );
  }

  const totalValue = concentration?.totalPortfolioValue ?? 0;
  const { stocks, etfs } = concentration?.stockVsEtfRatio ?? { stocks: 0, etfs: 0 };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Overview</CardTitle>
        <div className="flex items-center gap-3">
          {totalValue > 0 && (
            <span className="text-xs text-slate-400">
              Total: €{totalValue.toLocaleString('en', { maximumFractionDigits: 0 })}
            </span>
          )}
          <span className="text-xs text-slate-500">
            Stocks {stocks.toFixed(0)}% / ETFs {etfs.toFixed(0)}%
          </span>
          {lastRunAt && (
            <span className="text-xs text-slate-600">
              Last: {new Date(lastRunAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3445] text-xs text-slate-500 uppercase">
                <th className="text-left px-4 py-2">Asset</th>
                <th className="text-left px-4 py-2">Type</th>
                <th className="text-right px-4 py-2">Price</th>
                <th className="text-right px-4 py-2">Avg</th>
                <th className="text-right px-4 py-2">P&L</th>
                <th className="text-left px-4 py-2">Drawdown (30/60/90d)</th>
                <th className="text-left px-4 py-2">State</th>
                <th className="text-right px-4 py-2">Action €</th>
                <th className="text-left px-4 py-2">DCA</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => {
                const ticker = a.holding.ticker ?? a.holding.id.toUpperCase();
                const currency = a.holding.currency === 'EUR' ? '€' : '$';
                return (
                  <tr key={a.holding.id} className="border-b border-[#2a3445]/50 hover:bg-[#222b3a] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-mono text-slate-200">{ticker}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[120px]">{a.holding.name}</div>
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
                      <StateBadge state={a.state} />
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-mono">
                      {a.suggestedAmountEur.max > 0
                        ? <span className="text-green-400">€{a.suggestedAmountEur.min}–{a.suggestedAmountEur.max}</span>
                        : <span className="text-slate-600">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {a.holding.dcaMonthlyEur > 0 ? (
                        <span className="text-blue-400">€{a.holding.dcaMonthlyEur}/mo</span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
