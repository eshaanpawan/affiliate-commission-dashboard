// Cross-correlate suspects from /tmp/suspects.json — find rings, shared customers,
// matching email patterns. Use this to escalate confidence from "single suspect"
// to "coordinated ring".
import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';

const sql = neon(process.env.NEON_DATABASE_URL!);

interface Suspect {
  id: string; name: string; email: string; link_token: string | null;
  score: number; total_referrals: number; total_conversions: number;
  unpaid_cents: number;
}

interface Match {
  customer_email: string;
  aff_ids: string[];
}

async function main() {
  const raw = fs.readFileSync('/tmp/suspects.json', 'utf-8');
  const suspects: Suspect[] = JSON.parse(raw);
  const suspectIds = suspects.map(s => s.id);
  const nameById = new Map(suspects.map(s => [s.id, s]));

  console.log(`=== Cross-correlating ${suspects.length} suspects ===\n`);

  // 1. Self-referral check (customer email matches affiliate own email)
  console.log('### 1. Self-referral (customer email == affiliate email)');
  for (const s of suspects) {
    const m = await sql`
      SELECT COUNT(*) AS cnt
      FROM referrals
      WHERE affiliate_id = ${s.id}
        AND customer_email IS NOT NULL
        AND LOWER(customer_email) = LOWER(${s.email})
    `;
    if (Number(m[0].cnt) > 0) console.log(`  ⚠️ ${s.name} (${s.email}): ${m[0].cnt} self-referrals`);
  }

  // 2. Customer-email overlap between suspects
  console.log('\n### 2. Customer-email overlap (same customer under multiple suspect affiliates)');
  const overlap = await sql`
    SELECT LOWER(customer_email) AS email, ARRAY_AGG(DISTINCT affiliate_id) AS aff_ids
    FROM referrals
    WHERE customer_email IS NOT NULL
      AND affiliate_id = ANY(${suspectIds}::text[])
    GROUP BY LOWER(customer_email)
    HAVING COUNT(DISTINCT affiliate_id) > 1
  `;
  if (overlap.length === 0) console.log('  none');
  else for (const o of overlap as unknown as Match[]) {
    console.log(`  ⚠️ ${o.customer_email} under: ${o.aff_ids.map(id => nameById.get(id)?.name ?? id).join(', ')}`);
  }

  // 3. Customer-email overlap between suspect and ANY other affiliate
  console.log('\n### 3. Suspect customer-emails seen under NON-suspect affiliates (potential attribution theft)');
  const wider = await sql`
    WITH suspect_emails AS (
      SELECT DISTINCT LOWER(customer_email) AS email
      FROM referrals
      WHERE customer_email IS NOT NULL AND affiliate_id = ANY(${suspectIds}::text[])
    )
    SELECT r.affiliate_id, COUNT(DISTINCT LOWER(r.customer_email)) AS shared_count
    FROM referrals r
    JOIN suspect_emails se ON se.email = LOWER(r.customer_email)
    WHERE NOT (r.affiliate_id = ANY(${suspectIds}::text[]))
      AND r.customer_email IS NOT NULL
    GROUP BY r.affiliate_id
    ORDER BY shared_count DESC
    LIMIT 10
  `;
  if (wider.length === 0) console.log('  none');
  else for (const w of wider as unknown as { affiliate_id: string; shared_count: number }[]) {
    const a = await sql`SELECT first_name, last_name, email FROM affiliates WHERE rewardful_id = ${w.affiliate_id}`;
    const name = a[0] ? `${a[0].first_name ?? ''} ${a[0].last_name ?? ''} <${a[0].email}>` : w.affiliate_id;
    console.log(`  ${w.shared_count} shared customers — ${name}`);
  }

  // 4. Visitor IDs that appear under multiple suspect affiliates
  console.log('\n### 4. Visitor-ID overlap between suspects');
  const vOverlap = await sql`
    SELECT visitor_id, ARRAY_AGG(DISTINCT affiliate_id) AS aff_ids
    FROM referrals
    WHERE visitor_id IS NOT NULL AND affiliate_id = ANY(${suspectIds}::text[])
    GROUP BY visitor_id
    HAVING COUNT(DISTINCT affiliate_id) > 1
    LIMIT 20
  `;
  if (vOverlap.length === 0) console.log('  none captured (data may be sparse)');
  else for (const v of vOverlap as unknown as { visitor_id: string; aff_ids: string[] }[]) {
    console.log(`  ⚠️ visitor ${v.visitor_id.slice(0, 8)}… under: ${v.aff_ids.map(id => nameById.get(id)?.name ?? id).join(', ')}`);
  }

  // 5. Similar account-creation timing
  console.log('\n### 5. Affiliate signup time clusters (suspects within 1h of each other)');
  const tightSignups = await sql`
    SELECT a.rewardful_id, a.first_name, a.last_name, a.email, a.created_at
    FROM affiliates a
    WHERE a.rewardful_id = ANY(${suspectIds}::text[])
    ORDER BY a.created_at
  `;
  const sorted = tightSignups as unknown as { rewardful_id: string; first_name: string; last_name: string; email: string; created_at: string }[];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t1 = new Date(sorted[i].created_at).getTime();
    const t2 = new Date(sorted[i+1].created_at).getTime();
    const diffMin = (t2 - t1) / 60000;
    if (diffMin < 60) {
      console.log(`  ⚠️ ${diffMin.toFixed(0)}min apart:`);
      console.log(`     ${sorted[i].first_name} ${sorted[i].last_name} <${sorted[i].email}>`);
      console.log(`     ${sorted[i+1].first_name} ${sorted[i+1].last_name} <${sorted[i+1].email}>`);
    }
  }

  // 6. Email domain clustering (mostly gmail but check for any clusters)
  console.log('\n### 6. Email domain distribution of suspects');
  const domains = new Map<string, string[]>();
  for (const s of suspects) {
    const dom = s.email.split('@')[1] ?? 'unknown';
    domains.set(dom, [...(domains.get(dom) ?? []), s.name]);
  }
  for (const [dom, names] of [...domains.entries()].sort((a,b) => b[1].length - a[1].length)) {
    console.log(`  ${dom}: ${names.length}  ${names.length < 4 ? '['+names.join(', ')+']' : ''}`);
  }

  // 7. Name pattern clustering (e.g., multiple "David Xakura")
  console.log('\n### 7. Duplicate name patterns');
  const allAffs = await sql`SELECT rewardful_id, first_name, last_name, email FROM affiliates WHERE status != 'deleted'`;
  const byName = new Map<string, { id: string; email: string }[]>();
  for (const a of allAffs as unknown as { rewardful_id: string; first_name: string|null; last_name: string|null; email: string }[]) {
    const key = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push({ id: a.rewardful_id, email: a.email });
    byName.set(key, list);
  }
  for (const [name, accs] of byName.entries()) {
    if (accs.length > 1) {
      console.log(`  ⚠️ ${name}: ${accs.length} accounts`);
      for (const a of accs) console.log(`     ${a.email} (${a.id.slice(0,8)}...)`);
    }
  }

  // 8. Recent burst patterns — affiliates with referral count >> active days
  console.log('\n### 8. Burst affiliates (lots of referrals in short window)');
  const bursts = await sql`
    SELECT
      a.rewardful_id, a.first_name, a.last_name, a.email,
      COUNT(*) AS total_refs,
      COUNT(DISTINCT DATE(r.created_at)) AS active_days,
      MAX(daily.cnt) AS max_daily,
      COALESCE(a.unpaid_commission_cents,0) AS unpaid
    FROM affiliates a
    JOIN referrals r ON r.affiliate_id = a.rewardful_id
    JOIN (
      SELECT affiliate_id, DATE(created_at) AS day, COUNT(*) AS cnt
      FROM referrals
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY affiliate_id, DATE(created_at)
    ) daily ON daily.affiliate_id = a.rewardful_id
    WHERE r.created_at >= NOW() - INTERVAL '30 days'
      AND r.status != 'deleted'
    GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, a.unpaid_commission_cents
    HAVING MAX(daily.cnt) >= 100
    ORDER BY max_daily DESC
    LIMIT 15
  `;
  for (const b of bursts as unknown as { first_name: string; last_name: string; email: string; total_refs: number; active_days: number; max_daily: number; unpaid: number }[]) {
    console.log(`  ${b.first_name} ${b.last_name} <${b.email}>: ${b.max_daily} max/day, ${b.active_days} active days, ${b.total_refs} total, $${(Number(b.unpaid)/100).toFixed(2)} unpaid`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
