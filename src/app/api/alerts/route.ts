// API route: GET /api/alerts
// Returns alert history

import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);

    const { getAlertHistory } = await import('@/lib/alerts/history');
    const alerts = getAlertHistory(limit);

    return NextResponse.json({ alerts, count: alerts.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
