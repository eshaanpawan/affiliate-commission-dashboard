'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Crosshair,
  DollarSign,
  ExternalLink,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent,
} from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
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
  risk: {
    score: number; band: 'low' | 'medium' | 'high'; signals: RiskSignal[];
    stats: {
      signups: number; adSignups: number; adPct: number; fts: number; pageviews: number;
      organicSignups: number; campaignIds: string[]; ourCampaignIds: string[];
      sharedCampaignIds: string[]; tokens: string[];
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
  };
  daily: { day: string; signups: number; adSignups: number; organicSignups: number; fts: number; pageviews: number }[];
  affiliates: WarAffiliate[];
  campaignOverlap: { campaignId: string; isOurs: boolean; affiliates: { id: string; name: string }[] }[];
}

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

/* ---------- KPI card ---------- */

function Kpi({ icon: Icon, label, value, sub, tone, onClick, active }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: 'danger' | 'warn'; onClick?: () => void; active?: boolean;
}) {
  return (
    <Card
      onClick={onClick}
      className={cn(
        'gap-1 py-4 transition-colors',
        onClick && 'hover:border-primary/40 cursor-pointer',
        active && 'border-primary ring-primary/20 ring-2',
        tone === 'danger' && 'border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10',
        tone === 'warn' && 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10',
      )}
    >
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
        {sub && <p className="text-muted-foreground text-[11px]">{sub}</p>}
      </CardHeader>
    </Card>
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

/* ---------- page ---------- */

type Filter = 'all' | 'high' | 'medium' | 'hijack' | 'ring' | 'proposed' | 'banned';

export default function WarRoomPage() {
  const [data, setData] = useState<WarRoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(180);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>('high');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<WarAffiliate | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (d = days) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/warroom?days=${d}`);
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
    } catch {
      toast.error('Failed to load war-room data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncPosthog() {
    setSyncing(true);
    const t = toast.loading('Syncing traffic from PostHog…');
    try {
      const res = await fetch(`/api/sync/posthog?days=${Math.max(days, 90)}`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'sync failed');
      toast.success(`Synced ${j.tokens} tokens (${j.rowsUpserted} rows)`, { id: t });
      await load();
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
      await load();
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

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));

  if (loading && !data) {
    return (
      <div className="grid gap-4 p-6">
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
        <Button size="sm" onClick={() => load()}><RefreshCw className="size-3.5" /> Retry</Button>
      </div>
    );
  }

  const { summary } = data;
  const funnelData = [
    { stage: 'Pageviews', ad: null as number | null, organic: null as number | null, total: summary.totalPageviews },
    { stage: 'Signups', ad: summary.adSignups, organic: summary.totalSignups - summary.adSignups, total: summary.totalSignups },
    { stage: 'Paid (FTS)', ad: null, organic: null, total: summary.totalFts },
  ];

  return (
    <div className="grid gap-6 p-6">
      {open && <AffiliateSheet a={open} onClose={() => setOpen(null)} onAction={act} busy={busy} />}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShieldAlert className="size-6 text-red-500" /> Fraud War Room
          </h1>
          <p className="text-muted-foreground text-sm">
            Ground truth from PostHog first-touch URLs — who is buying ads on our brand, and what it costs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={String(days)} onValueChange={(v) => { const d = Number(v); setDays(d); load(d); }}>
            <TabsList>
              <TabsTrigger value="30">30d</TabsTrigger>
              <TabsTrigger value="90">90d</TabsTrigger>
              <TabsTrigger value="180">180d</TabsTrigger>
              <TabsTrigger value="365">1y</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline" onClick={syncPosthog} disabled={syncing}>
            <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Sync PostHog'}
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Megaphone} label="Ad-driven signups" tone="danger"
          value={`${Math.round(summary.adPct * 100)}%`}
          sub={`${fmtInt(summary.adSignups)} of ${fmtInt(summary.totalSignups)} signups in ${data.window.days}d`} />
        <Kpi icon={Users} label="Affiliates running ads" tone="warn"
          value={fmtInt(summary.affiliatesRunningAds)}
          sub={`${summary.highRisk} high risk · ${summary.mediumRisk} medium`}
          onClick={() => setFilter('high')} active={filter === 'high'} />
        <Kpi icon={DollarSign} label="Unpaid $ at risk" tone="danger"
          value={fmtUsd(summary.unpaidAtRiskCents)}
          sub={`of ${fmtUsd(summary.unpaidTotalCents)} program-wide`} />
        <Kpi icon={Crosshair} label="Campaign hijackers"
          value={fmtInt(summary.campaignHijackers)}
          sub={`token stamped on OUR ads · ${summary.ringMembers} in shared-campaign rings`}
          onClick={() => setFilter('hijack')} active={filter === 'hijack'} />
      </div>

      {/* Hero chart + funnel */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-4 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Signups per day — ad-driven vs organic</CardTitle>
            <CardDescription className="text-xs">Stacked signups with paid conversions (FTS) overlaid</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={DAILY_CONFIG} className="h-[280px] w-full">
              <AreaChart data={data.daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24}
                  tickFormatter={(v: string) => new Date(v + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent
                  labelFormatter={(v) => new Date(String(v) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area yAxisId="left" dataKey="adSignups" stackId="s" type="monotone"
                  fill="var(--color-adSignups)" fillOpacity={0.5} stroke="var(--color-adSignups)" />
                <Area yAxisId="left" dataKey="organicSignups" stackId="s" type="monotone"
                  fill="var(--color-organicSignups)" fillOpacity={0.5} stroke="var(--color-organicSignups)" />
                <Line yAxisId="right" dataKey="fts" type="monotone" stroke="var(--color-fts)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-sm">Program funnel</CardTitle>
            <CardDescription className="text-xs">Pageview → Signup → Paid, ad vs organic</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ChartContainer config={FUNNEL_CONFIG} className="h-[170px] w-full">
              <BarChart data={funnelData.filter(f => f.ad !== null)} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="stage" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={70} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="ad" stackId="f" fill="var(--color-ad)" radius={[3, 0, 0, 3]} />
                <Bar dataKey="organic" stackId="f" fill="var(--color-organic)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ChartContainer>
            <div className="grid gap-1.5">
              {funnelData.map((f, i) => {
                const prev = funnelData[i - 1];
                const rate = prev && prev.total > 0 ? (f.total / prev.total) * 100 : null;
                return (
                  <div key={f.stage} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{f.stage}</span>
                    <span className="font-medium tabular-nums">
                      {fmtInt(f.total)}
                      {rate !== null && <span className="text-muted-foreground ml-1.5">({rate.toFixed(1)}% of prev)</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters + bulk actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => { setFilter(v as Filter); setSelected(new Set()); }}>
          <TabsList>
            <TabsTrigger value="high">High risk</TabsTrigger>
            <TabsTrigger value="medium">Medium</TabsTrigger>
            <TabsTrigger value="hijack">Hijackers</TabsTrigger>
            <TabsTrigger value="ring">Rings</TabsTrigger>
            <TabsTrigger value="proposed">Proposed</TabsTrigger>
            <TabsTrigger value="banned">Banned</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        {selected.size > 0 && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => act('propose', [...selected])}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
            Propose ban on {selected.size}
          </Button>
        )}
        <div className="relative ml-auto">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input type="search" placeholder="Search name, email, token…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="h-9 w-72 pl-8 text-xs" />
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-x-auto py-0">
        {rows.length === 0 ? (
          <p className="text-muted-foreground p-12 text-center text-sm">No affiliates match this filter.</p>
        ) : (
          <Table className="min-w-[1100px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 px-4">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(c) => setSelected(c ? new Set(rows.map(r => r.id)) : new Set())}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Affiliate</TableHead>
                <TableHead className="text-right">Risk</TableHead>
                <TableHead>Signals</TableHead>
                <TableHead className="text-right">Signups</TableHead>
                <TableHead className="text-right">% Ads</TableHead>
                <TableHead className="text-right">Paid (FTS)</TableHead>
                <TableHead className="text-right">Unpaid $</TableHead>
                <TableHead className="px-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
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
                  <TableCell>
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
        )}
      </Card>

      {/* Campaign overlap */}
      {data.campaignOverlap.length > 0 && (
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="[.border-b]:pb-0 border-b py-4">
            <CardTitle className="text-sm">Google Ads campaign overlap</CardTitle>
            <CardDescription className="text-xs">
              Campaign IDs seen under multiple affiliates (rings) or belonging to Runable&apos;s own ads account (hijack)
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">Campaign ID</TableHead>
                <TableHead>Ownership</TableHead>
                <TableHead className="px-5">Affiliates using it</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.campaignOverlap.slice(0, 25).map((c) => (
                <TableRow key={c.campaignId}>
                  <TableCell className="px-5 font-mono text-xs">{c.campaignId}</TableCell>
                  <TableCell>
                    {c.isOurs
                      ? <Badge variant="destructive">OUR campaign</Badge>
                      : <Badge variant="secondary">{c.affiliates.length} affiliates</Badge>}
                  </TableCell>
                  <TableCell className="px-5 text-xs">
                    {c.affiliates.map(a => a.name).join(', ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
