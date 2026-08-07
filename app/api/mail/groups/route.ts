import {
  AFFILIATE_GROUP_DEFINITIONS,
  AFFILIATE_GROUP_POLICY,
  AFFILIATE_GROUP_PRIORITY,
  isAffiliateGroupId,
  type AffiliateGroupId,
} from '@/lib/affiliate-groups';
import sql from '@/lib/db';
import { getCampaign } from '@/lib/instantly';
import {
  computeGroupMembership,
  targetMembers,
  OVERRIDE_EVENT_TYPE,
  TARGET_EVENT_TYPE,
  type GroupMember,
} from '@/lib/mail-groups';
import { affiliateCampaignId } from '@/lib/outreach';
import { clampInteger, mailJson, mailRouteError, requireMailAuth, safeString } from '../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
    manualGroupId: member.manualGroupId ?? null,
  };
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
    const membership = await computeGroupMembership(campaignId);
    const { now, allMembers, membersByGroup, draftTarget } = membership;
    const selectedGroupIds: AffiliateGroupId[] = requestedGroup ? [requestedGroup] : draftTarget.groupIds;
    const selectedGroupId = selectedGroupIds[0];

    const selectedGroupMembers = targetMembers(membership, selectedGroupIds);
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
      selectedGroupIds: draftTarget.groupIds,
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
          selected: draftTarget.groupIds.includes(definition.id),
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

  let body: { confirm?: unknown; groupId?: unknown; groupIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body.' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit draft-target confirmation is required.', required: { confirm: true } }, 409);
  }
  const requestedIds = Array.isArray(body.groupIds) ? body.groupIds : [body.groupId];
  const groupIds = [...new Set(requestedIds.filter(isAffiliateGroupId))];
  if (!groupIds.length || groupIds.length !== requestedIds.length) {
    return mailJson({ error: 'Provide at least one known affiliate group.', allowed: AFFILIATE_GROUP_DEFINITIONS.map((group) => group.id) }, 400);
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
          groupId: groupIds[0],
          groupIds,
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
        groupId: groupIds[0],
        groupIds,
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

/** Manually move an affiliate into a named cohort, or reset to the computed group. */
export async function PUT(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  let body: { confirm?: unknown; affiliateId?: unknown; groupId?: unknown };
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body.' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit member-override confirmation is required.', required: { confirm: true } }, 409);
  }
  const affiliateId = safeString(body.affiliateId, 100);
  if (!affiliateId) {
    return mailJson({ error: 'affiliateId is required.' }, 400);
  }
  const reset = body.groupId === null;
  if (!reset && (!isAffiliateGroupId(body.groupId) || body.groupId === 'all_emailable')) {
    return mailJson({
      error: 'groupId must be a named cohort, or null to reset to the computed group.',
      allowed: AFFILIATE_GROUP_DEFINITIONS.map((group) => group.id).filter((id) => id !== 'all_emailable'),
    }, 400);
  }

  try {
    const campaignId = affiliateCampaignId();
    const campaign = await getCampaign(campaignId);
    if (campaign.status !== 0 && campaign.status !== 2) {
      return mailJson({
        error: 'Member overrides are blocked unless the Instantly campaign is Draft or Paused.',
        campaignStatus: campaign.status ?? null,
      }, 409);
    }
    await sql`
      INSERT INTO outreach_events (campaign_id, event_type, status, payload, created_at)
      VALUES (
        ${campaignId}, ${OVERRIDE_EVENT_TYPE}, 'ok',
        ${JSON.stringify({
          affiliateId,
          groupId: reset ? null : body.groupId,
          membershipPolicy: 'manual_member_override_v1',
          localMetadataOnly: true,
        })}::jsonb,
        ${new Date().toISOString()}
      )
    `;
    return mailJson({ ok: true, affiliateId, groupId: reset ? null : body.groupId });
  } catch (error) {
    return mailRouteError(error);
  }
}
