import { NextRequest, NextResponse } from 'next/server';
import { parseTradeRepublicCsv } from '@/lib/portfolio/csv-importer';
import type { PortfolioConfig, PortfolioHolding } from '@/lib/types';
import type { ComputedHolding } from '@/lib/portfolio/csv-importer';

const ISIN_TO_TICKER: Record<string, { ticker: string; name?: string; currency: string; type: 'stock' | 'etf'; tags: string[] }> = {
  'US67066G1040': { ticker: 'NVDA',  currency: 'USD', type: 'stock', tags: ['semis', 'AI', 'growth', 'tech'] },
  'NL0010273215': { ticker: 'ASML',  currency: 'EUR', type: 'stock', tags: ['semis', 'infrastructure', 'europe'] },
  'US5949181045': { ticker: 'MSFT',  currency: 'USD', type: 'stock', tags: ['software', 'AI', 'cloud', 'tech'] },
  'US0231351067': { ticker: 'AMZN',  currency: 'USD', type: 'stock', tags: ['cloud', 'ecommerce', 'AI'] },
  'US86800U3023': { ticker: 'SMCI',  currency: 'USD', type: 'stock', tags: ['semis', 'AI', 'infrastructure', 'tech'] },
  'US79466L3024': { ticker: 'CRM',   currency: 'USD', type: 'stock', tags: ['software', 'AI', 'cloud', 'tech'] },
  'US81762P1021': { ticker: 'NOW',   currency: 'USD', type: 'stock', tags: ['software', 'AI', 'enterprise', 'tech'] },
  'US00724F1012': { ticker: 'ADBE',  currency: 'USD', type: 'stock', tags: ['software', 'AI', 'creative', 'tech'] },
  'US68389X1054': { ticker: 'ORCL',  currency: 'USD', type: 'stock', tags: ['cloud', 'software', 'AI', 'tech'] },
  'US88160R1014': { ticker: 'TSLA',  currency: 'USD', type: 'stock', tags: ['EV', 'AI', 'growth', 'tech'] },
  'US5951121038': { ticker: 'MU',    currency: 'USD', type: 'stock', tags: ['semis', 'memory', 'AI', 'tech'] },
  'IE00B53SZB19': { ticker: 'CNDX',  name: 'iShares NASDAQ 100 UCITS ETF (Acc)', currency: 'EUR', type: 'etf', tags: ['growth', 'tech', 'nasdaq', 'broad-index'] },
  'IE00BP3QZB59': { ticker: 'IWVL',  name: 'iShares MSCI World Value Factor UCITS ETF (Acc)', currency: 'EUR', type: 'etf', tags: ['value', 'broad-index', 'diversification', 'global'] },
  'IE00B4L5Y983': { ticker: 'IWDA',  name: 'iShares Core MSCI World UCITS ETF (Acc)', currency: 'EUR', type: 'etf', tags: ['broad-index', 'global', 'diversification'] },
  'US02079K3059': { ticker: 'GOOGL', currency: 'USD', type: 'stock', tags: ['tech', 'AI', 'cloud'] },
  'US5765811026': { ticker: 'MRVL',  currency: 'USD', type: 'stock', tags: ['semis', 'AI'] },
  'US34959E1091': { ticker: 'FTNT',  currency: 'USD', type: 'stock', tags: ['cybersecurity'] },
  'US46120E6023': { ticker: 'ISRG',  currency: 'USD', type: 'stock', tags: ['healthcare', 'robotics', 'growth'] },
};

/**
 * Pure function: ISINs in the CSV that have no ticker mapping (neither in
 * ISIN_TO_TICKER nor in the existing config). These holdings would otherwise
 * enter the portfolio with ticker undefined, and the engine would try to
 * price them by ISIN ("No data for US…") — surface them as warnings instead.
 * Exported for unit tests.
 */
export function findUnknownIsins(
  existing: PortfolioConfig,
  computed: ComputedHolding[]
): { isin: string; name: string }[] {
  const existingMap = new Map(existing.holdings.map(h => [(h as any).isin as string, h]));
  return computed
    .filter(c => !ISIN_TO_TICKER[c.isin] && !existingMap.get(c.isin)?.ticker)
    .map(c => ({ isin: c.isin, name: c.name }));
}

/**
 * Pure function: merge CSV-computed open positions with existing portfolio config.
 * Preserves manual fields (convictionScore, dcaMonthlyEur, core, tags, noBuyOverride,
 * manualThesisRisk) from the existing config. Exported for unit tests.
 */
