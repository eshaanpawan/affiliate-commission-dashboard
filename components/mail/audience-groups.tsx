'use client';

import * as React from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  MailCheck,
  MoonStar,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type AudienceGroupSafety = 'safe' | 'review' | 'restricted';

export interface AudienceGroupMember {
  id: string;
  name: string;
  email: string | null;
  status: string;
  riskScore: number;
  conversions: number;
  visitors: number;
  unpaidCommissionCents: number;
  evidence: string[];
}

export interface AudienceGroup {
  id: string;
  label: string;
  description: string;
  count: number;
  criteria: string[];
  safety: string;
  safetyLevel?: AudienceGroupSafety;
  selectable: boolean;
  selected?: boolean;
  memberPreview: AudienceGroupMember[];
}

export interface AudienceGroupsPayload {
  generatedAt: string;
  totalEmailable: number;
  membershipMode?: 'exclusive' | 'overlapping';
  selectedGroupId?: string;
  draftTarget?: {
    groupId: string;
    selectedAt: string | null;
    saved: boolean;
    localMetadataOnly: boolean;
    instantiatedInInstantly: boolean;
  };
  groups: AudienceGroup[];
}

export interface AudienceGroupsProps {
  payload: AudienceGroupsPayload;
  selectedGroupId: string;
  onSelectedGroupChange: (group: AudienceGroup) => void;
  disabled?: boolean;
  className?: string;
}

