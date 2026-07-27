'use client';

import * as React from 'react';

import { ChartRangeTabs } from '@/components/RangeTabs';
import { TopAffiliatesPie } from '@/components/TopAffiliatesPie';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { useDashboard, type DashboardData } from '@/lib/use-dashboard';
import type { DashboardRange } from '@/lib/dashboard-range';

export function DashboardTopAffiliatesPie({
  title,
  dataKey,
  label,
}: {
  title: string;
  dataKey: 'topByReferrals' | 'topByConversions';
  label: string;
}) {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = React.useState<DashboardRange | null>(null);
  const { data, loading } = useDashboard(rangeOverride);

  return (
    <TopAffiliatesPie
      title={title}
      data={(data?.[dataKey] ?? []) as DashboardData[typeof dataKey]}
      label={label}
      loading={loading}
      action={<ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} />}
    />
  );
}
