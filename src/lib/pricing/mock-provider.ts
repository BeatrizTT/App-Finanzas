// Mock price provider for local testing — no external API calls needed
// Prices are seeded with realistic values and a small random daily variation
// Set PRICE_PROVIDER=mock or MOCK_MODE=true in .env.local to use this

import { calcDrawdownPct } from '../utils/math';
import type { PriceProvider } from './interface';
import type { PriceData, HistoricalPrices, RecentHighs, HistoricalPrice } from '../types';

// Base prices for all covered symbols (approximate market prices, USD unless noted)
const MOCK_BASE_PRICES: Record<string, { price: number; currency: string; marketCap?: number }> = {
  // --- Portfolio stocks ---
  NVDA:  { price: 108, currency: 'USD', marketCap: 2650e9 },
  ASML:  { price: 650, currency: 'EUR', marketCap: 270e9 },
  MSFT:  { price: 390, currency: 'USD', marketCap: 2900e9 },
  AMZN:  { price: 195, currency: 'USD', marketCap: 2100e9 },
  GOOGL: { price: 160, currency: 'USD', marketCap: 1980e9 },
  ORCL:  { price: 115, currency: 'USD', marketCap: 320e9 },
  ADBE:  { price: 360, currency: 'USD', marketCap: 155e9 },
  CRM:   { price: 255, currency: 'USD', marketCap: 245e9 },
  NOW:   { price: 890, currency: 'USD', marketCap: 180e9 },
  MRVL:  { price: 55,  currency: 'USD', marketCap: 48e9 },
  FTNT:  { price: 82,  currency: 'USD', marketCap: 65e9 },
  SMCI:  { price: 32,  currency: 'USD', marketCap: 19e9 },
  // --- Seed watchlist ---
  TSM:   { price: 155, currency: 'USD', marketCap: 800e9 },
  AVGO:  { price: 195, currency: 'USD', marketCap: 950e9 },
  AMD:   { price: 96,  currency: 'USD', marketCap: 155e9 },
  META:  { price: 565, currency: 'USD', marketCap: 1450e9 },
  PANW:  { price: 178, currency: 'USD', marketCap: 215e9 },
  CRWD:  { price: 380, currency: 'USD', marketCap: 92e9 },
  // --- Extended stocks ---
  AAPL:  { price: 205, currency: 'USD', marketCap: 3150e9 },
  AMAT:  { price: 160, currency: 'USD', marketCap: 135e9 },
  LRCX:  { price: 700, currency: 'USD', marketCap: 92e9 },
  KLAC:  { price: 680, currency: 'USD', marketCap: 91e9 },
  INTU:  { price: 595, currency: 'USD', marketCap: 165e9 },
  SHOP:  { price: 72,  currency: 'USD', marketCap: 91e9 },
  SNOW:  { price: 118, currency: 'USD', marketCap: 40e9 },
  NET:   { price: 98,  currency: 'USD', marketCap: 32e9 },
  V:     { price: 295, currency: 'USD', marketCap: 600e9 },
  MA:    { price: 510, currency: 'USD', marketCap: 490e9 },
  UNH:   { price: 490, currency: 'USD', marketCap: 450e9 },
  JNJ:   { price: 155, currency: 'USD', marketCap: 372e9 },
  COST:  { price: 905, currency: 'USD', marketCap: 400e9 },
  // --- Seed ETFs (USD) ---
  QQQ:   { price: 470, currency: 'USD', marketCap: 250e9 },
  SPY:   { price: 540, currency: 'USD', marketCap: 580e9 },
  VGT:   { price: 540, currency: 'USD', marketCap: 70e9 },
  SOXX:  { price: 195, currency: 'USD', marketCap: 12e9 },
  SMH:   { price: 200, currency: 'USD', marketCap: 19e9 },
  XLK:   { price: 205, currency: 'USD', marketCap: 68e9 },
  VTV:   { price: 150, currency: 'USD', marketCap: 130e9 },
  SCHD:  { price: 26,  currency: 'USD', marketCap: 62e9 },
  XLE:   { price: 88,  currency: 'USD', marketCap: 38e9 },
  XLF:   { price: 45,  currency: 'USD', marketCap: 45e9 },
  VIG:   { price: 190, currency: 'USD', marketCap: 89e9 },
  VT:    { price: 105, currency: 'USD', marketCap: 45e9 },
  // --- EUR-denominated ETFs ---
  IWVL:  { price: 58,  currency: 'EUR', marketCap: 8e9 },
  IWDA:  { price: 1320, currency: 'EUR', marketCap: 80e9 },
  CSPX:  { price: 530, currency: 'EUR', marketCap: 95e9 },
  // --- Extended ETFs ---
  VOO:   { price: 495, currency: 'USD', marketCap: 590e9 },
  IVV:   { price: 548, currency: 'USD', marketCap: 530e9 },
  VWO:   { price: 44,  currency: 'USD', marketCap: 98e9 },
  XLV:   { price: 148, currency: 'USD', marketCap: 40e9 },
  XLI:   { price: 140, currency: 'USD', marketCap: 22e9 },
  XLY:   { price: 190, currency: 'USD', marketCap: 22e9 },
  XLP:   { price: 78,  currency: 'USD', marketCap: 18e9 },
  IWF:   { price: 375, currency: 'USD', marketCap: 90e9 },
  IWD:   { price: 175, currency: 'USD', marketCap: 50e9 },
  GLD:   { price: 230, currency: 'USD', marketCap: 68e9 },
  HACK:  { price: 60,  currency: 'USD', marketCap: 2e9 },
  BOTZ:  { price: 28,  currency: 'USD', marketCap: 2.5e9 },
};

