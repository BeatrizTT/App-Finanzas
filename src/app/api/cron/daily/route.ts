import { NextResponse } from 'next/server';
import { runDailyEngine } from '@/lib/engine/daily-engine';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds, Vercel hobby limit is 60s

export async function GET(req: Request) {
  // Vercel sets this header for cron requests; protect against random calls
  const authHeader = req.headers ? (req as any).headers?.get?.('authorization') : null;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const output = await runDailyEngine({ sendDigest: true, sendAlertMessages: true });
    return NextResponse.json({
      success: true,
      runAt: output.runAt,
      alerts: output.alertsGenerated.length,
      errors: output.errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Cron] Daily engine failed:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
