'use client';

import * as React from 'react';

import { ChartRangeTabs } from '@/components/RangeTabs';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { DayOnDayChart } from '@/components/DayOnDayChart';
import { useDashboard, type DashboardData } from '@/lib/use-dashboard';
import type { DashboardRange } from '@/lib/dashboard-range';

interface BarDef { key: string; color: string; label: string; axis?: 'left' | 'right' }

export function DashboardDayChart({
  title,
  dataKey,
  bars,
  valuePrefix,
}: {
  title: string;
  dataKey: keyof DashboardData['charts'];
  bars: BarDef[];
  valuePrefix?: string;
}) {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = React.useState<DashboardRange | null>(null);
  const { data, loading } = useDashboard(rangeOverride);
  const rows = (data?.charts[dataKey] ?? []) as Record<string, unknown>[];

  return (
    <DayOnDayChart
      title={title}
      data={rows}
      bars={bars}
      valuePrefix={valuePrefix}
      loading={loading}
      action={(
        <ChartRangeTabs
          value={rangeOverride}
          globalRange={globalRange}
          onChange={setRangeOverride}
        />
      )}
    />
  );
}
