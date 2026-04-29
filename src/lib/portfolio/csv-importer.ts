// Trade Republic CSV transaction importer
// Parses the exported CSV and computes current holdings (shares + avg cost)

export interface ComputedHolding {
  isin: string;
  name: string;
  assetClass: string;
  shares: number;
  totalCostEur: number;
  avgCostEur: number;
  realizedPnl: number;
}

export interface CsvImportResult {
  open: ComputedHolding[];   // positions still held
  closed: ComputedHolding[]; // positions fully sold
}

function parseNum(s: string): number {
  if (!s || s.trim() === '') return 0;
  // Handle European format "1.234,56" → strip thousands dot, replace decimal comma
  const cleaned = s.trim().replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : v;
}

// Auto-detect delimiter: Trade Republic Spain/EU exports use semicolons
function detectDelimiter(headerLine: string): ',' | ';' {
  const semicolons = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

export function parseTradeRepublicCsv(csvText: string): CsvImportResult {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return { open: [], closed: [] };

  const delim = detectDelimiter(lines[0]);
  const header = parseCsvLine(lines[0], delim);

  // Use EXACT match first, then fallback to includes — fixes account_type matching before type
  const idxOf = (name: string) => {
    const exact = header.findIndex(h => h.toLowerCase().trim() === name.toLowerCase());
    if (exact !== -1) return exact;
    return header.findIndex(h => h.toLowerCase().trim().includes(name.toLowerCase()));
  };

  const iType   = idxOf('type');
  const iAsset  = idxOf('asset_class');
  const iName   = idxOf('name');
  const iSymbol = idxOf('symbol');
  const iShares = idxOf('shares');
  const iAmount = idxOf('amount');
  const iFee    = idxOf('fee');

  const holdings = new Map<string, {
    name: string; assetClass: string;
    shares: number; totalCost: number; realizedPnl: number;
  }>();

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cols = parseCsvLine(raw, delim);

    const type      = cols[iType]?.trim().toUpperCase();
    const assetClass = cols[iAsset]?.trim().toUpperCase();
    const name      = cols[iName]?.trim() || '';
    const isin      = cols[iSymbol]?.trim() || '';
    const shares    = Math.abs(parseNum(cols[iShares]));
    const amount    = parseNum(cols[iAmount]); // negative for buys, positive for sells
    const fee       = Math.abs(parseNum(cols[iFee]));

    if (!isin || !['STOCK', 'FUND', 'ETF', 'PRIVATE_FUND'].includes(assetClass)) continue;
    if (!['BUY', 'SELL'].includes(type)) continue;
    if (shares === 0) continue;

    if (!holdings.has(isin)) {
      holdings.set(isin, { name, assetClass, shares: 0, totalCost: 0, realizedPnl: 0 });
    }
    const h = holdings.get(isin)!;
    if (h.name === '' && name) h.name = name;

    if (type === 'BUY') {
      const cost = Math.abs(amount) + fee;
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
        if (h.shares < 0.0001) { h.shares = 0; h.totalCost = 0; }
      }
    }
  }

  const open: ComputedHolding[] = [];
  const closed: ComputedHolding[] = [];

  for (const [isin, h] of holdings.entries()) {
    const holding: ComputedHolding = {
      isin,
      name: h.name,
      assetClass: h.assetClass,
      shares: Math.round(h.shares * 1e6) / 1e6,
      totalCostEur: Math.round(h.totalCost * 100) / 100,
      avgCostEur: h.shares > 0 ? Math.round((h.totalCost / h.shares) * 100) / 100 : 0,
      realizedPnl: Math.round(h.realizedPnl * 100) / 100,
    };
    if (h.shares >= 0.0001) {
      open.push(holding);
    } else if (Math.abs(h.realizedPnl) > 0.01) {
      closed.push(holding); // fully sold, but had P&L
    }
  }

  open.sort((a, b) => b.totalCostEur - a.totalCostEur);
  closed.sort((a, b) => b.realizedPnl - a.realizedPnl);

  return { open, closed };
}

function parseCsvLine(line: string, delim: ',' | ';' = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}
