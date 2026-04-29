'use client';

import type { PortfolioState, OpportunityState, AllocationState, AssetType, Confidence } from '@/lib/types';

type AnyState = PortfolioState | OpportunityState | AllocationState | string;

export const STATE_DESCRIPTIONS: Record<string, { es: string; explain: string }> = {
  // Portfolio states
  BUY_MORE:        { es: 'COMPRAR FUERTE',   explain: 'El precio está muy por debajo de su máximo histórico. Excelente momento para añadir una cantidad significativa.' },
  BUY_PARTIAL:     { es: 'COMPRAR',          explain: 'Buena oportunidad de compra. El precio ha bajado lo suficiente para añadir una cantidad moderada.' },
  BUY_SMALL:       { es: 'COMPRAR POCO',     explain: 'Oportunidad moderada. Puedes añadir una cantidad pequeña si tienes liquidez disponible.' },
  WAIT:            { es: 'ESPERAR',          explain: 'No es el momento ideal. El precio está cerca de máximos o no hay señal clara. Espera a mejor entrada.' },
  DO_NOTHING:      { es: 'MANTENER',         explain: 'Todo en orden. La posición está bien, no hace falta comprar ni vender nada ahora.' },
  REVIEW:          { es: 'REVISAR',          explain: 'Algo ha cambiado en esta posición. Revisa la tesis de inversión antes de tomar decisiones.' },
  REDUCE:          { es: 'REDUCIR',          explain: 'Considera vender una parte. La posición puede estar sobredimensionada o la tesis ha cambiado.' },
  // Opportunity states
  BUY:             { es: 'COMPRAR',          explain: 'Señal fuerte de entrada. El precio es muy atractivo y el activo supera todos los filtros de calidad.' },
  READY_TO_BUY:    { es: 'CASI LISTO',       explain: 'El precio está casi en zona de compra pero no del todo. No compres todavía — espera a que baje un poco más y el motor cambie a COMPRAR. Actúa cuando veas COMPRAR, no antes.' },
  WATCH:           { es: 'VIGILAR',          explain: 'Este activo es interesante pero el precio aún no es lo suficientemente atractivo. El motor lo está vigilando por ti. Cuando el precio caiga lo suficiente, el estado cambiará automáticamente a COMPRAR.' },
  HOLD:            { es: 'MANTENER',         explain: 'Posición abierta. No hay señal de compra adicional ni de venta. Deja que trabaje.' },
  REVIEW_FOR_TRIM: { es: '¿REDUCIR?',        explain: 'La posición puede estar cerca de objetivo o sobrecomprada. Valora si vender una parte para recoger beneficios.' },
  EXIT:            { es: 'SALIR',            explain: 'Señal de venta. El activo ha perdido su tesis o hay mejores oportunidades donde mover el capital.' },
  AVOID:           { es: 'EVITAR',           explain: 'No recomendado ahora. No cumple los criterios de calidad o el momento técnico no es favorable.' },
  // Allocation states
  BEST_USE_OF_CASH: { es: 'MEJOR OPCIÓN',   explain: 'De todas las opciones disponibles, esta es la mejor forma de invertir tu liquidez ahora mismo.' },
  SECOND_BEST:     { es: '2ª OPCIÓN',        explain: 'Segunda mejor opción. Buena alternativa si ya compraste la primera o quieres diversificar.' },
  HOLD_CASH:       { es: 'GUARDAR EFECTIVO', explain: 'No hay oportunidades claras ahora. Mejor mantener la liquidez y esperar mejor momento de entrada.' },
};

const STATE_CONFIG: Record<string, { label: string; color: string }> = {
  BUY_MORE:         { label: 'COMPRAR FUERTE', color: 'bg-green-500 text-black font-semibold' },
  BUY_PARTIAL:      { label: 'COMPRAR',        color: 'bg-green-400 text-black font-semibold' },
  BUY_SMALL:        { label: 'COMPRAR POCO',   color: 'bg-emerald-600 text-white' },
  WAIT:             { label: 'ESPERAR',         color: 'bg-yellow-600 text-white' },
  DO_NOTHING:       { label: 'MANTENER',        color: 'bg-slate-600 text-slate-200' },
  REVIEW:           { label: 'REVISAR',         color: 'bg-orange-500 text-white' },
  REDUCE:           { label: 'REDUCIR',         color: 'bg-red-600 text-white' },
  BUY:              { label: 'COMPRAR',         color: 'bg-green-500 text-black font-semibold' },
  READY_TO_BUY:     { label: 'CASI LISTO',      color: 'bg-emerald-600 text-white' },
  WATCH:            { label: 'VIGILAR',         color: 'bg-blue-700 text-white' },
  HOLD:             { label: 'MANTENER',        color: 'bg-slate-600 text-slate-200' },
  REVIEW_FOR_TRIM:  { label: '¿REDUCIR?',       color: 'bg-orange-600 text-white' },
  EXIT:             { label: 'SALIR',           color: 'bg-red-700 text-white' },
  AVOID:            { label: 'EVITAR',          color: 'bg-red-900 text-slate-300' },
  BEST_USE_OF_CASH: { label: 'MEJOR OPCIÓN',   color: 'bg-green-500 text-black font-semibold' },
  SECOND_BEST:      { label: '2ª OPCIÓN',       color: 'bg-blue-600 text-white' },
  HOLD_CASH:        { label: 'GUARDAR CASH',    color: 'bg-slate-600 text-slate-200' },
};

export function StateBadge({ state, showTooltip = false }: { state: AnyState; showTooltip?: boolean }) {
  const config = STATE_CONFIG[state] ?? { label: state, color: 'bg-slate-700 text-slate-300' };
  const desc = STATE_DESCRIPTIONS[state];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs tracking-wide ${config.color} ${showTooltip && desc ? 'cursor-help' : ''}`}
      title={showTooltip && desc ? desc.explain : undefined}
    >
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
      {isEtf ? 'ETF' : 'ACCIÓN'}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence | string }) {
  const labels: Record<string, string> = {
    high: 'Alta confianza',
    medium: 'Confianza media',
    low: 'Baja confianza',
  };
  const colors: Record<string, string> = {
    high: 'text-green-400',
    medium: 'text-yellow-400',
    low: 'text-slate-400',
  };
  return (
    <span className={`text-xs ${colors[confidence] ?? 'text-slate-400'}`} title="Indica qué tan segura está la app de su recomendación, basado en la cantidad y calidad de datos disponibles.">
      {labels[confidence] ?? confidence.toUpperCase()}
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
    <div className="flex items-center gap-2" title={`Puntuación de oportunidad: ${score.toFixed(1)}/10. Combina calidad del activo, caída desde máximos, tendencia y encaje en tu cartera.`}>
      <div className="flex-1 h-1.5 rounded-full bg-slate-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-6 text-right">{score.toFixed(1)}</span>
    </div>
  );
}
