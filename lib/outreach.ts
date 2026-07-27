import 'server-only';

import { createHash } from 'node:crypto';

import sql from '@/lib/db';
import {
  buildCampaignOwners,
  computeAdRisk,
  type TokenTraffic,
} from '@/lib/ad-detection';

export const DEFAULT_AFFILIATE_CAMPAIGN_ID = '2fc18ca4-4de3-41e4-be9a-b7c17211010d';
const OUTREACH_RISK_WINDOW_DAYS = 180;

export function affiliateCampaignId(): string {
  return process.env.INSTANTLY_AFFILIATE_CAMPAIGN_ID || DEFAULT_AFFILIATE_CAMPAIGN_ID;
}

export interface OutreachCandidate {
  affiliateId: string;
  email: string;
  firstName: string;
  lastName: string;
  segment: string;
  sourceUpdatedAt: string | null;
  payloadHash: string;
  lead: {
    email: string;
    first_name: string;
    last_name: string;
    company_name: string;
    custom_variables: Record<string, string | number | boolean | null>;
  };
}

interface AffiliateRow {
  rewardful_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string | null;
  confirmed_at: string | null;
  updated_at: string | null;
  visitors: number | null;
  leads: number | null;
  conversions: number | null;
  unpaid_commission_cents: number | null;
  gross_revenue_cents: number | null;
  review_status: string | null;
  risk_score: number | null;
  fraud_tags: unknown;
  enforcement_state: string | null;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function outreachSegment(row: AffiliateRow, posthogRiskScore: number): string {
  const tags = stringList(row.fraud_tags);
  const risk = Math.max(Number(row.risk_score ?? 0), posthogRiskScore);
  if (
    row.status === 'suspicious'
    || ['proposed_ban', 'banned'].includes(row.enforcement_state ?? '')
    || risk >= 60
    || tags.length > 0
  ) return 'risk_review_high';
  if (risk >= 30 || row.review_status === 'flagged') return 'risk_review_medium';
  if (Number(row.conversions ?? 0) >= 3) return 'partner_active';
  if (row.confirmed_at) return 'onboarding';
  return 'verification_pending';
}

function toCandidate(row: AffiliateRow, posthogRiskScore: number): OutreachCandidate | null {
  const email = String(row.email ?? '').trim().toLowerCase();
  if (!validEmail(email)) return null;

  const firstName = String(row.first_name ?? '').trim();
  const lastName = String(row.last_name ?? '').trim();
  const tags = stringList(row.fraud_tags);
  const manualRiskScore = Number(row.risk_score ?? 0);
  const effectiveRiskScore = Math.max(manualRiskScore, posthogRiskScore);
  const segment = outreachSegment(row, posthogRiskScore);
  const customVariables = {
    rewardful_affiliate_id: row.rewardful_id,
    affiliate_status: row.status ?? 'unknown',
    outreach_segment: segment,
    review_status: row.review_status ?? 'unreviewed',
    enforcement_state: row.enforcement_state ?? 'none',
    risk_score: effectiveRiskScore,
    fraud_tags: tags.join(', '),
    visitors: Number(row.visitors ?? 0),
    rewardful_leads: Number(row.leads ?? 0),
    paid_conversions: Number(row.conversions ?? 0),
    unpaid_commission_usd: Number(row.unpaid_commission_cents ?? 0) / 100,
    gross_revenue_usd: Number(row.gross_revenue_cents ?? 0) / 100,
    confirmed_at: row.confirmed_at ?? '',
    source: 'rewardful',
  } satisfies Record<string, string | number | boolean | null>;

  const lead = {
    email,
    first_name: firstName,
    last_name: lastName,
    company_name: 'Runable Affiliate',
    custom_variables: customVariables,
  };
  const payloadHash = createHash('sha256').update(JSON.stringify(lead)).digest('hex');

  return {
    affiliateId: row.rewardful_id,
    email,
    firstName,
    lastName,
    segment,
    sourceUpdatedAt: row.updated_at,
    payloadHash,
    lead,
  };
}

async function affiliateRows(affiliateId?: string): Promise<AffiliateRow[]> {
  if (affiliateId) {
    const rows = await sql`
      SELECT rewardful_id, first_name, last_name, email, status, confirmed_at, updated_at,
             visitors, leads, conversions, unpaid_commission_cents, gross_revenue_cents,
             review_status, risk_score, fraud_tags, enforcement_state
      FROM affiliates
      WHERE rewardful_id = ${affiliateId}
        AND COALESCE(status, 'active') <> 'deleted'
    `;
    return rows as unknown as AffiliateRow[];
  }
  const rows = await sql`
    SELECT rewardful_id, first_name, last_name, email, status, confirmed_at, updated_at,
           visitors, leads, conversions, unpaid_commission_cents, gross_revenue_cents,
           review_status, risk_score, fraud_tags, enforcement_state
    FROM affiliates
    WHERE COALESCE(status, 'active') <> 'deleted'
    ORDER BY created_at ASC NULLS LAST, rewardful_id ASC
  `;
  return rows as unknown as AffiliateRow[];
}

async function posthogRiskByAffiliate(affiliateId?: string): Promise<Map<string, number>> {
  const [trafficRows, tokenRows] = await Promise.all([
    sql`
      SELECT t.via_token,
        SUM(t.signups)::int AS signups,
        SUM(t.signups_with_any_ad_param)::int AS ad_signups,
        SUM(t.signups_with_google)::int AS google_signups,
        SUM(t.signups_with_meta)::int AS meta_signups,
        SUM(t.signups_with_microsoft)::int AS microsoft_signups,
        SUM(t.signups_with_tiktok)::int AS tiktok_signups,
        SUM(t.signups_with_linkedin)::int AS linkedin_signups,
        SUM(t.signups_with_reddit)::int AS reddit_signups,
        SUM(t.signups_with_x)::int AS x_signups,
        SUM(t.signups_with_apple)::int AS apple_signups,
        SUM(t.fts)::int AS fts,
        SUM(t.pageviews)::int AS pageviews,
        COALESCE((
          SELECT array_agg(DISTINCT campaign_id)
          FROM affiliate_traffic nested, unnest(nested.campaign_ids) AS campaign_id
          WHERE nested.via_token = t.via_token
            AND nested.day >= CURRENT_DATE - ${OUTREACH_RISK_WINDOW_DAYS - 1}::int
            AND campaign_id <> ''
        ), '{}') AS campaign_ids,
        COALESCE((
          SELECT array_agg(DISTINCT campaign_id)
          FROM affiliate_traffic nested, unnest(nested.campaign_ids_ours) AS campaign_id
          WHERE nested.via_token = t.via_token
            AND nested.day >= CURRENT_DATE - ${OUTREACH_RISK_WINDOW_DAYS - 1}::int
            AND campaign_id <> ''
        ), '{}') AS campaign_ids_ours
      FROM affiliate_traffic t
      WHERE t.day >= CURRENT_DATE - ${OUTREACH_RISK_WINDOW_DAYS - 1}::int
      GROUP BY t.via_token
    `,
    sql`
      SELECT DISTINCT ON (link_token) link_token, affiliate_id
      FROM referrals
      WHERE link_token IS NOT NULL AND affiliate_id IS NOT NULL
      ORDER BY link_token, created_at ASC
    `,
  ]);

  const trafficByToken = new Map<string, TokenTraffic>();
  for (const row of trafficRows as Record<string, unknown>[]) {
    trafficByToken.set(String(row.via_token), {
      viaToken: String(row.via_token),
      signups: Number(row.signups ?? 0),
      signupsWithAnyAdParam: Number(row.ad_signups ?? 0),
      networkSignups: {
        google: Number(row.google_signups ?? 0),
        meta: Number(row.meta_signups ?? 0),
        microsoft: Number(row.microsoft_signups ?? 0),
        tiktok: Number(row.tiktok_signups ?? 0),
        linkedin: Number(row.linkedin_signups ?? 0),
        reddit: Number(row.reddit_signups ?? 0),
        x: Number(row.x_signups ?? 0),
        apple: Number(row.apple_signups ?? 0),
      },
      fts: Number(row.fts ?? 0),
      pageviews: Number(row.pageviews ?? 0),
      campaignIds: (row.campaign_ids as string[]) ?? [],
      campaignIdsOurs: (row.campaign_ids_ours as string[]) ?? [],
    });
  }

  const affiliateByToken = new Map<string, string>();
  const tokensByAffiliate = new Map<string, string[]>();
  for (const row of tokenRows as Record<string, unknown>[]) {
    const token = String(row.link_token);
    const owner = String(row.affiliate_id);
    affiliateByToken.set(token, owner);
    if (!trafficByToken.has(token)) continue;
    const tokens = tokensByAffiliate.get(owner) ?? [];
    tokens.push(token);
    tokensByAffiliate.set(owner, tokens);
  }

  const campaignOwners = buildCampaignOwners(trafficByToken, affiliateByToken);
  const scores = new Map<string, number>();
  const affiliateIds = affiliateId ? [affiliateId] : [...tokensByAffiliate.keys()];
  for (const id of affiliateIds) {
    const traffic = (tokensByAffiliate.get(id) ?? [])
      .map((token) => trafficByToken.get(token))
      .filter((row): row is TokenTraffic => Boolean(row));
    scores.set(id, computeAdRisk(traffic, campaignOwners, id).score);
  }
  return scores;
}

export async function getOutreachCandidates(affiliateId?: string): Promise<OutreachCandidate[]> {
  const [rows, posthogRisk] = await Promise.all([
    affiliateRows(affiliateId),
    posthogRiskByAffiliate(affiliateId),
  ]);
  return rows
    .map((row) => toCandidate(row, posthogRisk.get(row.rewardful_id) ?? 0))
    .filter((row): row is OutreachCandidate => row !== null);
}

export async function queueAffiliateOutreachContacts(
  affiliateId?: string,
  campaignId = affiliateCampaignId(),
): Promise<{ queued: number; unchanged: number; suppressed: number; total: number }> {
  const candidates = await getOutreachCandidates(affiliateId);
  let queued = 0;
  let unchanged = 0;

  for (let start = 0; start < candidates.length; start += 500) {
    const batch = candidates.slice(start, start + 500);
    const rows = batch.map((candidate) => [
      candidate.affiliateId,
      campaignId,
      candidate.email,
      candidate.segment,
      candidate.sourceUpdatedAt,
      candidate.payloadHash,
    ]);

    const changed = await sql`
      INSERT INTO outreach_contacts (
        affiliate_id, campaign_id, email, segment, source_updated_at,
        payload_hash, sync_status, sync_error, suppressed_at, updated_at
      )
      SELECT *, 'pending', NULL, NULL, NOW()
      FROM unnest(
        ${rows.map((row) => row[0])}::text[],
        ${rows.map((row) => row[1])}::text[],
        ${rows.map((row) => row[2])}::text[],
        ${rows.map((row) => row[3])}::text[],
        ${rows.map((row) => row[4])}::timestamptz[],
        ${rows.map((row) => row[5])}::text[]
      ) AS t(affiliate_id, campaign_id, email, segment, source_updated_at, payload_hash)
      ON CONFLICT (affiliate_id, campaign_id) DO UPDATE SET
        email = CASE
          WHEN outreach_contacts.email IS DISTINCT FROM EXCLUDED.email
          THEN outreach_contacts.email
          ELSE EXCLUDED.email
        END,
        segment = EXCLUDED.segment,
        source_updated_at = EXCLUDED.source_updated_at,
        payload_hash = CASE
          WHEN outreach_contacts.email IS DISTINCT FROM EXCLUDED.email
          THEN outreach_contacts.payload_hash
          ELSE EXCLUDED.payload_hash
        END,
        sync_status = CASE
          WHEN outreach_contacts.email IS DISTINCT FROM EXCLUDED.email
          THEN 'email_changed'
          WHEN outreach_contacts.payload_hash IS DISTINCT FROM EXCLUDED.payload_hash
          THEN 'pending'
          ELSE outreach_contacts.sync_status
        END,
        sync_error = CASE
          WHEN outreach_contacts.email IS DISTINCT FROM EXCLUDED.email
          THEN 'Rewardful email changed; review the old remote contact before replacing it.'
          WHEN outreach_contacts.payload_hash IS DISTINCT FROM EXCLUDED.payload_hash
          THEN NULL
          ELSE outreach_contacts.sync_error
        END,
        sync_attempts = CASE
          WHEN outreach_contacts.payload_hash IS DISTINCT FROM EXCLUDED.payload_hash THEN 0
          ELSE outreach_contacts.sync_attempts
        END,
        next_attempt_at = CASE
          WHEN outreach_contacts.payload_hash IS DISTINCT FROM EXCLUDED.payload_hash THEN NULL
          ELSE outreach_contacts.next_attempt_at
        END,
        suppressed_at = NULL,
        updated_at = NOW()
      RETURNING (xmax = 0 OR sync_status = 'pending') AS queued
    ` as { queued: boolean }[];

    const changedCount = changed.filter((row) => row.queued).length;
    queued += changedCount;
    unchanged += batch.length - changedCount;
  }

  let suppressed = 0;
  if (!affiliateId) {
    const sourceIds = candidates.map((candidate) => candidate.affiliateId);
    const rows = await sql`
      UPDATE outreach_contacts
      SET sync_status = 'suppressed', suppressed_at = NOW(), updated_at = NOW()
      WHERE campaign_id = ${campaignId}
        AND sync_status <> 'suppressed'
        AND NOT (affiliate_id = ANY(${sourceIds}::text[]))
      RETURNING affiliate_id
    `;
    suppressed = rows.length;
  }

  return { queued, unchanged, suppressed, total: candidates.length };
}

/**
 * Quarantines a Rewardful affiliate from future Instantly imports. This does
 * not delete a remote lead or change a campaign; it only closes the local
 * reconciliation path until the affiliate is active again.
 */
export async function suppressAffiliateOutreachContacts(
  affiliateId: string,
  campaignId = affiliateCampaignId(),
): Promise<number> {
  const rows = await sql`
    UPDATE outreach_contacts
    SET sync_status = 'suppressed', suppressed_at = NOW(),
        next_attempt_at = NULL, updated_at = NOW()
    WHERE affiliate_id = ${affiliateId}
      AND campaign_id = ${campaignId}
      AND sync_status <> 'suppressed'
    RETURNING id
  `;
  return rows.length;
}

export async function outreachSyncSummary(campaignId = affiliateCampaignId()) {
  const [summary] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE sync_status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE sync_status = 'syncing')::int AS syncing,
      COUNT(*) FILTER (WHERE sync_status = 'synced')::int AS synced,
      COUNT(*) FILTER (WHERE sync_status = 'error')::int AS errors,
      COUNT(*) FILTER (WHERE sync_status = 'email_changed')::int AS email_changed,
      COUNT(*) FILTER (WHERE sync_status = 'skipped_existing')::int AS skipped_existing,
      COUNT(*) FILTER (WHERE sync_status = 'suppressed')::int AS suppressed,
      MAX(last_synced_at) AS last_synced_at
    FROM outreach_contacts
    WHERE campaign_id = ${campaignId}
  `;
  return {
    total: Number(summary?.total ?? 0),
    pending: Number(summary?.pending ?? 0),
    syncing: Number(summary?.syncing ?? 0),
    synced: Number(summary?.synced ?? 0),
    errors: Number(summary?.errors ?? 0),
    emailChanged: Number(summary?.email_changed ?? 0),
    skippedExisting: Number(summary?.skipped_existing ?? 0),
    suppressed: Number(summary?.suppressed ?? 0),
    lastSyncedAt: summary?.last_synced_at ? String(summary.last_synced_at) : null,
  };
}
