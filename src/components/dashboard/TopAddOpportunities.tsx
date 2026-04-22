'use client';

import { Card, CardHeader, CardTitle, CardBody, DrawdownDisplay, SectionEmpty } from '@/components/ui/card';
import { StateBadge, TypeBadge, ConfidenceBadge } from '@/components/ui/badge';
import type { PortfolioAnalysis } from '@/lib/types';
import { getTopPortfolioAdds } from '@/lib/ranking/ranker';

interface Props {
  analyses: PortfolioAnalysis[];
}

export function TopAddOpportunities({ analyses }: Props) {
  const topAdds = getTopPortfolioAdds(analyses, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Portfolio Adds</CardTitle>
        <span className="text-xs text-slate-500">Best adds within your existing holdings</span>
      </CardHeader>
      <CardBody className="p-0">
        {topAdds.length === 0 ? (
          <SectionEmpty message="No actionable adds — portfolio positions are near their recent highs" />
        ) : (
          <div className="divide-y divide-[#2a3445]/50">
            {topAdds.map((a) => {
              const ticker = a.holding.ticker ?? a.holding.id.toUpperCase();
              const currency = a.holding.currency === 'EUR' ? '€' : '$';
              return (
                <div key={a.holding.id} className="px-4 py-3 hover:bg-[#222b3a] transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-slate-200 font-medium">{ticker}</span>
                        <TypeBadge type={a.holding.type} />
                        <StateBadge state={a.state} />
                        <span className="text-xs text-slate-500">
                          Conviction: {a.holding.convictionScore}/10
                        </span>
                      </div>
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
                        <div className="text-xs text-blue-400 mt-0.5">DCA active</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
