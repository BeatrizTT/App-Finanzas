'use client';

import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';

interface Props {
  onRunEngine: () => void;
  isRunning: boolean;
  lastRunAt: string | null;
  providerName: string;
  marketRegime: string;
  isTelegramConfigured: boolean;
}

function SettingRow({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[#2a3445]/50">
      <div>
        <div className="text-sm text-slate-300">{label}</div>
        {description && <div className="text-xs text-slate-500">{description}</div>}
      </div>
      <div className="text-sm font-mono text-slate-400 ml-4">{value}</div>
    </div>
  );
}

export function Settings({
  onRunEngine,
  isRunning,
  lastRunAt,
  providerName,
  marketRegime,
  isTelegramConfigured,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings & Engine Control</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Engine Control */}
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">Engine Control</div>
            <button
              onClick={onRunEngine}
              disabled={isRunning}
              className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
                isRunning
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-500 text-white cursor-pointer'
              }`}
            >
              {isRunning ? 'Running engine...' : 'Run Engine Now'}
            </button>
            <div className="mt-2 text-xs text-slate-500">
              Fetches latest prices, runs all three engines, generates and sends alerts.
            </div>
            {lastRunAt && (
              <div className="mt-2 text-xs text-slate-600">
                Last run: {new Date(lastRunAt).toLocaleString()}
              </div>
            )}
          </div>

          {/* Current Config */}
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">Current Configuration</div>
            <div className="space-y-0">
              <SettingRow
                label="Price Provider"
                value={providerName}
                description="Edit PRICE_PROVIDER in .env.local"
              />
              <SettingRow
                label="Market Regime"
                value={marketRegime}
                description="Edit in config/overrides.json"
              />
              <SettingRow
                label="Telegram Alerts"
                value={isTelegramConfigured ? 'Configured' : 'Not configured'}
                description={isTelegramConfigured ? 'Alerts will be sent to Telegram' : 'Set TELEGRAM_BOT_TOKEN & CHAT_ID'}
              />
            </div>
          </div>
        </div>

        {/* Config file guide */}
        <div className="mt-6 bg-[#161b27] rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Config Files</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400">
            <div>📄 <code className="text-blue-400">config/portfolio.json</code> — Holdings, DCA, conviction</div>
            <div>📄 <code className="text-blue-400">config/rules.json</code> — Drawdown zones, limits</div>
            <div>📄 <code className="text-blue-400">config/universe.json</code> — Watchlist &amp; discovery</div>
            <div>📄 <code className="text-blue-400">config/scoring-weights.json</code> — Scanner weights</div>
            <div>📄 <code className="text-blue-400">config/allocation.json</code> — Trade sizes</div>
            <div>📄 <code className="text-blue-400">config/overrides.json</code> — Market regime, overrides</div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
