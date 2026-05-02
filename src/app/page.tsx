'use client';

import { useState, useEffect, useCallback } from 'react';
import { PortfolioOverview } from '@/components/dashboard/PortfolioOverview';
import { TopAddOpportunities } from '@/components/dashboard/TopAddOpportunities';
import { StockOpportunities, EtfOpportunities, DiscoveryMonitor } from '@/components/dashboard/OpportunitiesPanel';
import { BestUseOfCash } from '@/components/dashboard/BestUseOfCash';
import { ConcentrationBalance } from '@/components/dashboard/ConcentrationBalance';
import { AlertsHistory } from '@/components/dashboard/AlertsHistory';
import { Settings } from '@/components/dashboard/Settings';
import { GlossaryButton } from '@/components/Glossary';
import type {
  PortfolioAnalysis,
  Opportunity,
  AllocationRecommendation,
  ConcentrationData,
  Alert,
} from '@/lib/types';

type Tab =
  | 'portfolio'
  | 'opportunities'
  | 'cash'
  | 'concentration'
  | 'discovery'
  | 'alerts'
  | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'portfolio', label: 'Mi Cartera' },
  { id: 'opportunities', label: 'Oportunidades' },
  { id: 'cash', label: 'Usar Efectivo' },
  { id: 'concentration', label: 'Balance' },
  { id: 'discovery', label: 'Descubrimientos' },
  { id: 'alerts', label: 'Alertas' },
  { id: 'settings', label: 'Configuración' },
];

interface ClosedPos { isin: string; ticker?: string; name: string; realizedPnl: number }

interface DashboardData {
  portfolioAnalyses: PortfolioAnalysis[];
  concentration: ConcentrationData | null;
  stockOpportunities: Opportunity[];
  etfOpportunities: Opportunity[];
  discoveredOpportunities: Opportunity[];
  allocationRecommendations: AllocationRecommendation[];
  alerts: Alert[];
  lastRunAt: string | null;
  marketRegime: string;
  errors: string[];
  closedPositions: ClosedPos[];
  totalRealizedPnl: number | null;
}

