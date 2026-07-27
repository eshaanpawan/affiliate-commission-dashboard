import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isAuthed } from '@/lib/auth';

export async function GET(req: Request) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [rows, summary] = await Promise.all([
    sql`
      SELECT
        p.rewardful_id, p.affiliate_id, p.amount_cents, p.currency, p.status,
        p.created_at, p.paid_at, a.first_name, a.last_name, a.email,
        h.status AS hold_status, h.reason AS hold_reason
      FROM payouts p
      LEFT JOIN affiliates a ON a.rewardful_id = p.affiliate_id
      LEFT JOIN commission_holds h ON h.affiliate_id = p.affiliate_id AND h.status = 'held'
      WHERE p.status <> 'deleted'
      ORDER BY p.created_at DESC NULLS LAST
      LIMIT 500
    `,
    sql`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount_cents
      FROM payouts
      WHERE status <> 'deleted'
      GROUP BY status
    `,
  ]);

  return NextResponse.json({
    payouts: rows.map((row) => ({
      id: String(row.rewardful_id),
      affiliateId: row.affiliate_id ? String(row.affiliate_id) : null,
      affiliateName: [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.email ?? 'Unknown affiliate'),
      email: row.email ? String(row.email) : null,
      amountCents: Number(row.amount_cents),
      currency: String(row.currency ?? 'usd'),
      status: String(row.status),
      createdAt: row.created_at,
      paidAt: row.paid_at,
      holdStatus: row.hold_status ? String(row.hold_status) : null,
      holdReason: row.hold_reason ? String(row.hold_reason) : null,
    })),
    summary: Object.fromEntries(summary.map((row) => [String(row.status), {
      count: Number(row.count),
      amountCents: Number(row.amount_cents),
    }])),
    generatedAt: new Date().toISOString(),
  });
}
