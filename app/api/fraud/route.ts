import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { computeAffiliateRisk, ReferralSignalRow } from '@/lib/fraud-detection';

interface AffiliateRow {
  rewardful_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
  created_at: string;
  review_status: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  known_url: string | null;
  unpaid_commission_cents: number;
  paid_commission_cents: number;
  total_referrals: number;
  total_conversions: number;
}

interface ReferralRow extends ReferralSignalRow {
  affiliate_id: string;
}

export async function GET() {
  const [affiliatesRaw, referralsRaw] = await Promise.all([
    sql`
      SELECT
        a.rewardful_id, a.first_name, a.last_name, a.email, a.status, a.created_at,
        a.review_status, a.review_notes, a.reviewed_at, a.known_url,
        COALESCE(a.unpaid_commission_cents, 0) AS unpaid_commission_cents,
        COALESCE(a.paid_commission_cents, 0) AS paid_commission_cents,
        COALESCE(r_stats.total_referrals, 0) AS total_referrals,
        COALESCE(r_stats.total_conversions, 0) AS total_conversions
      FROM affiliates a
      LEFT JOIN (
        SELECT affiliate_id,
          COUNT(*) AS total_referrals,
          COUNT(CASE WHEN status = 'converted' THEN 1 END) AS total_conversions
        FROM referrals
        WHERE status != 'deleted'
        GROUP BY affiliate_id
      ) r_stats ON r_stats.affiliate_id = a.rewardful_id
      WHERE a.status != 'deleted'
        AND COALESCE(r_stats.total_referrals, 0) > 0
    `,
    sql`
      SELECT affiliate_id, status, created_at, converted_at,
             referrer, landing_page,
             utm_source, utm_medium, utm_campaign,
             gclid, fbclid
      FROM referrals
      WHERE status != 'deleted'
        AND affiliate_id IS NOT NULL
        AND created_at >= NOW() - INTERVAL '180 days'
    `,
  ]);
  const affiliates = affiliatesRaw as unknown as AffiliateRow[];
  const referrals = referralsRaw as unknown as ReferralRow[];

  // Group referrals by affiliate
  const byAffiliate = new Map<string, ReferralSignalRow[]>();
  for (const r of referrals) {
    if (!r.affiliate_id) continue;
    const list = byAffiliate.get(r.affiliate_id) ?? [];
    list.push(r);
    byAffiliate.set(r.affiliate_id, list);
  }

  // Compute risk for each affiliate
  const enriched = affiliates.map((a) => {
    const refs = byAffiliate.get(a.rewardful_id) ?? [];
    const risk = computeAffiliateRisk({ rewardful_id: a.rewardful_id, referrals: refs });
    return {
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
      referrals: Number(a.total_referrals),
      conversions: Number(a.total_conversions),
      risk,
    };
  });

  // Sort: high-risk first, then by unpaid commission (money at stake), then conversions
  enriched.sort((a, b) => {
    if (b.risk.score !== a.risk.score) return b.risk.score - a.risk.score;
    if (b.unpaidCommissionCents !== a.unpaidCommissionCents) return b.unpaidCommissionCents - a.unpaidCommissionCents;
    return b.conversions - a.conversions;
  });

  const summary = {
    totalReviewed: enriched.length,
    highRisk: enriched.filter(e => e.risk.band === 'high').length,
    mediumRisk: enriched.filter(e => e.risk.band === 'medium').length,
    lowRisk: enriched.filter(e => e.risk.band === 'low').length,
    flagged: enriched.filter(e => e.reviewStatus === 'flagged').length,
    cleared: enriched.filter(e => e.reviewStatus === 'cleared').length,
    unpaidAtRiskCents: enriched
      .filter(e => e.risk.band === 'high')
      .reduce((sum, e) => sum + e.unpaidCommissionCents, 0),
  };

  return NextResponse.json({ summary, affiliates: enriched });
}
