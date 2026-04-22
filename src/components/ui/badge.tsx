'use client';

import type { PortfolioState, OpportunityState, AllocationState, AssetType, Confidence } from '@/lib/types';

type AnyState = PortfolioState | OpportunityState | AllocationState | string;

const STATE_CONFIG: Record<string, { label: string; color: string }> = {
  // Portfolio states
  BUY_MORE:      { label: 'BUY MORE',     color: 'bg-green-500 text-black font-semibold' },
  BUY_PARTIAL:   { label: 'BUY PARTIAL',  color: 'bg-green-400 text-black font-semibold' },
  BUY_SMALL:     { label: 'BUY SMALL',    color: 'bg-emerald-600 text-white' },
  WAIT:          { label: 'WAIT',         color: 'bg-yellow-600 text-white' },
  DO_NOTHING:    { label: 'HOLD',         color: 'bg-slate-600 text-slate-200' },
  REVIEW:        { label: 'REVIEW',       color: 'bg-orange-500 text-white' },
  REDUCE:        { label: 'REDUCE',       color: 'bg-red-600 text-white' },
  // Opportunity states
  BUY:           { label: 'BUY',          color: 'bg-green-500 text-black font-semibold' },
  READY_TO_BUY:  { label: 'READY',        color: 'bg-emerald-600 text-white' },
  WATCH:         { label: 'WATCH',        color: 'bg-blue-700 text-white' },
  HOLD:          { label: 'HOLD',         color: 'bg-slate-600 text-slate-200' },
  REVIEW_FOR_TRIM: { label: 'TRIM?',      color: 'bg-orange-600 text-white' },
  EXIT:          { label: 'EXIT',         color: 'bg-red-700 text-white' },
  AVOID:         { label: 'AVOID',        color: 'bg-red-900 text-slate-300' },
  // Allocation states
  BEST_USE_OF_CASH: { label: 'BEST',      color: 'bg-green-500 text-black font-semibold' },
  SECOND_BEST:   { label: '2ND BEST',     color: 'bg-blue-600 text-white' },
  HOLD_CASH:     { label: 'HOLD CASH',    color: 'bg-slate-600 text-slate-200' },
};

export function StateBadge({ state }: { state: AnyState }) {
  const config = STATE_CONFIG[state] ?? { label: state, color: 'bg-slate-700 text-slate-300' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs tracking-wide ${config.color}`}>
      {config.label}
    </span>
  );
}

export function TypeBadge({ type }: { type: AssetType }) {
  const isEtf = type === 'etf';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${
      isEtf ? 'bg-blue-900/60 text-blue-300' : 'bg-purple-900/60 text-purple-300'
    }`}>
      {type.toUpperCase()}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence | string }) {
  const colors: Record<string, string> = {
    high: 'text-green-400',
    medium: 'text-yellow-400',
    low: 'text-slate-400',
  };
  return (
    <span className={`text-xs ${colors[confidence] ?? 'text-slate-400'}`}>
      {confidence.toUpperCase()}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color =
    score >= 7.5 ? 'bg-green-500' :
    score >= 6 ? 'bg-yellow-500' :
    score >= 4 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-slate-700">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 w-6 text-right">{score.toFixed(1)}</span>
    </div>
  );
}
