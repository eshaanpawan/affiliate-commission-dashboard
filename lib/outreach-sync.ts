import 'server-only';

import sql from '@/lib/db';
import {
  bulkAddLeads,
  collectCursorPages,
  getCampaign,
  listLeadsPage,
  type AddLeadInput,
  type JsonValue,
} from '@/lib/instantly';
import { affiliateCampaignId, getOutreachCandidates } from '@/lib/outreach';

interface ClaimedContact {
  id: string;
  affiliate_id: string;
  email: string;
  sync_attempts: number;
  previous_status: string;
}

class CampaignStateChangedError extends Error {}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function retryDelayMinutes(attempt: number): number {
  return Math.min(360, 5 * 2 ** Math.max(0, attempt - 1));
}

async function recordEvent(
  campaignId: string,
  eventType: string,
  status: 'ok' | 'error',
  payload: Record<string, JsonValue>,
) {
  await sql`
    INSERT INTO outreach_events (campaign_id, event_type, status, payload)
    VALUES (${campaignId}, ${eventType}, ${status}, ${JSON.stringify(payload)}::jsonb)
  `;
}

/**
 * Imports queued contacts into Instantly only while the campaign is Draft (0)
 * or Paused (2). This function cannot activate a campaign or send an email.
 */
export async function drainOutreachQueue(options: {
  limit?: number;
  includeExisting?: boolean;
  affiliateId?: string;
} = {}) {
  const campaignId = affiliateCampaignId();
  const limit = Math.min(1_000, Math.max(1, options.limit ?? 500));
  const includeExisting = options.includeExisting === true;
  const affiliateId = options.affiliateId?.trim() || null;
  const campaign = await getCampaign(campaignId);
  if (campaign.status !== 0 && campaign.status !== 2) {
    throw new Error('Contact import blocked: affiliate campaign must remain Draft or Paused.');
  }
  if (includeExisting && campaign.status !== 0) {
    throw new Error('Existing-workspace contact import is allowed only while the affiliate campaign is Draft.');
  }

  const claimed = await sql`
    WITH candidates AS (
      SELECT id, sync_status AS previous_status
      FROM outreach_contacts
      WHERE campaign_id = ${campaignId}
        AND (${affiliateId}::text IS NULL OR affiliate_id = ${affiliateId})
        AND (sync_attempts < 5 OR (${includeExisting} AND sync_status = 'skipped_existing'))
        AND (
          sync_status = 'pending'
          OR (sync_status = 'error' AND COALESCE(next_attempt_at, NOW()) <= NOW())
          OR (${includeExisting} AND sync_status = 'skipped_existing')
        )
      ORDER BY updated_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outreach_contacts AS contact
    SET sync_status = 'syncing', sync_error = NULL,
        sync_attempts = contact.sync_attempts + 1, updated_at = NOW()
    FROM candidates
    WHERE contact.id = candidates.id
    RETURNING contact.id, contact.affiliate_id, contact.email,
      contact.sync_attempts, candidates.previous_status
  ` as unknown as ClaimedContact[];

  if (claimed.length === 0) {
    return { campaignId, campaignStatus: campaign.status, claimed: 0, synced: 0, errors: 0 };
  }

  const currentCandidates = await getOutreachCandidates(affiliateId ?? undefined);
  const byAffiliate = new Map(currentCandidates.map((candidate) => [candidate.affiliateId, candidate]));
  const valid: { contact: ClaimedContact; lead: AddLeadInput }[] = [];
  const invalid: ClaimedContact[] = [];
  for (const contact of claimed) {
    const candidate = byAffiliate.get(contact.affiliate_id);
    if (!candidate || candidate.email !== contact.email) {
      invalid.push(contact);
      continue;
    }
    valid.push({ contact, lead: candidate.lead });
  }

  if (invalid.length > 0) {
    const ids = invalid.map((contact) => contact.id);
    await sql`
      UPDATE outreach_contacts
      SET sync_status = 'email_changed',
          sync_error = 'Source email changed or became invalid; manual review required.',
          updated_at = NOW()
      WHERE id = ANY(${ids}::uuid[])
    `;
  }

  if (valid.length === 0) {
    return { campaignId, campaignStatus: campaign.status, claimed: claimed.length, synced: 0, errors: invalid.length };
  }

  try {
    // Re-check immediately before the remote write. Candidate hydration and DB
    // claims can take long enough for a human to change campaign state.
    const currentCampaign = await getCampaign(campaignId);
    if (currentCampaign.status !== 0 && currentCampaign.status !== 2) {
      throw new CampaignStateChangedError('Contact import cancelled because the campaign is no longer Draft or Paused.');
    }
    if (includeExisting && currentCampaign.status !== 0) {
      throw new CampaignStateChangedError('Existing-workspace contact import cancelled because the campaign is no longer Draft.');
    }
    const result = await bulkAddLeads({
      campaignId,
      leads: valid.map((item) => item.lead),
      // Default reconciliation avoids duplicates across the workspace. An
      // explicitly confirmed includeExisting run is the only path that can
      // place a workspace-existing address into this Draft campaign.
      skipIfInWorkspace: !includeExisting,
    });
    const resultRecord = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, JsonValue>
      : null;
    const createdLeads = Array.isArray(resultRecord?.created_leads)
      ? resultRecord.created_leads
      : null;
    const createdByIndex = new Map<number, string>();
    for (const created of createdLeads ?? []) {
      if (!created || typeof created !== 'object' || Array.isArray(created)) continue;
      const index = Number(created.index);
      const id = typeof created.id === 'string' ? created.id : '';
      if (Number.isInteger(index) && id) createdByIndex.set(index, id);
    }

    let uploaded = valid.length;
    let skippedExisting = 0;
    if (createdLeads) {
      const createdContacts: { id: string; leadId: string }[] = [];
      const skippedIds: string[] = [];
      for (let index = 0; index < valid.length; index += 1) {
        const item = valid[index];
        const leadId = createdByIndex.get(index);
        if (leadId) {
          createdContacts.push({ id: item.contact.id, leadId });
        } else {
          skippedIds.push(item.contact.id);
        }
      }
      uploaded = createdContacts.length;
      skippedExisting = skippedIds.length;
      if (createdContacts.length > 0) {
        await sql`
          UPDATE outreach_contacts AS contact
          SET sync_status = 'synced', instantly_lead_id = incoming.lead_id,
              sync_error = NULL, next_attempt_at = NULL,
              last_synced_at = NOW(), updated_at = NOW()
          FROM unnest(
            ${createdContacts.map((item) => item.id)}::uuid[],
            ${createdContacts.map((item) => item.leadId)}::text[]
          ) AS incoming(id, lead_id)
          WHERE contact.id = incoming.id
        `;
      }
      if (skippedIds.length > 0) {
        await sql`
          UPDATE outreach_contacts
          SET sync_status = 'skipped_existing',
              sync_error = 'Instantly skipped this address because it already exists in the workspace, campaign, or blocklist.',
              next_attempt_at = NULL, last_synced_at = NOW(), updated_at = NOW()
          WHERE id = ANY(${skippedIds}::uuid[])
        `;
      }
    } else {
      const ids = valid.map((item) => item.contact.id);
      await sql`
        UPDATE outreach_contacts
        SET sync_status = 'synced', sync_error = NULL, next_attempt_at = NULL,
            last_synced_at = NOW(), updated_at = NOW()
        WHERE id = ANY(${ids}::uuid[])
      `;
    }
    await recordEvent(campaignId, 'instantly_contacts_imported', 'ok', {
      contacts: valid.length,
      uploaded,
      skippedExisting,
      skippedForReview: invalid.length,
      campaignStatus: currentCampaign.status,
      includeExisting,
      remote: result,
    });
    return {
      campaignId,
      campaignStatus: currentCampaign.status,
      includeExisting,
      claimed: claimed.length,
      synced: uploaded,
      skippedExisting,
      errors: invalid.length,
    };
  } catch (error) {
    const message = safeError(error);
    if (error instanceof CampaignStateChangedError) {
      await sql`
        UPDATE outreach_contacts AS contact
        SET sync_status = incoming.previous_status,
            sync_error = ${message}, updated_at = NOW()
        FROM unnest(
          ${valid.map((item) => item.contact.id)}::uuid[],
          ${valid.map((item) => item.contact.previous_status)}::text[]
        ) AS incoming(id, previous_status)
        WHERE contact.id = incoming.id
      `;
      await recordEvent(campaignId, 'instantly_contacts_import_cancelled', 'error', {
        contacts: valid.length,
        message,
      });
      throw error;
    }
    for (const item of valid) {
      const delayMinutes = retryDelayMinutes(item.contact.sync_attempts);
      await sql`
        UPDATE outreach_contacts
        SET sync_status = 'error', sync_error = ${message},
            next_attempt_at = NOW() + (${delayMinutes}::text || ' minutes')::interval,
            updated_at = NOW()
        WHERE id = ${item.contact.id}::uuid
      `;
    }
    await recordEvent(campaignId, 'instantly_contacts_import_failed', 'error', {
      contacts: valid.length,
      message,
    });
    throw error;
  }
}

