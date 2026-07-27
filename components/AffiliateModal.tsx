'use client';

import { useEffect, useState } from 'react';

import { DayOnDayChart } from '@/components/DayOnDayChart';
import { fmtCents as fmt, pct } from '@/lib/format';
import type { Affiliate } from '@/lib/use-dashboard';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ChartRangeTabs } from '@/components/RangeTabs';
import type { DashboardRange } from '@/lib/dashboard-range';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';

interface AffiliateDetail {
  dailyReferrals: { day: string; total: number; converted: number }[];
  dailyRevenue: { day: string; usd: number }[];
  dailyCommissions: { day: string; usd: number }[];
}

const affiliateDetailCache = new Map<string, Promise<AffiliateDetail>>();

function useAffiliateDetail(affiliateId: string, range: DashboardRange) {
  const [detail, setDetail] = useState<AffiliateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const key = `${affiliateId}:${range}`;
    let request = affiliateDetailCache.get(key);
    if (!request) {
      request = fetch(`/api/affiliates/${affiliateId}?period=${range}`, { cache: 'no-store' }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? 'Affiliate detail failed');
        return payload as AffiliateDetail;
      }).finally(() => affiliateDetailCache.delete(key));
      affiliateDetailCache.set(key, request);
    }
    request.then((payload) => { if (!cancelled) setDetail(payload); }).catch(() => { if (!cancelled) setDetail(null); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [affiliateId, range]);
  return { detail, loading };
}

function AffiliateDetailChart({ affiliateId, title, dataKey, bars, valuePrefix }: {
  affiliateId: string;
  title: string;
  dataKey: keyof AffiliateDetail;
  bars: { key: string; color: string; label: string; axis?: 'left' | 'right' }[];
  valuePrefix?: string;
}) {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const { detail, loading } = useAffiliateDetail(affiliateId, rangeOverride ?? globalRange);
  return <DayOnDayChart title={title} data={(detail?.[dataKey] ?? []) as Record<string, unknown>[]} bars={bars} valuePrefix={valuePrefix} loading={loading} action={<ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} />} />;
}

export function AffiliateModal({ affiliate, ftsCountries, ftsTotal, onClose }: {
  affiliate: Affiliate;
  ftsCountries: { code: string; name: string; count: number }[];
  ftsTotal: number;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{affiliate.name}</DialogTitle>
          <DialogDescription>{affiliate.email}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-0.5 text-xs">Referrals</p>
            <p className="text-xl font-bold tabular-nums">{affiliate.referrals}</p>
            <p className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-400">{affiliate.referralsToday} today</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-0.5 text-xs">Conversions</p>
            <p className="text-xl font-bold tabular-nums">{affiliate.conversions}</p>
            <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400">{affiliate.conversionsToday} today</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-0.5 text-xs">Revenue</p>
            <p className="text-xl font-bold tabular-nums">{fmt(affiliate.revenueCents)}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{pct(affiliate.conversions, affiliate.referrals)} conv. rate</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-0.5 text-xs">Commission</p>
            <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(affiliate.commissionCents)}</p>
            <div className="mt-1">
              <Badge variant={affiliate.status === 'active' ? 'default' : 'secondary'}>{affiliate.status}</Badge>
            </div>
          </div>
        </div>

        <div className="space-y-4">
            <AffiliateDetailChart
              affiliateId={affiliate.id}
              title="Referrals & conversions"
              dataKey="dailyReferrals"
              bars={[
                { key: 'total', color: 'var(--chart-10)', label: 'Referrals', axis: 'left' },
                { key: 'converted', color: 'var(--chart-2)', label: 'Conversions', axis: 'right' },
              ]}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <AffiliateDetailChart affiliateId={affiliate.id} title="Revenue" dataKey="dailyRevenue" bars={[{ key: 'usd', color: 'var(--chart-1)', label: 'Revenue' }]} valuePrefix="$" />
              <AffiliateDetailChart affiliateId={affiliate.id} title="Commissions" dataKey="dailyCommissions" bars={[{ key: 'usd', color: 'var(--chart-3)', label: 'Commissions' }]} valuePrefix="$" />
            </div>
            {ftsCountries.length > 0 && (
              <Card className="gap-3">
                <CardHeader>
                  <CardTitle className="text-sm">Paying customers by country</CardTitle>
                  <CardDescription className="text-xs">
                    {ftsTotal} FTS · {ftsCountries.length} {ftsCountries.length === 1 ? 'country' : 'countries'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ftsCountries.slice(0, 10).map((c) => {
                    const pctOfTotal = ftsTotal > 0 ? (c.count / ftsTotal) * 100 : 0;
                    return (
                      <div key={c.code} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-28 truncate">{c.name}</span>
                        <Progress value={pctOfTotal} className="h-2 flex-1" />
                        <span className="w-10 text-right font-medium tabular-nums">{c.count}</span>
                        <span className="text-muted-foreground w-12 text-right text-[10px] tabular-nums">{pctOfTotal.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                  {ftsCountries.length > 10 && (
                    <p className="text-muted-foreground pt-1 text-[11px]">…and {ftsCountries.length - 10} more countries</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
      </DialogContent>
    </Dialog>
  );
}
