// Price provider factory — returns the right provider based on environment config
// To add a new provider: implement PriceProvider interface, add a case here

import type { PriceProvider } from './interface';
import { MockPriceProvider } from './mock-provider';
import { YahooPriceProvider } from './yahoo-provider';
import { TwelveDataPriceProvider } from './twelvedata-provider';

let _provider: PriceProvider | null = null;

export function getPriceProvider(): PriceProvider {
  if (_provider) return _provider;

  const mockMode = process.env.MOCK_MODE === 'true';
  const providerName = process.env.PRICE_PROVIDER ?? 'mock';

  if (mockMode || providerName === 'mock') {
    _provider = new MockPriceProvider();
  } else if (providerName === 'yahoo') {
    _provider = new YahooPriceProvider();
  } else if (providerName === 'twelvedata') {
    _provider = new TwelveDataPriceProvider();
  } else {
    console.warn(`Unknown PRICE_PROVIDER "${providerName}", falling back to mock`);
    _provider = new MockPriceProvider();
  }

  console.log(`[PriceProvider] Using: ${_provider.providerName}`);
  return _provider;
}

/** Reset provider (useful when config changes or in tests) */
export function resetPriceProvider(): void {
  _provider = null;
}

/** Fetch price with error handling — returns null on failure */
export async function safeFetchPrice(
  symbol: string,
  provider?: PriceProvider
): Promise<{ price: number; currency: string; error?: string } | null> {
  const p = provider ?? getPriceProvider();
  try {
    const data = await p.getCurrentPrice(symbol);
    return { price: data.currentPrice, currency: data.currency };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PriceProvider] Failed to fetch ${symbol}: ${msg}`);
    return { price: 0, currency: 'USD', error: msg };
  }
}

/** Fetch recent highs with error handling */
export async function safeFetchHighs(
  symbol: string,
  provider?: PriceProvider
): Promise<import('../types').RecentHighs | null> {
  const p = provider ?? getPriceProvider();
  try {
    return await p.getRecentHighs(symbol);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[PriceProvider] Failed to fetch highs for ${symbol}: ${msg}`);
    return null;
  }
}
