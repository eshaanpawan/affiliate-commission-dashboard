import { NextRequest, NextResponse } from 'next/server';

import sql from '@/lib/db';
import { dashboardRangeStart, isDashboardRange } from '@/lib/dashboard-range';
import { isAuthed } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const requestedRange = req.nextUrl.searchParams.get('period');
  const range = isDashboardRange(requestedRange) ? requestedRange : 'all';
  const cutoff = dashboardRangeStart(range);

  const [
    affiliateStats,
    referralStats,
    revenueStats,
    commissionStats,
    payoutStats,
    dailyAffiliates,
    dailyReferrals,
    dailyRevenue,
    dailyCommissions,
    affiliateList,
    recentEvents,
    rangeLeaderboard,
    topByReferrals,
    topByConversions,
    monthlyReferrals,
    monthlyRevenue,
    monthlyCommissions,
    countriesByConversions,
    affiliateCountryRows,
    adRunnerStats,
    signupStats,
    freshness,
  ] = await Promise.all([
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status <> 'deleted') AS total,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'suspicious') AS suspicious,
        COUNT(*) FILTER (WHERE status IN ('disabled', 'inactive')) AS disabled,
        COUNT(*) FILTER (
          WHERE status <> 'deleted'
            AND NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '') IS NULL
        ) AS unnamed,
        COUNT(*) FILTER (
          WHERE status <> 'deleted'
            AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        ) AS new_in_window,
        COUNT(*) FILTER (
          WHERE status <> 'deleted' AND created_at >= CURRENT_DATE
        ) AS onboarded_today,
        COUNT(*) FILTER (
          WHERE status <> 'deleted' AND (
            status = 'suspicious'
            OR review_status IN ('flagged', 'paused')
            OR COALESCE(risk_score, 0) >= 60
          )
        ) AS fraud_affiliates,
        COALESCE(SUM(visitors) FILTER (WHERE status <> 'deleted'), 0) AS source_referrals,
        COALESCE(SUM(
          CASE WHEN COALESCE(source, 'rewardful') = 'dub' THEN leads
               ELSE leads + conversions END
        ) FILTER (WHERE status <> 'deleted'), 0) AS source_signups,
        COALESCE(SUM(conversions) FILTER (WHERE status <> 'deleted'), 0) AS source_conversions,
        COUNT(*) FILTER (WHERE status <> 'deleted' AND source = 'dub') AS dub_affiliates
      FROM affiliates
    `,
    sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'converted') AS converted
      FROM referrals
      WHERE status <> 'deleted'
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
    `,
    sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_cents,
        COUNT(DISTINCT affiliate_id) FILTER (WHERE affiliate_id IS NOT NULL) AS earning_affiliates
      FROM sales
      WHERE status = 'created'
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
    `,
    sql`
      SELECT
        COALESCE(SUM(amount_cents), 0) AS total_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid_cents
      FROM commissions
      WHERE status NOT IN ('deleted', 'voided')
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
    `,
    sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS pending_cents
      FROM payouts
      WHERE status IN ('created', 'pending', 'due', 'processing')
    `,
    sql`
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM affiliates
      WHERE status <> 'deleted'
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    sql`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'converted') AS converted
      FROM referrals
      WHERE status <> 'deleted'
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    sql`
      SELECT DATE(created_at) AS day, COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM sales
      WHERE status = 'created'
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    sql`
      SELECT DATE(created_at) AS day, COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM commissions
      WHERE status NOT IN ('deleted', 'voided')
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    sql`
      WITH token_owner AS (
        SELECT DISTINCT ON (link_token) link_token, affiliate_id
        FROM referrals
        WHERE link_token IS NOT NULL AND affiliate_id IS NOT NULL
        ORDER BY link_token, created_at ASC
      ), posthog AS (
        SELECT
          token_owner.affiliate_id,
          COALESCE(SUM(t.pageviews), 0) AS pageviews,
          COALESCE(SUM(t.signups), 0) AS posthog_signups,
          COALESCE(SUM(t.fts), 0) AS fts,
          COALESCE(SUM(t.signups_with_any_ad_param), 0) AS ad_signups
        FROM affiliate_traffic t
        JOIN token_owner ON token_owner.link_token = t.via_token
        WHERE (${cutoff}::timestamptz IS NULL OR t.day >= ${cutoff}::date)
        GROUP BY token_owner.affiliate_id
      ), referral_rollup AS (
        SELECT
          affiliate_id,
          COUNT(*) AS referrals,
          COUNT(*) FILTER (WHERE status IN ('lead', 'converted')) AS signups,
          COUNT(*) FILTER (WHERE status = 'converted') AS conversions,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS referrals_today,
          COUNT(*) FILTER (WHERE status = 'converted' AND converted_at >= CURRENT_DATE) AS conversions_today
        FROM referrals
        WHERE status <> 'deleted'
          AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        GROUP BY affiliate_id
      ), revenue_rollup AS (
        SELECT affiliate_id, SUM(amount_cents) AS revenue_cents
        FROM sales
        WHERE status = 'created'
          AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        GROUP BY affiliate_id
      ), token_counts AS (
        SELECT affiliate_id, link_token, COUNT(*) AS count
        FROM referrals
        WHERE link_token IS NOT NULL AND affiliate_id IS NOT NULL
        GROUP BY affiliate_id, link_token
      ), links_agg AS (
        SELECT
          affiliate_id,
          (ARRAY_AGG(link_token ORDER BY count DESC))[1] AS primary_link_token,
          JSONB_AGG(JSONB_BUILD_OBJECT('token', link_token, 'count', count) ORDER BY count DESC) AS link_tokens
        FROM token_counts
        GROUP BY affiliate_id
      ), commission_rollup AS (
        SELECT affiliate_id, SUM(amount_cents) AS commission_cents
        FROM commissions
        WHERE status NOT IN ('deleted', 'voided')
          AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        GROUP BY affiliate_id
      )
      SELECT
        a.rewardful_id, a.first_name, a.last_name, a.email, a.status, a.created_at,
        COALESCE(a.source, 'rewardful') AS source,
        a.visitors AS source_visitors, a.leads AS source_leads, a.conversions AS source_conversions,
        COALESCE(r.referrals, 0) AS referrals,
        COALESCE(r.signups, 0) AS signups,
        COALESCE(r.conversions, 0) AS conversions,
        COALESCE(r.referrals_today, 0) AS referrals_today,
        COALESCE(r.conversions_today, 0) AS conversions_today,
        COALESCE(s.revenue_cents, 0) AS revenue_cents,
        COALESCE(c.commission_cents, 0) AS commission_cents,
        COALESCE(p.pageviews, 0) AS posthog_pageviews,
        COALESCE(p.posthog_signups, 0) AS posthog_signups,
        COALESCE(p.fts, 0) AS posthog_fts,
        COALESCE(p.ad_signups, 0) AS ad_signups,
        links.primary_link_token,
        links.link_tokens,
        COALESCE(a.fraud_tags, '[]'::jsonb) AS fraud_tags
      FROM affiliates a
      LEFT JOIN referral_rollup r ON r.affiliate_id = a.rewardful_id
      LEFT JOIN revenue_rollup s ON s.affiliate_id = a.rewardful_id
      LEFT JOIN commission_rollup c ON c.affiliate_id = a.rewardful_id
      LEFT JOIN posthog p ON p.affiliate_id = a.rewardful_id
      LEFT JOIN links_agg links ON links.affiliate_id = a.rewardful_id
      WHERE a.status <> 'deleted'
      ORDER BY COALESCE(r.conversions, 0) DESC, COALESCE(r.referrals, 0) DESC, a.created_at DESC
    `,
    sql`
      SELECT event_type, received_at, event_id
      FROM webhook_events
      ORDER BY received_at DESC
      LIMIT 20
    `,
    sql`
      SELECT
        a.rewardful_id, a.first_name, a.last_name, a.email,
        CASE WHEN ${cutoff}::timestamptz IS NULL
          THEN COALESCE(a.conversions, 0)
          ELSE COUNT(DISTINCT r.rewardful_id) FILTER (WHERE r.status = 'converted')
        END AS conversions_this_week,
        CASE WHEN ${cutoff}::timestamptz IS NULL
          THEN COALESCE(a.visitors, 0)
          ELSE COUNT(DISTINCT r.rewardful_id)
        END AS referrals_this_week
      FROM affiliates a
      LEFT JOIN referrals r
        ON r.affiliate_id = a.rewardful_id
        AND r.status <> 'deleted'
        AND (${cutoff}::timestamptz IS NULL OR r.created_at >= ${cutoff}::timestamptz)
      WHERE a.status <> 'deleted'
      GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, a.visitors, a.conversions
      HAVING CASE WHEN ${cutoff}::timestamptz IS NULL
        THEN COALESCE(a.visitors, 0)
        ELSE COUNT(r.rewardful_id)
      END > 0
      ORDER BY conversions_this_week DESC, referrals_this_week DESC
      LIMIT 100
    `,
    sql`
      SELECT a.rewardful_id, a.first_name, a.last_name, a.email,
        CASE WHEN ${cutoff}::timestamptz IS NULL
          THEN COALESCE(a.visitors, 0)
          ELSE COUNT(DISTINCT r.rewardful_id)
        END AS referrals
      FROM affiliates a
      LEFT JOIN referrals r
        ON r.affiliate_id = a.rewardful_id
        AND r.status <> 'deleted'
        AND (${cutoff}::timestamptz IS NULL OR r.created_at >= ${cutoff}::timestamptz)
      WHERE a.status <> 'deleted'
      GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, a.visitors
      HAVING CASE WHEN ${cutoff}::timestamptz IS NULL
        THEN COALESCE(a.visitors, 0)
        ELSE COUNT(r.rewardful_id)
      END > 0
      ORDER BY referrals DESC
      LIMIT 10
    `,
    sql`
      SELECT
        a.rewardful_id, a.first_name, a.last_name, a.email,
        CASE WHEN ${cutoff}::timestamptz IS NULL
          THEN COALESCE(a.conversions, 0)
          ELSE COUNT(DISTINCT r.rewardful_id) FILTER (WHERE r.status = 'converted')
        END AS conversions
      FROM affiliates a
      LEFT JOIN referrals r
        ON r.affiliate_id = a.rewardful_id
        AND r.status <> 'deleted'
        AND (${cutoff}::timestamptz IS NULL OR r.created_at >= ${cutoff}::timestamptz)
      WHERE a.status <> 'deleted'
      GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, a.conversions
      HAVING CASE WHEN ${cutoff}::timestamptz IS NULL
        THEN COALESCE(a.conversions, 0)
        ELSE COUNT(*) FILTER (WHERE r.status = 'converted')
      END > 0
      ORDER BY conversions DESC
      LIMIT 10
    `,
    sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(*) AS referrals,
        COUNT(*) FILTER (WHERE status = 'converted') AS conversions
      FROM referrals
      WHERE status <> 'deleted'
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `,
    sql`
      SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount_cents), 0) AS revenue_cents
      FROM sales
      WHERE status = 'created'
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `,
    sql`
      SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount_cents), 0) AS commission_cents
      FROM commissions
      WHERE status NOT IN ('deleted', 'voided')
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `,
    sql`
      SELECT country_name, country_code, COUNT(*) AS conversions
      FROM referrals
      WHERE status = 'converted' AND country_code IS NOT NULL
        AND (${cutoff}::timestamptz IS NULL OR COALESCE(converted_at, created_at) >= ${cutoff}::timestamptz)
      GROUP BY country_name, country_code
      ORDER BY conversions DESC
      LIMIT 20
    `,
    sql`
      SELECT
        a.rewardful_id AS affiliate_id, a.first_name, a.last_name, a.email,
        r.country_code, r.country_name, COUNT(*) AS conversions
      FROM referrals r
      JOIN affiliates a ON a.rewardful_id = r.affiliate_id
      WHERE r.status = 'converted' AND r.country_code IS NOT NULL
        AND (${cutoff}::timestamptz IS NULL OR COALESCE(r.converted_at, r.created_at) >= ${cutoff}::timestamptz)
      GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, r.country_code, r.country_name
      ORDER BY a.email, conversions DESC
    `,
    sql`
      SELECT COUNT(DISTINCT token_owner.affiliate_id) AS ad_running_affiliates
      FROM affiliate_traffic t
      JOIN (
        SELECT DISTINCT ON (link_token) link_token, affiliate_id
        FROM referrals
        WHERE link_token IS NOT NULL AND affiliate_id IS NOT NULL
        ORDER BY link_token, created_at ASC
      ) token_owner ON token_owner.link_token = t.via_token
      WHERE t.signups_with_any_ad_param > 0
        AND (${cutoff}::timestamptz IS NULL OR t.day >= ${cutoff}::date)
    `,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('lead', 'converted')) AS signups
      FROM referrals
      WHERE status <> 'deleted'
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
    `,
    sql`
      SELECT
        (SELECT MAX(updated_at) FROM affiliates) AS rewardful_synced_at,
        (SELECT MAX(synced_at) FROM affiliate_traffic) AS posthog_synced_at
    `,
  ]);

  const monthMap = new Map<string, {
    month: string;
    referrals: number;
    conversions: number;
    revenueCents: number;
    commissionCents: number;
  }>();
  for (const row of monthlyReferrals) {
    monthMap.set(String(row.month), {
      month: String(row.month),
      referrals: Number(row.referrals),
      conversions: Number(row.conversions),
      revenueCents: 0,
      commissionCents: 0,
    });
  }
  for (const row of monthlyRevenue) {
    const key = String(row.month);
    const value = monthMap.get(key) ?? { month: key, referrals: 0, conversions: 0, revenueCents: 0, commissionCents: 0 };
    value.revenueCents = Number(row.revenue_cents);
    monthMap.set(key, value);
  }
  for (const row of monthlyCommissions) {
    const key = String(row.month);
    const value = monthMap.get(key) ?? { month: key, referrals: 0, conversions: 0, revenueCents: 0, commissionCents: 0 };
    value.commissionCents = Number(row.commission_cents);
    monthMap.set(key, value);
  }

  const affiliateCountryMap = new Map<string, {
    affiliate_id: string;
    name: string;
    email: string;
    total: number;
    countries: { country_code: string; country_name: string; conversions: number }[];
  }>();
  for (const row of affiliateCountryRows) {
    const id = String(row.affiliate_id);
    const value = affiliateCountryMap.get(id) ?? {
      affiliate_id: id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.email),
      email: String(row.email),
      total: 0,
      countries: [],
    };
    const conversions = Number(row.conversions);
    value.total += conversions;
    value.countries.push({
      country_code: String(row.country_code),
      country_name: String(row.country_name),
      conversions,
    });
    affiliateCountryMap.set(id, value);
  }

  const generatedAt = new Date().toISOString();
  const overviewRow = affiliateStats[0];
  const freshnessRow = freshness[0];

  return NextResponse.json({
    meta: {
      range,
      from: cutoff,
      generatedAt,
      lastRewardfulSyncAt: freshnessRow?.rewardful_synced_at ?? null,
      lastPosthogSyncAt: freshnessRow?.posthog_synced_at ?? null,
      rowLevelReferralCount: Number(referralStats[0]?.total ?? 0),
      sourceReferralCount: Number(overviewRow?.source_referrals ?? 0),
      rowLevelCoveragePct: Number(overviewRow?.source_referrals ?? 0) > 0
        ? Number(referralStats[0]?.total ?? 0) / Number(overviewRow.source_referrals)
        : null,
    },
    overview: {
      totalAffiliates: Number(overviewRow?.total ?? 0),
      activeAffiliates: Number(overviewRow?.active ?? 0),
      suspiciousAffiliates: Number(overviewRow?.suspicious ?? 0),
      disabledAffiliates: Number(overviewRow?.disabled ?? 0),
      unnamedAffiliates: Number(overviewRow?.unnamed ?? 0),
      newAffiliates: Number(overviewRow?.new_in_window ?? 0),
      onboardedToday: Number(overviewRow?.onboarded_today ?? 0),
      fraudAffiliates: Number(overviewRow?.fraud_affiliates ?? 0),
      dubAffiliates: Number(overviewRow?.dub_affiliates ?? 0),
      adRunningAffiliates: Number(adRunnerStats[0]?.ad_running_affiliates ?? 0),
      totalSignups: range === 'all'
        ? Number(overviewRow?.source_signups ?? 0)
        : Number(signupStats[0]?.signups ?? 0),
      totalReferrals: range === 'all'
        ? Number(overviewRow?.source_referrals ?? 0)
        : Number(referralStats[0]?.total ?? 0),
      convertedReferrals: range === 'all'
        ? Number(overviewRow?.source_conversions ?? 0)
        : Number(referralStats[0]?.converted ?? 0),
      totalRevenueCents: Number(revenueStats[0]?.total_cents ?? 0),
      earningAffiliates: Number(revenueStats[0]?.earning_affiliates ?? 0),
      totalCommissionCents: Number(commissionStats[0]?.total_cents ?? 0),
      paidCommissionCents: Number(commissionStats[0]?.paid_cents ?? 0),
      pendingPayoutCents: Number(payoutStats[0]?.pending_cents ?? 0),
    },
    charts: {
      dailyAffiliates: dailyAffiliates.map((row) => ({ day: row.day, count: Number(row.count) })),
      dailyReferrals: dailyReferrals.map((row) => ({ day: row.day, total: Number(row.total), converted: Number(row.converted) })),
      dailyRevenue: dailyRevenue.map((row) => ({ day: row.day, usd: Number(row.total_cents) / 100 })),
      dailyCommissions: dailyCommissions.map((row) => ({ day: row.day, usd: Number(row.total_cents) / 100 })),
    },
    affiliates: affiliateList.map((row) => ({
      id: String(row.rewardful_id),
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.email),
      email: String(row.email ?? ''),
      status: String(row.status),
      source: String(row.source ?? 'rewardful'),
      createdAt: String(row.created_at),
      referrals: range === 'all' ? Number(row.source_visitors ?? 0) : Number(row.referrals),
      // Rewardful's leads counter drops converted customers; add them back so
      // per-affiliate all-time sign-ups can never be below conversions.
      signups: range === 'all'
        ? Number(row.source_leads ?? 0) + (String(row.source ?? 'rewardful') === 'dub' ? 0 : Number(row.source_conversions ?? 0))
        : Number(row.signups),
      conversions: range === 'all' ? Number(row.source_conversions ?? 0) : Number(row.conversions),
      referralsToday: Number(row.referrals_today),
      conversionsToday: Number(row.conversions_today),
      revenueCents: Number(row.revenue_cents),
      commissionCents: Number(row.commission_cents),
      posthogPageviews: Number(row.posthog_pageviews),
      posthogSignups: Number(row.posthog_signups),
      posthogFts: Number(row.posthog_fts),
      adDrivenSignups: Number(row.ad_signups),
      linkToken: row.primary_link_token ? String(row.primary_link_token) : null,
      linkTokens: Array.isArray(row.link_tokens) ? row.link_tokens : [],
      fraudTags: Array.isArray(row.fraud_tags) ? row.fraud_tags : [],
    })),
    recentActivity: recentEvents,
    monthly: Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    weeklyLeaderboard: rangeLeaderboard.map((row, index) => ({
      rank: index + 1,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.email),
      email: String(row.email ?? ''),
      conversionsThisWeek: Number(row.conversions_this_week),
      referralsThisWeek: Number(row.referrals_this_week),
    })),
    topByReferrals: topByReferrals.map((row) => ({
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.email),
      value: Number(row.referrals),
    })),
    topByConversions: topByConversions.map((row) => ({
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.email),
      value: Number(row.conversions),
    })),
    countriesByConversions: countriesByConversions.map((row) => ({
      country_code: String(row.country_code),
      country_name: String(row.country_name),
      conversions: Number(row.conversions),
    })),
    affiliateCountries: Array.from(affiliateCountryMap.values()).sort((a, b) => b.total - a.total),
  });
}
