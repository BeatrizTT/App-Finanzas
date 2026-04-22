'use client';

import { Card, CardHeader, CardTitle, CardBody, SectionEmpty } from '@/components/ui/card';
import { StateBadge, TypeBadge } from '@/components/ui/badge';
import type { Alert } from '@/lib/types';

interface Props {
  alerts: Alert[];
}

const TYPE_ICON: Record<string, string> = {
  portfolio_state_change: '📊',
  new_opportunity: '📈',
  etf_opportunity: '📦',
  concentration_warning: '⚠️',
  daily_digest: '📅',
  tactical_review: '🔄',
  discovery: '🔍',
  cash_deployment_update: '💰',
};

export function AlertsHistory({ alerts }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert History</CardTitle>
        <span className="text-xs text-slate-500">{alerts.length} recent alerts</span>
      </CardHeader>
      <CardBody className="p-0">
        {alerts.length === 0 ? (
          <SectionEmpty message="No alerts yet — run the engine to generate alerts" />
        ) : (
          <div className="divide-y divide-[#2a3445]/50 max-h-96 overflow-y-auto">
            {alerts.slice(0, 30).map((alert) => (
              <div key={alert.id} className="px-4 py-3 hover:bg-[#222b3a] transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base">{TYPE_ICON[alert.type] ?? '🔔'}</span>
                      {alert.asset && (
                        <span className="font-mono text-slate-200 text-sm">{alert.asset}</span>
                      )}
                      {alert.assetType && <TypeBadge type={alert.assetType} />}
                      {alert.newState && <StateBadge state={alert.newState} />}
                      {alert.oldState && alert.newState !== alert.oldState && (
                        <span className="text-xs text-slate-500">
                          was: <span className="text-slate-400">{alert.oldState}</span>
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 line-clamp-2">
                      {alert.message.replace(/\*/g, '').split('\n').slice(0, 2).join(' • ')}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-slate-600">
                      {new Date(alert.timestamp).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-slate-600">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </div>
                    <div className={`text-xs mt-1 ${alert.telegramSent ? 'text-green-500' : 'text-slate-600'}`}>
                      {alert.telegramSent ? '✓ sent' : '○ local'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
