import { NextResponse, NextRequest } from 'next/server';
import sql from '@/lib/db';

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get('period') ?? 'all';
  const intervalMap: Record<string, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };
  const interval = intervalMap[period];
  // dateFilter is applied to time-sensitive overview queries when a period is selected
  const cutoff = interval ? new Date(Date.now() - (period === '7d' ? 7 : period === '30d' ? 30 : 90) * 86400000).toISOString() : null;

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
    weeklyLeaderboard,
    topByReferrals,
    topByConversions,
    monthlyReferrals,
    monthlyRevenue,
    monthlyCommissions,
    countriesByConversions,
    affiliateCountryRows,
  ] = await Promise.all([
    // Overview: affiliate counts
    cutoff ? sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status != 'inactive' AND status != 'deleted' THEN 1 END) AS active
      FROM affiliates
      WHERE created_at >= ${cutoff}
    ` : sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status != 'inactive' AND status != 'deleted' THEN 1 END) AS active
      FROM affiliates
    `,
    // Overview: referral counts
    cutoff ? sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) AS converted
      FROM referrals
      WHERE status != 'deleted' AND created_at >= ${cutoff}
    ` : sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) AS converted
      FROM referrals
      WHERE status != 'deleted'
    `,
    // Overview: revenue
    cutoff ? sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM sales
      WHERE status = 'created' AND created_at >= ${cutoff}
    ` : sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM sales
      WHERE status = 'created'
    `,
    // Overview: commissions (unpaid_commission_cents is current state, not time-filterable; use commissions table for period)
    cutoff ? sql`
      SELECT
        COALESCE(SUM(amount_cents), 0) AS total_cents,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS paid_cents
      FROM commissions
      WHERE status NOT IN ('deleted', 'voided') AND created_at >= ${cutoff}
    ` : sql`
      SELECT
        COALESCE(SUM(unpaid_commission_cents + paid_commission_cents), 0) AS total_cents,
        COALESCE(SUM(paid_commission_cents), 0) AS paid_cents
      FROM affiliates
      WHERE status != 'deleted'
    `,
    // Overview: pending payouts
    sql`
      SELECT COALESCE(SUM(amount_cents), 0) AS pending_cents
      FROM payouts
      WHERE status IN ('created', 'due')
    `,
    // Day-on-day: new affiliates (last 30 days)
    sql`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS count
      FROM affiliates
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    // Day-on-day: referrals + conversions (last 30 days)
    sql`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) AS converted
      FROM referrals
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND status != 'deleted'
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    // Day-on-day: revenue per day (last 30 days)
    sql`
      SELECT
        DATE(created_at) AS day,
        COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM sales
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND status = 'created'
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    // Day-on-day: commissions per day (last 30 days)
    sql`
      SELECT
        DATE(created_at) AS day,
        COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM commissions
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND status NOT IN ('deleted', 'voided')
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    // Affiliates table
    sql`
      SELECT
        a.rewardful_id,
        a.first_name,
        a.last_name,
        a.email,
        a.status,
        a.created_at,
        COALESCE(r_stats.referrals, 0) AS referrals,
        COALESCE(r_stats.conversions, 0) AS conversions,
        COALESCE(r_stats.referrals_today, 0) AS referrals_today,
        COALESCE(r_stats.conversions_today, 0) AS conversions_today,
        COALESCE(s_stats.revenue_cents, 0) AS revenue_cents,
        a.unpaid_commission_cents AS commission_cents
      FROM affiliates a
      LEFT JOIN (
        SELECT
          affiliate_id,
          COUNT(*) AS referrals,
          COUNT(CASE WHEN status = 'converted' THEN 1 END) AS conversions,
          COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) AS referrals_today,
          COUNT(CASE WHEN status = 'converted' AND converted_at >= CURRENT_DATE THEN 1 END) AS conversions_today
        FROM referrals WHERE status != 'deleted'
        GROUP BY affiliate_id
      ) r_stats ON r_stats.affiliate_id = a.rewardful_id
      LEFT JOIN (
        SELECT affiliate_id, SUM(amount_cents) AS revenue_cents
        FROM sales WHERE status = 'created'
        GROUP BY affiliate_id
      ) s_stats ON s_stats.affiliate_id = a.rewardful_id
      WHERE a.status != 'deleted'
      ORDER BY conversions DESC, referrals DESC
    `,
    // Recent activity
    sql`
      SELECT event_type, received_at, event_id
      FROM webhook_events
      ORDER BY received_at DESC
      LIMIT 20
    `,
    // Weekly leaderboard
    sql`
      SELECT
        a.first_name, a.last_name, a.email,
        COUNT(DISTINCT CASE WHEN r.status = 'converted' AND r.converted_at >= DATE_TRUNC('week', NOW()) THEN r.rewardful_id END) AS conversions_this_week,
        COUNT(DISTINCT CASE WHEN r.created_at >= DATE_TRUNC('week', NOW()) THEN r.rewardful_id END) AS referrals_this_week
      FROM affiliates a
      LEFT JOIN referrals r ON r.affiliate_id = a.rewardful_id
      WHERE a.status != 'deleted'
      GROUP BY a.first_name, a.last_name, a.email
      ORDER BY conversions_this_week DESC, referrals_this_week DESC
      LIMIT 10
    `,
    // Top affiliates by referrals (for pie chart)
    sql`
      SELECT
        a.first_name, a.last_name, a.email,
        COUNT(DISTINCT r.rewardful_id) AS referrals
      FROM affiliates a
      LEFT JOIN referrals r ON r.affiliate_id = a.rewardful_id AND r.status != 'deleted'
      WHERE a.status != 'deleted'
      GROUP BY a.first_name, a.last_name, a.email
      ORDER BY referrals DESC
      LIMIT 15
    `,
    // Top affiliates by conversions (for pie chart)
    sql`
      SELECT
        a.first_name, a.last_name, a.email,
        COUNT(DISTINCT CASE WHEN r.status = 'converted' THEN r.rewardful_id END) AS conversions
      FROM affiliates a
      LEFT JOIN referrals r ON r.affiliate_id = a.rewardful_id
      WHERE a.status != 'deleted'
      GROUP BY a.first_name, a.last_name, a.email
      ORDER BY conversions DESC
      LIMIT 15
    `,
    // Monthly referrals + conversions (all time)
    sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(*) AS referrals,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) AS conversions
      FROM referrals
      WHERE status != 'deleted'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `,
    // Monthly revenue (all time)
    sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount_cents), 0) AS revenue_cents
      FROM sales
      WHERE status = 'created'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `,
    // Monthly commissions (all time)
    sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COALESCE(SUM(amount_cents), 0) AS commission_cents
      FROM commissions
      WHERE status NOT IN ('deleted', 'voided')
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `,
    // Countries by conversions
    sql`
      SELECT
        country_name,
        country_code,
        COUNT(*) AS conversions
      FROM referrals
      WHERE status = 'converted'
        AND country_code IS NOT NULL
      GROUP BY country_name, country_code
      ORDER BY conversions DESC
      LIMIT 20
    `,
    // Affiliate x country breakdown
    sql`
      SELECT
        a.rewardful_id AS affiliate_id,
        a.first_name,
        a.last_name,
        a.email,
        r.country_code,
        r.country_name,
        COUNT(*) AS conversions
      FROM referrals r
      JOIN affiliates a ON a.rewardful_id = r.affiliate_id
      WHERE r.status = 'converted'
        AND r.country_code IS NOT NULL
      GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, r.country_code, r.country_name
      ORDER BY a.email, conversions DESC
    `,
  ]);

  // Merge monthly data by month key
  const monthMap = new Map<string, { month: string; referrals: number; conversions: number; revenueCents: number; commissionCents: number }>();
  for (const r of monthlyReferrals) {
    monthMap.set(String(r.month), { month: String(r.month), referrals: Number(r.referrals), conversions: Number(r.conversions), revenueCents: 0, commissionCents: 0 });
  }
  for (const r of monthlyRevenue) {
    const key = String(r.month);
    const entry = monthMap.get(key) ?? { month: key, referrals: 0, conversions: 0, revenueCents: 0, commissionCents: 0 };
    entry.revenueCents = Number(r.revenue_cents);
    monthMap.set(key, entry);
  }
  for (const r of monthlyCommissions) {
    const key = String(r.month);
    const entry = monthMap.get(key) ?? { month: key, referrals: 0, conversions: 0, revenueCents: 0, commissionCents: 0 };
    entry.commissionCents = Number(r.commission_cents);
    monthMap.set(key, entry);
  }
  const monthly = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  return NextResponse.json({
    overview: {
      totalAffiliates: Number(affiliateStats[0]?.total ?? 0),
      activeAffiliates: Number(affiliateStats[0]?.active ?? 0),
      totalReferrals: Number(referralStats[0]?.total ?? 0),
      convertedReferrals: Number(referralStats[0]?.converted ?? 0),
      totalRevenueCents: Number(revenueStats[0]?.total_cents ?? 0),
      totalCommissionCents: Number(commissionStats[0]?.total_cents ?? 0),
      paidCommissionCents: Number(commissionStats[0]?.paid_cents ?? 0),
      pendingPayoutCents: Number(payoutStats[0]?.pending_cents ?? 0),
    },
    charts: {
      dailyAffiliates: dailyAffiliates.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
      dailyReferrals: dailyReferrals.map((r) => ({
        day: r.day,
        total: Number(r.total),
        converted: Number(r.converted),
      })),
      dailyRevenue: dailyRevenue.map((r) => ({
        day: r.day,
        usd: Number(r.total_cents) / 100,
      })),
      dailyCommissions: dailyCommissions.map((r) => ({
        day: r.day,
        usd: Number(r.total_cents) / 100,
      })),
    },
    affiliates: affiliateList.map((a) => ({
      id: a.rewardful_id,
      name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email,
      email: a.email,
      status: a.status,
      createdAt: a.created_at,
      referrals: Number(a.referrals),
      conversions: Number(a.conversions),
      referralsToday: Number(a.referrals_today),
      conversionsToday: Number(a.conversions_today),
      revenueCents: Number(a.revenue_cents),
      commissionCents: Number(a.commission_cents),
    })),
    recentActivity: recentEvents,
    monthly,
    weeklyLeaderboard: weeklyLeaderboard.map((a, i) => ({
      rank: i + 1,
      name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email,
      email: a.email,
      conversionsThisWeek: Number(a.conversions_this_week),
      referralsThisWeek: Number(a.referrals_this_week),
    })),
    topByReferrals: topByReferrals.map((a) => ({
      name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email,
      value: Number(a.referrals),
    })),
    topByConversions: topByConversions.map((a) => ({
      name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email,
      value: Number(a.conversions),
    })),
    countriesByConversions: countriesByConversions.map((r) => ({
      country_code: r.country_code as string,
      country_name: r.country_name as string,
      conversions: Number(r.conversions),
    })),
    affiliateCountries: (() => {
      const map = new Map<string, { affiliate_id: string; name: string; email: string; total: number; countries: { country_code: string; country_name: string; conversions: number }[] }>();
      for (const r of affiliateCountryRows) {
        const key = r.affiliate_id as string;
        if (!map.has(key)) {
          map.set(key, {
            affiliate_id: key,
            name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email as string,
            email: r.email as string,
            total: 0,
            countries: [],
          });
        }
        const entry = map.get(key)!;
        const count = Number(r.conversions);
        entry.total += count;
        entry.countries.push({ country_code: r.country_code as string, country_name: r.country_name as string, conversions: count });
      }
      return Array.from(map.values()).sort((a, b) => b.total - a.total);
    })(),
  });
}
