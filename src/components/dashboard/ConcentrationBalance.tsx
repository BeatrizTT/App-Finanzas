'use client';

import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import type { ConcentrationData } from '@/lib/types';

interface Props {
  concentration: ConcentrationData | null;
}

function WeightBar({ label, value, limit, color }: { label: string; value: number; limit?: number; color: string }) {
  const isOver = limit && value > limit;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          {limit && <span className="text-slate-600">limit: {limit}%</span>}
          <span className={isOver ? 'text-red-400 font-semibold' : 'text-slate-300'}>
            {value.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-[#2a3445]">
        <div
          className={`h-full rounded-full transition-all ${isOver ? 'bg-red-500' : color}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      {isOver && (
        <div className="text-xs text-red-400">⚠ Over limit by {(value - limit!).toFixed(1)}%</div>
      )}
    </div>
  );
}

export function ConcentrationBalance({ concentration }: Props) {
  if (!concentration) {
    return (
      <Card>
        <CardHeader><CardTitle>Concentration & Balance</CardTitle></CardHeader>
        <CardBody>
          <p className="text-slate-500 text-sm">No data yet</p>
        </CardBody>
      </Card>
    );
  }

  const { stocks, etfs } = concentration.stockVsEtfRatio;
  const themes = Object.entries(concentration.themeWeights)
    .filter(([k]) => !k.startsWith('asset:'))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  const limits: Record<string, number> = {
    semis: 35, AI: 50, tech: 65,
  };

  const themeColors: Record<string, string> = {
    semis: 'bg-purple-500', AI: 'bg-blue-500', tech: 'bg-cyan-500',
    growth: 'bg-green-500', value: 'bg-yellow-500', software: 'bg-indigo-500',
    'broad-index': 'bg-teal-500', diversification: 'bg-emerald-500',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Concentration & Balance</CardTitle>
        {concentration.highConcentrationWarnings.length > 0 && (
          <span className="text-xs bg-orange-900/60 text-orange-300 px-2 py-0.5 rounded">
            {concentration.highConcentrationWarnings.length} warning{concentration.highConcentrationWarnings.length > 1 ? 's' : ''}
          </span>
        )}
      </CardHeader>
      <CardBody>
        {/* Warnings */}
        {concentration.highConcentrationWarnings.length > 0 && (
          <div className="mb-4 space-y-1">
            {concentration.highConcentrationWarnings.map((w, i) => (
              <div key={i} className="text-sm text-orange-300 bg-orange-900/20 border border-orange-800/50 rounded px-3 py-2">
                ⚠ {w}
              </div>
            ))}
          </div>
        )}

        {/* Stock vs ETF */}
        <div className="mb-4">
          <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Asset Mix</div>
          <div className="space-y-2">
            <WeightBar label="Stocks" value={stocks} color="bg-purple-500" />
            <WeightBar label="ETFs" value={etfs} color="bg-blue-500" />
          </div>
        </div>

        {/* Theme concentrations */}
        <div>
          <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Theme & Sector Weights</div>
          <div className="space-y-2">
            {themes.map(([tag, weight]) => (
              <WeightBar
                key={tag}
                label={tag}
                value={weight}
                limit={limits[tag]}
                color={themeColors[tag] ?? 'bg-slate-500'}
              />
            ))}
          </div>
        </div>

        {/* Total value */}
        {concentration.totalPortfolioValue > 0 && (
          <div className="mt-4 pt-3 border-t border-[#2a3445] text-xs text-slate-500">
            Estimated portfolio value: €{concentration.totalPortfolioValue.toLocaleString('en', { maximumFractionDigits: 0 })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
