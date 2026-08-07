import { AFFILIATE_GROUP_DEFINITIONS } from '@/lib/affiliate-groups';
import sql from '@/lib/db';
import {
  activateCampaign,
  bulkAddLeads,
  collectCursorPages,
  deleteLead,
  getCampaign,
  listLeadsPage,
  patchCampaign,
  pauseCampaign,
  type JsonValue,
} from '@/lib/instantly';
import { computeGroupMembership, targetMembers, type GroupMember } from '@/lib/mail-groups';
import { affiliateCampaignId } from '@/lib/outreach';
import { mailJson, mailRouteError, requireMailAuth } from '../../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DELETE_BATCH_LIMIT = 300;
const DELETE_CONCURRENCY = 5;

async function recordEvent(campaignId: string, eventType: string, status: 'ok' | 'error', payload: Record<string, JsonValue>) {
  await sql`
    INSERT INTO outreach_events (campaign_id, event_type, status, payload)
    VALUES (${campaignId}, ${eventType}, ${status}, ${JSON.stringify(payload)}::jsonb)
  `;
}

async function remoteLeads(campaignId: string) {
  const remote = await collectCursorPages(
    (startingAfter) => listLeadsPage({ campaignId, limit: 100, startingAfter }),
    { maxPages: 100 },
  );
  const byEmail = new Map<string, string>();
  for (const lead of remote.items) {
    if (lead.id && lead.email) byEmail.set(lead.email.trim().toLowerCase(), lead.id);
  }
  return { byEmail, truncated: remote.truncated };
}

function groupLabels(groupIds: string[]) {
  return groupIds.map((id) => AFFILIATE_GROUP_DEFINITIONS.find((group) => group.id === id)?.label ?? id);
}

function diff(target: GroupMember[], remote: Map<string, string>) {
  const targetEmails = new Set(target.map((member) => member.email));
  const toAdd = target.filter((member) => !remote.has(member.email));
  const toRemove = [...remote].filter(([email]) => !targetEmails.has(email));
  return { targetEmails, toAdd, toRemove };
}

function sequenceProblems(campaign: Awaited<ReturnType<typeof getCampaign>>): string[] {
  const problems: string[] = [];
  const steps = campaign.sequences?.[0]?.steps ?? [];
  if (steps.length === 0) problems.push('The sequence has no email steps.');
  steps.forEach((step, index) => {
    for (const variant of step.variants ?? []) {
      if (variant.v_disabled === true) continue;
      if (!String(variant.subject ?? '').trim()) problems.push(`Step ${index + 1} has an empty subject.`);
      if (!String(variant.body ?? '').trim()) problems.push(`Step ${index + 1} has an empty body.`);
    }
  });
  return problems;
}

async function buildPreview() {
  const campaignId = affiliateCampaignId();
  const [campaign, membership, remote] = await Promise.all([
    getCampaign(campaignId),
    computeGroupMembership(campaignId),
    remoteLeads(campaignId),
  ]);
  const target = targetMembers(membership, membership.draftTarget.groupIds);
  const { toAdd, toRemove } = diff(target, remote.byEmail);
  return {
    campaignId,
    campaign,
    membership,
    target,
    remote,
    toAdd,
    toRemove,
    problems: sequenceProblems(campaign),
  };
}

function previewJson(preview: Awaited<ReturnType<typeof buildPreview>>) {
  return {
    campaignStatus: preview.campaign.status ?? null,
    campaignName: preview.campaign.name ?? null,
    groups: {
      ids: preview.membership.draftTarget.groupIds,
      labels: groupLabels(preview.membership.draftTarget.groupIds),
    },
    targetCount: preview.target.length,
    remoteLeadCount: preview.remote.byEmail.size,
    remoteTruncated: preview.remote.truncated,
    toAdd: preview.toAdd.length,
    toRemove: preview.toRemove.length,
    ready: preview.toAdd.length === 0 && preview.toRemove.length === 0
      && !preview.remote.truncated && preview.problems.length === 0,
    problems: preview.problems,
  };
}

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;
  try {
    return mailJson(previewJson(await buildPreview()));
  } catch (error) {
    return mailRouteError(error);
  }
}

