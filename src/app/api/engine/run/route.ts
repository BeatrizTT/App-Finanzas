// API route: POST /api/engine/run
// Triggers the full daily engine run on demand
// Useful for: manual dashboard refresh, Vercel Cron, or external scheduler

import { NextRequest, NextResponse } from 'next/server';
import { runDailyEngine } from '@/lib/engine/daily-engine';

export async function POST(req: NextRequest) {
  // Optional: protect with a simple API secret
  const secret = process.env.ENGINE_API_SECRET;
  if (secret) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const sendDigest = body.sendDigest !== false;
    const sendAlertMessages = body.sendAlertMessages !== false;

    const output = await runDailyEngine({ sendDigest, sendAlertMessages });

    // Also merge realized P&L so the dashboard can use POST response directly
    const { readJsonFile } = await import('@/lib/utils/file-store');
    const portfolioConfig = readJsonFile<any>('../../config/portfolio.json', {});

    return NextResponse.json({
      success: true,
      alertsCount: output.alertsGenerated.length,
      // Full data — dashboard uses this directly, no second GET needed
      runAt: output.runAt,
      marketRegime: output.marketRegime,
      eurUsdRate: output.eurUsdRate ?? null,
      portfolioAnalyses: output.portfolioAnalyses,
      concentration: output.concentration,
      stockOpportunities: output.stockOpportunities,
      etfOpportunities: output.etfOpportunities,
      discoveredOpportunities: output.discoveredOpportunities,
      allocationRecommendations: output.allocationRecommendations,
      errors: output.errors,
      closedPositions: portfolioConfig.closedPositions ?? [],
      totalRealizedPnl: portfolioConfig.totalRealizedPnl ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[API /engine/run]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// GET returns the last cached engine output
export async function GET() {
  try {
    const { readJsonFile } = await import('@/lib/utils/file-store');
    const output = readJsonFile<Record<string, unknown>>('engine-output.json', null as unknown as Record<string, unknown>);
    if (!output) {
      return NextResponse.json({ error: 'No engine output yet. Run the engine first.' }, { status: 404 });
    }
    // Merge in realized P&L from portfolio config (written by CSV import)
    const portfolioConfig = readJsonFile<any>('../../config/portfolio.json', {});
    return NextResponse.json({
      ...output,
      closedPositions: portfolioConfig.closedPositions ?? [],
      totalRealizedPnl: portfolioConfig.totalRealizedPnl ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
