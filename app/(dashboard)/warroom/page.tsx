'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  DollarSign,
  ExternalLink,
  FileSearch,
  Globe2,
  KeyRound,
  Loader2,
  Megaphone,
  Network,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRoundSearch,
  Users,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ChartRangeTabs } from '@/components/RangeTabs';
import type { DashboardRange } from '@/lib/dashboard-range';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent,
} from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/* ---------- types mirrored from /api/warroom ---------- */

interface RiskSignal { key: string; label: string; severity: string; value: string; detail: string }
interface WarAffiliate {
  id: string; name: string; email: string | null;
  rewardfulStatus: string; reviewStatus: string; enforcementState: string;
  fraudTags: string[]; tokens: string[];
  unpaidCommissionCents: number; paidCommissionCents: number;
  conversions: number; clicks: number; holdStatus: string | null;
  countries: { code: string; name: string; conversions: number }[];
  observedAdTerms: {
    field: 'utm_term' | 'utm_campaign';
    value: string;
    referrals: number;
    brandMatch: boolean;
  }[];
  commercialAssessment: 'productive_unproven' | 'nonconverting_paid' | 'insufficient_evidence';
  risk: {
    score: number; band: 'low' | 'medium' | 'high'; signals: RiskSignal[];
    stats: {
      signups: number; adSignups: number; adPct: number; fts: number; pageviews: number;
      organicSignups: number; campaignIds: string[]; ourCampaignIds: string[];
      sharedCampaignIds: string[]; tokens: string[];
      networks: Record<AdNetworkKey, number>;
    };
  };
}
interface WarRoomData {
  window: { days: number };
  summary: {
    totalSignups: number; adSignups: number; adPct: number; totalFts: number; totalPageviews: number;
    affiliatesRunningAds: number; campaignHijackers: number; ringMembers: number;
    highRisk: number; mediumRisk: number; unpaidAtRiskCents: number; unpaidTotalCents: number;
    proposedBans: number; banned: number;
    networkSignups: Record<AdNetworkKey, number>;
  };
  daily: { day: string; signups: number; adSignups: number; organicSignups: number; fts: number; pageviews: number }[];
  affiliates: WarAffiliate[];
  campaignOverlap: { campaignId: string; isOurs: boolean; affiliates: { id: string; name: string }[] }[];
}

type AdNetworkKey = 'google' | 'meta' | 'microsoft' | 'tiktok' | 'linkedin' | 'reddit' | 'x' | 'apple';

const AD_NETWORKS: { key: AdNetworkKey; label: string; evidence: string }[] = [
  { key: 'google', label: 'Google Ads', evidence: 'gclid · gbraid · campaign ID' },
  { key: 'meta', label: 'Meta', evidence: 'fbclid' },
  { key: 'microsoft', label: 'Microsoft Ads', evidence: 'msclkid' },
  { key: 'tiktok', label: 'TikTok', evidence: 'ttclid' },
  { key: 'linkedin', label: 'LinkedIn', evidence: 'li_fat_id' },
  { key: 'reddit', label: 'Reddit', evidence: 'rdt_cid' },
  { key: 'x', label: 'X Ads', evidence: 'twclid' },
  { key: 'apple', label: 'Apple Search Ads', evidence: 'pt + ct · apple source' },
];

/* ---------- helpers ---------- */

const fmtUsd = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString();

function bandBadge(band: string) {
  return band === 'high' ? 'border-red-200 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
    : band === 'medium' ? 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300';
}
function enforcementBadge(state: string) {
  return state === 'banned' ? 'bg-red-600 text-white'
    : state === 'proposed_ban' ? 'bg-amber-500 text-white'
    : state === 'cleared' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : 'bg-muted text-muted-foreground';
}

const DAILY_CONFIG = {
  adSignups: { label: 'Ad-driven signups', color: 'var(--chart-1)' },
  organicSignups: { label: 'Organic signups', color: 'var(--chart-2)' },
  fts: { label: 'Paid conversions (FTS)', color: 'var(--chart-3)' },
} satisfies ChartConfig;

const FUNNEL_CONFIG = {
  ad: { label: 'Ad-driven', color: 'var(--chart-1)' },
  organic: { label: 'Organic', color: 'var(--chart-2)' },
} satisfies ChartConfig;

const warRoomCache = new Map<string, { at: number; data: WarRoomData }>();
const warRoomRequests = new Map<string, Promise<WarRoomData>>();

function rangeDays(range: DashboardRange): number {
  return range === 'all' ? 400 : Number.parseInt(range, 10);
}

function useWarRoomWindow(rangeOverride?: DashboardRange | null) {
  const dashboardRange = useDashboardRange();
  const effectiveRange = rangeOverride ?? dashboardRange.range;
  const days = rangeDays(effectiveRange);
  const [data, setData] = useState<WarRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const key = `${days}:${dashboardRange.refreshVersion}:${reloadVersion}`;
    const cached = warRoomCache.get(key);
    if (cached && Date.now() - cached.at < 15_000) {
      queueMicrotask(() => {
        if (!cancelled) {
          setData(cached.data);
          setLoading(false);
        }
      });
      return () => { cancelled = true; };
    }
    queueMicrotask(() => {
      if (!cancelled) {
        setData(null);
        setLoading(true);
      }
    });
    let request = warRoomRequests.get(key);
    if (!request) {
      request = fetch(`/api/warroom?days=${days}`, { cache: 'no-store' }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? `War room request failed (${response.status})`);
        warRoomCache.set(key, { at: Date.now(), data: payload });
        return payload as WarRoomData;
      }).finally(() => warRoomRequests.delete(key));
      warRoomRequests.set(key, request);
    }
    request.then((payload) => { if (!cancelled) setData(payload); }).catch(() => {
      if (!cancelled) toast.error('Failed to load war-room data');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dashboardRange.refreshVersion, days, reloadVersion]);

  return { data, loading, days, reload: () => setReloadVersion((value) => value + 1) };
}

