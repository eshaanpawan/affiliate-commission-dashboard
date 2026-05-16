// Quick prod investigation: pulls every signal we know about an affiliate.
// Run with: npx -y vercel env run -e production -- npx tsx scripts/inspect-affiliate.ts <search-term>
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function main() {
  const term = process.argv[2];
  if (!term) {
    console.error('Usage: tsx scripts/inspect-affiliate.ts <name-or-email-or-id-fragment>');
    process.exit(1);
  }

  const affs = await sql`
    SELECT rewardful_id, first_name, last_name, email, status, created_at, review_status,
           visitors, leads, conversions,
           COALESCE(unpaid_commission_cents,0) AS unpaid,
           COALESCE(paid_commission_cents,0) AS paid
    FROM affiliates
    WHERE LOWER(email) LIKE ${'%' + term.toLowerCase() + '%'}
       OR LOWER(COALESCE(first_name,'')) LIKE ${'%' + term.toLowerCase() + '%'}
       OR LOWER(COALESCE(last_name,'')) LIKE ${'%' + term.toLowerCase() + '%'}
       OR rewardful_id = ${term}
    LIMIT 20
  `;
  console.log(`Found ${affs.length} affiliates matching "${term}":`);
  for (const a of affs) {
    console.log(`\n  ${a.first_name ?? ''} ${a.last_name ?? ''}  <${a.email}>`);
    console.log(`  id=${a.rewardful_id} status=${a.status} review=${a.review_status}`);
    console.log(`  visitors=${a.visitors} leads=${a.leads} conversions=${a.conversions}`);
    console.log(`  unpaid=$${(a.unpaid/100).toFixed(2)} paid=$${(a.paid/100).toFixed(2)}`);

    const tokens = await sql`SELECT DISTINCT link_token FROM referrals WHERE affiliate_id = ${a.rewardful_id} AND link_token IS NOT NULL`;
    console.log(`  link tokens: ${tokens.map((t) => t.link_token).join(', ')}`);

    const refStats = await sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) AS converted,
        COUNT(CASE WHEN customer_email IS NOT NULL THEN 1 END) AS with_email,
        COUNT(CASE WHEN referrer IS NOT NULL THEN 1 END) AS with_referrer,
        COUNT(CASE WHEN gclid IS NOT NULL THEN 1 END) AS with_gclid,
        COUNT(CASE WHEN utm_medium IS NOT NULL THEN 1 END) AS with_utm,
        COUNT(CASE WHEN country_code IS NOT NULL THEN 1 END) AS with_country
      FROM referrals WHERE affiliate_id = ${a.rewardful_id} AND status != 'deleted'
    `;
    console.log(`  referral data quality: ${JSON.stringify(refStats[0])}`);

    const converted = await sql`
      SELECT rewardful_id, created_at, converted_at, customer_email, referrer, landing_page,
             utm_source, utm_medium, utm_campaign, gclid, country_code, country_name
      FROM referrals
      WHERE affiliate_id = ${a.rewardful_id} AND status = 'converted'
      ORDER BY converted_at DESC
    `;
    console.log(`  Converted referrals (${converted.length}):`);
    for (const r of converted) {
      const ttcSec = r.converted_at && r.created_at
        ? ((new Date(r.converted_at as string).getTime() - new Date(r.created_at as string).getTime()) / 1000).toFixed(0)
        : '?';
      console.log(`    ${String(r.converted_at).slice(0, 19)} ttc=${ttcSec}s email=${r.customer_email} country=${r.country_code} ref=${r.referrer ?? '-'} utm=${r.utm_source}/${r.utm_medium} gclid=${r.gclid ? 'Y' : '-'}`);
    }

    // Self-referral check
    const selfMatch = await sql`
      SELECT COUNT(*) AS cnt FROM referrals
      WHERE affiliate_id = ${a.rewardful_id} AND customer_email IS NOT NULL
        AND LOWER(customer_email) = LOWER(${a.email ?? ''})
    `;
    console.log(`  self-referral exact matches: ${selfMatch[0].cnt}`);

    // Cross-affiliate customer email reuse
    const shared = await sql`
      SELECT r1.customer_email, COUNT(DISTINCT r2.affiliate_id) AS aff_count
      FROM referrals r1
      JOIN referrals r2 ON LOWER(r1.customer_email) = LOWER(r2.customer_email)
      WHERE r1.affiliate_id = ${a.rewardful_id}
        AND r1.customer_email IS NOT NULL
        AND r2.affiliate_id != r1.affiliate_id
      GROUP BY r1.customer_email
      LIMIT 10
    `;
    if (shared.length > 0) {
      console.log(`  customer emails seen under OTHER affiliates:`);
      for (const s of shared) console.log(`    - ${s.customer_email} (also ${s.aff_count} others)`);
    } else {
      console.log(`  no shared customer emails with other affiliates`);
    }

    // Commission history
    const commStats = await sql`
      SELECT status, COUNT(*) AS cnt, COALESCE(SUM(amount_cents),0) AS total_cents
      FROM commissions WHERE affiliate_id = ${a.rewardful_id}
      GROUP BY status
    `;
    console.log(`  commissions: ${commStats.map((c) => `${c.status}=${c.cnt} ($${(Number(c.total_cents)/100).toFixed(2)})`).join(', ')}`);

    // Sales history
    const saleStats = await sql`
      SELECT status, COUNT(*) AS cnt, COALESCE(SUM(amount_cents),0) AS total_cents
      FROM sales WHERE affiliate_id = ${a.rewardful_id}
      GROUP BY status
    `;
    console.log(`  sales: ${saleStats.map((s) => `${s.status}=${s.cnt} ($${(Number(s.total_cents)/100).toFixed(2)})`).join(', ')}`);

    // Time-clustering: distribution of referrals by day-of-week
    const dayDist = await sql`
      SELECT DATE(created_at) AS day, COUNT(*) AS cnt
      FROM referrals WHERE affiliate_id = ${a.rewardful_id}
      GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30
    `;
    console.log(`  recent daily referral counts:`);
    for (const d of dayDist.slice(0, 10)) console.log(`    ${d.day} → ${d.cnt}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
