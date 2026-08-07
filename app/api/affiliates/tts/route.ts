import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { getFunnelTimingsForFTS, getFunnelCountsBySource, FunnelTiming } from '@/lib/posthog';
import { isAuthed } from '@/lib/auth';

// PostHog HogQL queries can take 15-30s for a 2-month window — beyond the
// default 10s Vercel limit. Set explicit 60s ceiling.
export const maxDuration = 60;

// Light in-memory cache keyed by window (5-minute TTL). Survives within a
// warm function instance; cold starts will repeat the work.
const CACHE = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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
// Similar timing to the Google baseline is a review-prioritization signal. It
// is not proof that an affiliate placed an ad; the War Room combines it with
// campaign overlap, URL evidence, geography, and payout exposure.

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
  signups: number;                 // PostHog sign_up count (REAL signups, not Rewardful's broken 'lead')
  fts: number;                     // count of users who hit FTS
  pvToSignupRate: number | null;   // signups / pageviews
  signupToFtsRate: number | null;  // fts / signups (the SU→FTS rate)
  signupToFtsSecMedian: number | null;
  googleSimilarity?: number | null;
  countries?: { code: string; name: string; count: number }[];
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

// Strict "Google brand-search Ad" classifier — matches Runable's SER_BRAND campaign
// (campaign_id 23280363543). Both old (`googleads`) and new (`google_ads`) utm_source
// tags are accepted. utm_campaign must be exactly 'brand'.
function isGoogleBrandSearch(t: FunnelTiming): boolean {
  const src = (t.initialUtmSource ?? '').toLowerCase();
  const campaign = (t.initialUtmCampaign ?? '').toLowerCase();
  if (campaign !== 'brand') return false;
  return src === 'googleads' || src === 'google_ads';
}

function rateOrNull(n: number, d: number | null): number | null {
  if (d === null || d === 0) return null;
  // Server-side signup events can exist without a client-side pageview inside
  // the same reporting window. That is an instrumentation coverage gap, not a
  // conversion rate above 100%, so leave the rate unreported.
  if (n > d) return null;
  return n / d;
}