function TrafficChartCard() {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const { data, loading } = useWarRoomWindow(rangeOverride);
  return (
    <Card className="gap-4 xl:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">Signups per day — ad-driven vs organic</CardTitle>
        <CardDescription className="text-xs">Stacked signups with paid conversions (FTS) overlaid</CardDescription>
        <CardAction><ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} /></CardAction>
      </CardHeader>
      <CardContent>
        {loading || !data ? <Skeleton className="h-[280px] w-full" /> : (
          <ChartContainer config={DAILY_CONFIG} className="h-[280px] w-full">
            <AreaChart data={data.daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
              <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => new Date(`${String(value)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area yAxisId="left" dataKey="adSignups" stackId="s" type="monotone" fill="var(--color-adSignups)" fillOpacity={0.5} stroke="var(--color-adSignups)" />
              <Area yAxisId="left" dataKey="organicSignups" stackId="s" type="monotone" fill="var(--color-organicSignups)" fillOpacity={0.5} stroke="var(--color-organicSignups)" />
              <Line yAxisId="right" dataKey="fts" type="monotone" stroke="var(--color-fts)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ProgramFunnelCard() {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const { data, loading } = useWarRoomWindow(rangeOverride);
  const summary = data?.summary;
  const funnelData = summary ? [
    { stage: 'Pageviews', ad: null as number | null, organic: null as number | null, total: summary.totalPageviews },
    { stage: 'Signups', ad: summary.adSignups, organic: summary.totalSignups - summary.adSignups, total: summary.totalSignups },
    { stage: 'Paid (FTS)', ad: null, organic: null, total: summary.totalFts },
  ] : [];
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm">Program funnel</CardTitle>
        <CardDescription className="text-xs">Pageview → Signup → Paid, ad vs organic</CardDescription>
        <CardAction><ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} /></CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading || !summary ? <Skeleton className="h-[220px] w-full" /> : <>
          <ChartContainer config={FUNNEL_CONFIG} className="h-[170px] w-full">
            <BarChart data={funnelData.filter((row) => row.ad !== null)} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis type="number" hide /><YAxis type="category" dataKey="stage" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={70} />
              <ChartTooltip content={<ChartTooltipContent />} /><ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="ad" stackId="f" fill="var(--color-ad)" radius={[3, 0, 0, 3]} /><Bar dataKey="organic" stackId="f" fill="var(--color-organic)" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ChartContainer>
          <div className="grid gap-1.5">{funnelData.map((row, index) => { const previous = funnelData[index - 1]; const rate = previous && previous.total > 0 ? (row.total / previous.total) * 100 : null; return <div key={row.stage} className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{row.stage}</span><span className="font-medium tabular-nums">{fmtInt(row.total)}{rate !== null && <span className="text-muted-foreground ml-1.5">({rate.toFixed(1)}% of prev)</span>}</span></div>; })}</div>
        </>}
      </CardContent>
    </Card>
  );
}

/* ---------- KPI card ---------- */

function Kpi({ icon: Icon, label, value, sub, tone, onClick, active }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: 'danger' | 'warn'; onClick?: () => void; active?: boolean;
}) {
  const content = (
    <CardHeader className="px-4">
      <div className="flex items-center gap-2">
        <div className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          tone === 'danger' ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400'
            : tone === 'warn' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400'
            : 'bg-primary/10 text-primary',
        )}>
          <Icon className="size-4" />
        </div>
        <CardDescription className="text-xs font-medium">{label}</CardDescription>
      </div>
      <CardTitle className="mt-1 text-2xl tabular-nums">{value}</CardTitle>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </CardHeader>
  );

  return (
    <Card
      className={cn(
        'gap-1 overflow-hidden py-0',
        onClick && 'hover:border-primary/40',
        active && 'border-primary ring-primary/20 ring-2',
        tone === 'danger' && 'border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10',
        tone === 'warn' && 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10',
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          className="w-full py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {content}
        </button>
      ) : (
        <div className="py-4">{content}</div>
      )}
    </Card>
  );
}

function NetworkEvidenceCard({ counts }: { counts: Record<AdNetworkKey, number> }) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const max = Math.max(1, ...Object.values(counts));

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="size-4" />
              Paid-network evidence
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl text-xs">
              Distinct signups carrying each network&apos;s click identifier on the first-touch URL. Counts can overlap
              when a redirect preserves more than one identifier; they prove attributed traffic, not who bought the ad.
            </CardDescription>
          </div>
          <Badge variant="outline" className="tabular-nums">{fmtInt(total)} network observations</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {AD_NETWORKS.map((network) => (
          <div key={network.key} className="rounded-xl border bg-muted/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold">{network.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{network.evidence}</p>
              </div>
              <p className="text-lg font-semibold tabular-nums">{fmtInt(counts[network.key])}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${counts[network.key] === 0 ? 0 : Math.max(3, (counts[network.key] / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PaginationControls({
  page,
  totalPages,
  totalItems,
  pageSize,
  itemLabel,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground tabular-nums">{start}–{end}</span> of{' '}
        <span className="font-medium text-foreground tabular-nums">{totalItems}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">Page {page} of {totalPages}</span>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={`Previous ${itemLabel} page`}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={`Next ${itemLabel} page`}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ---------- affiliate evidence drawer ---------- */

function AffiliateSheet({ a, onClose, onAction, busy }: {
  a: WarAffiliate; onClose: () => void;
  onAction: (action: 'propose' | 'clear', ids: string[]) => Promise<void>;
  busy: boolean;
}) {
  const s = a.risk.stats;
  const funnel = [
    { stage: 'Pageviews', ad: null, organic: null, total: s.pageviews },
    { stage: 'Signups', ad: s.adSignups, organic: s.organicSignups, total: s.signups },
    { stage: 'Paid (FTS)', ad: null, organic: null, total: s.fts },
  ];
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{a.name}</SheetTitle>
            <Badge variant="outline" className={cn('font-bold', bandBadge(a.risk.band))}>Risk {a.risk.score}</Badge>
            <Badge className={enforcementBadge(a.enforcementState)}>{a.enforcementState.replace('_', ' ')}</Badge>
            {a.holdStatus && <Badge variant="secondary">hold: {a.holdStatus}</Badge>}
          </div>
          <SheetDescription>{a.email ?? 'no email'} · Rewardful {a.rewardfulStatus}</SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4 pb-6">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {a.enforcementState !== 'banned' && a.enforcementState !== 'proposed_ban' && (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => onAction('propose', [a.id])}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
                Propose ban + freeze payout
              </Button>
            )}
            {(a.enforcementState === 'proposed_ban') && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('clear', [a.id])}>
                <CheckCircle2 className="size-3.5" /> Clear proposal
              </Button>
            )}
            {a.tokens[0] && (
              <Button asChild size="sm" variant="outline">
                <a href={`https://runable.com/?via=${a.tokens[0]}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> Open funnel
                </a>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <a href={`https://www.google.com/search?q=${encodeURIComponent(`"via=${a.tokens[0] ?? a.name}"`)}`} target="_blank" rel="noreferrer">
                <Search className="size-3.5" /> Find their ads
              </a>
            </Button>
          </div>

          {/* Money */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-red-50 p-3 dark:bg-red-500/10">
              <p className="text-muted-foreground text-xs">Unpaid (at risk)</p>
              <p className="text-lg font-bold tabular-nums text-red-700 dark:text-red-300">{fmtUsd(a.unpaidCommissionCents)}</p>
            </div>
            <div className="bg-muted rounded-lg p-3">
              <p className="text-muted-foreground text-xs">Already paid</p>
              <p className="text-lg font-bold tabular-nums">{fmtUsd(a.paidCommissionCents)}</p>
            </div>
          </div>

          <div className={cn('rounded-lg border p-3 text-xs leading-relaxed',
            a.commercialAssessment === 'productive_unproven' ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
              : a.commercialAssessment === 'nonconverting_paid' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                : 'text-muted-foreground')}>
            {a.commercialAssessment === 'productive_unproven'
              ? `Commercially productive (${a.risk.stats.fts} FTS), but incremental value is unproven. Run a holdout before calling this traffic beneficial.`
              : a.commercialAssessment === 'nonconverting_paid'
                ? `Paid acquisition produced ${a.risk.stats.adSignups} attributed signups and no FTS in this window.`
                : 'Not enough outcome volume to assess whether this traffic is incrementally beneficial.'}
          </div>

          {/* Funnel */}
          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Funnel (PostHog, window)</h3>
            <div className="space-y-1.5">
              {funnel.map((f) => {
                const max = Math.max(s.pageviews, s.signups, 1);
                return (
                  <div key={f.stage} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-20">{f.stage}</span>
                    <div className="bg-muted h-4 flex-1 overflow-hidden rounded">
                      {f.ad !== null ? (
                        <div className="flex h-full" style={{ width: `${(f.total / max) * 100}%` }}>
                          <div className="h-full bg-[var(--chart-1)]" style={{ width: `${f.total ? (f.ad / f.total) * 100 : 0}%` }} />
                          <div className="h-full bg-[var(--chart-2)]" style={{ width: `${f.total ? ((f.organic ?? 0) / f.total) * 100 : 0}%` }} />
                        </div>
                      ) : (
                        <div className="h-full bg-[var(--chart-3)]" style={{ width: `${(f.total / max) * 100}%` }} />
                      )}
                    </div>
                    <span className="w-16 text-right font-medium tabular-nums">{fmtInt(f.total)}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground mt-2 text-[11px]">
              <span className="font-semibold text-red-600 dark:text-red-400">{Math.round(s.adPct * 100)}%</span> of signups arrived
              carrying Google Ads click params · {fmtInt(s.organicSignups)} organic
            </p>
          </div>

          {/* Signals */}
          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Evidence</h3>
            {a.risk.signals.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                No ad-fraud signals fired in this window.
              </p>
            ) : (
              <div className="space-y-2">
                {a.risk.signals.map((sig) => (
                  <div key={sig.key} className="bg-muted rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <span className={cn('size-2 rounded-full', sig.severity === 'high' ? 'bg-red-500' : 'bg-amber-500')} />
                      <p className="text-sm font-semibold">{sig.label}</p>
                      <span className="text-muted-foreground text-xs">{sig.value}</span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{sig.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Top conversion markets</h3>
              {a.countries.length === 0 ? <p className="text-muted-foreground text-xs">No country-attributed conversions in this window.</p> : <div className="flex flex-wrap gap-1.5">{a.countries.slice(0, 8).map((country) => <Badge key={country.code} variant="secondary">{country.name} · {country.conversions}</Badge>)}</div>}
            </div>
            <div>
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Observed ad terms</h3>
              {a.observedAdTerms.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {a.observedAdTerms.map((term) => (
                    <Tooltip key={`${term.field}:${term.value}`}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className={cn(
                            'max-w-full gap-1 font-mono text-[10px]',
                            term.brandMatch && 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
                          )}
                        >
                          <span className="truncate">{term.value}</span>
                          <span className="shrink-0 tabular-nums">· {term.referrals}</span>
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        Captured in {term.field}{term.brandMatch ? ' · Runable brand match' : ''}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
                  No keyword or campaign term was captured in this window. Attach a country/device SERP capture or
                  Ads Transparency record before treating a brand-bidding inference as proven.
                </p>
              )}
            </div>
          </div>

          {/* Tokens + campaigns */}
          <div className="grid gap-3">
            <div>
              <h3 className="text-muted-foreground mb-1.5 text-xs font-semibold uppercase">Link tokens</h3>
              <div className="flex flex-wrap gap-1.5">
                {a.tokens.length === 0 ? <span className="text-muted-foreground text-xs">none seen in window</span>
                  : a.tokens.map(t => (
                    <Badge key={t} asChild variant="secondary" className="font-mono text-[10px]">
                      <a href={`https://runable.com/?via=${t}`} target="_blank" rel="noreferrer">?via={t}</a>
                    </Badge>
                  ))}
              </div>
            </div>
            {s.campaignIds.length > 0 && (
              <div>
                <h3 className="text-muted-foreground mb-1.5 text-xs font-semibold uppercase">Google Ads campaigns seen</h3>
                <div className="flex flex-wrap gap-1.5">
                  {s.campaignIds.map(cid => (
                    <Badge
                      key={cid}
                      variant="secondary"
                      className={cn('font-mono text-[10px]',
                        s.ourCampaignIds.includes(cid) && 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
                        !s.ourCampaignIds.includes(cid) && s.sharedCampaignIds.includes(cid) && 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300')}
                    >
                      {cid}{s.ourCampaignIds.includes(cid) ? ' · OURS' : s.sharedCampaignIds.includes(cid) ? ' · shared' : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type CampaignOverlap = WarRoomData['campaignOverlap'][number];

function CampaignCase({
  item,
  onOpenAffiliate,
}: {
  item: CampaignOverlap;
  onOpenAffiliate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = item.affiliates.slice(0, 3).map((affiliate) => affiliate.name).join(', ');

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={cn(
        'overflow-hidden rounded-xl border bg-card',
        item.isOurs && 'border-red-200 dark:border-red-500/30',
      )}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 p-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              item.isOurs
                ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                : 'bg-muted text-muted-foreground',
            )}>
              {item.isOurs ? <ShieldAlert className="size-4" /> : <Network className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">{item.campaignId}</span>
                <Badge variant={item.isOurs ? 'destructive' : 'secondary'} className="text-[10px]">
                  {item.isOurs ? 'Runable ID' : 'Shared ID'}
                </Badge>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {preview}{item.affiliates.length > 3 ? ` +${item.affiliates.length - 3} more` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">{item.affiliates.length}</p>
              <p className="text-[10px] text-muted-foreground">affiliates</p>
            </div>
            <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground', expanded && 'rotate-180')} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t bg-muted/25 p-3">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">
              Review every affiliate observed with this campaign identifier
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {item.affiliates.map((affiliate) => (
                <button
                  key={affiliate.id}
                  type="button"
                  onClick={() => onOpenAffiliate(affiliate.id)}
                  className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <UserRoundSearch className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{affiliate.name}</span>
                  <span className="text-[10px] text-muted-foreground">Open</span>
                </button>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function CampaignOverlapSection({
  items,
  onOpenAffiliate,
}: {
  items: CampaignOverlap[];
  onOpenAffiliate: (id: string) => void;
}) {
  const pageSize = 4;
  const [runablePage, setRunablePage] = useState(1);
  const [sharedPage, setSharedPage] = useState(1);
  const runableItems = items.filter((item) => item.isOurs);
  const sharedItems = items.filter((item) => !item.isOurs);
  const affected = new Set(items.flatMap((item) => item.affiliates.map((affiliate) => affiliate.id))).size;
  const runablePages = Math.max(1, Math.ceil(runableItems.length / pageSize));
  const sharedPages = Math.max(1, Math.ceil(sharedItems.length / pageSize));
  const activeRunablePage = Math.min(runablePage, runablePages);
  const activeSharedPage = Math.min(sharedPage, sharedPages);
  const visibleRunable = runableItems.slice(
    (activeRunablePage - 1) * pageSize,
    activeRunablePage * pageSize,
  );
  const visibleShared = sharedItems.slice(
    (activeSharedPage - 1) * pageSize,
    activeSharedPage * pageSize,
  );

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="size-4" />
              Campaign overlap investigations
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl text-xs">
              Grouped cases replace the raw name dump. A matching ID is an association signal—not proof of
              account ownership, keyword bidding, or wrongdoing.
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <ShieldCheck className="size-3" />
            Evidence review required
          </Badge>
        </div>
      </CardHeader>

      <div className="grid grid-cols-3 divide-x border-b bg-muted/25">
        <div className="p-4">
          <p className="text-[11px] text-muted-foreground">Runable IDs</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{runableItems.length}</p>
        </div>
        <div className="p-4">
          <p className="text-[11px] text-muted-foreground">Shared IDs</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{sharedItems.length}</p>
        </div>
        <div className="p-4">
          <p className="text-[11px] text-muted-foreground">Affiliates affected</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{affected}</p>
        </div>
      </div>

      <CardContent className="grid gap-6 p-4 lg:grid-cols-2 lg:p-5">
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <div>
              <h2 className="text-sm font-semibold">Runable campaign IDs</h2>
              <p className="text-[11px] text-muted-foreground">Priority: validate source account and first-touch URL.</p>
            </div>
            <Badge variant="destructive" className="tabular-nums">{runableItems.length}</Badge>
          </div>
          <div className="grid gap-2 px-3 pb-3">
            {visibleRunable.length > 0 ? visibleRunable.map((item) => (
              <CampaignCase key={item.campaignId} item={item} onOpenAffiliate={onOpenAffiliate} />
            )) : (
              <div className="rounded-xl border border-dashed p-5 text-center">
                <p className="text-sm font-medium">No Runable-ID overlap</p>
                <p className="mt-1 text-xs text-muted-foreground">No owned campaign IDs were shared in this window.</p>
              </div>
            )}
          </div>
          <PaginationControls
            page={activeRunablePage}
            totalPages={runablePages}
            totalItems={runableItems.length}
            pageSize={pageSize}
            itemLabel="Runable-ID cases"
            onPageChange={setRunablePage}
          />
        </section>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <div>
              <h2 className="text-sm font-semibold">Shared campaign identifiers</h2>
              <p className="text-[11px] text-muted-foreground">Watchlist: may reflect agencies, templates, or copied URLs.</p>
            </div>
            <Badge variant="secondary" className="tabular-nums">{sharedItems.length}</Badge>
          </div>
          <div className="grid gap-2 px-3 pb-3">
            {visibleShared.length > 0 ? visibleShared.map((item) => (
              <CampaignCase key={item.campaignId} item={item} onOpenAffiliate={onOpenAffiliate} />
            )) : (
              <div className="rounded-xl border border-dashed p-5 text-center">
                <p className="text-sm font-medium">No shared identifiers</p>
                <p className="mt-1 text-xs text-muted-foreground">No multi-affiliate campaign clusters were found.</p>
              </div>
            )}
          </div>
          <PaginationControls
            page={activeSharedPage}
            totalPages={sharedPages}
            totalItems={sharedItems.length}
            pageSize={pageSize}
            itemLabel="shared-ID cases"
            onPageChange={setSharedPage}
          />
        </section>
      </CardContent>
    </Card>
  );
}

function CountryIntelligenceSection({ affiliates }: { affiliates: WarAffiliate[] }) {
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const countryRows = useMemo(() => {
    const countries = new Map<string, {
      code: string;
      name: string;
      conversions: number;
      affiliateIds: Set<string>;
      highRiskIds: Set<string>;
    }>();
    for (const affiliate of affiliates) {
      for (const country of affiliate.countries) {
        const current = countries.get(country.code) ?? {
          code: country.code,
          name: country.name,
          conversions: 0,
          affiliateIds: new Set<string>(),
          highRiskIds: new Set<string>(),
        };
        current.conversions += country.conversions;
        current.affiliateIds.add(affiliate.id);
        if (affiliate.risk.band === 'high') current.highRiskIds.add(affiliate.id);
        countries.set(country.code, current);
      }
    }
    return [...countries.values()].sort((a, b) => b.conversions - a.conversions);
  }, [affiliates]);

  const totalAttributed = countryRows.reduce((sum, country) => sum + country.conversions, 0);
  const affiliatesWithMarket = affiliates.filter((affiliate) => affiliate.countries.length > 0).length;
  const maxConversions = Math.max(1, ...countryRows.map((country) => country.conversions));
  const totalPages = Math.max(1, Math.ceil(countryRows.length / pageSize));
  const activePage = Math.min(page, totalPages);
  const visibleCountries = countryRows.slice((activePage - 1) * pageSize, activePage * pageSize);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-5">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe2 className="size-4" />
          Country risk intelligence
        </CardTitle>
        <CardDescription className="max-w-2xl text-xs">
          Conversion geography joined to the affiliate evidence window. Use it to choose the country and device for
          manual SERP verification; geography alone is not proof of fraud.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 p-4 lg:grid-cols-[220px_1fr] lg:p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <div className="rounded-xl border bg-muted/25 p-4">
            <p className="text-[11px] text-muted-foreground">Attributed conversions</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtInt(totalAttributed)}</p>
          </div>
          <div className="rounded-xl border bg-muted/25 p-4">
            <p className="text-[11px] text-muted-foreground">Market coverage</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{countryRows.length}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {fmtInt(affiliatesWithMarket)} of {fmtInt(affiliates.length)} affiliates
            </p>
          </div>
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Top conversion markets</h2>
              <p className="text-[11px] text-muted-foreground">Ranked by converted Rewardful referrals in this window.</p>
            </div>
            <Badge variant="outline">Page {activePage} of {totalPages}</Badge>
          </div>
          {countryRows.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm font-medium">No country-attributed conversions</p>
              <p className="mt-1 text-xs text-muted-foreground">PostHog country enrichment has not populated this window.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {visibleCountries.map((country) => (
                <div key={country.code} className="grid grid-cols-[minmax(110px,180px)_1fr_auto] items-center gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{country.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {country.affiliateIds.size} affiliates · {country.highRiskIds.size} high risk
                    </p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        country.highRiskIds.size > 0 ? 'bg-red-500' : 'bg-emerald-500',
                      )}
                      style={{ width: `${Math.max(3, (country.conversions / maxConversions) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold tabular-nums">{fmtInt(country.conversions)}</span>
                </div>
              ))}
            </div>
          )}
          <PaginationControls
            page={activePage}
            totalPages={totalPages}
            totalItems={countryRows.length}
            pageSize={pageSize}
            itemLabel="markets"
            onPageChange={setPage}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function KeywordEvidenceSection({
  affiliates,
  onOpenAffiliate,
}: {
  affiliates: WarAffiliate[];
  onOpenAffiliate: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const evidence = useMemo(() => affiliates
    .filter((affiliate) => affiliate.observedAdTerms.length > 0)
    .map((affiliate) => ({
      affiliate,
      observations: affiliate.observedAdTerms.reduce((sum, term) => sum + term.referrals, 0),
      brandMatches: affiliate.observedAdTerms.filter((term) => term.brandMatch),
    }))
    .sort((a, b) => b.brandMatches.length - a.brandMatches.length || b.observations - a.observations),
  [affiliates]);
  const brandMatches = evidence.reduce((sum, item) => sum + item.brandMatches.length, 0);
  const totalPages = Math.max(1, Math.ceil(evidence.length / pageSize));
  const activePage = Math.min(page, totalPages);
  const visibleEvidence = evidence.slice((activePage - 1) * pageSize, activePage * pageSize);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" />
              Keyword & campaign evidence
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl text-xs">
              Observed UTM values are evidence. A token name or paid-click parameter is only a proxy until a live
              country/device search result or Ads Transparency record confirms the ad.
            </CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href="https://adstransparency.google.com/" target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              Open Ads Transparency
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 p-4 lg:grid-cols-[260px_1fr] lg:p-5">
        <div className="grid gap-3">
          <div className="rounded-xl border bg-muted/25 p-4">
            <p className="text-[11px] text-muted-foreground">Affiliates with captured terms</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{evidence.length}</p>
          </div>
          <div className={cn(
            'rounded-xl border p-4',
            brandMatches > 0
              ? 'border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10'
              : 'bg-muted/25',
          )}>
            <p className="text-[11px] text-muted-foreground">Direct Runable brand matches</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{brandMatches}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Across captured utm_term / utm_campaign values</p>
          </div>
        </div>
        <div>
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Observed evidence by affiliate</h2>
            <p className="text-[11px] text-muted-foreground">Open a case to inspect every captured value and its referral count.</p>
          </div>
          {evidence.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6">
              <div className="flex items-start gap-3">
                <FileSearch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">No direct keyword values captured</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Paid-click and campaign-overlap signals remain useful for triage, but the exact searched keyword
                    cannot be reconstructed. Capture a live SERP by country, device, time, and query before enforcement.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {visibleEvidence.map(({ affiliate, observations, brandMatches: matches }) => (
                <button
                  key={affiliate.id}
                  type="button"
                  onClick={() => onOpenAffiliate(affiliate.id)}
                  className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg',
                    matches.length > 0
                      ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    <KeyRound className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{affiliate.name}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {observations} observations · {affiliate.observedAdTerms.length} unique values
                    </p>
                  </div>
                  {matches.length > 0 && <Badge variant="destructive" className="text-[10px]">brand</Badge>}
                </button>
              ))}
            </div>
          )}
          <PaginationControls
            page={activePage}
            totalPages={totalPages}
            totalItems={evidence.length}
            pageSize={pageSize}
            itemLabel="affiliate evidence cases"
            onPageChange={setPage}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- page ---------- */

type Filter = 'all' | 'ads' | 'unpaid' | 'high' | 'medium' | 'hijack' | 'ring' | 'proposed' | 'banned';

export default function WarRoomPage() {
  const { data, loading, days, reload } = useWarRoomWindow();
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>('high');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<WarAffiliate | null>(null);
  const [busy, setBusy] = useState(false);
  const [affiliatePage, setAffiliatePage] = useState(1);

  async function syncPosthog() {
    setSyncing(true);
    const t = toast.loading('Syncing traffic from PostHog…');
    try {
      const res = await fetch(`/api/sync/posthog?days=${Math.max(days, 90)}`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'sync failed');
      toast.success(`Synced ${j.tokens} tokens (${j.rowsUpserted} rows)`, { id: t });
      reload();
    } catch (e) {
      toast.error(`PostHog sync failed: ${e instanceof Error ? e.message : e}`, { id: t });
    } finally {
      setSyncing(false);
    }
  }

  async function act(action: 'propose' | 'clear', ids: string[]) {
    if (!ids.length) return;
    setBusy(true);
    const url = action === 'propose' ? '/api/enforcement/propose' : '/api/enforcement/revert';
    const body = action === 'propose'
      ? { affiliateIds: ids, reason: 'Brand-bidding / paid-ads traffic (war room)' }
      : { affiliateIds: ids };
    const t = toast.loading(action === 'propose' ? `Proposing ban on ${ids.length}…` : 'Clearing…');
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'failed');
      toast.success(action === 'propose'
        ? `Staged ${j.proposed ?? ids.length} ban proposal(s) + payout freeze. Apply from Enforcement Log.`
        : 'Cleared.', { id: t });
      setSelected(new Set());
      setOpen(null);
      reload();
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : e}`, { id: t });
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.affiliates.filter(a => {
      if (filter === 'ads' && a.risk.stats.adSignups === 0) return false;
      if (filter === 'unpaid' && (a.unpaidCommissionCents === 0 || a.risk.band === 'low')) return false;
      if (filter === 'high' && a.risk.band !== 'high') return false;
      if (filter === 'medium' && a.risk.band !== 'medium') return false;
      if (filter === 'hijack' && a.risk.stats.ourCampaignIds.length === 0) return false;
      if (filter === 'ring' && a.risk.stats.sharedCampaignIds.length === 0) return false;
      if (filter === 'proposed' && a.enforcementState !== 'proposed_ban') return false;
      if (filter === 'banned' && a.enforcementState !== 'banned') return false;
      if (q && !a.name.toLowerCase().includes(q) && !(a.email ?? '').toLowerCase().includes(q)
        && !a.tokens.some(tk => tk.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, filter, search]);

  const affiliatePageSize = 10;
  const affiliatePages = Math.max(1, Math.ceil(rows.length / affiliatePageSize));
  const activeAffiliatePage = Math.min(affiliatePage, affiliatePages);
  const pagedRows = rows.slice(
    (activeAffiliatePage - 1) * affiliatePageSize,
    activeAffiliatePage * affiliatePageSize,
  );
  const allSelected = pagedRows.length > 0 && pagedRows.every(r => selected.has(r.id));

  if (loading && !data) {
    return (
      <div className="grid gap-4 p-4 md:p-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">Could not load war-room data.</p>
        <Button size="sm" onClick={reload}><RefreshCw className="size-3.5" /> Retry</Button>
      </div>
    );
  }

  const { summary } = data;
  const openAffiliateById = (id: string) => {
    const affiliate = data.affiliates.find((candidate) => candidate.id === id);
    if (affiliate) setOpen(affiliate);
  };
  const selectFilter = (nextFilter: Filter) => {
    setFilter(nextFilter);
    setSelected(new Set());
    setAffiliatePage(1);
  };

  return (
    <div className="grid gap-5 p-4 md:gap-6 md:p-6">
      {open && <AffiliateSheet a={open} onClose={() => setOpen(null)} onAction={act} busy={busy} />}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline" className="gap-1 text-[10px]">
              <ShieldCheck className="size-3" />
              Acquisition integrity
            </Badge>
            <span className="text-[11px] text-muted-foreground">{data.window.days} day evidence window</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldAlert className="size-6 text-red-500" />
            Fraud War Room
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            PostHog first-touch evidence for paid acquisition, campaign overlap, downstream value, and commission exposure.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={syncPosthog} disabled={syncing}>
            <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Sync PostHog'}
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Megaphone} label="Ad-driven signups" tone="danger"
          value={`${Math.round(summary.adPct * 100)}%`}
          sub={`${fmtInt(summary.adSignups)} of ${fmtInt(summary.totalSignups)} signups in ${data.window.days}d`}
          onClick={() => selectFilter('ads')} active={filter === 'ads'} />
        <Kpi icon={Users} label="Affiliates running ads" tone="warn"
          value={fmtInt(summary.affiliatesRunningAds)}
          sub={`${summary.highRisk} high risk · ${summary.mediumRisk} medium`}
          onClick={() => selectFilter('ads')} active={filter === 'ads'} />
        <Kpi icon={DollarSign} label="Unpaid $ at risk" tone="danger"
          value={fmtUsd(summary.unpaidAtRiskCents)}
          sub={`of ${fmtUsd(summary.unpaidTotalCents)} program-wide`}
          onClick={() => selectFilter('unpaid')} active={filter === 'unpaid'} />
        <Kpi icon={Crosshair} label="Our-campaign overlap"
          value={fmtInt(summary.campaignHijackers)}
          sub={`affiliate tokens seen with our campaign IDs · ${summary.ringMembers} in shared-ID clusters`}
          onClick={() => selectFilter('hijack')} active={filter === 'hijack'} />
      </div>

      <NetworkEvidenceCard counts={summary.networkSignups} />

      {/* Hero chart + funnel */}
      <div className="grid gap-4 xl:grid-cols-3">
        <TrafficChartCard />
        <ProgramFunnelCard />
      </div>

      {/* Filters + bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto pb-1">
          <Tabs value={filter} onValueChange={(value) => selectFilter(value as Filter)}>
            <TabsList>
              <TabsTrigger value="ads">Paid traffic</TabsTrigger>
              <TabsTrigger value="unpaid">Unpaid risk</TabsTrigger>
              <TabsTrigger value="high">High risk</TabsTrigger>
              <TabsTrigger value="medium">Medium</TabsTrigger>
              <TabsTrigger value="hijack">Runable overlaps</TabsTrigger>
              <TabsTrigger value="ring">Shared IDs</TabsTrigger>
              <TabsTrigger value="proposed">Proposed</TabsTrigger>
              <TabsTrigger value="banned">Banned</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {selected.size > 0 && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => act('propose', [...selected])}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
            Propose ban on {selected.size}
          </Button>
        )}
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input type="search" placeholder="Search name, email, token…" value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setAffiliatePage(1);
            }} className="h-9 w-full pl-8 text-xs" />
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden py-0">
        {rows.length === 0 ? (
          <div className="grid justify-items-center gap-3 p-12 text-center">
            <p className="text-sm font-medium">No affiliates match this view</p>
            <p className="text-xs text-muted-foreground">Clear the search and return to the full investigation queue.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                selectFilter('all');
                setSearch('');
              }}
            >
              Show all affiliates
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[920px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 px-4">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) => setSelected((previous) => {
                      const next = new Set(previous);
                      for (const affiliate of pagedRows) {
                        if (checked) next.add(affiliate.id);
                        else next.delete(affiliate.id);
                      }
                      return next;
                    })}
                    aria-label="Select all affiliates on this page"
                  />
                </TableHead>
                <TableHead>Affiliate</TableHead>
                <TableHead className="text-right">Risk</TableHead>
                <TableHead className="hidden xl:table-cell">Signals</TableHead>
                <TableHead className="hidden 2xl:table-cell">Markets</TableHead>
                <TableHead className="text-right">Signups</TableHead>
                <TableHead className="text-right">% Ads</TableHead>
                <TableHead className="text-right">Paid (FTS)</TableHead>
                <TableHead className="text-right">Unpaid $</TableHead>
                <TableHead className="px-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setOpen(a)}>
                  <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(a.id)}
                      onCheckedChange={(c) => setSelected(prev => {
                        const next = new Set(prev);
                        if (c) next.add(a.id); else next.delete(a.id);
                        return next;
                      })}
                      aria-label={`Select ${a.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-muted-foreground text-xs">{a.email}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {a.tokens.slice(0, 3).map(t => (
                        <span key={t} className="text-muted-foreground font-mono text-[10px]">?via={t}</span>
                      ))}
                      {a.tokens.length > 3 && <span className="text-muted-foreground text-[10px]">+{a.tokens.length - 3}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={cn('font-bold tabular-nums', bandBadge(a.risk.band))}>{a.risk.score}</Badge>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {a.risk.signals.slice(0, 3).map(s => (
                        <Tooltip key={s.key}>
                          <TooltipTrigger asChild>
                            <Badge variant="secondary" className={cn('text-[10px]',
                              s.severity === 'high' && 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300')}>
                              {s.label}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{s.detail}</TooltipContent>
                        </Tooltip>
                      ))}
                      {a.risk.signals.length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] text-xs 2xl:table-cell">
                    {a.countries.slice(0, 2).map((country) => country.name).join(', ') || <span className="text-muted-foreground">Unknown</span>}
                    {a.countries.length > 2 && <span className="text-muted-foreground"> +{a.countries.length - 2}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(a.risk.stats.signups)}</TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums',
                    a.risk.stats.adPct >= 0.9 ? 'text-red-600 dark:text-red-400'
                      : a.risk.stats.adPct >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                    {a.risk.stats.signups > 0 ? `${Math.round(a.risk.stats.adPct * 100)}%` : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{fmtInt(a.risk.stats.fts)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">
                    {fmtUsd(a.unpaidCommissionCents)}
                  </TableCell>
                  <TableCell className="px-4">
                    <Badge className={enforcementBadge(a.enforcementState)}>
                      {a.enforcementState === 'none' ? a.reviewStatus : a.enforcementState.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
              </Table>
            </div>
            <PaginationControls
              page={activeAffiliatePage}
              totalPages={affiliatePages}
              totalItems={rows.length}
              pageSize={affiliatePageSize}
              itemLabel="affiliate investigations"
              onPageChange={setAffiliatePage}
            />
          </>
        )}
      </Card>

      {/* Campaign overlap */}
      {data.campaignOverlap.length > 0 && (
        <CampaignOverlapSection items={data.campaignOverlap} onOpenAffiliate={openAffiliateById} />
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <CountryIntelligenceSection affiliates={data.affiliates} />
        <KeywordEvidenceSection affiliates={data.affiliates} onOpenAffiliate={openAffiliateById} />
      </div>
    </div>
  );
}
