import { NextResponse } from 'next/server';
import { runDailyEngine } from '@/lib/engine/daily-engine';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds, Vercel hobby limit is 60s

/** Pure auth decision — exported for testing without HTTP infrastructure. */
export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: string; error: string };

export function checkCronAuth(
  cronSecret: string | undefined,
  authorizationHeader: string | null
): CronAuthResult {
  if (!cronSecret) {
    return { ok: false, status: 503, code: 'CRON_SECRET_MISSING', error: 'Service misconfigured: CRON_SECRET not set' };
  }
  if (authorizationHeader !== `Bearer ${cronSecret}`) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', error: 'Unauthorized' };
  }
  return { ok: true };
}

export async function GET(req: Request) {
  const cronSecret = process.env['CRON_SECRET'];
  const authHeader = req.headers ? (req as any).headers?.get?.('authorization') : null;

  const auth = checkCronAuth(cronSecret, authHeader);
  if (!auth.ok) {
    if (auth.status === 503) console.error('[Cron] CRON_SECRET is not configured — refusing to execute');
    return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
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
