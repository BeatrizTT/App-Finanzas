// API route: POST /api/engine/run
// Triggers the full daily engine run on demand
// Useful for: manual dashboard refresh, Vercel Cron, or external scheduler

import { NextRequest, NextResponse } from 'next/server';
import { runDailyEngine } from '@/lib/engine/daily-engine';

/**
 * Strip known secret values and URL API key params from error messages
 * before logging or returning them in responses.
 */
function sanitizeError(msg: string): string {
  const sensitiveValues = [
    process.env.TWELVE_DATA_API_KEY,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.ENGINE_API_SECRET,
    process.env.EODHD_API_KEY,
    process.env.CRON_SECRET,
  ].filter((v): v is string => typeof v === 'string' && v.length > 4);

  let safe = msg;
  for (const val of sensitiveValues) {
    safe = safe.replaceAll(val, '[REDACTED]');
  }
  // Strip URL query params that look like API keys
  return safe.replace(/[?&](apikey|api_token|token|key)=[^&\s"')\]]+/gi, '$1=[REDACTED]');
}

export async function POST(req: NextRequest) {
  const timestamp = new Date().toISOString();
  let stage = 'auth';

  // Outer try/catch guarantees JSON response even if an inner handler throws
  try {
    const secret = process.env.ENGINE_API_SECRET;
    if (secret) {
      const authHeader = req.headers.get('authorization');
      if (authHeader !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    stage = 'parse_body';
    const body = await req.json().catch(() => ({}));
    const sendDigest = body.sendDigest !== false;
    const sendAlertMessages = body.sendAlertMessages !== false;

    stage = 'engine';
    const output = await runDailyEngine({ sendDigest, sendAlertMessages });

    stage = 'merge_portfolio_config';
    const { readJsonFile } = await import('@/lib/utils/file-store');
    const portfolioConfig = readJsonFile<any>('../../config/portfolio.json', {});

    stage = 'serialize';
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
    const raw = err instanceof Error ? err.message : String(err);
    const msg = sanitizeError(raw);
    console.error(`[API /engine/run POST] stage=${stage}:`, msg);
    return NextResponse.json(
      { success: false, error: msg, stage, timestamp, errors: [msg] },
      { status: 500 }
    );
  }
}

// GET returns the last cached engine output
export async function GET() {
  const timestamp = new Date().toISOString();
  try {
    const { readJsonFile } = await import('@/lib/utils/file-store');
    const output = readJsonFile<Record<string, unknown>>(
      'engine-output.json',
      null as unknown as Record<string, unknown>
    );

    if (!output) {
      // Return 200 so the frontend can parse the body and show an actionable message
      return NextResponse.json({
        noData: true,
        error: 'Sin datos de análisis. Pulsa Analizar para ejecutar el motor.',
        timestamp,
      });
    }

    const portfolioConfig = readJsonFile<any>('../../config/portfolio.json', {});
    return NextResponse.json({
      ...output,
      closedPositions: portfolioConfig.closedPositions ?? [],
      totalRealizedPnl: portfolioConfig.totalRealizedPnl ?? null,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const msg = sanitizeError(raw);
    return NextResponse.json({ success: false, error: msg, timestamp }, { status: 500 });
  }
}
