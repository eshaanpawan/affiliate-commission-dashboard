/**
 * One-time script to backfill customer_email on all existing converted referrals.
 * Fetches all referrals from Rewardful API and updates customer_email in the DB.
 */
import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { getConversionCountriesByEmail } from '../lib/posthog';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const sql = neon(process.env.NEON_DATABASE_URL!);
const API_SECRET = process.env.REWARDFUL_API_SECRET!;
const BASE_URL = 'https://api.getrewardful.com/v1';
const authHeader = 'Basic ' + Buffer.from(API_SECRET + ':').toString('base64');

async function fetchAllReferrals(): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  let page = 1;
  while (true) {
    let res: Response;
    let retries = 0;
    while (true) {
      res = await fetch(`${BASE_URL}/referrals?page=${page}&limit=100`, {
        headers: { Authorization: authHeader },
      });
      if (res.status === 429) {
        retries++;
        const wait = 2000 * retries;
        console.log(`  Rate limited on page ${page}, waiting ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      break;
    }
    if (!res!.ok) throw new Error(`API error: ${res!.status}`);
    const json = await res!.json() as { data: Record<string, unknown>[]; pagination: { total_pages: number } };
    results.push(...json.data);
    console.log(`  Fetched page ${page}/${json.pagination.total_pages} (${results.length} total)`);
    if (page >= json.pagination.total_pages) break;
    page++;
    await new Promise(r => setTimeout(r, 600));
  }
  return results;
}

async function main() {
  console.log('Step 1: Fetching all referrals from Rewardful...');
  const referrals = await fetchAllReferrals();
  const converted = referrals.filter(r => r.conversion_state === 'conversion');
  console.log(`→ ${referrals.length} total referrals, ${converted.length} converted\n`);

  console.log('Step 2: Updating customer_email in DB...');
  let updated = 0;
  for (const r of converted) {
    const customerEmail = (r.customer as { email?: string } | null)?.email ?? null;
    if (!customerEmail) continue;
    await sql`
      UPDATE referrals
      SET customer_email = ${customerEmail}
      WHERE rewardful_id = ${r.id as string}
        AND customer_email IS NULL
    `;
    updated++;
  }
  console.log(`✅ Updated customer_email on ${updated} referrals\n`);

  console.log('Step 3: Running PostHog country enrichment...');
  const countryMap = await getConversionCountriesByEmail();
  console.log(`→ PostHog returned ${countryMap.size} email→country mappings`);

  const toEnrich = await sql`
    SELECT rewardful_id, customer_email
    FROM referrals
    WHERE status = 'converted'
      AND country_code IS NULL
      AND customer_email IS NOT NULL
  `;
  console.log(`→ ${toEnrich.length} converted referrals need country enrichment`);

  let enriched = 0;
  for (const row of toEnrich) {
    const email = (row.customer_email as string).toLowerCase();
    const country = countryMap.get(email);
    if (country) {
      await sql`
        UPDATE referrals
        SET country_code = ${country.country_code}, country_name = ${country.country_name}
        WHERE rewardful_id = ${row.rewardful_id as string}
      `;
      enriched++;
    }
  }
  console.log(`✅ Enriched ${enriched} referrals with country data\n`);
  console.log('🎉 Backfill complete!');
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
