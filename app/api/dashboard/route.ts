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
  ] = await Promise.all([
    // Overview: affiliate counts
    sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status != 'inactive' AND status != 'deleted') AS active
      FROM affiliates
    `,
    // Overview: referral counts
    sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'converted') AS converted
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
        COALESCE(SUM(amount_cents), 0) FILTER (WHERE status IN ('created', 'paid')) AS total_cents,
        COALESCE(SUM(amount_cents), 0) FILTER (WHERE status = 'paid') AS paid_cents
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
        COUNT(*) FILTER (WHERE status = 'converted') AS converted
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
        COUNT(DISTINCT r.rewardful_id) FILTER (WHERE r.status = 'converted') AS conversions,
        COALESCE(SUM(DISTINCT s.amount_cents), 0) AS revenue_cents,
        COALESCE(SUM(DISTINCT c.amount_cents) FILTER (WHERE c.status NOT IN ('deleted', 'voided')), 0) AS commission_cents
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
  ]);

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
  });
}
