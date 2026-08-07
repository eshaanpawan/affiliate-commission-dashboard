'use client';

import * as React from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MoonStar,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
  manualGroupId?: string | null;
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
  selectedGroupIds?: string[];
  draftTarget?: {
    groupId: string;
    groupIds?: string[];
    selectedAt: string | null;
    saved: boolean;
    localMetadataOnly: boolean;
    instantiatedInInstantly: boolean;
  };
  groups: AudienceGroup[];
}

export interface AudienceGroupsProps {
  payload: AudienceGroupsPayload;
  selectedGroupIds: string[];
  onToggleGroup: (group: AudienceGroup) => void;
  onMembersChanged?: () => void;
  disabled?: boolean;
  className?: string;
}

const groupLooks: Record<string, { icon: typeof Users; tone: string }> = {
  brand_bidding_review: { icon: ShieldAlert, tone: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' },
  high_risk_review: { icon: CircleAlert, tone: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' },
  good_performers: { icon: TrendingUp, tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
  new_unproven: { icon: Sparkles, tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' },
  dormant: { icon: MoonStar, tone: 'bg-stone-100 text-stone-700 dark:bg-stone-500/15 dark:text-stone-300' },
  developing_partners: { icon: Activity, tone: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300' },
  all_emailable: { icon: Users, tone: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' },
};

function normalizeGroupId(id: string) {
  return id.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function groupLook(group: Pick<AudienceGroup, 'id'>) {
  return groupLooks[normalizeGroupId(group.id)] ?? { icon: Users, tone: 'bg-muted text-foreground' };
}

function safetyVariant(level: AudienceGroupSafety | undefined) {
  if (level === 'restricted') return 'destructive' as const;
  if (level === 'review') return 'outline' as const;
  return 'secondary' as const;
}

type MembersPage = {
  selected: {
    id: string;
    page: { number: number; size: number; total: number; pages: number };
    members: AudienceGroupMember[];
  };
};

function GroupMembersDialog({
  group,
  groups,
  open,
  onOpenChange,
  onMembersChanged,
  disabled,
}: {
  group: AudienceGroup;
  groups: AudienceGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMembersChanged?: () => void;
  disabled: boolean;
}) {
  const [page, setPage] = React.useState(1);
  const [query, setQuery] = React.useState('');
  const [appliedQuery, setAppliedQuery] = React.useState('');
  const [data, setData] = React.useState<MembersPage | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [movingId, setMovingId] = React.useState<string | null>(null);

  const load = React.useCallback(async (nextPage: number, nextQuery: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ group: group.id, page: String(nextPage), pageSize: '50' });
      if (nextQuery) params.set('q', nextQuery);
      const response = await fetch(`/api/mail/groups?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      setData(payload as MembersPage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load group members.');
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  React.useEffect(() => {
    if (open) {
      setPage(1);
      setQuery('');
      setAppliedQuery('');
      void load(1, '');
    } else {
      setData(null);
    }
  }, [open, load]);

  async function moveMember(member: AudienceGroupMember, targetGroupId: string | null) {
    setMovingId(member.id);
    try {
      const response = await fetch('/api/mail/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, affiliateId: member.id, groupId: targetGroupId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      const targetLabel = targetGroupId ? groups.find((item) => item.id === targetGroupId)?.label ?? targetGroupId : null;
      toast.success(targetLabel ? `${member.name} moved to ${targetLabel}.` : `${member.name} reset to the computed group.`);
      await load(page, appliedQuery);
      onMembersChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not move this affiliate.');
    } finally {
      setMovingId(null);
    }
  }

  const members = data?.selected.members ?? [];
  const pageInfo = data?.selected.page;
  const moveTargets = groups.filter((item) => normalizeGroupId(item.id) !== 'all_emailable' && item.id !== group.id);
  const canManage = !disabled && normalizeGroupId(group.id) !== 'all_emailable';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{group.label} · {group.count.toLocaleString()}</DialogTitle>
          <DialogDescription>{group.description}</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 gap-2 border-b bg-muted/10 px-5 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              className="pl-8"
              placeholder="Search name or email"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1);
                  setAppliedQuery(query);
                  void load(1, query);
                }
              }}
            />
          </div>
          {appliedQuery && (
            <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setAppliedQuery(''); setPage(1); void load(1, ''); }}><X /> Clear</Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !data ? (
            <div className="grid gap-2 p-5">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div>
          ) : members.length === 0 ? (
            <p className="text-muted-foreground p-10 text-center text-sm">{appliedQuery ? `No member matches “${appliedQuery}”.` : 'No members in this group.'}</p>
          ) : (
            members.map((member) => (
              <div key={member.id} className="flex items-center gap-3 border-b px-5 py-2.5 last:border-0 hover:bg-muted/20">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{member.name}</p>
                    {member.manualGroupId && <Badge variant="outline" className="shrink-0 text-[10px]">manually placed</Badge>}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">{member.email || 'No email address'}</p>
                </div>
                <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{member.conversions.toLocaleString()} conv</span>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={movingId === member.id}>
                        {movingId === member.id ? <LoaderCircle className="animate-spin" /> : <ArrowRight />} Move
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Move to group</DropdownMenuLabel>
                      {moveTargets.map((target) => (
                        <DropdownMenuItem key={target.id} onSelect={() => void moveMember(member, target.id)}>
                          {target.label}
                        </DropdownMenuItem>
                      ))}
                      {member.manualGroupId && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => void moveMember(member, null)}>Reset to computed group</DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))
          )}
        </div>
        {pageInfo && pageInfo.pages > 1 && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/10 px-5 py-2.5">
            <p className="text-muted-foreground text-xs tabular-nums">{pageInfo.total.toLocaleString()} members</p>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => { const next = page - 1; setPage(next); void load(next, appliedQuery); }}><ArrowLeft /> Prev</Button>
              <span className="text-muted-foreground min-w-16 text-center text-xs tabular-nums">Page {pageInfo.number} of {pageInfo.pages}</span>
              <Button variant="outline" size="sm" disabled={loading || page >= pageInfo.pages} onClick={() => { const next = page + 1; setPage(next); void load(next, appliedQuery); }}>Next <ArrowRight /></Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AudienceGroups({ payload, selectedGroupIds, onToggleGroup, onMembersChanged, disabled = false, className }: AudienceGroupsProps) {
  const [expandedGroupId, setExpandedGroupId] = React.useState<string | null>(null);
  const [membersGroupId, setMembersGroupId] = React.useState<string | null>(null);

  const membersGroup = payload.groups.find((group) => group.id === membersGroupId) ?? null;

  return (
    <Card className={cn('gap-0 overflow-hidden py-0', className)}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b py-4">
        <CardTitle>Campaign audience</CardTitle>
        <p className="text-muted-foreground text-sm"><span className="text-foreground font-semibold tabular-nums">{payload.totalEmailable.toLocaleString()}</span> emailable affiliates</p>
      </CardHeader>

      <CardContent className="p-0">
        <div role="group" aria-label="Campaign audience groups" className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {payload.groups.map((group) => {
            const look = groupLook(group);
            const Icon = look.icon;
            const selected = selectedGroupIds.includes(group.id);
            const expanded = expandedGroupId === group.id;
            return (
              <article key={group.id} className={cn('relative flex flex-col overflow-hidden rounded-xl border bg-background transition-all', selected ? 'border-foreground/60 shadow-sm ring-1 ring-foreground/10' : 'hover:border-foreground/25', !group.selectable && 'opacity-60')}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={`${selected ? 'Remove' : 'Add'} ${group.label}: ${group.count} affiliates`}
                  disabled={disabled || !group.selectable}
                  onClick={() => onToggleGroup(group)}
                  className="flex w-full flex-1 items-start gap-3 p-4 pb-2.5 text-left outline-none transition-colors hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed"
                >
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', look.tone)}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{group.label}</span>
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">{group.count.toLocaleString()}</span>
                    </span>
                    <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-4">{group.description}</span>
                  </span>
                  <span className={cn('mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full border transition-colors', selected ? 'border-foreground bg-foreground text-background' : 'border-border')} aria-hidden>{selected && <Check className="size-3" />}</span>
                </button>

                <div className="mt-auto flex items-center justify-between gap-1 px-4 pb-3">
                  <Badge variant={safetyVariant(group.safetyLevel)} className="max-w-[45%] truncate">{group.safety}</Badge>
                  <div className="flex items-center">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setMembersGroupId(group.id)}><Users /> Members</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" aria-expanded={expanded} aria-controls={`criteria-${group.id}`} onClick={() => setExpandedGroupId(expanded ? null : group.id)}>Criteria{expanded ? <ChevronUp /> : <ChevronDown />}</Button>
                  </div>
                </div>
                {expanded && (
                  <div id={`criteria-${group.id}`} className="border-t bg-muted/15 px-4 py-3">
                    <ul className="grid gap-1.5">{group.criteria.map((criterion, index) => <li key={`${group.id}-${index}`} className="flex gap-2 text-xs leading-4"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/55" />{criterion}</li>)}</ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {selectedGroupIds.length === 0 && (
          <div className="border-t p-10 text-center"><Clock3 className="text-muted-foreground mx-auto size-5" /><p className="mt-2 text-sm font-medium">Select at least one audience group</p></div>
        )}
      </CardContent>

      {membersGroup && (
        <GroupMembersDialog
          group={membersGroup}
          groups={payload.groups}
          open={membersGroupId !== null}
          onOpenChange={(open) => { if (!open) setMembersGroupId(null); }}
          onMembersChanged={onMembersChanged}
          disabled={disabled}
        />
      )}
    </Card>
  );
}
