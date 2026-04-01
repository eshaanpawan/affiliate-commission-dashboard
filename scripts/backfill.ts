import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const sql = neon(process.env.NEON_DATABASE_URL!);
const API_SECRET = process.env.REWARDFUL_API_SECRET!;
const BASE_URL = 'https://api.getrewardful.com/v1';

const authHeader = 'Basic ' + Buffer.from(API_SECRET + ':').toString('base64');

const FROM_DATE = new Date('2026-01-01T00:00:00Z');
const ALL_TIME_DATE = new Date('2020-01-01T00:00:00Z');

async function fetchAll(path: string, fromDate: Date = FROM_DATE): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;

  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE_URL}${path}${sep}page=${page}&limit=100`, {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error for ${path} page ${page}: ${res.status} ${text}`);
    }

    const json = await res.json() as { data: Record<string, unknown>[]; pagination: { total_pages: number } };

    const filtered = json.data.filter((r) => {
      const date = new Date(r.created_at as string);
      return date >= fromDate;
    });
    results.push(...filtered);

    const oldest = json.data[json.data.length - 1];
    const oldestDate = oldest ? new Date(oldest.created_at as string) : new Date();
    const allOlder = oldestDate < fromDate;

    console.log(`  ${path} page ${page}/${json.pagination.total_pages} — fetched ${filtered.length} in-range records`);

    if (page >= json.pagination.total_pages || allOlder) break;
    page++;

    // Avoid rate limiting
    await new Promise((r) => setTimeout(r, 400));
  }

  return results;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
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

