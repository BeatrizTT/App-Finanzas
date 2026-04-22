'use client';

import { Card, CardHeader, CardTitle, CardBody, SectionEmpty } from '@/components/ui/card';
import { StateBadge, TypeBadge } from '@/components/ui/badge';
import type { AllocationRecommendation } from '@/lib/types';

interface Props {
  recommendations: AllocationRecommendation[];
}

function AllocationCard({ rec }: { rec: AllocationRecommendation }) {
  return (
    <div className="border border-[#2a3445] rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-lg font-mono font-bold text-slate-200">€{rec.forAmount.toLocaleString()}</span>
        <span className="text-xs text-slate-500">
          Deployable: €{rec.deployableAmount.toLocaleString()}
        </span>
      </div>

      {rec.holdCash ? (
        <div className="py-2 text-center">
          <div className="text-yellow-400 font-semibold text-sm">HOLD CASH</div>
          <div className="text-xs text-slate-500 mt-1">{rec.holdCashReason}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {rec.options.slice(0, 3).map((opt) => (
            <div
              key={opt.asset}
              className={`flex items-center justify-between p-2 rounded ${
                opt.rank === 1 ? 'bg-green-900/20 border border-green-800/50' :
                opt.rank === 2 ? 'bg-blue-900/20 border border-blue-800/50' :
                'bg-[#222b3a]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-500 w-4 shrink-0">#{opt.rank}</span>
                <span className="font-mono text-slate-200 text-sm">{opt.asset}</span>
                <TypeBadge type={opt.type} />
                <StateBadge state={opt.state} />
                {opt.isExistingHolding && (
                  <span className="text-xs text-slate-500 hidden sm:block">existing</span>
                )}
              </div>
              <div className="text-right shrink-0 ml-2">
                <div className="text-green-400 font-mono text-sm font-semibold">€{opt.amountEur}</div>
                <div className="text-xs text-slate-500">{opt.percentOfDeployable}% of pool</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 text-xs text-slate-500 italic">{rec.summary}</div>
    </div>
  );
}

export function BestUseOfCash({ recommendations }: Props) {
  if (!recommendations || recommendations.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Best Use of Cash</CardTitle></CardHeader>
        <CardBody>
          <SectionEmpty message="No recommendations yet — run the engine first" />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Best Use of Cash</CardTitle>
        <span className="text-xs text-slate-500">Capital allocator output</span>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recommendations.map((rec) => (
            <AllocationCard key={rec.forAmount} rec={rec} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
