import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

import { dashboardRangeStart } from '../lib/dashboard-range';
import { getFunnelCountsBySource } from '../lib/posthog';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const databaseUrl = process.env.NEON_DATABASE_URL;
const rewardfulSecret = process.env.REWARDFUL_API_SECRET;
if (!databaseUrl) throw new Error('NEON_DATABASE_URL is not configured');
if (!rewardfulSecret) throw new Error('REWARDFUL_API_SECRET is not configured');

const sql = neon(databaseUrl);
const rewardfulBaseUrl = 'https://api.getrewardful.com/v1';
const rewardfulAuthorization = `Basic ${Buffer.from(`${rewardfulSecret}:`).toString('base64')}`;
let nextRewardfulRequestAt = 0;

type SourceRecord = Record<string, unknown>;
type ResourceName = 'affiliates' | 'referrals' | 'sales' | 'commissions' | 'payouts';

interface SourcePage {
  data: SourceRecord[];
  pagination: {
    total_count: number;
    total_pages: number;
  };
}

async function rewardfulPage(resource: ResourceName, page: number): Promise<SourcePage> {
  const waitMs = Math.max(0, nextRewardfulRequestAt - Date.now());
  if (waitMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
  nextRewardfulRequestAt = Date.now() + 800;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await fetch(`${rewardfulBaseUrl}/${resource}?page=${page}&limit=100`, {
      headers: { Authorization: rewardfulAuthorization },
      cache: 'no-store',
    });
    if (response.status === 429) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 2_000));
      continue;
    }
    if (!response.ok) throw new Error(`Rewardful ${resource} page ${page} failed (${response.status})`);
    return response.json() as Promise<SourcePage>;
  }
  throw new Error(`Rewardful ${resource} remained rate limited`);
}

async function scanSource(resource: ResourceName, cutoff?: Date, toExclusive?: Date) {
  const rows: SourceRecord[] = [];
  let page = 1;
  let sourceTotal = 0;
  while (true) {
    const response = await rewardfulPage(resource, page);
    sourceTotal = response.pagination.total_count;
    const inWindow = cutoff
      ? response.data.filter((record) => {
        const createdAt = new Date(String(record.created_at));
        return createdAt >= cutoff && (!toExclusive || createdAt < toExclusive);
      })
      : response.data;
    rows.push(...inWindow);
    const oldest = response.data.at(-1);
    const crossedCutoff = cutoff && oldest
      ? new Date(String(oldest.created_at)) < cutoff
      : false;
    if (page >= response.pagination.total_pages || crossedCutoff) break;
    page += 1;
  }
  return { rows, sourceTotal, pagesScanned: page };
}

function cents(records: SourceRecord[], field: string) {
  return records.reduce((sum, record) => sum + Number(record[field] ?? 0), 0);
}

function asNumber(value: unknown) {
  return Number(value ?? 0);
}

