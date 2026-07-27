import {
  getCampaign,
  getInstantlyApprovedSenders,
  getInstantlyCampaignId,
  patchAccount,
  patchCampaign,
  type JsonValue,
} from '@/lib/instantly';
import sql from '@/lib/db';
import { mailJson, mailRouteError, requireMailAuth } from '../_shared';

interface ConfigureBody {
  confirm?: unknown;
  emailList?: unknown;
  dailyPerAccount?: unknown;
  dailyMaxLeads?: unknown;
  stopOnReply?: unknown;
  sequences?: unknown;
}

function validSequences(value: unknown): value is JsonValue {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 10) return false;
  const serialized = JSON.stringify(value);
  return serialized.length <= 250_000;
}

export async function PATCH(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;
  let body: ConfigureBody;
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit confirmation is required', required: { confirm: true } }, 409);
  }

  const approved = new Set(getInstantlyApprovedSenders());
  const emailList = Array.isArray(body.emailList)
    ? [...new Set(body.emailList.map((email) => String(email).trim().toLowerCase()))]
    : [];
  if (emailList.length < 1 || emailList.length > approved.size || emailList.some((email) => !approved.has(email))) {
    return mailJson({ error: 'Choose one or more approved sender accounts.' }, 400);
  }
  const dailyPerAccount = Math.max(1, Math.min(30, Number(body.dailyPerAccount ?? 30)));
  const capacity = dailyPerAccount * emailList.length;
  const dailyMaxLeads = Math.max(1, Math.min(capacity, Number(body.dailyMaxLeads ?? capacity)));
  if (!validSequences(body.sequences)) {
    return mailJson({ error: 'Sequences must be a reasonably sized JSON array.' }, 400);
  }

  try {
    const campaignId = getInstantlyCampaignId();
    const current = await getCampaign(campaignId);
    if (current.status !== 0 && current.status !== 2) {
      return mailJson({ error: 'Configuration is blocked unless the campaign is Draft or Paused.' }, 409);
    }

    const accountResults: { email: string; dailyLimit: number }[] = [];
    for (const email of emailList) {
      const account = await patchAccount(email, { daily_limit: dailyPerAccount });
      accountResults.push({ email, dailyLimit: Number(account.daily_limit ?? dailyPerAccount) });
    }
    const patch: Record<string, JsonValue | undefined> = {
      email_list: emailList,
      daily_limit: capacity,
      daily_max_leads: dailyMaxLeads,
      stop_on_reply: body.stopOnReply === false ? false : true,
      sequences: body.sequences as JsonValue | undefined,
    };
    const campaign = await patchCampaign(campaignId, patch);
    await sql`
      INSERT INTO outreach_events (campaign_id, event_type, status, payload)
      VALUES (
        ${campaignId}, 'instantly_campaign_configured', 'ok',
        ${JSON.stringify({ emailList, dailyPerAccount, dailyMaxLeads, stopOnReply: patch.stop_on_reply })}::jsonb
      )
    `;
    return mailJson({
      ok: true,
      safety: 'Campaign remains Draft or Paused; no email was sent.',
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        emailList: campaign.email_list,
        dailyLimit: campaign.daily_limit,
        dailyMaxLeads: campaign.daily_max_leads,
      },
      accounts: accountResults,
    });
  } catch (error) {
    return mailRouteError(error);
  }
}
