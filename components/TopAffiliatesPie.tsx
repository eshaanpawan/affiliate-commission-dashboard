'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

interface Props {
  title: string;
  data: { name: string; value: number }[];
  label: string;
  action?: React.ReactNode;
  loading?: boolean;
}

export function TopAffiliatesPie({ title, data, label, action, loading = false }: Props) {
  const positive = data.filter((d) => d.value > 0);
  const filtered = positive.slice(0, 10);

  const config = { value: { label, color: 'var(--chart-2)' } } satisfies ChartConfig;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[260px] w-full" aria-label={`Loading ${title}`} />
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">No data yet</div>
        ) : (
          <ChartContainer config={config} className="mx-auto h-[300px] w-full">
            <BarChart data={filtered} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={128} tickFormatter={(value: string) => value.length > 18 ? `${value.slice(0, 18)}…` : value} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value) => [`${value} ${label}`, label] as unknown as React.ReactNode} />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
