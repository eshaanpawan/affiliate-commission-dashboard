// Find affiliates sending high-volume traffic with zero conversions —
// classic fake-traffic / bot-network signature.
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.NEON_DATABASE_URL!);

async function main() {
  const rows = await sql`
    SELECT
      a.rewardful_id, a.first_name, a.last_name, a.email, a.status, a.created_at,
      COALESCE(a.unpaid_commission_cents, 0) AS unpaid,
      COUNT(r.rewardful_id) AS refs,
      COUNT(CASE WHEN r.status = 'converted' THEN 1 END) AS conv,
      COUNT(CASE WHEN r.status = 'lead' THEN 1 END) AS leads,
      COUNT(DISTINCT DATE(r.created_at)) AS active_days,
      MAX(daily.cnt) AS max_daily,
      MIN(r.created_at) AS first_ref,
      MAX(r.created_at) AS last_ref
    FROM affiliates a
    JOIN referrals r ON r.affiliate_id = a.rewardful_id
    JOIN (
      SELECT affiliate_id, DATE(created_at) AS day, COUNT(*) AS cnt
      FROM referrals WHERE status != 'deleted'
      GROUP BY affiliate_id, DATE(created_at)
    ) daily ON daily.affiliate_id = a.rewardful_id
    WHERE r.status != 'deleted' AND a.status != 'deleted'
    GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, a.status, a.created_at, a.unpaid_commission_cents
    HAVING COUNT(r.rewardful_id) >= 500
      AND COUNT(CASE WHEN r.status = 'converted' THEN 1 END) = 0
    ORDER BY COUNT(r.rewardful_id) DESC
    LIMIT 30
  `;
  console.log('=== Zero-conversion mega-traffic affiliates (≥500 refs, 0 conv) ===');
  console.log(`Found ${rows.length}`);
  console.log('');
  for (const r of rows as unknown as { first_name: string; last_name: string; email: string; refs: number; leads: number; active_days: number; max_daily: number; first_ref: string; last_ref: string; status: string; created_at: string }[]) {
    const first = String(r.first_ref).slice(0, 10);
    const last = String(r.last_ref).slice(0, 10);
    console.log(`  ${r.first_name ?? ''} ${r.last_name ?? ''}  <${r.email}>  status=${r.status}`);
    console.log(`    refs=${r.refs}  leads=${r.leads}  conv=0   active_days=${r.active_days}  max_daily=${r.max_daily}`);
    console.log(`    window: ${first} → ${last}  signup=${String(r.created_at).slice(0,10)}`);
    console.log();
  }

  // Also: high-volume LOW-conversion (< 0.5% with > 1000 refs)
  const lowConv = await sql`
    SELECT
      a.first_name, a.last_name, a.email,
      COUNT(r.rewardful_id) AS refs,
      COUNT(CASE WHEN r.status = 'converted' THEN 1 END) AS conv,
      COALESCE(a.unpaid_commission_cents, 0) AS unpaid
    FROM affiliates a
    JOIN referrals r ON r.affiliate_id = a.rewardful_id
    WHERE r.status != 'deleted' AND a.status != 'deleted'
    GROUP BY a.rewardful_id, a.first_name, a.last_name, a.email, a.unpaid_commission_cents
    HAVING COUNT(r.rewardful_id) >= 1000
      AND COUNT(CASE WHEN r.status = 'converted' THEN 1 END)::float / COUNT(r.rewardful_id) < 0.005
      AND COUNT(CASE WHEN r.status = 'converted' THEN 1 END) > 0
    ORDER BY COUNT(r.rewardful_id) DESC
    LIMIT 20
  `;
  console.log('=== High-volume low-conversion (≥1000 refs, <0.5% conv, has at least 1 conv) ===');
  for (const r of lowConv as unknown as { first_name: string; last_name: string; email: string; refs: number; conv: number; unpaid: number }[]) {
    const cr = (Number(r.conv) / Number(r.refs)) * 100;
    console.log(`  ${r.first_name} ${r.last_name} <${r.email}>: ${r.refs} refs, ${r.conv} conv (${cr.toFixed(2)}%), $${(Number(r.unpaid)/100).toFixed(2)} unpaid`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
