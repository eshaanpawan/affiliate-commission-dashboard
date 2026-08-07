'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
}

export function MetricCard({ label, value, sub, onClick }: MetricCardProps) {
  return (
    <Card
      className={`gap-0 py-4 ${onClick ? 'cursor-pointer transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/20' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
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
