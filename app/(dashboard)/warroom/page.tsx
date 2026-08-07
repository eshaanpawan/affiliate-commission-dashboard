'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  ExternalLink,
  Globe2,
  KeyRound,
  Loader2,
  Megaphone,
  Network,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ChartRangeTabs } from '@/components/RangeTabs';
import type { DashboardRange } from '@/lib/dashboard-range';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageControls } from '@/components/PageControls';
import { ExpandableRows } from '@/components/ExpandableRows';

/* ---------- types mirrored from /api/warroom ---------- */

interface RiskSignal { key: string; label: string; severity: string; value: string; detail: string }
interface WarAffiliate {
  id: string; name: string; email: string | null; source: string;
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
    proposedBans: number; banned: number; dubFlagged: number;
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
  return band === 'high' ? 'rounded-full border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
    : band === 'medium' ? 'rounded-full border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
    : 'rounded-full border-border bg-muted text-muted-foreground';
}
function dubTags(a: WarAffiliate): string[] {
  return a.fraudTags.filter((tag) => tag.startsWith('dub:'));
}
function SourceBadge({ source }: { source: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide',
        source === 'dub'
          ? 'border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300'
          : 'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300',
      )}
    >
      {source}
    </Badge>
  );
}
const DUB_TAG_BADGE = 'rounded-full border-red-300 bg-red-100 font-mono text-[10px] text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300';
function enforcementBadge(state: string) {
  return state === 'banned' ? 'rounded-full bg-red-600 text-white'
    : state === 'proposed_ban' ? 'rounded-full bg-amber-500 text-white'
    : state === 'cleared' ? 'rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : 'rounded-full bg-muted text-muted-foreground';
}

const CHART_TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
} as const;

