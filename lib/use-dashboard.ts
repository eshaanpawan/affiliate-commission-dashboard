'use client';

// Shared dashboard data hook — one cache, many pages.
// Each split-out page (affiliates, countries, leaderboard, funnel, monthly)
// uses this instead of re-implementing the fetch + localStorage hydration
// that used to live inline in the old single-page dashboard.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import type { DashboardRange } from '@/lib/dashboard-range';
import { idbGet, idbSet, memGet, memSet, trackRefresh } from '@/lib/client-cache';

export interface Affiliate {
  id: string;
  name: string;
  email: string;
  status: string;
  source: string;
  createdAt: string;
  referrals: number;
  signups: number;
  conversions: number;
  referralsToday: number;
  conversionsToday: number;
  revenueCents: number;
  commissionCents: number;
  linkToken: string | null;
  linkTokens: { token: string; count: number }[];
  fraudTags: string[];
  posthogPageviews: number;
  posthogSignups: number;
  posthogFts: number;
  adDrivenSignups: number;
}

export interface DashboardData {
  overview: {
    totalAffiliates: number;
    activeAffiliates: number;
    totalReferrals: number;
    convertedReferrals: number;
    totalRevenueCents: number;
    earningAffiliates: number;
    totalCommissionCents: number;
    paidCommissionCents: number;
    pendingPayoutCents: number;
    suspiciousAffiliates: number;
    disabledAffiliates: number;
    unnamedAffiliates: number;
    newAffiliates: number;
    onboardedToday: number;
    totalSignups: number;
    fraudAffiliates: number;
    dubAffiliates: number;
    adRunningAffiliates: number;
  };
  charts: {
    dailyAffiliates: { day: string; count: number }[];
    dailyReferrals: { day: string; total: number; converted: number }[];
    dailyRevenue: { day: string; usd: number }[];
    dailyCommissions: { day: string; usd: number }[];
  };
  affiliates: Affiliate[];
  recentActivity: { event_type: string; received_at: string; event_id: string }[];
  monthly: {
    month: string;
    referrals: number;
    conversions: number;
    revenueCents: number;
    commissionCents: number;
  }[];
  topByReferrals: { name: string; value: number }[];
  topByConversions: { name: string; value: number }[];
  weeklyLeaderboard: { rank: number; name: string; email: string; conversionsThisWeek: number; referralsThisWeek: number }[];
  countriesByConversions: { country_code: string; country_name: string; conversions: number }[];
  affiliateCountries: { affiliate_id: string; name: string; email: string; total: number; countries: { country_code: string; country_name: string; conversions: number }[] }[];
  meta?: {
    range: DashboardRange;
    from: string | null;
    generatedAt: string;
    lastRewardfulSyncAt: string | null;
    lastPosthogSyncAt: string | null;
    rowLevelReferralCount: number;
    sourceReferralCount: number;
    rowLevelCoveragePct: number | null;
  };
}

export interface FunnelRow {
  label: string;
  source: 'google' | 'affiliate' | 'other' | 'affiliate_specific';
  affiliateId?: string;
  email?: string | null;
  linkToken?: string | null;
  pageviews: number | null;
  signups: number;
  fts: number;
  pvToSignupRate: number | null;
  signupToFtsRate: number | null;
  signupToFtsSecMedian: number | null;
  googleSimilarity?: number | null;
  countries?: { code: string; name: string; count: number }[];
}

export interface TtsResponse {
  window: { from: string; to: string };
  generatedAt: string;
  totalFts: number;
  overall: {
    signupToFtsSecMedian: number | null;
    googleSignupToFtsSecMedian: number | null;
    restSignupToFtsSecMedian: number | null;
    googleFts: number;
    restFts: number;
    googleSignups: number;
    restSignups: number;
    googleSuToFtsRate: number | null;
    restSuToFtsRate: number | null;
  };
  baselines: FunnelRow[];
  affiliates: FunnelRow[];
  quality: {
    materializedTokens: number;
    resolvedTokens: number;
    tokenCoveragePct: number | null;
    timingRows: number;
    affiliateTimingMatches: number;
    affiliateAttributedFts: number;
    dataThrough: string | null;
    lastMaterializedAt: string | null;
  };
  note?: string;
}

export interface TtsPerAffiliate {
  signupToFtsSecMedian: number | null;
  googleSimilarity: number | null | undefined;
  fts: number;
  countries: { code: string; name: string; count: number }[];
}

export const TTS_FROM = '2025-01-01';
export const TTS_TO = '2027-01-01';

