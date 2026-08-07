import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { extractTrafficFields } from '@/lib/fraud-detection';
import { isAuthed } from '@/lib/auth';
import { queueAffiliateOutreachContacts } from '@/lib/outreach';
import { syncDub } from '@/lib/dub';

const sql = neon(process.env.NEON_DATABASE_URL!);
const API_SECRET = process.env.REWARDFUL_API_SECRET!;
const BASE_URL = 'https://api.getrewardful.com/v1';
const authHeader = 'Basic ' + Buffer.from(API_SECRET + ':').toString('base64');
export const maxDuration = 300;

let nextRewardfulRequestAt = 0;

interface RewardfulPage {
  data: Record<string, unknown>[];
  pagination: {
    current_page: number;
    total_pages: number;
    total_count?: number;
  };
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(20_000, Math.max(1_000, seconds * 1_000));
    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) return Math.min(20_000, Math.max(1_000, retryAt - Date.now()));
  }
  return Math.min(12_000, 1_000 * 2 ** attempt);
}

async function parseRewardfulPage(response: Response, path: string): Promise<RewardfulPage> {
  const payload = await response.json() as Partial<RewardfulPage>;
  const totalPages = Number(payload.pagination?.total_pages);
  const currentPage = Number(payload.pagination?.current_page);
  if (!Array.isArray(payload.data) || !Number.isInteger(totalPages) || totalPages < 0
    || !Number.isInteger(currentPage) || currentPage < 1) {
    throw new Error(`Rewardful ${path} returned an invalid pagination envelope`);
  }
  return payload as RewardfulPage;
}

async function rewardfulFetch(url: string): Promise<Response> {
  const waitMs = Math.max(0, nextRewardfulRequestAt - Date.now());
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  nextRewardfulRequestAt = Date.now() + 700;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: authHeader },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (![429, 502, 503, 504].includes(response.status)) return response;
      if (attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
    } catch (error) {
      if (attempt === 4) {
        throw new Error(
          error instanceof Error && error.name === 'TimeoutError'
            ? 'Rewardful request timed out after five retries'
            : 'Rewardful could not be reached after five retries',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(12_000, 1_000 * 2 ** attempt)));
    }
  }
  throw new Error('Rewardful remained unavailable after five retries');
}

function withoutUpdatedSince(path: string): string {
  const queryIndex = path.indexOf('?');
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? '' : path.slice(queryIndex + 1));
  params.delete('updated_since');
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

async function fetchRecent(path: string, cutoff: Date): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  const serverFiltersUpdates = path.includes('updated_since=');
  while (page <= 5_000) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await rewardfulFetch(`${BASE_URL}${path}${sep}page=${page}&limit=100`);
    if (!res.ok) {
      if (serverFiltersUpdates && page === 1 && res.status >= 500) {
        return fetchRecent(withoutUpdatedSince(path), cutoff);
      }
      throw new Error(`Rewardful ${path} failed (${res.status})`);
    }
    const json = await parseRewardfulPage(res, path);
    const recent = serverFiltersUpdates
      ? json.data
      : json.data.filter((r) => new Date(r.created_at as string) >= cutoff);
    results.push(...recent);
    const oldest = json.data[json.data.length - 1];
    if (!oldest || page >= json.pagination.total_pages) break;
    if (!serverFiltersUpdates && new Date(oldest.created_at as string) < cutoff) break;
    page++;
  }
  return results;
}

