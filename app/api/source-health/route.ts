import { NextResponse } from 'next/server';

import { isAuthed } from '@/lib/auth';
import sql from '@/lib/db';
import { affiliateCampaignId } from '@/lib/outreach';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const campaignId = affiliateCampaignId();
  const [row] = await sql`
    SELECT
      (SELECT MAX(updated_at) FROM affiliates) AS rewardful_synced_at,
      (SELECT MAX(synced_at) FROM affiliate_traffic) AS posthog_synced_at,
      (SELECT COUNT(*)::int FROM affiliates WHERE status <> 'deleted') AS affiliate_rows,
      (SELECT COALESCE(SUM(visitors), 0)::bigint FROM affiliates WHERE status <> 'deleted') AS source_referrals,
      (SELECT COUNT(*)::bigint FROM referrals WHERE status <> 'deleted') AS referral_rows,
      (SELECT COUNT(*)::int FROM outreach_contacts
       WHERE campaign_id = ${campaignId}
         AND segment = 'risk_review_high'
         AND sync_status <> 'suppressed') AS high_risk,
      (SELECT COUNT(*)::int FROM commission_holds WHERE status = 'held') AS held_count
  `;

  const sourceReferralEvents = Number(row?.source_referrals ?? 0);
  const localReferralRows = Number(row?.referral_rows ?? 0);
  const rewardfulSyncedAt = row?.rewardful_synced_at ? String(row.rewardful_synced_at) : null;
  const posthogSyncedAt = row?.posthog_synced_at ? String(row.posthog_synced_at) : null;
  const ageHours = (date: string | null) => date
    ? Math.max(0, (Date.now() - new Date(date).getTime()) / 3_600_000)
    : null;
  const rewardfulAgeHours = ageHours(rewardfulSyncedAt);
  const posthogAgeHours = ageHours(posthogSyncedAt);
  const affiliateRows = Number(row?.affiliate_rows ?? 0);

  return NextResponse.json({
    rewardful: {
      // Rewardful's affiliate.visitors counter is not the row count of the
      // /referrals collection, so comparing them produced a false "degraded"
      // state. Health represents source freshness and roster availability;
      // snapshot coverage is reported separately without pretending the two
      // differently-defined counters can reconcile.
      state: rewardfulAgeHours === null || rewardfulAgeHours > 30 || affiliateRows === 0
        ? 'stale'
        : 'healthy',
      lastSyncedAt: rewardfulSyncedAt,
      affiliateRows,
      snapshot: {
        localReferralRows,
        sourceVisitorEvents: sourceReferralEvents,
        comparable: false,
      },
    },
    posthog: {
      state: posthogAgeHours !== null && posthogAgeHours <= 48 ? 'healthy' : 'stale',
      lastSyncedAt: posthogSyncedAt,
    },
    instantly: {
      state: process.env.INSTANTLY_API_KEY ? 'configured' : 'missing',
    },
    badges: {
      highRisk: Number(row?.high_risk ?? 0),
      heldCount: Number(row?.held_count ?? 0),
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
