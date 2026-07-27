'use client';

import * as React from 'react';
import { ArrowUpRight, Copy, Rocket, ShieldAlert, Sparkles, Sprout, Target } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { ChartRangeTabs } from '@/components/RangeTabs';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { useDashboard, type Affiliate } from '@/lib/use-dashboard';
import type { DashboardRange } from '@/lib/dashboard-range';
import { fmtCents, pct } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Segment = 'scale' | 'nurture' | 'activate' | 'review';

const segmentMeta: Record<Segment, { label: string; description: string; icon: typeof Rocket; tone: string }> = {
  scale: { label: 'Scale', description: 'Proven, low-risk converters worth a higher-touch growth plan.', icon: Rocket, tone: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300' },
  nurture: { label: 'Nurture', description: 'Meaningful audience activity with conversion headroom.', icon: Sprout, tone: 'text-sky-700 bg-sky-50 dark:bg-sky-500/10 dark:text-sky-300' },
  activate: { label: 'Activate', description: 'Approved affiliates with little or no attributed activity.', icon: Target, tone: 'text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300' },
  review: { label: 'Review', description: 'Suspicious state, fraud tags, or heavily ad-driven acquisition.', icon: ShieldAlert, tone: 'text-red-700 bg-red-50 dark:bg-red-500/10 dark:text-red-300' },
};

function segmentAffiliate(affiliate: Affiliate): Segment {
  const adShare = affiliate.posthogSignups > 0 ? affiliate.adDrivenSignups / affiliate.posthogSignups : 0;
  if (affiliate.status === 'suspicious' || affiliate.fraudTags.length > 0 || (affiliate.posthogSignups >= 10 && adShare >= 0.8)) return 'review';
  if (affiliate.conversions >= 3 && adShare < 0.5) return 'scale';
  if (affiliate.posthogPageviews >= 100 || affiliate.signups >= 5) return 'nurture';
  return 'activate';
}

function GrowthPipeline() {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = React.useState<DashboardRange | null>(null);
  const { data, loading } = useDashboard(rangeOverride);
  const counts = React.useMemo(() => {
    const result: Record<Segment, number> = { scale: 0, nurture: 0, activate: 0, review: 0 };
    for (const affiliate of data?.affiliates ?? []) result[segmentAffiliate(affiliate)]++;
    return (Object.keys(result) as Segment[]).map((segment) => ({ segment: segmentMeta[segment].label, affiliates: result[segment] }));
  }, [data]);
  const config = { affiliates: { label: 'Affiliates', color: 'var(--chart-2)' } } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Growth portfolio</CardTitle>
        <CardDescription>Rule-based operating segments; review remains human-controlled.</CardDescription>
        <CardAction><ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} /></CardAction>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-64 w-full" /> : (
          <ChartContainer config={config} className="h-64 w-full">
            <BarChart data={counts} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="segment" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={44} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar dataKey="affiliates" fill="var(--color-affiliates)" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function GrowthPage() {
  const { data, loading } = useDashboard();
  const [segment, setSegment] = React.useState<Segment>('scale');

  if (loading || !data) {
    return <div className="mx-auto grid w-full max-w-[112rem] gap-4 px-4 py-8"><Skeleton className="h-12 w-96" /><Skeleton className="h-80" /><Skeleton className="h-96" /></div>;
  }

  const segmented = data.affiliates
    .filter((affiliate) => segmentAffiliate(affiliate) === segment)
    .sort((a, b) => b.conversions - a.conversions || b.revenueCents - a.revenueCents);

  const copyBrief = async (affiliate: Affiliate) => {
    const text = `${affiliate.name} growth brief\nConversions: ${affiliate.conversions}\nRevenue: ${fmtCents(affiliate.revenueCents)}\nPostHog pageviews: ${affiliate.posthogPageviews}\nPostHog FTS: ${affiliate.posthogFts}\nRecommended next step: ${segment === 'scale' ? 'Offer a co-marketing experiment with a measured commission uplift.' : segment === 'nurture' ? 'Share a conversion-focused landing asset and review again in 14 days.' : segment === 'activate' ? 'Send onboarding assets and request a first placement date.' : 'Hold incentives and send to fraud review before any growth action.'}`;
    await navigator.clipboard.writeText(text);
    toast.success('Growth brief copied');
  };

  return (
    <div className="mx-auto grid w-full max-w-[112rem] gap-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="size-5" /> Affiliate Growth Workspace</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">A decision workspace for finding healthy partners to scale, affiliates to nurture, dormant accounts to activate, and risky growth to stop.</p>
      </div>

      <GrowthPipeline />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(segmentMeta) as Segment[]).map((key) => {
          const meta = segmentMeta[key];
          const count = data.affiliates.filter((affiliate) => segmentAffiliate(affiliate) === key).length;
          return (
            <button key={key} type="button" onClick={() => setSegment(key)} className={`rounded-xl border p-4 text-left transition-colors hover:border-foreground/20 ${segment === key ? 'ring-ring ring-2' : ''}`}>
              <span className={`mb-3 flex size-9 items-center justify-center rounded-lg ${meta.tone}`}><meta.icon className="size-4" /></span>
              <span className="block text-sm font-semibold">{meta.label} <span className="float-right tabular-nums">{count.toLocaleString()}</span></span>
              <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">{meta.description}</span>
            </button>
          );
        })}
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-4"><CardTitle className="text-sm">{segmentMeta[segment].label} queue</CardTitle><CardDescription>{segmented.length.toLocaleString()} affiliates ranked by conversion contribution.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="px-5">Affiliate</TableHead><TableHead className="text-right">Pageviews</TableHead><TableHead className="text-right">Signups</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Ad share</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="px-5 text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>{segmented.slice(0, 50).map((affiliate) => <TableRow key={affiliate.id}><TableCell className="px-5"><p className="font-medium">{affiliate.name}</p><p className="text-muted-foreground text-xs">{affiliate.email}</p></TableCell><TableCell className="text-right tabular-nums">{affiliate.posthogPageviews.toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{affiliate.posthogSignups.toLocaleString()}</TableCell><TableCell className="text-right font-medium tabular-nums">{affiliate.conversions.toLocaleString()}</TableCell><TableCell className="text-right"><Badge variant={affiliate.posthogSignups > 0 && affiliate.adDrivenSignups / affiliate.posthogSignups >= 0.8 ? 'destructive' : 'secondary'}>{pct(affiliate.adDrivenSignups, affiliate.posthogSignups)}</Badge></TableCell><TableCell className="text-right font-medium tabular-nums">{fmtCents(affiliate.revenueCents)}</TableCell><TableCell className="px-5 text-right"><Button size="sm" variant="outline" onClick={() => copyBrief(affiliate)}><Copy className="size-3.5" /> Brief</Button></TableCell></TableRow>)}</TableBody>
            </Table>
          </div>
          {segmented.length === 0 && <div className="text-muted-foreground p-10 text-center text-sm">No affiliates currently meet this segment&apos;s rules.</div>}
        </CardContent>
      </Card>

      <div className="rounded-xl border border-dashed p-5">
        <p className="flex items-center gap-2 text-sm font-medium"><ArrowUpRight className="size-4" /> Safe agent boundary</p>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">The workspace may rank, draft, and recommend. Commission changes, outreach, payout release, and Rewardful account-state changes remain explicit human approvals with an audit trail.</p>
      </div>
    </div>
  );
}
