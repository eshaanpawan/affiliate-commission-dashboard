'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { useDashboard, paginate } from '@/lib/use-dashboard';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ChartRangeTabs } from '@/components/RangeTabs';
import type { DashboardRange } from '@/lib/dashboard-range';
import { Pager } from '@/components/Pager';
import { SectionCard } from '@/components/SectionCard';
import { DashboardTopAffiliatesPie } from '@/components/DashboardTopAffiliatesPie';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PER_PAGE = 15;

function LeaderboardChart() {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const { data, loading } = useDashboard(rangeOverride);

  return (
    <div className="border-b p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Attributed activity ranking</p>
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
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="conversionsThisWeek" fill="var(--color-conversionsThisWeek)" radius={[0, 3, 3, 0]} />
            <Bar dataKey="referralsThisWeek" fill="var(--color-referralsThisWeek)" radius={[0, 3, 3, 0]} />
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
  const [page, setPage] = useState(1);

  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
        <Skeleton className="mb-8 h-10 w-72" />
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive text-sm">Failed to load data.</p>
        <Button size="sm" onClick={() => refresh()}>Retry</Button>
      </div>
    );
  }

  const paged = paginate(data.weeklyLeaderboard, page, PER_PAGE);

  return (
    <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Top affiliates ranked inside the selected reporting window</p>
        </div>
      </div>

      {/* Top Affiliates */}
      <SectionCard
        className="mb-8"
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
        className="mb-8"
        title="Range Leaderboard"
        description="Top affiliates by conversions in the global reporting window"
        open={leaderboardExpanded}
        onOpenChange={setLeaderboardExpanded}
      >
        {data.weeklyLeaderboard.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">No attributed activity in this reporting window.</div>
        ) : (
          <>
          <LeaderboardChart />
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
              {paged.rows.map((a) => (
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
          <Pager
            page={paged.page}
            totalPages={paged.totalPages}
            total={paged.total}
            perPage={PER_PAGE}
            onPage={setPage}
            label="affiliates"
          />
          </>
        )}
      </SectionCard>
    </div>
  );
}
