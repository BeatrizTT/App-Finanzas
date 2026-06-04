// API route: GET /api/portfolio
// Returns the current portfolio config and last analysis results

import { NextResponse } from 'next/server';
import type { DailyEngineOutput } from '@/lib/types';
import type { PortfolioConfig } from '@/lib/types';

/** Pure response builder — exported for unit tests. */
export function buildPortfolioResponse(
  config: PortfolioConfig,
  output: DailyEngineOutput | null
) {
  return {
    config,
    analyses: output?.portfolioAnalyses ?? [],
    concentration: output?.concentration ?? null,
    lastRunAt: output?.runAt ?? null,
  };
}

export async function GET() {
  try {
    const { getEffectivePortfolioConfig } = await import('@/lib/utils/config-loader');
    const { loadEngineOutput } = await import('@/lib/utils/engine-store');

    const portfolioConfig = getEffectivePortfolioConfig();
    const { output, source } = await loadEngineOutput();
    console.log(`[API /portfolio] Loaded from ${source}`);

    return NextResponse.json(buildPortfolioResponse(portfolioConfig, output));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
