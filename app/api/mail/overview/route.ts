import {
  collectCursorPages,
  getCampaign,
  getCampaignSendingStatus,
  getInstantlyApprovedSenders,
  getInstantlyCampaignId,
  listAccountsPage,
  listEmailsPage,
  type InstantlyCampaign,
} from '@/lib/instantly';
import { mailJson, mailRouteError, requireMailAuth } from '../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function campaignSequenceCounts(campaign: InstantlyCampaign): { steps: number; variants: number } {
  const sequences = Array.isArray(campaign.sequences) ? campaign.sequences : [];
  const steps = sequences.flatMap((sequence) => sequence.steps ?? []);
  return {
    steps: steps.length,
    variants: steps.reduce((sum, step) => sum + (step.variants?.length ?? 0), 0),
  };
}

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const campaignId = getInstantlyCampaignId();
    const approvedSenders = getInstantlyApprovedSenders();
    const [accountCollection, campaign, sendingStatus, latest] = await Promise.all([
      collectCursorPages(
        (startingAfter) => listAccountsPage({ limit: 100, startingAfter, includeTags: true }),
        { maxPages: 20 },
      ),
      getCampaign(campaignId),
      getCampaignSendingStatus(campaignId, { withAiSummary: false }),
      listEmailsPage({
        campaignId,
        limit: 8,
        latestOfThread: true,
        previewOnly: true,
        sortOrder: 'desc',
      }),
    ]);

    const statusCounts = accountCollection.items.reduce<Record<string, number>>((counts, account) => {
      const status = account.status === null || account.status === undefined ? 'unknown' : String(account.status);
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {});
    const approvedSet = new Set(approvedSenders);
    const approvedAccounts = accountCollection.items.filter((account) =>
      approvedSet.has(account.email.toLowerCase()),
    );
    const availableAccounts = accountCollection.items.filter(
      (account) => account.status === 1 && !account.setup_pending,
    );
    const sequenceCounts = campaignSequenceCounts(campaign);

    return mailJson({
      source: 'instantly',
      fetchedAt: new Date().toISOString(),
      campaign: {
        id: campaign.id,
        name: campaign.name ?? null,
        status: campaign.status ?? null,
        dailyLimit: campaign.daily_limit ?? null,
        dailyMaxLeads: campaign.daily_max_leads ?? null,
        stopOnReply: campaign.stop_on_reply !== false,
        sendingAccounts: campaign.email_list ?? [],
        steps: sequenceCounts.steps,
        variants: sequenceCounts.variants,
        createdAt: campaign.timestamp_created ?? null,
        updatedAt: campaign.timestamp_updated ?? null,
        sendingStatus,
      },
      accounts: {
        total: accountCollection.items.length,
        available: availableAccounts.length,
        configuredDailyCapacity: availableAccounts.reduce(
          (sum, account) => sum + Math.max(0, account.daily_limit ?? 0),
          0,
        ),
        statusCounts,
        approvedSenders,
        approvedConnected: approvedAccounts.length,
        items: approvedAccounts.map((account) => ({
          email: account.email,
          name: [account.first_name, account.last_name].filter(Boolean).join(' ') || null,
          status: account.status ?? null,
          statusMessage: account.status_message ?? null,
          setupPending: account.setup_pending ?? null,
          warmupStatus: account.warmup_status ?? null,
          warmupScore: account.stat_warmup_score ?? null,
          dailyLimit: account.daily_limit ?? null,
          dailyLimitMax: account.daily_limit_max ?? null,
          lastUsedAt: account.timestamp_last_used ?? null,
        })),
        truncated: accountCollection.truncated,
      },
      unibox: {
        unread: latest.items.filter((email) => email.is_unread).length,
        latestThreads: latest.items.map((email) => ({
          id: email.id,
          threadId: email.thread_id ?? email.id,
          subject: email.subject ?? '(no subject)',
          from: email.from_address_email ?? null,
          to: email.to_address_email_list ?? null,
          senderAccount: email.eaccount ?? null,
          preview: email.content_preview ?? null,
          unread: email.is_unread ?? false,
          automated: email.is_automated ?? false,
          emailType: email.email_type ?? null,
          sentAt: email.timestamp_email ?? email.timestamp_created ?? null,
        })),
        nextStartingAfter: latest.next_starting_after ?? null,
      },
    });
  } catch (error) {
    return mailRouteError(error);
  }
}
