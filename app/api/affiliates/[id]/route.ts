import { NextResponse } from 'next/server';
import sql from '@/lib/db';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const [dailyReferrals, dailyRevenue, dailyCommissions] = await Promise.all([
    sql`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) AS converted
      FROM referrals
      WHERE affiliate_id = ${id}
        AND created_at >= NOW() - INTERVAL '30 days'
        AND status != 'deleted'
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    sql`
      SELECT
        DATE(created_at) AS day,
        COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM sales
      WHERE affiliate_id = ${id}
        AND created_at >= NOW() - INTERVAL '30 days'
        AND status = 'created'
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
    sql`
      SELECT
        DATE(created_at) AS day,
        COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM commissions
      WHERE affiliate_id = ${id}
        AND created_at >= NOW() - INTERVAL '30 days'
        AND status NOT IN ('deleted', 'voided')
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
  ]);

  return NextResponse.json({
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
  });
}
