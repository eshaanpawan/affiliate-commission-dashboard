'use client';

import * as React from 'react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { useDashboard } from '@/lib/use-dashboard';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ChartRangeTabs } from '@/components/RangeTabs';
import type { DashboardRange } from '@/lib/dashboard-range';
import { MonthlySummary } from '@/components/MonthlySummary';
import { SectionCard } from '@/components/SectionCard';
import { fmtCents as fmt, pct } from '@/lib/format';

import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const MONTHLY_COUNT_CONFIG = {
  conversions: { label: 'Conversions', color: 'var(--chart-2)' },
  referrals: { label: 'Referrals', color: 'var(--chart-10)' },
} satisfies ChartConfig;

const MONTHLY_MONEY_CONFIG = {
  revenue: { label: 'Revenue', color: 'var(--chart-1)' },
  commissions: { label: 'Commissions', color: 'var(--chart-3)' },
} satisfies ChartConfig;

function MonthlyRangeChart({ kind }: { kind: 'counts' | 'money' }) {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const { data, loading } = useDashboard(rangeOverride);
  const rows = data?.monthly ?? [];
  const formatted = rows.map((month) => ({
    month: new Date(`${month.month}-02`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    conversions: month.conversions,
    referrals: month.referrals,
    revenue: month.revenueCents / 100,
    commissions: month.commissionCents / 100,
  }));

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm">{kind === 'counts' ? 'Conversions by acquisition month' : 'Revenue vs commissions'}</CardTitle>
        <CardAction><ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} /></CardAction>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-[200px] w-full" /> : (
          <ChartContainer config={kind === 'counts' ? MONTHLY_COUNT_CONFIG : MONTHLY_MONEY_CONFIG} className="h-[200px] w-full">
            <BarChart data={formatted} margin={{ top: 4, right: 4, left: kind === 'counts' ? -18 : -10, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={kind === 'money' ? (value: number) => `$${value}` : undefined} width={kind === 'money' ? 56 : 48} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={kind === 'money' ? (value, name) => [`$${Number(value).toFixed(2)}`, MONTHLY_MONEY_CONFIG[name as keyof typeof MONTHLY_MONEY_CONFIG]?.label ?? name] as unknown as React.ReactNode : undefined} />} />
              <ChartLegend content={<ChartLegendContent />} />
              {kind === 'counts' ? <><Bar dataKey="conversions" fill="var(--color-conversions)" radius={[3, 3, 0, 0]} /><Bar dataKey="referrals" fill="var(--color-referrals)" radius={[3, 3, 0, 0]} /></> : <><Bar dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} /><Bar dataKey="commissions" fill="var(--color-commissions)" radius={[3, 3, 0, 0]} /></>}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function MonthlyPage() {
  const { data, loading, refresh } = useDashboard();
  const [monthlyExpanded, setMonthlyExpanded] = useState(true);

  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
        <Skeleton className="mb-8 h-10 w-72" />
        <Skeleton className="mb-8 h-40 w-full" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-destructive text-sm">Failed to load data.</p>
          <Button size="sm" className="mt-3" onClick={() => refresh()}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Monthly</h1>
          <p className="text-muted-foreground mt-1 text-sm">Month-by-month referrals, conversions, revenue and commissions</p>
        </div>
      </div>

      <div className="mb-8">
        <MonthlySummary />
      </div>

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
            <MonthlyRangeChart kind="counts" />
            <MonthlyRangeChart kind="money" />
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
    </div>
  );
}
