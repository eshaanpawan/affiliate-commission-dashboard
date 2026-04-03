import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);
const API_SECRET = process.env.REWARDFUL_API_SECRET!;
const BASE_URL = 'https://api.getrewardful.com/v1';
const authHeader = 'Basic ' + Buffer.from(API_SECRET + ':').toString('base64');

async function fetchRecent(path: string, cutoff: Date): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  while (page <= 20) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE_URL}${path}${sep}page=${page}&limit=100`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) break;
    const json = await res.json() as { data: Record<string, unknown>[]; pagination: { total_pages: number } };
    const recent = json.data.filter((r) => new Date(r.created_at as string) >= cutoff);
    results.push(...recent);
    const oldest = json.data[json.data.length - 1];
    if (!oldest || new Date(oldest.created_at as string) < cutoff || page >= json.pagination.total_pages) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

async function fetchAllAffiliates(): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${BASE_URL}/affiliates?page=${page}&limit=100&expand[]=links`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) break;
    const json = await res.json() as { data: Record<string, unknown>[]; pagination: { total_pages: number } };
    results.push(...json.data);
    if (page >= json.pagination.total_pages) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

export async function POST() {
  if (!API_SECRET) return NextResponse.json({ error: 'No API secret configured' }, { status: 500 });

  // Use 48h window to catch any data gaps from missed syncs
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  try {
    // Sync ALL affiliates (not just recent) to keep visitor/lead/conversion counts current
    const affiliates = await fetchAllAffiliates();
    const linkMap = new Map<string, string>();

    if (affiliates.length > 0) {
      for (const batch of chunks(affiliates, 100)) {
        const rows = batch.map((a) => [
          a.id, a.first_name ?? null, a.last_name ?? null, a.email ?? null,
          a.state ?? 'active', a.created_at ?? null, a.confirmed_at ?? null,
          new Date().toISOString(), a.visitors ?? 0, a.leads ?? 0, a.conversions ?? 0,
        ]);
        await sql`
          INSERT INTO affiliates (rewardful_id, first_name, last_name, email, status, created_at, confirmed_at, updated_at, visitors, leads, conversions)
          SELECT * FROM unnest(
            ${rows.map(r => r[0])}::text[], ${rows.map(r => r[1])}::text[],
            ${rows.map(r => r[2])}::text[], ${rows.map(r => r[3])}::text[],
            ${rows.map(r => r[4])}::text[], ${rows.map(r => r[5])}::timestamptz[],
            ${rows.map(r => r[6])}::timestamptz[], ${rows.map(r => r[7])}::timestamptz[],
            ${rows.map(r => r[8])}::int[], ${rows.map(r => r[9])}::int[], ${rows.map(r => r[10])}::int[]
          ) AS t(rewardful_id, first_name, last_name, email, status, created_at, confirmed_at, updated_at, visitors, leads, conversions)
          ON CONFLICT (rewardful_id) DO UPDATE SET
            first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
            email = EXCLUDED.email, status = EXCLUDED.status,
            confirmed_at = EXCLUDED.confirmed_at, updated_at = EXCLUDED.updated_at,
            visitors = EXCLUDED.visitors, leads = EXCLUDED.leads, conversions = EXCLUDED.conversions
        `;
      }

      // Build link map from all affiliates
      for (const a of affiliates) {
        for (const l of ((a.links as { id: string }[]) ?? [])) {
          linkMap.set(l.id, a.id as string);
        }
      }
    }

    // Sync referrals (last 48h)
    const referrals = await fetchRecent('/referrals', cutoff);
    if (referrals.length > 0) {
      for (const batch of chunks(referrals, 100)) {
        const rows = batch.map((r) => {
          const linkId = (r.link as { id: string } | null)?.id ?? null;
          const affiliateId = linkId ? (linkMap.get(linkId) ?? null) : null;
          const isConversion = r.conversion_state === 'conversion';
          const isLead = r.conversion_state === 'lead';
          const status = isConversion ? 'converted' : isLead ? 'lead' : 'visitor';
          return [r.id, affiliateId, linkId, (r.link as { token: string } | null)?.token ?? null,
            status, r.created_at ?? null, r.became_conversion_at ?? null];
        });
        await sql`
          INSERT INTO referrals (rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at)
          SELECT * FROM unnest(
            ${rows.map(r => r[0])}::text[], ${rows.map(r => r[1])}::text[],
            ${rows.map(r => r[2])}::text[], ${rows.map(r => r[3])}::text[],
            ${rows.map(r => r[4])}::text[], ${rows.map(r => r[5])}::timestamptz[],
            ${rows.map(r => r[6])}::timestamptz[]
          ) AS t(rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at)
          ON CONFLICT (rewardful_id) DO UPDATE SET
            status = EXCLUDED.status, affiliate_id = COALESCE(EXCLUDED.affiliate_id, referrals.affiliate_id),
            converted_at = COALESCE(EXCLUDED.converted_at, referrals.converted_at)
        `;
      }
    }

    // Sync sales (last 48h)
    const sales = await fetchRecent('/sales', cutoff);
    if (sales.length > 0) {
      for (const batch of chunks(sales, 100)) {
        const rows = batch.map((s) => [
          s.id, (s.affiliate as { id: string } | null)?.id ?? null,
          (s.referral as { id: string } | null)?.id ?? null,
          s.sale_amount_cents ?? 0, s.currency ?? 'usd',
          s.refunded_at ? 'refunded' : 'created', s.created_at ?? null,
        ]);
        await sql`
          INSERT INTO sales (rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
          SELECT * FROM unnest(
            ${rows.map(r => r[0])}::text[], ${rows.map(r => r[1])}::text[],
            ${rows.map(r => r[2])}::text[], ${rows.map(r => r[3])}::int[],
            ${rows.map(r => r[4])}::text[], ${rows.map(r => r[5])}::text[],
            ${rows.map(r => r[6])}::timestamptz[]
          ) AS t(rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
          ON CONFLICT (rewardful_id) DO UPDATE SET status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents
        `;
      }
    }

    // Sync commissions (last 48h)
    const commissions = await fetchRecent('/commissions', cutoff);
    if (commissions.length > 0) {
      for (const batch of chunks(commissions, 100)) {
        const rows = batch.map((c) => [
          c.id, (c.affiliate as { id: string } | null)?.id ?? null,
          (c.sale as { id: string } | null)?.id ?? null,
          c.amount ?? 0, c.currency ?? 'usd',
          c.paid_at ? 'paid' : c.voided_at ? 'voided' : 'created',
          c.created_at ?? null, c.paid_at ?? null,
        ]);
        await sql`
          INSERT INTO commissions (rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at, paid_at)
          SELECT * FROM unnest(
            ${rows.map(r => r[0])}::text[], ${rows.map(r => r[1])}::text[],
            ${rows.map(r => r[2])}::text[], ${rows.map(r => r[3])}::int[],
            ${rows.map(r => r[4])}::text[], ${rows.map(r => r[5])}::text[],
            ${rows.map(r => r[6])}::timestamptz[], ${rows.map(r => r[7])}::timestamptz[]
          ) AS t(rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at, paid_at)
          ON CONFLICT (rewardful_id) DO UPDATE SET
            status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents,
            paid_at = COALESCE(EXCLUDED.paid_at, commissions.paid_at)
        `;
      }
    }

    // Refresh commission stats for all affiliates using their commission_stats from Rewardful
    // We already have all affiliates fetched above — use that data directly if commission_stats is present,
    // otherwise fall back to individual API calls for affiliates missing the field.
    let commissionStatsUpdated = 0;
    const affiliatesNeedingStats = affiliates.filter(a => !(a.commission_stats));

    // Update from the full list first (commission_stats may be included in list response)
    for (const batch of chunks(affiliates, 100)) {
      const withStats = batch.filter(a => a.commission_stats);
      if (withStats.length === 0) continue;
      for (const a of withStats) {
        const stats = (a.commission_stats as { currencies?: { USD?: { unpaid?: { cents?: number }; paid?: { cents?: number }; gross_revenue?: { cents?: number } } } })?.currencies?.USD;
        const unpaid = stats?.unpaid?.cents ?? 0;
        const paid = stats?.paid?.cents ?? 0;
        const gross = stats?.gross_revenue?.cents ?? 0;
        await sql`
          UPDATE affiliates
          SET unpaid_commission_cents = ${unpaid}, paid_commission_cents = ${paid}, gross_revenue_cents = ${gross}
          WHERE rewardful_id = ${a.id as string}
        `;
        commissionStatsUpdated++;
      }
    }

    // For affiliates without commission_stats in list response, fetch individually
    for (const a of affiliatesNeedingStats) {
      const affRes = await fetch(`${BASE_URL}/affiliates/${a.id as string}`, {
        headers: { Authorization: authHeader },
      });
      if (!affRes.ok) { await new Promise(r => setTimeout(r, 200)); continue; }
      const affData = await affRes.json() as Record<string, unknown>;
      const stats = (affData.commission_stats as { currencies?: { USD?: { unpaid?: { cents?: number }; paid?: { cents?: number }; gross_revenue?: { cents?: number } } } })?.currencies?.USD;
      const unpaid = stats?.unpaid?.cents ?? 0;
      const paid = stats?.paid?.cents ?? 0;
      const gross = stats?.gross_revenue?.cents ?? 0;
      await sql`
        UPDATE affiliates
        SET unpaid_commission_cents = ${unpaid}, paid_commission_cents = ${paid}, gross_revenue_cents = ${gross}
        WHERE rewardful_id = ${a.id as string}
      `;
      commissionStatsUpdated++;
      await new Promise(r => setTimeout(r, 100));
    }

    return NextResponse.json({
      synced: { affiliates: affiliates.length, referrals: referrals.length, sales: sales.length, commissions: commissions.length, commissionStatsUpdated },
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
