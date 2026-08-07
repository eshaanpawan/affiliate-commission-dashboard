'use client';

import { RotateCcw } from 'lucide-react';

import {
  DASHBOARD_RANGE_LABELS,
  DASHBOARD_RANGES,
  type DashboardRange,
} from '@/lib/dashboard-range';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function GlobalRangeTabs({ value, onChange }: {
  value: DashboardRange;
  onChange: (value: DashboardRange) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as DashboardRange)}>
      <TabsList aria-label="Global reporting window" className="h-8">
        {DASHBOARD_RANGES.map((range) => (
          <TabsTrigger key={range} value={range} className="h-7 px-2.5 text-xs">
            {DASHBOARD_RANGE_LABELS[range]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function ChartRangeTabs({ value, globalRange, onChange, ranges = DASHBOARD_RANGES }: {
  value: DashboardRange | null;
  globalRange: DashboardRange;
  onChange: (value: DashboardRange | null) => void;
  ranges?: readonly DashboardRange[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      {value !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Reset chart to global ${DASHBOARD_RANGE_LABELS[globalRange]} range`}
              onClick={() => onChange(null)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Use global range ({DASHBOARD_RANGE_LABELS[globalRange]})</TooltipContent>
        </Tooltip>
      )}
      <Tabs
        value={value ?? globalRange}
        onValueChange={(next) => onChange(next as DashboardRange)}
      >
        <TabsList aria-label="Chart reporting window" className="h-8">
          {ranges.map((range) => (
            <TabsTrigger key={range} value={range} className="h-7 px-2 text-[11px]">
              {DASHBOARD_RANGE_LABELS[range]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
