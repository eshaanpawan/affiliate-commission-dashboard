import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { computeAffiliateRisk, normalizeEmail, ReferralSignalRow } from '@/lib/fraud-detection';

interface ReferralRow extends ReferralSignalRow {
  rewardful_id: string;
  link_token: string | null;
  customer_email: string | null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const [affiliate, referralsRaw, links, commissionStats, visitorOverlap, customerOverlap, dupCountResult, signupClusterResult] = await Promise.all([
    sql`
      SELECT
        rewardful_id, first_name, last_name, email, status, created_at,
        review_status, review_notes, reviewed_at, known_url,
        COALESCE(fraud_tags, '[]'::jsonb) AS fraud_tags,
        COALESCE(unpaid_commission_cents, 0) AS unpaid_commission_cents,
        COALESCE(paid_commission_cents, 0) AS paid_commission_cents
      FROM affiliates
      WHERE rewardful_id = ${id}
      LIMIT 1
    `,
    sql`
      SELECT rewardful_id, link_token, customer_email, visitor_id,
             status, created_at, converted_at,
             referrer, landing_page,
             utm_source, utm_medium, utm_campaign,
             gclid, fbclid
      FROM referrals
      WHERE affiliate_id = ${id}
        AND status != 'deleted'
      ORDER BY created_at DESC
      LIMIT 500
    `,
    sql`
      SELECT DISTINCT link_token
      FROM referrals
      WHERE affiliate_id = ${id} AND link_token IS NOT NULL
    `,
    sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status IN ('voided', 'refunded', 'deleted') THEN 1 END) AS refunded,
        COALESCE(SUM(CASE WHEN status IN ('voided', 'refunded', 'deleted') THEN amount_cents ELSE 0 END), 0) AS refunded_amount_cents
      FROM commissions
      WHERE affiliate_id = ${id}
    `,
    sql`
      SELECT COUNT(DISTINCT r.visitor_id) AS cnt
      FROM referrals r
      WHERE r.affiliate_id = ${id} AND r.visitor_id IS NOT NULL AND r.status != 'deleted'
        AND r.visitor_id IN (
          SELECT visitor_id FROM referrals
          WHERE visitor_id IS NOT NULL AND affiliate_id IS NOT NULL AND status != 'deleted'
          GROUP BY visitor_id HAVING COUNT(DISTINCT affiliate_id) > 1
        )
    `,
    sql`
      SELECT COUNT(DISTINCT LOWER(r.customer_email)) AS cnt
      FROM referrals r
      WHERE r.affiliate_id = ${id} AND r.customer_email IS NOT NULL AND r.status != 'deleted'
        AND LOWER(r.customer_email) IN (
          SELECT LOWER(customer_email) FROM referrals
          WHERE customer_email IS NOT NULL AND affiliate_id IS NOT NULL AND status != 'deleted'
          GROUP BY LOWER(customer_email) HAVING COUNT(DISTINCT affiliate_id) > 1
        )
    `,
    // Duplicate-name count: other affiliates with same first+last name
    sql`
      WITH me AS (
        SELECT LOWER(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) AS name_key
        FROM affiliates WHERE rewardful_id = ${id}
      )
      SELECT COUNT(*) AS cnt
      FROM affiliates a, me
      WHERE LOWER(TRIM(COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, ''))) = me.name_key
        AND a.rewardful_id != ${id}
        AND me.name_key != ''
    `,
    // Signup-time cluster: minutes to nearest other affiliate
    sql`
      WITH me AS (SELECT created_at FROM affiliates WHERE rewardful_id = ${id})
      SELECT MIN(ABS(EXTRACT(EPOCH FROM (a.created_at - me.created_at)) / 60)) AS minutes
      FROM affiliates a, me
      WHERE a.rewardful_id != ${id} AND a.status != 'deleted'
    `,
  ]);
  const referrals = referralsRaw as unknown as ReferralRow[];

  if (affiliate.length === 0) {
    return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });
  }

  const a = affiliate[0];
  const cs = commissionStats[0] ?? {};
  const risk = computeAffiliateRisk({
    rewardful_id: id,
    referrals: referrals.map(r => ({
      status: r.status, created_at: r.created_at, converted_at: r.converted_at,
      referrer: r.referrer, landing_page: r.landing_page,
      utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign,
      gclid: r.gclid, fbclid: r.fbclid,
      customer_email: r.customer_email,
      visitor_id: (r as { visitor_id?: string | null }).visitor_id ?? null,
    })),
    affiliate: { email: a.email, first_name: a.first_name, last_name: a.last_name },
    refunds: {
      total_commissions: Number(cs.total ?? 0),
      refunded_commissions: Number(cs.refunded ?? 0),
      refunded_amount_cents: Number(cs.refunded_amount_cents ?? 0),
    },
    crossAffiliate: {
      shared_visitor_count: Number(visitorOverlap[0]?.cnt ?? 0),
      shared_customer_count: Number(customerOverlap[0]?.cnt ?? 0),
    },
    duplicateNameCount: Number(dupCountResult[0]?.cnt ?? 0),
    signupClusterMinutes: signupClusterResult[0]?.minutes !== undefined && signupClusterResult[0].minutes !== null
      ? Number(signupClusterResult[0].minutes) : null,
  });

  // Build top referrers / landing pages distribution
  const referrerCounts = new Map<string, number>();
  const landingCounts = new Map<string, number>();
  for (const r of referrals) {
    if (r.referrer) {
      let host = r.referrer;
      try { host = new URL(r.referrer).hostname.replace(/^www\./, ''); } catch {}
      referrerCounts.set(host, (referrerCounts.get(host) ?? 0) + 1);
    }
    if (r.landing_page) {
      let path = r.landing_page;
      try {
        const u = new URL(r.landing_page);
        path = u.pathname + (u.search ? '?' + u.searchParams.toString() : '');
      } catch {}
      landingCounts.set(path, (landingCounts.get(path) ?? 0) + 1);
    }
  }
  const topReferrers = [...referrerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([host, count]) => ({ host, count }));
  const topLandings = [...landingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  return NextResponse.json({
    affiliate: {
      id: a.rewardful_id,
      name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email || '(no name)',
      email: a.email,
      status: a.status,
      createdAt: a.created_at,
      reviewStatus: a.review_status ?? 'unreviewed',
      reviewNotes: a.review_notes,
      reviewedAt: a.reviewed_at,
      knownUrl: a.known_url,
      fraudTags: Array.isArray(a.fraud_tags) ? a.fraud_tags : [],
      unpaidCommissionCents: Number(a.unpaid_commission_cents),
      paidCommissionCents: Number(a.paid_commission_cents),
    },
    risk,
    linkTokens: links.map((l) => l.link_token).filter(Boolean),
    topReferrers,
    topLandings,
    referrals: referrals.slice(0, 100).map((r) => {
      const ttcSec = (r.created_at && r.converted_at)
        ? Math.max(0, (new Date(r.converted_at).getTime() - new Date(r.created_at).getTime()) / 1000)
        : null;
      const flags: string[] = [];
      if (r.gclid) flags.push('gclid');
      if (r.fbclid) flags.push('fbclid');
      if (r.utm_medium && ['cpc', 'ppc', 'paid', 'sem'].includes(r.utm_medium.toLowerCase())) flags.push('paid_utm');
      if (r.referrer && /google\.|googleadservices|\/aclk/i.test(r.referrer)) flags.push('google_referrer');
      if (ttcSec !== null && ttcSec < 300 && r.status === 'converted') flags.push('instant_convert');
      const normCustomer = normalizeEmail(r.customer_email);
      const normAffiliate = normalizeEmail(a.email);
      if (normCustomer && normAffiliate && normCustomer === normAffiliate) flags.push('self_referral');
      return {
        id: r.rewardful_id,
        status: r.status,
        createdAt: r.created_at,
        convertedAt: r.converted_at,
        customerEmail: r.customer_email,
        referrer: r.referrer,
        landingPage: r.landing_page,
        utmSource: r.utm_source,
        utmMedium: r.utm_medium,
        utmCampaign: r.utm_campaign,
        gclid: r.gclid,
        fbclid: r.fbclid,
        ttcSeconds: ttcSec,
        flags,
      };
    }),
  });
}