export async function drainOutreachQueueFully(options: {
  maxBatches?: number;
  batchSize?: number;
  includeExisting?: boolean;
  affiliateId?: string;
} = {}) {
  const maxBatches = Math.min(10, Math.max(1, options.maxBatches ?? 5));
  const batches = [];
  let synced = 0;
  let skippedExisting = 0;
  let errors = 0;
  for (let index = 0; index < maxBatches; index += 1) {
    const batch = await drainOutreachQueue({
      limit: options.batchSize ?? 1_000,
      includeExisting: options.includeExisting,
      affiliateId: options.affiliateId,
    });
    batches.push(batch);
    synced += batch.synced;
    skippedExisting += 'skippedExisting' in batch ? Number(batch.skippedExisting ?? 0) : 0;
    errors += batch.errors;
    if (batch.claimed === 0) break;
  }
  const reconciliation = await reconcileCampaignLeads();
  return { batches: batches.length, synced, skippedExisting, errors, reconciliation, detail: batches };
}

/** Corrects interrupted/import-summary ambiguity against the live campaign. */
export async function reconcileCampaignLeads() {
  const campaignId = affiliateCampaignId();
  const campaign = await getCampaign(campaignId);
  if (campaign.status !== 0 && campaign.status !== 2) {
    throw new Error('Lead reconciliation blocked: affiliate campaign must remain Draft or Paused.');
  }
  const remote = await collectCursorPages(
    (startingAfter) => listLeadsPage({ campaignId, limit: 100, startingAfter }),
    { maxPages: 100 },
  );
  const byEmail = new Map<string, string>();
  for (const lead of remote.items) {
    if (!lead.id || !lead.email) continue;
    byEmail.set(lead.email.trim().toLowerCase(), lead.id);
  }
  const pairs = [...byEmail].map(([email, id]) => ({ email, id }));
  let matched = 0;
  for (let start = 0; start < pairs.length; start += 500) {
    const batch = pairs.slice(start, start + 500);
    const rows = await sql`
      UPDATE outreach_contacts AS contact
      SET sync_status = 'synced', instantly_lead_id = incoming.lead_id,
          sync_error = NULL, next_attempt_at = NULL,
          last_synced_at = NOW(), updated_at = NOW()
      FROM unnest(
        ${batch.map((item) => item.email)}::text[],
        ${batch.map((item) => item.id)}::text[]
      ) AS incoming(email, lead_id)
      WHERE contact.campaign_id = ${campaignId}
        AND LOWER(contact.email) = incoming.email
      RETURNING contact.id
    `;
    matched += rows.length;
  }
  await recordEvent(campaignId, 'instantly_campaign_reconciled', 'ok', {
    remoteLeads: remote.items.length,
    matched,
    truncated: remote.truncated,
  });
  return { remoteLeads: remote.items.length, matched, truncated: remote.truncated };
}
