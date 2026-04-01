import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const sql = neon(process.env.NEON_DATABASE_URL!);
const API_SECRET = process.env.REWARDFUL_API_SECRET!;
const BASE_URL = 'https://api.getrewardful.com/v1';
const authHeader = 'Basic ' + Buffer.from(API_SECRET + ':').toString('base64');

async function main() {
  console.log('Fetching commission stats per affiliate from Rewardful...\n');

  const affiliates = await sql`SELECT rewardful_id FROM affiliates WHERE status != 'deleted' ORDER BY created_at DESC`;
  console.log(`Processing ${affiliates.length} affiliates...\n`);

  let updated = 0;
  for (const { rewardful_id } of affiliates) {
    const res = await fetch(`${BASE_URL}/affiliates/${rewardful_id}`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) { await new Promise(r => setTimeout(r, 300)); continue; }

    const data = await res.json() as Record<string, unknown>;
    const stats = (data.commission_stats as { currencies?: { USD?: { unpaid?: { cents?: number }; paid?: { cents?: number }; gross_revenue?: { cents?: number } } } })?.currencies?.USD;

    const unpaid = stats?.unpaid?.cents ?? 0;
    const paid = stats?.paid?.cents ?? 0;
    const gross = stats?.gross_revenue?.cents ?? 0;

    if (unpaid > 0 || paid > 0 || gross > 0) {
      await sql`
        UPDATE affiliates
        SET unpaid_commission_cents = ${unpaid},
            paid_commission_cents = ${paid},
            gross_revenue_cents = ${gross}
        WHERE rewardful_id = ${rewardful_id}
      `;
      updated++;
      console.log(`  ✓ ${data.first_name} ${data.last_name}: unpaid=$${(unpaid/100).toFixed(2)} paid=$${(paid/100).toFixed(2)} revenue=$${(gross/100).toFixed(2)}`);
    }

    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n✅ Done! Updated ${updated} affiliates with commission stats.`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
