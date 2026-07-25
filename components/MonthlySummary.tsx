'use client';

import * as React from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface MonthlyRow {
  month: string;
  visitors: number;
  leads: number;
  conversions: number;
  salesCents: number;
  commissionsCents: number;
  netCents: number;
}

interface MonthlyResponse {
  months: MonthlyRow[];
  totals: Omit<MonthlyRow, 'month'>;
}

const chartConfig = {
  visitors: { label: 'Visitors', color: 'var(--chart-1)' },
  leads: { label: 'Leads', color: 'var(--chart-7)' },
  conversions: { label: 'Conversions', color: 'var(--chart-2)' },
  sales: { label: 'Sales', color: 'var(--chart-8)' },
  commissions: { label: 'Commissions', color: 'var(--chart-3)' },
} satisfies ChartConfig;

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function fmtCents(cents: number): string {
  return usd.format(cents / 100);
}

function fmtMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export function MonthlySummary() {
  const [data, setData] = React.useState<MonthlyResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [cumulative, setCumulative] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/monthly')
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((json: MonthlyResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = React.useMemo(() => {
    if (!data) return [];
    let v = 0, l = 0, c = 0, s = 0, cm = 0;
    return data.months.map((m) => {
      if (cumulative) {
        v += m.visitors; l += m.leads; c += m.conversions;
        s += m.salesCents; cm += m.commissionsCents;
        return {
          month: fmtMonthLabel(m.month),
          visitors: v,
          leads: l,
          conversions: c,
          sales: Math.round(s) / 100,
          commissions: Math.round(cm) / 100,
        };
      }
      return {
        month: fmtMonthLabel(m.month),
        visitors: m.visitors,
        leads: m.leads,
        conversions: m.conversions,
        sales: m.salesCents / 100,
        commissions: m.commissionsCents / 100,
      };
    });
  }, [data, cumulative]);

  const downloadCsv = React.useCallback(() => {
    if (!data) return;
    const header = 'Month,Visitors,Leads,Conversions,Sales,Commissions,Net';
    const lines = data.months.map((m) =>
      [
        m.month,
        m.visitors,
        m.leads,
        m.conversions,
        (m.salesCents / 100).toFixed(2),
        (m.commissionsCents / 100).toFixed(2),
        (m.netCents / 100).toFixed(2),
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'monthly-summary.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Summary</CardTitle>
        <CardDescription>
          Month-by-month activity across the affiliate program
        </CardDescription>
        <CardAction className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="monthly-cumulative"
              checked={cumulative}
              onCheckedChange={setCumulative}
            />
            <Label htmlFor="monthly-cumulative" className="text-muted-foreground text-sm font-normal">
              Show cumulative values
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!data}>
            Download CSV
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            Failed to load monthly summary — {error}
          </div>
        ) : !data ? (
          <div className="space-y-4">
            <Skeleton className="h-[320px] w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : data.months.length === 0 ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            No monthly data yet
          </div>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-[320px] w-full">
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 11 }}
                  minTickGap={16}
                />
                <YAxis
                  yAxisId="left"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `$${v.toLocaleString('en-US')}`}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) =>
                        [
                          name === 'sales' || name === 'commissions'
                            ? usd.format(Number(value))
                            : Number(value).toLocaleString('en-US'),
                          ` ${chartConfig[name as keyof typeof chartConfig]?.label ?? name}`,
                        ] as unknown as React.ReactNode
                      }
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Line yAxisId="left" type="monotone" dataKey="visitors" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="left" type="monotone" dataKey="leads" stroke="var(--chart-7)" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="left" type="monotone" dataKey="conversions" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="sales" stroke="var(--chart-8)" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="commissions" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Visitors</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Conversions</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Commissions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...data.months].reverse().map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-medium">{fmtMonthLabel(m.month)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.visitors.toLocaleString('en-US')}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.leads.toLocaleString('en-US')}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.conversions.toLocaleString('en-US')}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCents(m.salesCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCents(m.commissionsCents)}</TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          m.netCents < 0 && 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {fmtCents(m.netCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right tabular-nums">{data.totals.visitors.toLocaleString('en-US')}</TableCell>
                    <TableCell className="text-right tabular-nums">{data.totals.leads.toLocaleString('en-US')}</TableCell>
                    <TableCell className="text-right tabular-nums">{data.totals.conversions.toLocaleString('en-US')}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCents(data.totals.salesCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCents(data.totals.commissionsCents)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        data.totals.netCents < 0 && 'text-red-600 dark:text-red-400',
                      )}
                    >
                      {fmtCents(data.totals.netCents)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
