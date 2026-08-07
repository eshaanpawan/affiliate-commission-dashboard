import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { runHogQL } from '@/lib/posthog';
import { dashboardRangeStart, isDashboardRange } from '@/lib/dashboard-range';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// PostHog acquisition truth for the overview: signups, FTS (first paid),
// repeat paid activity, and the affiliate / Google Ads / organic split —
// computed for the current window AND the previous window of equal length
// so the UI can render trend badges. Cached in-memory for 10 minutes.

interface Counts {
  pageviews: number;
  signups: number;
  affiliateSignups: number;
  googleSignups: number;
  fts: number;
  affiliateFts: number;
  ftsZeroInvoice: number;
  repeatPaid: number;
}

const cache = new Map<string, { at: number; data: unknown }>();

function windowQuery(fromExpr: string, toExpr: string): string {
  return `
    SELECT
      countIf(event = '$pageview') AS pageviews,
      countIf(event = 'sign_up') AS signups,
      countIf(event = 'sign_up'
        AND toString(person.properties.$initial_current_url) LIKE '%via=%') AS affiliate_signups,
      countIf(event = 'sign_up' AND (
        toString(person.properties.$initial_utm_source) IN ('google_ads', 'googleads', 'googleleads', 'google')
        OR toString(person.properties.$initial_current_url) LIKE '%gclid=%'
      )) AS google_signups,
      countIf(event = 'subscription_updated' AND properties.isUserFirstPaidPlan = true) AS fts,
      countIf(event = 'subscription_updated' AND properties.isUserFirstPaidPlan = true
        AND toString(person.properties.$initial_current_url) LIKE '%via=%') AS affiliate_fts,
      countIf(event = 'subscription_updated' AND properties.isUserFirstPaidPlan = true
        AND toFloat(properties.amountPaid) = 0) AS fts_zero_invoice,
      count(DISTINCT if(event = 'subscription_updated' AND properties.isUserFirstPaidPlan = false, distinct_id, NULL)) AS repeat_paid
    FROM events
    WHERE event IN ('$pageview', 'sign_up', 'subscription_updated')
      AND timestamp >= ${fromExpr} AND timestamp < ${toExpr}
  `;
}

function toCounts(row: unknown[] | undefined): Counts {
  const n = (i: number) => Number((row ?? [])[i] ?? 0);
  return {
    pageviews: n(0), signups: n(1), affiliateSignups: n(2), googleSignups: n(3),
    fts: n(4), affiliateFts: n(5), ftsZeroInvoice: n(6), repeatPaid: n(7),
  };
}

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const requested = req.nextUrl.searchParams.get('period');
  const range = isDashboardRange(requested) ? requested : '7d';

  const cached = cache.get(range);
  if (cached && Date.now() - cached.at < 10 * 60_000) {
    return NextResponse.json(cached.data, { headers: { 'X-Cache': 'hit' } });
  }

  const start = dashboardRangeStart(range);
  // "all" has no meaningful prev window and unbounded scans time out; cap at 90d.
  const from = start ?? dashboardRangeStart('90d')!;
  const spanMs = Date.now() - new Date(from).getTime();
  const prevFrom = new Date(new Date(from).getTime() - spanMs).toISOString();

  const [cur, prev] = await Promise.all([
    runHogQL(windowQuery(`toDateTime('${from.slice(0, 19)}', 'UTC')`, 'now()')),
    runHogQL(windowQuery(
      `toDateTime('${prevFrom.slice(0, 19)}', 'UTC')`,
      `toDateTime('${from.slice(0, 19)}', 'UTC')`,
    )),
  ]);

  const current = toCounts(cur?.results?.[0] as unknown[] | undefined);
  const previous = toCounts(prev?.results?.[0] as unknown[] | undefined);
  const data = {
    range,
    windowFrom: from,
    current,
    previous,
    organicSignups: Math.max(0, current.signups - current.affiliateSignups - current.googleSignups),
    generatedAt: new Date().toISOString(),
  };
  cache.set(range, { at: Date.now(), data });
  return NextResponse.json(data);
}
