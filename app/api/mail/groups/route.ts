import {
  AFFILIATE_GROUP_DEFINITIONS,
  AFFILIATE_GROUP_POLICY,
  AFFILIATE_GROUP_PRIORITY,
  belongsToAffiliateGroup,
  classifyPrimaryAffiliateGroup,
  isAffiliateGroupId,
  type AffiliateGroupFacts,
  type AffiliateGroupId,
  type PrimaryAffiliateGroupId,
} from '@/lib/affiliate-groups';
import sql from '@/lib/db';
import { getCampaign } from '@/lib/instantly';
import { affiliateCampaignId, getOutreachCandidates, type OutreachCandidate } from '@/lib/outreach';
import { clampInteger, mailJson, mailRouteError, requireMailAuth, safeString } from '../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TARGET_EVENT_TYPE = 'mail_draft_target_group_selected';

interface AffiliateEvidenceRow {
  rewardful_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string | null;
  confirmed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  visitors: number | null;
  leads: number | null;
  conversions: number | null;
  unpaid_commission_cents: number | null;
  review_status: string | null;
  enforcement_state: string | null;
  last_conversion_at: string | null;
  manual_brand_bidding: boolean | null;
  matched_brand_terms: string[] | null;
  runable_campaign_ids: string[] | null;
}

interface DraftTargetRow {
  group_id: string | null;
  created_at: string | null;
}

interface GroupMember {
  id: string;
  name: string;
  email: string;
  status: string;
  primaryGroup: PrimaryAffiliateGroupId | null;
  segment: string;
  reviewStatus: string;
  enforcementState: string;
  riskScore: number;
  visitors: number;
  leads: number;
  conversions: number;
  unpaidCommissionCents: number;
  joinedAt: string | null;
  confirmedAt: string | null;
  lastConversionAt: string | null;
  sourceUpdatedAt: string | null;
  evidence: string[];
  brandEvidence: {
    matched: boolean;
    manualReviewTag: boolean;
    observedTerms: string[];
    runableCampaignIds: string[];
  };
  facts: AffiliateGroupFacts;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item !== ''))];
}

