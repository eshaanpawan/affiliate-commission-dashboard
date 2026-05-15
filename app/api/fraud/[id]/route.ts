import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { computeAffiliateRisk, ReferralSignalRow } from '@/lib/fraud-detection';

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

  const [affiliate, referralsRaw, links] = await Promise.all([
    sql`
      SELECT
        rewardful_id, first_name, last_name, email, status, created_at,
        review_status, review_notes, reviewed_at, known_url,
        COALESCE(unpaid_commission_cents, 0) AS unpaid_commission_cents,
        COALESCE(paid_commission_cents, 0) AS paid_commission_cents
      FROM affiliates
      WHERE rewardful_id = ${id}
      LIMIT 1
    `,
    sql`
      SELECT rewardful_id, link_token, customer_email,
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
  ]);
  const referrals = referralsRaw as unknown as ReferralRow[];

  if (affiliate.length === 0) {
    return NextResponse.json({ error: 'Affiliate not found' }, { status: 404 });
  }

  const a = affiliate[0];
  const risk = computeAffiliateRisk({
    rewardful_id: id,
    referrals: referrals.map(r => ({
      status: r.status, created_at: r.created_at, converted_at: r.converted_at,
      referrer: r.referrer, landing_page: r.landing_page,
      utm_source: r.utm_source, utm_medium: r.utm_medium, utm_campaign: r.utm_campaign,
      gclid: r.gclid, fbclid: r.fbclid,
    })),
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
