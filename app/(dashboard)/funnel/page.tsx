'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarRange,
  CircleGauge,
  Clock3,
  Database,
  GitCompareArrows,
  MousePointerClick,
  Search,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
  UserPlus,
  Waypoints,
} from 'lucide-react';

import { type FunnelRow, type TtsResponse } from '@/lib/use-dashboard';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { fmtDuration, ttsTone } from '@/lib/format';
import { memGet, memSet, lsGet, lsSet, trackRefresh } from '@/lib/client-cache';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageControls } from '@/components/PageControls';
import { ExpandableRows } from '@/components/ExpandableRows';

type ReviewFilter = 'all' | 'high' | 'review' | 'insufficient';

const cacheKey = (from: string, to: string) => `funnel:tts:${from}|${to}`;

function formatDay(value: string | null | undefined) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

function formatRate(value: number | null) {
  return value === null ? 'Not measurable' : `${(value * 100).toFixed(2)}%`;
}

function priorityFor(row: FunnelRow) {
  const score = row.googleSimilarity;
  if (score === null || score === undefined) {
    return { label: 'Insufficient timing', cls: 'text-muted-foreground' };
  }
  if (score >= 0.8) {
    return { label: 'High priority', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };
  }
  if (score >= 0.5) {
    return { label: 'Review', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' };
  }
  return { label: 'Lower similarity', cls: 'text-muted-foreground' };
}

/** Tiny inline SVG donut: pageviews → signups → first subscriptions at a glance. */
function MiniFunnelDonut({ pageviews, signups, fts }: { pageviews: number | null; signups: number; fts: number }) {
  const total = Math.max(pageviews ?? signups, 1);
  const segments = [
    { value: fts, color: 'var(--chart-2)' },
    { value: Math.max(0, signups - fts), color: 'var(--chart-1)' },
    { value: Math.max(0, total - signups), color: 'var(--muted)' },
  ];
  const sum = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 15.9155; // circumference = 100
  let offset = 25;
  return (
    <svg viewBox="0 0 36 36" className="size-10 shrink-0" role="img" aria-label="Acquisition funnel share">
      {segments.map((seg, i) => {
        const len = (seg.value / sum) * 100;
        const el = (
          <circle
            key={i}
            cx="18" cy="18" r={r} fill="none"
            stroke={seg.color} strokeWidth="5"
            strokeDasharray={`${len} ${100 - len}`}
            strokeDashoffset={offset}
          />
        );
        offset -= len;
        return el;
      })}
      <text x="18" y="19.5" textAnchor="middle" className="fill-foreground text-[8px] font-semibold">
        {pageviews && pageviews > 0 ? `${Math.min(99, Math.round((signups / pageviews) * 100))}%` : '—'}
      </text>
    </svg>
  );
}

function SourceFlow({ row, accent }: { row: FunnelRow; accent: 'google' | 'rest' }) {
  const coverageGap = row.pageviews !== null && row.signups > row.pageviews;
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{row.label.replace('🎯 ', '')}</h3>
        <Badge variant={accent === 'google' ? 'default' : 'outline'}>
          {accent === 'google' ? 'Comparison baseline' : 'All other acquisition'}
        </Badge>
      </div>
      <p className="text-muted-foreground text-xs">
        {accent === 'google'
          ? 'Initial UTM source google_ads or googleads, with campaign exactly brand.'
          : 'Every PostHog acquisition source outside the Google brand definition.'}
      </p>
      {[
        { icon: MousePointerClick, label: 'Pageviews', value: row.pageviews, rate: null },
        { icon: UserPlus, label: 'Signups', value: row.signups, rate: row.pvToSignupRate },
        { icon: BadgeDollarSign, label: 'First subscriptions', value: row.fts, rate: row.signupToFtsRate },
      ].map((step) => (
        <div key={step.label} className="flex items-center">
          <div className="bg-muted flex size-9 items-center justify-center rounded-md border">
            <step.icon className="size-4" />
          </div>
          <p className="ml-3 text-sm">{step.label}</p>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm font-medium tabular-nums">{step.value?.toLocaleString() ?? '—'}</span>
            {step.rate !== null && step.rate !== undefined ? (
              <Badge variant="outline" className="rounded-full text-xs font-medium tabular-nums">{formatRate(step.rate)}</Badge>
            ) : null}
          </div>
        </div>
      ))}
      <div className="bg-muted border-border flex items-center justify-between gap-4 rounded-md border p-3">
        <div className="flex items-center gap-3">
          <TimerReset className="size-4" />
          <span className="text-sm">Median time to subscribe</span>
        </div>
        <span className={cn('font-semibold tabular-nums', ttsTone(row.signupToFtsSecMedian))}>{fmtDuration(row.signupToFtsSecMedian)}</span>
      </div>
      {coverageGap ? (
        <div className="flex gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Signup events exceed captured pageviews in this window, so the first conversion rate is intentionally not reported.</span>
        </div>
      ) : null}
    </div>
  );
}