async function main() {
  const auditedAt = new Date();
  const cutoff = new Date(dashboardRangeStart('30d', auditedAt)!);

  const [
    localCounts,
    duplicateIds,
    orphanIds,
    dateBounds,
    localThirtyDay,
    posthogMaterialized,
  ] = await Promise.all([
    sql`
      SELECT
        (SELECT COUNT(*) FROM affiliates WHERE status <> 'deleted') AS affiliates,
        (SELECT COUNT(*) FROM referrals WHERE status <> 'deleted') AS referrals,
        (SELECT COUNT(*) FROM sales WHERE status <> 'deleted') AS sales,
        (SELECT COUNT(*) FROM commissions WHERE status <> 'deleted') AS commissions,
        (SELECT COUNT(*) FROM payouts WHERE status <> 'deleted') AS payouts
    `,
    sql`
      SELECT
        (SELECT COUNT(*) - COUNT(DISTINCT rewardful_id) FROM affiliates) AS affiliates,
        (SELECT COUNT(*) - COUNT(DISTINCT rewardful_id) FROM referrals) AS referrals,
        (SELECT COUNT(*) - COUNT(DISTINCT rewardful_id) FROM sales) AS sales,
        (SELECT COUNT(*) - COUNT(DISTINCT rewardful_id) FROM commissions) AS commissions,
        (SELECT COUNT(*) - COUNT(DISTINCT rewardful_id) FROM payouts) AS payouts
    `,
    sql`
      SELECT
        (SELECT COUNT(*) FROM referrals r LEFT JOIN affiliates a ON a.rewardful_id = r.affiliate_id WHERE r.affiliate_id IS NOT NULL AND a.rewardful_id IS NULL) AS referrals,
        (SELECT COUNT(*) FROM sales s LEFT JOIN affiliates a ON a.rewardful_id = s.affiliate_id WHERE s.affiliate_id IS NOT NULL AND a.rewardful_id IS NULL) AS sales,
        (SELECT COUNT(*) FROM commissions c LEFT JOIN affiliates a ON a.rewardful_id = c.affiliate_id WHERE c.affiliate_id IS NOT NULL AND a.rewardful_id IS NULL) AS commissions,
        (SELECT COUNT(*) FROM payouts p LEFT JOIN affiliates a ON a.rewardful_id = p.affiliate_id WHERE p.affiliate_id IS NOT NULL AND a.rewardful_id IS NULL) AS payouts
    `,
    sql`
      SELECT
        (SELECT MIN(created_at) FROM referrals) AS referrals_min,
        (SELECT MAX(created_at) FROM referrals) AS referrals_max,
        (SELECT MIN(created_at) FROM sales) AS sales_min,
        (SELECT MAX(created_at) FROM sales) AS sales_max,
        (SELECT MIN(created_at) FROM commissions) AS commissions_min,
        (SELECT MAX(created_at) FROM commissions) AS commissions_max,
        (SELECT MAX(updated_at) FROM affiliates) AS rewardful_synced_at,
        (SELECT MAX(day) FROM affiliate_traffic) AS posthog_data_through,
        (SELECT MAX(synced_at) FROM affiliate_traffic) AS posthog_synced_at
    `,
    sql`
      SELECT
        (SELECT COUNT(*) FROM affiliates WHERE status <> 'deleted') AS current_affiliates,
        (SELECT COUNT(*) FROM affiliates WHERE status = 'active') AS active_affiliates,
        (SELECT COUNT(*) FROM affiliates WHERE status = 'suspicious') AS suspicious_affiliates,
        (SELECT COUNT(*) FROM affiliates WHERE status IN ('disabled', 'inactive')) AS disabled_affiliates,
        (SELECT COUNT(*) FROM affiliates WHERE status <> 'deleted' AND created_at >= ${cutoff.toISOString()}::timestamptz AND created_at < ${auditedAt.toISOString()}::timestamptz) AS new_affiliates,
        (SELECT COUNT(*) FROM referrals WHERE status <> 'deleted' AND created_at >= ${cutoff.toISOString()}::timestamptz AND created_at < ${auditedAt.toISOString()}::timestamptz) AS referrals,
        (SELECT COUNT(*) FROM referrals WHERE status = 'converted' AND created_at >= ${cutoff.toISOString()}::timestamptz AND created_at < ${auditedAt.toISOString()}::timestamptz) AS converted_referrals,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM sales WHERE status = 'created' AND created_at >= ${cutoff.toISOString()}::timestamptz AND created_at < ${auditedAt.toISOString()}::timestamptz) AS revenue_cents,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM commissions WHERE status NOT IN ('deleted', 'voided') AND created_at >= ${cutoff.toISOString()}::timestamptz AND created_at < ${auditedAt.toISOString()}::timestamptz) AS commission_cents,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM commissions WHERE status = 'paid' AND created_at >= ${cutoff.toISOString()}::timestamptz AND created_at < ${auditedAt.toISOString()}::timestamptz) AS paid_commission_cents,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM payouts WHERE status IN ('created', 'pending', 'due', 'processing')) AS pending_payout_cents
    `,
    sql`
      SELECT
        COUNT(DISTINCT via_token) AS tokens,
        COALESCE(SUM(pageviews), 0) AS pageviews,
        COALESCE(SUM(signups), 0) AS signups,
        COALESCE(SUM(fts), 0) AS fts,
        MAX(day) AS data_through,
        MAX(synced_at) AS synced_at
      FROM affiliate_traffic
      WHERE day >= ${cutoff.toISOString()}::date
    `,
  ]);

  const affiliatesSource = await scanSource('affiliates');
  // Keep Rewardful reads sequential. The account-level rate limit is shared
  // across resources, so parallel scanners can otherwise create bursty 429s.
  const referralsSource = await scanSource('referrals', cutoff, auditedAt);
  const salesSource = await scanSource('sales', cutoff, auditedAt);
  const commissionsSource = await scanSource('commissions', cutoff, auditedAt);
  const payoutsSource = await scanSource('payouts');

  const sourceAffiliates = affiliatesSource.rows;
  const sourceThirtyDay = {
    currentAffiliates: sourceAffiliates.length,
    activeAffiliates: sourceAffiliates.filter((row) => row.state === 'active').length,
    suspiciousAffiliates: sourceAffiliates.filter((row) => row.state === 'suspicious').length,
    disabledAffiliates: sourceAffiliates.filter((row) => row.state === 'disabled').length,
    newAffiliates: sourceAffiliates.filter((row) => {
      const createdAt = new Date(String(row.created_at));
      return createdAt >= cutoff && createdAt < auditedAt;
    }).length,
    referrals: referralsSource.rows.length,
    convertedReferrals: referralsSource.rows.filter((row) => row.conversion_state === 'conversion').length,
    revenueCents: cents(salesSource.rows.filter((row) => !row.refunded_at), 'sale_amount_cents'),
    commissionCents: cents(commissionsSource.rows.filter((row) => !row.voided_at), 'amount'),
    paidCommissionCents: cents(commissionsSource.rows.filter((row) => row.paid_at && !row.voided_at), 'amount'),
    pendingPayoutCents: cents(payoutsSource.rows.filter((row) => {
      if (row.paid_at || row.failed_at) return false;
      const state = String(row.state ?? (row.due_at ? 'due' : 'created'));
      return ['created', 'pending', 'due', 'processing'].includes(state);
    }), 'amount'),
  };

  const localThirtyDayRow = localThirtyDay[0];
  const localThirtyDayMetrics = {
    currentAffiliates: asNumber(localThirtyDayRow.current_affiliates),
    activeAffiliates: asNumber(localThirtyDayRow.active_affiliates),
    suspiciousAffiliates: asNumber(localThirtyDayRow.suspicious_affiliates),
    disabledAffiliates: asNumber(localThirtyDayRow.disabled_affiliates),
    newAffiliates: asNumber(localThirtyDayRow.new_affiliates),
    referrals: asNumber(localThirtyDayRow.referrals),
    convertedReferrals: asNumber(localThirtyDayRow.converted_referrals),
    revenueCents: asNumber(localThirtyDayRow.revenue_cents),
    commissionCents: asNumber(localThirtyDayRow.commission_cents),
    paidCommissionCents: asNumber(localThirtyDayRow.paid_commission_cents),
    pendingPayoutCents: asNumber(localThirtyDayRow.pending_payout_cents),
  };
  const metricDeltas = Object.fromEntries(
    Object.entries(sourceThirtyDay).map(([key, value]) => [
      key,
      localThirtyDayMetrics[key as keyof typeof localThirtyDayMetrics] - value,
    ]),
  );

  const posthogDirect = await getFunnelCountsBySource(cutoff, auditedAt);
  const sourceCounts = {
    affiliates: affiliatesSource.sourceTotal,
    referrals: referralsSource.sourceTotal,
    sales: salesSource.sourceTotal,
    commissions: commissionsSource.sourceTotal,
    payouts: payoutsSource.sourceTotal,
  };
  const localCountRow = localCounts[0];
  const localCountValues = Object.fromEntries(
    Object.keys(sourceCounts).map((key) => [key, asNumber(localCountRow[key])]),
  ) as Record<ResourceName, number>;
  const countDeltas = Object.fromEntries(
    Object.entries(sourceCounts).map(([key, value]) => [key, localCountValues[key as ResourceName] - value]),
  );

  const report = {
    auditedAt: auditedAt.toISOString(),
    reportingWindow: { from: cutoff.toISOString(), toExclusive: auditedAt.toISOString() },
    status: Object.values(countDeltas).every((value) => value === 0)
      && Object.values(metricDeltas).every((value) => value === 0)
      ? 'ready'
      : 'needs-revision',
    sourceCounts,
    localCounts: localCountValues,
    sourceMinusLocal: Object.fromEntries(Object.entries(countDeltas).map(([key, value]) => [key, -value])),
    uniquenessViolations: duplicateIds[0],
    orphanAffiliateIds: orphanIds[0],
    dateBounds: dateBounds[0],
    thirtyDay: {
      source: sourceThirtyDay,
      local: localThirtyDayMetrics,
      localMinusSource: metricDeltas,
      sourcePagesScanned: {
        referrals: referralsSource.pagesScanned,
        sales: salesSource.pagesScanned,
        commissions: commissionsSource.pagesScanned,
        payouts: payoutsSource.pagesScanned,
      },
    },
    posthog: {
      directFunnel: posthogDirect,
      materializedAffiliateTraffic: posthogMaterialized[0],
      note: 'Direct funnel classifies all acquisition sources; materialized traffic includes only URLs carrying a via token, so the totals are complementary rather than expected to match.',
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
