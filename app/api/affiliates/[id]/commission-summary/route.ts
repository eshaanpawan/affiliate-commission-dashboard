import { NextRequest, NextResponse } from 'next/server';

import { isAuthed } from '@/lib/auth';
import sql from '@/lib/db';
import { getAffiliateCommissionSummary } from '@/lib/rewardful';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const summary = await getAffiliateCommissionSummary(id);
    return NextResponse.json({
      summary: { ...summary, source: 'rewardful', accurate: true },
    });
  } catch (error) {
    console.error(`Rewardful commission summary failed for ${id}`, error);

    const [fallback] = await sql`
      SELECT
        COALESCE(a.unpaid_commission_cents, 0) AS unpaid_cents,
        COALESCE(a.paid_commission_cents, 0) AS paid_cents,
        COALESCE(SUM(c.amount_cents) FILTER (WHERE c.status = 'due'), 0) AS due_cents,
        COUNT(*) FILTER (WHERE c.status = 'due') AS due_count,
        COUNT(*) FILTER (WHERE c.status IN ('created', 'pending')) AS pending_count
      FROM affiliates a
      LEFT JOIN commissions c
        ON c.affiliate_id = a.rewardful_id
        AND c.status NOT IN ('deleted', 'voided')
      WHERE a.rewardful_id = ${id}
      GROUP BY a.rewardful_id, a.unpaid_commission_cents, a.paid_commission_cents
    `;

    if (!fallback) {
      return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });
    }

    const unpaidCents = Number(fallback.unpaid_cents ?? 0);
    const dueCents = Number(fallback.due_cents ?? 0);
    return NextResponse.json({
      summary: {
        dueCents,
        pendingCents: Math.max(0, unpaidCents - dueCents),
        unpaidCents,
        paidCents: Number(fallback.paid_cents ?? 0),
        dueCount: Number(fallback.due_count ?? 0),
        pendingCount: Number(fallback.pending_count ?? 0),
        paidCount: 0,
        nextDueAt: null,
        fetchedAt: new Date().toISOString(),
        source: 'local_cache',
        accurate: false,
      },
      warning: 'Live Rewardful settlement state was unavailable; showing the latest cached balance.',
    });
  }
}
