import {
  getCampaign,
  getEmail,
  getInstantlyCampaignId,
  isInstantlyApprovedSender,
  replyToEmail,
} from '@/lib/instantly';
import {
  isEmail,
  isUuid,
  mailJson,
  mailRouteError,
  requireMailAuth,
  safeString,
} from '../_shared';

interface ReplyBody {
  confirm?: unknown;
  eaccount?: unknown;
  replyToUuid?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  additionalRecipients?: unknown;
  cc?: unknown;
  bcc?: unknown;
  reminderTs?: unknown;
  assignedTo?: unknown;
}

function optionalContent(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > maxLength) return undefined;
  return value;
}

function commaSeparatedEmails(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2_000) return null;
  const emails = value.split(',').map((email) => email.trim()).filter(Boolean);
  if (emails.length > 20 || emails.some((email) => !isEmail(email))) return null;
  return emails.join(',');
}

export async function POST(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  let body: ReplyBody;
  try {
    body = await req.json() as ReplyBody;
  } catch {
    return mailJson({ error: 'Invalid JSON body' }, 400);
  }

  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit confirmation is required', required: { confirm: true } }, 409);
  }

  const eaccount = safeString(body.eaccount, 320)?.toLowerCase();
  const replyToUuid = safeString(body.replyToUuid, 100);
  const subject = safeString(body.subject, 998);
  const text = optionalContent(body.text, 200_000);
  const html = optionalContent(body.html, 500_000);
  const cc = commaSeparatedEmails(body.cc);
  const bcc = commaSeparatedEmails(body.bcc);

  if (!eaccount || !isEmail(eaccount)) return mailJson({ error: 'A valid eaccount is required' }, 400);
  if (!isInstantlyApprovedSender(eaccount)) return mailJson({ error: 'Sender is not approved' }, 403);
  if (!replyToUuid || !isUuid(replyToUuid)) return mailJson({ error: 'A valid replyToUuid is required' }, 400);
  if (!subject) return mailJson({ error: 'A subject is required' }, 400);
  if (!text && !html) return mailJson({ error: 'A text or HTML body is required' }, 400);
  if (cc === null || bcc === null) return mailJson({ error: 'CC or BCC contains an invalid email' }, 400);

  const recipients = Array.isArray(body.additionalRecipients)
    ? body.additionalRecipients
    : body.additionalRecipients === undefined
      ? []
      : null;
  if (
    recipients === null
    || recipients.length > 20
    || recipients.some((recipient) => typeof recipient !== 'string' || !isEmail(recipient))
  ) {
    return mailJson({ error: 'additionalRecipients must contain valid email addresses' }, 400);
  }

  const reminderTs = body.reminderTs === undefined
    ? undefined
    : safeString(body.reminderTs, 100);
  if (body.reminderTs !== undefined && (!reminderTs || Number.isNaN(Date.parse(reminderTs)))) {
    return mailJson({ error: 'reminderTs must be a valid date-time' }, 400);
  }
  const assignedTo = body.assignedTo === undefined
    ? undefined
    : safeString(body.assignedTo, 320);
  if (body.assignedTo !== undefined && (!assignedTo || !isEmail(assignedTo))) {
    return mailJson({ error: 'assignedTo must be a valid email' }, 400);
  }

  try {
    const campaignId = getInstantlyCampaignId();
    const [campaign, target] = await Promise.all([
      getCampaign(campaignId),
      getEmail(replyToUuid),
    ]);
    if (target.campaign_id !== campaignId) {
      return mailJson({ error: 'Reply target does not belong to the affiliate campaign' }, 403);
    }
    if (campaign.status !== 0 && campaign.status !== 2) {
      return mailJson({ error: 'Manual replies are blocked unless the campaign is Draft or Paused' }, 409);
    }
    const configuredSenders = new Set((campaign.email_list ?? []).map((sender) => sender.toLowerCase()));
    if (!configuredSenders.has(eaccount)) {
      return mailJson({ error: 'Sender is not assigned to the affiliate campaign' }, 403);
    }

    const sent = await replyToEmail({
      eaccount,
      replyToUuid,
      subject,
      text,
      html,
      additionalRecipients: recipients.map((recipient) => recipient.trim().toLowerCase()),
      ccAddressEmailList: cc,
      bccAddressEmailList: bcc,
      reminderTs,
      assignedTo,
    });
    return mailJson({
      ok: true,
      email: {
        id: sent.id,
        threadId: sent.thread_id ?? target.thread_id ?? null,
        subject: sent.subject ?? subject,
        from: sent.eaccount ?? eaccount,
        sentAt: sent.timestamp_email ?? sent.timestamp_created ?? null,
      },
    }, 201);
  } catch (error) {
    return mailRouteError(error);
  }
}