async function fetchAllAffiliates(): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  let expectedTotal: number | null = null;
  while (true) {
    const path = `/affiliates?page=${page}&limit=100&expand[]=links&expand[]=commission_stats`;
    const res = await rewardfulFetch(`${BASE_URL}${path}`);
    if (!res.ok) throw new Error(`Rewardful affiliates failed (${res.status})`);
    const json = await parseRewardfulPage(res, path);
    if (json.pagination.current_page !== page) {
      throw new Error(`Rewardful affiliates returned page ${json.pagination.current_page} while page ${page} was requested`);
    }
    if (page === 1 && Number.isInteger(json.pagination.total_count)) {
      expectedTotal = Number(json.pagination.total_count);
    }
    results.push(...json.data);
    if (page >= json.pagination.total_pages) break;
    page++;
  }
  const ids = results.map((affiliate) => affiliate.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (results.length === 0) {
    throw new Error('Rewardful returned an empty affiliate roster; sync stopped to preserve local data');
  }
  if (ids.length !== results.length || new Set(ids).size !== ids.length) {
    throw new Error('Rewardful affiliate roster contained missing or duplicate identifiers');
  }
  if (expectedTotal !== null && results.length !== expectedTotal) {
    throw new Error(`Rewardful affiliate roster was incomplete (${results.length} of ${expectedTotal})`);
  }
  return results;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

export async function POST(req: Request) {
  const bearer = req.headers.get('authorization');
  const cronOk = !!process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk && !(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!API_SECRET) return NextResponse.json({ error: 'No API secret configured' }, { status: 500 });

  // Use 48h window to catch any data gaps from missed syncs
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  try {
    // Sync ALL affiliates (not just recent) to keep visitor/lead/conversion counts current
    const affiliates = await fetchAllAffiliates();
    const linkMap = new Map<string, string>();

    if (affiliates.length > 0 && affiliates.every((affiliate) => !affiliate.commission_stats)) {
      throw new Error('Rewardful did not return commission_stats expansion; sync stopped to avoid overwriting balances');
    }

    if (affiliates.length > 0) {
      for (const batch of chunks(affiliates, 100)) {
        const rows = batch.map((a) => {
          const usd = (a.commission_stats as { currencies?: { USD?: { unpaid?: { cents?: number }; paid?: { cents?: number }; gross_revenue?: { cents?: number } } } })?.currencies?.USD;
          return [
            a.id, a.first_name ?? null, a.last_name ?? null, a.email ?? null,
            a.state ?? 'active', a.created_at ?? null, a.confirmed_at ?? null,
            new Date().toISOString(), a.visitors ?? 0, a.leads ?? 0, a.conversions ?? 0,
            usd?.unpaid?.cents ?? 0, usd?.paid?.cents ?? 0, usd?.gross_revenue?.cents ?? 0,
          ];
        });
        await sql`
          INSERT INTO affiliates (
            rewardful_id, first_name, last_name, email, status, created_at, confirmed_at,
            updated_at, visitors, leads, conversions, unpaid_commission_cents,
            paid_commission_cents, gross_revenue_cents
          )
          SELECT * FROM unnest(
            ${rows.map(r => r[0])}::text[], ${rows.map(r => r[1])}::text[],
            ${rows.map(r => r[2])}::text[], ${rows.map(r => r[3])}::text[],
            ${rows.map(r => r[4])}::text[], ${rows.map(r => r[5])}::timestamptz[],
            ${rows.map(r => r[6])}::timestamptz[], ${rows.map(r => r[7])}::timestamptz[],
            ${rows.map(r => r[8])}::int[], ${rows.map(r => r[9])}::int[], ${rows.map(r => r[10])}::int[],
            ${rows.map(r => r[11])}::int[], ${rows.map(r => r[12])}::int[], ${rows.map(r => r[13])}::int[]
          ) AS t(
            rewardful_id, first_name, last_name, email, status, created_at, confirmed_at,
            updated_at, visitors, leads, conversions, unpaid_commission_cents,
            paid_commission_cents, gross_revenue_cents
          )
          ON CONFLICT (rewardful_id) DO UPDATE SET
            first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
            email = EXCLUDED.email, status = EXCLUDED.status,
            confirmed_at = EXCLUDED.confirmed_at, updated_at = EXCLUDED.updated_at,
            visitors = EXCLUDED.visitors, leads = EXCLUDED.leads, conversions = EXCLUDED.conversions,
            unpaid_commission_cents = EXCLUDED.unpaid_commission_cents,
            paid_commission_cents = EXCLUDED.paid_commission_cents,
            gross_revenue_cents = EXCLUDED.gross_revenue_cents
        `;
      }

      // Build link map from all affiliates
      for (const a of affiliates) {
        for (const l of ((a.links as { id: string }[]) ?? [])) {
          linkMap.set(l.id, a.id as string);
        }
      }

      const sourceIds = affiliates.map((affiliate) => String(affiliate.id));
      await sql`
        UPDATE affiliates
        SET status = 'deleted', updated_at = NOW()
        WHERE status <> 'deleted' AND source = 'rewardful'
          AND NOT (rewardful_id = ANY(${sourceIds}::text[]))
      `;
    }

    // Sync referrals (last 48h). NOTE: Rewardful only supports expand[]=affiliate on
    // the list endpoint — customer/visits cannot be expanded here. We get those via
    // webhooks (real-time) or individual /referrals/{id} fetches for suspects.
    const referrals = await fetchRecent(`/referrals?updated_since=${encodeURIComponent(cutoff.toISOString())}&expand[]=affiliate`, cutoff);
    if (referrals.length > 0) {
      for (const batch of chunks(referrals, 100)) {
        const rows = batch.map((r) => {
          const linkId = (r.link as { id: string } | null)?.id ?? null;
          const expandedAffiliateId = (r.affiliate as { id?: string } | null)?.id ?? null;
          const affiliateId = expandedAffiliateId ?? (linkId ? (linkMap.get(linkId) ?? null) : null);
          const isConversion = r.conversion_state === 'conversion';
          const isLead = r.conversion_state === 'lead';
          const status = isConversion ? 'converted' : isLead ? 'lead' : 'visitor';
          const t = extractTrafficFields(r);
          return [
            r.id, affiliateId, linkId, (r.link as { token: string } | null)?.token ?? null,
            status, r.created_at ?? null, r.became_conversion_at ?? null,
            t.became_lead_at, t.visitor_id, t.customer_email, t.customer_id,
            t.referrer, t.landing_page,
            t.utm_source, t.utm_medium, t.utm_campaign, t.utm_term, t.utm_content,
            t.gclid, t.fbclid,
            JSON.stringify(r),
          ];
        });
        await sql`
          INSERT INTO referrals (
            rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at,
            became_lead_at, visitor_id, customer_email, customer_id,
            referrer, landing_page,
            utm_source, utm_medium, utm_campaign, utm_term, utm_content,
            gclid, fbclid, raw_payload
          )
          SELECT * FROM unnest(
            ${rows.map(r => r[0])}::text[],   ${rows.map(r => r[1])}::text[],
            ${rows.map(r => r[2])}::text[],   ${rows.map(r => r[3])}::text[],
            ${rows.map(r => r[4])}::text[],   ${rows.map(r => r[5])}::timestamptz[],
            ${rows.map(r => r[6])}::timestamptz[], ${rows.map(r => r[7])}::timestamptz[],
            ${rows.map(r => r[8])}::text[],   ${rows.map(r => r[9])}::text[],
            ${rows.map(r => r[10])}::text[],  ${rows.map(r => r[11])}::text[],
            ${rows.map(r => r[12])}::text[],  ${rows.map(r => r[13])}::text[],
            ${rows.map(r => r[14])}::text[],  ${rows.map(r => r[15])}::text[],
            ${rows.map(r => r[16])}::text[],  ${rows.map(r => r[17])}::text[],
            ${rows.map(r => r[18])}::text[],  ${rows.map(r => r[19])}::text[],
            ${rows.map(r => r[20])}::jsonb[]
          ) AS t(
            rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at,
            became_lead_at, visitor_id, customer_email, customer_id,
            referrer, landing_page,
            utm_source, utm_medium, utm_campaign, utm_term, utm_content,
            gclid, fbclid, raw_payload
          )
          ON CONFLICT (rewardful_id) DO UPDATE SET
            status = EXCLUDED.status,
            affiliate_id = COALESCE(EXCLUDED.affiliate_id, referrals.affiliate_id),
            converted_at = COALESCE(EXCLUDED.converted_at, referrals.converted_at),
            became_lead_at = COALESCE(EXCLUDED.became_lead_at, referrals.became_lead_at),
            visitor_id = COALESCE(EXCLUDED.visitor_id, referrals.visitor_id),
            customer_email = COALESCE(EXCLUDED.customer_email, referrals.customer_email),
            customer_id = COALESCE(EXCLUDED.customer_id, referrals.customer_id),
            referrer = COALESCE(EXCLUDED.referrer, referrals.referrer),
            landing_page = COALESCE(EXCLUDED.landing_page, referrals.landing_page),
            utm_source = COALESCE(EXCLUDED.utm_source, referrals.utm_source),
            utm_medium = COALESCE(EXCLUDED.utm_medium, referrals.utm_medium),
            utm_campaign = COALESCE(EXCLUDED.utm_campaign, referrals.utm_campaign),
            utm_term = COALESCE(EXCLUDED.utm_term, referrals.utm_term),
            utm_content = COALESCE(EXCLUDED.utm_content, referrals.utm_content),
            gclid = COALESCE(EXCLUDED.gclid, referrals.gclid),
            fbclid = COALESCE(EXCLUDED.fbclid, referrals.fbclid),
            raw_payload = COALESCE(EXCLUDED.raw_payload, referrals.raw_payload)
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

    const payouts = await fetchRecent('/payouts', cutoff);
    if (payouts.length > 0) {
      for (const batch of chunks(payouts, 100)) {
        const rows = batch.map((p) => [
          p.id,
          (p.affiliate as { id?: string } | null)?.id ?? null,
          p.amount ?? 0,
          String(p.currency ?? 'usd').toLowerCase(),
          p.paid_at ? 'paid' : p.failed_at ? 'failed' : p.state ?? (p.due_at ? 'due' : 'created'),
          p.created_at ?? null,
          p.paid_at ?? null,
        ]);
        await sql`
          INSERT INTO payouts (rewardful_id, affiliate_id, amount_cents, currency, status, created_at, paid_at)
          SELECT * FROM unnest(
            ${rows.map(r => r[0])}::text[], ${rows.map(r => r[1])}::text[],
            ${rows.map(r => r[2])}::int[], ${rows.map(r => r[3])}::text[],
            ${rows.map(r => r[4])}::text[], ${rows.map(r => r[5])}::timestamptz[],
            ${rows.map(r => r[6])}::timestamptz[]
          ) AS t(rewardful_id, affiliate_id, amount_cents, currency, status, created_at, paid_at)
          ON CONFLICT (rewardful_id) DO UPDATE SET
            affiliate_id = COALESCE(EXCLUDED.affiliate_id, payouts.affiliate_id),
            amount_cents = EXCLUDED.amount_cents,
            status = EXCLUDED.status,
            paid_at = COALESCE(EXCLUDED.paid_at, payouts.paid_at)
        `;
      }
    }

    // Dub partners are a second source; a Dub outage must not fail the Rewardful sync
    let dub: { partners: number; customers: number; commissions: number } | { error: string } = { partners: 0, customers: 0, commissions: 0 };
    if (process.env.DUB_API_KEY) {
      try {
        dub = await syncDub();
      } catch (err) {
        console.error('Dub sync error:', err);
        dub = { error: err instanceof Error ? err.message : 'Dub sync failed' };
      }
    }

    const outreachQueue = await queueAffiliateOutreachContacts();

    return NextResponse.json({
      message: `Updated ${affiliates.length.toLocaleString()} affiliates and ${referrals.length.toLocaleString()} changed referrals.`,
      synced: {
        affiliates: affiliates.length,
        referrals: referrals.length,
        sales: sales.length,
        commissions: commissions.length,
        payouts: payouts.length,
        commissionStatsUpdated: affiliates.filter((affiliate) => affiliate.commission_stats).length,
        dub,
      },
      syncedAt: new Date().toISOString(),
      outreachQueue,
    });
  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Rewardful sync failed' }, { status: 500 });
  }
}
