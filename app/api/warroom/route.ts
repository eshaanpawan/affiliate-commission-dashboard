// War-room data: every affiliate scored from PostHog ground truth
// (affiliate_traffic), joined with Rewardful rollups, enforcement state and holds.

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isAuthed } from '@/lib/auth';
import {
  AdRisk,
  TokenTraffic,
  buildCampaignOwners,
  computeAdRisk,
} from '@/lib/ad-detection';

export const maxDuration = 60;

interface WarRoomAffiliate {
  id: string;
  name: string;
  email: string | null;
  rewardfulStatus: string;
  reviewStatus: string;
  enforcementState: string;
  fraudTags: string[];
  tokens: string[];
  unpaidCommissionCents: number;
  paidCommissionCents: number;
  conversions: number;
  clicks: number;
  holdStatus: string | null;
  countries: { code: string; name: string; conversions: number }[];
  observedAdTerms: {
    field: 'utm_term' | 'utm_campaign';
    value: string;
    referrals: number;
    brandMatch: boolean;
  }[];
  commercialAssessment: 'productive_unproven' | 'nonconverting_paid' | 'insufficient_evidence';
  risk: AdRisk;
}

export async function GET(req: Request) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(400, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 180));

  const [trafficRows, tokenAffRows, affRows, holdRows, dailyRows, countryRows, adTermRows] = await Promise.all([
    // Per-token traffic summed over the window, campaign arrays unioned.
    db.execute(sql`
      SELECT t.via_token,
        SUM(t.signups)::int AS signups,
        SUM(t.signups_with_any_ad_param)::int AS ad_signups,
        SUM(t.fts)::int AS fts,
        SUM(t.pageviews)::int AS pageviews,
        COALESCE((
          SELECT array_agg(DISTINCT c) FROM affiliate_traffic t2, unnest(t2.campaign_ids) AS c
          WHERE t2.via_token = t.via_token AND t2.day >= CURRENT_DATE - ${days - 1}::int AND c <> ''
        ), '{}') AS campaign_ids,
        COALESCE((
          SELECT array_agg(DISTINCT c) FROM affiliate_traffic t2, unnest(t2.campaign_ids_ours) AS c
          WHERE t2.via_token = t.via_token AND t2.day >= CURRENT_DATE - ${days - 1}::int AND c <> ''
        ), '{}') AS campaign_ids_ours
      FROM affiliate_traffic t
      WHERE t.day >= CURRENT_DATE - ${days - 1}::int
      GROUP BY t.via_token
    `),
    // token -> affiliate (earliest referral wins, same rule the tts route uses)
    db.execute(sql`
      SELECT DISTINCT ON (link_token) link_token, affiliate_id
      FROM referrals
      WHERE link_token IS NOT NULL AND affiliate_id IS NOT NULL
      ORDER BY link_token, created_at ASC
    `),
    db.execute(sql`
      SELECT rewardful_id, first_name, last_name, email, status, review_status,
        enforcement_state, COALESCE(fraud_tags, '[]'::jsonb) AS fraud_tags,
        unpaid_commission_cents, paid_commission_cents, conversions, visitors
      FROM affiliates WHERE status <> 'deleted'
    `),
    db.execute(sql`SELECT affiliate_id, status FROM commission_holds`),
    // Daily ad-vs-organic series for the hero chart.
    db.execute(sql`
      SELECT day,
        SUM(signups)::int AS signups,
        SUM(signups_with_any_ad_param)::int AS ad_signups,
        SUM(fts)::int AS fts,
        SUM(pageviews)::int AS pageviews
      FROM affiliate_traffic
      WHERE day >= CURRENT_DATE - ${days - 1}::int
      GROUP BY day ORDER BY day ASC
    `),
    db.execute(sql`
      SELECT affiliate_id, country_code, country_name, COUNT(*)::int AS conversions
      FROM referrals
      WHERE status = 'converted' AND affiliate_id IS NOT NULL AND country_code IS NOT NULL
        AND created_at >= CURRENT_DATE - ${days - 1}::int
      GROUP BY affiliate_id, country_code, country_name
      ORDER BY conversions DESC
    `),
    db.execute(sql`
      WITH evidence AS (
        SELECT affiliate_id, 'utm_term'::text AS field, TRIM(utm_term) AS value,
          COUNT(*)::int AS referrals
        FROM referrals
        WHERE affiliate_id IS NOT NULL
          AND created_at >= CURRENT_DATE - ${days - 1}::int
          AND utm_term IS NOT NULL AND TRIM(utm_term) <> ''
        GROUP BY affiliate_id, TRIM(utm_term)
        UNION ALL
        SELECT affiliate_id, 'utm_campaign'::text AS field, TRIM(utm_campaign) AS value,
          COUNT(*)::int AS referrals
        FROM referrals
        WHERE affiliate_id IS NOT NULL
          AND created_at >= CURRENT_DATE - ${days - 1}::int
          AND utm_campaign IS NOT NULL AND TRIM(utm_campaign) <> ''
        GROUP BY affiliate_id, TRIM(utm_campaign)
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY affiliate_id ORDER BY referrals DESC, value ASC
        ) AS position
        FROM evidence
      )
      SELECT affiliate_id, field, value, referrals
      FROM ranked
      WHERE position <= 12
      ORDER BY affiliate_id, referrals DESC, value ASC
    `),
  ]);

  const trafficByToken = new Map<string, TokenTraffic>();
  for (const r of trafficRows.rows as Record<string, unknown>[]) {
    trafficByToken.set(String(r.via_token), {
      viaToken: String(r.via_token),
      signups: Number(r.signups),
      signupsWithAnyAdParam: Number(r.ad_signups),
      fts: Number(r.fts),
      pageviews: Number(r.pageviews),
      campaignIds: (r.campaign_ids as string[]) ?? [],
      campaignIdsOurs: (r.campaign_ids_ours as string[]) ?? [],
    });
  }

  const affiliateByToken = new Map<string, string>();
  for (const r of tokenAffRows.rows as Record<string, unknown>[]) {
    affiliateByToken.set(String(r.link_token), String(r.affiliate_id));
  }

  const tokensByAffiliate = new Map<string, string[]>();
  for (const [token, aff] of affiliateByToken) {
    if (!trafficByToken.has(token)) continue;
    const list = tokensByAffiliate.get(aff) ?? [];
    list.push(token);
    tokensByAffiliate.set(aff, list);
  }

  const holdByAffiliate = new Map<string, string>();
  for (const r of holdRows.rows as Record<string, unknown>[]) {
    holdByAffiliate.set(String(r.affiliate_id), String(r.status));
  }

  const countriesByAffiliate = new Map<string, { code: string; name: string; conversions: number }[]>();
  for (const r of countryRows.rows as Record<string, unknown>[]) {
    const affiliateId = String(r.affiliate_id);
    const list = countriesByAffiliate.get(affiliateId) ?? [];
    list.push({ code: String(r.country_code), name: String(r.country_name ?? r.country_code), conversions: Number(r.conversions) });
    countriesByAffiliate.set(affiliateId, list);
  }

  const termsByAffiliate = new Map<string, WarRoomAffiliate['observedAdTerms']>();
  for (const r of adTermRows.rows as Record<string, unknown>[]) {
    const affiliateId = String(r.affiliate_id);
    const value = String(r.value);
    const normalized = value.toLowerCase();
    const list = termsByAffiliate.get(affiliateId) ?? [];
    list.push({
      field: String(r.field) === 'utm_term' ? 'utm_term' : 'utm_campaign',
      value,
      referrals: Number(r.referrals),
      brandMatch: normalized.includes('runable') || normalized.includes('runable.com'),
    });
    termsByAffiliate.set(affiliateId, list);
  }

  const campaignOwners = buildCampaignOwners(trafficByToken, affiliateByToken);

  const affiliates: WarRoomAffiliate[] = [];
  for (const r of affRows.rows as Record<string, unknown>[]) {
    const id = String(r.rewardful_id);
    const tokens = tokensByAffiliate.get(id) ?? [];
    const rows = tokens.map(t => trafficByToken.get(t)!).filter(Boolean);
    const risk = computeAdRisk(rows, campaignOwners, id);
    affiliates.push({
      id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || '(unnamed)',
      email: (r.email as string) ?? null,
      rewardfulStatus: String(r.status),
      reviewStatus: String(r.review_status ?? 'unreviewed'),
      enforcementState: String(r.enforcement_state ?? 'none'),
      fraudTags: (r.fraud_tags as string[]) ?? [],
      tokens,
      unpaidCommissionCents: Number(r.unpaid_commission_cents ?? 0),
      paidCommissionCents: Number(r.paid_commission_cents ?? 0),
      conversions: Number(r.conversions ?? 0),
      clicks: Number(r.visitors ?? 0),
      holdStatus: holdByAffiliate.get(id) ?? null,
      countries: countriesByAffiliate.get(id) ?? [],
      observedAdTerms: termsByAffiliate.get(id) ?? [],
      commercialAssessment: risk.stats.adSignups >= 10 && risk.stats.fts >= 3
        ? 'productive_unproven'
        : risk.stats.adSignups >= 10 && risk.stats.fts === 0
          ? 'nonconverting_paid'
          : 'insufficient_evidence',
      risk,
    });
  }
  affiliates.sort((a, b) =>
    b.risk.score - a.risk.score || b.unpaidCommissionCents - a.unpaidCommissionCents);

  // Campaign-overlap table: campaigns used by 2+ affiliates or belonging to us.
  const affiliateNameById = new Map(affiliates.map(a => [a.id, a.name]));
  const ourCampaignSet = new Set(
    [...trafficByToken.values()].flatMap(t => t.campaignIdsOurs));
  const campaignOverlap = [...campaignOwners.entries()]
    .filter(([cid, owners]) => owners.size > 1 || ourCampaignSet.has(cid))
    .map(([cid, owners]) => ({
      campaignId: cid,
      isOurs: ourCampaignSet.has(cid),
      affiliates: [...owners].map(id => ({ id, name: affiliateNameById.get(id) ?? id })),
    }))
    .sort((a, b) => Number(b.isOurs) - Number(a.isOurs) || b.affiliates.length - a.affiliates.length)
    .slice(0, 100);

  const high = affiliates.filter(a => a.risk.band === 'high');
  const totals = [...trafficByToken.values()].reduce(
    (acc, t) => {
      acc.signups += t.signups;
      acc.adSignups += t.signupsWithAnyAdParam;
      acc.fts += t.fts;
      acc.pageviews += t.pageviews;
      return acc;
    },
    { signups: 0, adSignups: 0, fts: 0, pageviews: 0 });

  return NextResponse.json({
    window: { days },
    summary: {
      totalSignups: totals.signups,
      adSignups: totals.adSignups,
      adPct: totals.signups > 0 ? totals.adSignups / totals.signups : 0,
      totalFts: totals.fts,
      totalPageviews: totals.pageviews,
      affiliatesRunningAds: affiliates.filter(a =>
        a.risk.signals.some(s => s.key === 'paid_ads_traffic')).length,
      campaignHijackers: affiliates.filter(a => a.risk.stats.ourCampaignIds.length > 0).length,
      ringMembers: affiliates.filter(a => a.risk.stats.sharedCampaignIds.length > 0).length,
      highRisk: high.length,
      mediumRisk: affiliates.filter(a => a.risk.band === 'medium').length,
      unpaidAtRiskCents: high.reduce((s, a) => s + a.unpaidCommissionCents, 0),
      unpaidTotalCents: affiliates.reduce((s, a) => s + a.unpaidCommissionCents, 0),
      proposedBans: affiliates.filter(a => a.enforcementState === 'proposed_ban').length,
      banned: affiliates.filter(a => a.enforcementState === 'banned').length,
    },
    daily: (dailyRows.rows as Record<string, unknown>[]).map(r => ({
      day: String(r.day),
      signups: Number(r.signups),
      adSignups: Number(r.ad_signups),
      organicSignups: Math.max(0, Number(r.signups) - Number(r.ad_signups)),
      fts: Number(r.fts),
      pageviews: Number(r.pageviews),
    })),
    affiliates: affiliates.filter(a => a.tokens.length > 0 || a.unpaidCommissionCents > 0),
    campaignOverlap,
  });
}