function customNumber(candidate: OutreachCandidate, key: string): number {
  const value = candidate.lead.custom_variables[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function describeEvidence(
  primaryGroup: PrimaryAffiliateGroupId | null,
  facts: AffiliateGroupFacts,
  row: AffiliateEvidenceRow,
  riskScore: number,
  brandReasons: string[],
): string[] {
  if (primaryGroup === 'brand_bidding_review') return brandReasons;
  if (primaryGroup === 'high_risk_review') {
    const evidence = [`Current dynamic outreach segment: ${facts.segment.replaceAll('_', ' ')}`];
    if (riskScore > 0) evidence.push(`Effective fraud-risk score: ${riskScore}/100`);
    if (row.review_status && row.review_status !== 'unreviewed') {
      evidence.push(`Manual review status: ${row.review_status.replaceAll('_', ' ')}`);
    }
    if (row.enforcement_state && row.enforcement_state !== 'none') {
      evidence.push(`Enforcement state: ${row.enforcement_state.replaceAll('_', ' ')}`);
    }
    return evidence;
  }
  if (primaryGroup === 'good_performers') {
    return [
      `${Math.max(0, facts.conversions).toLocaleString()} lifetime Rewardful conversions`,
      'No current brand-bidding evidence or medium/high risk-review segment',
    ];
  }
  if (primaryGroup === 'new_unproven') {
    return [
      `Joined ${row.created_at ? new Date(row.created_at).toLocaleDateString('en-US') : 'recently'}`,
      '0 lifetime Rewardful conversions',
      'No current brand-bidding evidence or medium/high risk-review segment',
    ];
  }
  if (primaryGroup === 'dormant') {
    return [
      `Joined ${row.created_at ? new Date(row.created_at).toLocaleDateString('en-US') : 'at least 90 days ago'}`,
      '0 lifetime Rewardful conversions',
      'Inactivity is not treated as fraud',
    ];
  }
  if (primaryGroup === 'developing_partners') {
    return [
      `${Math.max(0, facts.conversions).toLocaleString()} lifetime Rewardful conversions`,
      'Between the current new, growth, and dormant thresholds',
      'No current brand-bidding evidence or medium/high risk-review segment',
    ];
  }
  return [
    'Valid email on an active, non-deleted Rewardful affiliate',
    'Does not currently meet a named operating-cohort threshold',
  ];
}

function compareMembers(groupId: AffiliateGroupId, left: GroupMember, right: GroupMember): number {
  if (groupId === 'brand_bidding_review' || groupId === 'high_risk_review') {
    return right.riskScore - left.riskScore
      || right.unpaidCommissionCents - left.unpaidCommissionCents
      || left.id.localeCompare(right.id);
  }
  if (groupId === 'good_performers') {
    return right.conversions - left.conversions
      || right.visitors - left.visitors
      || left.id.localeCompare(right.id);
  }
  const leftJoined = left.joinedAt ? new Date(left.joinedAt).getTime() : 0;
  const rightJoined = right.joinedAt ? new Date(right.joinedAt).getTime() : 0;
  if (groupId === 'new_unproven') return rightJoined - leftJoined || left.id.localeCompare(right.id);
  if (groupId === 'dormant') return leftJoined - rightJoined || left.id.localeCompare(right.id);
  if (groupId === 'developing_partners') {
    return right.conversions - left.conversions
      || right.visitors - left.visitors
      || left.id.localeCompare(right.id);
  }
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function memberPreview(member: GroupMember) {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    status: member.status,
    riskScore: member.riskScore,
    conversions: member.conversions,
    visitors: member.visitors,
    unpaidCommissionCents: member.unpaidCommissionCents,
    evidence: member.evidence,
  };
}

async function evidenceRows(): Promise<AffiliateEvidenceRow[]> {
  const rows = await sql`
    WITH latest_conversion AS (
      SELECT affiliate_id, MAX(COALESCE(converted_at, created_at)) AS last_conversion_at
      FROM referrals
      WHERE affiliate_id IS NOT NULL AND status = 'converted'
      GROUP BY affiliate_id
    ),
    token_owner AS (
      SELECT DISTINCT ON (link_token) link_token, affiliate_id
      FROM referrals
      WHERE link_token IS NOT NULL AND affiliate_id IS NOT NULL
      ORDER BY link_token, created_at ASC
    ),
    owned_campaign AS (
      SELECT owner.affiliate_id,
        ARRAY_AGG(DISTINCT campaign_id) FILTER (WHERE campaign_id <> '') AS runable_campaign_ids
      FROM token_owner owner
      JOIN affiliate_traffic traffic ON traffic.via_token = owner.link_token
      CROSS JOIN LATERAL UNNEST(COALESCE(traffic.campaign_ids_ours, '{}'::text[])) AS campaign_id
      WHERE traffic.day >= CURRENT_DATE - ${AFFILIATE_GROUP_POLICY.evidenceWindowDays - 1}::int
      GROUP BY owner.affiliate_id
    ),
    explicit_brand_term AS (
      SELECT referral.affiliate_id,
        ARRAY_AGG(DISTINCT observed.term) FILTER (WHERE observed.term <> '') AS matched_brand_terms
      FROM referrals referral
      CROSS JOIN LATERAL (
        VALUES (COALESCE(referral.utm_term, '')), (COALESCE(referral.utm_campaign, ''))
      ) AS observed(term)
      WHERE referral.affiliate_id IS NOT NULL
        AND referral.created_at >= CURRENT_DATE - ${AFFILIATE_GROUP_POLICY.evidenceWindowDays - 1}::int
        AND LOWER(observed.term) LIKE '%runable%'
      GROUP BY referral.affiliate_id
    )
    SELECT
      affiliate.rewardful_id, affiliate.first_name, affiliate.last_name, affiliate.email,
      affiliate.status, affiliate.confirmed_at, affiliate.created_at, affiliate.updated_at,
      affiliate.visitors, affiliate.leads, affiliate.conversions,
      affiliate.unpaid_commission_cents, affiliate.review_status, affiliate.enforcement_state,
      latest_conversion.last_conversion_at,
      EXISTS (
        SELECT 1
        FROM JSONB_ARRAY_ELEMENTS_TEXT(
          CASE
            WHEN JSONB_TYPEOF(COALESCE(affiliate.fraud_tags, '[]'::jsonb)) = 'array'
              THEN COALESCE(affiliate.fraud_tags, '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) AS tag(value)
        WHERE LOWER(tag.value) = 'brand_bidding'
      ) AS manual_brand_bidding,
      COALESCE(explicit_brand_term.matched_brand_terms, '{}'::text[]) AS matched_brand_terms,
      COALESCE(owned_campaign.runable_campaign_ids, '{}'::text[]) AS runable_campaign_ids
    FROM affiliates affiliate
    LEFT JOIN latest_conversion ON latest_conversion.affiliate_id = affiliate.rewardful_id
    LEFT JOIN explicit_brand_term ON explicit_brand_term.affiliate_id = affiliate.rewardful_id
    LEFT JOIN owned_campaign ON owned_campaign.affiliate_id = affiliate.rewardful_id
    WHERE COALESCE(affiliate.status, 'active') <> 'deleted'
    ORDER BY affiliate.created_at ASC NULLS LAST, affiliate.rewardful_id ASC
  `;
  return rows as unknown as AffiliateEvidenceRow[];
}

async function latestDraftTarget(campaignId: string): Promise<{
  groupId: AffiliateGroupId;
  selectedAt: string | null;
  saved: boolean;
}> {
  const rows = await sql`
    SELECT payload->>'groupId' AS group_id, created_at
    FROM outreach_events
    WHERE campaign_id = ${campaignId}
      AND event_type = ${TARGET_EVENT_TYPE}
      AND status = 'ok'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ` as unknown as DraftTargetRow[];
  const latest = rows[0];
  if (latest && isAffiliateGroupId(latest.group_id)) {
    return { groupId: latest.group_id, selectedAt: latest.created_at, saved: true };
  }
  return { groupId: 'all_emailable', selectedAt: null, saved: false };
}

function buildMembers(rows: AffiliateEvidenceRow[], candidates: OutreachCandidate[], now: Date): GroupMember[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.affiliateId, candidate]));
  const members: GroupMember[] = [];
  for (const row of rows) {
    const candidate = candidateById.get(row.rewardful_id);
    if (!candidate) continue;

    const observedTerms = stringArray(row.matched_brand_terms);
    const runableCampaignIds = stringArray(row.runable_campaign_ids);
    const manualReviewTag = row.manual_brand_bidding === true;
    const brandBiddingEvidence = manualReviewTag
      || observedTerms.length > 0
      || runableCampaignIds.length > 0;
    const facts: AffiliateGroupFacts = {
      brandBiddingEvidence,
      segment: candidate.segment,
      conversions: Number(row.conversions ?? 0),
      joinedAt: row.created_at ? String(row.created_at) : null,
    };
    const primaryGroup = classifyPrimaryAffiliateGroup(facts, now);
    const riskScore = customNumber(candidate, 'risk_score');
    const brandReasons: string[] = [];
    if (manualReviewTag) brandReasons.push('Manual fraud-review tag: brand_bidding');
    if (observedTerms.length > 0) {
      brandReasons.push(`Explicit Runable UTM value${observedTerms.length === 1 ? '' : 's'}: ${observedTerms.join(', ')}`);
    }
    if (runableCampaignIds.length > 0) {
      brandReasons.push(`Runable-owned PostHog campaign ID${runableCampaignIds.length === 1 ? '' : 's'}: ${runableCampaignIds.join(', ')}`);
    }
    members.push({
      id: row.rewardful_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || '(unnamed)',
      email: candidate.email,
      status: String(row.status ?? 'active'),
      primaryGroup,
      segment: candidate.segment,
      reviewStatus: String(row.review_status ?? 'unreviewed'),
      enforcementState: String(row.enforcement_state ?? 'none'),
      riskScore,
      visitors: Number(row.visitors ?? 0),
      leads: Number(row.leads ?? 0),
      conversions: Number(row.conversions ?? 0),
      unpaidCommissionCents: Number(row.unpaid_commission_cents ?? 0),
      joinedAt: facts.joinedAt,
      confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
      lastConversionAt: row.last_conversion_at ? String(row.last_conversion_at) : null,
      sourceUpdatedAt: candidate.sourceUpdatedAt ?? (row.updated_at ? String(row.updated_at) : null),
      evidence: describeEvidence(primaryGroup, facts, row, riskScore, brandReasons),
      brandEvidence: {
        matched: brandBiddingEvidence,
        manualReviewTag,
        observedTerms,
        runableCampaignIds,
      },
      facts,
    });
  }
  return members;
}

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const requestedGroup = url.searchParams.get('group');
  if (requestedGroup !== null && !isAffiliateGroupId(requestedGroup)) {
    return mailJson({ error: 'Unknown affiliate group.', allowed: AFFILIATE_GROUP_DEFINITIONS.map((group) => group.id) }, 400);
  }
  const page = clampInteger(url.searchParams.get('page'), 1, 1, 100_000);
  const pageSize = clampInteger(url.searchParams.get('pageSize'), 25, 5, 100);
  const query = safeString(url.searchParams.get('q'), 200)?.toLowerCase() ?? '';

  try {
    const campaignId = affiliateCampaignId();
    const [rows, candidates, draftTarget] = await Promise.all([
      evidenceRows(),
      getOutreachCandidates(),
      latestDraftTarget(campaignId),
    ]);
    const now = new Date();
    const allMembers = buildMembers(rows, candidates, now);
    const selectedGroupId = requestedGroup ?? draftTarget.groupId;
    const membersByGroup = new Map<AffiliateGroupId, GroupMember[]>();
    for (const definition of AFFILIATE_GROUP_DEFINITIONS) {
      membersByGroup.set(
        definition.id,
        allMembers
          .filter((member) => belongsToAffiliateGroup(definition.id, member.facts, now))
          .sort((left, right) => compareMembers(definition.id, left, right)),
      );
    }

    const selectedGroupMembers = membersByGroup.get(selectedGroupId) ?? [];
    const filteredMembers = query
      ? selectedGroupMembers.filter((member) =>
        [member.id, member.name, member.email, member.status, ...member.evidence]
          .some((value) => value.toLowerCase().includes(query)))
      : selectedGroupMembers;
    const offset = (page - 1) * pageSize;
    const namedMembership = AFFILIATE_GROUP_PRIORITY.reduce(
      (total, id) => total + (membersByGroup.get(id)?.length ?? 0),
      0,
    );

    return mailJson({
      generatedAt: now.toISOString(),
      totalEmailable: allMembers.length,
      membershipMode: 'exclusive',
      selectedGroupId: draftTarget.groupId,
      draftTarget: {
        ...draftTarget,
        campaignId,
        localMetadataOnly: true,
        instantiatedInInstantly: false,
      },
      policy: {
        readOnlyMembership: true,
        evidenceWindowDays: AFFILIATE_GROUP_POLICY.evidenceWindowDays,
        priority: AFFILIATE_GROUP_PRIORITY,
        namedOperatingCohortsAreMutuallyExclusive: true,
        membershipDescription: 'Every emailable affiliate has exactly one primary operating cohort; all_emailable is a separate selectable superset.',
        allEmailableIsIntentionalSuperset: true,
        unclassifiedWithinAllEmailable: Math.max(0, allMembers.length - namedMembership),
        enforcementRequiresHumanReview: true,
        caveat: 'A paid-click parameter or campaign overlap is a triage signal. Exact searched keyword and advertiser identity require corroborating SERP or Ads Transparency evidence.',
      },
      groups: AFFILIATE_GROUP_DEFINITIONS.map((definition) => {
        const groupMembers = membersByGroup.get(definition.id) ?? [];
        return {
          ...definition,
          count: groupMembers.length,
          selected: definition.id === draftTarget.groupId,
          memberPreview: groupMembers.slice(0, 10).map(memberPreview),
        };
      }),
      selected: {
        id: selectedGroupId,
        query,
        groupTotal: selectedGroupMembers.length,
        page: {
          number: page,
          size: pageSize,
          total: filteredMembers.length,
          pages: Math.max(1, Math.ceil(filteredMembers.length / pageSize)),
        },
        members: filteredMembers.slice(offset, offset + pageSize),
      },
    });
  } catch (error) {
    return mailRouteError(error);
  }
}

