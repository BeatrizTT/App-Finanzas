// API route: GET /api/opportunities
// Returns current stock, ETF, and discovered opportunities from last engine run

import { NextResponse } from 'next/server';
import type { DailyEngineOutput } from '@/lib/types';

/** Pure response builder — exported for unit tests. */
export function buildOpportunitiesResponse(output: DailyEngineOutput | null) {
  if (!output || !output.runAt) {
    return {
      stocks: [],
      etfs: [],
      discovered: [],
      lastRunAt: null,
      message: 'No engine output yet. Run the engine first.',
    };
  }
  return {
    stocks: output.stockOpportunities ?? [],
    etfs: output.etfOpportunities ?? [],
    discovered: output.discoveredOpportunities ?? [],
    lastRunAt: output.runAt,
  };
}

export async function GET() {
  try {
    const { loadEngineOutput } = await import('@/lib/utils/engine-store');
    const { output, source } = await loadEngineOutput();
    console.log(`[API /opportunities] Loaded from ${source}`);
    return NextResponse.json(buildOpportunitiesResponse(output));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