const EMPTY_DATA: DashboardData = {
  portfolioAnalyses: [],
  concentration: null,
  stockOpportunities: [],
  etfOpportunities: [],
  discoveredOpportunities: [],
  allocationRecommendations: [],
  alerts: [],
  lastRunAt: null,
  marketRegime: 'neutral',
  errors: [],
  closedPositions: [],
  totalRealizedPnl: null,
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('portfolio');
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [engineRes, alertsRes] = await Promise.all([
        fetch('/api/engine/run'),
        fetch('/api/alerts?limit=50'),
      ]);

      const engineData = engineRes.ok ? await engineRes.json() : null;
      const alertsData = alertsRes.ok ? await alertsRes.json() : { alerts: [] };

      if (engineData && engineData.runAt) {
        setData({
          portfolioAnalyses: engineData.portfolioAnalyses ?? [],
          concentration: engineData.concentration ?? null,
          stockOpportunities: engineData.stockOpportunities ?? [],
          etfOpportunities: engineData.etfOpportunities ?? [],
          discoveredOpportunities: engineData.discoveredOpportunities ?? [],
          allocationRecommendations: engineData.allocationRecommendations ?? [],
          alerts: alertsData.alerts ?? [],
          lastRunAt: engineData.runAt,
          marketRegime: engineData.marketRegime ?? 'neutral',
          errors: engineData.errors ?? [],
          closedPositions: engineData.closedPositions ?? [],
          totalRealizedPnl: engineData.totalRealizedPnl ?? null,
        });
      } else {
        setData({ ...EMPTY_DATA, alerts: alertsData.alerts ?? [] });
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRunEngine = async () => {
    setIsRunning(true);
    setStatusMessage('Analizando precios reales... (puede tardar ~30s)');
    const msgTimer = setTimeout(
      () => setStatusMessage('Aún analizando — Yahoo Finance necesita tiempo entre peticiones...'),
      15000
    );
    try {
      const res = await fetch('/api/engine/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendDigest: true, sendAlertMessages: true }),
      });
      const result = await res.json();
      clearTimeout(msgTimer);
      if (result.success) {
        setStatusMessage(`¡Listo! ${result.alertsCount} alertas generadas.`);
        // Use the full data returned by POST directly — no need for a second GET
        if (result.runAt) {
          setData({
            portfolioAnalyses: result.portfolioAnalyses ?? [],
            concentration: result.concentration ?? null,
            stockOpportunities: result.stockOpportunities ?? [],
            etfOpportunities: result.etfOpportunities ?? [],
            discoveredOpportunities: result.discoveredOpportunities ?? [],
            allocationRecommendations: result.allocationRecommendations ?? [],
            alerts: data.alerts,
            lastRunAt: result.runAt,
            marketRegime: result.marketRegime ?? 'neutral',
            errors: result.errors ?? [],
            closedPositions: result.closedPositions ?? [],
            totalRealizedPnl: result.totalRealizedPnl ?? null,
          });
        }
        // Also refresh alerts separately
        fetch('/api/alerts?limit=50')
          .then(r => r.ok ? r.json() : { alerts: [] })
          .then(a => setData(prev => ({ ...prev, alerts: a.alerts ?? [] })));
      } else {
        setStatusMessage(`Error: ${result.error ?? 'fallo al analizar'}`);
      }
    } catch (err) {
      clearTimeout(msgTimer);
      setStatusMessage('Error de red — intenta de nuevo en 30 segundos');
    } finally {
      setIsRunning(false);
      setTimeout(() => setStatusMessage(''), 5000);
    }
  };

  const priceProvider = process.env.NEXT_PUBLIC_PRICE_PROVIDER ?? 'mock';

  return (
    <div className="min-h-screen bg-[#0f1117]">
      {/* Header */}
      <header className="border-b border-[#2a3445] bg-[#161b27] sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-slate-200">App Finanzas</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              data.marketRegime === 'bullish' ? 'bg-green-900/60 text-green-400' :
              data.marketRegime === 'bearish' ? 'bg-red-900/60 text-red-400' :
              'bg-slate-700 text-slate-400'
            }`}>
              {data.marketRegime.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {statusMessage && (
              <span className="text-xs text-yellow-400 animate-pulse">{statusMessage}</span>
            )}
            {data.errors.length > 0 && (
              <span className="text-xs text-red-400">{data.errors.length} error(s)</span>
            )}
            {data.lastRunAt && (
              <span className="text-xs text-slate-500 hidden sm:block">
                Último análisis: {new Date(data.lastRunAt).toLocaleString('es-ES')}
              </span>
            )}
            <GlossaryButton />
            <button
              onClick={handleRunEngine}
              disabled={isRunning}
              className={`text-xs px-3 py-1.5 rounded font-medium transition-all ${
                isRunning
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : 'bg-green-700 hover:bg-green-600 text-white cursor-pointer'
              }`}
            >
              {isRunning ? 'Analizando...' : '▶ Analizar'}
            </button>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="max-w-screen-2xl mx-auto px-4 flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab.label}
              {tab.id === 'opportunities' && (data.stockOpportunities.filter(o => o.state === 'BUY').length + data.etfOpportunities.filter(o => o.state === 'BUY').length) > 0 && (
                <span className="ml-1.5 bg-green-700 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {data.stockOpportunities.filter(o => o.state === 'BUY').length + data.etfOpportunities.filter(o => o.state === 'BUY').length}
                </span>
              )}
              {tab.id === 'alerts' && data.alerts.filter(a => !a.telegramSent && a.type !== 'daily_digest').length > 0 && (
                <span className="ml-1.5 bg-yellow-700 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {data.alerts.filter(a => !a.telegramSent && a.type !== 'daily_digest').length}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-screen-2xl mx-auto px-4 py-6">

        {/* Tab description */}
        {{
          portfolio:      { icon: '📊', text: 'Todo lo que tienes invertido ahora mismo, cuánto vale, cuánto ganaste o perdiste en papel, y qué recomienda el motor para cada posición.' },
          opportunities:  { icon: '🔍', text: 'Acciones y ETFs que el motor vigila y que ahora están en buen momento para comprar por primera vez (o añadir si ya los tienes). Ordenadas por puntuación.' },
          cash:           { icon: '💰', text: '¿Tienes efectivo y no sabes en qué ponerlo? El motor te dice exactamente en qué invertir y en qué orden, dependiendo de cuánto tengas disponible.' },
          concentration:  { icon: '⚖️', text: '¿Estás demasiado concentrada en un sector? Aquí ves si tu cartera está equilibrada o si tienes demasiado en tecnología/IA/semiconductores.' },
          discovery:      { icon: '🌐', text: 'El motor escanea un universo más amplio de empresas que no tienes todavía. Si encuentra algo interesante con buen precio, aparece aquí con ISIN para que lo busques en Trade Republic.' },
          alerts:         { icon: '🔔', text: 'Historial de avisos automáticos. Una alerta se genera cuando una posición cambia de estado (ej: pasa de ESPERAR a COMPRAR). Si configuras Telegram, te llega al móvil.' },
          settings:       { icon: '⚙️', text: 'Actualiza tu cartera importando el CSV de Trade Republic, ejecuta el análisis manualmente, y ve el estado del sistema.' },
        }[activeTab] && (
          <div className="mb-4 flex items-start gap-2 text-xs text-slate-500 bg-[#161b27] border border-[#2a3445]/40 rounded-lg px-3 py-2">
            <span className="text-base shrink-0">
              {({ portfolio: '📊', opportunities: '🔍', cash: '💰', concentration: '⚖️', discovery: '🌐', alerts: '🔔', settings: '⚙️' } as Record<string,string>)[activeTab]}
            </span>
            <span>
              {({ portfolio: 'Todo lo que tienes invertido ahora mismo, cuánto vale, cuánto ganaste o perdiste en papel, y qué recomienda el motor para cada posición.', opportunities: 'Acciones y ETFs que el motor vigila y que ahora están en buen momento para comprar por primera vez. El motor puntúa cada una del 0 al 10 y ordena las mejores oportunidades arriba.', cash: '¿Tienes efectivo y no sabes en qué ponerlo? El motor te dice exactamente en qué invertir y en qué orden dependiendo de cuánto tengas disponible.', concentration: '¿Estás demasiado concentrada en un sector? Aquí ves si tu cartera está equilibrada o si tienes demasiado en tecnología, IA o semiconductores, y qué hacer.', discovery: 'El motor escanea un universo más amplio de empresas que no tienes todavía. Si encuentra algo interesante con buen precio y buenas métricas, aparece aquí con ISIN para buscarlo en Trade Republic.', alerts: 'Historial de avisos automáticos del motor. Una alerta se genera cuando una posición cambia de estado (ej: ESPERAR → COMPRAR). Con Telegram configurado, te llega al móvil al instante.', settings: 'Actualiza tu cartera importando el CSV de Trade Republic, ejecuta el análisis manualmente y ve el estado del sistema.' } as Record<string,string>)[activeTab]}
            </span>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="text-slate-500 text-lg mb-2">Cargando...</div>
              <div className="text-slate-600 text-sm">
                {data.lastRunAt ? 'Obteniendo datos del análisis' : 'Sin datos todavía — pulsa "▶ Analizar" para empezar'}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* No data state */}
            {!data.lastRunAt && activeTab !== 'settings' && (
              <div className="mb-6 bg-blue-900/20 border border-blue-800/50 rounded-lg px-4 py-3">
                <div className="text-sm text-blue-300 font-medium">Sin datos de análisis</div>
                <div className="text-xs text-blue-400 mt-1">
                  Pulsa <strong>▶ Analizar</strong> (arriba a la derecha) para obtener precios y generar tu primer análisis.
                  En modo MOCK no hace falta internet — para precios reales añade <code>PRICE_PROVIDER=yahoo</code> en .env.local.
                </div>
              </div>
            )}

            {/* Errors */}
            {data.errors.length > 0 && (
              <div className="mb-4 space-y-1">
                {data.errors.slice(0, 3).map((e, i) => (
                  <div key={i} className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">
                    ⚠ {e}
                  </div>
                ))}
              </div>
            )}

            {/* Tab content */}
            {activeTab === 'portfolio' && (
              <div className="space-y-6">
                <PortfolioOverview
                  analyses={data.portfolioAnalyses}
                  concentration={data.concentration}
                  lastRunAt={data.lastRunAt}
                  closedPositions={data.closedPositions}
                  totalRealizedPnl={data.totalRealizedPnl}
                />
                <TopAddOpportunities analyses={data.portfolioAnalyses} />
              </div>
            )}

            {activeTab === 'opportunities' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <StockOpportunities opportunities={data.stockOpportunities} />
                <EtfOpportunities opportunities={data.etfOpportunities} />
              </div>
            )}

            {activeTab === 'cash' && (
              <BestUseOfCash recommendations={data.allocationRecommendations} />
            )}

            {activeTab === 'concentration' && (
              <ConcentrationBalance concentration={data.concentration} />
            )}

            {activeTab === 'discovery' && (
              <DiscoveryMonitor opportunities={data.discoveredOpportunities} />
            )}

            {activeTab === 'alerts' && (
              <AlertsHistory alerts={data.alerts} />
            )}

            {activeTab === 'settings' && (
              <Settings
                onRunEngine={handleRunEngine}
                isRunning={isRunning}
                lastRunAt={data.lastRunAt}
                providerName={priceProvider}
                marketRegime={data.marketRegime}
                isTelegramConfigured={false}
                onImportDone={fetchData}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
