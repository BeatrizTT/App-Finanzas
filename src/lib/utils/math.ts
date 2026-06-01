// Math and calculation utilities for engine logic

export function calcDrawdownPct(high: number, current: number): number {
  if (high <= 0) return 0;
  return Math.max(0, ((high - current) / high) * 100);
}

export function calcPnlPct(avgPrice: number, currentPrice: number): number {
  if (avgPrice <= 0 || currentPrice <= 0) return 0;
  return ((currentPrice - avgPrice) / avgPrice) * 100;
}

export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function weightedAverage(values: number[], weights: number[]): number {
  if (values.length !== weights.length || values.length === 0) return 0;
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return 0;
  const sum = values.reduce((s, v, i) => s + v * weights[i], 0);
  return sum / totalWeight;
}

export function pctOfTotal(value: number, total: number): number {
  if (total <= 0) return 0;
  return (value / total) * 100;
}

/** Normalize a score from one range to 0-10 */
export function normalizeScore(value: number, min: number, max: number): number {
  if (max === min) return 5;
  return clamp(((value - min) / (max - min)) * 10, 0, 10);
}

/** Score a drawdown according to the configured scoring bands */
export function scoreDrawdown(drawdownPct: number, drawdownScoring: Record<string, number>): number {
  if (drawdownPct < 5) return drawdownScoring['0_5'] ?? 2;
  if (drawdownPct < 10) return drawdownScoring['5_10'] ?? 4;
  if (drawdownPct < 15) return drawdownScoring['10_15'] ?? 7;
  if (drawdownPct < 25) return drawdownScoring['15_25'] ?? 9;
  if (drawdownPct < 40) return drawdownScoring['25_40'] ?? 8;
  return drawdownScoring['40_plus'] ?? 4;
}

export function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-EU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPct(value: number, decimals = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}
