import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { runHogQL } from '@/lib/posthog';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Audience demographics from Runable's onboarding survey (PostHog person
// properties). Occupation is the only demographic currently collected —
// age is NOT captured anywhere. Last 90 days, cached 30 minutes.

const QUERY = `
  WITH occ_users AS (
    SELECT distinct_id,
      any(toString(person.properties.occupation)) AS occ,
      max(if(toString(person.properties.$initial_current_url) LIKE '%via=%', 1, 0)) AS is_affiliate
    FROM events
    WHERE event = 'sign_up' AND timestamp > now() - INTERVAL 90 DAY
      AND person.properties.occupation IS NOT NULL
    GROUP BY distinct_id
  ),
  pays AS (
    SELECT DISTINCT distinct_id FROM events
    WHERE event = 'subscription_updated' AND toFloat(properties.amountPaid) > 0
      AND timestamp > now() - INTERVAL 90 DAY
  )
  SELECT o.occ,
    count() AS users,
    sum(o.is_affiliate) AS affiliate_users,
    countIf(notEmpty(p.distinct_id)) AS paid_users
  FROM occ_users o
  LEFT JOIN pays p ON p.distinct_id = o.distinct_id
  GROUP BY o.occ
  ORDER BY users DESC
`;

const TOTAL_QUERY = `
  SELECT count() FROM events WHERE event = 'sign_up' AND timestamp > now() - INTERVAL 90 DAY
`;

let cached: { at: number; data: unknown } | null = null;

export async function GET(req: Request) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (cached && Date.now() - cached.at < 30 * 60_000) {
    return NextResponse.json(cached.data, { headers: { 'X-Cache': 'hit' } });
  }

  const [rows, total] = await Promise.all([runHogQL(QUERY), runHogQL(TOTAL_QUERY)]);
  const occupations = (rows?.results ?? []).map((r) => {
    const [occ, users, affiliateUsers, paidUsers] = r as [string, number, number, number];
    return {
      occupation: String(occ),
      users: Number(users),
      affiliateUsers: Number(affiliateUsers),
      paidUsers: Number(paidUsers),
      paidRate: Number(users) > 0 ? (Number(paidUsers) / Number(users)) * 100 : 0,
    };
  });
  const profiled = occupations.reduce((s, o) => s + o.users, 0);
  const data = {
    windowDays: 90,
    occupations,
    profiledSignups: profiled,
    totalSignups: Number(total?.results?.[0]?.[0] ?? 0),
    ageCollected: false,
    generatedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), data };
  return NextResponse.json(data);
}
