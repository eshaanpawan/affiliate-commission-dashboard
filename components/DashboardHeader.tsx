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

const PAGE_META: Record<string, { label: string; source: string }> = {
  '/': { label: 'Program overview', source: 'Rewardful + Dub + PostHog intelligence' },
  '/monthly': { label: 'Monthly performance', source: 'Rewardful + Dub + PostHog intelligence' },
  '/affiliates': { label: 'Affiliate directory', source: 'Rewardful + Dub + PostHog intelligence' },
  '/countries': { label: 'Geography', source: 'Rewardful + Dub + PostHog intelligence' },
  '/leaderboard': { label: 'Leaderboard', source: 'Rewardful + Dub + PostHog intelligence' },
  '/funnel': { label: 'Funnel intelligence', source: 'Rewardful + Dub + PostHog intelligence' },
  '/growth': { label: 'Affiliate growth', source: 'Rewardful + Dub + PostHog intelligence' },
  '/mail': { label: 'Mail Center', source: 'Rewardful + Instantly' },
  '/warroom': { label: 'Fraud war room', source: 'Rewardful + Dub + PostHog intelligence' },
  '/payouts': { label: 'Payout review', source: 'Rewardful operations' },
  '/enforcement': { label: 'Enforcement', source: 'Rewardful operations' },
};

export function DashboardHeader() {
  const pathname = usePathname();
  const { range, setRange, refresh, syncing, syncRewardful } = useDashboardRange();
  const meta = PAGE_META[pathname] ?? {
    label: 'Affiliate operations',
    source: 'Rewardful + Dub + PostHog intelligence',
  };

  return (
    <header className="sticky top-0 z-50 flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-5">
      <SidebarTrigger className="-ml-1 shrink-0 md:hidden" aria-label="Open navigation" />
      <Separator orientation="vertical" className="mr-1 !h-4 md:hidden" />
      <div className="mr-auto min-w-0">
        <p className="truncate text-sm font-semibold">{meta.label}</p>
        <p className="hidden text-[11px] text-muted-foreground sm:block">{meta.source}</p>
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
            <span className="hidden xl:inline">{syncing ? 'Syncing…' : 'Sync all sources'}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Pull source changes, then refresh dashboard data</TooltipContent>
      </Tooltip>
    </header>
  );
}