export type Period = DashboardRange;

const dashboardCache = new Map<string, { at: number; data: DashboardData }>();
const dashboardRequests = new Map<string, Promise<DashboardData>>();
const MEMORY_CACHE_MS = 15_000;

const snapshotKey = (range: DashboardRange) => `dashboard:${range}`;

/** Best cached snapshot for a range: warm module memory (survives client-side
 * navigation, read synchronously) — the IndexedDB copy is promoted into it
 * on first read after a hard reload. */
function getSnapshot(range: DashboardRange): DashboardData | null {
  return memGet<DashboardData>(snapshotKey(range));
}

function storeSnapshot(range: DashboardRange, data: DashboardData): void {
  memSet(snapshotKey(range), data);
  idbSet(snapshotKey(range), data); // fire-and-forget persistence for hard reloads
}

async function fetchDashboard(range: DashboardRange, refreshVersion: number): Promise<DashboardData> {
  const key = `${range}:${refreshVersion}`;
  const cached = dashboardCache.get(key);
  if (cached && Date.now() - cached.at < MEMORY_CACHE_MS) return cached.data;

  const inFlight = dashboardRequests.get(key);
  if (inFlight) return inFlight;

  const request = trackRefresh(fetch(`/api/dashboard?period=${range}`, { cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `Dashboard request failed (${response.status})`);
      dashboardCache.set(key, { at: Date.now(), data: payload });
      storeSnapshot(range, payload as DashboardData);
      return payload as DashboardData;
    })
    .finally(() => dashboardRequests.delete(key)));

  dashboardRequests.set(key, request);
  return request;
}

export function useDashboard(rangeOverride?: DashboardRange | null) {
  const dashboardRange = useDashboardRange();
  const effectiveRange = rangeOverride ?? dashboardRange.range;
  // Hydrate synchronously from the warm snapshot so the first paint shows data.
  const [data, setData] = useState<DashboardData | null>(() => getSnapshot(effectiveRange));
  const [loading, setLoading] = useState(() => getSnapshot(effectiveRange) === null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(() => {
    const snap = getSnapshot(effectiveRange);
    return snap?.meta?.generatedAt ? new Date(snap.meta.generatedAt) : null;
  });
  const [error, setError] = useState<string | null>(null);
  const rangeRef = useRef(effectiveRange);
  rangeRef.current = effectiveRange;

  const load = useCallback(async () => {
    const range = effectiveRange;
    const stale = getSnapshot(range);
    // Stale-while-revalidate: show the cached snapshot immediately (also
    // covers switching ranges — the previous range's data is swapped out for
    // the new range's snapshot instead of a blank loading state).
    setData(stale);
    setLoading(stale === null);
    setError(null);
    if (stale?.meta?.generatedAt) setLastUpdated(new Date(stale.meta.generatedAt));

    // After a hard reload the module memory is empty — race a fast IndexedDB
    // read against the network and paint whichever lands first.
    if (stale === null) {
      idbGet<DashboardData>(snapshotKey(range))
        .then((persisted) => {
          if (!persisted || rangeRef.current !== range) return;
          memSet(snapshotKey(range), persisted);
          setData((current) => {
            if (current) return current; // network already won
            setLoading(false);
            if (persisted.meta?.generatedAt) setLastUpdated(new Date(persisted.meta.generatedAt));
            return persisted;
          });
        })
        .catch(() => {});
    }

    try {
      const json = await fetchDashboard(range, dashboardRange.refreshVersion);
      if (rangeRef.current !== range) return;
      setData(json);
      const now = json.meta?.generatedAt ? new Date(json.meta.generatedAt) : new Date();
      setLastUpdated(now);
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load dashboard';
      if (rangeRef.current === range) setError(message);
      console.error(cause);
    } finally {
      if (rangeRef.current === range) setLoading(false);
    }
  }, [dashboardRange.refreshVersion, effectiveRange]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const refresh = useCallback(async () => dashboardRange.refresh(), [dashboardRange]);

  return {
    data,
    loading,
    error,
    syncing: dashboardRange.syncing,
    lastUpdated,
    period: effectiveRange,
    setPeriod: dashboardRange.setRange,
    load,
    refresh,
    sync: dashboardRange.syncRewardful,
  };
}

/** Slice a list for 1-indexed pagination. */
export function paginate<T>(rows: T[], page: number, perPage: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    rows: rows.slice((safePage - 1) * perPage, safePage * perPage),
    page: safePage,
    totalPages,
    total: rows.length,
  };
}
