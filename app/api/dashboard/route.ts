import { NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function GET() {
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
    monthlyReferrals,
    monthlyRevenue,
    monthlyCommissions,
  ] = await Promise.all([
    // Overview: affiliate counts
    sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status != 'inactive' AND status != 'deleted' THEN 1 END) AS active
      FROM affiliates
    `,
    // Overview: referral counts
    sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) AS converted
      FROM referrals
      WHERE status != 'deleted'
    `,
    // Overview: revenue
    sql`
      SELECT
        COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM sales
      WHERE status = 'created'
    `,
    // Overview: commissions
    sql`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('created', 'paid') THEN amount_cents ELSE 0 END), 0) AS total_cents,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS paid_cents
      FROM commissions
      WHERE status != 'deleted' AND status != 'voided'
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
        COUNT(DISTINCT r.rewardful_id) AS referrals,
        COUNT(DISTINCT CASE WHEN r.status = 'converted' THEN r.rewardful_id END) AS conversions,
        COALESCE(SUM(DISTINCT s.amount_cents), 0) AS revenue_cents,
        COALESCE(SUM(DISTINCT CASE WHEN c.status NOT IN ('deleted', 'voided') THEN c.amount_cents END), 0) AS commission_cents
      FROM affiliates a
      LEFT JOIN referrals r ON r.affiliate_id = a.rewardful_id
      LEFT JOIN sales s ON s.affiliate_id = a.rewardful_id AND s.status = 'created'
      LEFT JOIN commissions c ON c.affiliate_id = a.rewardful_id
      WHERE a.status != 'deleted'
      GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, a.status, a.created_at
      ORDER BY revenue_cents DESC
      LIMIT 50
    `,
    // Recent activity
    sql`
      SELECT event_type, received_at, event_id
      FROM webhook_events
      ORDER BY received_at DESC
      LIMIT 20
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
      revenueCents: Number(a.revenue_cents),
      commissionCents: Number(a.commission_cents),
    })),
    recentActivity: recentEvents,
    monthly,
  });
}
