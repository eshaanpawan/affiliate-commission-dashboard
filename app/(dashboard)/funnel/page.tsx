'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CircleGauge,
  Clock3,
  Database,
  GitCompareArrows,
  Search,
  ShieldAlert,
  TimerReset,
  Waypoints,
} from 'lucide-react';

import { paginate, type FunnelRow, type TtsResponse } from '@/lib/use-dashboard';
import { type DashboardRange } from '@/lib/dashboard-range';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ChartRangeTabs } from '@/components/RangeTabs';
import { Pager } from '@/components/Pager';
import { fmtDuration, similarityTone, ttsTone } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PER_PAGE = 20;
type ReviewFilter = 'all' | 'high' | 'review' | 'insufficient';

function formatDay(value: string | null | undefined) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

function formatRate(value: number | null) {
  return value === null ? 'Not measurable' : `${(value * 100).toFixed(2)}%`;
}

function priorityFor(row: FunnelRow) {
  const score = row.googleSimilarity;
  if (score === null || score === undefined) return { label: 'Insufficient timing', tone: 'secondary' as const };
  if (score >= 0.8) return { label: 'High priority', tone: 'destructive' as const };
  if (score >= 0.5) return { label: 'Review', tone: 'outline' as const };
  return { label: 'Lower similarity', tone: 'secondary' as const };
}

