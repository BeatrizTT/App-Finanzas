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

    return NextResponse.json({
      success: true,
      runAt: output.runAt,
      portfolioCount: output.portfolioAnalyses.length,
      stockOpportunitiesCount: output.stockOpportunities.length,
      etfOpportunitiesCount: output.etfOpportunities.length,
      discoveredCount: output.discoveredOpportunities.length,
      alertsCount: output.alertsGenerated.length,
      errors: output.errors,
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
    const output = readJsonFile('engine-output.json', null);
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
