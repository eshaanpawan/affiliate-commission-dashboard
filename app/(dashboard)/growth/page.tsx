'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Mail,
  Rocket,
  Search,
  ShieldAlert,
  Sparkles,
  Sprout,
  Target,
  Users,
  Zap,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { ChartRangeTabs } from '@/components/RangeTabs';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { useDashboard, type Affiliate } from '@/lib/use-dashboard';
import type { DashboardRange } from '@/lib/dashboard-range';
import { fmtCents, pct } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Segment = 'scale' | 'nurture' | 'activate' | 'review';
type SortKey = 'priority' | 'revenue' | 'conversions' | 'traffic' | 'newest';

type SegmentDefinition = {
  label: string;
  description: string;
  rule: string;
  nextMove: string;
  actionLabel: string;
  href: string;
  icon: typeof Rocket;
  tone: string;
  accent: string;
};

const segmentMeta: Record<Segment, SegmentDefinition> = {
  scale: {
    label: 'Scale',
    description: 'Proven, low-risk converters worth a higher-touch growth plan.',
    rule: '3+ paid conversions and less than 50% ad-attributed signup traffic.',
    nextMove: 'Prepare a co-marketing test or measured commission experiment.',
    actionLabel: 'Prepare partner outreach',
    href: '/mail?tab=audience',
    icon: Rocket,
    tone: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300',
    accent: 'bg-emerald-500',
  },
  nurture: {
    label: 'Nurture',
    description: 'Meaningful audience activity with conversion headroom.',
    rule: '100+ measured pageviews or 5+ Rewardful signups without scale-level results.',
    nextMove: 'Share a conversion asset, diagnose the landing path, then review in 14 days.',
    actionLabel: 'Prepare nurture outreach',
    href: '/mail?tab=audience',
    icon: Sprout,
    tone: 'text-sky-700 bg-sky-50 dark:bg-sky-500/10 dark:text-sky-300',
    accent: 'bg-sky-500',
  },
  activate: {
    label: 'Activate',
    description: 'Approved affiliates with little or no attributed activity.',
    rule: 'Below the activity and conversion thresholds for Scale or Nurture.',
    nextMove: 'Send onboarding assets and request a first placement date.',
    actionLabel: 'Prepare activation outreach',
    href: '/mail?tab=audience',
    icon: Target,
    tone: 'text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300',
    accent: 'bg-amber-500',
  },
  review: {
    label: 'Review',
    description: 'Suspicious state, fraud tags, or heavily ad-driven acquisition.',
    rule: 'Suspicious status, one or more fraud tags, or 80%+ ad-driven share with 10+ signups.',
    nextMove: 'Inspect evidence and hold growth incentives until a human clears the case.',
    actionLabel: 'Review fraud evidence',
    href: '/warroom',
    icon: ShieldAlert,
    tone: 'text-red-700 bg-red-50 dark:bg-red-500/10 dark:text-red-300',
    accent: 'bg-red-500',
  },
};

function adShare(affiliate: Affiliate) {
  return affiliate.posthogSignups > 0 ? affiliate.adDrivenSignups / affiliate.posthogSignups : 0;
}

function segmentAffiliate(affiliate: Affiliate): Segment {
  const share = adShare(affiliate);
  if (affiliate.status === 'suspicious' || affiliate.fraudTags.length > 0 || (affiliate.posthogSignups >= 10 && share >= 0.8)) return 'review';
  if (affiliate.conversions >= 3 && share < 0.5) return 'scale';
  if (affiliate.posthogPageviews >= 100 || affiliate.signups >= 5) return 'nurture';
  return 'activate';
}

function placementReason(affiliate: Affiliate, segment: Segment) {
  if (segment === 'review') {
    if (affiliate.status === 'suspicious') return 'Rewardful status is suspicious';
    if (affiliate.fraudTags.length > 0) return affiliate.fraudTags.slice(0, 2).join(' · ');
    return `${pct(affiliate.adDrivenSignups, affiliate.posthogSignups)} ad-driven signup share`;
  }
  if (segment === 'scale') return `${affiliate.conversions.toLocaleString()} paid conversions · ${pct(affiliate.adDrivenSignups, affiliate.posthogSignups)} ad share`;
  if (segment === 'nurture') return affiliate.posthogPageviews >= 100
    ? `${affiliate.posthogPageviews.toLocaleString()} measured pageviews with conversion headroom`
    : `${affiliate.signups.toLocaleString()} Rewardful signups with conversion headroom`;
  return affiliate.createdAt
    ? `Joined ${new Date(affiliate.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · no meaningful activity yet`
    : 'No meaningful attributed activity yet';
}

