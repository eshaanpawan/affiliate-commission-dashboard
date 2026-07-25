'use client';

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

interface BarDef { key: string; color: string; label: string; axis?: 'left' | 'right' }

interface DayOnDayChartProps {
  title: string;
  data: Record<string, unknown>[];
  bars: BarDef[];
  valuePrefix?: string;
  secondaryKey?: string; // key to show as line on right Y-axis
}

export function DayOnDayChart({ title, data, bars, valuePrefix = '', secondaryKey }: DayOnDayChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    day: (() => {
      const raw = d.day as string;
      const parsed = raw.includes('T') ? new Date(raw) : new Date(raw + 'T12:00:00');
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    })(),
  }));

  const primaryBars = bars.filter((b) => b.axis !== 'right');
  const secondaryBar = bars.find((b) => b.axis === 'right') ?? (secondaryKey ? bars.find((b) => b.key === secondaryKey) : null);
  const mainBars = secondaryBar ? bars.filter((b) => b.key !== secondaryBar.key) : primaryBars;

  const config: ChartConfig = Object.fromEntries(
    bars.map((b) => [b.key, { label: b.label, color: b.color }]),
  );

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            No data yet — waiting for webhook events
          </div>
        ) : (
          <ChartContainer config={config} className="h-[200px] w-full">
            <ComposedChart data={formatted} margin={{ top: 4, right: secondaryBar ? 12 : 4, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} minTickGap={16} />
              <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
              {secondaryBar && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: secondaryBar.color }}
                  width={32}
                />
              )}
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent formatter={(v, name) => [`${valuePrefix}${v}`, config[name as string]?.label ?? name] as unknown as React.ReactNode} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              {mainBars.map((b) => (
                <Bar key={b.key} yAxisId="left" dataKey={b.key} name={b.key} fill={b.color} radius={[3, 3, 0, 0]} />
              ))}
              {secondaryBar && (
                <Line
                  key={secondaryBar.key}
                  yAxisId="right"
                  type="monotone"
                  dataKey={secondaryBar.key}
                  name={secondaryBar.key}
                  stroke={secondaryBar.color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: secondaryBar.color }}
                />
              )}
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
