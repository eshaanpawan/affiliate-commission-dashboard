import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isAuthed } from '@/lib/auth';
import { dashboardRangeStart, isDashboardRange } from '@/lib/dashboard-range';

export interface MonthlyRow {
  month: string; // 'YYYY-MM'
  visitors: number;
  leads: number;
  conversions: number;
  salesCents: number;
  commissionsCents: number;
  netCents: number;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedRange = req.nextUrl.searchParams.get('period');
  const range = isDashboardRange(requestedRange) ? requestedRange : 'all';
  const cutoff = dashboardRangeStart(range);

  try {
    const rows = await sql`
      WITH visitors AS (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
               COUNT(*)::int AS visitors
        FROM referrals
        WHERE status <> 'deleted'
          AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        GROUP BY 1
      ),
      leads AS (
        SELECT to_char(date_trunc('month', COALESCE(became_lead_at, created_at)), 'YYYY-MM') AS month,
               COUNT(*)::int AS leads
        FROM referrals
        WHERE status IN ('lead', 'converted')
          AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        GROUP BY 1
      ),
      conversions AS (
        SELECT to_char(date_trunc('month', COALESCE(converted_at, created_at)), 'YYYY-MM') AS month,
               COUNT(*)::int AS conversions
        FROM referrals
        WHERE status = 'converted'
          AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        GROUP BY 1
      ),
      sales AS (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
               COALESCE(SUM(amount_cents), 0)::bigint AS sales_cents
        FROM sales
        WHERE status = 'created'
          AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        GROUP BY 1
      ),
      comms AS (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
               COALESCE(SUM(amount_cents), 0)::bigint AS commissions_cents
        FROM commissions
        WHERE status NOT IN ('voided', 'deleted')
          AND (${cutoff}::timestamptz IS NULL OR created_at >= ${cutoff}::timestamptz)
        GROUP BY 1
      )
      SELECT
        m.month,
        COALESCE(v.visitors, 0)          AS visitors,
        COALESCE(l.leads, 0)             AS leads,
        COALESCE(c.conversions, 0)       AS conversions,
        COALESCE(s.sales_cents, 0)       AS sales_cents,
        COALESCE(cm.commissions_cents, 0) AS commissions_cents
      FROM (
        SELECT month FROM visitors
        UNION SELECT month FROM leads
        UNION SELECT month FROM conversions
        UNION SELECT month FROM sales
        UNION SELECT month FROM comms
      ) m
      LEFT JOIN visitors v ON v.month = m.month
      LEFT JOIN leads l ON l.month = m.month
      LEFT JOIN conversions c ON c.month = m.month
      LEFT JOIN sales s ON s.month = m.month
      LEFT JOIN comms cm ON cm.month = m.month
      ORDER BY m.month ASC
    `;

    const months: MonthlyRow[] = rows.map((r) => {
      const salesCents = Number(r.sales_cents);
      const commissionsCents = Number(r.commissions_cents);
      return {
        month: r.month as string,
        visitors: Number(r.visitors),
        leads: Number(r.leads),
        conversions: Number(r.conversions),
        salesCents,
        commissionsCents,
        netCents: salesCents - commissionsCents,
      };
    });

    const totals = months.reduce(
      (acc, m) => ({
        visitors: acc.visitors + m.visitors,
        leads: acc.leads + m.leads,
        conversions: acc.conversions + m.conversions,
        salesCents: acc.salesCents + m.salesCents,
        commissionsCents: acc.commissionsCents + m.commissionsCents,
        netCents: acc.netCents + m.netCents,
      }),
      { visitors: 0, leads: 0, conversions: 0, salesCents: 0, commissionsCents: 0, netCents: 0 },
    );

    return NextResponse.json({ months, totals, meta: { range, from: cutoff, generatedAt: new Date().toISOString() } });
  } catch (err) {
    console.error('GET /api/monthly failed:', err);
    return NextResponse.json({ error: 'Failed to load monthly summary' }, { status: 500 });
  }
}