function affiliatePriority(affiliate: Affiliate, segment: Segment) {
  if (segment === 'review') return (affiliate.status === 'suspicious' ? 1_000_000 : 0) + affiliate.fraudTags.length * 100_000 + adShare(affiliate) * 10_000 + affiliate.commissionCents / 100;
  if (segment === 'scale') return affiliate.conversions * 100_000 + affiliate.revenueCents / 100;
  if (segment === 'nurture') return affiliate.posthogPageviews + affiliate.signups * 100;
  return new Date(affiliate.createdAt).getTime() || 0;
}

function csvCell(value: string | number) {
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function GrowthPipeline({ affiliates }: { affiliates: Affiliate[] }) {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = React.useState<DashboardRange | null>(null);
  const { data, loading } = useDashboard(rangeOverride);
  const source = rangeOverride ? (data?.affiliates ?? []) : affiliates;
  const counts = (Object.keys(segmentMeta) as Segment[]).map((segment) => ({
    segment: segmentMeta[segment].label,
    affiliates: source.filter((affiliate) => segmentAffiliate(affiliate) === segment).length,
  }));
  const config = { affiliates: { label: 'Affiliates', color: 'var(--chart-2)' } } satisfies ChartConfig;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">Portfolio distribution</CardTitle>
        <CardDescription>Each affiliate is assigned to one explainable operating queue.</CardDescription>
        <CardAction><ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} /></CardAction>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-56 w-full" /> : (
          <ChartContainer config={config} className="h-56 w-full">
            <BarChart data={counts} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="segment" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={44} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar dataKey="affiliates" fill="var(--color-affiliates)" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function GrowthPage() {
  const { data, loading } = useDashboard();
  const [segment, setSegment] = React.useState<Segment>('scale');
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<SortKey>('priority');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  if (loading || !data) {
    return (
      <div className="mx-auto grid w-full max-w-[112rem] gap-4 px-4 py-8">
        <Skeleton className="h-12 w-96 max-w-full" />
        <div className="grid gap-4 lg:grid-cols-4"><Skeleton className="h-28 lg:col-span-1" /><Skeleton className="h-28 lg:col-span-1" /><Skeleton className="h-28 lg:col-span-1" /><Skeleton className="h-28 lg:col-span-1" /></div>
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const counts = data.affiliates.reduce<Record<Segment, number>>((result, affiliate) => {
    result[segmentAffiliate(affiliate)] += 1;
    return result;
  }, { scale: 0, nurture: 0, activate: 0, review: 0 });
  const scaleRevenue = data.affiliates
    .filter((affiliate) => segmentAffiliate(affiliate) === 'scale')
    .reduce((total, affiliate) => total + affiliate.revenueCents, 0);
  const reviewCommission = data.affiliates
    .filter((affiliate) => segmentAffiliate(affiliate) === 'review')
    .reduce((total, affiliate) => total + affiliate.commissionCents, 0);
  const totalSignups = data.affiliates.reduce((total, affiliate) => total + affiliate.signups, 0);
  const totalConversions = data.affiliates.reduce((total, affiliate) => total + affiliate.conversions, 0);
  const normalizedSearch = search.trim().toLowerCase();
  const segmented = data.affiliates
    .filter((affiliate) => segmentAffiliate(affiliate) === segment)
    .filter((affiliate) => !normalizedSearch || [affiliate.name, affiliate.email, affiliate.linkToken ?? '', ...affiliate.fraudTags].some((value) => value.toLowerCase().includes(normalizedSearch)))
    .sort((a, b) => {
      if (sort === 'revenue') return b.revenueCents - a.revenueCents;
      if (sort === 'conversions') return b.conversions - a.conversions;
      if (sort === 'traffic') return b.posthogPageviews - a.posthogPageviews;
      if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return affiliatePriority(b, segment) - affiliatePriority(a, segment);
    });
  const pageCount = Math.max(1, Math.ceil(segmented.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const visible = segmented.slice((activePage - 1) * pageSize, activePage * pageSize);
  const selected = data.affiliates.filter((affiliate) => selectedIds.has(affiliate.id));
  const allVisibleSelected = visible.length > 0 && visible.every((affiliate) => selectedIds.has(affiliate.id));
  const someVisibleSelected = visible.some((affiliate) => selectedIds.has(affiliate.id));
  const definition = segmentMeta[segment];

  const changeSegment = (next: Segment) => {
    setSegment(next);
    setPage(1);
    setSelectedIds(new Set());
  };

  const copyBrief = async (affiliate: Affiliate) => {
    const text = `${affiliate.name} growth brief\nQueue: ${definition.label}\nReason: ${placementReason(affiliate, segment)}\nConversions: ${affiliate.conversions}\nRevenue: ${fmtCents(affiliate.revenueCents)}\nTracked commission: ${fmtCents(affiliate.commissionCents)}\nPostHog pageviews: ${affiliate.posthogPageviews}\nPostHog FTS: ${affiliate.posthogFts}\nRecommended next step: ${definition.nextMove}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Growth brief copied');
    } catch {
      toast.error('Could not copy the growth brief');
    }
  };

  const copySelectedEmails = async () => {
    try {
      await navigator.clipboard.writeText(selected.map((affiliate) => affiliate.email).filter(Boolean).join('\n'));
      toast.success(`${selected.length} affiliate email${selected.length === 1 ? '' : 's'} copied`);
    } catch {
      toast.error('Could not copy the selected emails');
    }
  };

  const downloadQueue = (rows: Affiliate[]) => {
    const header = ['affiliate_id', 'name', 'email', 'queue', 'reason', 'pageviews', 'signups', 'paid_conversions', 'ad_share', 'revenue', 'tracked_commission', 'recommended_next_step'];
    const body = rows.map((affiliate) => [
      affiliate.id,
      affiliate.name,
      affiliate.email,
      definition.label,
      placementReason(affiliate, segment),
      affiliate.posthogPageviews,
      affiliate.signups,
      affiliate.conversions,
      pct(affiliate.adDrivenSignups, affiliate.posthogSignups),
      fmtCents(affiliate.revenueCents),
      fmtCents(affiliate.commissionCents),
      definition.nextMove,
    ].map(csvCell).join(','));
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `affiliate-${segment}-queue.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} affiliate${rows.length === 1 ? '' : 's'} exported`);
  };

  const toggleVisible = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const affiliate of visible) {
        if (checked) next.add(affiliate.id);
        else next.delete(affiliate.id);
      }
      return next;
    });
  };

  return (
    <div className="mx-auto grid w-full max-w-[112rem] gap-6 px-4 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-muted-foreground mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]"><Zap className="size-3.5 text-emerald-500" /> Partner operations</p>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="size-5" /> Affiliate Growth Workspace</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm">Decide who to grow, why they are prioritized, and which controlled action should happen next—all from live Rewardful and PostHog signals.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="/warroom"><ShieldAlert /> Review acquisition risk</Link></Button>
          <Button asChild><Link href="/mail?tab=audience"><Mail /> Open outreach center</Link></Button>
        </div>
      </div>

      <section aria-label="Portfolio pulse" className="grid overflow-hidden rounded-2xl border bg-card sm:grid-cols-2 xl:grid-cols-4">
        <div className="border-b p-5 sm:border-r xl:border-b-0">
          <p className="text-muted-foreground flex items-center gap-2 text-xs"><Users className="size-3.5" /> Affiliates tracked</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{data.affiliates.length.toLocaleString()}</p>
          <p className="text-muted-foreground mt-1 text-xs">{(counts.scale + counts.nurture).toLocaleString()} ready for growth work</p>
        </div>
        <div className="border-b p-5 xl:border-b-0 xl:border-r">
          <p className="text-muted-foreground flex items-center gap-2 text-xs"><Rocket className="size-3.5 text-emerald-500" /> Scale revenue</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{fmtCents(scaleRevenue)}</p>
          <p className="text-muted-foreground mt-1 text-xs">from {counts.scale.toLocaleString()} proven partners</p>
        </div>
        <div className="border-b p-5 sm:border-r sm:border-b-0">
          <p className="text-muted-foreground flex items-center gap-2 text-xs"><BarChart3 className="size-3.5 text-sky-500" /> Portfolio conversion</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{pct(totalConversions, totalSignups)}</p>
          <p className="text-muted-foreground mt-1 text-xs">{totalConversions.toLocaleString()} paid from {totalSignups.toLocaleString()} signups</p>
        </div>
        <div className="p-5">
          <p className="text-muted-foreground flex items-center gap-2 text-xs"><ShieldAlert className="size-3.5 text-red-500" /> Review exposure</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{fmtCents(reviewCommission)}</p>
          <p className="text-muted-foreground mt-1 text-xs">tracked commission across {counts.review.toLocaleString()} review cases</p>
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,0.8fr)]">
        <GrowthPipeline affiliates={data.affiliates} />
        <Card className="border-foreground/10 bg-foreground text-background dark:bg-card dark:text-foreground">
          <CardHeader>
            <p className="text-background/55 dark:text-muted-foreground text-[11px] font-semibold uppercase tracking-[0.16em]">Operating order</p>
            <CardTitle className="text-lg">Move one queue at a time</CardTitle>
            <CardDescription className="text-background/65 dark:text-muted-foreground">Risk review gates growth. Every outbound or account change still requires approval.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {([
              ['01', 'Clear review cases', counts.review, 'review'],
              ['02', 'Activate dormant partners', counts.activate, 'activate'],
              ['03', 'Convert engaged traffic', counts.nurture, 'nurture'],
              ['04', 'Expand proven partners', counts.scale, 'scale'],
            ] as const).map(([order, title, count, key]) => (
              <button key={key} type="button" onClick={() => changeSegment(key)} className="group flex items-center gap-3 rounded-xl border border-background/15 px-3 py-3 text-left transition-colors hover:bg-background/10 dark:border-border dark:hover:bg-muted/50">
                <span className="text-background/45 dark:text-muted-foreground font-mono text-xs">{order}</span>
                <span className="min-w-0 flex-1 text-sm font-medium">{title}</span>
                <span className="font-mono text-xs tabular-nums">{count.toLocaleString()}</span>
                <ChevronRight className="size-4 opacity-45 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(segmentMeta) as Segment[]).map((key) => {
          const meta = segmentMeta[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={segment === key}
              onClick={() => changeSegment(key)}
              className={`group relative overflow-hidden rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm ${segment === key ? 'ring-ring ring-2' : ''}`}
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${meta.accent}`} />
              <span className={`mb-3 flex size-9 items-center justify-center rounded-lg ${meta.tone}`}><meta.icon className="size-4" /></span>
              <span className="block text-sm font-semibold">{meta.label} <span className="float-right tabular-nums">{counts[key].toLocaleString()}</span></span>
              <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">{meta.description}</span>
            </button>
          );
        })}
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${definition.tone}`}><definition.icon className="size-4" /></span>
            <div className="min-w-0">
              <CardTitle className="text-base">{definition.label} action queue</CardTitle>
              <CardDescription className="mt-1">{definition.rule}</CardDescription>
              <p className="mt-2 flex items-start gap-1.5 text-xs"><ArrowUpRight className="mt-0.5 size-3.5 shrink-0" /><span><strong>Next move:</strong> {definition.nextMove}</span></p>
            </div>
          </div>
          <CardAction>
            <Button asChild size="sm" variant={segment === 'review' ? 'destructive' : 'default'}><Link href={definition.href}>{definition.actionLabel}<ArrowUpRight /></Link></Button>
          </CardAction>
        </CardHeader>

        <div className="flex flex-col gap-3 border-b bg-muted/25 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="pl-8" placeholder="Search name, email, link token, or signal…" aria-label="Search the current action queue" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sort} onValueChange={(value) => { setSort(value as SortKey); setPage(1); }}>
              <SelectTrigger aria-label="Sort action queue"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="priority">Highest priority</SelectItem>
                <SelectItem value="revenue">Highest revenue</SelectItem>
                <SelectItem value="conversions">Most conversions</SelectItem>
                <SelectItem value="traffic">Most traffic</SelectItem>
                <SelectItem value="newest">Newest joined</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
              <SelectTrigger aria-label="Rows per page"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 rows</SelectItem>
                <SelectItem value="25">25 rows</SelectItem>
                <SelectItem value="50">50 rows</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={segmented.length === 0} onClick={() => downloadQueue(segmented)}><Download /> Export queue</Button>
          </div>
        </div>

        {selected.length > 0 && (
          <div className="flex flex-col gap-3 border-b bg-primary/[0.045] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="size-4 text-emerald-600" /> {selected.length.toLocaleString()} selected for preparation</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copySelectedEmails}><Copy /> Copy emails</Button>
              <Button size="sm" variant="outline" onClick={() => downloadQueue(selected)}><Download /> Export selected</Button>
              <Button asChild size="sm"><Link href={definition.href}>{segment === 'review' ? 'Open review' : 'Prepare in Mail'}<ArrowUpRight /></Link></Button>
            </div>
          </div>
        )}

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-5">
                    <Checkbox
                      aria-label="Select all affiliates on this page"
                      checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                      onCheckedChange={(checked) => toggleVisible(checked === true)}
                    />
                  </TableHead>
                  <TableHead>Affiliate</TableHead>
                  <TableHead className="min-w-56">Why this queue</TableHead>
                  <TableHead className="text-right">Traffic</TableHead>
                  <TableHead className="text-right">Signups</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Ad share</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="px-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((affiliate) => {
                  const isRiskyAdShare = affiliate.posthogSignups >= 10 && adShare(affiliate) >= 0.8;
                  return (
                    <TableRow key={affiliate.id} data-state={selectedIds.has(affiliate.id) ? 'selected' : undefined}>
                      <TableCell className="pl-5">
                        <Checkbox
                          aria-label={`Select ${affiliate.name}`}
                          checked={selectedIds.has(affiliate.id)}
                          onCheckedChange={(checked) => setSelectedIds((current) => {
                            const next = new Set(current);
                            if (checked === true) next.add(affiliate.id);
                            else next.delete(affiliate.id);
                            return next;
                          })}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{affiliate.name}</p>
                        <p className="text-muted-foreground max-w-52 truncate text-xs">{affiliate.email}</p>
                        {affiliate.linkToken && <p className="mt-1 font-mono text-[10px] text-indigo-600 dark:text-indigo-300">?via={affiliate.linkToken}</p>}
                      </TableCell>
                      <TableCell><p className="max-w-72 text-xs leading-relaxed">{placementReason(affiliate, segment)}</p></TableCell>
                      <TableCell className="text-right tabular-nums">{affiliate.posthogPageviews.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{affiliate.signups.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{affiliate.conversions.toLocaleString()}</TableCell>
                      <TableCell className="text-right"><Badge variant={isRiskyAdShare ? 'destructive' : 'secondary'}>{pct(affiliate.adDrivenSignups, affiliate.posthogSignups)}</Badge></TableCell>
                      <TableCell className="text-right font-medium tabular-nums"><p>{fmtCents(affiliate.revenueCents)}</p><p className="text-muted-foreground mt-0.5 text-[10px]">{fmtCents(affiliate.commissionCents)} commission</p></TableCell>
                      <TableCell className="px-5"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => copyBrief(affiliate)}><Copy className="size-3.5" /> Brief</Button><Button size="sm" asChild variant={segment === 'review' ? 'destructive' : 'default'}><Link href={segment === 'review' ? '/warroom' : `/mail?tab=audience&q=${encodeURIComponent(affiliate.email || affiliate.name)}`}>{segment === 'review' ? <ShieldAlert className="size-3.5" /> : <Mail className="size-3.5" />} {segment === 'review' ? 'Review' : 'Act'}</Link></Button></div></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {segmented.length === 0 && <div className="text-muted-foreground p-12 text-center text-sm">{search ? 'No affiliates in this queue match your search.' : `No affiliates currently meet the ${definition.label} rules.`}</div>}
          {segmented.length > 0 && (
            <div className="flex flex-col gap-3 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground text-xs">Showing {(activePage - 1) * pageSize + 1}–{Math.min(activePage * pageSize, segmented.length)} of {segmented.length.toLocaleString()} {definition.label.toLowerCase()} affiliates</p>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={activePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft /></Button>
                <span className="min-w-20 text-center text-xs tabular-nums">Page {activePage} / {pageCount}</span>
                <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={activePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-xl border border-dashed p-5">
        <p className="flex items-center gap-2 text-sm font-medium"><ArrowUpRight className="size-4" /> Safe action boundary</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">This workspace ranks, explains, exports, and prepares work. It never changes commissions, releases payouts, sends outreach, or changes Rewardful account state without an explicit human approval in the destination workflow.</p>
      </div>
    </div>
  );
}
