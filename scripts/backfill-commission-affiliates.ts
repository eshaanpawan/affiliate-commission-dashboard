// Backfill commissions.affiliate_id + sale_id from the Rewardful API.
//
// The sync never captured affiliate_id/sale_id on commissions (both NULL on
// all rows), and sale_id is NULL too, so no local join can repair it. This
// script re-fetches every commission with `expand[]=sale` — the expanded sale
// object carries both the sale id and the affiliate id — and updates rows
// where affiliate_id IS NULL.
//
// Safe to re-run. Usage: npx tsx scripts/backfill-commission-affiliates.ts

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const sql = neon(process.env.NEON_DATABASE_URL!);
const API_SECRET = process.env.REWARDFUL_API_SECRET!;
const BASE_URL = 'https://api.getrewardful.com/v1';
const authHeader = 'Basic ' + Buffer.from(API_SECRET + ':').toString('base64');

interface CommissionRow {
  id: string;
  sale?: {
    id?: string;
    affiliate?: { id?: string };
  } | null;
}

async function fetchPage(page: number): Promise<{ data: CommissionRow[]; totalPages: number }> {
  let retries = 0;
  while (true) {
    const res = await fetch(`${BASE_URL}/commissions?limit=100&page=${page}&expand[]=sale`, {
      headers: { Authorization: authHeader },
    });
    if (res.status === 429) {
      retries++;
      const wait = 2000 * retries;
      console.log(`  Rate limited on page ${page}, waiting ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      throw new Error(`API error page ${page}: ${res.status} ${await res.text()}`);
    }
    const json = await res.json() as { data: CommissionRow[]; pagination: { total_pages: number } };
    return { data: json.data, totalPages: json.pagination.total_pages };
  }
}

async function applyBatch(batch: { id: string; affiliateId: string; saleId: string | null }[]) {
  if (batch.length === 0) return;
  await sql`
    UPDATE commissions c
    SET affiliate_id = t.affiliate_id,
        sale_id = COALESCE(c.sale_id, t.sale_id)
    FROM unnest(
      ${batch.map(b => b.id)}::text[],
      ${batch.map(b => b.affiliateId)}::text[],
      ${batch.map(b => b.saleId)}::text[]
    ) AS t(rewardful_id, affiliate_id, sale_id)
    WHERE c.rewardful_id = t.rewardful_id
      AND c.affiliate_id IS NULL
  `;
}

async function main() {
  console.log('Backfilling commissions.affiliate_id from Rewardful (expand[]=sale)...\n');

  let page = 1;
  let totalPages = 1;
  let fetched = 0;
  let withAffiliate = 0;
  let missingAffiliate = 0;
  let pending: { id: string; affiliateId: string; saleId: string | null }[] = [];

  do {
    const { data, totalPages: tp } = await fetchPage(page);
    totalPages = tp;
    fetched += data.length;

    for (const c of data) {
      const affiliateId = c.sale?.affiliate?.id ?? null;
      const saleId = c.sale?.id ?? null;
      if (affiliateId) {
        withAffiliate++;
        pending.push({ id: c.id, affiliateId, saleId });
      } else {
        missingAffiliate++;
      }
    }

    if (pending.length >= 500) {
      await applyBatch(pending);
      pending = [];
    }

    console.log(`  page ${page}/${totalPages} — fetched ${fetched}, with affiliate ${withAffiliate}, missing ${missingAffiliate}`);
    page++;
    if (page <= totalPages) await new Promise((r) => setTimeout(r, 700));
  } while (page <= totalPages);

  await applyBatch(pending);

  const [cov] = await sql`
    SELECT COUNT(*)::int AS total, COUNT(affiliate_id)::int AS with_affiliate,
           COUNT(sale_id)::int AS with_sale
    FROM commissions
  ` as unknown as { total: number; with_affiliate: number; with_sale: number }[];

  console.log(`\nDone. API commissions fetched: ${fetched} (with affiliate: ${withAffiliate}, without: ${missingAffiliate})`);
  console.log(`DB coverage: ${cov.with_affiliate}/${cov.total} rows have affiliate_id, ${cov.with_sale}/${cov.total} have sale_id`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
