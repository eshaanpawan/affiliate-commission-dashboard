import { mailJson, mailRouteError, requireMailAuth } from '../_shared';
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
  let body: { confirm?: unknown; importNow?: unknown };
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit confirmation is required', required: { confirm: true } }, 409);
  }
  try {
    const campaign = await getCampaign(affiliateCampaignId());
    if (campaign.status !== 0 && campaign.status !== 2) {
      return mailJson({ error: 'Import blocked because the campaign is not Draft or Paused.' }, 409);
    }
    const queued = await queueAffiliateOutreachContacts();
    const imported = body.importNow === true ? await drainOutreachQueueFully() : null;
    return mailJson({ ok: true, queued, imported, sync: await outreachSyncSummary() });
  } catch (error) {
    return mailRouteError(error);
  }
}
