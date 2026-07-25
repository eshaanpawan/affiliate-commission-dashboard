// Cron wrapper: refresh affiliate_traffic from PostHog daily.
// Lives under /api/cron/ so the proxy lets it through; auth is the CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authToken = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || authToken !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/sync/posthog?days=30`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
