'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';

interface ImportResult {
  holdingsUpdated: number;
  saved: boolean;
  totalRealizedPnl?: number;
  holdings: { ticker: string; shares: number; avgCostEur: number; realizedPnl: number }[];
  closedPositions?: { ticker: string; name: string; realizedPnl: number }[];
}

interface ConfigStatus {
  priceProvider: string;
  telegramConfigured: boolean;
  cronSecretSet: boolean;
  isVercel: boolean;
}

interface Props {
  onRunEngine: () => void;
  isRunning: boolean;
  lastRunAt: string | null;
  providerName: string;
  marketRegime: string;
  isTelegramConfigured: boolean;
  onImportDone?: () => void;
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

function CopySnippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex items-center gap-2 mt-2">
      <code className="flex-1 text-xs font-mono bg-black/30 px-2 py-1 rounded text-slate-300 break-all">{text}</code>
      <button
        onClick={copy}
        className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors shrink-0 cursor-pointer"
      >
        {copied ? '✓' : 'Copiar'}
      </button>
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
  onImportDone,
}: Props) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/config/status')
      .then((r) => r.json())
      .then((data: ConfigStatus) => setConfigStatus(data))
      .catch(() => {/* silent */});
  }, []);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError('');
    setImportResult(null);

    const form = new FormData();
    form.append('csv', file);

    try {
      const res = await fetch('/api/portfolio/import', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok && data.success) {
        setImportResult(data);
        onImportDone?.();
      } else {
        setImportError(data.error ?? 'Error desconocido al procesar el CSV.');
      }
    } catch {
      setImportError('Error de red al subir el archivo.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuración</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Engine Control */}
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">Control del motor</div>
            <button
              onClick={onRunEngine}
              disabled={isRunning}
              className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-all ${
                isRunning
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-500 text-white cursor-pointer'
              }`}
            >
              {isRunning ? 'Analizando...' : '▶ Ejecutar análisis ahora'}
            </button>
            <div className="mt-2 text-xs text-slate-500">
              Obtiene los precios más recientes y genera recomendaciones para toda tu cartera.
            </div>
            {lastRunAt && (
              <div className="mt-2 text-xs text-slate-600">
                Último análisis: {new Date(lastRunAt).toLocaleString('es-ES')}
              </div>
            )}
          </div>

          {/* Status + Setup Guides */}
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">Estado del sistema</div>
            <div className="space-y-3">

              {/* Precios reales */}
              {configStatus?.priceProvider !== 'yahoo' ? (
                <div className="rounded-lg border border-yellow-800/50 bg-yellow-900/20 p-3">
                  <div className="text-xs font-semibold text-yellow-300 mb-1">
                    ⚡ Activa precios reales (Yahoo Finance)
                  </div>
                  <div className="text-xs text-yellow-200/70 mb-2">
                    Sin esto el motor usa precios simulados. Ve a Vercel → tu proyecto → Settings → Environment Variables → añade la variable de abajo → Redeploy
                  </div>
                  <CopySnippet text="PRICE_PROVIDER=yahoo" />
                </div>
              ) : (
                <div className="rounded-lg border border-green-800/40 bg-green-900/20 p-3">
                  <div className="text-xs font-semibold text-green-400">
                    ✅ Precios reales activados (Yahoo Finance)
                  </div>
                </div>
              )}

              {/* Telegram */}
              {!configStatus?.telegramConfigured ? (
                <div className="rounded-lg border border-blue-800/40 bg-blue-900/20 p-3">
                  <div className="text-xs font-semibold text-blue-300 mb-2">
                    📱 Activa notificaciones Telegram
                  </div>
                  <ol className="text-xs text-blue-200/70 space-y-1.5 list-none">
                    <li>1. Busca <span className="font-mono text-blue-300">@BotFather</span> en Telegram → escribe <span className="font-mono">/newbot</span> → elige nombre → copia el TOKEN</li>
                    <li>2. Busca <span className="font-mono text-blue-300">@userinfobot</span> → escribe cualquier mensaje → copia tu Chat ID (el número)</li>
                    <li>3. En Vercel → Settings → Environment Variables, añade:
                      <div className="mt-1 space-y-1">
                        <CopySnippet text="TELEGRAM_BOT_TOKEN=el_token_del_paso_1" />
                        <CopySnippet text="TELEGRAM_CHAT_ID=tu_chat_id_del_paso_2" />
                      </div>
                    </li>
                    <li>4. Redeploy y vuelve aquí — pondrá ✅ Activadas</li>
                  </ol>
                </div>
              ) : (
                <div className="rounded-lg border border-green-800/40 bg-green-900/20 p-3">
                  <div className="text-xs font-semibold text-green-400">
                    ✅ Telegram activado — recibirás alertas en tu móvil
                  </div>
                </div>
              )}

              {/* Análisis automático */}
              <div className="rounded-lg border border-[#2a3445] bg-[#161b27] p-3">
                <div className="text-xs text-slate-400">
                  ⏰ Análisis automático: el motor se ejecuta automáticamente a las 9h y 18h en días laborables (cron configurado)
                </div>
                {!configStatus?.cronSecretSet && (
                  <div className="text-xs text-slate-500 mt-1.5">
                    Opcional: añade <span className="font-mono text-slate-400">CRON_SECRET</span> en Vercel para proteger el endpoint del cron
                  </div>
                )}
              </div>

              {/* Simple status rows */}
              <div className="space-y-0">
                <SettingRow
                  label="Fuente de precios"
                  value={configStatus?.priceProvider ?? providerName}
                  description="'mock' = precios simulados • 'yahoo' = precios reales"
                />
                <SettingRow
                  label="Régimen de mercado"
                  value={marketRegime === 'bullish' ? '📈 Alcista' : marketRegime === 'bearish' ? '📉 Bajista' : '↔ Neutro'}
                  description="Influye en la agresividad de las recomendaciones"
                />
              </div>
            </div>
          </div>
        </div>

        {/* CSV Import from Trade Republic */}
        <div className="mt-6 bg-[#161b27] rounded-lg p-4 border border-[#2a3445]">
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1 font-semibold">
            📥 Actualizar cartera desde Trade Republic
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Descarga tu historial de transacciones en Trade Republic (Perfil → Documentos → Exportar transacciones) y súbelo aquí.
            La app calculará automáticamente cuántas acciones tienes y a qué precio medio.
          </p>
          <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all ${
            importing
              ? 'bg-slate-700 text-slate-500 cursor-wait'
              : 'bg-blue-700 hover:bg-blue-600 text-white'
          }`}>
            {importing ? '⏳ Procesando...' : '📂 Seleccionar CSV de Trade Republic'}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleImport}
              disabled={importing}
            />
          </label>

          {importError && (
            <div className="mt-3 p-3 bg-red-900/30 border border-red-700 rounded text-xs text-red-400">
              ⚠️ {importError}
            </div>
          )}

          {importResult && (
            <div className="mt-3 p-3 bg-green-900/20 border border-green-700/50 rounded">
              <div className="text-xs text-green-400 font-semibold mb-1">
                ✅ CSV leído — {importResult.holdingsUpdated} posiciones activas encontradas
              </div>
              {!importResult.saved && (
                <div className="text-xs text-yellow-500 mb-2">
                  ⚠️ En modo preview los datos no se guardan. En Railway/producción sí se guardan permanentemente.
                </div>
              )}
              {/* Open positions */}
              <div className="overflow-x-auto mt-2">
                <div className="text-xs text-slate-500 mb-1 font-medium">Posiciones que tienes ahora:</div>
                <table className="w-full text-xs text-slate-400">
                  <thead>
                    <tr className="text-slate-500 border-b border-[#2a3445]">
                      <th className="text-left py-1">Ticker</th>
                      <th className="text-right py-1">Acciones</th>
                      <th className="text-right py-1">Pagaste (media)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.holdings.map((h) => (
                      <tr key={h.ticker} className="border-b border-[#2a3445]/30">
                        <td className="py-1 font-mono text-slate-300">{h.ticker}</td>
                        <td className="py-1 text-right font-mono">{h.shares.toFixed(4)}</td>
                        <td className="py-1 text-right font-mono">€{h.avgCostEur.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Closed positions */}
              {importResult.closedPositions && importResult.closedPositions.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-slate-500 mb-1 font-medium">Lo que ya vendiste:</div>
                  <table className="w-full text-xs text-slate-400">
                    <thead>
                      <tr className="text-slate-500 border-b border-[#2a3445]">
                        <th className="text-left py-1">Ticker</th>
                        <th className="text-right py-1">Ganaste / Perdiste al vender</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.closedPositions.map((p) => (
                        <tr key={p.ticker} className="border-b border-[#2a3445]/30">
                          <td className="py-1 font-mono text-slate-300">{p.ticker}</td>
                          <td className={`py-1 text-right font-mono ${p.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {p.realizedPnl >= 0 ? '+' : ''}€{p.realizedPnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-semibold border-t border-[#2a3445]">
                        <td className="py-1 text-slate-300">Total</td>
                        <td className={`py-1 text-right font-mono ${(importResult.totalRealizedPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(importResult.totalRealizedPnl ?? 0) >= 0 ? '+' : ''}€{(importResult.totalRealizedPnl ?? 0).toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-600">
                Pulsa "▶ Ejecutar análisis ahora" para ver las recomendaciones con estos datos.
              </p>
            </div>
          )}
        </div>

        {/* How to export from Trade Republic */}
        <div className="mt-4 bg-[#161b27] rounded-lg p-4 border border-[#2a3445]/50">
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-2 font-semibold">
            ℹ️ Cómo exportar desde Trade Republic
          </div>
          <ol className="text-xs text-slate-500 space-y-1 list-none">
            <li>1. Abre Trade Republic en el móvil o en web (app.traderepublic.com)</li>
            <li>2. Ve a tu <strong className="text-slate-400">Perfil</strong> (icono de persona)</li>
            <li>3. Toca <strong className="text-slate-400">Documentos</strong></li>
            <li>4. Busca <strong className="text-slate-400">Historial de transacciones</strong> o <strong className="text-slate-400">Export</strong></li>
            <li>5. Descarga el archivo <strong className="text-slate-400">.csv</strong> y súbelo arriba</li>
          </ol>
        </div>
      </CardBody>
    </Card>
  );
}
