// API route: GET /api/alerts
// Returns alert history

import { NextResponse } from 'next/server';

// GET-only route reading mutable state (alert history, now KV-backed).
// force-dynamic prevents Next.js/Vercel from serving a stale cached response.
// See RUNBOOK § "Lección Fase 1" (same fix as /api/opportunities, /api/portfolio).
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);

    const { getAlertHistory } = await import('@/lib/alerts/history');
    const alerts = await getAlertHistory(limit);

    return NextResponse.json({ alerts, count: alerts.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
