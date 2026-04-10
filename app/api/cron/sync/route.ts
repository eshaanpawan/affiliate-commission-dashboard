import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const API_SECRET = process.env.REWARDFUL_API_SECRET!;
const BASE_URL = 'https://api.getrewardful.com/v1';
const authHeader = 'Basic ' + Buffer.from(API_SECRET + ':').toString('base64');

// Only sync records from the last 7 days to keep it fast
const SYNC_WINDOW_DAYS = 7;

async function fetchRecent(path: string): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  const cutoff = new Date(Date.now() - SYNC_WINDOW_DAYS * 86400000);

  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE_URL}${path}${sep}page=${page}&limit=100`, {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) break;

    const json = await res.json() as { data: Record<string, unknown>[]; pagination: { total_pages: number } };
    const filtered = json.data.filter((r) => new Date(r.created_at as string) >= cutoff);
    results.push(...filtered);

    const oldest = json.data[json.data.length - 1];
    if (!oldest || new Date(oldest.created_at as string) < cutoff) break;
    if (page >= json.pagination.total_pages) break;
    page++;
  }

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dedupe(arr: any[]): any[] {
  const seen = new Set<string>();
  return arr.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authToken = req.headers.get('authorization');
  if (authToken !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const counts = { affiliates: 0, referrals: 0, sales: 0, commissions: 0, payouts: 0 };

  try {
    // Sync affiliates
    const affiliates = dedupe(await fetchRecent('/affiliates?expand[]=links'));
    for (const a of affiliates) {
      await sql`
        INSERT INTO affiliates (rewardful_id, first_name, last_name, email, status, created_at, confirmed_at, updated_at, visitors, leads, conversions)
        VALUES (${a.id}, ${a.first_name ?? null}, ${a.last_name ?? null}, ${a.email ?? null}, ${a.state ?? 'active'}, ${a.created_at ?? null}, ${a.confirmed_at ?? null}, ${new Date().toISOString()}, ${a.visitors ?? 0}, ${a.leads ?? 0}, ${a.conversions ?? 0})
        ON CONFLICT (rewardful_id) DO UPDATE SET
          first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email,
          status = EXCLUDED.status, confirmed_at = EXCLUDED.confirmed_at, updated_at = EXCLUDED.updated_at,
          visitors = EXCLUDED.visitors, leads = EXCLUDED.leads, conversions = EXCLUDED.conversions
      `;
    }
    counts.affiliates = affiliates.length;

    // Build link map for referrals
    const linkMap = new Map<string, string>();
    for (const a of affiliates) {
      const links = (a.links as { id: string }[]) ?? [];
      for (const l of links) linkMap.set(l.id, a.id as string);
    }

    // Sync referrals
    const referrals = dedupe(await fetchRecent('/referrals'));
    for (const r of referrals) {
      const linkId = (r.link as { id?: string })?.id ?? null;
      const linkToken = (r.link as { token?: string })?.token ?? null;
      const affiliateId = linkId ? (linkMap.get(linkId) ?? null) : null;
      const isConversion = r.conversion_state === 'conversion';
      const isLead = r.conversion_state === 'lead';
      const status = isConversion ? 'converted' : isLead ? 'lead' : 'visitor';
      await sql`
        INSERT INTO referrals (rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at)
        VALUES (${r.id}, ${affiliateId}, ${linkId}, ${linkToken}, ${status}, ${r.created_at ?? null}, ${r.became_conversion_at ?? null})
        ON CONFLICT (rewardful_id) DO UPDATE SET
          affiliate_id = EXCLUDED.affiliate_id, link_id = EXCLUDED.link_id, link_token = EXCLUDED.link_token,
          status = EXCLUDED.status, converted_at = COALESCE(EXCLUDED.converted_at, referrals.converted_at)
      `;
    }
    counts.referrals = referrals.length;

    // Sync sales
    const sales = dedupe(await fetchRecent('/sales'));
    for (const s of sales) {
      await sql`
        INSERT INTO sales (rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
        VALUES (${s.id}, ${(s.affiliate as { id?: string })?.id ?? null}, ${(s.referral as { id?: string })?.id ?? null}, ${s.sale_amount_cents ?? 0}, ${((s.currency as string) ?? 'USD').toLowerCase()}, ${s.refund ? 'refunded' : 'created'}, ${s.created_at ?? null})
        ON CONFLICT (rewardful_id) DO UPDATE SET status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents
      `;
    }
    counts.sales = sales.length;

    // Sync commissions
    const commissions = dedupe(await fetchRecent('/commissions'));
    for (const c of commissions) {
      await sql`
        INSERT INTO commissions (rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at, paid_at)
        VALUES (${c.id}, ${(c.affiliate as { id?: string })?.id ?? null}, ${(c.sale as { id?: string })?.id ?? null}, ${c.amount ?? 0}, ${c.currency ?? 'usd'}, ${c.paid_at ? 'paid' : c.voided_at ? 'voided' : (c.state ?? 'pending')}, ${c.created_at ?? null}, ${c.paid_at ?? null})
        ON CONFLICT (rewardful_id) DO UPDATE SET status = EXCLUDED.status, paid_at = COALESCE(EXCLUDED.paid_at, commissions.paid_at), amount_cents = EXCLUDED.amount_cents
      `;
    }
    counts.commissions = commissions.length;

    // Sync payouts
    const payouts = dedupe(await fetchRecent('/payouts'));
    for (const p of payouts) {
      await sql`
        INSERT INTO payouts (rewardful_id, affiliate_id, amount_cents, currency, status, created_at, paid_at)
        VALUES (${p.id}, ${(p.affiliate as { id?: string })?.id ?? null}, ${p.amount ?? 0}, ${p.currency ?? 'usd'}, ${p.paid_at ? 'paid' : p.failed_at ? 'failed' : p.due_at ? 'due' : 'created'}, ${p.created_at ?? null}, ${p.paid_at ?? null})
        ON CONFLICT (rewardful_id) DO UPDATE SET status = EXCLUDED.status, paid_at = COALESCE(EXCLUDED.paid_at, payouts.paid_at), amount_cents = EXCLUDED.amount_cents
      `;
    }
    counts.payouts = payouts.length;

    return NextResponse.json({ ok: true, synced: counts });
  } catch (err) {
    console.error('Cron sync failed:', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
