// API route: GET /api/portfolio
// Returns the current portfolio config and last analysis results

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { DailyEngineOutput } from '@/lib/types';
import type { PortfolioConfig } from '@/lib/types';
import { loadPortfolioConfig } from '@/lib/utils/portfolio-store';
import { loadEngineOutput } from '@/lib/utils/engine-store';

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
    const { config: portfolioConfig, source: configSource } = await loadPortfolioConfig();
    console.log(`[API /portfolio] Config loaded from ${configSource}`);
    const { output, source } = await loadEngineOutput();
    console.log(`[API /portfolio] Engine output loaded from ${source}`);

    return NextResponse.json(buildPortfolioResponse(portfolioConfig, output));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
