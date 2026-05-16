// Aggressive multi-affiliate brand-bidding suspect finder.
// Uses ALL available signals — both fresh URL data (gclid/UTM/referrer) and
// behavioral signals that work even without URL data.
// Run with: npx -y vercel env run -e production -- npx tsx scripts/find-suspects.ts

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

interface Suspect {
  id: string;
  name: string;
  email: string;
  link_token: string | null;
  status: string;
  unpaid_cents: number;
  paid_cents: number;
  total_referrals: number;
  total_conversions: number;
  conv_rate: number;
  instant_count: number;        // conversions in <5 min
  instant_pct: number;
  superfast_count: number;      // conversions in <60s — even more suspicious
  median_ttc_sec: number | null;
  ttc_stddev_sec: number | null;
  burst_max_daily: number;      // largest single-day referral spike
  burst_concentration: number;  // % of all referrals from top single day
  active_days: number;          // distinct days they generated referrals
  same_day_signups: number;     // conversions where click and signup are same calendar day
  with_referrer_pct: number;    // % of referrals with referrer set (post-backfill data)
  google_referrer_pct: number;
  gclid_pct: number;
  paid_utm_pct: number;
  reasons: string[];
  score: number;
}

interface DbAffiliate {
  rewardful_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
  unpaid_commission_cents: number;
  paid_commission_cents: number;
  total_referrals: number;
  total_conversions: number;
}

interface DbReferral {
  affiliate_id: string;
  created_at: string;
  converted_at: string | null;
  status: string;
  referrer: string | null;
  gclid: string | null;
  fbclid: string | null;
  utm_medium: string | null;
  utm_source: string | null;
  customer_email: string | null;
  link_token: string | null;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
function stddev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(v);
}

