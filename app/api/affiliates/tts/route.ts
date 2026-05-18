import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getFunnelTimingsForFTS, getFunnelCountsBySource, FunnelTiming } from '@/lib/posthog';

// Per-affiliate funnel comparison vs Google brand-search baseline.
//
// For each source / affiliate, returns:
//   - Funnel counts:    Pageviews → Signups → FTS in window
//   - Conversion rates: PV→Signup %, Signup→FTS %
//   - Signup→FTS median (decision-time duration)
//
// Sources:
//   - 'google'      : initial UTM source / referrer contains 'google' (brand-search baseline)
//   - 'affiliate'   : customer email matches a Rewardful referral
//   - 'other'       : everything else
//
// If an affiliate's Signup→FTS time matches the Google baseline, they are
// almost certainly intercepting Google brand-search traffic (brand bidding).

function median(nums: number[]): number | null {
  const f = nums.filter(n => isFinite(n));
  if (f.length === 0) return null;
  const s = [...f].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

interface FunnelRow {
  label: string;
  source: 'google' | 'affiliate' | 'other' | 'affiliate_specific';
  affiliateId?: string;
  email?: string | null;
  linkToken?: string | null;
  pageviews: number | null;        // PostHog count of users with $pageview in window
  signups: number;                 // count of users who hit sign_up
  fts: number;                     // count of users who hit FTS
  pvToSignupRate: number | null;   // signups / pageviews
  signupToFtsRate: number | null;  // fts / signups
  signupToFtsSecMedian: number | null;
  // Similarity to Google baseline (0..1) — higher = more like brand-search interception
  googleSimilarity?: number | null;
}

interface ReferralCustomer {
  affiliate_id: string;
  customer_email: string;
}

interface AffiliateRow {
  rewardful_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  primary_link_token: string | null;
}

function isGoogleSource(t: FunnelTiming): boolean {
  const utm = (t.initialUtmSource ?? '').toLowerCase();
  const ref = (t.initialReferrer ?? '').toLowerCase();
  return utm.includes('google') || ref.includes('google');
}

function rateOrNull(n: number, d: number | null): number | null {
  if (d === null || d === 0) return null;
  return n / d;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const fromStr = sp.get('from') ?? '2026-04-01';
  const toStr = sp.get('to') ?? '2026-06-01';
  const from = new Date(fromStr + (fromStr.includes('T') ? '' : 'T00:00:00Z'));
  const to = new Date(toStr + (toStr.includes('T') ? '' : 'T00:00:00Z'));

  // 1. Pull FTS-window funnel timings (per user) + group counts (per source)
  const [timings, sourceCounts] = await Promise.all([
    getFunnelTimingsForFTS(from, to),
    getFunnelCountsBySource(from, to),
  ]);

  if (timings.length === 0) {
    return NextResponse.json({
      window: { from: from.toISOString(), to: to.toISOString() },
      baselines: [],
      affiliates: [],
      note: 'PostHog returned 0 funnel rows for this window. Either no FTS events occurred, env vars are missing, or the HogQL query errored — check server logs.',
    });
  }

  const emails = timings.map(t => t.email.toLowerCase());

  // 2. Map emails to affiliates
  const refRows = (await sql`
    SELECT DISTINCT affiliate_id, LOWER(customer_email) AS customer_email
    FROM referrals
    WHERE LOWER(customer_email) = ANY(${emails}::text[])
      AND affiliate_id IS NOT NULL
  `) as unknown as ReferralCustomer[];
  const emailToAffiliateId = new Map<string, string>();
  for (const r of refRows) {
    if (!emailToAffiliateId.has(r.customer_email)) emailToAffiliateId.set(r.customer_email, r.affiliate_id);
  }
  const affiliateIds = [...new Set(refRows.map(r => r.affiliate_id))];

  const affRows = affiliateIds.length === 0 ? [] : (await sql`
    SELECT a.rewardful_id, a.first_name, a.last_name, a.email,
           link_stats.primary_link_token
    FROM affiliates a
    LEFT JOIN LATERAL (
      SELECT link_token AS primary_link_token
      FROM referrals
      WHERE affiliate_id = a.rewardful_id AND link_token IS NOT NULL
      GROUP BY link_token ORDER BY COUNT(*) DESC LIMIT 1
    ) link_stats ON true
    WHERE a.rewardful_id = ANY(${affiliateIds}::text[])
  `) as unknown as AffiliateRow[];
  const affMap = new Map(affRows.map(a => [a.rewardful_id, a]));

  // 3. Classify and bucket.
  // Two top-level buckets: 'google' (brand-search baseline) and 'rest' (everything else,
  // including affiliate-attributed traffic). Per-affiliate rows are also collected for
  // the per-affiliate comparison.
  const googleTimings: FunnelTiming[] = [];
  const restTimings: FunnelTiming[] = [];
  const byAffiliate = new Map<string, FunnelTiming[]>();

  for (const t of timings) {
    const affId = emailToAffiliateId.get(t.email.toLowerCase());
    if (affId) {
      const list = byAffiliate.get(affId) ?? [];
      list.push(t);
      byAffiliate.set(affId, list);
    }
    // Classify by source, NOT by affiliate-attribution — affiliate users still count
    // as Google if their initial source was Google.
    if (isGoogleSource(t)) {
      googleTimings.push(t);
    } else {
      restTimings.push(t);
    }
  }

  // 4. Build baseline rows
  const googleSignupToFts = median(googleTimings.map(t => t.signupToFtsSec).filter((x): x is number => x !== null));
  const restSignupToFts = median(restTimings.map(t => t.signupToFtsSec).filter((x): x is number => x !== null));
  const overallSignupToFts = median(timings.map(t => t.signupToFtsSec).filter((x): x is number => x !== null));

  const googleRow: FunnelRow = {
    label: '🎯 Google (brand-search baseline)',
    source: 'google',
    pageviews: sourceCounts.google.pageviews,
    signups: sourceCounts.google.signups,
    fts: sourceCounts.google.fts,
    pvToSignupRate: rateOrNull(sourceCounts.google.signups, sourceCounts.google.pageviews),
    signupToFtsRate: rateOrNull(sourceCounts.google.fts, sourceCounts.google.signups),
    signupToFtsSecMedian: googleSignupToFts ?? sourceCounts.google.signupToFtsSec,
  };
  const restRow: FunnelRow = {
    label: 'Rest (everything minus Google)',
    source: 'other',
    pageviews: sourceCounts.other.pageviews,
    signups: sourceCounts.other.signups,
    fts: sourceCounts.other.fts,
    pvToSignupRate: rateOrNull(sourceCounts.other.signups, sourceCounts.other.pageviews),
    signupToFtsRate: rateOrNull(sourceCounts.other.fts, sourceCounts.other.signups),
    signupToFtsSecMedian: restSignupToFts ?? sourceCounts.other.signupToFtsSec,
  };

  // 5. Per-affiliate rows
  const affiliateRows: FunnelRow[] = [];
  for (const [affId, list] of byAffiliate) {
    const aff = affMap.get(affId);
    if (!aff) continue;
    const sf = list.map(t => t.signupToFtsSec).filter((x): x is number => x !== null);
    const med = median(sf);

    // Similarity to Google baseline: log-distance comparison
    let similarity: number | null = null;
    if (googleSignupToFts !== null && restSignupToFts !== null && med !== null && list.length >= 2 && googleSignupToFts !== restSignupToFts) {
      const ln = (x: number) => Math.log(Math.max(60, x));
      const dG = Math.abs(ln(med) - ln(googleSignupToFts));
      const dR = Math.abs(ln(med) - ln(restSignupToFts));
      const total = dG + dR;
      similarity = total === 0 ? 0.5 : dR / total;
    }

    affiliateRows.push({
      label: [aff.first_name, aff.last_name].filter(Boolean).join(' ') || aff.email || '?',
      source: 'affiliate_specific',
      affiliateId: affId,
      email: aff.email,
      linkToken: aff.primary_link_token,
      pageviews: null,
      signups: list.filter(t => t.signupAt !== null).length,
      fts: list.length,
      pvToSignupRate: null,
      signupToFtsRate: null,
      signupToFtsSecMedian: med,
      googleSimilarity: similarity,
    });
  }

  // Sort affiliates: highest Google-similarity first, fts count as tiebreaker
  affiliateRows.sort((a, b) => {
    const sa = a.googleSimilarity ?? -1;
    const sb = b.googleSimilarity ?? -1;
    if (sb !== sa) return sb - sa;
    return b.fts - a.fts;
  });

  return NextResponse.json({
    window: { from: from.toISOString(), to: to.toISOString() },
    totalFts: timings.length,
    overall: {
      signupToFtsSecMedian: overallSignupToFts,
      googleSignupToFtsSecMedian: googleSignupToFts,
      restSignupToFtsSecMedian: restSignupToFts,
      googleFts: googleTimings.length,
      restFts: restTimings.length,
    },
    baselines: [googleRow, restRow],
    affiliates: affiliateRows,
  });
}
