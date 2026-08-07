'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight, BadgeDollarSign, CircleAlert, Flag, HandCoins, Megaphone,
  MousePointerClick, Repeat, ShieldCheck, Sparkles, TrendingDown, TrendingUp, UserPlus, Users,
} from 'lucide-react';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis,
} from 'recharts';

import { MonthlySummary } from '@/components/MonthlySummary';
import { DashboardDayChart } from '@/components/DashboardDayChart';
import { useDashboard } from '@/lib/use-dashboard';
import { lsGet, lsSet, trackRefresh } from '@/lib/client-cache';
import { dashboardRangeDescription } from '@/lib/dashboard-range';
import { fmtCents as fmt, pct } from '@/lib/format';
import type { Affiliate } from '@/lib/use-dashboard';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageControls } from '@/components/PageControls';
import { ExpandableRows } from '@/components/ExpandableRows';

/* ---------------------------------- data ---------------------------------- */

interface InsightCounts {
  pageviews: number; signups: number; affiliateSignups: number; googleSignups: number;
  fts: number; affiliateFts: number; ftsZeroInvoice: number; repeatPaid: number;
}
interface Insights {
  current: InsightCounts; previous: InsightCounts; organicSignups: number;
}

interface ChannelStats {
  payers: number; revenue: number; arpu: number; cohort: number; m1: number; m1Rate: number;
}