export function buildUpdatedPortfolioConfig(
  existing: PortfolioConfig,
  computed: ComputedHolding[],
  closedPositions: ComputedHolding[]
): PortfolioConfig {
  const existingMap = new Map(existing.holdings.map(h => [(h as any).isin as string, h]));

  const updatedHoldings: PortfolioHolding[] = computed.map((c) => {
    const known = ISIN_TO_TICKER[c.isin];
    const prev = existingMap.get(c.isin);
    return {
      id: prev?.id ?? (known?.ticker?.toLowerCase() ?? c.isin.toLowerCase()),
      name: known?.name ?? prev?.name ?? c.name,
      ticker: known?.ticker ?? prev?.ticker,
      isin: c.isin,
      type: known?.type ?? prev?.type ?? 'stock',
      dcaMonthlyEur: prev?.dcaMonthlyEur ?? 0,
      avgPrice: c.avgCostEur,
      units: c.shares,
      core: prev?.core ?? false,
      convictionScore: prev?.convictionScore ?? 7,
      tags: known?.tags ?? prev?.tags ?? [],
      currency: known?.currency ?? prev?.currency ?? 'USD',
      maxWeightPercent: prev?.maxWeightPercent ?? 10,
      noBuyOverride: prev?.noBuyOverride ?? false,
      manualThesisRisk: prev?.manualThesisRisk ?? 'none',
    } as PortfolioHolding;
  });

  const totalRealizedPnl = closedPositions.reduce((sum, c) => sum + c.realizedPnl, 0);

  return {
    ...existing,
    holdings: updatedHoldings,
    closedPositions: closedPositions.map(c => ({
      isin: c.isin,
      ticker: ISIN_TO_TICKER[c.isin]?.ticker ?? c.isin,
      name: ISIN_TO_TICKER[c.isin]?.name ?? c.name,
      realizedPnl: c.realizedPnl,
    })),
    totalRealizedPnl: Math.round(totalRealizedPnl * 100) / 100,
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('csv') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No CSV file provided' }, { status: 400 });
    }

    const text = await file.text();
    const { open: computed, closed: closedPositions } = parseTradeRepublicCsv(text);

    if (computed.length === 0) {
      return NextResponse.json({
        error: 'No se encontraron posiciones en el CSV. Asegúrate de que es el archivo de transacciones de Trade Republic (no el extracto de cuenta, sino el historial de transacciones).',
      }, { status: 400 });
    }

    const { loadPortfolioConfig, savePortfolioConfig } = await import('@/lib/utils/portfolio-store');
    const { config: existing } = await loadPortfolioConfig();

    // ISINs without a ticker mapping: the engine cannot price these holdings.
    // Fail closed — do NOT persist a portfolio the engine cannot fully analyze.
    // Otherwise a holding without a ticker silently reaches KV and the next
    // engine run reports "No data for <ISIN>". The owner must add the mapping
    // in ISIN_TO_TICKER and re-import. The CSV itself is fine; nothing is saved.
    const unknownIsins = findUnknownIsins(existing, computed);
    if (unknownIsins.length > 0) {
      const warnings = unknownIsins.map(
        u => `ISIN sin ticker conocido: ${u.isin} (${u.name}). Añade el mapping ISIN → ticker en ISIN_TO_TICKER antes de importar.`
      );
      for (const w of warnings) console.warn('[Import]', w);
      return NextResponse.json({
        success: false,
        saved: false,
        error: 'Hay activos que la app no reconoce. Añade el mapping ISIN → ticker antes de importar. La cartera NO se ha actualizado.',
        unknownIsins,
        warnings,
      }, { status: 422 });
    }

    const updated = buildUpdatedPortfolioConfig(existing, computed, closedPositions);

    const { saved, source: saveSource, warning: saveWarning } = await savePortfolioConfig(updated);
    if (saveWarning) console.warn('[Import] Portfolio save warning:', saveWarning);

    return NextResponse.json({
      success: true,
      saved,
      saveSource,
      unknownIsins,
      warnings: [],
      holdingsUpdated: updated.holdings.length,
      totalRealizedPnl: updated.totalRealizedPnl,
      holdings: computed.map(c => ({
        isin: c.isin,
        name: c.name,
        ticker: ISIN_TO_TICKER[c.isin]?.ticker ?? c.isin,
        shares: c.shares,
        avgCostEur: c.avgCostEur,
        totalCostEur: c.totalCostEur,
        realizedPnl: c.realizedPnl,
      })),
      closedPositions: closedPositions.map(c => ({
        isin: c.isin,
        ticker: ISIN_TO_TICKER[c.isin]?.ticker ?? c.isin,
        name: ISIN_TO_TICKER[c.isin]?.name ?? c.name,
        realizedPnl: c.realizedPnl,
      })),
    });
  } catch (err) {
    console.error('CSV import error:', err);
    return NextResponse.json({ error: 'Error procesando el CSV: ' + String(err) }, { status: 500 });
  }
}
