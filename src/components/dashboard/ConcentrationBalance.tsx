'use client';

import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import type { ConcentrationData } from '@/lib/types';

const THEME_LABELS: Record<string, string> = {
  semis: 'Semiconductores',
  AI: 'Inteligencia Artificial',
  tech: 'Tecnología (total)',
  growth: 'Crecimiento',
  value: 'Valor',
  software: 'Software',
  'broad-index': 'Índice global',
  diversification: 'Diversificación',
  cloud: 'Cloud',
  ecommerce: 'E-commerce',
  infrastructure: 'Infraestructura',
  europe: 'Europa',
  nasdaq: 'NASDAQ',
  global: 'Global',
  memory: 'Memoria',
  EV: 'Vehículo eléctrico',
  cybersecurity: 'Ciberseguridad',
  enterprise: 'Enterprise',
  creative: 'Creativo',
};

const LIMITS: Record<string, number> = { semis: 35, AI: 50, tech: 65 };

interface Props {
  concentration: ConcentrationData | null;
}

function WeightBar({ label, value, limit, color }: { label: string; value: number; limit?: number; color: string }) {
  const isOver = limit != null && value > limit;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          {limit != null && <span className="text-slate-600">máx. {limit}%</span>}
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
        <div className="text-xs text-red-400">⚠ {(value - limit!).toFixed(1)}% por encima del límite</div>
      )}
    </div>
  );
}

export function ConcentrationBalance({ concentration }: Props) {
  if (!concentration) {
    return (
      <Card>
        <CardHeader><CardTitle>Balance de tu cartera</CardTitle></CardHeader>
        <CardBody>
          <p className="text-slate-500 text-sm">Sin datos todavía. Pulsa "▶ Analizar" primero.</p>
        </CardBody>
      </Card>
    );
  }

  const { stocks, etfs } = concentration.stockVsEtfRatio;
  const themes = Object.entries(concentration.themeWeights)
    .filter(([k]) => !k.startsWith('asset:'))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  const themeColors: Record<string, string> = {
    semis: 'bg-purple-500', AI: 'bg-blue-500', tech: 'bg-cyan-500',
    growth: 'bg-green-500', value: 'bg-yellow-500', software: 'bg-indigo-500',
    'broad-index': 'bg-teal-500', diversification: 'bg-emerald-500',
  };

  // Compute verdict
  const warnings = concentration.highConcentrationWarnings;
  const overLimits = themes.filter(([tag, w]) => LIMITS[tag] && w > LIMITS[tag]);
  const tooManyStocks = stocks > 80;
  const isHealthy = warnings.length === 0 && overLimits.length === 0 && !tooManyStocks;

  // Build actionable advice
  const advice: { text: string; type: 'warn' | 'ok' | 'tip' }[] = [];

  if (tooManyStocks) {
    advice.push({ type: 'warn', text: `Tienes un ${stocks.toFixed(0)}% en acciones individuales y solo un ${etfs.toFixed(0)}% en ETFs. Los ETFs dan más seguridad — considera añadir más al NASDAQ100 (CNDX) o al MSCI World (IWVL).` });
  } else if (etfs < 15) {
    advice.push({ type: 'tip', text: `Poca exposición a ETFs (${etfs.toFixed(0)}%). Los ETFs diversifican automáticamente. Si algo va mal en una empresa concreta, los ETFs te protegen.` });
  } else {
    advice.push({ type: 'ok', text: `Buena mezcla: ${stocks.toFixed(0)}% en acciones y ${etfs.toFixed(0)}% en ETFs. Los ETFs actúan como red de seguridad.` });
  }

  const semiW = concentration.themeWeights['semis'] ?? 0;
  const aiW = concentration.themeWeights['AI'] ?? 0;
  const techW = concentration.themeWeights['tech'] ?? 0;

  if (semiW > 35) {
    advice.push({ type: 'warn', text: `Semiconductores al ${semiW.toFixed(0)}% (límite: 35%). No añadas más NVDA, ASML, SMCI ni MU hasta que baje este porcentaje.` });
  }
  if (aiW > 50) {
    advice.push({ type: 'warn', text: `IA al ${aiW.toFixed(0)}% (límite: 50%). Toda tu cartera depende mucho de que la IA siga creciendo. Diversifica en otras temáticas.` });
  }
  if (techW > 65) {
    advice.push({ type: 'warn', text: `Tecnología total al ${techW.toFixed(0)}% (límite: 65%). Si el sector tech cae, toda tu cartera sufrirá. Considera Value ETF (IWVL) para compensar.` });
  }
  if (semiW <= 35 && aiW <= 50 && techW <= 65) {
    advice.push({ type: 'ok', text: `Todas las temáticas están dentro de los límites recomendados. Buen trabajo.` });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balance de tu cartera</CardTitle>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
          isHealthy ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'
        }`}>
          {isHealthy ? '✓ Bien equilibrada' : '⚠ Necesita atención'}
        </span>
      </CardHeader>
      <CardBody>
        {/* Plain-language verdict */}
        <div className="mb-5 space-y-2">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">¿Cómo estás?</div>
          {advice.map((a, i) => (
            <div key={i} className={`text-sm rounded-lg px-3 py-2 border ${
              a.type === 'warn' ? 'bg-yellow-900/20 border-yellow-800/40 text-yellow-300' :
              a.type === 'ok'   ? 'bg-green-900/15 border-green-800/30 text-green-400' :
                                  'bg-blue-900/20 border-blue-800/40 text-blue-300'
            }`}>
              {a.type === 'warn' ? '⚠ ' : a.type === 'ok' ? '✓ ' : '💡 '}{a.text}
            </div>
          ))}
        </div>

        {/* Warnings from engine */}
        {warnings.length > 0 && (
          <div className="mb-4 space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="text-xs text-orange-300 bg-orange-900/20 border border-orange-800/50 rounded px-3 py-2">
                ⚠ {w}
              </div>
            ))}
          </div>
        )}

        {/* Acciones vs ETFs */}
        <div className="mb-4">
          <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Acciones individuales vs ETFs</div>
          <p className="text-xs text-slate-600 mb-2">Las acciones individuales tienen más potencial pero más riesgo. Los ETFs son más seguros pero crecen más despacio. Lo ideal: entre 50-80% acciones y 20-50% ETFs.</p>
          <div className="space-y-2">
            <WeightBar label="Acciones individuales" value={stocks} color="bg-purple-500" />
            <WeightBar label="ETFs" value={etfs} color="bg-blue-500" />
          </div>
        </div>

        {/* Temáticas */}
        <div>
          <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Concentración por temática</div>
          <p className="text-xs text-slate-600 mb-2">Si una temática pesa demasiado, cuando ese sector cae, toda tu cartera sufre. Los límites son: semiconductores máx. 35%, IA máx. 50%, tecnología total máx. 65%.</p>
          <div className="space-y-2">
            {themes.map(([tag, weight]) => (
              <WeightBar
                key={tag}
                label={THEME_LABELS[tag] ?? tag}
                value={weight}
                limit={LIMITS[tag]}
                color={themeColors[tag] ?? 'bg-slate-500'}
              />
            ))}
          </div>
        </div>

        {concentration.totalPortfolioValue > 0 && (
          <div className="mt-4 pt-3 border-t border-[#2a3445] text-xs text-slate-500">
            Valor estimado de la cartera: €{concentration.totalPortfolioValue.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
