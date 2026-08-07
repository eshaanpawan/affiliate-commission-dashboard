'use client';

import { useEffect, useState } from 'react';
import { Briefcase, CircleAlert, Globe, GraduationCap, Laptop, MessagesSquare, Smartphone, Sparkles, Tablet, Users } from 'lucide-react';

import { PageControls } from '@/components/PageControls';
import { lsGet, lsSet, trackRefresh } from '@/lib/client-cache';
import { pct } from '@/lib/format';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

interface OccupationRow {
  occupation: string;
  users: number;
  affiliateUsers: number;
  paidUsers: number;
  paidRate: number;
}

interface AudienceData {
  windowDays: number;
  occupations: OccupationRow[];
  profiledSignups: number;
  totalSignups: number;
  ageCollected: boolean;
}

const LABELS: Record<string, string> = {
  educator: 'Educators / professors',
  student: 'Students',
  sales: 'Sales',
  marketing: 'Marketing',
  software_engineering: 'Software engineering',
  business_owner: 'Business owners',
  product: 'Product',
  legal: 'Legal',
  healthcare: 'Healthcare',
  consulting: 'Consulting',
  finance: 'Finance',
  operations: 'Operations',
  construction: 'Construction',
};

const label = (k: string) => LABELS[k] ?? k.replaceAll('_', ' ');

interface SegmentRow { dim: string; signups: number; affiliate: number }
interface UsageRow { channel: string; activeUsers: number; chats: number; prompts: number; artifacts: number; chatsPerUser: number }
interface SegmentsData { windowDays: number; device: SegmentRow[]; os: SegmentRow[]; browser: SegmentRow[]; usage: UsageRow[] }

