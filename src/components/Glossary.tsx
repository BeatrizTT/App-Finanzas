'use client';

import { useState } from 'react';

const TERMS = [
  {
    term: 'ISIN',
    def: 'Código de 12 caracteres que identifica de forma única un activo en todo el mundo. En Trade Republic, búscalo en la pantalla del activo o en tu extracto. Si el motor te recomienda comprar NVDA, el ISIN US67066G1040 garantiza que compras exactamente esa acción, no otra con nombre parecido.',
  },
  {
    term: 'Precio medio (Avg)',
    def: 'La media ponderada de todos los precios a los que has comprado un activo. Si compraste 1 acción a 100€ y después otra a 120€, tu precio medio es 110€. El motor lo usa para calcular tu ganancia/pérdida actual.',
  },
  {
    term: 'G/P % (Ganancia/Pérdida)',
    def: 'La diferencia entre el precio actual y tu precio medio de compra, en porcentaje. Si compraste a 100€ y ahora vale 115€, tienes un +15%. Es "no realizada" porque no has vendido — si vendes, se convierte en real y tributa.',
  },
  {
    term: 'Drawdown (Caída desde máximos)',
    def: 'Cuánto ha caído el precio desde su máximo reciente. Si una acción llegó a 200€ y ahora está a 150€, tiene un drawdown del -25%. A mayor caída, mayor oportunidad de comprar barato — aunque también puede indicar que algo ha ido mal en la empresa.',
  },
  {
    term: '30d / 60d / 90d',
    def: 'Los tres valores de drawdown miden la caída desde el máximo de los últimos 30, 60 y 90 días respectivamente. Ver los tres juntos da contexto: si cayó mucho en 30 días pero poco en 90, es una caída reciente. Si cayó mucho en los 90 días, lleva tiempo bajando.',
  },
  {
    term: 'DCA (Dollar-Cost Averaging)',
    def: 'Estrategia de invertir una cantidad fija cada mes, independientemente del precio. Si el precio baja, compras más acciones con el mismo dinero. Si sube, compras menos. A largo plazo, suaviza el efecto de comprar en el momento equivocado. Tu plan: NVDA €128/mes, ASML €128/mes, NASDAQ100 €500/mes, Value €170/mes.',
  },
  {
    term: 'ETF',
    def: 'Fondo de inversión que cotiza en bolsa como una acción. En lugar de comprar una empresa, compras un "cesto" de muchas. Tu NASDAQ100 contiene las 100 mayores tecnológicas americanas. Tu Value ETF contiene empresas infravaloradas de todo el mundo. Son la forma más sencilla de diversificar.',
  },
  {
    term: 'Acumulación vs Distribución',
    def: 'Los ETFs pueden ser "Acc" (acumulación) o "Dist" (distribución). Los tuyos son Acc: los dividendos se reinvierten automáticamente, sin que tengas que pagar impuestos hasta que vendas. Para inversores en España que no necesitan los dividendos ahora, los Acc suelen ser más eficientes fiscalmente.',
  },
  {
    term: 'Puntuación de oportunidad (Score)',
    def: 'Un número del 0 al 10 que resume el atractivo de un activo en este momento. Combina 9 factores: calidad de la empresa, caída desde máximos, tendencia de precio, fuerza relativa, diversificación, encaje sectorial, riesgo/beneficio, encaje en tu cartera y régimen de mercado. Por encima de 7.5 es señal de COMPRAR.',
  },
  {
    term: 'Confianza (Alta / Media / Baja)',
    def: 'Indica qué tan seguro está el motor de su recomendación. Alta = muchos datos coinciden y la señal es clara. Media = buena señal pero con alguna incertidumbre. Baja = poca información disponible o señales contradictorias. A menor confianza, mejor esperar o invertir menos.',
  },
  {
    term: 'COMPRAR FUERTE / BUY_MORE',
    def: 'La acción o ETF ha caído más del 15-20% desde sus máximos recientes. Es el mejor momento para añadir según el motor. Aplica a posiciones que ya tienes — no es una recomendación de nueva entrada.',
  },
  {
    term: 'COMPRAR / BUY_PARTIAL',
    def: 'El precio ha bajado entre el 8-15% desde máximos. Buena oportunidad moderada. Añade una cantidad entre €150-€500 según tu liquidez disponible.',
  },
  {
    term: 'COMPRAR POCO / BUY_SMALL',
    def: 'Caída moderada del 5-8%. Oportunidad menor — puedes añadir algo si tienes liquidez de sobra, pero no es urgente. Típicamente €50-€150.',
  },
  {
    term: 'ESPERAR / WAIT',
    def: 'El precio está cerca de sus máximos o la señal no es clara. No es mal momento para mantener lo que tienes, pero no el mejor para comprar más. Espera a que el precio baje más para tener mejor margen.',
  },
  {
    term: 'MANTENER / DO_NOTHING',
    def: 'Tu posición está en orden. No hay nada que hacer ahora. Es la señal más frecuente en mercados alcistas — tus inversiones están trabajando solas.',
  },
  {
    term: 'REVISAR / REVIEW',
    def: 'Algo ha cambiado: puede ser que el sector esté bajo presión, que la empresa haya publicado malos resultados, o que tu peso en ese activo sea muy alto. No significa vender necesariamente — significa revisar si tu tesis sigue en pie.',
  },
  {
    term: 'Capital Allocator (Asignador de capital)',
    def: 'El motor que responde a la pregunta: "tengo €X disponibles, ¿en qué lo invierto?". Compara todas las oportunidades activas y te muestra el orden de prioridad para desplegar tu liquidez. Tiene en cuenta el estado de tu cartera, las nuevas oportunidades y los límites de concentración.',
  },
  {
    term: 'Concentración',
    def: 'Qué porcentaje de tu cartera está en un solo activo, sector o temática. Si el 40% está en semiconductores y todos bajan a la vez, el impacto es grande. El motor avisa si superas los límites recomendados: máx 35% en semis, 50% en IA, 65% en tech en general.',
  },
  {
    term: 'Tesis de inversión',
    def: 'El razonamiento por el que crees que un activo va a subir a largo plazo. Por ejemplo: "NVDA porque la IA necesita GPUs y tienen ventaja tecnológica". El motor tiene en cuenta si la tesis de un activo está "en riesgo" (medium/high) para ser más conservador con las recomendaciones de compra.',
  },
];

export function GlossaryButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors border border-slate-700 hover:border-slate-500 px-2.5 py-1 rounded"
      >
        📖 Glosario
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-[#161b27] border border-[#2a3445] rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a3445]">
              <h2 className="text-slate-200 font-semibold">📖 Glosario de términos</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-slate-300 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-5">
              {TERMS.map(({ term, def }) => (
                <div key={term}>
                  <dt className="text-sm font-semibold text-blue-400 mb-1">{term}</dt>
                  <dd className="text-sm text-slate-400 leading-relaxed">{def}</dd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
