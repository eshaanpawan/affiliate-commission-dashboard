import { getInstantlyCampaignId, listEmailsPage } from '@/lib/instantly';
import { clampInteger, mailJson, mailRouteError, requireMailAuth, safeString } from '../_shared';

export const dynamic = 'force-dynamic';

const MODES = new Set(['emode_focused', 'emode_others', 'emode_all']);
const EMAIL_TYPES = new Set(['received', 'sent', 'manual']);

function optionalBoolean(value: string | null): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(req.url);
    const modeValue = url.searchParams.get('mode');
    const emailTypeValue = url.searchParams.get('emailType');
    const mode = modeValue && MODES.has(modeValue)
      ? modeValue as 'emode_focused' | 'emode_others' | 'emode_all'
      : undefined;
    const emailType = emailTypeValue && EMAIL_TYPES.has(emailTypeValue)
      ? emailTypeValue
      : undefined;
    const result = await listEmailsPage({
      campaignId: getInstantlyCampaignId(),
      limit: clampInteger(url.searchParams.get('limit'), 30, 1, 100),
      startingAfter: safeString(url.searchParams.get('cursor'), 500),
      search: safeString(url.searchParams.get('search'), 200),
      isUnread: optionalBoolean(url.searchParams.get('unread')),
      mode,
      emailType,
      latestOfThread: true,
      previewOnly: true,
      sortOrder: 'desc',
    });

    return mailJson({
      items: result.items.map((email) => ({
        id: email.id,
        threadId: email.thread_id ?? email.id,
        subject: email.subject ?? '(no subject)',
        from: email.from_address_email ?? null,
        to: email.to_address_email_list ?? null,
        senderAccount: email.eaccount ?? null,
        lead: email.lead ?? null,
        preview: email.content_preview ?? null,
        unread: email.is_unread ?? false,
        automated: email.is_automated ?? false,
        interestStatus: email.i_status ?? null,
        emailType: email.email_type ?? null,
        sentAt: email.timestamp_email ?? email.timestamp_created ?? null,
      })),
      nextStartingAfter: result.next_starting_after ?? null,
    });
  } catch (error) {
    return mailRouteError(error);
  }
}
