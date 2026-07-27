import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { extractTrafficFields } from '../lib/fraud-detection';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const sql = neon(process.env.NEON_DATABASE_URL!);
const API_SECRET = process.env.REWARDFUL_API_SECRET!;
const BASE_URL = 'https://api.getrewardful.com/v1';

const authHeader = 'Basic ' + Buffer.from(API_SECRET + ':').toString('base64');

const FROM_DATE = new Date('2026-01-01T00:00:00Z');
const ALL_TIME_DATE = new Date('2020-01-01T00:00:00Z');
const configuredPageDelay = Number.parseInt(
  process.env.BACKFILL_PAGE_DELAY_MS ?? '800',
  10,
);
const PAGE_DELAY_MS = Number.isFinite(configuredPageDelay)
  ? Math.max(450, configuredPageDelay)
  : 800;
const configuredConcurrency = Number.parseInt(
  process.env.BACKFILL_PAGE_CONCURRENCY ?? '1',
  10,
);
const PAGE_CONCURRENCY = Number.isFinite(configuredConcurrency)
  ? Math.min(2, Math.max(1, configuredConcurrency))
  : 1;

async function fetchAll(path: string, fromDate: Date = FROM_DATE): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;

  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    let res: Response;
    let retries = 0;
    while (true) {
      res = await fetch(`${BASE_URL}${path}${sep}page=${page}&limit=100`, {
        headers: { Authorization: authHeader },
      });
      if (res.status === 429) {
        retries++;
        const wait = 2000 * retries;
        console.log(`  Rate limited on page ${page}, waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      break;
    }

    if (!res!.ok) {
      const text = await res!.text();
      throw new Error(`API error for ${path} page ${page}: ${res!.status} ${text}`);
    }

    const json = await res!.json() as { data: Record<string, unknown>[]; pagination: { total_pages: number } };

    const filtered = json.data.filter((r) => {
      const date = new Date(r.created_at as string);
      return date >= fromDate;
    });
    results.push(...filtered);

    const oldest = json.data[json.data.length - 1];
    const oldestDate = oldest ? new Date(oldest.created_at as string) : new Date();
    const allOlder = oldestDate < fromDate;

    console.log(`  ${path} page ${page}/${json.pagination.total_pages} — fetched ${filtered.length} in-range records (total so far: ${results.length})`);

    if (page >= json.pagination.total_pages || allOlder) break;
    page++;

    // Avoid rate limiting — 800ms between requests
    await new Promise((r) => setTimeout(r, 800));
  }

  return results;
}

async function processAll(
  path: string,
  processPage: (records: Record<string, unknown>[]) => Promise<void>,
  fromDate: Date = FROM_DATE,
  startPage = 1,
): Promise<{ processed: number; seenIds: string[] }> {
  let page = Math.max(1, startPage);
  let processed = 0;
  let pendingRecords: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  async function flushPending() {
    if (pendingRecords.length === 0) return;
    await processPage(pendingRecords);
    processed += pendingRecords.length;
    pendingRecords = [];
  }

  async function fetchPage(pageNumber: number): Promise<{
    json: {
      data: Record<string, unknown>[];
      pagination: { total_pages: number };
    };
    pageNumber: number;
  }> {
    const sep = path.includes('?') ? '&' : '?';
    let retries = 0;

    while (true) {
      const response = await fetch(
        `${BASE_URL}${path}${sep}page=${pageNumber}&limit=100`,
        { headers: { Authorization: authHeader } },
      );
      if (response.status === 429) {
        retries++;
        const wait = 2000 * retries;
        console.log(`  Rate limited on page ${pageNumber}, waiting ${wait}ms...`);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, wait));
        continue;
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`API error for ${path} page ${pageNumber}: ${response.status} ${body}`);
      }

      const json = await response.json() as {
        data: Record<string, unknown>[];
        pagination: { total_pages: number };
      };
      return { json, pageNumber };
    }
  }

  let totalPages: number | null = null;
  while (true) {
    const pagesToFetch: number[] = Array.from(
      { length: totalPages == null ? 1 : PAGE_CONCURRENCY },
      (_, offset) => page + offset,
    ).filter((pageNumber) => totalPages == null || pageNumber <= totalPages);
    const payloads = await Promise.all(pagesToFetch.map(fetchPage));
    let finished = false;

    for (const { json, pageNumber } of payloads) {
      totalPages = json.pagination.total_pages;
      for (const record of json.data) {
        if (record.id) seenIds.add(String(record.id));
      }
      const records = json.data.filter((record) => {
        const date = new Date(record.created_at as string);
        return date >= fromDate;
      });

      pendingRecords.push(...records);
      if (pendingRecords.length >= 500) await flushPending();

      const oldest = json.data.at(-1);
      const allOlder = oldest
        ? new Date(oldest.created_at as string) < fromDate
        : false;

      console.log(
        `  ${path} page ${pageNumber}/${json.pagination.total_pages} — fetched ${records.length} in-range records (${processed} committed, ${pendingRecords.length} buffered)`,
      );

      page = pageNumber + 1;
      if (pageNumber >= json.pagination.total_pages || allOlder) {
        finished = true;
        break;
      }
    }

    if (finished) {
      await flushPending();
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, PAGE_DELAY_MS));
  }

  return { processed, seenIds: [...seenIds] };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function dedupe<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

// Build link_id → affiliate_id map from affiliates with links expanded
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
      const t = extractTrafficFields(r);
      return [
        r.id, affiliateId, linkId, r.link?.token ?? null,
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
        affiliate_id = EXCLUDED.affiliate_id,
        link_id = EXCLUDED.link_id,
        link_token = EXCLUDED.link_token,
        status = EXCLUDED.status,
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

  const referralStartPage = Number.parseInt(
    process.env.BACKFILL_REFERRALS_START_PAGE ?? '1',
    10,
  );
  const safeReferralStartPage = Number.isFinite(referralStartPage)
    ? Math.max(1, referralStartPage)
    : 1;
  const skipAffiliates = process.env.BACKFILL_SKIP_AFFILIATES === '1';
  const skipReferrals = process.env.BACKFILL_SKIP_REFERRALS === '1';
  const skipSales = process.env.BACKFILL_SKIP_SALES === '1';
  const skipCommissions = process.env.BACKFILL_SKIP_COMMISSIONS === '1';
  const skipPayouts = process.env.BACKFILL_SKIP_PAYOUTS === '1';

  if (skipAffiliates) {
    console.log('Skipping affiliate upsert (BACKFILL_SKIP_AFFILIATES=1)\n');
  } else {
    console.log('Fetching affiliates (with links)...');
    const affiliates = await fetchAll('/affiliates?expand[]=links', ALL_TIME_DATE);
    console.log(`→ Inserting ${affiliates.length} affiliates into DB...`);
    await backfillAffiliates(affiliates as never[]);
    console.log('✅ Affiliates done\n');
  }

  console.log('Building link → affiliate map...');
  const linkMap = await buildLinkMap();
  console.log(`→ Built map with ${linkMap.size} links\n`);

  if (skipReferrals) {
    console.log('Skipping referrals (BACKFILL_SKIP_REFERRALS=1)\n');
  } else {
    console.log(`Fetching referrals (all time, starting at page ${safeReferralStartPage})...`);
    const { processed: referralCount } = await processAll(
      '/referrals',
      (records) => backfillReferrals(records, linkMap),
      ALL_TIME_DATE,
      safeReferralStartPage,
    );
    console.log(`✅ Referrals done — ${referralCount} records reconciled\n`);
  }

  if (skipSales) {
    console.log('Skipping sales (BACKFILL_SKIP_SALES=1)\n');
  } else {
    console.log('Fetching sales (all time)...');
    const { processed: saleCount, seenIds: saleIds } = await processAll(
      '/sales',
      (records) => backfillSales(records, linkMap),
      ALL_TIME_DATE,
    );
    if (saleIds.length > 0) {
      await sql`UPDATE sales SET status = 'deleted' WHERE status <> 'deleted' AND NOT (rewardful_id = ANY(${saleIds}::text[]))`;
    }
    console.log(`✅ Sales done — ${saleCount} records reconciled\n`);
  }

  if (skipCommissions) {
    console.log('Skipping commissions (BACKFILL_SKIP_COMMISSIONS=1)\n');
  } else {
    console.log('Fetching commissions (all time)...');
    const { processed: commissionCount, seenIds: commissionIds } = await processAll(
      '/commissions',
      (records) => backfillCommissions(records),
      ALL_TIME_DATE,
    );
    if (commissionIds.length > 0) {
      await sql`UPDATE commissions SET status = 'deleted' WHERE status <> 'deleted' AND NOT (rewardful_id = ANY(${commissionIds}::text[]))`;
    }
    console.log(`✅ Commissions done — ${commissionCount} records reconciled\n`);
  }

  if (skipPayouts) {
    console.log('Skipping payouts (BACKFILL_SKIP_PAYOUTS=1)\n');
  } else {
    console.log('Fetching payouts (all time)...');
    const { processed: payoutCount, seenIds: payoutIds } = await processAll(
      '/payouts',
      (records) => backfillPayouts(records),
      ALL_TIME_DATE,
    );
    if (payoutIds.length > 0) {
      await sql`UPDATE payouts SET status = 'deleted' WHERE status <> 'deleted' AND NOT (rewardful_id = ANY(${payoutIds}::text[]))`;
    }
    console.log(`✅ Payouts done — ${payoutCount} records reconciled\n`);
  }

  console.log('🎉 Backfill complete!');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
