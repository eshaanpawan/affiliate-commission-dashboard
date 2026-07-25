'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { useDashboard, paginate } from '@/lib/use-dashboard';
import { Pager } from '@/components/Pager';
import { SectionCard } from '@/components/SectionCard';
import { TopAffiliatesPie } from '@/components/TopAffiliatesPie';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PER_PAGE = 15;

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
          <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Top affiliates and this week&apos;s ranking</p>
        </div>
        <Button size="sm" onClick={() => refresh()} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
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
          <>
          <div className="border-b p-5">
            <ChartContainer
              config={{
                conversionsThisWeek: { label: 'Conversions', color: 'var(--chart-2)' },
                referralsThisWeek: { label: 'Referrals', color: 'var(--chart-1)' },
              }}
              className="h-[260px] w-full"
            >
              <BarChart
                data={data.weeklyLeaderboard.slice(0, 10)}
                layout="vertical"
                margin={{ top: 0, right: 8, left: 8, bottom: 0 }}
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  width={140}
                  tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 18) + '…' : v)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="conversionsThisWeek" fill="var(--color-conversionsThisWeek)" radius={[0, 3, 3, 0]} />
                <Bar dataKey="referralsThisWeek" fill="var(--color-referralsThisWeek)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ChartContainer>
          </div>
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