// Simulated recent high offsets — how far above current price the recent high was
// Positive = current price is below the recent high (drawdown exists)
const MOCK_HIGH_OFFSETS: Record<string, { offset30d: number; offset60d: number; offset90d: number }> = {
  NVDA:  { offset30d: 0.15, offset60d: 0.22, offset90d: 0.28 },
  ASML:  { offset30d: 0.12, offset60d: 0.18, offset90d: 0.25 },
  MSFT:  { offset30d: 0.08, offset60d: 0.12, offset90d: 0.15 },
  AMZN:  { offset30d: 0.06, offset60d: 0.10, offset90d: 0.14 },
  GOOGL: { offset30d: 0.07, offset60d: 0.11, offset90d: 0.15 },
  ORCL:  { offset30d: 0.10, offset60d: 0.16, offset90d: 0.20 },
  ADBE:  { offset30d: 0.14, offset60d: 0.20, offset90d: 0.28 },
  CRM:   { offset30d: 0.09, offset60d: 0.13, offset90d: 0.18 },
  NOW:   { offset30d: 0.11, offset60d: 0.16, offset90d: 0.20 },
  MRVL:  { offset30d: 0.18, offset60d: 0.28, offset90d: 0.35 },
  FTNT:  { offset30d: 0.05, offset60d: 0.08, offset90d: 0.12 },
  SMCI:  { offset30d: 0.30, offset60d: 0.45, offset90d: 0.55 },
  TSM:   { offset30d: 0.12, offset60d: 0.18, offset90d: 0.22 },
  AVGO:  { offset30d: 0.07, offset60d: 0.12, offset90d: 0.16 },
  AMD:   { offset30d: 0.20, offset60d: 0.30, offset90d: 0.40 },
  META:  { offset30d: 0.04, offset60d: 0.08, offset90d: 0.12 },
  PANW:  { offset30d: 0.08, offset60d: 0.14, offset90d: 0.18 },
  CRWD:  { offset30d: 0.06, offset60d: 0.10, offset90d: 0.13 },
  AAPL:  { offset30d: 0.15, offset60d: 0.22, offset90d: 0.28 },
  AMAT:  { offset30d: 0.22, offset60d: 0.30, offset90d: 0.38 },
  LRCX:  { offset30d: 0.19, offset60d: 0.28, offset90d: 0.35 },
  KLAC:  { offset30d: 0.16, offset60d: 0.24, offset90d: 0.30 },
  INTU:  { offset30d: 0.08, offset60d: 0.13, offset90d: 0.17 },
  V:     { offset30d: 0.04, offset60d: 0.07, offset90d: 0.10 },
  MA:    { offset30d: 0.05, offset60d: 0.08, offset90d: 0.11 },
  UNH:   { offset30d: 0.06, offset60d: 0.09, offset90d: 0.12 },
  QQQ:   { offset30d: 0.10, offset60d: 0.15, offset90d: 0.18 },
  SPY:   { offset30d: 0.07, offset60d: 0.11, offset90d: 0.14 },
  VGT:   { offset30d: 0.11, offset60d: 0.17, offset90d: 0.20 },
  SOXX:  { offset30d: 0.18, offset60d: 0.26, offset90d: 0.33 },
  SMH:   { offset30d: 0.19, offset60d: 0.27, offset90d: 0.34 },
  XLK:   { offset30d: 0.10, offset60d: 0.15, offset90d: 0.18 },
  VTV:   { offset30d: 0.05, offset60d: 0.08, offset90d: 0.10 },
  SCHD:  { offset30d: 0.04, offset60d: 0.06, offset90d: 0.09 },
  IWVL:  { offset30d: 0.05, offset60d: 0.08, offset90d: 0.11 },
  IWDA:  { offset30d: 0.09, offset60d: 0.14, offset90d: 0.17 },
};

