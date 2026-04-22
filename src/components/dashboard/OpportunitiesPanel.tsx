'use client';

import { Card, CardHeader, CardTitle, CardBody, DrawdownDisplay, SectionEmpty } from '@/components/ui/card';
import { StateBadge, TypeBadge, ConfidenceBadge, ScoreBar } from '@/components/ui/badge';
import type { Opportunity } from '@/lib/types';

function OpportunityRow({ opp, showDiscoveryBadge = false }: { opp: Opportunity; showDiscoveryBadge?: boolean }) {
  const currency = opp.currency === 'EUR' ? '€' : '$';
  return (
    <div className="px-4 py-3 hover:bg-[#222b3a] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-slate-200 font-medium">{opp.ticker}</span>
            <TypeBadge type={opp.type} />
            <StateBadge state={opp.state} />
            {showDiscoveryBadge && !opp.isSeedUniverse && (
              <span className="text-xs bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded">DISCOVERED</span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 truncate">{opp.name}</div>
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
          <div className="font-mono text-slate-300 text-sm">{currency}{opp.currentPrice.toFixed(2)}</div>
          {opp.suggestedAmountEur.max > 0 ? (
            <div className="text-green-400 font-mono text-sm font-semibold">
              €{opp.suggestedAmountEur.min}–{opp.suggestedAmountEur.max}
            </div>
          ) : null}
          <div className="mt-1">
            <ConfidenceBadge confidence={opp.confidence} />
          </div>
        </div>
      </div>
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
        <CardTitle>Stock Opportunities</CardTitle>
        <span className="text-xs text-slate-500">{actionable.length} active</span>
      </CardHeader>
      <CardBody className="p-0">
        {actionable.length === 0 ? (
          <SectionEmpty message="No strong stock entries detected" />
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
        <CardTitle>ETF Opportunities</CardTitle>
        <span className="text-xs text-slate-500">{actionable.length} active</span>
      </CardHeader>
      <CardBody className="p-0">
        {actionable.length === 0 ? (
          <SectionEmpty message="No strong ETF entries detected" />
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Discovery Monitor</CardTitle>
        <span className="text-xs text-slate-500">Extended universe finds</span>
      </CardHeader>
      <CardBody className="p-0">
        {opportunities.length === 0 ? (
          <SectionEmpty message="No external discoveries today — all seed universe names checked" />
        ) : (
          <div className="divide-y divide-[#2a3445]/50">
            {opportunities.map((o) => (
              <div key={o.ticker}>
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
        )}
      </CardBody>
    </Card>
  );
}
