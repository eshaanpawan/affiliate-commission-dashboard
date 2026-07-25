'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

export function MetricCard({ label, value, sub }: MetricCardProps) {
  return (
    <Card className="gap-0 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="mt-1 text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub && (
        <CardContent className="px-4">
          <p className="text-muted-foreground mt-1 text-xs">{sub}</p>
        </CardContent>
      )}
    </Card>
  );
}