// Build link_id → affiliate_id map from affiliates with links expanded
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildLinkMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  while (true) {
    const res = await fetch(`${BASE_URL}/affiliates?page=${page}&limit=100&expand[]=links`, {
      headers: { Authorization: authHeader },
    });
    const json = await res.json() as { data: Record<string, unknown>[]; pagination: { total_pages: number } };
    for (const a of json.data) {
      const links = (a.links as { id: string }[]) ?? [];
      for (const l of links) {
        map.set(l.id, a.id as string);
      }
    }
    if (page >= json.pagination.total_pages) break;
    page++;
    await new Promise((r) => setTimeout(r, 400));
  }
  return map;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function backfillAffiliates(affiliates: any[]) {
  const now = new Date().toISOString();
  for (const batch of chunks(dedupe(affiliates), 500)) {
    const rows = batch.map((a) => [
      a.id, a.first_name ?? null, a.last_name ?? null, a.email ?? null,
      a.state ?? 'active', a.created_at ?? null, a.confirmed_at ?? null, now,
      a.visitors ?? 0, a.leads ?? 0, a.conversions ?? 0,
    ]);
    await sql`
      INSERT INTO affiliates (rewardful_id, first_name, last_name, email, status, created_at, confirmed_at, updated_at, visitors, leads, conversions)
      SELECT * FROM unnest(
        ${rows.map(r => r[0])}::text[],
        ${rows.map(r => r[1])}::text[],
        ${rows.map(r => r[2])}::text[],
        ${rows.map(r => r[3])}::text[],
        ${rows.map(r => r[4])}::text[],
        ${rows.map(r => r[5])}::timestamptz[],
        ${rows.map(r => r[6])}::timestamptz[],
        ${rows.map(r => r[7])}::timestamptz[],
        ${rows.map(r => r[8])}::int[],
        ${rows.map(r => r[9])}::int[],
        ${rows.map(r => r[10])}::int[]
      ) AS t(rewardful_id, first_name, last_name, email, status, created_at, confirmed_at, updated_at, visitors, leads, conversions)
      ON CONFLICT (rewardful_id) DO UPDATE SET
        first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
        email = EXCLUDED.email, status = EXCLUDED.status,
        confirmed_at = EXCLUDED.confirmed_at, updated_at = EXCLUDED.updated_at,
        visitors = EXCLUDED.visitors, leads = EXCLUDED.leads, conversions = EXCLUDED.conversions
    `;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function backfillReferrals(referrals: any[], linkMap: Map<string, string>) {
  for (const batch of chunks(dedupe(referrals), 500)) {
    const rows = batch.map((r) => {
      const linkId = r.link?.id ?? null;
      const affiliateId = linkId ? (linkMap.get(linkId) ?? null) : null;
      const isConversion = r.conversion_state === 'conversion';
      const isLead = r.conversion_state === 'lead';
      const status = isConversion ? 'converted' : isLead ? 'lead' : 'visitor';
      return [
        r.id, affiliateId, linkId, r.link?.token ?? null,
        status, r.created_at ?? null, r.became_conversion_at ?? null,
      ];
    });
    await sql`
      INSERT INTO referrals (rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at)
      SELECT * FROM unnest(
        ${rows.map(r => r[0])}::text[],
        ${rows.map(r => r[1])}::text[],
        ${rows.map(r => r[2])}::text[],
        ${rows.map(r => r[3])}::text[],
        ${rows.map(r => r[4])}::text[],
        ${rows.map(r => r[5])}::timestamptz[],
        ${rows.map(r => r[6])}::timestamptz[]
      ) AS t(rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at)
      ON CONFLICT (rewardful_id) DO UPDATE SET
        affiliate_id = EXCLUDED.affiliate_id,
        link_id = EXCLUDED.link_id,
        link_token = EXCLUDED.link_token,
        status = EXCLUDED.status,
        converted_at = COALESCE(EXCLUDED.converted_at, referrals.converted_at)
    `;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function backfillSales(sales: any[], linkMap: Map<string, string>) {
  for (const batch of chunks(dedupe(sales), 500)) {
    const rows = batch.map((s) => {
      const linkId = (s.referral as { link?: { id: string } } | null)?.link?.id ?? null;
      const affiliateId = (s.affiliate as { id: string } | null)?.id ?? (linkId ? (linkMap.get(linkId) ?? null) : null);
      const status = s.refunded_at ? 'refunded' : 'created';
      return [
        s.id, affiliateId, (s.referral as { id: string } | null)?.id ?? null,
        s.sale_amount_cents ?? 0, s.currency ?? 'usd',
        status, s.created_at ?? null,
      ];
    });
    await sql`
      INSERT INTO sales (rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
      SELECT * FROM unnest(
        ${rows.map(r => r[0])}::text[],
        ${rows.map(r => r[1])}::text[],
        ${rows.map(r => r[2])}::text[],
        ${rows.map(r => r[3])}::int[],
        ${rows.map(r => r[4])}::text[],
        ${rows.map(r => r[5])}::text[],
        ${rows.map(r => r[6])}::timestamptz[]
      ) AS t(rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
      ON CONFLICT (rewardful_id) DO UPDATE SET
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents
    `;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function backfillCommissions(commissions: any[]) {
  for (const batch of chunks(dedupe(commissions), 500)) {
    const rows = batch.map((c) => [
      c.id, c.affiliate?.id ?? null, c.sale?.id ?? null,
      c.amount ?? 0, c.currency ?? 'usd',
      c.paid_at ? 'paid' : c.voided_at ? 'voided' : 'created',
      c.created_at ?? null, c.paid_at ?? null,
    ]);
    await sql`
      INSERT INTO commissions (rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at, paid_at)
      SELECT * FROM unnest(
        ${rows.map(r => r[0])}::text[],
        ${rows.map(r => r[1])}::text[],
        ${rows.map(r => r[2])}::text[],
        ${rows.map(r => r[3])}::int[],
        ${rows.map(r => r[4])}::text[],
        ${rows.map(r => r[5])}::text[],
        ${rows.map(r => r[6])}::timestamptz[],
        ${rows.map(r => r[7])}::timestamptz[]
      ) AS t(rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at, paid_at)
      ON CONFLICT (rewardful_id) DO UPDATE SET
        status = EXCLUDED.status,
        paid_at = COALESCE(EXCLUDED.paid_at, commissions.paid_at),
        amount_cents = EXCLUDED.amount_cents
    `;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function backfillPayouts(payouts: any[]) {
  for (const batch of chunks(dedupe(payouts), 500)) {
    const rows = batch.map((p) => [
      p.id, p.affiliate?.id ?? null,
      p.amount ?? 0, p.currency ?? 'usd',
      p.paid_at ? 'paid' : p.failed_at ? 'failed' : p.due_at ? 'due' : 'created',
      p.created_at ?? null, p.paid_at ?? null,
    ]);
    await sql`
      INSERT INTO payouts (rewardful_id, affiliate_id, amount_cents, currency, status, created_at, paid_at)
      SELECT * FROM unnest(
        ${rows.map(r => r[0])}::text[],
        ${rows.map(r => r[1])}::text[],
        ${rows.map(r => r[2])}::int[],
        ${rows.map(r => r[3])}::text[],
        ${rows.map(r => r[4])}::text[],
        ${rows.map(r => r[5])}::timestamptz[],
        ${rows.map(r => r[6])}::timestamptz[]
      ) AS t(rewardful_id, affiliate_id, amount_cents, currency, status, created_at, paid_at)
      ON CONFLICT (rewardful_id) DO UPDATE SET
        status = EXCLUDED.status,
        paid_at = COALESCE(EXCLUDED.paid_at, payouts.paid_at),
        amount_cents = EXCLUDED.amount_cents
    `;
  }
}

async function main() {
  console.log('Starting backfill from Rewardful API...\n');

  console.log('Fetching affiliates (with links)...');
  const affiliates = await fetchAll('/affiliates?expand[]=links', ALL_TIME_DATE);
  console.log(`→ Inserting ${affiliates.length} affiliates into DB...`);
  await backfillAffiliates(affiliates as never[]);
  console.log('✅ Affiliates done\n');

  console.log('Building link → affiliate map...');
  const linkMap = await buildLinkMap();
  console.log(`→ Built map with ${linkMap.size} links\n`);

  console.log('Fetching referrals...');
  const referrals = await fetchAll('/referrals');
  console.log(`→ Inserting ${referrals.length} referrals into DB...`);
  await backfillReferrals(referrals as never[], linkMap);
  console.log('✅ Referrals done\n');

  console.log('Fetching sales...');
  const sales = await fetchAll('/sales');
  console.log(`→ Inserting ${sales.length} sales into DB...`);
  await backfillSales(sales as never[], linkMap);
  console.log('✅ Sales done\n');

  console.log('Fetching commissions...');
  const commissions = await fetchAll('/commissions');
  console.log(`→ Inserting ${commissions.length} commissions into DB...`);
  await backfillCommissions(commissions as never[]);
  console.log('✅ Commissions done\n');

  console.log('Fetching payouts...');
  const payouts = await fetchAll('/payouts');
  console.log(`→ Inserting ${payouts.length} payouts into DB...`);
  await backfillPayouts(payouts as never[]);
  console.log('✅ Payouts done\n');

  console.log('🎉 Backfill complete!');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
