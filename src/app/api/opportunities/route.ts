// API route: GET /api/opportunities
// Returns current stock, ETF, and discovered opportunities from last engine run

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { readJsonFile } = await import('@/lib/utils/file-store');
    const engineOutput = readJsonFile('engine-output.json', null) as any;

    if (!engineOutput || !engineOutput.runAt) {
      return NextResponse.json({
        stocks: [],
        etfs: [],
        discovered: [],
        lastRunAt: null,
        message: 'No engine output yet. Run the engine first.',
      });
    }

    return NextResponse.json({
      stocks: engineOutput.stockOpportunities ?? [],
      etfs: engineOutput.etfOpportunities ?? [],
      discovered: engineOutput.discoveredOpportunities ?? [],
      lastRunAt: engineOutput.runAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