async function main() {
  console.log('Loading affiliates + referrals from prod DB...');

  const affs = (await sql`
    SELECT
      a.rewardful_id, a.first_name, a.last_name, a.email, a.status,
      COALESCE(a.unpaid_commission_cents, 0) AS unpaid_commission_cents,
      COALESCE(a.paid_commission_cents, 0) AS paid_commission_cents,
      COALESCE(rs.total_referrals, 0) AS total_referrals,
      COALESCE(rs.total_conversions, 0) AS total_conversions
    FROM affiliates a
    LEFT JOIN (
      SELECT affiliate_id, COUNT(*) AS total_referrals,
             COUNT(CASE WHEN status='converted' THEN 1 END) AS total_conversions
      FROM referrals WHERE status != 'deleted'
      GROUP BY affiliate_id
    ) rs ON rs.affiliate_id = a.rewardful_id
    WHERE a.status != 'deleted'
      AND COALESCE(rs.total_referrals, 0) >= 3
  `) as unknown as DbAffiliate[];

  const refs = (await sql`
    SELECT affiliate_id, created_at, converted_at, status, referrer, gclid, fbclid,
           utm_medium, utm_source, customer_email, link_token
    FROM referrals
    WHERE status != 'deleted' AND affiliate_id IS NOT NULL
  `) as unknown as DbReferral[];

  console.log(`Loaded ${affs.length} affiliates with ≥3 referrals and ${refs.length} referrals.`);

  // Group referrals by affiliate
  const byAff = new Map<string, DbReferral[]>();
  for (const r of refs) {
    const list = byAff.get(r.affiliate_id) ?? [];
    list.push(r);
    byAff.set(r.affiliate_id, list);
  }

  const suspects: Suspect[] = [];

  for (const a of affs) {
    const myRefs = byAff.get(a.rewardful_id) ?? [];
    if (myRefs.length === 0) continue;
    const convs = myRefs.filter(r => r.status === 'converted');
    const convRate = myRefs.length > 0 ? convs.length / myRefs.length : 0;

    // TTC analysis
    const ttcs: number[] = [];
    let instantCount = 0;
    let superFastCount = 0;
    let sameDaySignups = 0;
    for (const r of convs) {
      if (!r.created_at || !r.converted_at) continue;
      const start = new Date(r.created_at).getTime();
      const end = new Date(r.converted_at).getTime();
      if (!isFinite(start) || !isFinite(end) || end < start) continue;
      const sec = (end - start) / 1000;
      ttcs.push(sec);
      if (sec < 300) instantCount++;
      if (sec < 60) superFastCount++;
      if (String(r.created_at).slice(0, 10) === String(r.converted_at).slice(0, 10)) sameDaySignups++;
    }
    const instantPct = convs.length > 0 ? instantCount / convs.length : 0;
    const medianTtc = median(ttcs);
    const ttcStd = stddev(ttcs);

    // Burst patterns
    const dayCounts = new Map<string, number>();
    for (const r of myRefs) {
      const d = String(r.created_at).slice(0, 10);
      dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
    }
    const maxDaily = Math.max(0, ...dayCounts.values());
    const burstConc = myRefs.length > 0 ? maxDaily / myRefs.length : 0;

    // URL data coverage (depends on backfill completion)
    const withRef = myRefs.filter(r => r.referrer).length;
    const googleRef = myRefs.filter(r => r.referrer && /google\.|googleadservices|\/aclk/i.test(r.referrer)).length;
    const gclid = myRefs.filter(r => r.gclid).length;
    const paidUtm = myRefs.filter(r => r.utm_medium && ['cpc', 'ppc', 'paid', 'sem'].includes(r.utm_medium.toLowerCase())).length;

    // Score: behavioral first (works without URL data), then URL signals once available
    const reasons: string[] = [];
    let score = 0;

    // 1. Conversion rate anomaly (calibrated tighter than the main scorer)
    if (convRate >= 0.5 && myRefs.length >= 5) { score += 25; reasons.push(`conv_rate=${(convRate*100).toFixed(0)}%`); }
    else if (convRate >= 0.25 && myRefs.length >= 10) { score += 15; reasons.push(`conv_rate=${(convRate*100).toFixed(0)}%`); }
    else if (convRate >= 0.1 && myRefs.length >= 20) { score += 5; reasons.push(`conv_rate=${(convRate*100).toFixed(0)}%`); }

    // 2. Instant conversions
    if (superFastCount >= 2) { score += 30; reasons.push(`${superFastCount} conv <60s`); }
    else if (superFastCount === 1) { score += 15; reasons.push(`1 conv <60s`); }
    if (instantPct >= 0.5 && convs.length >= 4) { score += 20; reasons.push(`${(instantPct*100).toFixed(0)}% instant`); }
    else if (instantPct >= 0.7 && convs.length >= 2) { score += 15; reasons.push(`${(instantPct*100).toFixed(0)}% instant (small n)`); }

    // 3. TTC distribution narrowness (low stddev = automated)
    if (ttcStd !== null && medianTtc !== null && convs.length >= 4 && ttcStd < medianTtc * 0.3 && medianTtc < 600) {
      score += 15; reasons.push(`narrow_ttc median=${medianTtc.toFixed(0)}s std=${ttcStd.toFixed(0)}s`);
    }

    // 4. URL-side: paid traffic
    if (gclid > 0) { score += Math.min(35, (gclid / myRefs.length) * 100); reasons.push(`${gclid} gclid`); }
    if (paidUtm > 0) { score += Math.min(15, (paidUtm / myRefs.length) * 50); reasons.push(`${paidUtm} paid_utm`); }
    if (googleRef / Math.max(1, withRef) >= 0.5 && withRef >= 3) {
      score += 15; reasons.push(`${((googleRef / withRef) * 100).toFixed(0)}% google_referrer`);
    }

    // 5. Burst concentration (one giant day, then nothing)
    if (burstConc >= 0.7 && myRefs.length >= 10) { score += 10; reasons.push(`${(burstConc*100).toFixed(0)}% in 1 day`); }

    // 6. Sales but no paid commission yet — could be fresh fraud
    if (a.paid_commission_cents === 0 && a.unpaid_commission_cents > 1000 && convs.length >= 2 && instantPct >= 0.5) {
      score += 10; reasons.push('unpaid + instant — fresh suspect');
    }

    if (score < 15) continue; // skip noise

    const linkToken = myRefs.find(r => r.link_token)?.link_token ?? null;

    suspects.push({
      id: a.rewardful_id,
      name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email || '?',
      email: a.email ?? '',
      link_token: linkToken,
      status: a.status,
      unpaid_cents: Number(a.unpaid_commission_cents),
      paid_cents: Number(a.paid_commission_cents),
      total_referrals: myRefs.length,
      total_conversions: convs.length,
      conv_rate: convRate,
      instant_count: instantCount,
      instant_pct: instantPct,
      superfast_count: superFastCount,
      median_ttc_sec: medianTtc,
      ttc_stddev_sec: ttcStd,
      burst_max_daily: maxDaily,
      burst_concentration: burstConc,
      active_days: dayCounts.size,
      same_day_signups: sameDaySignups,
      with_referrer_pct: myRefs.length > 0 ? withRef / myRefs.length : 0,
      google_referrer_pct: withRef > 0 ? googleRef / withRef : 0,
      gclid_pct: myRefs.length > 0 ? gclid / myRefs.length : 0,
      paid_utm_pct: myRefs.length > 0 ? paidUtm / myRefs.length : 0,
      reasons,
      score,
    });
  }

  suspects.sort((a, b) => b.score - a.score);

  console.log('');
  console.log('========================================');
  console.log(`Found ${suspects.length} affiliates scoring ≥15 (behavioral or URL signals)`);
  console.log('========================================');
  console.log('');

  for (const s of suspects.slice(0, 30)) {
    console.log(`[score ${s.score}]  ${s.name}  <${s.email}>`);
    console.log(`  link: runable.com/?via=${s.link_token ?? '?'}  status=${s.status}  unpaid=$${(s.unpaid_cents/100).toFixed(2)}`);
    console.log(`  refs=${s.total_referrals} conv=${s.total_conversions} (${(s.conv_rate*100).toFixed(1)}%)  instant=${s.instant_count}/${s.total_conversions} (${(s.instant_pct*100).toFixed(0)}%)  superfast<60s=${s.superfast_count}`);
    console.log(`  median_ttc=${s.median_ttc_sec?.toFixed(0) ?? '?'}s stddev=${s.ttc_stddev_sec?.toFixed(0) ?? '?'}s  burst=${s.burst_max_daily}/${s.active_days}d (${(s.burst_concentration*100).toFixed(0)}%)`);
    if (s.with_referrer_pct > 0) {
      console.log(`  URL data: ${(s.with_referrer_pct*100).toFixed(0)}% w/referrer, google=${(s.google_referrer_pct*100).toFixed(0)}%, gclid=${(s.gclid_pct*100).toFixed(0)}%, paid_utm=${(s.paid_utm_pct*100).toFixed(0)}%`);
    } else {
      console.log(`  URL data: (none captured yet — pre-backfill)`);
    }
    console.log(`  reasons: ${s.reasons.join(' | ')}`);
    console.log(`  google_check: https://www.google.com/search?q=runable+${encodeURIComponent(s.name)}`);
    console.log('');
  }

  // Also dump full ranked list to JSON for further analysis
  const fs = await import('fs');
  fs.writeFileSync('/tmp/suspects.json', JSON.stringify(suspects, null, 2));
  console.log(`Full list of ${suspects.length} suspects written to /tmp/suspects.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
