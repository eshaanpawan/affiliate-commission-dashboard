import { mailJson, requireMailAuth, safeString } from '../_shared';
import sql from '@/lib/db';
import { outreachSyncSummary } from '@/lib/outreach';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const query = safeString(url.searchParams.get('q'), 200) ?? '';
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25));
  const offset = (page - 1) * pageSize;
  const pattern = `%${query.toLowerCase()}%`;

  const [counts, rows, queue] = await Promise.all([
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status <> 'deleted')::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'suspicious')::int AS suspicious,
        COUNT(*) FILTER (WHERE status <> 'deleted' AND confirmed_at IS NULL)::int AS unconfirmed,
        COUNT(*) FILTER (
          WHERE status <> 'deleted'
            AND email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        )::int AS emailable
      FROM affiliates
    `,
    sql`
      SELECT
        a.rewardful_id, a.first_name, a.last_name, a.email, a.status,
        a.confirmed_at, a.created_at, a.visitors, a.leads, a.conversions,
        a.unpaid_commission_cents, a.risk_score, a.review_status,
        COALESCE(o.segment, CASE WHEN a.confirmed_at IS NULL THEN 'verification_pending' ELSE 'onboarding' END) AS segment,
        COALESCE(o.sync_status, 'not_queued') AS sync_status,
        o.sync_error, o.last_synced_at
      FROM affiliates a
      LEFT JOIN outreach_contacts o
        ON o.affiliate_id = a.rewardful_id
       AND o.campaign_id = ${process.env.INSTANTLY_AFFILIATE_CAMPAIGN_ID || '2fc18ca4-4de3-41e4-be9a-b7c17211010d'}
      WHERE a.status <> 'deleted'
        AND (${query} = '' OR LOWER(CONCAT_WS(' ', a.first_name, a.last_name, a.email)) LIKE ${pattern})
      ORDER BY
        CASE COALESCE(o.sync_status, 'not_queued')
          WHEN 'error' THEN 0 WHEN 'email_changed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
        a.created_at DESC NULLS LAST, a.rewardful_id
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    outreachSyncSummary(),
  ]);
  const [filtered] = await sql`
    SELECT COUNT(*)::int AS count
    FROM affiliates a
    WHERE a.status <> 'deleted'
      AND (${query} = '' OR LOWER(CONCAT_WS(' ', a.first_name, a.last_name, a.email)) LIKE ${pattern})
  `;

  return mailJson({
    counts: {
      total: Number(counts[0]?.total ?? 0),
      active: Number(counts[0]?.active ?? 0),
      suspicious: Number(counts[0]?.suspicious ?? 0),
      unconfirmed: Number(counts[0]?.unconfirmed ?? 0),
      emailable: Number(counts[0]?.emailable ?? 0),
    },
    sync: queue,
    page: { number: page, size: pageSize, total: Number(filtered?.count ?? 0) },
    items: rows.map((row) => ({
      id: String(row.rewardful_id),
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || '(unnamed)',
      email: row.email ? String(row.email) : null,
      status: String(row.status ?? 'active'),
      confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
      joinedAt: row.created_at ? String(row.created_at) : null,
      visitors: Number(row.visitors ?? 0),
      leads: Number(row.leads ?? 0),
      conversions: Number(row.conversions ?? 0),
      unpaidCommissionCents: Number(row.unpaid_commission_cents ?? 0),
      riskScore: Number(row.risk_score ?? 0),
      reviewStatus: String(row.review_status ?? 'unreviewed'),
      segment: String(row.segment),
      syncStatus: String(row.sync_status),
      syncError: row.sync_error ? String(row.sync_error) : null,
      lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    })),
  });
}
