import { NextRequest, NextResponse } from 'next/server';
import { parseTradeRepublicCsv } from '@/lib/portfolio/csv-importer';
import { readJsonFile, writeJsonFile } from '@/lib/utils/file-store';
import type { PortfolioConfig, PortfolioHolding } from '@/lib/types';

// Known ticker map by ISIN (for display purposes)
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
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('csv') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No CSV file provided' }, { status: 400 });
    }

    const text = await file.text();
    const computed = parseTradeRepublicCsv(text);

    if (computed.length === 0) {
      return NextResponse.json({ error: 'No se encontraron posiciones en el CSV. Asegúrate de que es el archivo de transacciones de Trade Republic.' }, { status: 400 });
    }

    // Load existing portfolio config to preserve DCA, conviction, etc.
    const existing = readJsonFile<PortfolioConfig>('../../config/portfolio.json', {
      cashAvailableEur: 2000,
      targetCashReserveEur: 500,
      holdings: [],
    });

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

    const updated: PortfolioConfig = {
      ...existing,
      holdings: updatedHoldings,
    };

    writeJsonFile('../../config/portfolio.json', updated);

    return NextResponse.json({
      success: true,
      holdingsUpdated: updatedHoldings.length,
      holdings: computed.map(c => ({
        isin: c.isin,
        name: c.name,
        ticker: ISIN_TO_TICKER[c.isin]?.ticker ?? c.isin,
        shares: c.shares,
        avgCostEur: c.avgCostEur,
        totalCostEur: c.totalCostEur,
        realizedPnl: c.realizedPnl,
      })),
    });
  } catch (err) {
    console.error('CSV import error:', err);
    return NextResponse.json({ error: 'Error procesando el CSV: ' + String(err) }, { status: 500 });
  }
}
