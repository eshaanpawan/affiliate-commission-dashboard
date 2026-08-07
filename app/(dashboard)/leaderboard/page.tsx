'use client';

import { useState } from 'react';
import { Medal, Target, Trophy, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { useDashboard } from '@/lib/use-dashboard';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ChartRangeTabs } from '@/components/RangeTabs';
import type { DashboardRange } from '@/lib/dashboard-range';
import { ExpandableRows } from '@/components/ExpandableRows';
import { SectionCard } from '@/components/SectionCard';
import { DashboardTopAffiliatesPie } from '@/components/DashboardTopAffiliatesPie';
import { pct } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageControls } from '@/components/PageControls';

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <Card className="w-full gap-0 p-6 py-4">
      <CardContent className="p-0">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
          <div className="bg-muted flex size-10 items-center justify-center rounded-md border">
            <Icon className="size-4" />
          </div>
        </div>
        <dd className="text-foreground mt-2 text-3xl font-semibold tabular-nums">{value}</dd>
      </CardContent>
    </Card>
  );
}

function LeaderboardChart() {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const { data, loading } = useDashboard(rangeOverride);

  return (
    <div className="border-b p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Attributed activity ranking</p>
          <p className="text-muted-foreground mt-0.5 text-xs">Top 10 affiliates by referrals and conversions</p>
        </div>
        <ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} />
      </div>
      {loading || !data ? <Skeleton className="h-[260px] w-full" /> : (
        <ChartContainer
          config={{
            conversionsThisWeek: { label: 'Conversions', color: 'var(--chart-2)' },
            referralsThisWeek: { label: 'Referrals', color: 'var(--chart-1)' },
          }}
          className="h-[260px] w-full"
        >
          <BarChart data={data.weeklyLeaderboard.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={140} tickFormatter={(value: string) => value.length > 18 ? `${value.slice(0, 18)}…` : value} />
            <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="conversionsThisWeek" fill="var(--color-conversionsThisWeek)" radius={[5, 5, 5, 5]} />
            <Bar dataKey="referralsThisWeek" fill="var(--color-referralsThisWeek)" radius={[5, 5, 5, 5]} />
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}

export default function LeaderboardPage() {
  const { data, loading, refresh } = useDashboard();

  const [topAffiliatesExpanded, setTopAffiliatesExpanded] = useState(true);
  const [leaderboardExpanded, setLeaderboardExpanded] = useState(true);

  if (loading && !data) {
    return (
      <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
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

  const board = data.weeklyLeaderboard;
  const totalConversions = board.reduce((s, a) => s + a.conversionsThisWeek, 0);
  const totalReferrals = board.reduce((s, a) => s + a.referralsThisWeek, 0);

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      {/* Header */}
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Leaderboard</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Top affiliates ranked inside the selected reporting window
          </p>
        </div>
        <PageControls />
      </div>

      {/* Stat cards */}
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Ranked affiliates" value={board.length.toLocaleString()} />
        <StatCard icon={Trophy} label="Conversions" value={totalConversions.toLocaleString()} />
        <StatCard icon={Target} label="Referrals" value={totalReferrals.toLocaleString()} />
        <StatCard icon={Medal} label="Referral → paid" value={pct(totalConversions, totalReferrals)} />
      </div>

      {/* Top Affiliates */}
      <SectionCard
        title="Top Affiliates"
        description="By referrals and by conversions"
        open={topAffiliatesExpanded}
        onOpenChange={setTopAffiliatesExpanded}
      >
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <DashboardTopAffiliatesPie title="Top Affiliates by Referrals" dataKey="topByReferrals" label="referrals" />
          <DashboardTopAffiliatesPie title="Top Affiliates by Conversions" dataKey="topByConversions" label="conversions" />
        </div>
      </SectionCard>

      {/* Range leaderboard */}
      <SectionCard
        title="Range Leaderboard"
        description="Top affiliates by conversions in the global reporting window"
        open={leaderboardExpanded}
        onOpenChange={setLeaderboardExpanded}
      >
        {board.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">No attributed activity in this reporting window.</div>
        ) : (
          <>
          <LeaderboardChart />
          <ExpandableRows items={board} preview={5} perPage={10} label="affiliates" render={(rows) => (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">Rank</TableHead>
                  <TableHead>Affiliate</TableHead>
                  <TableHead className="text-right">Conversions</TableHead>
                  <TableHead className="px-5 text-right">Referrals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.email}>
                    <TableCell className="px-5">
                      <span className={cn(
                        'inline-flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
                        a.rank === 1 ? 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                        a.rank === 2 ? 'border-border bg-muted text-foreground' :
                        a.rank === 3 ? 'border-orange-400 bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' :
                        'border-transparent bg-muted/60 text-muted-foreground',
                      )}>{a.rank}</span>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{a.name}</p>
                      <p className="text-muted-foreground text-xs">{a.email}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="rounded-full font-medium tabular-nums">{a.conversionsThisWeek.toLocaleString()}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground px-5 text-right tabular-nums">{a.referralsThisWeek.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          )} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
