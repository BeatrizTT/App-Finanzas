// Trade Republic CSV transaction importer
// Parses the exported CSV and computes current holdings (shares + avg cost)

export interface TradeRepublicRow {
  datetime: string;
  date: string;
  category: string;
  type: string;
  asset_class: string;
  name: string;
  symbol: string; // ISIN
  shares: string;
  price: string;
  amount: string;
  fee: string;
  currency: string;
}

export interface ComputedHolding {
  isin: string;
  name: string;
  assetClass: string;
  shares: number;
  totalCostEur: number;
  avgCostEur: number;
  realizedPnl: number;
}

function parseNum(s: string): number {
  if (!s || s.trim() === '') return 0;
  return parseFloat(s.replace(',', '.')) || 0;
}

export function parseTradeRepublicCsv(csvText: string): ComputedHolding[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header — handle quoted fields
  const header = parseCsvLine(lines[0]);
  const idxOf = (name: string) => header.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

  const iDate = idxOf('date');
  const iType = idxOf('type');
  const iAsset = idxOf('asset_class');
  const iName = idxOf('name');
  const iSymbol = idxOf('symbol');
  const iShares = idxOf('shares');
  const iPrice = idxOf('price');
  const iAmount = idxOf('amount');
  const iFee = idxOf('fee');

  // Per-ISIN state: shares held and cost basis (FIFO approximation via weighted avg)
  const holdings = new Map<string, { name: string; assetClass: string; shares: number; totalCost: number; realizedPnl: number }>();

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cols = parseCsvLine(raw);

    const type = cols[iType]?.trim().toUpperCase();
    const assetClass = cols[iAsset]?.trim().toUpperCase();
    const name = cols[iName]?.trim() || '';
    const isin = cols[iSymbol]?.trim() || '';
    const shares = Math.abs(parseNum(cols[iShares]));
    const amount = parseNum(cols[iAmount]); // negative for buys, positive for sells
    const fee = Math.abs(parseNum(cols[iFee]));

    // Only process equity/fund trades (not bonds, cash transfers, dividends)
    if (!isin || !['STOCK', 'FUND', 'ETF', 'PRIVATE_FUND'].includes(assetClass)) continue;
    if (!['BUY', 'SELL'].includes(type)) continue;
    if (shares === 0) continue;

    if (!holdings.has(isin)) {
      holdings.set(isin, { name, assetClass, shares: 0, totalCost: 0, realizedPnl: 0 });
    }
    const h = holdings.get(isin)!;
    if (h.name === '' && name) h.name = name;

    if (type === 'BUY') {
      const cost = Math.abs(amount) + fee; // total cash out
      h.totalCost += cost;
      h.shares += shares;
    } else if (type === 'SELL') {
      if (h.shares > 0) {
        const avgCost = h.totalCost / h.shares;
        const costOfSold = avgCost * shares;
        const proceeds = Math.abs(amount) - fee;
        h.realizedPnl += proceeds - costOfSold;
        h.totalCost -= costOfSold;
        h.shares -= shares;
        if (h.shares < 0.0001) {
          h.shares = 0;
          h.totalCost = 0;
        }
      }
    }
  }

  const result: ComputedHolding[] = [];
  for (const [isin, h] of holdings.entries()) {
    if (h.shares < 0.0001) continue; // fully sold
    result.push({
      isin,
      name: h.name,
      assetClass: h.assetClass,
      shares: Math.round(h.shares * 1e6) / 1e6,
      totalCostEur: Math.round(h.totalCost * 100) / 100,
      avgCostEur: Math.round((h.totalCost / h.shares) * 100) / 100,
      realizedPnl: Math.round(h.realizedPnl * 100) / 100,
    });
  }

  return result.sort((a, b) => b.totalCostEur - a.totalCostEur);
}

// Simple CSV line parser that handles quoted fields
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}