type MemberFilter = 'all' | 'review' | 'healthy' | 'active' | 'inactive';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const groupLooks: Record<string, { icon: typeof Users; tone: string; marker: string }> = {
  brand_bidding_review: { icon: ShieldAlert, tone: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300', marker: 'bg-red-500' },
  high_risk_review: { icon: CircleAlert, tone: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300', marker: 'bg-orange-500' },
  good_performers: { icon: TrendingUp, tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300', marker: 'bg-emerald-500' },
  new_unproven: { icon: Sparkles, tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300', marker: 'bg-sky-500' },
  dormant: { icon: MoonStar, tone: 'bg-stone-100 text-stone-700 dark:bg-stone-500/15 dark:text-stone-300', marker: 'bg-stone-500' },
  developing_partners: { icon: Activity, tone: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300', marker: 'bg-violet-500' },
  all_emailable: { icon: Users, tone: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300', marker: 'bg-indigo-500' },
};

function normalizeGroupId(id: string) {
  return id.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function groupLook(group: AudienceGroup) {
  return groupLooks[normalizeGroupId(group.id)] ?? { icon: Users, tone: 'bg-muted text-foreground', marker: 'bg-foreground' };
}

function safetyVariant(level: AudienceGroupSafety | undefined) {
  if (level === 'restricted') return 'destructive' as const;
  if (level === 'review') return 'outline' as const;
  return 'secondary' as const;
}

function matchesMemberFilter(member: AudienceGroupMember, filter: MemberFilter) {
  if (filter === 'review') return member.riskScore >= 60 || member.status === 'suspicious';
  if (filter === 'healthy') return member.riskScore < 60 && member.status !== 'suspicious';
  if (filter === 'active') return member.conversions > 0 || member.visitors > 0;
  if (filter === 'inactive') return member.conversions === 0 && member.visitors === 0;
  return true;
}

export function DraftAudiencePicker({ payload, selectedGroupId, onSelectedGroupChange, disabled = false, className }: AudienceGroupsProps) {
  const selectedGroup = payload.groups.find((group) => group.id === selectedGroupId)
    ?? payload.groups.find((group) => group.selectable)
    ?? null;

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border bg-muted/10 p-3 sm:flex-row sm:items-center', className)}>
      <div className="flex min-w-0 items-center gap-3 sm:mr-auto">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-foreground text-background"><Users className="size-4" /></span>
        <div className="min-w-0"><p className="text-sm font-semibold">Draft audience</p><p className="text-muted-foreground truncate text-xs">One target group · selection only</p></div>
      </div>
      <Select
        value={selectedGroup?.id}
        disabled={disabled || payload.groups.every((group) => !group.selectable)}
        onValueChange={(id) => {
          const group = payload.groups.find((item) => item.id === id && item.selectable);
          if (group) onSelectedGroupChange(group);
        }}
      >
        <SelectTrigger className="w-full sm:w-72" aria-label="Choose the sequence draft audience"><SelectValue placeholder="Choose an audience group" /></SelectTrigger>
        <SelectContent>
          {payload.groups.map((group) => <SelectItem key={group.id} value={group.id} disabled={!group.selectable}>{group.label} · {group.count.toLocaleString()}</SelectItem>)}
        </SelectContent>
      </Select>
      {selectedGroup && (
        <div className="flex shrink-0 items-center gap-2 sm:min-w-48 sm:justify-end">
          <strong className="font-mono text-sm tabular-nums">{selectedGroup.count.toLocaleString()}</strong>
          <span className="text-muted-foreground text-xs">affiliates</span>
          <Badge variant={safetyVariant(selectedGroup.safetyLevel)}>{selectedGroup.safety}</Badge>
        </div>
      )}
    </div>
  );
}

export function AudienceGroups({ payload, selectedGroupId, onSelectedGroupChange, disabled = false, className }: AudienceGroupsProps) {
  const [expandedGroupId, setExpandedGroupId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<MemberFilter>('all');

  const selectedGroup = payload.groups.find((group) => group.id === selectedGroupId)
    ?? payload.groups.find((group) => group.selectable)
    ?? null;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleMembers = (selectedGroup?.memberPreview ?? []).filter((member) => {
    if (!matchesMemberFilter(member, filter)) return false;
    if (!normalizedSearch) return true;
    return [member.name, member.email ?? '', member.status, ...member.evidence]
      .some((value) => value.toLowerCase().includes(normalizedSearch));
  });
  const membershipLabel = payload.membershipMode === 'exclusive'
    ? 'Exclusive operating cohorts · All emailable is a separate broad superset'
    : 'Overlapping cohorts · an affiliate may meet more than one group';

  return (
    <Card className={cn('gap-0 overflow-hidden py-0', className)}>
      <CardHeader className="border-b bg-muted/10 py-5">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline"><Users /> Audience groups</Badge>
            <Badge variant="secondary"><MailCheck /> Draft target only</Badge>
          </div>
          <CardTitle>Choose one campaign audience</CardTitle>
          <CardDescription className="mt-1">{membershipLabel}</CardDescription>
        </div>
        <div className="text-right"><p className="text-2xl font-semibold tabular-nums">{payload.totalEmailable.toLocaleString()}</p><p className="text-muted-foreground text-[10px] uppercase tracking-wide">emailable affiliates</p></div>
      </CardHeader>

      <CardContent className="p-0">
        <div role="radiogroup" aria-label="Campaign audience group" className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {payload.groups.map((group) => {
            const look = groupLook(group);
            const Icon = look.icon;
            const selected = selectedGroup?.id === group.id;
            const expanded = expandedGroupId === group.id;
            return (
              <article key={group.id} className={cn('relative overflow-hidden rounded-xl border bg-background transition-all', selected && 'border-foreground ring-1 ring-foreground/15 shadow-sm', !group.selectable && 'opacity-65')}>
                <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', look.marker)} />
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Select ${group.label}: ${group.count} affiliates`}
                  disabled={disabled || !group.selectable}
                  onClick={() => onSelectedGroupChange(group)}
                  className="flex w-full items-start gap-3 p-4 pb-3 text-left outline-none transition-colors hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed"
                >
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', look.tone)}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2"><span className="text-sm font-semibold">{group.label}</span><span className="font-mono text-sm tabular-nums">{group.count.toLocaleString()}</span></span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-4">{group.description}</span>
                  </span>
                  <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border', selected && 'border-foreground bg-foreground text-background')} aria-hidden>{selected && <Check className="size-3" />}</span>
                </button>

                <div className="flex items-center justify-between gap-2 px-4 pb-3">
                  <Badge variant={safetyVariant(group.safetyLevel)}>{group.safety}</Badge>
                  <Button size="sm" variant="ghost" aria-expanded={expanded} aria-controls={`criteria-${group.id}`} onClick={() => setExpandedGroupId(expanded ? null : group.id)}>{expanded ? 'Hide criteria' : 'View criteria'}{expanded ? <ChevronUp /> : <ChevronDown />}</Button>
                </div>
                {expanded && (
                  <div id={`criteria-${group.id}`} className="border-t bg-muted/15 px-4 py-3">
                    <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-[0.13em]">Deterministic criteria</p>
                    <ul className="grid gap-1.5">{group.criteria.map((criterion, index) => <li key={`${group.id}-${index}`} className="flex gap-2 text-xs leading-4"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/55" />{criterion}</li>)}</ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {selectedGroup ? (
          <section className="border-t" aria-labelledby="selected-audience-heading">
            <div className="flex flex-col gap-3 border-b bg-muted/10 p-4 md:flex-row md:items-center">
              <div className="mr-auto min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h3 id="selected-audience-heading" className="font-semibold">{selectedGroup.label}</h3><Badge variant="secondary">Selected draft target</Badge></div>
                <p className="text-muted-foreground mt-1 text-xs">Previewing {selectedGroup.memberPreview.length.toLocaleString()} of {selectedGroup.count.toLocaleString()} matching affiliates</p>
              </div>
              <div className="relative w-full md:w-64">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" placeholder="Filter preview…" aria-label="Filter selected audience preview" />
              </div>
              <Select value={filter} onValueChange={(value) => setFilter(value as MemberFilter)}>
                <SelectTrigger className="w-full md:w-40" aria-label="Filter preview members"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All preview</SelectItem>
                  <SelectItem value="review">Needs review</SelectItem>
                  <SelectItem value="healthy">Lower risk</SelectItem>
                  <SelectItem value="active">Has activity</SelectItem>
                  <SelectItem value="inactive">No activity</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="border-b bg-muted/15 text-left text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  <tr><th className="px-4 py-3">Affiliate</th><th className="px-3 py-3">Evidence</th><th className="px-3 py-3 text-right">Visitors</th><th className="px-3 py-3 text-right">Conversions</th><th className="px-3 py-3 text-right">Due</th><th className="px-4 py-3 text-right">Risk</th></tr>
                </thead>
                <tbody>
                  {visibleMembers.map((member) => (
                    <tr key={member.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3"><p className="font-medium">{member.name}</p><p className="text-muted-foreground mt-0.5 text-xs">{member.email || 'No email address'}</p><Badge variant="outline" className="mt-1.5">{member.status.replaceAll('_', ' ')}</Badge></td>
                      <td className="px-3 py-3"><ul className="grid max-w-lg gap-1">{member.evidence.slice(0, 3).map((evidence, index) => <li key={`${member.id}-${index}`} className="flex gap-2 text-xs leading-4"><Activity className="text-muted-foreground mt-0.5 size-3 shrink-0" />{evidence}</li>)}</ul></td>
                      <td className="px-3 py-3 text-right tabular-nums">{member.visitors.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{member.conversions.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{money.format(member.unpaidCommissionCents / 100)}</td>
                      <td className="px-4 py-3 text-right"><Badge variant={member.riskScore >= 60 ? 'destructive' : 'secondary'}>{member.riskScore}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleMembers.length === 0 && <div className="text-muted-foreground p-10 text-center text-sm">No preview members match this filter.</div>}
            <div className="text-muted-foreground flex flex-col gap-1 border-t bg-muted/10 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between"><span>Preview only · full membership is resolved from the server criteria.</span><span>Selection updates the draft target; it does not sync or send.</span></div>
          </section>
        ) : (
          <div className="border-t p-10 text-center"><Clock3 className="text-muted-foreground mx-auto size-5" /><p className="mt-2 text-sm font-medium">No selectable audience group</p></div>
        )}
      </CardContent>
    </Card>
  );
}
