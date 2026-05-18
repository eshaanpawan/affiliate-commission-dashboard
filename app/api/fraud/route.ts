import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { computeAffiliateRisk, ReferralSignalRow } from '@/lib/fraud-detection';

// Cached check: is the fraud_tags column present? Set by /api/admin/migrate.
let fraudTagsColumnExists: boolean | null = null;
async function hasFraudTagsColumn(): Promise<boolean> {
  if (fraudTagsColumnExists !== null) return fraudTagsColumnExists;
  const r = await sql`
    SELECT 1 AS x FROM information_schema.columns
    WHERE table_name = 'affiliates' AND column_name = 'fraud_tags' LIMIT 1
  `;
  fraudTagsColumnExists = r.length > 0;
  return fraudTagsColumnExists;
}

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
  fraud_tags: string[] | null;
  unpaid_commission_cents: number;
  paid_commission_cents: number;
  total_referrals: number;
  total_conversions: number;
  primary_link_token: string | null;
}

interface ReferralRow extends ReferralSignalRow {
  affiliate_id: string;
}

interface CommissionStatRow {
  affiliate_id: string;
  total: number;
  refunded: number;
  refunded_amount_cents: number;
}

interface OverlapRow {
  affiliate_id: string;
  shared_visitor_count: number;
  shared_customer_count: number;
}

interface NameKeyRow {
  rewardful_id: string;
  name_key: string;
  created_at: string;
}

