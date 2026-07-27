'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { DashboardRange, isDashboardRange } from '@/lib/dashboard-range';

interface DashboardRangeContextValue {
  range: DashboardRange;
  setRange: (range: DashboardRange) => void;
  refreshVersion: number;
  refresh: () => void;
  syncing: boolean;
  syncRewardful: () => Promise<void>;
}

const DashboardRangeContext = React.createContext<DashboardRangeContextValue | null>(null);

export function DashboardRangeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryRange = searchParams.get('range');
  const [range, setRangeState] = React.useState<DashboardRange>(() =>
    isDashboardRange(queryRange) ? queryRange : 'all',
  );
  const [refreshVersion, setRefreshVersion] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);

  React.useEffect(() => {
    if (isDashboardRange(queryRange) && queryRange !== range) setRangeState(queryRange);
  }, [queryRange, range]);

  const setRange = React.useCallback((next: DashboardRange) => {
    setRangeState(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.delete('range');
    else params.set('range', next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const refresh = React.useCallback(() => setRefreshVersion((value) => value + 1), []);

  const syncRewardful = React.useCallback(async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/sync', { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? `Sync failed (${response.status})`);
      refresh();
      toast.success('Rewardful sync completed', {
        description: payload?.message ?? 'Dashboard data is being refreshed.',
      });
    } catch (error) {
      toast.error('Rewardful sync failed', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const value = React.useMemo(() => ({
    range,
    setRange,
    refreshVersion,
    refresh,
    syncing,
    syncRewardful,
  }), [range, setRange, refreshVersion, refresh, syncing, syncRewardful]);

  return <DashboardRangeContext.Provider value={value}>{children}</DashboardRangeContext.Provider>;
}

export function useDashboardRange() {
  const context = React.useContext(DashboardRangeContext);
  if (!context) throw new Error('useDashboardRange must be used inside DashboardRangeProvider');
  return context;
}
