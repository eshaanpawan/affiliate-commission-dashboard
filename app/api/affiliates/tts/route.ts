import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getSignupToFirstPurchaseByEmail } from '@/lib/posthog';

// Per-affiliate Median Time-to-Subscribe (TTS) for first-time paid customers.
// Default window: April 2026 — May 2026 (the user's requested investigation window).
// Logic:
//   1. PostHog: pull every (email, signup_at, fts_at) tuple where FTS is in window
//   2. Our DB: join those emails to referrals.customer_email → affiliate_id
//   3. Per affiliate: compute median TTS, FTS count, min/max
//
// Short median (e.g. <1 hour) suggests brand-bidding / intercepted intent
// — those customers were already buying-intent when they hit the affiliate link.

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const fromStr = sp.get('from') ?? '2026-04-01';
  const toStr = sp.get('to') ?? '2026-06-01';  // exclusive upper bound — May 31 23:59:59
  const from = new Date(fromStr + (fromStr.includes('T') ? '' : 'T00:00:00Z'));
  const to = new Date(toStr + (toStr.includes('T') ? '' : 'T00:00:00Z'));

  // 1. Pull PostHog data
  const ftsByEmail = await getSignupToFirstPurchaseByEmail(from, to);

  if (ftsByEmail.size === 0) {
    return NextResponse.json({
      window: { from: from.toISOString(), to: to.toISOString() },
      totalFts: 0,
      overall: { medianTtsSec: null, mean: null, count: 0 },
      affiliates: [],
      note: 'No PostHog data — check POSTHOG_API_KEY / POSTHOG_PROJECT_ID env vars',
    });
  }

  // 2. Join to referrals.customer_email → affiliate_id
  const emails = [...ftsByEmail.keys()];
  const referrals = (await sql`
    SELECT DISTINCT affiliate_id, LOWER(customer_email) AS customer_email
    FROM referrals
    WHERE LOWER(customer_email) = ANY(${emails}::text[])
      AND affiliate_id IS NOT NULL
  `) as unknown as ReferralCustomer[];

  const affiliateIds = [...new Set(referrals.map(r => r.affiliate_id))];
  if (affiliateIds.length === 0) {
    return NextResponse.json({
      window: { from: from.toISOString(), to: to.toISOString() },
      totalFts: ftsByEmail.size,
      overall: computeOverall(ftsByEmail),
      affiliates: [],
      note: 'No referrals matched these FTS emails (customer_email may be sparse in our DB)',
    });
  }

  const affRows = (await sql`
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

  // 3. Group by affiliate
  const byAffiliate = new Map<string, { ttsSec: number; email: string; ftsAt: string; signupAt: string }[]>();
  for (const ref of referrals) {
    const fts = ftsByEmail.get(ref.customer_email);
    if (!fts) continue;
    const list = byAffiliate.get(ref.affiliate_id) ?? [];
    list.push({ ttsSec: fts.ttsSec, email: ref.customer_email, ftsAt: fts.ftsAt, signupAt: fts.signupAt });
    byAffiliate.set(ref.affiliate_id, list);
  }

  // 4. Compute per-affiliate stats
  const result = [];
  for (const [affId, entries] of byAffiliate) {
    const aff = affMap.get(affId);
    if (!aff) continue;
    const ttsValues = entries.map(e => e.ttsSec).filter(s => isFinite(s));
    if (ttsValues.length === 0) continue;
    const med = median(ttsValues);
    const mean = ttsValues.reduce((a, b) => a + b, 0) / ttsValues.length;
    const minV = Math.min(...ttsValues);
    const maxV = Math.max(...ttsValues);
    result.push({
      affiliateId: affId,
      name: [aff.first_name, aff.last_name].filter(Boolean).join(' ') || aff.email || '?',
      email: aff.email,
      linkToken: aff.primary_link_token,
      ftsCount: entries.length,
      medianTtsSec: med,
      meanTtsSec: mean,
      minTtsSec: minV,
      maxTtsSec: maxV,
      // Include a sample to help manual review
      sample: entries
        .sort((a, b) => a.ttsSec - b.ttsSec)
        .slice(0, 5)
        .map(e => ({ email: e.email, ttsSec: e.ttsSec, signupAt: e.signupAt, ftsAt: e.ftsAt })),
    });
  }

  // Sort: shortest median TTS first (most suspicious)
  result.sort((a, b) => {
    if (b.ftsCount !== a.ftsCount && (a.ftsCount < 2 || b.ftsCount < 2)) return b.ftsCount - a.ftsCount;
    return (a.medianTtsSec ?? Infinity) - (b.medianTtsSec ?? Infinity);
  });

  return NextResponse.json({
    window: { from: from.toISOString(), to: to.toISOString() },
    totalFts: ftsByEmail.size,
    matchedFts: byAffiliate.size === 0 ? 0 : [...byAffiliate.values()].reduce((s, v) => s + v.length, 0),
    overall: computeOverall(ftsByEmail),
    affiliates: result,
  });
}

function computeOverall(ftsMap: Map<string, { ttsSec: number }>) {
  const all = [...ftsMap.values()].map(v => v.ttsSec).filter(s => isFinite(s));
  if (all.length === 0) return { medianTtsSec: null, mean: null, count: 0 };
  const med = median(all);
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  return { medianTtsSec: med, mean, count: all.length };
}
