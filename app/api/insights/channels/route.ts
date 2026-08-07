import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { runHogQL } from '@/lib/posthog';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Channel economics from PostHog: ARPU (last 30 days of payments) and M1
// retention (paid again in days 30-60 after first payment) per acquisition
// channel. Heavy queries — cached in-memory for 30 minutes.

const CHANNEL_EXPR = `multiIf(
  toString(person.properties.$initial_current_url) LIKE '%via=%', 'affiliate',
  toString(person.properties.$initial_utm_source) IN ('google_ads', 'googleads', 'googleleads', 'google')
    OR toString(person.properties.$initial_current_url) LIKE '%gclid=%', 'google_ads',
  'organic')`;

const ARPU_QUERY = `
  SELECT ${CHANNEL_EXPR} AS channel,
    count(DISTINCT distinct_id) AS payers,
    round(sum(toFloat(properties.amountPaid)), 2) AS revenue
  FROM events
  WHERE event = 'subscription_updated' AND toFloat(properties.amountPaid) > 0
    AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY channel
`;

const RETENTION_QUERY = `
  WITH fts AS (
    SELECT distinct_id, min(timestamp) AS fts_at, any(${CHANNEL_EXPR}) AS channel
    FROM events
    WHERE event = 'subscription_updated' AND properties.isUserFirstPaidPlan = true
      AND timestamp >= now() - INTERVAL 90 DAY AND timestamp < now() - INTERVAL 30 DAY
    GROUP BY distinct_id
  ),
  pays AS (
    SELECT distinct_id, groupArray(timestamp) AS ts
    FROM events
    WHERE event = 'subscription_updated' AND toFloat(properties.amountPaid) > 0
      AND timestamp >= now() - INTERVAL 90 DAY
    GROUP BY distinct_id
  )
  SELECT f.channel,
    count() AS cohort,
    countIf(arrayExists(t -> t >= f.fts_at + INTERVAL 30 DAY AND t < f.fts_at + INTERVAL 60 DAY, p.ts)) AS m1
  FROM fts f
  LEFT JOIN pays p ON p.distinct_id = f.distinct_id
  GROUP BY f.channel
`;

let cached: { at: number; data: unknown } | null = null;

export async function GET(req: Request) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (cached && Date.now() - cached.at < 30 * 60_000) {
    return NextResponse.json(cached.data, { headers: { 'X-Cache': 'hit' } });
  }

  const [arpu, retention] = await Promise.all([runHogQL(ARPU_QUERY), runHogQL(RETENTION_QUERY)]);

  const channels: Record<string, {
    payers: number; revenue: number; arpu: number; cohort: number; m1: number; m1Rate: number;
  }> = {};
  const get = (ch: string) => (channels[ch] ??= { payers: 0, revenue: 0, arpu: 0, cohort: 0, m1: 0, m1Rate: 0 });

  for (const row of arpu?.results ?? []) {
    const [ch, payers, revenue] = row as [string, number, number];
    const c = get(ch);
    c.payers = Number(payers);
    c.revenue = Number(revenue);
    c.arpu = c.payers > 0 ? c.revenue / c.payers : 0;
  }
  for (const row of retention?.results ?? []) {
    const [ch, cohort, m1] = row as [string, number, number];
    const c = get(ch);
    c.cohort = Number(cohort);
    c.m1 = Number(m1);
    c.m1Rate = c.cohort > 0 ? (c.m1 / c.cohort) * 100 : 0;
  }

  const data = { channels, generatedAt: new Date().toISOString() };
  cached = { at: Date.now(), data };
  return NextResponse.json(data);
}
