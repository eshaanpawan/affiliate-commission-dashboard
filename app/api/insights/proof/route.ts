import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { runHogQL } from '@/lib/posthog';
import { dashboardRangeStart, isDashboardRange } from '@/lib/dashboard-range';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Evidence behind the overview funnel numbers: the actual accounts that make
// up each metric, straight from PostHog. metric=affiliateFts | fts |
// affiliateSignups. Capped at 200 rows, newest first.

const AFF = `toString(person.properties.$initial_current_url) LIKE '%via=%'`;

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const metric = sp.get('metric') ?? 'affiliateFts';
  const requested = sp.get('period');
  const range = isDashboardRange(requested) ? requested : '7d';
  const from = (dashboardRangeStart(range) ?? dashboardRangeStart('90d')!).slice(0, 19);

  let where: string;
  if (metric === 'affiliateFts') {
    where = `event = 'subscription_updated' AND properties.isUserFirstPaidPlan = true AND ${AFF}`;
  } else if (metric === 'fts') {
    where = `event = 'subscription_updated' AND properties.isUserFirstPaidPlan = true`;
  } else if (metric === 'affiliateSignups') {
    where = `event = 'sign_up' AND ${AFF}`;
  } else {
    return NextResponse.json({ error: 'Unknown metric' }, { status: 400 });
  }

  const res = await runHogQL(`
    SELECT
      coalesce(nullIf(toString(person.properties.email), ''), toString(properties.email), distinct_id) AS account,
      toString(person.properties.$initial_current_url) AS first_touch_url,
      toString(timestamp) AS at,
      toString(properties.plan) AS plan,
      toFloat(properties.amountPaid) AS amount_paid,
      toString(person.properties.$geoip_country_code) AS country
    FROM events
    WHERE ${where}
      AND timestamp >= toDateTime('${from}', 'UTC')
    ORDER BY timestamp DESC
    LIMIT 200
  `);

  const viaOf = (url: string): string | null => {
    const m = /[?&]via=([^&#]+)/.exec(url ?? '');
    return m ? decodeURIComponent(m[1]) : null;
  };

  const rows = (res?.results ?? []).map((r) => {
    const [account, url, at, plan, amountPaid, country] = r as [string, string, string, string, number, string];
    return {
      account: String(account),
      viaToken: viaOf(String(url)),
      dubAttributed: /[?&]dub_id=/.test(String(url)),
      gclid: /[?&]gclid=/.test(String(url)),
      firstTouchUrl: String(url ?? ''),
      at: String(at),
      plan: plan && plan !== 'null' ? String(plan) : null,
      amountPaid: Number.isFinite(Number(amountPaid)) ? Number(amountPaid) : null,
      country: country && country !== 'null' ? String(country).toUpperCase() : null,
    };
  });

  return NextResponse.json({ metric, range, from, rows, total: rows.length });
}