function useSegments(): SegmentsData | null {
  const [data, setData] = useState<SegmentsData | null>(null);
  useEffect(() => {
    setData(lsGet<SegmentsData>('insights:segments'));
    let cancelled = false;
    trackRefresh(fetch('/api/insights/segments', { cache: 'no-store' }))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.device) return;
        lsSet('insights:segments', j);
        if (!cancelled) setData(j);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return data;
}

const CHANNEL_NAMES: Record<string, string> = {
  affiliate: 'Affiliates', google_ads: 'Google Ads', organic: 'Organic / other',
};

function SegmentCard({ title, description, rows, icons }: {
  title: string; description: string; rows: SegmentRow[] | undefined;
  icons?: Record<string, React.ElementType>;
}) {
  const visible = (rows ?? []).filter((r) => r.dim !== 'Unknown' || r.signups > 0);
  const total = visible.reduce((s, r) => s + r.signups, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!rows ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9" />) : visible.slice(0, 7).map((r) => {
          const Icon = icons?.[r.dim] ?? Laptop;
          return (
            <div key={r.dim} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {icons ? <Icon className="text-muted-foreground size-4 shrink-0" /> : null}
                  <span className="truncate font-medium">{r.dim}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  <span className="font-semibold">{r.signups.toLocaleString()}</span>
                  <span className="text-muted-foreground text-xs">({pct(r.signups, total)})</span>
                  <Badge variant="outline" className="rounded-full text-[10px]">{pct(r.affiliate, r.signups)} affiliate</Badge>
                </span>
              </div>
              <Progress value={total ? (r.signups / total) * 100 : 0} className="h-1" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function useAudience(): AudienceData | null {
  const [data, setData] = useState<AudienceData | null>(null);
  useEffect(() => {
    setData(lsGet<AudienceData>('insights:audience'));
    let cancelled = false;
    trackRefresh(fetch('/api/insights/audience', { cache: 'no-store' }))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.occupations) return;
        lsSet('insights:audience', j);
        if (!cancelled) setData(j);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return data;
}

function StatCard({ label: l, value, sub, icon: Icon }: {
  label: string; value: string; sub?: string; icon: React.ElementType;
}) {
  return (
    <Card className="w-full gap-0 p-6 py-4">
      <CardContent className="p-0">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground text-sm font-medium">{l}</dt>
          <div className="bg-muted flex size-9 items-center justify-center rounded-md border">
            <Icon className="size-4" />
          </div>
        </div>
        <dd className="text-foreground mt-2 text-3xl font-semibold tabular-nums">{value}</dd>
        {sub ? <p className="text-muted-foreground mt-1 text-xs">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function AudiencePage() {
  const data = useAudience();
  const segments = useSegments();
  const occ = data?.occupations ?? [];
  const top = occ[0];
  const bestConverting = [...occ].filter((o) => o.users >= 15).sort((a, b) => b.paidRate - a.paidRate)[0];
  // effort score: conversion quality weighted by audience size
  const effort = [...occ]
    .filter((o) => o.users >= 10)
    .map((o) => ({ ...o, score: o.paidRate * Math.log(o.users + 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const maxUsers = Math.max(...occ.map((o) => o.users), 1);

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Audience</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Who signs up — from Runable&apos;s onboarding survey (PostHog) · last {data?.windowDays ?? 90} days
          </p>
        </div>
        <PageControls />
      </div>

      {/* Stat cards */}
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Profiled sign-ups"
          value={data ? data.profiledSignups.toLocaleString() : '—'}
          sub={data ? `${pct(data.profiledSignups, data.totalSignups)} of ${data.totalSignups.toLocaleString()} sign-ups answered the survey` : undefined}
        />
        <StatCard
          icon={GraduationCap}
          label="Top occupation"
          value={top ? label(top.occupation) : '—'}
          sub={top && data ? `${pct(top.users, data.profiledSignups)} of profiled users` : undefined}
        />
        <StatCard
          icon={Sparkles}
          label="Best-converting group"
          value={bestConverting ? label(bestConverting.occupation) : '—'}
          sub={bestConverting ? `${bestConverting.paidRate.toFixed(1)}% become paying customers` : undefined}
        />
        <StatCard
          icon={Briefcase}
          label="Age data"
          value="Not collected"
          sub="no onboarding step captures age — see note below"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Occupation breakdown */}
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Occupation mix</CardTitle>
            <CardDescription>Share of profiled sign-ups · affiliate-attributed count · paid conversion per group</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!data ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />) : occ.map((o) => (
              <div key={o.occupation} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{label(o.occupation)}</span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="font-semibold">{o.users.toLocaleString()}</span>
                    <span className="text-muted-foreground text-xs">({pct(o.users, data.profiledSignups)})</span>
                    <Badge variant="outline" className="rounded-full text-[10px]">{o.affiliateUsers} via affiliates</Badge>
                    <Badge
                      variant="outline"
                      className={`rounded-full text-[10px] ${o.paidRate > 0
                        ? 'border-lime-300 bg-lime-50 text-lime-700 dark:border-lime-900 dark:bg-lime-950 dark:text-lime-300'
                        : ''}`}
                    >
                      {o.paidUsers} paid · {o.paidRate.toFixed(1)}%
                    </Badge>
                  </span>
                </div>
                <Progress value={(o.users / maxUsers) * 100} className="h-1.5" />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-5">
          {/* Where to put effort */}
          <Card>
            <CardHeader>
              <CardTitle>Where to put effort</CardTitle>
              <CardDescription>Groups ranked by paid-conversion quality weighted by audience size</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!data ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />) : effort.map((o, i) => (
                <div key={o.occupation} className="flex items-center gap-3">
                  <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold">{i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{label(o.occupation)}</p>
                    <p className="text-muted-foreground text-xs">
                      {o.users} sign-ups · {o.paidRate.toFixed(1)}% pay · {o.affiliateUsers} arrived via affiliates
                    </p>
                  </div>
                </div>
              ))}
              {data && effort[0] ? (
                <p className="text-muted-foreground border-t pt-3 text-xs">
                  Recruit affiliates who reach <span className="text-foreground font-medium">{label(effort[0].occupation).toLowerCase()}</span> —
                  they convert best relative to volume. Educators are the largest pool
                  {top && bestConverting && top.occupation !== bestConverting.occupation ? ' but not the best converters — pair volume plays with conversion plays.' : '.'}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Data gap callout */}
          <Card className="border-amber-300 bg-linear-to-tr from-amber-200/40 to-amber-100/40 shadow-none dark:border-amber-950 dark:from-amber-950/40 dark:to-amber-900/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm"><CircleAlert className="size-4" /> Data gaps worth closing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="font-medium">Age is not collected anywhere.</span> No onboarding step or person property captures it — an age-group question in the onboarding survey would unlock the age breakdowns you asked for.</p>
              <p><span className="font-medium">Occupation coverage is {data ? pct(data.profiledSignups, data.totalSignups) : '~1%'}.</span> The survey step appears to be new or shown to a subset — asking every sign-up would make this page far more decisive.</p>
              <p className="text-muted-foreground text-xs">Both are product-side changes to Runable&apos;s onboarding flow; this page picks them up automatically once the data starts flowing.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Device / OS / browser segmentation */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SegmentCard
          title="Devices"
          description="Sign-ups by device · affiliate share per segment · last 30 days"
          rows={segments?.device}
          icons={{ Mobile: Smartphone, Desktop: Laptop, Tablet: Tablet }}
        />
        <SegmentCard
          title="Operating systems"
          description="Windows vs macOS vs Android vs iOS — and who affiliates bring"
          rows={segments?.os}
        />
        <SegmentCard
          title="Browsers"
          description="Browser mix of sign-ups with affiliate share"
          rows={segments?.browser}
          icons={{ Chrome: Globe }}
        />
      </div>

      {/* Usage depth by channel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessagesSquare className="size-4" /> Product usage by acquisition channel</CardTitle>
          <CardDescription>How much users from each channel actually use Runable · chats, prompts and artifacts in the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          {!segments ? <Skeleton className="h-24 w-full" /> : (
            <div className="grid gap-4 sm:grid-cols-3">
              {[...segments.usage].sort((a, b) => b.chatsPerUser - a.chatsPerUser).map((u) => (
                <div key={u.channel} className="bg-muted border-border rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm ${u.channel === 'affiliate' ? 'font-semibold' : 'font-medium'}`}>{CHANNEL_NAMES[u.channel] ?? u.channel}</p>
                    <Badge variant="outline" className="rounded-full text-[10px]">{u.activeUsers.toLocaleString()} active users</Badge>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{u.chatsPerUser.toFixed(1)}</p>
                  <p className="text-muted-foreground text-xs">chats per active user</p>
                  <p className="text-muted-foreground mt-2 text-xs tabular-nums">
                    {u.chats.toLocaleString()} chats · {u.prompts.toLocaleString()} prompts · {u.artifacts.toLocaleString()} artifacts
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
