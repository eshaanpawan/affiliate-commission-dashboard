'use client';

// Inline page controls — replaces the old sticky top bar. Rendered inside each
// page's own header row: range tabs + theme toggle + refresh + sync.

import { useSyncExternalStore } from 'react';
import { DatabaseZap, LoaderCircle, RefreshCw } from 'lucide-react';

import { ModeToggle } from '@/components/ModeToggle';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { getRefreshCount, subscribeRefresh } from '@/lib/client-cache';
import { GlobalRangeTabs } from '@/components/RangeTabs';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function PageControls() {
  const { range, setRange, refresh, syncing, syncRewardful } = useDashboardRange();
  const refreshing = useSyncExternalStore(subscribeRefresh, getRefreshCount, () => 0) > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" aria-label="Open navigation" />
      {refreshing ? (
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs" role="status" aria-live="polite">
          <LoaderCircle className="size-3.5 animate-spin" />
          <span className="hidden sm:inline">Updating data — showing last known values</span>
        </span>
      ) : null}
      <GlobalRangeTabs value={range} onChange={setRange} />
      <ModeToggle />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="outline" size="icon-sm" onClick={refresh} aria-label="Refresh current dashboard range">
            <RefreshCw className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh this reporting window</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" size="sm" onClick={syncRewardful} disabled={syncing}>
            <DatabaseZap className={syncing ? 'size-3.5 animate-pulse' : 'size-3.5'} />
            <span className="hidden lg:inline">{syncing ? 'Syncing…' : 'Sync all sources'}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Pull source changes, then refresh dashboard data</TooltipContent>
      </Tooltip>
    </div>
  );
}