export async function GET() {
  const [
    affiliatesRaw,
    referralsRaw,
    commissionStatsRaw,
    visitorOverlapRaw,
    customerOverlapRaw,
    nameKeyRaw,
  ] = await Promise.all([
    (await hasFraudTagsColumn()) ? sql`
      SELECT
        a.rewardful_id, a.first_name, a.last_name, a.email, a.status, a.created_at,
        a.review_status, a.review_notes, a.reviewed_at, a.known_url,
        COALESCE(a.fraud_tags, '[]'::jsonb) AS fraud_tags,
        COALESCE(a.unpaid_commission_cents, 0) AS unpaid_commission_cents,
        COALESCE(a.paid_commission_cents, 0) AS paid_commission_cents,
        COALESCE(r_stats.total_referrals, 0) AS total_referrals,
        COALESCE(r_stats.total_conversions, 0) AS total_conversions,
        link_stats.primary_link_token AS primary_link_token
      FROM affiliates a
      LEFT JOIN (
        SELECT affiliate_id,
          COUNT(*) AS total_referrals,
          COUNT(CASE WHEN status = 'converted' THEN 1 END) AS total_conversions
        FROM referrals
        WHERE status != 'deleted'
        GROUP BY affiliate_id
      ) r_stats ON r_stats.affiliate_id = a.rewardful_id
      LEFT JOIN LATERAL (
        SELECT link_token AS primary_link_token
        FROM referrals
        WHERE affiliate_id = a.rewardful_id AND link_token IS NOT NULL
        GROUP BY link_token
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) link_stats ON true
      WHERE a.status != 'deleted'
        AND COALESCE(r_stats.total_referrals, 0) > 0` : sql`
      SELECT
        a.rewardful_id, a.first_name, a.last_name, a.email, a.status, a.created_at,
        a.review_status, a.review_notes, a.reviewed_at, a.known_url,
        '[]'::jsonb AS fraud_tags,
        COALESCE(a.unpaid_commission_cents, 0) AS unpaid_commission_cents,
        COALESCE(a.paid_commission_cents, 0) AS paid_commission_cents,
        COALESCE(r_stats.total_referrals, 0) AS total_referrals,
        COALESCE(r_stats.total_conversions, 0) AS total_conversions,
        link_stats.primary_link_token AS primary_link_token
      FROM affiliates a
      LEFT JOIN (
        SELECT affiliate_id,
          COUNT(*) AS total_referrals,
          COUNT(CASE WHEN status = 'converted' THEN 1 END) AS total_conversions
        FROM referrals
        WHERE status != 'deleted'
        GROUP BY affiliate_id
      ) r_stats ON r_stats.affiliate_id = a.rewardful_id
      LEFT JOIN LATERAL (
        SELECT link_token AS primary_link_token
        FROM referrals
        WHERE affiliate_id = a.rewardful_id AND link_token IS NOT NULL
        GROUP BY link_token
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) link_stats ON true
      WHERE a.status != 'deleted'
        AND COALESCE(r_stats.total_referrals, 0) > 0
    `,
    sql`
      SELECT affiliate_id, status, created_at, converted_at,
             referrer, landing_page,
             utm_source, utm_medium, utm_campaign,
             gclid, fbclid,
             customer_email, visitor_id
      FROM referrals
      WHERE status != 'deleted'
        AND affiliate_id IS NOT NULL
        AND created_at >= NOW() - INTERVAL '180 days'
    `,
    sql`
      SELECT
        affiliate_id,
        COUNT(*) AS total,
        COUNT(CASE WHEN status IN ('voided', 'refunded', 'deleted') THEN 1 END) AS refunded,
        COALESCE(SUM(CASE WHEN status IN ('voided', 'refunded', 'deleted') THEN amount_cents ELSE 0 END), 0) AS refunded_amount_cents
      FROM commissions
      WHERE affiliate_id IS NOT NULL
      GROUP BY affiliate_id
    `,
    // Visitor IDs that appear under >1 affiliate — count per-affiliate
    sql`
      WITH shared AS (
        SELECT visitor_id
        FROM referrals
        WHERE visitor_id IS NOT NULL AND affiliate_id IS NOT NULL AND status != 'deleted'
        GROUP BY visitor_id
        HAVING COUNT(DISTINCT affiliate_id) > 1
      )
      SELECT r.affiliate_id, COUNT(DISTINCT r.visitor_id) AS shared_visitor_count
      FROM referrals r JOIN shared s ON s.visitor_id = r.visitor_id
      WHERE r.affiliate_id IS NOT NULL
      GROUP BY r.affiliate_id
    `,
    // Customer emails seen under >1 affiliate
    sql`
      WITH shared AS (
        SELECT LOWER(customer_email) AS email
        FROM referrals
        WHERE customer_email IS NOT NULL AND affiliate_id IS NOT NULL AND status != 'deleted'
        GROUP BY LOWER(customer_email)
        HAVING COUNT(DISTINCT affiliate_id) > 1
      )
      SELECT r.affiliate_id, COUNT(DISTINCT LOWER(r.customer_email)) AS shared_customer_count
      FROM referrals r JOIN shared s ON s.email = LOWER(r.customer_email)
      WHERE r.affiliate_id IS NOT NULL
      GROUP BY r.affiliate_id
    `,
    // Name keys for duplicate-name + signup-time clustering.
    // Require BOTH first AND last name to be present (single-word names cluster too loosely).
    sql`
      SELECT rewardful_id, created_at,
             LOWER(TRIM(first_name || ' ' || last_name)) AS name_key
      FROM affiliates
      WHERE status != 'deleted'
        AND first_name IS NOT NULL AND last_name IS NOT NULL
        AND LENGTH(TRIM(first_name)) >= 2 AND LENGTH(TRIM(last_name)) >= 2
    `,
  ]);

  const affiliates = affiliatesRaw as unknown as AffiliateRow[];
  const referrals = referralsRaw as unknown as ReferralRow[];
  const commissionStats = commissionStatsRaw as unknown as CommissionStatRow[];
  const visitorOverlap = visitorOverlapRaw as unknown as OverlapRow[];
  const customerOverlap = customerOverlapRaw as unknown as OverlapRow[];
  const nameKeys = nameKeyRaw as unknown as NameKeyRow[];

  // Duplicate-name index: how many OTHER affiliates share this name_key
  const nameToIds = new Map<string, string[]>();
  for (const n of nameKeys) {
    if (!n.name_key) continue;
    const list = nameToIds.get(n.name_key) ?? [];
    list.push(n.rewardful_id);
    nameToIds.set(n.name_key, list);
  }
  const dupCountById = new Map<string, number>();
  for (const n of nameKeys) {
    if (!n.name_key) continue;
    const others = nameToIds.get(n.name_key) ?? [];
    dupCountById.set(n.rewardful_id, Math.max(0, others.length - 1));
  }

  // Signup-time cluster: minutes to nearest other affiliate (any direction)
  const sortedByTime = [...nameKeys].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const nearestMinutesById = new Map<string, number | null>();
  for (let i = 0; i < sortedByTime.length; i++) {
    const me = sortedByTime[i];
    let nearest: number | null = null;
    if (i > 0) {
      const dPrev = (new Date(me.created_at).getTime() - new Date(sortedByTime[i - 1].created_at).getTime()) / 60000;
      nearest = dPrev;
    }
    if (i < sortedByTime.length - 1) {
      const dNext = (new Date(sortedByTime[i + 1].created_at).getTime() - new Date(me.created_at).getTime()) / 60000;
      if (nearest === null || dNext < nearest) nearest = dNext;
    }
    nearestMinutesById.set(me.rewardful_id, nearest);
  }

  // Group referrals by affiliate
  const byAffiliate = new Map<string, ReferralSignalRow[]>();
  for (const r of referrals) {
    if (!r.affiliate_id) continue;
    const list = byAffiliate.get(r.affiliate_id) ?? [];
    list.push(r);
    byAffiliate.set(r.affiliate_id, list);
  }

  // Lookup maps for commission/overlap context
  const refundMap = new Map<string, CommissionStatRow>();
  for (const c of commissionStats) refundMap.set(c.affiliate_id, c);

  const visitorOverlapMap = new Map<string, number>();
  for (const o of visitorOverlap) visitorOverlapMap.set(o.affiliate_id, Number(o.shared_visitor_count));
  const customerOverlapMap = new Map<string, number>();
  for (const o of customerOverlap) customerOverlapMap.set(o.affiliate_id, Number(o.shared_customer_count));

  // Compute risk for each affiliate
  const enriched = affiliates.map((a) => {
    const refs = byAffiliate.get(a.rewardful_id) ?? [];
    const refundCtx = refundMap.get(a.rewardful_id);
    const risk = computeAffiliateRisk({
      rewardful_id: a.rewardful_id,
      referrals: refs,
      affiliate: { email: a.email, first_name: a.first_name, last_name: a.last_name },
      refunds: refundCtx ? {
        total_commissions: Number(refundCtx.total),
        refunded_commissions: Number(refundCtx.refunded),
        refunded_amount_cents: Number(refundCtx.refunded_amount_cents),
      } : undefined,
      crossAffiliate: {
        shared_visitor_count: visitorOverlapMap.get(a.rewardful_id) ?? 0,
        shared_customer_count: customerOverlapMap.get(a.rewardful_id) ?? 0,
      },
      duplicateNameCount: dupCountById.get(a.rewardful_id) ?? 0,
      signupClusterMinutes: nearestMinutesById.get(a.rewardful_id) ?? null,
    });
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
      fraudTags: Array.isArray(a.fraud_tags) ? a.fraud_tags : [],
      linkToken: a.primary_link_token,
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
    // New: cross-affiliate anomaly counts
    affiliatesWithSelfReferral: enriched.filter(e => e.risk.stats.selfReferralCount > 0).length,
    affiliatesWithSharedCustomers: enriched.filter(e => e.risk.stats.sharedCustomerCount > 0).length,
    affiliatesWithHighRefundRate: enriched.filter(e => e.risk.stats.refundRate >= 0.15).length,
    affiliatesWithDuplicateName: enriched.filter(e => e.risk.stats.duplicateNameCount > 0).length,
    affiliatesWithBurstPattern: enriched.filter(e => e.risk.stats.burstConcentration >= 0.7 && e.referrals >= 10).length,
    affiliatesWithSuperFastConv: enriched.filter(e => e.risk.stats.superFastConvCount > 0).length,
    affiliatesTaggedBrandBidding: enriched.filter(e => e.fraudTags.includes('brand_bidding')).length,
    affiliatesTaggedAnyFraud: enriched.filter(e => e.fraudTags.length > 0).length,
  };

  return NextResponse.json({ summary, affiliates: enriched });
}
