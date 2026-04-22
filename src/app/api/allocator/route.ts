// API route: GET /api/allocator
// Returns capital allocation recommendations from last engine run

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { readJsonFile } = await import('@/lib/utils/file-store');
    const engineOutput = readJsonFile('engine-output.json', null) as any;

    if (!engineOutput || !engineOutput.runAt) {
      return NextResponse.json({
        recommendations: [],
        lastRunAt: null,
        message: 'No engine output yet.',
      });
    }

    return NextResponse.json({
      recommendations: engineOutput.allocationRecommendations ?? [],
      lastRunAt: engineOutput.runAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
