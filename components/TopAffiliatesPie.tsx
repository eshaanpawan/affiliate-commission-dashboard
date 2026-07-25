'use client';

import { Cell, Pie, PieChart } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

const COLORS = Array.from({ length: 10 }, (_, i) => `var(--chart-${i + 1})`);

interface Props {
  title: string;
  data: { name: string; value: number }[];
  label: string;
}

export function TopAffiliatesPie({ title, data, label }: Props) {
  const positive = data.filter((d) => d.value > 0);
  const top10 = positive.slice(0, 10);
  const othersTotal = positive.slice(10).reduce((sum, d) => sum + d.value, 0);
  const filtered = othersTotal > 0 ? [...top10, { name: 'Others', value: othersTotal }] : top10;

  const config: ChartConfig = Object.fromEntries(
    filtered.map((d, i) => [d.name, { label: d.name, color: COLORS[i % COLORS.length] }]),
  );

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">No data yet</div>
        ) : (
          <ChartContainer config={config} className="mx-auto h-[260px] w-full">
            <PieChart>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    nameKey="name"
                    formatter={(value, name) => [`${value} ${label}`, name] as unknown as React.ReactNode}
                  />
                }
              />
              <Pie data={filtered} cx="50%" cy="45%" outerRadius={90} dataKey="value" nameKey="name">
                {filtered.map((d, i) => (
                  <Cell key={d.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="name" className="flex-wrap gap-x-3 gap-y-1 text-[11px]" />} />
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
