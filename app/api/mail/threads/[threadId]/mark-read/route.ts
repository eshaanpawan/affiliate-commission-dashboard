import { getInstantlyCampaignId, listEmailsPage, markThreadRead } from '@/lib/instantly';
import { isThreadId, mailJson, mailRouteError, requireMailAuth } from '../../../_shared';

export async function POST(req: Request, context: { params: Promise<{ threadId: string }> }) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  const { threadId } = await context.params;
  if (!isThreadId(threadId)) return mailJson({ error: 'Invalid thread ID' }, 400);

  try {
    const campaignId = getInstantlyCampaignId();
    const verification = await listEmailsPage({
      campaignId,
      search: `thread:${threadId}`,
      limit: 5,
      previewOnly: true,
    });
    const belongsToCampaign = verification.items.some(
      (email) => (email.thread_id ?? email.id) === threadId && email.campaign_id === campaignId,
    );
    if (!belongsToCampaign) return mailJson({ error: 'Thread not found' }, 404);

    await markThreadRead(threadId);
    return mailJson({ ok: true, threadId });
  } catch (error) {
    return mailRouteError(error);
  }
}