export async function GET(req: NextRequest) {
  const bearer = req.headers.get('authorization');
  const cronOk = !!process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk && !(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  // Default = all-time (Runable's earliest data starts late 2025; 2027 is a future ceiling)
  const fromStr = sp.get('from') ?? '2025-01-01';
  const toStr = sp.get('to') ?? '2027-01-01';
  const from = new Date(fromStr + (fromStr.includes('T') ? '' : 'T00:00:00Z'));
  const to = new Date(toStr + (toStr.includes('T') ? '' : 'T00:00:00Z'));

  const force = sp.get('force') === '1';
  const cacheKey = `tts:${from.toISOString()}|${to.toISOString()}`;
  const cached = CACHE.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  // Durable Postgres cache: serves instantly across serverless cold starts.
  // The hourly cron re-warms preset windows with force=1, so a <24h row is
  // the freshest computation available without blocking the user.
  if (!force) {
    try {
      const [row] = await sql`
        SELECT payload, generated_at FROM api_cache
        WHERE key = ${cacheKey} AND generated_at > NOW() - INTERVAL '24 hours'
      `;
      if (row?.payload) {
        CACHE.set(cacheKey, { at: Date.now(), data: row.payload });
        return NextResponse.json(row.payload);
      }
    } catch (err) {
      console.error('tts api_cache read failed:', err);
    }
  }

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    return NextResponse.json({ error: 'Invalid date window' }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > 730 * 86_400_000) {
    return NextResponse.json({ error: 'Date window cannot exceed two years' }, { status: 400 });
  }

  // Raw event sequencing is intentionally limited to two HogQL queries. Token
  // counts come from the daily PostHog materialization populated by the cron.
  // This avoids six concurrent warehouse scans and the intermittent 504/empty
  // responses that previously poisoned the browser cache.
  const [timings, sourceCounts, trafficRows, trafficFreshnessRows] = await Promise.all([
    getFunnelTimingsForFTS(from, to),
    getFunnelCountsBySource(from, to),
    sql`
      SELECT via_token,
        COALESCE(SUM(signups), 0) AS signups,
        COALESCE(SUM(pageviews), 0) AS pageviews,
        COALESCE(SUM(fts), 0) AS fts
      FROM affiliate_traffic
      WHERE day >= ${from.toISOString()}::date
        AND day < ${to.toISOString()}::date
      GROUP BY via_token
    `,
    sql`
      SELECT MAX(day) AS data_through, MAX(synced_at) AS last_materialized_at
      FROM affiliate_traffic
      WHERE day >= ${from.toISOString()}::date
        AND day < ${to.toISOString()}::date
    `,
  ]);

  const signupsByToken = new Map<string, number>();
  const pageviewsByToken = new Map<string, number>();
  const ftsByToken = new Map<string, number>();
  for (const row of trafficRows) {
    const token = String(row.via_token);
    signupsByToken.set(token, Number(row.signups));
    pageviewsByToken.set(token, Number(row.pageviews));
    ftsByToken.set(token, Number(row.fts));
  }

  // 2. Resolve all via_tokens (from ftsByToken / signupsByToken / pageviewsByToken)
  // to affiliate IDs via the referrals.link_token column. This is the unified
  // attribution method — Signups, Pageviews, FTS all use it.
  const allTokens = [...new Set([
    ...ftsByToken.keys(),
    ...signupsByToken.keys(),
    ...pageviewsByToken.keys(),
  ])];

  const tokenAffRows = allTokens.length === 0 ? [] : (await sql`
    SELECT DISTINCT ON (link_token)
      link_token,
      a.rewardful_id, a.first_name, a.last_name, a.email
    FROM referrals r
    JOIN affiliates a ON a.rewardful_id = r.affiliate_id
    WHERE r.link_token = ANY(${allTokens}::text[])
      AND r.affiliate_id IS NOT NULL
    ORDER BY link_token, r.created_at ASC
  `) as unknown as (AffiliateRow & { link_token: string })[];

  const tokenToAffId = new Map<string, string>();
  const tokensByAffiliate = new Map<string, string[]>();
  for (const r of tokenAffRows) {
    tokenToAffId.set(r.link_token, r.rewardful_id);
    const list = tokensByAffiliate.get(r.rewardful_id) ?? [];
    list.push(r.link_token);
    tokensByAffiliate.set(r.rewardful_id, list);
  }

  const affiliateIds = [...new Set(tokenAffRows.map(r => r.rewardful_id))];
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

  const countryRows = affiliateIds.length === 0 ? [] : await sql`
    SELECT affiliate_id, country_code, country_name, COUNT(*) AS conversions
    FROM referrals
    WHERE affiliate_id = ANY(${affiliateIds}::text[])
      AND status = 'converted'
      AND country_code IS NOT NULL
      AND created_at >= ${from.toISOString()}::timestamptz
      AND created_at < ${to.toISOString()}::timestamptz
    GROUP BY affiliate_id, country_code, country_name
    ORDER BY conversions DESC
  `;
  const countriesByAffiliate = new Map<string, { code: string; name: string; count: number }[]>();
  for (const row of countryRows) {
    const affiliateId = String(row.affiliate_id);
    const list = countriesByAffiliate.get(affiliateId) ?? [];
    list.push({
      code: String(row.country_code),
      name: String(row.country_name ?? row.country_code),
      count: Number(row.conversions),
    });
    countriesByAffiliate.set(affiliateId, list);
  }

  // 3. Classify and bucket — for the per-user timings (used to compute median
  // Signup→FTS time and similarity vs Google), we still attribute by email to
  // referrals.customer_email since the per-user FTS query no longer carries
  // via_token (too expensive to extract). This means the median time + similarity
  // use email-based attribution while the FTS COUNT uses via_token. Slight
  // inconsistency but the count column (the one user cares about) is now clean.
  const emails = timings.map(t => t.email.toLowerCase());
  const emailRefRows = emails.length === 0 ? [] : (await sql`
    SELECT DISTINCT affiliate_id, LOWER(customer_email) AS customer_email
    FROM referrals
    WHERE LOWER(customer_email) = ANY(${emails}::text[])
      AND affiliate_id IS NOT NULL
  `) as unknown as ReferralCustomer[];
  const emailToAffId = new Map<string, string>();
  for (const r of emailRefRows) {
    if (!emailToAffId.has(r.customer_email)) emailToAffId.set(r.customer_email, r.affiliate_id);
  }

  const googleTimings: FunnelTiming[] = [];
  const restTimings: FunnelTiming[] = [];
  const byAffiliate = new Map<string, FunnelTiming[]>();

  for (const t of timings) {
    const affId = emailToAffId.get(t.email.toLowerCase());
    if (affId) {
      const list = byAffiliate.get(affId) ?? [];
      list.push(t);
      byAffiliate.set(affId, list);
    }
    // Classify by source, NOT by affiliate-attribution — affiliate users still count
    // as Google if their initial source was Google.
    if (isGoogleBrandSearch(t)) {
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

  // 5. Per-affiliate rows. Build for any affiliate that has at least one of:
  //   - signups attributed by via_token
  //   - pageviews attributed by via_token
  //   - FTS attributed by via_token
  //   - per-user timings matched by email (for median + similarity)
  const affIdsToBuild = new Set<string>([
    ...byAffiliate.keys(),
    ...tokenToAffId.values(),
  ]);

  const affiliateRows: FunnelRow[] = [];
  for (const affId of affIdsToBuild) {
    const aff = affMap.get(affId);
    if (!aff) continue;
    const list = byAffiliate.get(affId) ?? [];
    const sf = list.map(t => t.signupToFtsSec).filter((x): x is number => x !== null);
    const med = median(sf);

    // PostHog by-token counts (consistent attribution: $initial_current_url contains ?via=token).
    // Sum across ALL tokens this affiliate owns — not just the primary one.
    const tokens = new Set<string>(tokensByAffiliate.get(affId) ?? []);
    if (aff.primary_link_token) tokens.add(aff.primary_link_token);
    let phSignups = 0, phPageviews = 0, phFts = 0;
    for (const tk of tokens) {
      phSignups += signupsByToken.get(tk) ?? 0;
      phPageviews += pageviewsByToken.get(tk) ?? 0;
      phFts += ftsByToken.get(tk) ?? 0;
    }
    const suToFtsRate = phSignups > 0 ? phFts / phSignups : null;

    // Similarity to Google baseline (uses email-matched per-user timings)
    let similarity: number | null = null;
    if (googleSignupToFts !== null && restSignupToFts !== null && med !== null && list.length >= 2 && googleSignupToFts !== restSignupToFts) {
      const ln = (x: number) => Math.log(Math.max(60, x));
      const dG = Math.abs(ln(med) - ln(googleSignupToFts));
      const dR = Math.abs(ln(med) - ln(restSignupToFts));
      const total = dG + dR;
      similarity = total === 0 ? 0.5 : dR / total;
    }

    const countries = countriesByAffiliate.get(affId) ?? [];

    affiliateRows.push({
      label: [aff.first_name, aff.last_name].filter(Boolean).join(' ') || aff.email || '?',
      source: 'affiliate_specific',
      affiliateId: affId,
      email: aff.email,
      linkToken: aff.primary_link_token,
      pageviews: phPageviews,
      signups: phSignups,
      fts: phFts,  // via_token attribution — consistent with signups + pageviews
      pvToSignupRate: rateOrNull(phSignups, phPageviews),
      signupToFtsRate: suToFtsRate,
      signupToFtsSecMedian: med,
      googleSimilarity: similarity,
      countries,
    });
  }

  // Sort affiliates: highest Google-similarity first, fts count as tiebreaker
  affiliateRows.sort((a, b) => {
    const sa = a.googleSimilarity ?? -1;
    const sb = b.googleSimilarity ?? -1;
    if (sb !== sa) return sb - sa;
    return b.fts - a.fts;
  });

  const googleSuToFtsRate = sourceCounts.google.signups > 0
    ? sourceCounts.google.fts / sourceCounts.google.signups : null;
  const restSuToFtsRate = sourceCounts.other.signups > 0
    ? sourceCounts.other.fts / sourceCounts.other.signups : null;

  const payload = {
    window: { from: from.toISOString(), to: to.toISOString() },
    generatedAt: new Date().toISOString(),
    totalFts: sourceCounts.google.fts + sourceCounts.other.fts,
    overall: {
      signupToFtsSecMedian: overallSignupToFts,
      googleSignupToFtsSecMedian: googleSignupToFts,
      restSignupToFtsSecMedian: restSignupToFts,
      googleFts: googleTimings.length,
      restFts: restTimings.length,
      googleSignups: sourceCounts.google.signups,
      restSignups: sourceCounts.other.signups,
      googleSuToFtsRate,
      restSuToFtsRate,
    },
    baselines: [googleRow, restRow],
    affiliates: affiliateRows,
    quality: {
      materializedTokens: allTokens.length,
      resolvedTokens: tokenAffRows.length,
      tokenCoveragePct: allTokens.length > 0 ? tokenAffRows.length / allTokens.length : null,
      timingRows: timings.length,
      affiliateTimingMatches: [...byAffiliate.values()].reduce((sum, rows) => sum + rows.length, 0),
      affiliateAttributedFts: affiliateRows.reduce((sum, row) => sum + row.fts, 0),
      dataThrough: trafficFreshnessRows[0]?.data_through
        ? new Date(trafficFreshnessRows[0].data_through as string | Date).toISOString()
        : null,
      lastMaterializedAt: trafficFreshnessRows[0]?.last_materialized_at
        ? new Date(trafficFreshnessRows[0].last_materialized_at as string | Date).toISOString()
        : null,
    },
  };
  if (timings.length === 0 && (sourceCounts.google.fts + sourceCounts.other.fts) > 0) {
    Object.assign(payload, {
      note: 'Counts loaded from the PostHog daily materialization, but raw timing analysis is temporarily unavailable. Retry to restore median time and Google-similarity scores.',
    });
  }
  // Cache only when the live timing query is healthy. Materialized counts remain
  // useful on a transient failure, but that degraded result must not linger.
  if (timings.length > 0) {
    CACHE.set(cacheKey, { at: Date.now(), data: payload });
    sql`
      INSERT INTO api_cache (key, payload, generated_at)
      VALUES (${cacheKey}, ${JSON.stringify(payload)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, generated_at = NOW()
    `.catch((err) => console.error('tts api_cache write failed:', err));
  }
  return NextResponse.json(payload);
}