export async function PATCH(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  let body: { confirm?: unknown; groupId?: unknown };
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body.' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit draft-target confirmation is required.', required: { confirm: true } }, 409);
  }
  if (!isAffiliateGroupId(body.groupId)) {
    return mailJson({ error: 'Unknown affiliate group.', allowed: AFFILIATE_GROUP_DEFINITIONS.map((group) => group.id) }, 400);
  }

  try {
    const campaignId = affiliateCampaignId();
    const campaign = await getCampaign(campaignId);
    if (campaign.status !== 0 && campaign.status !== 2) {
      return mailJson({
        error: 'Draft-target selection is blocked unless the Instantly campaign is Draft or Paused.',
        campaignStatus: campaign.status ?? null,
      }, 409);
    }
    const selectedAt = new Date().toISOString();
    await sql`
      INSERT INTO outreach_events (campaign_id, event_type, status, payload, created_at)
      VALUES (
        ${campaignId}, ${TARGET_EVENT_TYPE}, 'ok',
        ${JSON.stringify({
          groupId: body.groupId,
          membershipPolicy: 'deterministic_server_groups_v1',
          localMetadataOnly: true,
          instantiatedInInstantly: false,
          activatedCampaign: false,
          sentEmail: false,
        })}::jsonb,
        ${selectedAt}
      )
    `;
    return mailJson({
      ok: true,
      draftTarget: {
        groupId: body.groupId,
        campaignId,
        selectedAt,
        saved: true,
        localMetadataOnly: true,
        instantiatedInInstantly: false,
      },
      safety: 'Draft audience metadata was saved locally. No Instantly contact was imported, no campaign was activated, and no email was sent.',
    });
  } catch (error) {
    return mailRouteError(error);
  }
}