function SourceFlow({ row, accent }: { row: FunnelRow; accent: 'google' | 'rest' }) {
  const coverageGap = row.pageviews !== null && row.signups > row.pageviews;
  return (
    <Card className={cn('gap-4', accent === 'google' && 'ring-foreground/20')}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">{row.label.replace('🎯 ', '')}</CardTitle>
          <Badge variant={accent === 'google' ? 'default' : 'outline'}>
            {accent === 'google' ? 'Comparison baseline' : 'All other acquisition'}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          {accent === 'google'
            ? 'Initial UTM source google_ads or googleads, with campaign exactly brand.'
            : 'Every PostHog acquisition source outside the Google brand definition.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
          {[
            { label: 'Pageviews', value: row.pageviews },
            { label: 'Signups', value: row.signups },
            { label: 'First subscriptions', value: row.fts },
          ].map((item, index) => (
            <div key={item.label} className="contents">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-[11px] text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{item.value?.toLocaleString() ?? '—'}</p>
              </div>
              {index < 2 ? <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div><span className="text-muted-foreground">Pageview → signup</span><p className="mt-0.5 font-medium tabular-nums">{formatRate(row.pvToSignupRate)}</p></div>
          <div><span className="text-muted-foreground">Signup → subscription</span><p className="mt-0.5 font-medium tabular-nums">{formatRate(row.signupToFtsRate)}</p></div>
          <div><span className="text-muted-foreground">Median time to subscribe</span><p className={cn('mt-0.5 font-medium tabular-nums', ttsTone(row.signupToFtsSecMedian))}>{fmtDuration(row.signupToFtsSecMedian)}</p></div>
        </div>
        {coverageGap ? (
          <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>Signup events exceed captured pageviews in this window, so the first conversion rate is intentionally not reported.</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function FunnelPage() {
  const { range: globalRange, refreshVersion } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const [ttsData, setTtsData] = useState<TtsResponse | null>(null);
  const [ttsLoading, setTtsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [page, setPage] = useState(1);
  const effectiveRange = rangeOverride ?? globalRange;
  const presetDates = useMemo(() => {
    const to = new Date();
    const from = effectiveRange === 'all'
      ? new Date('2025-01-01T00:00:00Z')
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - (Number.parseInt(effectiveRange, 10) - 1) * 86_400_000);
    const day = (value: Date) => value.toISOString().slice(0, 10);
    return { from: day(from), to: day(new Date(to.getTime() + 86_400_000)) };
  }, [effectiveRange]);
  const [ttsFrom, setTtsFrom] = useState(presetDates.from);
  const [ttsTo, setTtsTo] = useState(presetDates.to);

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
    setTtsLoading(true);
    setError(null);
    setTtsData(null);
    try {
      const response = await fetch(`/api/affiliates/tts?from=${from}&to=${to}`, { signal, cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error ?? `Funnel request failed (${response.status})`);
      setTtsData(json);
      setPage(1);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Unable to load PostHog funnel data');
    } finally {
      setTtsLoading(false);
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
  const paged = paginate(filteredAffiliates, page, PER_PAGE);
  const invalidWindow = !ttsFrom || !ttsTo || ttsFrom >= ttsTo;

  return (
    <div className="mx-auto grid w-full max-w-[112rem] gap-6 px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5"><Waypoints className="size-3" /> Acquisition intelligence</Badge>
            <Badge variant="secondary">Signal, not proof</Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Funnel vs Google baseline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find affiliate cohorts whose signup-to-subscription timing resembles Runable&apos;s Google brand traffic, then send the strongest signals to the Fraud War Room for evidence review.
          </p>
        </div>
        <ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} />
      </div>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-sm">Analysis window</CardTitle>
          <CardDescription className="text-xs">The end date is exclusive. Changing a global range updates this window automatically.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="tts-from" className="text-xs">Start date</Label>
            <Input id="tts-from" type="date" value={ttsFrom} onChange={(event) => setTtsFrom(event.target.value)} className="h-9 w-40 text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tts-to" className="text-xs">End date <span className="font-normal text-muted-foreground">(exclusive)</span></Label>
            <Input id="tts-to" type="date" value={ttsTo} onChange={(event) => setTtsTo(event.target.value)} className="h-9 w-40 text-xs" />
          </div>
          <Button size="sm" onClick={() => loadTts(ttsFrom, ttsTo)} disabled={ttsLoading || invalidWindow}>
            {ttsLoading ? 'Recomputing…' : 'Recompute analysis'}
          </Button>
          {invalidWindow ? <p className="w-full text-xs text-destructive">End date must be after the start date.</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { step: '01', title: 'Define the baseline', copy: 'Google brand means the initial source is google_ads or googleads and the campaign is exactly brand.' },
          { step: '02', title: 'Compare behavior', copy: 'We compare median time from signup to first paid subscription for every attributed affiliate cohort.' },
          { step: '03', title: 'Review evidence', copy: 'High similarity moves a cohort up the queue. Campaign overlap and URL evidence are required before action.' },
        ].map((item) => (
          <div key={item.step} className="flex gap-3 rounded-xl border bg-card p-4">
            <span className="font-mono text-xs text-muted-foreground">{item.step}</span>
            <div><h2 className="text-sm font-semibold">{item.title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.copy}</p></div>
          </div>
        ))}
      </div>

      {ttsLoading && !ttsData ? (
        <div className="grid gap-4" aria-label="Loading funnel analysis" aria-live="polite">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
          <Skeleton className="h-[520px]" />
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/5 p-4 text-sm text-red-800 dark:text-red-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0"><p className="font-medium">PostHog funnel query failed</p><p className="mt-1 break-words text-xs opacity-80">{error}</p></div>
        </div>
      ) : null}

      {ttsData ? (
        <>
          {ttsData.note ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />{ttsData.note}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="gap-2"><CardHeader><CardDescription className="flex items-center gap-1.5 text-xs"><TimerReset className="size-3.5" /> Google median time</CardDescription><CardTitle className={cn('text-2xl tabular-nums', ttsTone(ttsData.overall.googleSignupToFtsSecMedian))}>{fmtDuration(ttsData.overall.googleSignupToFtsSecMedian)}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{ttsData.overall.googleFts.toLocaleString()} timed subscriptions</p></CardContent></Card>
            <Card className="gap-2"><CardHeader><CardDescription className="flex items-center gap-1.5 text-xs"><Clock3 className="size-3.5" /> Non-brand median time</CardDescription><CardTitle className={cn('text-2xl tabular-nums', ttsTone(ttsData.overall.restSignupToFtsSecMedian))}>{fmtDuration(ttsData.overall.restSignupToFtsSecMedian)}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{ttsData.overall.restFts.toLocaleString()} timed subscriptions</p></CardContent></Card>
            <Card className="gap-2"><CardHeader><CardDescription className="flex items-center gap-1.5 text-xs"><ShieldAlert className="size-3.5" /> High-priority cohorts</CardDescription><CardTitle className="text-2xl tabular-nums">{counts.high.toLocaleString()}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">80%+ timing similarity; review first</p></CardContent></Card>
            <Card className="gap-2"><CardHeader><CardDescription className="flex items-center gap-1.5 text-xs"><Database className="size-3.5" /> Token attribution coverage</CardDescription><CardTitle className="text-2xl tabular-nums">{ttsData.quality.tokenCoveragePct === null ? '—' : `${(ttsData.quality.tokenCoveragePct * 100).toFixed(1)}%`}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{ttsData.quality.resolvedTokens.toLocaleString()} of {ttsData.quality.materializedTokens.toLocaleString()} observed tokens resolved</p></CardContent></Card>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            <CircleGauge className="size-4 text-foreground" />
            <span>PostHog materialized through <strong className="font-medium text-foreground">{formatDay(ttsData.quality.dataThrough)}</strong></span>
            <span aria-hidden="true">·</span>
            <span>{ttsData.quality.timingRows.toLocaleString()} raw timing rows</span>
            <span aria-hidden="true">·</span>
            <span>{ttsData.quality.affiliateTimingMatches.toLocaleString()} matched to affiliate emails</span>
          </div>

          <section aria-labelledby="source-comparison-title" className="grid gap-3">
            <div>
              <h2 id="source-comparison-title" className="text-base font-semibold">Source funnel comparison</h2>
              <p className="text-xs text-muted-foreground">Same reporting window and event definitions, shown as acquisition flows.</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {ttsData.baselines.map((row) => <SourceFlow key={row.source} row={row} accent={row.source === 'google' ? 'google' : 'rest'} />)}
            </div>
          </section>

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
                    onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                    placeholder="Search affiliate, email, token, country…"
                    aria-label="Search affiliate review queue"
                    className="h-9 pl-9 text-xs"
                  />
                </div>
              </div>
              <Tabs value={reviewFilter} onValueChange={(value) => { setReviewFilter(value as ReviewFilter); setPage(1); }} className="mt-3 overflow-x-auto">
                <TabsList>
                  <TabsTrigger value="all">All <span className="tabular-nums">{ttsData.affiliates.length}</span></TabsTrigger>
                  <TabsTrigger value="high">High priority <span className="tabular-nums">{counts.high}</span></TabsTrigger>
                  <TabsTrigger value="review">Review <span className="tabular-nums">{counts.review}</span></TabsTrigger>
                  <TabsTrigger value="insufficient">Insufficient data <span className="tabular-nums">{counts.insufficient}</span></TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="p-0">
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
                    {paged.rows.map((affiliate) => {
                      const priority = priorityFor(affiliate);
                      return (
                        <TableRow key={affiliate.affiliateId}>
                          <TableCell className="align-top">
                            <p className="font-medium">{affiliate.label}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{affiliate.email || 'No email recorded'}</p>
                            {affiliate.linkToken ? <Badge variant="secondary" className="mt-2 font-mono text-[10px]">?via={affiliate.linkToken}</Badge> : null}
                          </TableCell>
                          <TableCell className="align-top text-xs">
                            <p><span className="text-muted-foreground">Pageviews</span> <strong className="float-right font-medium tabular-nums">{affiliate.pageviews?.toLocaleString() ?? '—'}</strong></p>
                            <p className="mt-1"><span className="text-muted-foreground">Signups</span> <strong className="float-right font-medium tabular-nums">{affiliate.signups.toLocaleString()}</strong></p>
                            <p className="mt-1"><span className="text-muted-foreground">PV → signup</span> <strong className="float-right font-medium tabular-nums">{formatRate(affiliate.pvToSignupRate)}</strong></p>
                          </TableCell>
                          <TableCell className="align-top text-xs">
                            <p><span className="text-muted-foreground">First subscriptions</span> <strong className="float-right font-medium tabular-nums">{affiliate.fts.toLocaleString()}</strong></p>
                            <p className="mt-1"><span className="text-muted-foreground">Signup → subscription</span> <strong className="float-right font-medium tabular-nums">{formatRate(affiliate.signupToFtsRate)}</strong></p>
                          </TableCell>
                          <TableCell className={cn('align-top font-medium tabular-nums', ttsTone(affiliate.signupToFtsSecMedian))}>{fmtDuration(affiliate.signupToFtsSecMedian)}</TableCell>
                          <TableCell className="align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={priority.tone}>{priority.label}</Badge>
                              {affiliate.googleSimilarity !== null && affiliate.googleSimilarity !== undefined ? <span className="text-xs tabular-nums text-muted-foreground">{Math.round(affiliate.googleSimilarity * 100)}%</span> : null}
                            </div>
                            {affiliate.googleSimilarity !== null && affiliate.googleSimilarity !== undefined ? (
                              <div className="mt-2 h-1.5 w-full max-w-32 overflow-hidden rounded-full bg-muted">
                                <div className={cn('h-full', similarityTone(affiliate.googleSimilarity))} style={{ width: `${Math.round(affiliate.googleSimilarity * 100)}%` }} />
                              </div>
                            ) : <p className="mt-2 text-[11px] text-muted-foreground">Needs at least two matched timing events.</p>}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex max-w-64 flex-wrap gap-1">
                              {(affiliate.countries ?? []).slice(0, 3).map((country) => <Badge key={`${affiliate.affiliateId}-${country.code}`} variant="outline" className="font-normal">{country.name} <span className="ml-1 tabular-nums text-muted-foreground">{country.count}</span></Badge>)}
                              {(affiliate.countries ?? []).length === 0 ? <span className="text-xs text-muted-foreground">No converted-country data</span> : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {paged.rows.length === 0 ? (
                <div className="grid place-items-center gap-2 px-6 py-12 text-center">
                  <p className="text-sm font-medium">No affiliates match these filters</p>
                  <p className="text-xs text-muted-foreground">Try a different priority tab or clear the search.</p>
                  <Button variant="outline" size="sm" onClick={() => { setSearch(''); setReviewFilter('all'); setPage(1); }}>Reset filters</Button>
                </div>
              ) : null}
              <Pager page={paged.page} totalPages={paged.totalPages} total={paged.total} perPage={PER_PAGE} onPage={setPage} label="affiliate cohorts" />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
