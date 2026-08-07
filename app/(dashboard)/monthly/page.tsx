'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ExpandableRows } from '@/components/ExpandableRows';
import { MonthlySummary } from '@/components/MonthlySummary';
import { SectionCard } from '@/components/SectionCard';
import { PageControls } from '@/components/PageControls';
import { fmtCents as fmt, pct } from '@/lib/format';
import {
  useMonthlyReport,
  type MonthlyRow,
  type ReportWindow,
} from '@/lib/use-monthly-report';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/* ------------------------------ report model ------------------------------ */

type ReportMode = 'month' | 'year' | 'custom';

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function monthStartIso(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toISOString();
}

function nextMonthIso(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString();
}

function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* --------------------------------- widgets -------------------------------- */

function delta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

function TrendBadge({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <Badge
      variant="outline"
      className={`gap-1 rounded-full ps-2 text-xs font-medium ${up
        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'}`}
    >
      {up ? <TrendingUp className="size-3.5 text-green-500" /> : <TrendingDown className="size-3.5 text-red-500" />}
      {up ? '+' : ''}{value.toFixed(1)}%
    </Badge>
  );
}

function StatCard({ label, value, trend }: { label: string; value: string; trend: number | null }) {
  return (
    <Card className="w-full gap-0 p-6 py-4">
      <CardContent className="p-0">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
          <TrendBadge value={trend} />
        </div>
        <dd className="text-foreground mt-2 text-3xl font-semibold tabular-nums">{value}</dd>
      </CardContent>
    </Card>
  );
}

/* --------------------------------- charts --------------------------------- */

const MONTHLY_COUNT_CONFIG = {
  conversions: { label: 'Conversions', color: 'var(--chart-2)' },
  referrals: { label: 'Referrals', color: 'var(--chart-10)' },
} satisfies ChartConfig;

const MONTHLY_MONEY_CONFIG = {
  revenue: { label: 'Revenue', color: 'var(--chart-1)' },
  commissions: { label: 'Commissions', color: 'var(--chart-3)' },
} satisfies ChartConfig;

