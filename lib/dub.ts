// Minimal Dub Partners API client.
//
// Auth: Bearer DUB_API_KEY (program-scoped token). Partners are synced into the
// shared `affiliates` table with source = 'dub'; the partner id (pn_...) is
// stored in `rewardful_id`, which is the cross-source external-id column.

import sql from '@/lib/db';

const BASE = 'https://api.dub.co';

function authHeaders(): Record<string, string> {
  const key = process.env.DUB_API_KEY;
  if (!key) throw new Error('DUB_API_KEY is not set');
  return { Authorization: `Bearer ${key}` };
}

export interface DubPartner {
  id: string;
  name: string | null;
  email: string | null;
  status: string;
  createdAt: string | null;
  clicks?: number;
  leads?: number;
  conversions?: number;
  saleAmount?: number;
  totalCommissions?: number;
  [key: string]: unknown;
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dub GET ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchAllDubPartners(): Promise<DubPartner[]> {
  const partners: DubPartner[] = [];
  let page = 1;
  while (page <= 500) {
    const batch = await request<DubPartner[]>(`/partners?page=${page}&pageSize=100`);
    partners.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  // Dub's default sort is not stable across page boundaries — dedupe by id.
  const byId = new Map(partners.map((p) => [p.id, p]));
  return [...byId.values()];
}

/** Upserts every Dub partner into `affiliates` (source = 'dub'). */
export async function syncDubPartners(): Promise<{ partners: number }> {
  const partners = await fetchAllDubPartners();
  if (partners.length === 0) return { partners: 0 };

  for (let i = 0; i < partners.length; i += 100) {
    const rows = partners.slice(i, i + 100).map((p) => {
      const [firstName, ...rest] = String(p.name ?? '').trim().split(/\s+/);
      return [
        p.id,
        firstName || null,
        rest.join(' ') || null,
        p.email ?? null,
        p.status ?? 'approved',
        p.createdAt ?? null,
        new Date().toISOString(),
        p.clicks ?? 0,
        p.leads ?? 0,
        p.conversions ?? 0,
        p.totalCommissions ?? 0, // Dub only exposes lifetime commissions here
        p.saleAmount ?? 0,
      ];
    });
    await sql`
      INSERT INTO affiliates (
        rewardful_id, first_name, last_name, email, status, created_at,
        updated_at, visitors, leads, conversions, unpaid_commission_cents,
        gross_revenue_cents, source
      )
      SELECT *, 'dub' FROM unnest(
        ${rows.map((r) => r[0])}::text[], ${rows.map((r) => r[1])}::text[],
        ${rows.map((r) => r[2])}::text[], ${rows.map((r) => r[3])}::text[],
        ${rows.map((r) => r[4])}::text[], ${rows.map((r) => r[5])}::timestamptz[],
        ${rows.map((r) => r[6])}::timestamptz[], ${rows.map((r) => r[7])}::int[],
        ${rows.map((r) => r[8])}::int[], ${rows.map((r) => r[9])}::int[],
        ${rows.map((r) => r[10])}::int[], ${rows.map((r) => r[11])}::int[]
      ) AS t(
        rewardful_id, first_name, last_name, email, status, created_at,
        updated_at, visitors, leads, conversions, unpaid_commission_cents,
        gross_revenue_cents
      )
      ON CONFLICT (rewardful_id) DO UPDATE SET
        first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
        email = EXCLUDED.email, status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at, visitors = EXCLUDED.visitors,
        leads = EXCLUDED.leads, conversions = EXCLUDED.conversions,
        unpaid_commission_cents = EXCLUDED.unpaid_commission_cents,
        gross_revenue_cents = EXCLUDED.gross_revenue_cents,
        source = 'dub'
    `;
  }

  const ids = partners.map((p) => p.id);
  await sql`
    UPDATE affiliates
    SET status = 'deleted', updated_at = NOW()
    WHERE source = 'dub' AND status <> 'deleted'
      AND NOT (rewardful_id = ANY(${ids}::text[]))
  `;

  // Surface Dub-side fraud judgements (bans + "fraud" tags) in the war room.
  const flagged = partners.filter((p) => {
    const tags = (p.tags as { name?: string }[] | undefined) ?? [];
    return Boolean(p.bannedAt) || p.status === 'banned' || p.status === 'deactivated'
      || tags.some((t) => /fraud|abuse|spam/i.test(t.name ?? ''));
  });
  if (flagged.length > 0) {
    const flaggedIds = flagged.map((p) => p.id);
    const tagPayload = flagged.map((p) => JSON.stringify([
      ...new Set([
        ...(((p.tags as { name?: string }[] | undefined) ?? []).map((t) => `dub:${t.name}`).filter((t) => t !== 'dub:undefined')),
        ...(p.bannedAt || p.status === 'banned' ? ['dub:banned'] : []),
        ...(p.status === 'deactivated' ? ['dub:deactivated'] : []),
      ]),
    ]));
    await sql`
      UPDATE affiliates a
      SET risk_score = GREATEST(COALESCE(a.risk_score, 0), 80),
          risk_updated_at = NOW(),
          fraud_tags = t.tags::jsonb
      FROM unnest(${flaggedIds}::text[], ${tagPayload}::text[]) AS t(id, tags)
      WHERE a.rewardful_id = t.id
    `;
  }

  return { partners: partners.length };
}

async function fetchAllPages<T extends { id: string }>(path: string): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  while (page <= 500) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await request<T[]>(`${path}${sep}page=${page}&pageSize=100`);
    out.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  const byId = new Map(out.map((row) => [row.id, row]));
  return [...byId.values()];
}

const countryName = new Intl.DisplayNames(['en'], { type: 'region' });

interface DubCustomer {
  id: string;
  email: string | null;
  country: string | null;
  createdAt: string | null;
  firstSaleAt: string | null;
  link?: { id: string; key: string } | null;
  partner?: { id: string } | null;
}

/** Dub customers → `referrals` rows (lead on signup, converted on first sale). */
export async function syncDubCustomers(): Promise<{ customers: number }> {
  const customers = (await fetchAllPages<DubCustomer>('/customers?includeExpandedFields=true'))
    .filter((c) => c.partner?.id);
  for (let i = 0; i < customers.length; i += 100) {
    const batch = customers.slice(i, i + 100);
    await sql`
      INSERT INTO referrals (
        rewardful_id, affiliate_id, link_id, link_token, status,
        created_at, converted_at, became_lead_at, customer_email, customer_id,
        country_code, country_name
      )
      SELECT * FROM unnest(
        ${batch.map((c) => c.id)}::text[],
        ${batch.map((c) => c.partner!.id)}::text[],
        ${batch.map((c) => c.link?.id ?? null)}::text[],
        ${batch.map((c) => c.link?.key ?? null)}::text[],
        ${batch.map((c) => (c.firstSaleAt ? 'converted' : 'lead'))}::text[],
        ${batch.map((c) => c.createdAt ?? null)}::timestamptz[],
        ${batch.map((c) => c.firstSaleAt ?? null)}::timestamptz[],
        ${batch.map((c) => c.createdAt ?? null)}::timestamptz[],
        ${batch.map((c) => c.email ?? null)}::text[],
        ${batch.map((c) => c.id)}::text[],
        ${batch.map((c) => c.country ?? null)}::text[],
        ${batch.map((c) => {
          try { return c.country ? countryName.of(c.country) ?? null : null; } catch { return null; }
        })}::text[]
      ) AS t(
        rewardful_id, affiliate_id, link_id, link_token, status,
        created_at, converted_at, became_lead_at, customer_email, customer_id,
        country_code, country_name
      )
      ON CONFLICT (rewardful_id) DO UPDATE SET
        status = EXCLUDED.status,
        converted_at = COALESCE(EXCLUDED.converted_at, referrals.converted_at),
        customer_email = COALESCE(EXCLUDED.customer_email, referrals.customer_email),
        country_code = COALESCE(EXCLUDED.country_code, referrals.country_code),
        country_name = COALESCE(EXCLUDED.country_name, referrals.country_name)
    `;
  }
  return { customers: customers.length };
}

interface DubCommission {
  id: string;
  amount: number;
  earnings: number;
  currency: string;
  status: string;
  createdAt: string | null;
  paidAt: string | null;
  partner?: { id: string } | null;
  customer?: { id: string } | null;
}

/** Dub commissions → `commissions` rows + matching `sales` rows. */
export async function syncDubCommissions(): Promise<{ commissions: number }> {
  const commissions = (await fetchAllPages<DubCommission>('/commissions'))
    .filter((c) => c.partner?.id);
  const statusOf = (s: string) =>
    s === 'paid' ? 'paid'
      : ['refunded', 'canceled', 'duplicate', 'fraud'].includes(s) ? 'voided'
      : 'created';
  for (let i = 0; i < commissions.length; i += 100) {
    const batch = commissions.slice(i, i + 100);
    await sql`
      INSERT INTO sales (rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
      SELECT * FROM unnest(
        ${batch.map((c) => `dsale_${c.id}`)}::text[],
        ${batch.map((c) => c.partner!.id)}::text[],
        ${batch.map((c) => c.customer?.id ?? null)}::text[],
        ${batch.map((c) => c.amount ?? 0)}::int[],
        ${batch.map((c) => (c.currency ?? 'usd').toLowerCase())}::text[],
        ${batch.map((c) => (statusOf(c.status) === 'voided' ? 'refunded' : 'created'))}::text[],
        ${batch.map((c) => c.createdAt ?? null)}::timestamptz[]
      ) AS t(rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
      ON CONFLICT (rewardful_id) DO UPDATE SET
        status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents
    `;
    await sql`
      INSERT INTO commissions (rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at, paid_at)
      SELECT * FROM unnest(
        ${batch.map((c) => c.id)}::text[],
        ${batch.map((c) => c.partner!.id)}::text[],
        ${batch.map((c) => `dsale_${c.id}`)}::text[],
        ${batch.map((c) => c.earnings ?? 0)}::int[],
        ${batch.map((c) => (c.currency ?? 'usd').toLowerCase())}::text[],
        ${batch.map((c) => statusOf(c.status))}::text[],
        ${batch.map((c) => c.createdAt ?? null)}::timestamptz[],
        ${batch.map((c) => c.paidAt ?? null)}::timestamptz[]
      ) AS t(rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at, paid_at)
      ON CONFLICT (rewardful_id) DO UPDATE SET
        status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents,
        paid_at = COALESCE(EXCLUDED.paid_at, commissions.paid_at)
    `;
  }
  return { commissions: commissions.length };
}

/** Full Dub sync: partners, customers (referrals), commissions (+sales). */
export async function syncDub(): Promise<{ partners: number; customers: number; commissions: number }> {
  const [{ partners }, { customers }, { commissions }] = [
    await syncDubPartners(),
    await syncDubCustomers(),
    await syncDubCommissions(),
  ];
  return { partners, customers, commissions };
}
