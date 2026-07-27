import { mailJson, mailRouteError, requireMailAuth, safeString } from '../_shared';
import { getCampaign } from '@/lib/instantly';
import {
  affiliateCampaignId,
  getOutreachCandidates,
  outreachSyncSummary,
  queueAffiliateOutreachContacts,
} from '@/lib/outreach';
import { drainOutreachQueueFully } from '@/lib/outreach-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;
  try {
    const [campaign, candidates, sync] = await Promise.all([
      getCampaign(affiliateCampaignId()),
      getOutreachCandidates(),
      outreachSyncSummary(),
    ]);
    const segments = candidates.reduce<Record<string, number>>((result, candidate) => {
      result[candidate.segment] = (result[candidate.segment] ?? 0) + 1;
      return result;
    }, {});
    return mailJson({
      safeToImport: campaign.status === 0 || campaign.status === 2,
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
      candidates: candidates.length,
      segments,
      sync,
      policy: 'Contacts may only be imported while the campaign is Draft or Paused. Import does not send mail.',
    });
  } catch (error) {
    return mailRouteError(error);
  }
}

export async function POST(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;
  let body: {
    confirm?: unknown;
    importNow?: unknown;
    includeExisting?: unknown;
    affiliateId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit confirmation is required', required: { confirm: true } }, 409);
  }
  if (body.includeExisting !== undefined && typeof body.includeExisting !== 'boolean') {
    return mailJson({ error: 'includeExisting must be a boolean.' }, 400);
  }
  const affiliateId = body.affiliateId === undefined
    ? undefined
    : safeString(body.affiliateId, 200);
  if (body.affiliateId !== undefined && !affiliateId) {
    return mailJson({ error: 'affiliateId must be a non-empty identifier under 200 characters.' }, 400);
  }
  const includeExisting = body.includeExisting === true;
  if (includeExisting && body.importNow !== true) {
    return mailJson({ error: 'includeExisting requires importNow: true.' }, 400);
  }
  try {
    const campaign = await getCampaign(affiliateCampaignId());
    if (campaign.status !== 0 && campaign.status !== 2) {
      return mailJson({ error: 'Import blocked because the campaign is not Draft or Paused.' }, 409);
    }
    if (includeExisting && campaign.status !== 0) {
      return mailJson({ error: 'includeExisting is allowed only while the campaign is Draft.' }, 409);
    }
    const queued = await queueAffiliateOutreachContacts(affiliateId);
    if (affiliateId && queued.total === 0) {
      return mailJson({ error: 'Affiliate was not found or does not have a valid email address.' }, 404);
    }
    const imported = body.importNow === true
      ? await drainOutreachQueueFully({ includeExisting, affiliateId })
      : null;
    return mailJson({
      ok: true,
      scope: affiliateId ? { affiliateId } : { affiliateId: null },
      includeExisting,
      queued,
      imported,
      sync: await outreachSyncSummary(),
    });
  } catch (error) {
    return mailRouteError(error);
  }
}
