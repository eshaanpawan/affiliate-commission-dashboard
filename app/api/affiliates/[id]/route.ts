import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isAuthed } from '@/lib/auth';
import { dashboardRangeStart, isDashboardRange } from '@/lib/dashboard-range';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const requestedRange = req.nextUrl.searchParams.get('period');
  const range = isDashboardRange(requestedRange) ? requestedRange : '30d';
  const cutoff = dashboardRangeStart(range);

  const [dailyReferrals, dailyRevenue, dailyCommissions] = await Promise.all([
    sql`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) AS converted
      FROM referrals
      WHERE affiliate_id = ${id}
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
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
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
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
        AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        AND status NOT IN ('deleted', 'voided')
      GROUP BY DATE(created_at)
      ORDER BY day
    `,
  ]);

  return NextResponse.json({
    meta: { range, from: cutoff, generatedAt: new Date().toISOString() },
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
