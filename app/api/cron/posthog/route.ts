// Cron wrapper: refresh affiliate_traffic from PostHog daily.
// Lives under /api/cron/ so the proxy lets it through; auth is the CRON_SECRET.

import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

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

  // Backstop: Vercel reliably fires this hourly cron while the */10 sync cron
  // has been observed not to invoke — run the full Rewardful+Dub sync here too
  // so the data is never more than an hour stale even with no dashboard open.
  let fullSync: unknown = null;
  try {
    const syncRes = await fetch(`${origin}/api/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      cache: 'no-store',
    });
    fullSync = await syncRes.json().catch(() => ({ error: 'invalid JSON' }));
  } catch (err) {
    fullSync = { error: err instanceof Error ? err.message : 'full sync failed' };
  }

  // Pre-warm the funnel (TTS) analysis for the common preset windows so the
  // Funnel vs Google page serves from the durable cache instead of blocking
  // users on heavy PostHog queries. Sequential and best-effort.
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const tomorrow = day(new Date(todayUtc + 86_400_000));
  // Two windows only — the full sync (~135s) + posthog sync must also fit
  // inside this function's 300s budget. Other windows compute on first view
  // and then persist in api_cache for 24h.
  const warmWindows = [1, 7].map((days) => ({
    from: day(new Date(todayUtc - (days - 1) * 86_400_000)),
    to: tomorrow,
  }));
  const warmed: string[] = [];
  for (const w of warmWindows) {
    try {
      const r = await fetch(`${origin}/api/affiliates/tts?from=${w.from}&to=${w.to}&force=1`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(55_000),
      });
      warmed.push(`${w.from}→${w.to}:${r.status}`);
    } catch {
      warmed.push(`${w.from}→${w.to}:timeout`);
    }
  }

  return NextResponse.json({ posthog: body, fullSync, ttsWarmed: warmed }, { status: res.status });
}
