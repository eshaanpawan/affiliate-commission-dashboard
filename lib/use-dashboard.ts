'use client';

// Shared dashboard data hook — one cache, many pages.
// Each split-out page (affiliates, countries, leaderboard, funnel, monthly)
// uses this instead of re-implementing the fetch + localStorage hydration
// that used to live inline in the old single-page dashboard.

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface Affiliate {
  id: string;
  name: string;
  email: string;
  status: string;
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
}

export interface DashboardData {
  overview: {
    totalAffiliates: number;
    activeAffiliates: number;
    totalReferrals: number;
    convertedReferrals: number;
    totalRevenueCents: number;
    totalCommissionCents: number;
    paidCommissionCents: number;
    pendingPayoutCents: number;
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
  totalFts: number;
  baselines: FunnelRow[];
  affiliates: FunnelRow[];
  note?: string;
}

export interface TtsPerAffiliate {
  signupToFtsSecMedian: number | null;
  googleSimilarity: number | null | undefined;
  fts: number;
  countries: { code: string; name: string; count: number }[];
}

const CACHE_KEY_DASH = 'affiliateDashboard:v1';
const CACHE_KEY_TTS = 'affiliateTts:v1';
export const TTS_FROM = '2025-01-01';
export const TTS_TO = '2027-01-01';

export type Period = '7d' | '30d' | '90d' | 'all';

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [ttsData, setTtsData] = useState<TtsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [period, setPeriod] = useState<Period>('all');

  const load = useCallback(async (p?: Period) => {
    try {
      const dashPromise = fetch(`/api/dashboard?period=${p ?? 'all'}`).then(r => r.json());
      const ttsPromise = fetch(`/api/affiliates/tts?from=${TTS_FROM}&to=${TTS_TO}`)
        .then(r => r.json()).catch(() => null);

      const json = await dashPromise;
      setData(json);
      const now = new Date();
      setLastUpdated(now);
      try { localStorage.setItem(CACHE_KEY_DASH, JSON.stringify({ at: now.toISOString(), period: p ?? 'all', data: json })); } catch {}

      ttsPromise.then(tts => {
        if (tts && tts.affiliates) {
          setTtsData(tts);
          try { localStorage.setItem(CACHE_KEY_TTS, JSON.stringify({ at: new Date().toISOString(), data: tts })); } catch {}
        }
      }).catch(() => {});
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Hydrate from localStorage so navigation between split pages is instant.
    let hadCache = false;
    try {
      const cached = localStorage.getItem(CACHE_KEY_DASH);
      if (cached) {
        const { at, data: d, period: cachedPeriod } = JSON.parse(cached);
        if (d) {
          setData(d);
          setLastUpdated(new Date(at));
          if (cachedPeriod) setPeriod(cachedPeriod);
          setLoading(false);
          hadCache = true;
        }
      }
      const cachedTts = localStorage.getItem(CACHE_KEY_TTS);
      if (cachedTts) {
        const { data: t } = JSON.parse(cachedTts);
        if (t && t.affiliates) setTtsData(t);
      }
    } catch { /* localStorage unavailable */ }
    if (!hadCache) load();
  }, [load]);

  const refresh = useCallback(async (p?: Period) => {
    setLoading(true);
    await load(p ?? period);
  }, [load, period]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      await load(period);
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  }, [load, period]);

  const ttsByAffiliateId = useMemo(() => {
    const m = new Map<string, TtsPerAffiliate>();
    if (!ttsData?.affiliates) return m;
    for (const r of ttsData.affiliates) {
      if (r.affiliateId) m.set(r.affiliateId, {
        signupToFtsSecMedian: r.signupToFtsSecMedian,
        googleSimilarity: r.googleSimilarity,
        fts: r.fts,
        countries: r.countries ?? [],
      });
    }
    return m;
  }, [ttsData]);

  return {
    data, ttsData, ttsByAffiliateId,
    loading, syncing, lastUpdated,
    period, setPeriod,
    load, refresh, sync,
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
