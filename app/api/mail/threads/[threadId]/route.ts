import {
  collectCursorPages,
  getInstantlyApprovedSenders,
  getInstantlyCampaignId,
  listEmailsPage,
} from '@/lib/instantly';
import { isUuid, mailJson, mailRouteError, requireMailAuth } from '../../_shared';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ threadId: string }> }) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  const { threadId } = await context.params;
  if (!isUuid(threadId)) return mailJson({ error: 'Invalid thread ID' }, 400);

  try {
    const campaignId = getInstantlyCampaignId();
    const messages = await collectCursorPages(
      (startingAfter) => listEmailsPage({
        campaignId,
        search: `thread:${threadId}`,
        limit: 100,
        startingAfter,
        previewOnly: false,
        sortOrder: 'asc',
      }),
      { maxPages: 5 },
    );
    const inThread = messages.items
      .filter((email) => (email.thread_id ?? email.id) === threadId && email.campaign_id === campaignId)
      .sort((a, b) => {
        const left = Date.parse(a.timestamp_email ?? a.timestamp_created ?? '');
        const right = Date.parse(b.timestamp_email ?? b.timestamp_created ?? '');
        return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
      });

    if (inThread.length === 0) return mailJson({ error: 'Thread not found' }, 404);

    return mailJson({
      threadId,
      campaignId,
      approvedSenders: getInstantlyApprovedSenders(),
      messages: inThread.map((email) => ({
        id: email.id,
        messageId: email.message_id ?? null,
        subject: email.subject ?? '(no subject)',
        from: email.from_address_email ?? null,
        fromAddress: email.from_address_json ?? null,
        to: email.to_address_email_list ?? null,
        toAddress: email.to_address_json ?? null,
        cc: email.cc_address_email_list ?? null,
        bcc: email.bcc_address_email_list ?? null,
        senderAccount: email.eaccount ?? null,
        lead: email.lead ?? null,
        leadId: email.lead_id ?? null,
        body: email.body ?? null,
        preview: email.content_preview ?? null,
        unread: email.is_unread ?? false,
        automated: email.is_automated ?? false,
        emailType: email.email_type ?? null,
        attachments: email.attachment_json ?? null,
        sentAt: email.timestamp_email ?? email.timestamp_created ?? null,
      })),
      truncated: messages.truncated,
      nextStartingAfter: messages.nextStartingAfter,
    });
  } catch (error) {
    return mailRouteError(error);
  }
}
