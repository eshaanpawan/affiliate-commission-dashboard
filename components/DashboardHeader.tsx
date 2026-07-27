'use client';

import { usePathname } from 'next/navigation';
import { DatabaseZap, RefreshCw } from 'lucide-react';

import { ModeToggle } from '@/components/ModeToggle';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { GlobalRangeTabs } from '@/components/RangeTabs';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const PAGE_NAMES: Record<string, string> = {
  '/': 'Program overview',
  '/monthly': 'Monthly performance',
  '/affiliates': 'Affiliate directory',
  '/countries': 'Geography',
  '/leaderboard': 'Leaderboard',
  '/funnel': 'Funnel intelligence',
  '/growth': 'Affiliate growth',
  '/mail': 'Affiliate mail center',
  '/warroom': 'Fraud war room',
  '/payouts': 'Payout review',
  '/enforcement': 'Enforcement',
};

export function DashboardHeader() {
  const pathname = usePathname();
  const { range, setRange, refresh, syncing, syncRewardful } = useDashboardRange();
  const label = PAGE_NAMES[pathname] ?? 'Affiliate operations';

  return (
    <header className="sticky top-0 z-50 flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-5">
      <SidebarTrigger className="-ml-1 shrink-0 md:hidden" aria-label="Open navigation" />
      <Separator orientation="vertical" className="mr-1 !h-4 md:hidden" />
      <div className="mr-auto min-w-0">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="hidden text-[11px] text-muted-foreground sm:block">Rewardful + PostHog intelligence</p>
      </div>
      <div className="order-3 flex w-full items-center justify-end overflow-x-auto border-t pt-2 sm:order-none sm:w-auto sm:border-0 sm:pt-0">
        <GlobalRangeTabs value={range} onChange={setRange} />
      </div>
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
            <span className="hidden xl:inline">{syncing ? 'Syncing…' : 'Sync Rewardful'}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Pull source changes, then refresh dashboard data</TooltipContent>
      </Tooltip>
    </header>
  );
}
