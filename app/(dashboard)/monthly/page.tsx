'use client';

import * as React from 'react';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { useDashboard } from '@/lib/use-dashboard';
import { MonthlySummary } from '@/components/MonthlySummary';
import { SectionCard } from '@/components/SectionCard';
import { fmtCents as fmt, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
          <h1 className="text-2xl font-bold tracking-tight">Monthly</h1>
          <p className="text-muted-foreground mt-1 text-sm">Month-by-month referrals, conversions, revenue and commissions</p>
        </div>
        <Button size="sm" onClick={() => refresh()} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
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
            <Card className="gap-4">
              <CardHeader><CardTitle className="text-sm">Conversions per Month</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={MONTHLY_COUNT_CONFIG} className="h-[200px] w-full">
                  <BarChart data={data.monthly.map(m => ({ month: new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), conversions: m.conversions, referrals: m.referrals }))} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="conversions" fill="var(--color-conversions)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="referrals" fill="var(--color-referrals)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader><CardTitle className="text-sm">Revenue vs Commissions per Month</CardTitle></CardHeader>
              <CardContent>
                <ChartContainer config={MONTHLY_MONEY_CONFIG} className="h-[200px] w-full">
                  <BarChart data={data.monthly.map(m => ({ month: new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), revenue: m.revenueCents / 100, commissions: m.commissionCents / 100 }))} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} width={56} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(v, name) => [`$${Number(v).toFixed(2)}`, MONTHLY_MONEY_CONFIG[name as keyof typeof MONTHLY_MONEY_CONFIG]?.label ?? name] as unknown as React.ReactNode} />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="commissions" fill="var(--color-commissions)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
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