export async function POST(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  let body: { confirm?: unknown; action?: unknown; sendNow?: unknown };
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body.' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit confirmation is required.', required: { confirm: true } }, 409);
  }
  const action = body.action;
  if (action !== 'reconcile' && action !== 'launch' && action !== 'pause' && action !== 'send-now') {
    return mailJson({ error: "action must be 'reconcile', 'launch', 'pause', or 'send-now'." }, 400);
  }

  try {
    const campaignId = affiliateCampaignId();

    if (action === 'send-now') {
      // Open the schedule so delivery starts immediately. Works whether the
      // campaign is Active (pause → patch → reactivate) or Draft/Paused.
      const current = await getCampaign(campaignId);
      const wasActive = current.status === 1;
      if (wasActive) await pauseCampaign(campaignId);
      const timezone = current.campaign_schedule?.schedules?.[0]?.timezone || 'Etc/GMT';
      await patchCampaign(campaignId, {
        campaign_schedule: {
          schedules: [{
            name: 'Affiliate outreach',
            timing: { from: '00:00', to: '23:59' },
            days: { '0': true, '1': true, '2': true, '3': true, '4': true, '5': true, '6': true },
            timezone,
          }],
        } as unknown as JsonValue,
      });
      if (wasActive) await activateCampaign(campaignId);
      await recordEvent(campaignId, 'mail_campaign_schedule_opened', 'ok', { via: 'dashboard', reactivated: wasActive });
      return mailJson({ ok: true, action, campaignStatus: wasActive ? 1 : current.status ?? null });
    }

    if (action === 'pause') {
      await pauseCampaign(campaignId);
      await recordEvent(campaignId, 'mail_campaign_paused', 'ok', { via: 'dashboard' });
      return mailJson({ ok: true, action, campaignStatus: 2 });
    }

    const preview = await buildPreview();
    const status = preview.campaign.status ?? null;

    if (action === 'reconcile') {
      if (status !== 0 && status !== 2) {
        return mailJson({ error: 'Recipient reconciliation requires the campaign to be Draft or Paused.', campaignStatus: status }, 409);
      }
      // Remove leads that are not in the selected target groups.
      const removals = preview.toRemove.slice(0, DELETE_BATCH_LIMIT);
      let removed = 0;
      const removeErrors: string[] = [];
      for (let start = 0; start < removals.length; start += DELETE_CONCURRENCY) {
        const batch = removals.slice(start, start + DELETE_CONCURRENCY);
        const results = await Promise.allSettled(batch.map(([, leadId]) => deleteLead(leadId)));
        for (const result of results) {
          if (result.status === 'fulfilled') removed += 1;
          else removeErrors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
      }
      // Add missing target members.
      let added = 0;
      for (let start = 0; start < preview.toAdd.length; start += 500) {
        const batch = preview.toAdd.slice(start, start + 500);
        await bulkAddLeads({
          campaignId,
          leads: batch.map((member) => member.lead),
          // Members may already exist elsewhere in the workspace; they still
          // must be present in THIS campaign for delivery, so do not skip.
          skipIfInWorkspace: false,
        });
        added += batch.length;
      }
      const remaining = Math.max(0, preview.toRemove.length - removals.length);
      await recordEvent(campaignId, 'mail_campaign_leads_reconciled', removeErrors.length ? 'error' : 'ok', {
        groups: preview.membership.draftTarget.groupIds,
        targetCount: preview.target.length,
        added,
        removed,
        remainingRemovals: remaining,
        removeErrors: removeErrors.slice(0, 5),
      });
      return mailJson({
        ok: true,
        action,
        added,
        removed,
        remainingRemovals: remaining,
        removeErrors: removeErrors.slice(0, 5),
        // Re-run reconcile until remainingRemovals is 0.
        done: remaining === 0 && removeErrors.length === 0,
      });
    }

    // action === 'launch'
    if (status === 1) return mailJson({ error: 'The campaign is already active.', campaignStatus: status }, 409);
    const state = previewJson(preview);
    if (!state.ready) {
      return mailJson({
        error: 'The campaign is not ready to launch. Reconcile recipients and fix the listed problems first.',
        ...state,
      }, 409);
    }
    if (body.sendNow === true) {
      // Open the schedule so delivery starts immediately instead of waiting
      // for the next configured window. Keeps the campaign's timezone.
      const timezone = preview.campaign.campaign_schedule?.schedules?.[0]?.timezone || 'Etc/GMT';
      await patchCampaign(campaignId, {
        campaign_schedule: {
          schedules: [{
            name: 'Affiliate outreach',
            timing: { from: '00:00', to: '23:59' },
            days: { '0': true, '1': true, '2': true, '3': true, '4': true, '5': true, '6': true },
            timezone,
          }],
        } as unknown as JsonValue,
      });
    }
    await activateCampaign(campaignId);
    await recordEvent(campaignId, 'mail_campaign_launched', 'ok', {
      sendNow: body.sendNow === true,
      groups: preview.membership.draftTarget.groupIds,
      groupLabels: groupLabels(preview.membership.draftTarget.groupIds),
      recipients: preview.target.length,
      via: 'dashboard',
    });
    return mailJson({ ok: true, action, campaignStatus: 1, recipients: preview.target.length });
  } catch (error) {
    return mailRouteError(error);
  }
}
