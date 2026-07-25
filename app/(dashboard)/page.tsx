'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Flag, RefreshCw } from 'lucide-react';

import { MetricCard } from '@/components/MetricCard';
import { MonthlySummary } from '@/components/MonthlySummary';
import { DayOnDayChart } from '@/components/DayOnDayChart';
import { useDashboard, Period } from '@/lib/use-dashboard';
import { fmtCents as fmt, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
  const { data, loading, syncing, lastUpdated, period, setPeriod, refresh, sync } = useDashboard();

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

  const { overview, charts, recentActivity } = data;

  return (
    <div className="grid gap-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Affiliate Commission Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Powered by Rewardful · charts split per page in the sidebar</p>
        </div>
        <div className="flex items-start gap-3">
          <Button asChild variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
            <Link href="/warroom"><Flag className="size-3.5" /> Fraud war room</Link>
          </Button>
          <div className="text-right">
            <p className="text-muted-foreground text-xs">
              {lastUpdated ? <>Last refreshed <RelativeTime at={lastUpdated} /> · cached locally</> : 'Never refreshed'}
            </p>
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button size="sm" onClick={() => refresh()} disabled={loading}>
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
                  Pull latest data from Rewardful into the DB. Run before Refresh for the freshest source data.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      {/* Period-filtered metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Overview</CardTitle>
          <CardDescription className="text-xs">Metrics update based on the selected time window</CardDescription>
          <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
            <Tabs value={period} onValueChange={(v) => { const p = v as Period; setPeriod(p); refresh(p); }}>
              <TabsList>
                <TabsTrigger value="7d">7d</TabsTrigger>
                <TabsTrigger value="30d">30d</TabsTrigger>
                <TabsTrigger value="90d">90d</TabsTrigger>
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

      {/* Monthly summary — pinned directly under the overview */}
      <MonthlySummary />

      {/* Last 30 days */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DayOnDayChart title="New Affiliates (last 30 days)" data={charts.dailyAffiliates} bars={[{ key: 'count', color: 'var(--chart-1)', label: 'New affiliates' }]} />
        <DayOnDayChart
          title="Referrals & Conversions per Day (last 30 days)"
          data={charts.dailyReferrals}
          bars={[
            { key: 'total', color: 'var(--chart-10)', label: 'Referrals', axis: 'left' },
            { key: 'converted', color: 'var(--chart-2)', label: 'Conversions', axis: 'right' },
          ]}
        />
        <DayOnDayChart title="Revenue per Day (last 30 days)" data={charts.dailyRevenue} bars={[{ key: 'usd', color: 'var(--chart-2)', label: 'Revenue' }]} valuePrefix="$" />
        <DayOnDayChart title="Commissions per Day (last 30 days)" data={charts.dailyCommissions} bars={[{ key: 'usd', color: 'var(--chart-1)', label: 'Commissions' }]} valuePrefix="$" />
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
    </div>
  );
}