export default function FunnelPage() {
  const { range: globalRange, refreshVersion } = useDashboardRange();
  const presetDates = useMemo(() => {
    const to = new Date();
    const from = globalRange === 'all'
      ? new Date('2025-01-01T00:00:00Z')
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - (Number.parseInt(globalRange, 10) - 1) * 86_400_000);
    const day = (value: Date) => value.toISOString().slice(0, 10);
    return { from: day(from), to: day(new Date(to.getTime() + 86_400_000)) };
  }, [globalRange]);

  // Stale-while-revalidate: paint cached data on the first render, refresh in
  // the background. memGet covers client-side navigations synchronously;
  // lsGet covers hard reloads.
  const [ttsData, setTtsData] = useState<TtsResponse | null>(() =>
    memGet<TtsResponse>(cacheKey(presetDates.from, presetDates.to))
    ?? lsGet<TtsResponse>(cacheKey(presetDates.from, presetDates.to)),
  );
  const [ttsLoading, setTtsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [ttsFrom, setTtsFrom] = useState(presetDates.from);
  const [ttsTo, setTtsTo] = useState(presetDates.to);
  const [windowOpen, setWindowOpen] = useState(false);

  useEffect(() => {
    setTtsFrom(presetDates.from);
    setTtsTo(presetDates.to);
    const controller = new AbortController();
    loadTts(presetDates.from, presetDates.to, controller.signal);
    return () => controller.abort();
    // refreshVersion deliberately re-runs the selected funnel window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetDates.from, presetDates.to, refreshVersion]);

  async function loadTts(from = ttsFrom, to = ttsTo, signal?: AbortSignal) {
    const key = cacheKey(from, to);
    const cached = memGet<TtsResponse>(key) ?? lsGet<TtsResponse>(key);
    if (cached) {
      // Show the cached window instantly and revalidate silently.
      setTtsData(cached);
      setTtsLoading(false);
      setRefreshing(true);
    } else {
      setTtsLoading(true);
    }
    setError(null);
    try {
      const response = await trackRefresh(fetch(`/api/affiliates/tts?from=${from}&to=${to}`, { signal, cache: 'no-store' }));
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error ?? `Funnel request failed (${response.status})`);
      setTtsData(json);
      memSet(key, json);
      lsSet(key, json);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Unable to load PostHog funnel data');
    } finally {
      setTtsLoading(false);
      setRefreshing(false);
    }
  }

  const counts = useMemo(() => {
    const affiliates = ttsData?.affiliates ?? [];
    return {
      high: affiliates.filter((row) => (row.googleSimilarity ?? -1) >= 0.8).length,
      review: affiliates.filter((row) => (row.googleSimilarity ?? -1) >= 0.5 && (row.googleSimilarity ?? -1) < 0.8).length,
      insufficient: affiliates.filter((row) => row.googleSimilarity === null || row.googleSimilarity === undefined).length,
    };
  }, [ttsData]);

  const filteredAffiliates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (ttsData?.affiliates ?? []).filter((row) => {
      const score = row.googleSimilarity;
      const matchesFilter = reviewFilter === 'all'
        || (reviewFilter === 'high' && (score ?? -1) >= 0.8)
        || (reviewFilter === 'review' && (score ?? -1) >= 0.5 && (score ?? -1) < 0.8)
        || (reviewFilter === 'insufficient' && (score === null || score === undefined));
      if (!matchesFilter) return false;
      if (!query) return true;
      const haystack = [
        row.label,
        row.email,
        row.linkToken,
        ...(row.countries ?? []).flatMap((country) => [country.name, country.code]),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [reviewFilter, search, ttsData]);
  const invalidWindow = !ttsFrom || !ttsTo || ttsFrom >= ttsTo;

  const googleMedian = ttsData?.overall.googleSignupToFtsSecMedian ?? null;

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="max-w-3xl">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 rounded-full"><Waypoints className="size-3" /> Acquisition intelligence</Badge>
            <Badge variant="secondary" className="rounded-full">Signal, not proof</Badge>
          </div>
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Funnel vs Google baseline</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Real Google brand-ad customers subscribe about {googleMedian !== null ? fmtDuration(googleMedian) : 'a fixed interval'} after
            signup. Affiliates whose customers show the same timing are probably running ads on our brand and taking commission credit.
          </p>
        </div>
        <PageControls />
      </div>

      {/* Analysis window — compact, right-aligned above the verdict row. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {refreshing ? <span className="text-muted-foreground text-xs">Refreshing…</span> : null}
        <Popover open={windowOpen} onOpenChange={setWindowOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs">
              <CalendarRange className="size-3.5" />
              {formatDay(ttsFrom)} – {formatDay(ttsTo)}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tts-from" className="text-xs">Start date</Label>
              <Input id="tts-from" type="date" value={ttsFrom} onChange={(event) => setTtsFrom(event.target.value)} className="h-9 w-44 text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tts-to" className="text-xs">End date <span className="font-normal text-muted-foreground">(exclusive)</span></Label>
              <Input id="tts-to" type="date" value={ttsTo} onChange={(event) => setTtsTo(event.target.value)} className="h-9 w-44 text-xs" />
            </div>
            {invalidWindow ? <p className="text-destructive text-xs">End date must be after the start date.</p> : null}
            <Button size="sm" className="w-full" disabled={ttsLoading || refreshing || invalidWindow} onClick={() => { setWindowOpen(false); loadTts(ttsFrom, ttsTo); }}>
              {ttsLoading || refreshing ? 'Recomputing…' : 'Recompute analysis'}
            </Button>
            <p className="text-muted-foreground text-xs">Changing the global range updates this window automatically.</p>
          </PopoverContent>
        </Popover>
      </div>

      {!ttsData ? (
        <div className="grid gap-4" aria-label="Loading funnel analysis" aria-live="polite">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
          </div>
          <Skeleton className="h-80" />
          <Skeleton className="h-[420px]" />
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-3 rounded-md border border-red-500/25 bg-red-500/5 p-4 text-sm text-red-800 dark:text-red-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0"><p className="font-medium">PostHog funnel query failed</p><p className="mt-1 break-words text-xs opacity-80">{error}</p></div>
        </div>
      ) : null}

      {ttsData ? (
        <>
          {ttsData.note ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-4 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />{ttsData.note}
            </div>
          ) : null}

          {/* Verdict row — answers "is anyone cheating?" at a glance. */}
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: counts.high > 0 ? ShieldAlert : ShieldCheck,
                label: 'High-priority cohorts',
                value: counts.high > 0 ? counts.high.toLocaleString() : 'None found',
                valueCls: counts.high > 0 ? 'text-red-700 dark:text-red-400' : '',
                cardCls: counts.high > 0 ? 'border-red-500/30 bg-red-500/5' : '',
                sub: counts.high > 0 ? '80%+ timing similarity; review first' : 'No cohort matches Google-ad timing right now',
              },
              { icon: TimerReset, label: 'Google median time', value: fmtDuration(ttsData.overall.googleSignupToFtsSecMedian), valueCls: ttsTone(ttsData.overall.googleSignupToFtsSecMedian), cardCls: '', sub: `${ttsData.overall.googleFts.toLocaleString()} timed subscriptions` },
              { icon: Clock3, label: 'Non-brand median time', value: fmtDuration(ttsData.overall.restSignupToFtsSecMedian), valueCls: ttsTone(ttsData.overall.restSignupToFtsSecMedian), cardCls: '', sub: `${ttsData.overall.restFts.toLocaleString()} timed subscriptions` },
              { icon: Database, label: 'Token attribution coverage', value: ttsData.quality.tokenCoveragePct === null ? '—' : `${(ttsData.quality.tokenCoveragePct * 100).toFixed(1)}%`, valueCls: '', cardCls: '', sub: `${ttsData.quality.resolvedTokens.toLocaleString()} of ${ttsData.quality.materializedTokens.toLocaleString()} observed tokens resolved` },
            ].map((stat) => (
              <Card key={stat.label} className={cn('w-full gap-0 p-6 py-4', stat.cardCls)}>
                <CardContent className="p-0">
                  <dt className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium"><stat.icon className="size-3.5" /> {stat.label}</dt>
                  <dd className={cn('text-foreground mt-2 text-3xl font-semibold tabular-nums', stat.valueCls)}>{stat.value}</dd>
                  <p className="text-muted-foreground mt-1 text-xs">{stat.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="bg-muted border-border text-muted-foreground flex flex-wrap items-center gap-2 rounded-md border px-4 py-3 text-xs">
            <CircleGauge className="size-4 text-foreground" />
            <span>PostHog materialized through <strong className="font-medium text-foreground">{formatDay(ttsData.quality.dataThrough)}</strong></span>
            <span aria-hidden="true">·</span>
            <span>{ttsData.quality.timingRows.toLocaleString()} raw timing rows</span>
            <span aria-hidden="true">·</span>
            <span>{ttsData.quality.affiliateTimingMatches.toLocaleString()} matched to affiliate emails</span>
          </div>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-sm">Source funnel comparison</CardTitle>
              <CardDescription className="text-xs">Same reporting window and event definitions, shown as acquisition flows.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-0 p-0 lg:grid-cols-2 lg:divide-x max-lg:divide-y">
              {ttsData.baselines.map((row) => <SourceFlow key={row.source} row={row} accent={row.source === 'google' ? 'google' : 'rest'} />)}
            </CardContent>
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm"><GitCompareArrows className="size-4" /> Affiliate review queue</CardTitle>
                  <CardDescription className="mt-1 text-xs">Sorted by Google timing similarity, then attributed first subscriptions. Open the War Room before enforcement.</CardDescription>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search affiliate, email, token, country…"
                    aria-label="Search affiliate review queue"
                    className="h-9 pl-9 text-xs"
                  />
                </div>
              </div>
              <Tabs value={reviewFilter} onValueChange={(value) => setReviewFilter(value as ReviewFilter)} className="mt-3 overflow-x-auto">
                <TabsList>
                  <TabsTrigger value="all">All <span className="tabular-nums">{ttsData.affiliates.length}</span></TabsTrigger>
                  <TabsTrigger value="high">High priority <span className="tabular-nums">{counts.high}</span></TabsTrigger>
                  <TabsTrigger value="review">Review <span className="tabular-nums">{counts.review}</span></TabsTrigger>
                  <TabsTrigger value="insufficient">Insufficient data <span className="tabular-nums">{counts.insufficient}</span></TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="p-0">
              <ExpandableRows
                items={filteredAffiliates}
                preview={5}
                perPage={10}
                label="affiliate cohorts"
                render={(rows) => (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[1060px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[260px]">Affiliate</TableHead>
                          <TableHead className="w-[180px]">Acquisition</TableHead>
                          <TableHead className="w-[180px]">Paid outcome</TableHead>
                          <TableHead className="w-[130px]">Median time</TableHead>
                          <TableHead className="w-[210px]">Similarity signal</TableHead>
                          <TableHead>Top markets</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((affiliate) => {
                          const priority = priorityFor(affiliate);
                          return (
                            <TableRow key={affiliate.affiliateId}>
                              <TableCell className="align-top">
                                <p className="font-medium">{affiliate.label}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{affiliate.email || 'No email recorded'}</p>
                                {affiliate.linkToken ? <Badge variant="secondary" className="mt-2 font-mono text-[10px]">?via={affiliate.linkToken}</Badge> : null}
                              </TableCell>
                              <TableCell className="align-top text-xs">
                                <div className="flex items-start gap-3">
                                  <MiniFunnelDonut pageviews={affiliate.pageviews} signups={affiliate.signups} fts={affiliate.fts} />
                                  <div className="min-w-0 flex-1">
                                    <p><span className="text-muted-foreground">Pageviews</span> <strong className="float-right font-medium tabular-nums">{affiliate.pageviews?.toLocaleString() ?? '—'}</strong></p>
                                    <p className="mt-1"><span className="text-muted-foreground">Signups</span> <strong className="float-right font-medium tabular-nums">{affiliate.signups.toLocaleString()}</strong></p>
                                    <p className="mt-1"><span className="text-muted-foreground">PV → signup</span> <strong className="float-right font-medium tabular-nums">{formatRate(affiliate.pvToSignupRate)}</strong></p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="align-top text-xs">
                                <p><span className="text-muted-foreground">First subscriptions</span> <strong className="float-right font-medium tabular-nums">{affiliate.fts.toLocaleString()}</strong></p>
                                <p className="mt-1"><span className="text-muted-foreground">Signup → subscription</span> <strong className="float-right font-medium tabular-nums">{formatRate(affiliate.signupToFtsRate)}</strong></p>
                              </TableCell>
                              <TableCell className={cn('align-top font-medium tabular-nums', ttsTone(affiliate.signupToFtsSecMedian))}>{fmtDuration(affiliate.signupToFtsSecMedian)}</TableCell>
                              <TableCell className="align-top">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className={cn('rounded-full text-xs font-medium', priority.cls)}>{priority.label}</Badge>
                                  {affiliate.googleSimilarity !== null && affiliate.googleSimilarity !== undefined ? <span className="text-muted-foreground text-xs tabular-nums">{Math.round(affiliate.googleSimilarity * 100)}%</span> : null}
                                </div>
                                {affiliate.googleSimilarity !== null && affiliate.googleSimilarity !== undefined ? (
                                  <Progress value={Math.round(affiliate.googleSimilarity * 100)} className="mt-2 h-1.5 max-w-32" />
                                ) : <p className="text-muted-foreground mt-2 text-[11px]">Needs at least two matched timing events.</p>}
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="flex max-w-64 flex-wrap gap-1">
                                  {(affiliate.countries ?? []).slice(0, 3).map((country) => <Badge key={`${affiliate.affiliateId}-${country.code}`} variant="outline" className="rounded-full font-normal">{country.name} <span className="text-muted-foreground ml-1 tabular-nums">{country.count}</span></Badge>)}
                                  {(affiliate.countries ?? []).length === 0 ? <span className="text-xs text-muted-foreground">No converted-country data</span> : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              />
              {filteredAffiliates.length === 0 ? (
                <div className="grid place-items-center gap-2 px-6 py-12 text-center">
                  <p className="text-sm font-medium">No affiliates match these filters</p>
                  <p className="text-xs text-muted-foreground">Try a different priority tab or clear the search.</p>
                  <Button variant="outline" size="sm" onClick={() => { setSearch(''); setReviewFilter('all'); }}>Reset filters</Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