function ChartDotLegend({ entries }: { entries: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {entries.map((entry) => (
        <div key={entry.label} className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground truncate">{entry.label}</span>
        </div>
      ))}
    </div>
  );
}

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
    <Card className="h-full gap-4 lg:col-span-8">
      <CardHeader>
        <CardTitle className="text-sm">Signups per day — ad-driven vs organic</CardTitle>
        <CardDescription className="text-xs">How much of daily signup volume someone paid for — spikes in the ad-driven band mean affiliates buying traffic</CardDescription>
        <CardAction><ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} /></CardAction>
      </CardHeader>
      <CardContent>
        {loading || !data ? <Skeleton className="h-[280px] w-full" /> : (
          <>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="warAdGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.9} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.2} />
                    </linearGradient>
                    <linearGradient id="warOrganicGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} tickMargin={8} minTickGap={24} tickFormatter={(value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} fontSize={11} />
                  <RechartsTooltip
                    cursor={{ fill: 'var(--muted)' }}
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelFormatter={(value) => new Date(`${String(value)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  />
                  <Area yAxisId="left" dataKey="adSignups" name="Ad-driven signups" stackId="s" type="monotone" fill="url(#warAdGradient)" stroke="var(--chart-1)" strokeWidth={2} />
                  <Area yAxisId="left" dataKey="organicSignups" name="Organic signups" stackId="s" type="monotone" fill="url(#warOrganicGradient)" stroke="var(--chart-2)" strokeWidth={2} />
                  <Line yAxisId="right" dataKey="fts" name="Paid conversions (FTS)" type="monotone" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <ChartDotLegend entries={[
              { label: 'Ad-driven signups', color: 'var(--chart-1)' },
              { label: 'Organic signups', color: 'var(--chart-2)' },
              { label: 'Paid conversions (FTS)', color: 'var(--chart-3)' },
            ]} />
          </>
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
    <Card className="h-full gap-4 lg:col-span-4">
      <CardHeader>
        <CardTitle className="text-sm">Program funnel</CardTitle>
        <CardDescription className="text-xs">Pageview → Signup → Paid — a wide ad band that never converts to Paid signals junk traffic</CardDescription>
        <CardAction><ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} /></CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading || !summary ? <Skeleton className="h-[220px] w-full" /> : <>
          <div>
            <div className="h-[170px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData.filter((row) => row.ad !== null)} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="warFunnelGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="5%" stopColor="var(--chart-2)" />
                      <stop offset="95%" stopColor="var(--chart-1)" />
                    </linearGradient>
                  </defs>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="stage" tickLine={false} axisLine={false} fontSize={11} width={70} />
                  <RechartsTooltip cursor={{ fill: 'var(--muted)' }} contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="ad" name="Ad-driven" stackId="f" fill="url(#warFunnelGradient)" radius={[5, 0, 0, 5]} />
                  <Bar dataKey="organic" name="Organic" stackId="f" fill="var(--chart-2)" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartDotLegend entries={[
              { label: 'Ad-driven', color: 'var(--chart-1)' },
              { label: 'Organic', color: 'var(--chart-2)' },
            ]} />
          </div>
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
    <CardContent className="p-0">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
        <div className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-xl',
          tone === 'danger' ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400'
            : tone === 'warn' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400'
            : 'bg-primary/10 text-primary',
        )}>
          <Icon className="size-4" />
        </div>
      </div>
      <dd className="text-foreground mt-2 text-3xl font-semibold tabular-nums">{value}</dd>
      {sub && <p className="text-muted-foreground mt-1 text-xs">{sub}</p>}
    </CardContent>
  );

  return (
    <Card
      className={cn(
        'w-full gap-0 overflow-hidden p-6 py-4',
        onClick && 'cursor-pointer transition-shadow hover:shadow-md',
        active && 'border-primary ring-primary/20 ring-2',
        tone === 'danger' && 'bg-linear-to-tr from-red-200/40 to-red-100/40 dark:from-red-950/40 dark:to-red-900/40 border-red-300 dark:border-red-950 shadow-none',
        tone === 'warn' && 'bg-linear-to-tr from-amber-200/40 to-amber-100/40 dark:from-amber-950/40 dark:to-amber-900/40 border-amber-300 dark:border-amber-950 shadow-none',
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          className="w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </Card>
  );
}

function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/i.test(code)) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function NetworkEvidenceCard({ counts }: { counts: Record<AdNetworkKey, number> }) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const active = AD_NETWORKS
    .filter((network) => counts[network.key] > 0)
    .sort((a, b) => counts[b.key] - counts[a.key]);
  const zero = AD_NETWORKS.filter((network) => counts[network.key] === 0);

  return (
    <Card className="h-full gap-4 lg:col-span-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Network className="size-4" />
          Paid-network evidence
        </CardTitle>
        <CardDescription className="text-xs">
          Signups arriving with each ad network&apos;s click ID — attributed traffic someone paid for. Investigate the top networks first.
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className="rounded-full tabular-nums">{fmtInt(total)} signups</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {active.length === 0 ? (
          <p className="text-muted-foreground text-xs">No paid click identifiers were seen on any signup in this window.</p>
        ) : (
          active.slice(0, 4).map((network) => (
            <div key={network.key} className="flex items-center">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Megaphone className="size-4" />
              </div>
              <div className="ml-3 min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm leading-none font-medium">{network.label}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{network.evidence}</p>
                </div>
                <Progress value={total ? (counts[network.key] / total) * 100 : 0} className="h-1" />
              </div>
              <div className="ms-auto pl-4 text-sm font-medium tabular-nums">{fmtInt(counts[network.key])}</div>
            </div>
          ))
        )}
        {zero.length > 0 && active.length > 0 && (
          <p className="text-muted-foreground text-[11px]">
            No signals from {zero.map((network) => network.label).join(', ')}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ShowMoreToggle({ expanded, hidden, onToggle }: { expanded: boolean; hidden: number; onToggle: () => void }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="h-7 justify-start px-1 text-xs text-muted-foreground" onClick={onToggle}>
      <ChevronDown className={cn('size-3.5', expanded && 'rotate-180')} />
      {expanded ? 'Show less' : `Show ${hidden} more`}
    </Button>
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] w-full overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{a.name}</DialogTitle>
            <SourceBadge source={a.source} />
            <Badge variant="outline" className={cn('font-bold', bandBadge(a.risk.band))}>Risk {a.risk.score}</Badge>
            {dubTags(a).map((tag) => (
              <Badge key={tag} variant="outline" className={DUB_TAG_BADGE}>{tag}</Badge>
            ))}
            <Badge className={enforcementBadge(a.enforcementState)}>{a.enforcementState.replace('_', ' ')}</Badge>
            {a.holdStatus && <Badge variant="secondary">hold: {a.holdStatus}</Badge>}
          </div>
          <DialogDescription>{a.email ?? 'no email'} · Rewardful {a.rewardfulStatus}</DialogDescription>
        </DialogHeader>

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
                      <Badge variant="outline" className={cn('rounded-full text-[10px]',
                        sig.severity === 'high'
                          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
                          : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300')}>
                        {sig.severity}
                      </Badge>
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
      </DialogContent>
    </Dialog>
  );
}

type CampaignOverlap = WarRoomData['campaignOverlap'][number];

function CampaignOverlapSection({
  items,
  onOpenAffiliate,
}: {
  items: CampaignOverlap[];
  onOpenAffiliate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(() => [...items].sort((a, b) =>
    Number(b.isOurs) - Number(a.isOurs) || b.affiliates.length - a.affiliates.length), [items]);
  const visible = expanded ? sorted : sorted.slice(0, 5);

  return (
    <Card className="h-full gap-4 lg:col-span-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="size-4" />
          Campaign overlap
        </CardTitle>
        <CardDescription className="text-xs">
          Affiliate tokens seen alongside our own Google campaign IDs — likely brand bidding on our ads. Open each affiliate to review before acting.
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className="rounded-full tabular-nums">{fmtInt(items.length)} cases</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2">
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-xs">No campaign IDs were shared between affiliates in this window.</p>
        ) : (
          <>
            {visible.map((item) => (
              <button
                key={item.campaignId}
                type="button"
                onClick={() => item.affiliates[0] && onOpenAffiliate(item.affiliates[0].id)}
                className="flex min-w-0 items-center gap-3 rounded-lg p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg',
                  item.isOurs
                    ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                    : 'bg-muted text-muted-foreground',
                )}>
                  <Network className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-semibold">{item.campaignId}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {item.affiliates.slice(0, 3).map((affiliate) => affiliate.name).join(', ')}
                    {item.affiliates.length > 3 ? ` +${item.affiliates.length - 3} more` : ''}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn('rounded-full text-[10px]', item.isOurs ? bandBadge('high') : bandBadge('medium'))}
                >
                  {item.isOurs ? 'Runable ID' : 'Shared ID'}
                </Badge>
                <span className="shrink-0 text-xs font-semibold tabular-nums">{item.affiliates.length}</span>
              </button>
            ))}
            {sorted.length > 5 && (
              <ShowMoreToggle expanded={expanded} hidden={sorted.length - 5} onToggle={() => setExpanded((value) => !value)} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CountryIntelligenceSection({ affiliates }: { affiliates: WarAffiliate[] }) {
  const [expanded, setExpanded] = useState(false);
  const countryRows = useMemo(() => {
    const countries = new Map<string, {
      code: string; name: string; conversions: number;
      affiliateIds: Set<string>; highRiskIds: Set<string>;
    }>();
    for (const affiliate of affiliates) {
      for (const country of affiliate.countries) {
        const current = countries.get(country.code) ?? {
          code: country.code, name: country.name, conversions: 0,
          affiliateIds: new Set<string>(), highRiskIds: new Set<string>(),
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
  const visible = expanded ? countryRows : countryRows.slice(0, 5);

  return (
    <Card className="h-full gap-4 lg:col-span-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Globe2 className="size-4" />
          Conversion geography
        </CardTitle>
        <CardDescription className="text-xs">
          Where flagged affiliates&apos; conversions come from — pick the country and device for manual SERP checks; geography alone is not proof.
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className="rounded-full tabular-nums">{fmtInt(totalAttributed)} conversions</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {countryRows.length === 0 ? (
          <p className="text-muted-foreground text-xs">No country-attributed conversions in this window.</p>
        ) : (
          <>
            {visible.map((country) => (
              <div key={country.code} className="flex items-center">
                <span className="text-2xl">{flagEmoji(country.code)}</span>
                <div className="ml-4 min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-sm leading-none font-medium">{country.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {country.affiliateIds.size} affiliates{country.highRiskIds.size > 0 ? ` · ${country.highRiskIds.size} high risk` : ''}
                    </p>
                  </div>
                  <Progress value={totalAttributed ? (country.conversions / totalAttributed) * 100 : 0} className="h-1" />
                </div>
                <div className="ms-auto pl-4 text-sm font-medium tabular-nums">{fmtInt(country.conversions)}</div>
              </div>
            ))}
            {countryRows.length > 5 && (
              <ShowMoreToggle expanded={expanded} hidden={countryRows.length - 5} onToggle={() => setExpanded((value) => !value)} />
            )}
          </>
        )}
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
  const [expanded, setExpanded] = useState(false);
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
  const visible = expanded ? evidence : evidence.slice(0, 5);

  return (
    <Card className="h-full gap-4 lg:col-span-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="size-4" />
          Keyword & campaign evidence
        </CardTitle>
        <CardDescription className="text-xs">
          UTM keyword values captured on affiliate traffic — a Runable brand match means they likely bid on our name; confirm with a live SERP capture.
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className={cn('rounded-full tabular-nums', brandMatches > 0 && bandBadge('high'))}>
            {fmtInt(brandMatches)} brand matches
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2">
        {evidence.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No keyword or campaign terms captured in this window — capture a live SERP before treating brand bidding as proven.
          </p>
        ) : (
          <>
            {visible.map(({ affiliate, observations, brandMatches: matches }) => (
              <button
                key={affiliate.id}
                type="button"
                onClick={() => onOpenAffiliate(affiliate.id)}
                className="flex min-w-0 items-center gap-3 rounded-lg p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
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
                <Badge
                  variant="outline"
                  className={cn('rounded-full text-[10px]', matches.length > 0 ? bandBadge('high') : bandBadge('low'))}
                >
                  {matches.length > 0 ? 'brand match' : 'captured'}
                </Badge>
              </button>
            ))}
            {evidence.length > 5 && (
              <ShowMoreToggle expanded={expanded} hidden={evidence.length - 5} onToggle={() => setExpanded((value) => !value)} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- Dub verdicts ---------- */

function DubVerdictsCard({ affiliates, onOpenAffiliate }: {
  affiliates: WarAffiliate[];
  onOpenAffiliate: (id: string) => void;
}) {
  const flagged = useMemo(() => affiliates
    .filter((a) => dubTags(a).length > 0)
    .sort((a, b) => b.unpaidCommissionCents - a.unpaidCommissionCents), [affiliates]);
  if (flagged.length === 0) return null;
  const exposure = flagged.reduce((sum, a) => sum + a.unpaidCommissionCents, 0);
  return (
    <Card className="gap-0 overflow-hidden border-red-300 bg-linear-to-tr from-red-200/30 to-red-100/30 py-0 shadow-none dark:border-red-950 dark:from-red-950/30 dark:to-red-900/30">
      <CardHeader className="border-b py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-red-600 dark:text-red-400" />
              Dub verdicts — partners Dub itself flagged
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl text-xs">
              Bans, deactivations, and fraud tags issued by Dub and synced into our fraud tags.
              These are near-certain verdicts — review and enforce these first.
            </CardDescription>
          </div>
          <Badge variant="destructive" className="rounded-full tabular-nums">
            {flagged.length} partner{flagged.length === 1 ? '' : 's'} · {fmtUsd(exposure)} unpaid
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ExpandableRows
          items={flagged}
          preview={6}
          perPage={12}
          label="flagged partners"
          render={(tiles) => (
            <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {tiles.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpenAffiliate(a.id)}
            className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
              <Ban className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs font-semibold">{a.name}</p>
                <SourceBadge source={a.source} />
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {dubTags(a).map((tag) => (
                  <Badge key={tag} variant="outline" className={DUB_TAG_BADGE}>{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-semibold tabular-nums text-red-700 dark:text-red-300">{fmtUsd(a.unpaidCommissionCents)}</p>
              <p className="text-[10px] text-muted-foreground">unpaid</p>
            </div>
          </button>
              ))}
            </div>
          )}
        />
      </CardContent>
    </Card>
  );
}

/* ---------- page ---------- */

type Filter = 'all' | 'ads' | 'unpaid' | 'high' | 'medium' | 'hijack' | 'ring' | 'dub' | 'proposed' | 'banned';

export default function WarRoomPage() {
  const { data, loading, days, reload } = useWarRoomWindow();
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>('high');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<WarAffiliate | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (filter === 'dub' && dubTags(a).length === 0) return false;
      if (filter === 'proposed' && a.enforcementState !== 'proposed_ban') return false;
      if (filter === 'banned' && a.enforcementState !== 'banned') return false;
      if (q && !a.name.toLowerCase().includes(q) && !(a.email ?? '').toLowerCase().includes(q)
        && !a.tokens.some(tk => tk.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) =>
      b.risk.score - a.risk.score || b.unpaidCommissionCents - a.unpaidCommissionCents);
  }, [data, filter, search]);

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
  };

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      {open && <AffiliateSheet a={open} onClose={() => setOpen(null)} onAction={act} busy={busy} />}

      {/* Header */}
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Fraud War Room</h1>
            <Badge variant="outline" className="gap-1 rounded-full text-[10px]">
              <ShieldCheck className="size-3" />
              Acquisition integrity
            </Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 max-w-3xl text-sm">
            {data.window.days}-day evidence window · PostHog first-touch evidence for paid acquisition, campaign overlap, and commission exposure
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageControls />
          <Button size="sm" variant="outline" onClick={syncPosthog} disabled={syncing}>
            <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Sync PostHog'}
          </Button>
        </div>
      </div>

      {/* KPI row — highest-value fraud intelligence first */}
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={DollarSign} label="Unpaid $ at risk" tone="danger"
          value={fmtUsd(summary.unpaidAtRiskCents)}
          sub={`held by high-risk affiliates · ${fmtUsd(summary.unpaidTotalCents)} unpaid program-wide`}
          onClick={() => selectFilter('unpaid')} active={filter === 'unpaid'} />
        <Kpi icon={ShieldAlert} label="High-risk affiliates" tone="danger"
          value={fmtInt(summary.highRisk)}
          sub={`${summary.mediumRisk} medium · ${summary.proposedBans} proposed ban · ${summary.banned} banned`}
          onClick={() => selectFilter('high')} active={filter === 'high'} />
        <Kpi icon={Ban} label="Dub-flagged partners" tone="warn"
          value={fmtInt(summary.dubFlagged)}
          sub="banned / deactivated / fraud-tagged by Dub itself"
          onClick={() => selectFilter('dub')} active={filter === 'dub'} />
        <Kpi icon={Megaphone} label="Affiliates running paid ads" tone="warn"
          value={fmtInt(summary.affiliatesRunningAds)}
          sub={`${Math.round(summary.adPct * 100)}% of ${fmtInt(summary.totalSignups)} signups (${fmtInt(summary.adSignups)}) carried ad click params in ${data.window.days}d`}
          onClick={() => selectFilter('ads')} active={filter === 'ads'} />
      </div>

      {/* Dub's own fraud verdicts — near-certain cases */}
      <DubVerdictsCard affiliates={data.affiliates} onOpenAffiliate={openAffiliateById} />

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
              <TabsTrigger value="dub">Dub-flagged</TabsTrigger>
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
            onChange={(event) => setSearch(event.target.value)} className="h-9 w-full pl-8 text-xs" />
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
          <ExpandableRows
            key={`${filter}:${search}`}
            items={rows}
            preview={5}
            perPage={10}
            label="affiliate investigations"
            render={(pagedRows) => {
              const allSelected = pagedRows.length > 0 && pagedRows.every((r) => selected.has(r.id));
              return (
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
                <TableHead>Evidence</TableHead>
                <TableHead className="text-right">Ad share</TableHead>
                <TableHead className="text-right">Unpaid $</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Signups</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Paid (FTS)</TableHead>
                <TableHead className="hidden max-w-[180px] 2xl:table-cell">Markets</TableHead>
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
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium">{a.name}</p>
                      <SourceBadge source={a.source} />
                    </div>
                    <p className="text-muted-foreground text-xs">{a.email}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {a.tokens.slice(0, 3).map(t => (
                        <span key={t} className="text-muted-foreground font-mono text-[10px]">?via={t}</span>
                      ))}
                      {a.tokens.length > 3 && <span className="text-muted-foreground text-[10px]">+{a.tokens.length - 3}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant="outline" className={cn('font-bold tabular-nums', bandBadge(a.risk.band))}>{a.risk.score}</Badge>
                      <Progress value={a.risk.score} className="h-1 w-16" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[280px] flex-wrap gap-1">
                      {dubTags(a).map((tag) => (
                        <Badge key={tag} variant="outline" className={DUB_TAG_BADGE}>{tag}</Badge>
                      ))}
                      {a.risk.signals.slice(0, 3).map(s => (
                        <Tooltip key={s.key}>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className={cn('rounded-full text-[10px]',
                              s.severity === 'high'
                                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
                                : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300')}>
                              {s.label}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{s.detail}</TooltipContent>
                        </Tooltip>
                      ))}
                      {a.risk.signals.length === 0 && dubTags(a).length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums',
                    a.risk.stats.adPct >= 0.9 ? 'text-red-600 dark:text-red-400'
                      : a.risk.stats.adPct >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                    {a.risk.stats.signups > 0 ? `${Math.round(a.risk.stats.adPct * 100)}%` : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">
                    {fmtUsd(a.unpaidCommissionCents)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums xl:table-cell">{fmtInt(a.risk.stats.signups)}</TableCell>
                  <TableCell className="hidden text-right font-medium tabular-nums xl:table-cell">{fmtInt(a.risk.stats.fts)}</TableCell>
                  <TableCell className="hidden max-w-[180px] text-xs 2xl:table-cell">
                    {a.countries.slice(0, 2).map((country) => country.name).join(', ') || <span className="text-muted-foreground">Unknown</span>}
                    {a.countries.length > 2 && <span className="text-muted-foreground"> +{a.countries.length - 2}</span>}
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
              );
            }}
          />
        )}
      </Card>

      {/* Evidence overview — below the review queue */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <TrafficChartCard />
        <ProgramFunnelCard />
        <NetworkEvidenceCard counts={summary.networkSignups} />
        <CampaignOverlapSection items={data.campaignOverlap} onOpenAffiliate={openAffiliateById} />
        <CountryIntelligenceSection affiliates={data.affiliates} />
        <KeywordEvidenceSection affiliates={data.affiliates} onOpenAffiliate={openAffiliateById} />
      </div>
    </div>
  );
}