function getBasePrice(symbol: string): { price: number; currency: string; marketCap?: number } {
  return MOCK_BASE_PRICES[symbol] ?? { price: 100, currency: 'USD' };
}

function getDailyVariation(symbol: string, dayOffset: number): number {
  // Deterministic pseudo-random variation based on symbol and day
  const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const x = Math.sin(seed * 9301 + dayOffset * 49297) * 233280;
  return (x - Math.floor(x) - 0.5) * 0.03; // ±1.5% daily variation
}

export class MockPriceProvider implements PriceProvider {
  readonly providerName = 'mock';

  async getCurrentPrice(symbol: string): Promise<PriceData> {
    const base = getBasePrice(symbol);
    const variation = getDailyVariation(symbol, 0);
    const currentPrice = base.price * (1 + variation);

    return {
      symbol,
      currentPrice: Math.round(currentPrice * 100) / 100,
      currency: base.currency,
      timestamp: new Date(),
      change1d: variation * 100,
      marketCap: base.marketCap,
    };
  }

  async getHistoricalPrices(symbol: string, days: number): Promise<HistoricalPrices> {
    const base = getBasePrice(symbol);
    const offsets = MOCK_HIGH_OFFSETS[symbol] ?? { offset30d: 0.10, offset60d: 0.15, offset90d: 0.20 };
    const prices: HistoricalPrice[] = [];
    const now = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Simulate a trend that created the recent high then pulled back
      const variation = getDailyVariation(symbol, -i);
      // Create a peak around 30 days ago, then decline
      let priceMult = 1 + variation;
      if (i > 80) priceMult *= (1 - offsets.offset90d * 0.3);
      else if (i > 50) priceMult *= (1 - offsets.offset60d * 0.2);
      else if (i > 20) priceMult *= (1 + offsets.offset30d * 0.5);  // peak period
      else priceMult *= (1 - offsets.offset30d * (20 - i) / 20);    // pullback

      const close = Math.round(base.price * priceMult * 100) / 100;
      const high = Math.round(close * (1 + Math.abs(getDailyVariation(symbol, -i + 0.5)) * 0.5) * 100) / 100;
      const low = Math.round(close * (1 - Math.abs(getDailyVariation(symbol, -i - 0.5)) * 0.5) * 100) / 100;

      prices.push({ date: dateStr, close, high, low, volume: 1e6 });
    }

    return { symbol, prices };
  }

  async getRecentHighs(symbol: string, windows = [30, 60, 90]): Promise<RecentHighs> {
    const historical = await this.getHistoricalPrices(symbol, Math.max(...windows) + 5);
    const currentPriceData = await this.getCurrentPrice(symbol);
    const currentPrice = currentPriceData.currentPrice;

    const allPrices = historical.prices;
    const now = new Date();

    function getHighForWindow(days: number): number {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - days);
      const windowPrices = allPrices.filter((p) => new Date(p.date) >= cutoff);
      return windowPrices.reduce((max, p) => Math.max(max, p.high), currentPrice);
    }

    const [high30d, high60d, high90d] = windows.map(getHighForWindow);

    return {
      symbol,
      high30d,
      high60d,
      high90d,
      currentPrice,
      drawdown30d: calcDrawdownPct(high30d, currentPrice),
      drawdown60d: calcDrawdownPct(high60d, currentPrice),
      drawdown90d: calcDrawdownPct(high90d, currentPrice),
    };
  }
}
