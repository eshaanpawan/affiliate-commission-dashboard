'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CircleAlert, Flag, ShieldCheck, Sparkles, Users } from 'lucide-react';

import { MetricCard } from '@/components/MetricCard';
import { MonthlySummary } from '@/components/MonthlySummary';
import { DashboardDayChart } from '@/components/DashboardDayChart';
import { useDashboard } from '@/lib/use-dashboard';
import { dashboardRangeDescription } from '@/lib/dashboard-range';
import { fmtCents as fmt, pct } from '@/lib/format';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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

export default function Overview() {
  const { data, loading, lastUpdated, period, refresh } = useDashboard();

  if (loading && !data) {
    return (
      <div className="grid gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
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

  return (
    <div className="mx-auto grid w-full max-w-[112rem] gap-6 px-4 py-6 md:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Affiliate Commission Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Program health, attributed growth, commission exposure, and fraud signals in one operating view.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline" className="h-8 gap-1.5 px-3 font-normal">
            <Sparkles className="size-3.5 text-emerald-600" />
            {dashboardRangeDescription(period)}
          </Badge>
          <Button asChild variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
            <Link href="/warroom"><Flag className="size-3.5" /> Review risk <ArrowUpRight className="size-3.5" /></Link>
          </Button>
        </div>
      </div>

      {period === 'all' && data.meta?.rowLevelCoveragePct != null && data.meta.rowLevelCoveragePct < 0.999 ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-900 dark:text-amber-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">All-time totals are source-backed; historical breakdowns are still reconciling</p>
            <p className="mt-1 text-xs opacity-80">
              Headline referrals and conversions use Rewardful&apos;s current affiliate counters. Row-level charts currently cover {(data.meta.rowLevelCoveragePct * 100).toFixed(1)}% of source referrals ({data.meta.rowLevelReferralCount.toLocaleString()} of {data.meta.sourceReferralCount.toLocaleString()}).
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <Card className="overflow-hidden border-0 bg-zinc-950 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950">
          <CardHeader className="pb-2">
            <CardDescription className="text-zinc-400 dark:text-zinc-600">Program roster · current state</CardDescription>
            <CardTitle className="flex items-end gap-3 text-4xl tabular-nums">
              {overview.totalAffiliates.toLocaleString()}
              <span className="mb-1 text-xs font-normal text-zinc-400 dark:text-zinc-600">total affiliates</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 text-sm">
            <div><p className="text-zinc-400 dark:text-zinc-600">Active</p><p className="mt-1 flex items-center gap-1 font-semibold tabular-nums"><ShieldCheck className="size-3.5 text-emerald-400" />{overview.activeAffiliates.toLocaleString()}</p></div>
            <div><p className="text-zinc-400 dark:text-zinc-600">Suspicious</p><p className="mt-1 flex items-center gap-1 font-semibold tabular-nums"><CircleAlert className="size-3.5 text-red-400" />{overview.suspiciousAffiliates.toLocaleString()}</p></div>
            <div><p className="text-zinc-400 dark:text-zinc-600">New in window</p><p className="mt-1 flex items-center gap-1 font-semibold tabular-nums"><Users className="size-3.5 text-sky-400" />{overview.newAffiliates.toLocaleString()}</p></div>
          </CardContent>
        </Card>
        <Card className="gap-2">
          <CardHeader><CardDescription>Attributed conversions</CardDescription><CardTitle className="text-3xl tabular-nums">{overview.convertedReferrals.toLocaleString()}</CardTitle></CardHeader>
          <CardContent><p className="text-muted-foreground text-xs">{pct(overview.convertedReferrals, overview.totalReferrals)} of {overview.totalReferrals.toLocaleString()} referral visits</p></CardContent>
        </Card>
        <Card className="gap-2">
          <CardHeader><CardDescription>Attributed revenue</CardDescription><CardTitle className="text-3xl tabular-nums">{fmt(overview.totalRevenueCents)}</CardTitle></CardHeader>
          <CardContent><p className="text-muted-foreground text-xs">{fmt(overview.totalCommissionCents)} commissions generated</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Financial and conversion snapshot</CardTitle>
          <CardDescription className="text-xs">Flow metrics use {dashboardRangeDescription(period).toLowerCase()}; pending payouts are current point-in-time exposure.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="Total Revenue" value={fmt(overview.totalRevenueCents)} />
          <MetricCard label="Commissions Generated" value={fmt(overview.totalCommissionCents)} sub={`${fmt(overview.paidCommissionCents)} paid in window`} />
          <MetricCard label="Conversion Rate" value={pct(overview.convertedReferrals, overview.totalReferrals)} sub={`${overview.convertedReferrals} conversions`} />
          <MetricCard label="Unpaid Commissions" value={fmt(overview.totalCommissionCents - overview.paidCommissionCents)} />
          <MetricCard label="Pending Payouts" value={fmt(overview.pendingPayoutCents)} />
          <MetricCard label="Avg Revenue / Earning Affiliate" value={overview.earningAffiliates > 0 ? fmt(overview.totalRevenueCents / overview.earningAffiliates) : '$0.00'} sub={`${overview.earningAffiliates.toLocaleString()} affiliates with sales`} />
        </CardContent>
      </Card>

      {/* Monthly summary — pinned directly under the overview */}
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
        <DashboardDayChart title="Revenue" dataKey="dailyRevenue" bars={[{ key: 'usd', color: 'var(--chart-2)', label: 'Revenue' }]} valuePrefix="$" />
        <DashboardDayChart title="Commissions" dataKey="dailyCommissions" bars={[{ key: 'usd', color: 'var(--chart-1)', label: 'Commissions' }]} valuePrefix="$" />
      </div>

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
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge variant="secondary" className="font-mono">{e.event_type}</Badge>
                    <span className="text-muted-foreground truncate font-mono text-xs">{e.event_id}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">{new Date(e.received_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-right text-[11px]">
        {lastUpdated ? <>Computed <RelativeTime at={lastUpdated} /></> : null}
      </p>
    </div>
  );
}