function useChannels(): Record<string, ChannelStats> | null {
  // Stale-while-revalidate: hydrate synchronously from localStorage (slow
  // HogQL query behind this endpoint), then refresh in the background.
  // Hydrated in the effect (not the useState initializer) to avoid an SSR
  // hydration mismatch — still paints long before the network response.
  const [data, setData] = useState<Record<string, ChannelStats> | null>(null);
  useEffect(() => {
    const cachedChannels = lsGet<Record<string, ChannelStats>>('insights:channels');
    if (cachedChannels) setData(cachedChannels);
    let cancelled = false;
    trackRefresh(fetch('/api/insights/channels', { cache: 'no-store' }))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.channels) return;
        lsSet('insights:channels', j.channels);
        if (!cancelled) setData(j.channels);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return data;
}

const CHANNEL_LABELS: Record<string, string> = {
  affiliate: 'Affiliates', google_ads: 'Google Ads', organic: 'Organic / other',
};

interface LeakToken { token: string; observed: number; tracked: number; leakPct: number; topPath: string }
interface LeakData {
  windowDays: number; totalObserved: number; totalTracked: number; leakPct: number;
  tokens: LeakToken[]; paths: { path: string; signups: number }[];
}

function useLeak(): LeakData | null {
  const [data, setData] = useState<LeakData | null>(null);
  useEffect(() => {
    setData(lsGet<LeakData>('insights:leak'));
    let cancelled = false;
    trackRefresh(fetch('/api/insights/leak', { cache: 'no-store' }))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.tokens) return;
        lsSet('insights:leak', j);
        if (!cancelled) setData(j);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return data;
}

function useInsights(period: string): Insights | null {
  // Stale-while-revalidate keyed by period: cached response paints instantly,
  // the slow HogQL-backed fetch refreshes it in the background.
  // Hydrated in the effect (not the useState initializer) to avoid an SSR
  // hydration mismatch — still paints long before the network response.
  const [data, setData] = useState<Insights | null>(null);
  useEffect(() => {
    setData(lsGet<Insights>(`insights:${period}`));
    let cancelled = false;
    trackRefresh(fetch(`/api/insights?period=${period}`, { cache: 'no-store' }))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.current) return;
        lsSet(`insights:${period}`, j);
        if (!cancelled) setData(j);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [period]);
  return data;
}

/* --------------------------------- helpers -------------------------------- */

function delta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

function TrendBadge({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <Badge
      variant="outline"
      className={`gap-1 rounded-full ps-2 text-xs font-medium ${up
        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}
    >
      {up ? <TrendingUp className="size-3.5 text-green-500" /> : <TrendingDown className="size-3.5 text-red-500" />}
      {up ? '+' : ''}{value.toFixed(1)}%
    </Badge>
  );
}

function StatCard({ label, value, trend, sub, onClick }: {
  label: string; value: string; trend: number | null; sub?: string; onClick?: () => void;
}) {
  return (
    <Card
      className={`w-full gap-0 p-6 py-4 ${onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-0">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
          <TrendBadge value={trend} />
        </div>
        <dd className="text-foreground mt-2 text-3xl font-semibold tabular-nums">{value}</dd>
        {sub ? <p className="text-muted-foreground mt-1 text-xs">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/i.test(code)) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function halvesDelta(series: { usd: number }[]): number | null {
  if (series.length < 4) return null;
  const mid = Math.floor(series.length / 2);
  const a = series.slice(0, mid).reduce((s, d) => s + d.usd, 0);
  const b = series.slice(mid).reduce((s, d) => s + d.usd, 0);
  return delta(b, a);
}

/* ------------------------------ proof dialog ------------------------------ */

type ProofMetric = 'fts' | 'affiliateFts' | 'affiliateSignups';

interface ProofRow {
  account: string; viaToken: string | null; dubAttributed: boolean; gclid: boolean;
  firstTouchUrl: string; at: string; plan: string | null; amountPaid: number | null;
  country: string | null;
}

const PROOF_TITLES: Record<ProofMetric, { title: string; description: string }> = {
  fts: { title: 'First paid (FTS) — the accounts', description: 'Every account whose first-ever paid subscription happened in this window, from PostHog subscription events (isUserFirstPaidPlan = true).' },
  affiliateFts: { title: 'Affiliate FTS — the proof', description: 'First-time paid accounts whose first-touch URL carried an affiliate link (?via=token). The via token shows exactly which affiliate gets credit.' },
  affiliateSignups: { title: 'Affiliate sign-ups — the accounts', description: 'Sign-ups whose first-touch URL carried ?via=token.' },
};

function ProofDialog({ metric, period, onClose }: { metric: ProofMetric; period: string; onClose: () => void }) {
  const [rows, setRows] = useState<ProofRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    trackRefresh(fetch(`/api/insights/proof?metric=${metric}&period=${period}`, { cache: 'no-store' }))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setRows(j?.rows ?? []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [metric, period]);
  const def = PROOF_TITLES[metric];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{def.title}</DialogTitle>
          <DialogDescription>{def.description}</DialogDescription>
        </DialogHeader>
        {!rows ? (
          <div className="grid gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">No accounts in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Attribution</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <p className="max-w-56 truncate text-sm font-medium">{r.account}</p>
                      {r.plan ? <p className="text-muted-foreground text-xs">{r.plan}</p> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.viaToken ? (
                          <Badge variant="outline" className="rounded-full font-mono text-[10px]">via={r.viaToken}</Badge>
                        ) : <span className="text-muted-foreground text-xs">no affiliate link</span>}
                        {r.dubAttributed ? <Badge variant="outline" className="rounded-full border-indigo-300 bg-indigo-50 text-[10px] text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300">dub</Badge> : null}
                        {r.gclid ? <Badge variant="outline" className="rounded-full border-red-300 bg-red-50 text-[10px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">gclid — paid ad</Badge> : null}
                      </div>
                      <p className="text-muted-foreground mt-0.5 max-w-72 truncate text-[10px]" title={r.firstTouchUrl}>{r.firstTouchUrl}</p>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {r.country ? <>{flagEmoji(r.country)} <span className="text-muted-foreground text-xs">{r.country}</span></> : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {r.amountPaid !== null ? `$${r.amountPaid.toFixed(2)}` : '—'}
                      {r.amountPaid === 0 ? <p className="text-muted-foreground text-[10px]">$0 invoice · credit/promo</p> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs whitespace-nowrap">{new Date(r.at + 'Z').toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- metric detail dialog ---------------------------- */

type MetricKey = 'onboarded' | 'signups' | 'fraud' | 'ads' | 'revenue' | 'commissions' | 'conversions';

const METRIC_DETAILS: Record<MetricKey, {
  title: string; description: string; columns: [string, string];
  rows: (affiliates: Affiliate[]) => { name: string; email: string; value: string; tag?: string }[];
}> = {
  onboarded: {
    title: 'Affiliates onboarded today',
    description: 'Everyone who joined since midnight, across Rewardful and Dub.',
    columns: ['Affiliate', 'Joined'],
    rows: (a) => a
      .filter((x) => new Date(x.createdAt) >= new Date(new Date().setHours(0, 0, 0, 0)))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .map((x) => ({ name: x.name, email: x.email, value: new Date(x.createdAt).toLocaleTimeString(), tag: x.source })),
  },
  signups: {
    title: 'Sign-ups by affiliate',
    description: 'Affiliates ranked by attributed sign-ups in the selected window.',
    columns: ['Affiliate', 'Sign-ups'],
    rows: (a) => a.filter((x) => x.signups > 0).sort((x, y) => y.signups - x.signups).slice(0, 100)
      .map((x) => ({ name: x.name, email: x.email, value: x.signups.toLocaleString(), tag: x.source })),
  },
  fraud: {
    title: 'Flagged for fraud',
    description: 'Suspicious status, manual flags, risk ≥ 60, or flagged by Dub.',
    columns: ['Affiliate', 'Signals'],
    rows: (a) => a.filter((x) => x.status === 'suspicious' || x.fraudTags.length > 0)
      .map((x) => ({ name: x.name, email: x.email, value: x.fraudTags.join(', ') || x.status, tag: x.source })),
  },
  ads: {
    title: 'Affiliates running ads',
    description: 'Affiliates whose PostHog signups carry paid-ad click parameters.',
    columns: ['Affiliate', 'Ad-tagged signups'],
    rows: (a) => a.filter((x) => x.adDrivenSignups > 0).sort((x, y) => y.adDrivenSignups - x.adDrivenSignups)
      .map((x) => ({ name: x.name, email: x.email, value: x.adDrivenSignups.toLocaleString(), tag: x.source })),
  },
  revenue: {
    title: 'Revenue by affiliate',
    description: 'Attributed sales revenue in the selected window.',
    columns: ['Affiliate', 'Revenue'],
    rows: (a) => a.filter((x) => x.revenueCents > 0).sort((x, y) => y.revenueCents - x.revenueCents).slice(0, 100)
      .map((x) => ({ name: x.name, email: x.email, value: fmt(x.revenueCents), tag: x.source })),
  },
  commissions: {
    title: 'Commissions by affiliate',
    description: 'Commission liability generated in the selected window.',
    columns: ['Affiliate', 'Commission'],
    rows: (a) => a.filter((x) => x.commissionCents > 0).sort((x, y) => y.commissionCents - x.commissionCents).slice(0, 100)
      .map((x) => ({ name: x.name, email: x.email, value: fmt(x.commissionCents), tag: x.source })),
  },
  conversions: {
    title: 'Paid conversions by affiliate',
    description: 'Affiliates ranked by paid conversions in the selected window.',
    columns: ['Affiliate', 'Conversions'],
    rows: (a) => a.filter((x) => x.conversions > 0).sort((x, y) => y.conversions - x.conversions).slice(0, 100)
      .map((x) => ({ name: x.name, email: x.email, value: x.conversions.toLocaleString(), tag: x.source })),
  },
};

function MetricDetailDialog({ metric, affiliates, onClose }: {
  metric: MetricKey | null; affiliates: Affiliate[]; onClose: () => void;
}) {
  if (!metric) return null;
  const def = METRIC_DETAILS[metric];
  const rows = def.rows(affiliates);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{def.title}</DialogTitle>
          <DialogDescription>{def.description}</DialogDescription>
        </DialogHeader>
        {rows.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Nothing in this window.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{def.columns[0]}</TableHead>
                <TableHead className="text-right">{def.columns[1]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <span className="font-medium">{r.name}</span>
                    {r.tag ? <Badge variant="outline" className="ml-2 text-[10px]">{r.tag}</Badge> : null}
                    <p className="text-muted-foreground text-xs">{r.email}</p>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{r.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- page --------------------------------- */

function RelativeTime({ at }: { at: Date }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      const sec = Math.max(0, Math.floor((Date.now() - at.getTime()) / 1000));
      setLabel(sec < 60 ? 'just now'
        : sec < 3600 ? `${Math.floor(sec / 60)}m ago`
        : sec < 86400 ? `${Math.floor(sec / 3600)}h ago`
        : `${Math.floor(sec / 86400)}d ago`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [at]);
  return <span title={at.toLocaleString()}>{label ?? ''}</span>;
}

const DONUT_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-4)'];

export default function Overview() {
  const { data, loading, lastUpdated, period, refresh } = useDashboard();
  const insights = useInsights(period);
  const channels = useChannels();
  const leak = useLeak();
  const [detailMetric, setDetailMetric] = useState<MetricKey | null>(null);
  const [proofMetric, setProofMetric] = useState<ProofMetric | null>(null);

  if (loading && !data) {
    return (
      <div className="grid gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-[420px]" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">Failed to load data.</p>
        <Button size="sm" onClick={() => refresh()}>Retry</Button>
      </div>
    );
  }

  const { overview, recentActivity } = data;
  const cur = insights?.current;
  const prev = insights?.previous;

  const revenueTrend = halvesDelta(data.charts.dailyRevenue);
  const commissionTrend = halvesDelta(data.charts.dailyCommissions);

  const barData = data.charts.dailyRevenue.slice(-14).map((d) => ({
    day: new Date(d.day).toLocaleDateString('en-US', { weekday: 'short' }),
    usd: d.usd,
  }));

  const donutData = cur ? [
    { name: 'Affiliate', value: cur.affiliateSignups },
    { name: 'Google Ads', value: cur.googleSignups },
    { name: 'Organic / other', value: insights!.organicSignups },
  ] : [];
  const affiliateShare = cur && cur.signups > 0 ? Math.round((cur.affiliateSignups / cur.signups) * 100) : 0;

  const countries = data.countriesByConversions;
  const countryTotal = countries.reduce((s, c) => s + c.conversions, 0);

  const funnel = cur ? [
    { icon: MousePointerClick, label: 'Pageviews', value: cur.pageviews, prev: prev?.pageviews, proof: null },
    { icon: UserPlus, label: 'Sign-ups', value: cur.signups, prev: prev?.signups, proof: null },
    { icon: BadgeDollarSign, label: 'First paid (FTS)', value: cur.fts, prev: prev?.fts, proof: 'fts' as ProofMetric },
    { icon: Sparkles, label: 'Affiliate FTS', value: cur.affiliateFts, prev: prev?.affiliateFts, proof: 'affiliateFts' as ProofMetric },
    { icon: Repeat, label: 'Repeat paid customers', value: cur.repeatPaid, prev: prev?.repeatPaid, proof: null },
  ] : [];

  const unpaidCents = overview.totalCommissionCents - overview.paidCommissionCents;
  const maxMoney = Math.max(overview.totalRevenueCents, 1);

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      {/* Header */}
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Affiliate Analytics</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {dashboardRangeDescription(period)} · Rewardful + Dub + PostHog, verified end to end
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageControls />
          <Button asChild variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
            <Link href="/warroom"><Flag className="size-3.5" /> Review risk <ArrowUpRight className="size-3.5" /></Link>
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Affiliate sign-ups"
          value={(cur?.affiliateSignups ?? overview.totalSignups).toLocaleString()}
          trend={cur && prev ? delta(cur.affiliateSignups, prev.affiliateSignups) : null}
          sub={cur ? `${pct(cur.affiliateSignups, cur.signups)} of ${cur.signups.toLocaleString()} total · ${overview.totalSignups.toLocaleString()} tracked as leads by Rewardful/Dub` : undefined}
          onClick={() => setDetailMetric('signups')}
        />
        <StatCard
          label="Affiliate first paid (FTS)"
          value={(cur?.affiliateFts ?? overview.convertedReferrals).toLocaleString()}
          trend={cur && prev ? delta(cur.affiliateFts, prev.affiliateFts) : null}
          sub={cur ? `${pct(cur.affiliateFts, cur.fts)} of ${cur.fts.toLocaleString()} total FTS · ${overview.convertedReferrals.toLocaleString()} tracked · ${(cur.ftsZeroInvoice ?? 0).toLocaleString()} were $0 invoices` : undefined}
          onClick={() => setDetailMetric('conversions')}
        />
        <StatCard
          label="Affiliate revenue"
          value={fmt(overview.totalRevenueCents)}
          trend={revenueTrend}
          sub="attributed to affiliate links only"
          onClick={() => setDetailMetric('revenue')}
        />
        <StatCard
          label="Commissions"
          value={fmt(overview.totalCommissionCents)}
          trend={commissionTrend}
          sub={`${fmt(overview.totalCommissionCents - overview.paidCommissionCents)} unpaid`}
          onClick={() => setDetailMetric('commissions')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Earning report */}
        <Card className="h-full lg:col-span-12 xl:col-span-8">
          <CardHeader>
            <CardTitle>Earning report</CardTitle>
            <CardDescription>Attributed revenue by day · {dashboardRangeDescription(period).toLowerCase()}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-semibold lg:text-3xl">{fmt(overview.totalRevenueCents)}</div>
                  <TrendBadge value={revenueTrend} />
                </div>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData}>
                      <defs>
                        <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--chart-2)" />
                          <stop offset="95%" stopColor="var(--chart-1)" />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
                      <ChartTooltip
                        cursor={{ fill: 'var(--muted)' }}
                        formatter={(v) => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 'Revenue']}
                        contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                      />
                      <Bar dataKey="usd" fill="url(#revGradient)" radius={[5, 5, 5, 5]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="flex flex-col justify-start space-y-3">
                {[
                  { icon: HandCoins, label: 'Revenue', cents: overview.totalRevenueCents },
                  { icon: BadgeDollarSign, label: 'Commissions', cents: overview.totalCommissionCents },
                  { icon: CircleAlert, label: 'Unpaid commissions', cents: unpaidCents },
                  { icon: Users, label: 'Pending payouts', cents: overview.pendingPayoutCents },
                ].map((row) => (
                  <div key={row.label} className="bg-muted border-border flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-background border-border flex size-8 items-center justify-center rounded-md border">
                          <row.icon className="size-4" />
                        </div>
                        <span className="text-sm">{row.label}</span>
                      </div>
                      <div className="font-semibold tabular-nums">{fmt(row.cents)}</div>
                    </div>
                    <Progress value={Math.min(100, (row.cents / maxMoney) * 100)} className="h-1" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Acquisition donut */}
        <Card className="flex h-full flex-col lg:col-span-12 xl:col-span-4">
          <CardHeader>
            <CardTitle>Sign-up sources</CardTitle>
            <CardDescription>PostHog acquisition split · affiliates vs Google Ads vs organic</CardDescription>
          </CardHeader>
          <CardContent>
            {!cur ? <Skeleton className="mx-auto aspect-square max-h-[220px] w-full rounded-full" /> : (
              <div className="mx-auto aspect-square max-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="95%" strokeWidth={4} stroke="var(--card)">
                      {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i]} />)}
                    </Pie>
                    <ChartTooltip
                      formatter={(v, n) => [Number(v).toLocaleString(), n]}
                      contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    />
                    <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-3xl font-semibold">{affiliateShare}%</text>
                    <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">via affiliates</text>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {cur ? (
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                {donutData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: DONUT_COLORS[i] }} />
                    <span className="text-muted-foreground truncate">{d.name}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="mt-auto grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-3">
            {[
              { icon: Users, label: 'Onboarded today', value: overview.onboardedToday, metric: 'onboarded' as MetricKey, cls: 'border-green-400 bg-green-200 dark:bg-green-900' },
              { icon: ShieldCheck, label: 'Flagged fraud', value: overview.fraudAffiliates, metric: 'fraud' as MetricKey, cls: 'border-orange-400 bg-orange-200 dark:bg-orange-900' },
              { icon: Megaphone, label: 'Running ads (window)', value: overview.adRunningAffiliates, metric: 'ads' as MetricKey, cls: 'border-teal-400 bg-teal-200 dark:bg-teal-900' },
            ].map((f) => (
              <button
                key={f.label}
                onClick={() => setDetailMetric(f.metric)}
                className="hover:bg-muted/60 flex items-center gap-3 rounded-lg p-1.5 text-left transition-colors"
              >
                <div className={`flex size-9 shrink-0 items-center justify-center rounded-full border ${f.cls}`}>
                  <f.icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-muted-foreground truncate text-xs leading-tight whitespace-nowrap">{f.label}</p>
                  <p className="text-base leading-tight font-semibold tabular-nums">{f.value.toLocaleString()}</p>
                </div>
              </button>
            ))}
          </CardFooter>
        </Card>

        {/* Funnel */}
        <Card className="h-full lg:col-span-4">
          <CardHeader>
            <CardTitle>Program funnel</CardTitle>
            <CardDescription>PostHog · vs previous window</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!cur ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />) : funnel.map((row) => (
              <div
                key={row.label}
                className={`flex items-center rounded-lg p-1 -m-1 ${row.proof ? 'hover:bg-muted/60 cursor-pointer transition-colors' : ''}`}
                onClick={row.proof ? () => setProofMetric(row.proof) : undefined}
                role={row.proof ? 'button' : undefined}
                title={row.proof ? 'Click to see the accounts behind this number' : undefined}
              >
                <div className="bg-muted flex size-10 items-center justify-center rounded-md border">
                  <row.icon className="size-4" />
                </div>
                <p className="ml-4 text-sm">{row.label}{row.proof ? <span className="text-muted-foreground ml-1.5 text-[10px]">· proof</span> : null}</p>
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-sm tabular-nums">{row.value.toLocaleString()}</span>
                  <div className="w-16 text-end"><TrendBadge value={delta(row.value, row.prev ?? 0)} /></div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Countries */}
        <Card className="h-full lg:col-span-4">
          <CardHeader>
            <CardTitle>Conversions by country</CardTitle>
            <CardDescription>{dashboardRangeDescription(period)} · geo from PostHog</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {countries.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">No attributed country data in this window yet.</p>
            ) : (
              <ExpandableRows
                items={countries}
                preview={5}
                perPage={10}
                label="countries"
                render={(rows) => (
                  <div className="space-y-5">
                    {rows.map((c) => (
                      <div key={c.country_code} className="flex items-center">
                        <span className="text-2xl">{flagEmoji(c.country_code)}</span>
                        <div className="ml-4 min-w-0 flex-1 space-y-1">
                          <p className="text-sm leading-none font-medium">{c.country_name}</p>
                          <Progress value={countryTotal ? (c.conversions / countryTotal) * 100 : 0} className="h-1" />
                        </div>
                        <div className="ms-auto pl-4 font-medium tabular-nums">{c.conversions.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                )}
              />
            )}
          </CardContent>
        </Card>

        {/* Conversion snapshot */}
        <Card className="h-full lg:col-span-4">
          <CardHeader>
            <CardTitle>Conversion snapshot</CardTitle>
            <CardDescription>Attributed program performance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {[
                { v: overview.totalReferrals.toLocaleString(), l: 'Clicks' },
                { v: overview.totalSignups.toLocaleString(), l: 'Sign-ups' },
                { v: overview.convertedReferrals.toLocaleString(), l: 'Paid' },
                { v: pct(overview.convertedReferrals, overview.totalReferrals), l: 'Click → paid' },
                { v: overview.earningAffiliates.toLocaleString(), l: 'Earning affiliates' },
                { v: overview.earningAffiliates > 0 ? fmt(overview.totalRevenueCents / overview.earningAffiliates) : '$0.00', l: 'Avg revenue / earner' },
              ].map((x) => (
                <div key={x.l} className="flex items-center gap-3">
                  <Badge variant="secondary" className="border-border w-16 justify-center rounded-full border tabular-nums">{x.v}</Badge>
                  <span className="text-sm">{x.l}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex h-4 w-full overflow-hidden rounded-md">
              <span className="bg-[var(--chart-1)]" style={{ width: `${Math.max(4, affiliateShare)}%` }} />
              <span className="bg-[var(--chart-2)]" style={{ width: `${100 - Math.max(4, affiliateShare)}%` }} />
            </div>
            <p className="text-muted-foreground mt-2 text-xs">Affiliate share of all sign-ups vs other channels</p>
          </CardContent>
        </Card>
      </div>

      {/* Channel economics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ARPU per channel</CardTitle>
            <CardDescription>Revenue per paying customer · last 30 days · from PostHog payment events</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!channels ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />) : (() => {
              const rows = Object.entries(channels).sort((a, b) => b[1].arpu - a[1].arpu);
              const maxArpu = Math.max(...rows.map(([, c]) => c.arpu), 1);
              return rows.map(([ch, c]) => (
                <div key={ch} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className={ch === 'affiliate' ? 'font-semibold' : ''}>{CHANNEL_LABELS[ch] ?? ch}</span>
                    <span className="tabular-nums">
                      <span className="font-semibold">${c.arpu.toFixed(2)}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{c.payers.toLocaleString()} payers · ${Math.round(c.revenue).toLocaleString()}</span>
                    </span>
                  </div>
                  <Progress value={(c.arpu / maxArpu) * 100} className="h-2" />
                </div>
              ));
            })()}
            {channels?.affiliate && channels?.google_ads ? (
              <p className="text-muted-foreground text-xs">
                An affiliate-acquired payer is worth {channels.affiliate.arpu > channels.google_ads.arpu
                  ? `${((channels.affiliate.arpu / channels.google_ads.arpu - 1) * 100).toFixed(0)}% more`
                  : `${((1 - channels.affiliate.arpu / channels.google_ads.arpu) * 100).toFixed(0)}% less`} than a Google Ads payer.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retention per channel</CardTitle>
            <CardDescription>M1 = first-time payers who paid again in days 30–60 · cohort from 30–90 days ago</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!channels ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />) : (() => {
              const rows = Object.entries(channels).filter(([, c]) => c.cohort > 0).sort((a, b) => b[1].m1Rate - a[1].m1Rate);
              const maxRate = Math.max(...rows.map(([, c]) => c.m1Rate), 0.1);
              return rows.map(([ch, c]) => (
                <div key={ch} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className={ch === 'affiliate' ? 'font-semibold' : ''}>{CHANNEL_LABELS[ch] ?? ch}</span>
                    <span className="tabular-nums">
                      <span className="font-semibold">{c.m1Rate.toFixed(1)}%</span>
                      <span className="text-muted-foreground ml-2 text-xs">{c.m1.toLocaleString()} of {c.cohort.toLocaleString()} retained</span>
                    </span>
                  </div>
                  <Progress value={(c.m1Rate / maxRate) * 100} className="h-2" />
                </div>
              ));
            })()}
            <p className="text-muted-foreground text-xs">
              Second-payment retention by acquisition channel — compare quality, not just volume.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Attribution leak */}
      <Card>
        <CardHeader>
          <CardTitle>Attribution health</CardTitle>
          <CardDescription>
            Sign-ups PostHog observed arriving through affiliate links vs sign-ups the Rewardful/Dub tracking actually recorded · last {leak?.windowDays ?? 30} days · every untracked sign-up is credit an affiliate never receives
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!leak ? <Skeleton className="h-32 w-full" /> : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="bg-muted border-border rounded-md border p-4">
                  <p className="text-muted-foreground text-sm">Observed via affiliate links</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{leak.totalObserved.toLocaleString()}</p>
                </div>
                <div className="bg-muted border-border rounded-md border p-4">
                  <p className="text-muted-foreground text-sm">Tracked by Rewardful/Dub</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{leak.totalTracked.toLocaleString()}</p>
                </div>
                <div className="rounded-md border border-red-300 bg-linear-to-tr from-red-200/40 to-red-100/40 p-4 dark:border-red-950 dark:from-red-950/40 dark:to-red-900/40">
                  <p className="text-muted-foreground text-sm">Attribution leak</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{leak.leakPct.toFixed(1)}%</p>
                </div>
              </div>
              <ExpandableRows
                items={leak.tokens.filter((t) => t.observed >= 5)}
                preview={5}
                perPage={10}
                label="tokens"
                render={(rows: LeakToken[]) => (
                  <div className="space-y-3">
                    {rows.map((t) => (
                      <div key={t.token} className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2">
                            <Badge variant="outline" className="rounded-full font-mono text-[10px]">via={t.token}</Badge>
                            <span className="text-muted-foreground max-w-48 truncate text-xs">lands on {t.topPath}</span>
                          </span>
                          <span className="tabular-nums">
                            <span className="font-semibold">{t.observed.toLocaleString()}</span>
                            <span className="text-muted-foreground text-xs"> observed · </span>
                            <span className="font-semibold">{t.tracked.toLocaleString()}</span>
                            <span className="text-muted-foreground text-xs"> tracked · </span>
                            <span className={t.leakPct > 50 ? 'font-semibold text-red-600 dark:text-red-400' : 'font-semibold'}>{t.leakPct.toFixed(0)}% lost</span>
                          </span>
                        </div>
                        <Progress value={100 - t.leakPct} className="h-1" />
                      </div>
                    ))}
                  </div>
                )}
              />
              <p className="text-muted-foreground border-t pt-3 text-xs">
                Top landing paths for affiliate traffic: {leak.paths.slice(0, 5).map((p) => `${p.path} (${p.signups.toLocaleString()})`).join(' · ')}.
                Pages missing the Rewardful snippet, cookie-consent blocking, and ad-blockers are the usual causes of loss.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <MonthlySummary compact />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DashboardDayChart title="New affiliates" dataKey="dailyAffiliates" bars={[{ key: 'count', color: 'var(--chart-1)', label: 'New affiliates' }]} />
        <DashboardDayChart
          title="Referrals & conversions"
          dataKey="dailyReferrals"
          bars={[
            { key: 'total', color: 'var(--chart-10)', label: 'Referrals', axis: 'left' },
            { key: 'converted', color: 'var(--chart-2)', label: 'Conversions', axis: 'right' },
          ]}
        />
      </div>

      {/* Recent activity */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="[.border-b]:pb-0 flex-row items-center justify-between border-b py-4">
          <CardTitle className="text-sm">Live events</CardTitle>
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href="/events">View all <ArrowUpRight className="size-3.5" /></Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {recentActivity.length === 0 ? (
            <div className="text-muted-foreground p-8 text-center text-sm">No events received yet.</div>
          ) : (
            <ExpandableRows
              items={recentActivity}
              preview={5}
              perPage={10}
              label="events"
              render={(rows) => (
                <div className="divide-y">
                  {rows.map((e, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Badge variant="secondary" className="font-mono">{e.event_type}</Badge>
                        <span className="text-muted-foreground hidden truncate font-mono text-xs sm:inline">{e.event_id}</span>
                      </div>
                      <span className="text-muted-foreground shrink-0 text-xs">{new Date(e.received_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-right text-[11px]">
        {lastUpdated ? <>Computed <RelativeTime at={lastUpdated} /></> : null}
      </p>

      <MetricDetailDialog metric={detailMetric} affiliates={data.affiliates} onClose={() => setDetailMetric(null)} />
      {proofMetric ? <ProofDialog metric={proofMetric} period={period} onClose={() => setProofMetric(null)} /> : null}
    </div>
  );
}