function MonthlyRangeChart({ kind, rows, loading }: { kind: 'counts' | 'money'; rows: MonthlyRow[]; loading: boolean }) {
  const formatted = rows.map((m) => ({
    month: new Date(`${m.month}-02`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    conversions: m.conversions,
    referrals: m.visitors,
    revenue: m.salesCents / 100,
    commissions: m.commissionsCents / 100,
  }));

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{kind === 'counts' ? 'Conversions by acquisition month' : 'Revenue vs commissions'}</CardTitle>
        <CardDescription className="text-muted-foreground text-sm">
          {kind === 'counts' ? 'Referrals and paid conversions per month' : 'Attributed revenue and commission liability per month'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-[200px] w-full" /> : (
          <ChartContainer config={kind === 'counts' ? MONTHLY_COUNT_CONFIG : MONTHLY_MONEY_CONFIG} className="h-[200px] w-full">
            <BarChart data={formatted} margin={{ top: 4, right: 4, left: kind === 'counts' ? -18 : -10, bottom: 0 }}>
              <defs>
                <linearGradient id="monthlyRevGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" />
                  <stop offset="95%" stopColor="var(--chart-1)" />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={kind === 'money' ? (value: number) => `$${value}` : undefined} width={kind === 'money' ? 56 : 48} />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)' }}
                content={<ChartTooltipContent formatter={kind === 'money' ? (value, name) => [`$${Number(value).toFixed(2)}`, MONTHLY_MONEY_CONFIG[name as keyof typeof MONTHLY_MONEY_CONFIG]?.label ?? name] as unknown as React.ReactNode : undefined} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              {kind === 'counts'
                ? <><Bar dataKey="conversions" fill="var(--color-conversions)" radius={[5, 5, 5, 5]} /><Bar dataKey="referrals" fill="var(--color-referrals)" radius={[5, 5, 5, 5]} /></>
                : <><Bar dataKey="revenue" fill="url(#monthlyRevGradient)" radius={[5, 5, 5, 5]} /><Bar dataKey="commissions" fill="var(--color-commissions)" radius={[5, 5, 5, 5]} /></>}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function MonthlyPage() {
  const { refreshVersion } = useDashboardRange();
  const [monthlyExpanded, setMonthlyExpanded] = useState(true);

  /* ----- report picker state ----- */
  const [mode, setMode] = useState<ReportMode>('month');
  const [monthChoice, setMonthChoice] = useState<string>(''); // '' = auto (current month)
  const [yearChoice, setYearChoice] = useState<string>('');
  const [customStart, setCustomStart] = useState<string>(''); // 'YYYY-MM-DD', inclusive
  const [customEnd, setCustomEnd] = useState<string>('');     // 'YYYY-MM-DD', inclusive

  // All-time month rollups drive the picker options + Month-on-Month section.
  const allWindow = useMemo<ReportWindow>(() => ({ from: null, to: null, bucket: 'month' }), []);
  const { data: allData, loading: allLoading } = useMonthlyReport(allWindow, refreshVersion);

  const monthOptions = useMemo(() => (allData?.months ?? []).map((m) => m.month).sort().reverse(), [allData]);
  const yearOptions = useMemo(() => [...new Set(monthOptions.map((m) => m.slice(0, 4)))], [monthOptions]);

  const now = new Date();
  const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const selectedMonth = monthChoice
    || (monthOptions.includes(currentMonthKey) ? currentMonthKey : monthOptions[0] ?? currentMonthKey);
  const selectedYear = yearChoice || (yearOptions[0] ?? String(now.getUTCFullYear()));

  const customValid = Boolean(customStart && customEnd && customStart <= customEnd);

  /* ----- report window + previous equivalent window ----- */
  const { window: reportWindow, prevWindow, title, subtitle } = useMemo(() => {
    if (mode === 'month') {
      const from = monthStartIso(selectedMonth);
      const to = nextMonthIso(selectedMonth);
      const prevKey = prevMonthKey(selectedMonth);
      return {
        window: { from, to, bucket: 'day' } as ReportWindow,
        prevWindow: { from: monthStartIso(prevKey), to: from, bucket: 'month' } as ReportWindow,
        title: `${monthLabel(selectedMonth)} Report`,
        subtitle: `Daily referrals, conversions, revenue and commissions for ${monthLabel(selectedMonth)} · vs ${monthLabel(prevKey)}`,
      };
    }
    if (mode === 'year') {
      const y = Number(selectedYear);
      const from = new Date(Date.UTC(y, 0, 1)).toISOString();
      const to = new Date(Date.UTC(y + 1, 0, 1)).toISOString();
      return {
        window: { from, to, bucket: 'month' } as ReportWindow,
        prevWindow: {
          from: new Date(Date.UTC(y - 1, 0, 1)).toISOString(),
          to: from,
          bucket: 'month',
        } as ReportWindow,
        title: `${selectedYear} Report`,
        subtitle: `Monthly referrals, conversions, revenue and commissions for ${selectedYear} · vs ${y - 1}`,
      };
    }
    if (!customValid) {
      return {
        window: null,
        prevWindow: null,
        title: 'Custom Report',
        subtitle: 'Pick a start and end date to build a report for any period',
      };
    }
    const from = `${customStart}T00:00:00.000Z`;
    const toExclusive = new Date(Date.parse(`${customEnd}T00:00:00.000Z`) + 86_400_000).toISOString();
    const spanMs = Date.parse(toExclusive) - Date.parse(from);
    const days = Math.round(spanMs / 86_400_000);
    return {
      window: { from, to: toExclusive, bucket: days <= 92 ? 'day' : 'month' } as ReportWindow,
      prevWindow: {
        from: new Date(Date.parse(from) - spanMs).toISOString(),
        to: from,
        bucket: 'month',
      } as ReportWindow,
      title: `Custom Report · ${shortDate(from)} – ${shortDate(`${customEnd}T00:00:00.000Z`)}`,
      subtitle: `${days} day${days === 1 ? '' : 's'} of referrals, conversions, revenue and commissions · vs the preceding ${days} day${days === 1 ? '' : 's'}`,
    };
  }, [mode, selectedMonth, selectedYear, customStart, customEnd, customValid]);

  const { data: current, error: currentError, loading: currentLoading } = useMonthlyReport(reportWindow, refreshVersion);
  const { data: previous } = useMonthlyReport(prevWindow, refreshVersion);

  /* ----- Month-on-Month rows bounded to the report window ----- */
  const momRows = useMemo(() => {
    const rows = allData?.months ?? [];
    if (mode === 'month' || mode === 'year') {
      const year = mode === 'month' ? selectedMonth.slice(0, 4) : selectedYear;
      return rows.filter((m) => m.month.startsWith(year));
    }
    if (!reportWindow?.from || !reportWindow?.to) return rows;
    const fromKey = reportWindow.from.slice(0, 7);
    const toKey = reportWindow.to.slice(0, 7);
    return rows.filter((m) => m.month >= fromKey && m.month <= toKey);
  }, [allData, mode, selectedMonth, selectedYear, reportWindow]);

  const totals = current?.totals ?? null;
  const prevTotals = previous?.totals ?? null;

  const csvName = mode === 'month'
    ? `report-${selectedMonth}.csv`
    : mode === 'year'
      ? `report-${selectedYear}.csv`
      : `report-${customStart || 'start'}-to-${customEnd || 'end'}.csv`;

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      {/* Header */}
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">{title}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{subtitle}</p>
        </div>
        <PageControls />
      </div>

      {/* Report picker */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="report-mode" className="text-muted-foreground text-xs font-medium">Report</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as ReportMode)}>
            <SelectTrigger id="report-mode" size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="year">Year</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === 'month' && (
          <div className="grid gap-1.5">
            <Label htmlFor="report-month" className="text-muted-foreground text-xs font-medium">Month</Label>
            <Select value={selectedMonth} onValueChange={setMonthChoice} disabled={allLoading && monthOptions.length === 0}>
              <SelectTrigger id="report-month" size="sm" className="w-44">
                <SelectValue placeholder="Pick a month" />
              </SelectTrigger>
              <SelectContent>
                {(monthOptions.length > 0 ? monthOptions : [selectedMonth]).map((m) => (
                  <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === 'year' && (
          <div className="grid gap-1.5">
            <Label htmlFor="report-year" className="text-muted-foreground text-xs font-medium">Year</Label>
            <Select value={selectedYear} onValueChange={setYearChoice} disabled={allLoading && yearOptions.length === 0}>
              <SelectTrigger id="report-year" size="sm" className="w-28">
                <SelectValue placeholder="Pick a year" />
              </SelectTrigger>
              <SelectContent>
                {(yearOptions.length > 0 ? yearOptions : [selectedYear]).map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === 'custom' && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="report-start" className="text-muted-foreground text-xs font-medium">Start</Label>
              <Input
                id="report-start"
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-end" className="text-muted-foreground text-xs font-medium">End (inclusive)</Label>
              <Input
                id="report-end"
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            {customStart && customEnd && !customValid && (
              <p className="text-destructive pb-1.5 text-xs">End date must be on or after the start date.</p>
            )}
          </>
        )}
      </div>

      {/* Stat cards — selected window vs previous equivalent window */}
      {reportWindow === null ? null : totals === null && !currentError ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : totals ? (
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Referrals" value={totals.visitors.toLocaleString()} trend={prevTotals ? delta(totals.visitors, prevTotals.visitors) : null} />
          <StatCard label="Conversions" value={totals.conversions.toLocaleString()} trend={prevTotals ? delta(totals.conversions, prevTotals.conversions) : null} />
          <StatCard label="Revenue" value={fmt(totals.salesCents)} trend={prevTotals ? delta(totals.salesCents, prevTotals.salesCents) : null} />
          <StatCard label="Commissions" value={fmt(totals.commissionsCents)} trend={prevTotals ? delta(totals.commissionsCents, prevTotals.commissionsCents) : null} />
        </div>
      ) : null}

      {/* Summary chart + table for the selected window */}
      {reportWindow !== null && (
        <MonthlySummary
          report={{
            data: current,
            error: currentError,
            bucket: reportWindow.bucket,
            csvName,
            description: subtitle,
          }}
        />
      )}

      {/* Month-on-Month bounded to the report window */}
      {(allLoading || momRows.length > 0) && (
        <SectionCard
          title="Month-on-Month"
          description={mode === 'custom' ? 'Monthly rollups across the selected period' : `Monthly rollups across ${mode === 'month' ? selectedMonth.slice(0, 4) : selectedYear}`}
          open={monthlyExpanded}
          onOpenChange={setMonthlyExpanded}
        >
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            <MonthlyRangeChart kind="counts" rows={momRows} loading={allLoading && momRows.length === 0} />
            <MonthlyRangeChart kind="money" rows={momRows} loading={allLoading && momRows.length === 0} />
          </div>
          <ExpandableRows items={momRows} preview={5} perPage={12} label="months" render={(rows) => (
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
                  {rows.map((m) => (
                    <TableRow key={m.month} className={cn(mode === 'month' && m.month === selectedMonth && 'bg-muted/50')}>
                      <TableCell className="px-5 font-medium">
                        {monthLabel(m.month)}
                        {mode === 'month' && m.month === selectedMonth && (
                          <Badge variant="outline" className="ms-2 rounded-full text-xs">Selected</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.visitors.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{m.conversions.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="rounded-full tabular-nums">{pct(m.conversions, m.visitors)}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fmt(m.salesCents)}</TableCell>
                      <TableCell className="text-muted-foreground px-5 text-right tabular-nums">{fmt(m.commissionsCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )} />
        </SectionCard>
      )}
    </div>
  );
}
