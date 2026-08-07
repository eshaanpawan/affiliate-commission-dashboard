import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { runHogQL } from '@/lib/posthog';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Ultimate segmentation from raw PostHog events (last 30 days): device / OS /
// browser mix of sign-ups with the affiliate-attributed share of each, plus
// product-usage depth by acquisition channel. Cached 30 minutes.

const AFF = `toString(person.properties.$initial_current_url) LIKE '%via=%'`;

const dimQuery = (expr: string) => `
  SELECT coalesce(nullIf(toString(${expr}), ''), 'Unknown') AS dim,
    count() AS signups,
    countIf(${AFF}) AS affiliate
  FROM events WHERE event = 'sign_up' AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY dim ORDER BY signups DESC LIMIT 12
`;

const USAGE_QUERY = `
  SELECT multiIf(
      ${AFF}, 'affiliate',
      toString(person.properties.$initial_utm_source) IN ('google_ads', 'googleads', 'googleleads', 'google')
        OR toString(person.properties.$initial_current_url) LIKE '%gclid=%', 'google_ads',
      'organic') AS channel,
    count(DISTINCT distinct_id) AS active_users,
    countIf(event = 'user_chat_req') AS chats,
    countIf(event = 'submit_prompt') AS prompts,
    countIf(event = 'artifact_call') AS artifacts
  FROM events
  WHERE event IN ('user_chat_req', 'submit_prompt', 'artifact_call')
    AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY channel
`;

let cached: { at: number; data: unknown } | null = null;

export async function GET(req: Request) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (cached && Date.now() - cached.at < 30 * 60_000) {
    return NextResponse.json(cached.data, { headers: { 'X-Cache': 'hit' } });
  }

  const [device, os, browser, usage] = await Promise.all([
    runHogQL(dimQuery('person.properties.$initial_device_type')),
    runHogQL(dimQuery('person.properties.$initial_os')),
    runHogQL(dimQuery('person.properties.$initial_browser')),
    runHogQL(USAGE_QUERY),
  ]);

  const rows = (res: Awaited<ReturnType<typeof runHogQL>>) =>
    (res?.results ?? []).map((r) => {
      const [dim, signups, affiliate] = r as [string, number, number];
      return { dim: String(dim), signups: Number(signups), affiliate: Number(affiliate) };
    });

  const data = {
    windowDays: 30,
    device: rows(device),
    os: rows(os),
    browser: rows(browser),
    usage: (usage?.results ?? []).map((r) => {
      const [channel, activeUsers, chats, prompts, artifacts] = r as [string, number, number, number, number];
      return {
        channel: String(channel),
        activeUsers: Number(activeUsers),
        chats: Number(chats),
        prompts: Number(prompts),
        artifacts: Number(artifacts),
        chatsPerUser: Number(activeUsers) > 0 ? Number(chats) / Number(activeUsers) : 0,
      };
    }),
    generatedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), data };
  return NextResponse.json(data);
}
