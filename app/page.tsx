'use client';

import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, Flag, Info, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { MetricCard } from '@/components/MetricCard';
import { DayOnDayChart } from '@/components/DayOnDayChart';
import { TopAffiliatesPie } from '@/components/TopAffiliatesPie';
import { SectionCard } from '@/components/SectionCard';
import { fmtCents as fmt, pct, fmtDuration, ttsTone, similarityTone } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Affiliate {
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

interface DashboardData {
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

interface FunnelRow {
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

interface TtsResponse {
  window: { from: string; to: string };
  totalFts: number;
  baselines: FunnelRow[];
  affiliates: FunnelRow[];
  note?: string;
}

interface AffiliateDetail {
  dailyReferrals: { day: string; total: number; converted: number }[];
  dailyRevenue: { day: string; usd: number }[];
  dailyCommissions: { day: string; usd: number }[];
}

type SortKey = 'referrals' | 'conversions' | 'revenueCents' | 'commissionCents';

const CACHE_KEY_DASH = 'affiliateDashboard:v1';
const CACHE_KEY_TTS = 'affiliateTts:v1';

const COUNTRY_CHART_CONFIG = {
  conversions: { label: 'Conversions', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const MONTHLY_COUNT_CONFIG = {
  conversions: { label: 'Conversions', color: 'var(--chart-2)' },
  referrals: { label: 'Referrals', color: 'var(--chart-10)' },
} satisfies ChartConfig;

const MONTHLY_MONEY_CONFIG = {
  revenue: { label: 'Revenue', color: 'var(--chart-1)' },
  commissions: { label: 'Commissions', color: 'var(--chart-3)' },
} satisfies ChartConfig;

function AffiliateModal({ affiliate, ftsCountries, ftsTotal, onClose }: {
  affiliate: Affiliate;
  ftsCountries: { code: string; name: string; count: number }[];
  ftsTotal: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AffiliateDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/affiliates/${affiliate.id}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [affiliate.id]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{affiliate.name}</DialogTitle>
          <DialogDescription>{affiliate.email}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-0.5 text-xs">Referrals</p>
            <p className="text-xl font-bold tabular-nums">{affiliate.referrals}</p>
            <p className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-400">{affiliate.referralsToday} today</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-0.5 text-xs">Conversions</p>
            <p className="text-xl font-bold tabular-nums">{affiliate.conversions}</p>
            <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">{affiliate.conversionsToday} today</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-0.5 text-xs">Revenue</p>
            <p className="text-xl font-bold tabular-nums">{fmt(affiliate.revenueCents)}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{pct(affiliate.conversions, affiliate.referrals)} conv. rate</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-0.5 text-xs">Commission</p>
            <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(affiliate.commissionCents)}</p>
            <div className="mt-1">
              <Badge variant={affiliate.status === 'active' ? 'default' : 'secondary'}>{affiliate.status}</Badge>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-[260px] w-full" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-[260px] w-full" />
              <Skeleton className="h-[260px] w-full" />
            </div>
          </div>
        ) : !detail ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">No data available.</div>
        ) : (
          <div className="space-y-4">
            <DayOnDayChart
              title="Referrals & Conversions (last 30 days)"
              data={detail.dailyReferrals}
              bars={[
                { key: 'total', color: 'var(--chart-10)', label: 'Referrals', axis: 'left' },
                { key: 'converted', color: 'var(--chart-2)', label: 'Conversions', axis: 'right' },
              ]}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <DayOnDayChart title="Revenue (last 30 days)" data={detail.dailyRevenue} bars={[{ key: 'usd', color: 'var(--chart-1)', label: 'Revenue' }]} valuePrefix="$" />
              <DayOnDayChart title="Commissions (last 30 days)" data={detail.dailyCommissions} bars={[{ key: 'usd', color: 'var(--chart-3)', label: 'Commissions' }]} valuePrefix="$" />
            </div>
            {ftsCountries.length > 0 && (
              <Card className="gap-3">
                <CardHeader>
                  <CardTitle className="text-sm">Paying customers by country</CardTitle>
                  <CardDescription className="text-xs">
                    {ftsTotal} FTS · {ftsCountries.length} {ftsCountries.length === 1 ? 'country' : 'countries'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ftsCountries.slice(0, 10).map((c) => {
                    const pctOfTotal = ftsTotal > 0 ? (c.count / ftsTotal) * 100 : 0;
                    return (
                      <div key={c.code} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-28 truncate">{c.name}</span>
                        <Progress value={pctOfTotal} className="h-2 flex-1" />
                        <span className="w-10 text-right font-medium tabular-nums">{c.count}</span>
                        <span className="text-muted-foreground w-12 text-right text-[10px] tabular-nums">{pctOfTotal.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                  {ftsCountries.length > 10 && (
                    <p className="text-muted-foreground pt-1 text-[11px]">…and {ftsCountries.length - 10} more countries</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="How country is determined" className="text-muted-foreground hover:text-foreground ml-2 inline-flex cursor-help">
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="mb-1 font-semibold">How country is determined</p>
        <p className="leading-relaxed">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function relativeLabel(sec: number): string {
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function RelativeTime({ at }: { at: Date }) {
  // Read the clock in an effect, never during render: the value is time-dependent,
  // so rendering it directly is impure and mismatches the server-rendered HTML.
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setLabel(relativeLabel(Math.max(0, Math.floor((Date.now() - at.getTime()) / 1000))));
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [at]);
  return <span title={at.toLocaleString()}>{label ?? ''}</span>;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('conversions');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedAffiliate, setSelectedAffiliate] = useState<Affiliate | null>(null);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('all');
  const [affiliatesExpanded, setAffiliatesExpanded] = useState(false);
  const [monthlyExpanded, setMonthlyExpanded] = useState(false);
  const [topAffiliatesExpanded, setTopAffiliatesExpanded] = useState(false);
  const [last30Expanded, setLast30Expanded] = useState(true);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(false);
  const [countryView, setCountryView] = useState<'chart' | 'table'>('chart');
  const [affiliateCountriesExpanded, setAffiliateCountriesExpanded] = useState(false);
  const [expandedAffiliateCountries, setExpandedAffiliateCountries] = useState<Set<string>>(new Set());
  const [affiliateCountryView, setAffiliateCountryView] = useState<Record<string, 'chart' | 'table'>>({});
  const [ttsExpanded, setTtsExpanded] = useState(false);
  const [ttsData, setTtsData] = useState<TtsResponse | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsFrom, setTtsFrom] = useState('2025-01-01');
  const [ttsTo, setTtsTo] = useState('2027-01-01');

  async function loadTts(from = ttsFrom, to = ttsTo) {
    setTtsLoading(true);
    try {
      const res = await fetch(`/api/affiliates/tts?from=${from}&to=${to}`);
      const json = await res.json();
      setTtsData(json);
    } finally {
      setTtsLoading(false);
    }
  }

  async function load(p?: string) {
    try {
      // Fire dashboard + TTS in parallel; show dashboard immediately, fill TTS columns when it lands.
      const dashPromise = fetch(`/api/dashboard?period=${p ?? period}`).then(r => r.json());
      const ttsPromise = fetch(`/api/affiliates/tts?from=${ttsFrom}&to=${ttsTo}`)
        .then(r => r.json()).catch(() => null);

      const json = await dashPromise;
      setData(json);
      const now = new Date();
      setLastUpdated(now);
      try { localStorage.setItem(CACHE_KEY_DASH, JSON.stringify({ at: now.toISOString(), period: p ?? period, data: json })); } catch {}

      // Background: resolve TTS and merge
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
  }

  // Per-affiliate TTS lookup, used to fill the "Signup→Pay" and "vs Google" columns inline.
  const ttsByAffiliateId = useMemo(() => {
    const m = new Map<string, { signupToFtsSecMedian: number | null; googleSimilarity: number | null | undefined; fts: number; countries: { code: string; name: string; count: number }[] }>();
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

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      setLastSynced(new Date());
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    // Hydrate from localStorage first so reloads are instant — no auto-polling.
    // User must click "Refresh" to fetch fresh data.
    let hadCachedDash = false;
    try {
      const cachedDash = localStorage.getItem(CACHE_KEY_DASH);
      if (cachedDash) {
        const { at, data: d, period: cachedPeriod } = JSON.parse(cachedDash);
        if (d) {
          setData(d);
          setLastUpdated(new Date(at));
          if (cachedPeriod) setPeriod(cachedPeriod);
          setLoading(false);
          hadCachedDash = true;
        }
      }
      const cachedTts = localStorage.getItem(CACHE_KEY_TTS);
      if (cachedTts) {
        const { data: t } = JSON.parse(cachedTts);
        if (t && t.affiliates) setTtsData(t);
      }
    } catch { /* localStorage unavailable, fall through to fetch */ }

    // If we have nothing cached, do a one-time initial load.
    if (!hadCachedDash) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setLoading(true);
    await load(period);
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
        <Skeleton className="mb-8 h-10 w-72" />
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-destructive text-sm">Failed to load data.</p>
      </div>
    );
  }

  const { overview, charts, recentActivity } = data;

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const affiliates = [...data.affiliates].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey];
    return sortDir === 'desc' ? -diff : diff;
  });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="text-muted-foreground/50 ml-1 inline size-3" />;
    return sortDir === 'desc'
      ? <ArrowDown className="ml-1 inline size-3 text-indigo-600 dark:text-indigo-400" />
      : <ArrowUp className="ml-1 inline size-3 text-indigo-600 dark:text-indigo-400" />;
  }

  return (
    <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
      {selectedAffiliate && (() => {
        const tts = ttsByAffiliateId.get(selectedAffiliate.id);
        return (
          <AffiliateModal
            affiliate={selectedAffiliate}
            ftsCountries={tts?.countries ?? []}
            ftsTotal={tts?.fts ?? 0}
            onClose={() => setSelectedAffiliate(null)}
          />
        );
      })()}

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Affiliate Commission Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Powered by Rewardful</p>
        </div>
        <div className="flex items-start gap-4">
          <Button asChild variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
            <Link href="/fraud"><Flag className="size-3.5" /> Fraud audit</Link>
          </Button>
          <div className="text-right">
            <p className="text-muted-foreground text-xs">
              {lastUpdated ? <>Last refreshed <RelativeTime at={lastUpdated} /> · cached locally</> : 'Never refreshed'}
            </p>
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button size="sm" onClick={refresh} disabled={loading}>
                <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
                    {syncing ? 'Syncing…' : 'Sync from Rewardful'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Pull latest data from Rewardful into the DB. Run before Refresh if you want the freshest source data.
                </TooltipContent>
              </Tooltip>
            </div>
            {lastSynced && <p className="text-muted-foreground mt-1 text-[11px]">Synced {lastSynced.toLocaleTimeString()}</p>}
          </div>
        </div>
      </div>

      {/* Period-filtered metrics */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-sm">Overview</CardTitle>
          <CardDescription className="text-xs">Metrics update based on the selected time window</CardDescription>
          <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
            <Tabs value={period} onValueChange={(v) => { const p = v as typeof period; setPeriod(p); load(p); }}>
              <TabsList>
                <TabsTrigger value="7d">Last 7 days</TabsTrigger>
                <TabsTrigger value="30d">Last 30 days</TabsTrigger>
                <TabsTrigger value="90d">Last 90 days</TabsTrigger>
                <TabsTrigger value="all">All time</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="Total Affiliates" value={overview.totalAffiliates} sub={`${overview.activeAffiliates} active`} />
          <MetricCard label="Total Referrals" value={overview.totalReferrals} sub={`${overview.convertedReferrals} converted (${pct(overview.convertedReferrals, overview.totalReferrals)})`} />
          <MetricCard label="Total Revenue" value={fmt(overview.totalRevenueCents)} />
          <MetricCard label="Commissions Owed" value={fmt(overview.totalCommissionCents)} sub={`${fmt(overview.paidCommissionCents)} paid`} />
          <MetricCard label="Conversion Rate" value={pct(overview.convertedReferrals, overview.totalReferrals)} sub={`${overview.convertedReferrals} conversions`} />
          <MetricCard label="Unpaid Commissions" value={fmt(overview.totalCommissionCents - overview.paidCommissionCents)} />
          <MetricCard label="Pending Payouts" value={fmt(overview.pendingPayoutCents)} />
          <MetricCard label="Avg Revenue / Affiliate" value={overview.totalAffiliates > 0 ? fmt(overview.totalRevenueCents / overview.totalAffiliates) : '$0.00'} />
        </CardContent>
      </Card>

      {/* Day-on-day charts */}
      <SectionCard
        className="mb-8"
        title="Last 30 Days"
        description="Daily trends for affiliates, referrals, revenue and commissions"
        open={last30Expanded}
        onOpenChange={setLast30Expanded}
      >
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <DayOnDayChart title="New Affiliates (last 30 days)" data={charts.dailyAffiliates} bars={[{ key: 'count', color: 'var(--chart-1)', label: 'New affiliates' }]} />
          <DayOnDayChart
            title="Referrals & Conversions per Day (last 30 days)"
            data={charts.dailyReferrals}
            bars={[
              { key: 'total', color: 'var(--chart-10)', label: 'Referrals', axis: 'left' },
              { key: 'converted', color: 'var(--chart-2)', label: 'Conversions', axis: 'right' },
            ]}
          />
          <DayOnDayChart title="Revenue per Day (last 30 days)" data={charts.dailyRevenue} bars={[{ key: 'usd', color: 'var(--chart-1)', label: 'Revenue' }]} valuePrefix="$" />
          <DayOnDayChart title="Commissions per Day (last 30 days)" data={charts.dailyCommissions} bars={[{ key: 'usd', color: 'var(--chart-3)', label: 'Commissions' }]} valuePrefix="$" />
        </div>
      </SectionCard>

      {/* Affiliate x Country breakdown */}
      {data.affiliateCountries.length > 0 && (
        <SectionCard
          className="mb-8"
          title={<>Conversions by Affiliate &amp; Country<InfoTooltip text="Country is sourced from PostHog, not Rewardful. Each conversion's customer email (from Rewardful) is matched to a PostHog user via their sign_up event, then the country is taken from that user's $pageview geo data ($geoip_country_code). Conversions without a matching email or pageview show no country." /></>}
          description="Click an affiliate row to expand their country breakdown"
          open={affiliateCountriesExpanded}
          onOpenChange={setAffiliateCountriesExpanded}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">Affiliate</TableHead>
                <TableHead className="px-5 text-right">Conversions with Country</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.affiliateCountries.map((a) => {
                const isExpanded = expandedAffiliateCountries.has(a.affiliate_id);
                const view = affiliateCountryView[a.affiliate_id] ?? 'chart';
                return (
                  <React.Fragment key={a.affiliate_id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedAffiliateCountries(prev => {
                        const next = new Set(prev);
                        if (next.has(a.affiliate_id)) next.delete(a.affiliate_id);
                        else next.add(a.affiliate_id);
                        return next;
                      })}
                    >
                      <TableCell className="px-5 py-3">
                        <p className="font-medium">{a.name}</p>
                        <p className="text-muted-foreground text-xs">{a.email}</p>
                      </TableCell>
                      <TableCell className="px-5 py-3 text-right">
                        <span className="font-semibold tabular-nums">{a.total}</span>
                        <ChevronDown className={cn('text-muted-foreground ml-2 inline size-3.5 transition-transform', isExpanded && 'rotate-180')} />
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={2} className="px-5 py-4">
                          <Tabs
                            value={view}
                            onValueChange={(v) => setAffiliateCountryView(m => ({ ...m, [a.affiliate_id]: v as 'chart' | 'table' }))}
                            className="gap-4"
                          >
                            <TabsList onClick={(e) => e.stopPropagation()}>
                              <TabsTrigger value="chart">Chart</TabsTrigger>
                              <TabsTrigger value="table">Table</TabsTrigger>
                            </TabsList>
                          </Tabs>
                          {view === 'chart' ? (
                            <ChartContainer config={COUNTRY_CHART_CONFIG} className="mt-4 h-[240px] w-full">
                              <BarChart data={a.countries} margin={{ top: 4, right: 12, left: -18, bottom: 56 }}>
                                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                <XAxis dataKey="country_name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" />
                                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} width={44} />
                                <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="country_name" />} />
                                <Bar dataKey="conversions" fill="var(--color-conversions)" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ChartContainer>
                          ) : (
                            <Table className="mt-4">
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Country</TableHead>
                                  <TableHead className="text-right">Conversions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {a.countries.map(c => (
                                  <TableRow key={c.country_code}>
                                    <TableCell>{c.country_name}</TableCell>
                                    <TableCell className="text-right font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">{c.conversions}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      {/* Month-on-Month */}
      {data.monthly.length > 0 && (
        <SectionCard
          className="mb-8"
          title="Month-on-Month"
          description="Monthly referrals, conversions, revenue and commissions"
          open={monthlyExpanded}
          onOpenChange={setMonthlyExpanded}
        >
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <Card className="gap-4">
              <CardHeader><CardTitle className="text-sm">Conversions per Month</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={MONTHLY_COUNT_CONFIG} className="h-[200px] w-full">
                  <BarChart data={data.monthly.map(m => ({ month: new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), conversions: m.conversions, referrals: m.referrals }))} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="conversions" fill="var(--color-conversions)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="referrals" fill="var(--color-referrals)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader><CardTitle className="text-sm">Revenue vs Commissions per Month</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={MONTHLY_MONEY_CONFIG} className="h-[200px] w-full">
                  <BarChart data={data.monthly.map(m => ({ month: new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), revenue: m.revenueCents / 100, commissions: m.commissionCents / 100 }))} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} width={56} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(v, name) => [`$${Number(v).toFixed(2)}`, MONTHLY_MONEY_CONFIG[name as keyof typeof MONTHLY_MONEY_CONFIG]?.label ?? name] as unknown as React.ReactNode} />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="commissions" fill="var(--color-commissions)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">Month</TableHead>
                  <TableHead className="text-right">Referrals</TableHead>
                  <TableHead className="text-right">Conversions</TableHead>
                  <TableHead className="text-right">Conv. Rate</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="px-5 text-right">Commissions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.monthly.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="px-5 font-medium">{new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.referrals.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{m.conversions.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{pct(m.conversions, m.referrals)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmt(m.revenueCents)}</TableCell>
                    <TableCell className="px-5 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmt(m.commissionCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}

      {/* Top Affiliates */}
      <SectionCard
        className="mb-8"
        title="Top Affiliates"
        description="By referrals and by conversions"
        open={topAffiliatesExpanded}
        onOpenChange={setTopAffiliatesExpanded}
      >
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <TopAffiliatesPie title="Top Affiliates by Referrals" data={data.topByReferrals} label="referrals" />
          <TopAffiliatesPie title="Top Affiliates by Conversions" data={data.topByConversions} label="conversions" />
        </div>
      </SectionCard>

      {/* Weekly leaderboard */}
      <SectionCard
        className="mb-8"
        title="Weekly Leaderboard"
        description="Top affiliates by conversions this week (Mon–Sun)"
        open={leaderboardExpanded}
        onOpenChange={setLeaderboardExpanded}
      >
        {data.weeklyLeaderboard.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">No conversions this week yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">Rank</TableHead>
                <TableHead>Affiliate</TableHead>
                <TableHead className="text-right">Conversions This Week</TableHead>
                <TableHead className="px-5 text-right">Referrals This Week</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.weeklyLeaderboard.map((a) => (
                <TableRow key={a.email}>
                  <TableCell className="px-5">
                    <span className={cn(
                      'inline-flex size-7 items-center justify-center rounded-full text-xs font-bold',
                      a.rank === 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' :
                      a.rank === 2 ? 'bg-muted text-muted-foreground' :
                      a.rank === 3 ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300' :
                      'bg-muted/60 text-muted-foreground',
                    )}>{a.rank}</span>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-muted-foreground text-xs">{a.email}</p>
                  </TableCell>
                  <TableCell className="text-right text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{a.conversionsThisWeek}</TableCell>
                  <TableCell className="px-5 text-right font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">{a.referralsThisWeek}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {/* Affiliates table */}
      <SectionCard
        className="mb-8"
        title="Affiliates"
        description="Click any row to see growth details"
        open={affiliatesExpanded}
        onOpenChange={setAffiliatesExpanded}
      >
        {affiliates.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">No affiliates yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1500px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">Affiliate</TableHead>
                  <TableHead title="Total referrals — anyone who clicked ?via=token (visitor + lead + paid)" className="cursor-pointer text-right select-none" onClick={() => handleSort('referrals')}>Clicks<SortIcon col="referrals" /></TableHead>
                  <TableHead title="Subset of clicks who created a Runable account (Rewardful lead + converted)" className="text-right">Signups</TableHead>
                  <TableHead title="Subset of signups who paid (first-time paid subscription = Rewardful 'converted')" className="cursor-pointer text-right select-none" onClick={() => handleSort('conversions')}>Paid<SortIcon col="conversions" /></TableHead>
                  <TableHead title="Clicks today / Paid today" className="text-right">Today</TableHead>
                  <TableHead title="Paid / Clicks (Rewardful conversion rate)" className="text-right">Click→Pay</TableHead>
                  <TableHead title="Median time between sign_up event and first paid subscription (FTS) for users attributed to this affiliate. Short = intercepted intent; long = healthy nurture." className="text-right">Signup→Pay</TableHead>
                  <TableHead title="Similarity of Signup→Pay time to the Google brand-search baseline. 100% = identical to brand-intercept pattern (likely brand bidding); 0% = identical to organic/direct.">vs Google</TableHead>
                  <TableHead className="cursor-pointer text-right select-none" onClick={() => handleSort('revenueCents')}>Revenue<SortIcon col="revenueCents" /></TableHead>
                  <TableHead className="cursor-pointer text-right select-none" onClick={() => handleSort('commissionCents')}>Commission<SortIcon col="commissionCents" /></TableHead>
                  <TableHead title="Rewardful account status (active / inactive)">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affiliates.map((a) => {
                  const tts = ttsByAffiliateId.get(a.id);
                  return (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelectedAffiliate(a)}>
                      <TableCell className="px-5 py-3">
                        <p className="font-medium">{a.name}</p>
                        <p className="text-muted-foreground text-xs">{a.email}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {(a.linkTokens && a.linkTokens.length > 0
                            ? a.linkTokens
                            : a.linkToken ? [{ token: a.linkToken, count: 0 }] : []
                          ).map((lt, i) => (
                            <Badge
                              key={lt.token}
                              asChild
                              variant="secondary"
                              className={cn(
                                'font-mono text-[10px]',
                                i === 0
                                  ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300'
                                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300',
                              )}
                            >
                              <a
                                href={`https://runable.com/?via=${lt.token}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={i === 0 ? `Primary link · ${lt.count} clicks` : `Secondary link · ${lt.count} clicks · investigate`}
                              >
                                ?via={lt.token}{lt.count > 0 ? <span className="opacity-60"> · {lt.count}</span> : null}
                              </a>
                            </Badge>
                          ))}
                          {a.fraudTags.map((t) => (
                            <Badge key={t} variant="destructive" className="text-[10px]">
                              <Flag className="size-2.5" /> {t.replace(/_/g, ' ')}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{a.referrals}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.signups}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{a.conversions}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">{a.referralsToday}</span>
                        <span className="text-muted-foreground mx-0.5">/</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{a.conversionsToday}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{pct(a.conversions, a.referrals)}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', ttsTone(tts?.signupToFtsSecMedian ?? null))}>
                        {tts ? fmtDuration(tts.signupToFtsSecMedian) : (ttsData ? '—' : <Skeleton className="ml-auto h-4 w-10" />)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {tts && tts.googleSimilarity !== null && tts.googleSimilarity !== undefined ? (
                          <div className="flex items-center gap-2">
                            <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                              <div className={cn('h-full', similarityTone(tts.googleSimilarity))} style={{ width: `${Math.round(tts.googleSimilarity * 100)}%` }} />
                            </div>
                            <span className="text-muted-foreground text-[10px] tabular-nums">{Math.round(tts.googleSimilarity * 100)}%</span>
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmt(a.revenueCents)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">{fmt(a.commissionCents)}</TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.status}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* Funnel comparison: Google brand-search baseline vs each affiliate */}
      <SectionCard
        className="mb-8"
        title="Funnel vs Google Brand-Search Baseline"
        description="Pageview → Signup → FTS counts + median Signup→FTS time. Affiliates whose timings match the Google baseline are likely intercepting brand-search intent (brand bidding)."
        open={ttsExpanded}
        onOpenChange={(open) => { if (open && !ttsData) loadTts(); setTtsExpanded(open); }}
      >
        <div className="p-5">
          {/* Date range controls */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Label htmlFor="tts-from" className="text-muted-foreground text-xs">From</Label>
            <Input id="tts-from" type="date" value={ttsFrom} onChange={(e) => setTtsFrom(e.target.value)} className="h-8 w-auto text-xs" />
            <Label htmlFor="tts-to" className="text-muted-foreground text-xs">To</Label>
            <Input id="tts-to" type="date" value={ttsTo} onChange={(e) => setTtsTo(e.target.value)} className="h-8 w-auto text-xs" />
            <Button size="sm" onClick={() => loadTts(ttsFrom, ttsTo)} disabled={ttsLoading}>
              {ttsLoading ? 'Loading…' : 'Recompute'}
            </Button>
            <span className="text-muted-foreground ml-auto text-xs">
              Signup→FTS time: <span className="font-bold text-red-600 dark:text-red-400">red</span> &lt;1h · <span className="font-semibold text-amber-600 dark:text-amber-400">amber</span> &lt;1d · <span className="text-foreground">gray</span> &lt;1w · <span className="text-emerald-600 dark:text-emerald-400">green</span> 1w+
            </span>
          </div>

          {ttsLoading && !ttsData && <Skeleton className="h-64 w-full" />}
          {ttsData?.note && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {ttsData.note}
            </div>
          )}
          {ttsData && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Pageviews</TableHead>
                    <TableHead className="text-right">Signups</TableHead>
                    <TableHead className="text-right">FTS</TableHead>
                    <TableHead className="text-right">PV→Signup</TableHead>
                    <TableHead className="text-right">Signup→FTS</TableHead>
                    <TableHead className="text-right">Signup→FTS time</TableHead>
                    <TableHead>vs Google</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Baseline rows */}
                  {ttsData.baselines.map((r) => (
                    <TableRow key={r.source} className="bg-indigo-50/50 font-medium hover:bg-indigo-50/70 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15">
                      <TableCell>{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.pageviews?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.signups.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.fts.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{r.pvToSignupRate !== null ? `${(r.pvToSignupRate * 100).toFixed(2)}%` : '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{r.signupToFtsRate !== null ? `${(r.signupToFtsRate * 100).toFixed(2)}%` : '—'}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', ttsTone(r.signupToFtsSecMedian))}>{fmtDuration(r.signupToFtsSecMedian)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">—</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="text-muted-foreground pt-4 pb-1 text-xs font-semibold uppercase">
                      Per affiliate (sorted by similarity to Google baseline — highest = most likely intercepting brand search)
                    </TableCell>
                  </TableRow>
                  {ttsData.affiliates.map((a) => (
                    <TableRow key={a.affiliateId}>
                      <TableCell>
                        <p className="text-sm font-medium">{a.label}</p>
                        <p className="text-muted-foreground text-xs">{a.email}</p>
                        {a.linkToken && (
                          <Badge asChild variant="secondary" className="mt-1 bg-indigo-50 font-mono text-[10px] text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
                            <a href={`https://runable.com/?via=${a.linkToken}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              ?via={a.linkToken}
                            </a>
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right">—</TableCell>
                      <TableCell className="text-right tabular-nums">{a.signups}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{a.fts}</TableCell>
                      <TableCell className="text-muted-foreground text-right">—</TableCell>
                      <TableCell className="text-muted-foreground text-right">—</TableCell>
                      <TableCell className={cn('text-right tabular-nums', ttsTone(a.signupToFtsSecMedian))}>{fmtDuration(a.signupToFtsSecMedian)}</TableCell>
                      <TableCell className="text-xs">
                        {a.googleSimilarity !== null && a.googleSimilarity !== undefined ? (
                          <div className="flex items-center gap-2">
                            <div className="bg-muted h-2 w-20 overflow-hidden rounded-full">
                              <div className={cn('h-full', similarityTone(a.googleSimilarity))} style={{ width: `${Math.round(a.googleSimilarity * 100)}%` }} />
                            </div>
                            <span className="text-muted-foreground tabular-nums">{Math.round(a.googleSimilarity * 100)}%</span>
                          </div>
                        ) : <span className="text-muted-foreground">n/a</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {ttsData && ttsData.affiliates.length === 0 && ttsData.baselines.length === 0 && !ttsLoading && (
            <div className="text-muted-foreground py-8 text-center text-sm">No PostHog FTS data for this window.</div>
          )}
        </div>
      </SectionCard>

      {/* Country breakdown */}
      {data.countriesByConversions.length > 0 && (
        <Card className="mb-8 gap-0 overflow-hidden py-0">
          <CardHeader className="[.border-b]:pb-0 gap-1 border-b py-4">
            <CardTitle className="flex items-center text-sm">
              Conversions by Country
              <InfoTooltip text="Country is sourced from PostHog, not Rewardful. Each conversion's customer email (from Rewardful) is matched to a PostHog user via their sign_up event, then the country is taken from that user's $pageview geo data ($geoip_country_code). Conversions without a matching email or pageview show no country." />
            </CardTitle>
            <CardDescription className="text-xs">Top 10 countries by total conversions</CardDescription>
            <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
              <Tabs value={countryView} onValueChange={(v) => setCountryView(v as 'chart' | 'table')}>
                <TabsList>
                  <TabsTrigger value="chart">Chart</TabsTrigger>
                  <TabsTrigger value="table">Table</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {countryView === 'chart' ? (
              <ChartContainer config={COUNTRY_CHART_CONFIG} className="h-[280px] w-full">
                <BarChart data={data.countriesByConversions.slice(0, 10)} margin={{ top: 4, right: 12, left: -18, bottom: 56 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="country_name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} width={44} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="country_name" />} />
                  <Bar dataKey="conversions" fill="var(--color-conversions)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Country</TableHead>
                    <TableHead className="text-right">Conversions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.countriesByConversions.map(r => (
                    <TableRow key={r.country_code}>
                      <TableCell>{r.country_name}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">{r.conversions}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent activity */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="[.border-b]:pb-0 border-b py-4">
          <CardTitle className="text-sm">Recent Webhook Events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentActivity.length === 0 ? (
            <div className="text-muted-foreground p-8 text-center text-sm">No events received yet.</div>
          ) : (
            <div className="divide-y">
              {recentActivity.map((e, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="bg-indigo-50 font-mono text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">{e.event_type}</Badge>
                    <span className="text-muted-foreground font-mono text-xs">{e.event_id}</span>
                  </div>
                  <span className="text-muted-foreground text-xs">{new Date(e.received_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
