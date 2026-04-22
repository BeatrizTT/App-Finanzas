// API route: GET /api/portfolio
// Returns the current portfolio config and last analysis results

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getEffectivePortfolioConfig } = await import('@/lib/utils/config-loader');
    const { readJsonFile } = await import('@/lib/utils/file-store');

    const portfolioConfig = getEffectivePortfolioConfig();
    const engineOutput = readJsonFile('engine-output.json', null) as any;

    return NextResponse.json({
      config: portfolioConfig,
      analyses: engineOutput?.portfolioAnalyses ?? [],
      concentration: engineOutput?.concentration ?? null,
      lastRunAt: engineOutput?.runAt ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
