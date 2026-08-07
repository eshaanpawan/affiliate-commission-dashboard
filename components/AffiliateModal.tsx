'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, CircleDollarSign, Clock3, Landmark, MessageCircle } from 'lucide-react';
import { dubMessageUrl, isDubPartner } from '@/lib/dub-links';

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
import { Skeleton } from '@/components/ui/skeleton';

interface AffiliateDetail {
  dailyReferrals: { day: string; total: number; converted: number }[];
  dailyRevenue: { day: string; usd: number }[];
  dailyCommissions: { day: string; usd: number }[];
}

interface AffiliateCommissionSummary {
  dueCents: number;
  pendingCents: number;
  unpaidCents: number;
  paidCents: number;
  dueCount: number;
  pendingCount: number;
  paidCount: number;
  nextDueAt: string | null;
  fetchedAt: string;
  source: 'rewardful' | 'local_cache';
  accurate: boolean;
}

const affiliateDetailCache = new Map<string, Promise<AffiliateDetail>>();
const affiliateCommissionCache = new Map<string, Promise<AffiliateCommissionSummary>>();

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

function useAffiliateCommissionSummary(affiliateId: string) {
  const [summary, setSummary] = useState<AffiliateCommissionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let request = affiliateCommissionCache.get(affiliateId);
    if (!request) {
      request = fetch(`/api/affiliates/${affiliateId}/commission-summary`, { cache: 'no-store' })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload?.error ?? 'Commission summary failed');
          return payload.summary as AffiliateCommissionSummary;
        })
        .finally(() => affiliateCommissionCache.delete(affiliateId));
      affiliateCommissionCache.set(affiliateId, request);
    }

    request
      .then((payload) => { if (!cancelled) setSummary(payload); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [affiliateId]);

  return { summary, loading };
}

function SettlementSummary({ affiliateId }: { affiliateId: string }) {
  const { summary, loading } = useAffiliateCommissionSummary(affiliateId);

  if (loading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (!summary) {
    return (
      <Card className="border-dashed py-4">
        <CardContent className="text-muted-foreground text-sm">
          Commission due-state is temporarily unavailable.
        </CardContent>
      </Card>
    );
  }

  const nextDueLabel = summary.nextDueAt
    ? new Date(summary.nextDueAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    : null;

  const metrics = [
    {
      label: 'Due now',
      value: fmt(summary.dueCents),
      detail: `${summary.dueCount.toLocaleString()} commissions ready`,
      icon: Landmark,
      tone: 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100',
    },
    {
      label: 'Not due yet',
      value: fmt(summary.pendingCents),
      detail: `${summary.pendingCount.toLocaleString()} commissions waiting`,
      icon: Clock3,
      tone: 'border-sky-200 bg-sky-50/70 text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100',
    },
    {
      label: 'Total unpaid',
      value: fmt(summary.unpaidCents),
      detail: 'Due now + not due yet',
      icon: CircleDollarSign,
      tone: 'border-border bg-card text-foreground',
    },
    {
      label: 'Paid to date',
      value: fmt(summary.paidCents),
      detail: `${summary.paidCount.toLocaleString()} commissions paid`,
      icon: CalendarClock,
      tone: 'border-border bg-muted/40 text-foreground',
    },
  ];

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Commission settlement</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              What can be paid now versus what is still waiting to become due.
            </CardDescription>
          </div>
          <Badge variant={summary.accurate ? 'outline' : 'secondary'} className="text-[10px]">
            {summary.accurate ? 'Live Rewardful' : 'Cached estimate'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(({ label, value, detail, icon: Icon, tone }) => (
          <div key={label} className={`rounded-lg border p-3 ${tone}`}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <Icon className="size-3.5" /> {label}
            </div>
            <p className="text-lg font-bold tabular-nums">{value}</p>
            <p className="mt-0.5 text-[10px] opacity-70">{detail}</p>
          </div>
        ))}
      </CardContent>
      <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        {nextDueLabel
          ? `Next pending commission becomes due on ${nextDueLabel}.`
          : summary.pendingCents > 0
            ? 'Next due date is unavailable in the cached data.'
            : 'No commission is waiting for a future due date.'}
      </div>
    </Card>
  );
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
          <DialogDescription>
            {isDubPartner(affiliate.source, affiliate.id) ? (
              <a
                href={dubMessageUrl(affiliate.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
              >
                <MessageCircle className="size-3.5" />
                {affiliate.email || 'Message on Dub'} — open Dub message center
              </a>
            ) : (
              <a href={`mailto:${affiliate.email}`} className="hover:underline">{affiliate.email}</a>
            )}
          </DialogDescription>
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

        <SettlementSummary affiliateId={affiliate.id} />

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
