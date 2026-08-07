'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Loader2, RefreshCw, ScrollText, ShieldAlert, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageControls } from '@/components/PageControls';

interface QueueRow {
  rewardfulId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  enforcementState: string;
  enforcementReason: string | null;
  enforcementProposedAt: string | null;
  enforcementAppliedAt: string | null;
  rewardfulStateBefore: string | null;
  unpaidCommissionCents: number;
}
interface LogRow {
  id: string; affiliateId: string; action: string; actor: string | null;
  result: string | null; createdAt: string;
}

interface WarRoomAffiliate {
  id: string; name: string; email: string | null; source: string;
  enforcementState: string; fraudTags: string[];
  unpaidCommissionCents: number;
  risk: {
    score: number; band: 'low' | 'medium' | 'high';
    signals: { key: string; label: string; severity: string; detail: string }[];
  };
}

const fmtUsd = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function stateBadge(state: string) {
  return state === 'banned' ? 'rounded-full bg-red-600 text-white'
    : state === 'proposed_ban' ? 'rounded-full bg-amber-500 text-white'
    : 'rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
}

export default function EnforcementPage() {
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [recommended, setRecommended] = useState<WarRoomAffiliate[] | null>(null);
  const [recLoading, setRecLoading] = useState(true);
  const [proposingId, setProposingId] = useState<string | null>(null);

  const loadRecommended = useCallback(async () => {
    setRecLoading(true);
    try {
      const res = await fetch('/api/warroom?days=90', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      const affiliates: WarRoomAffiliate[] = j.affiliates ?? [];
      setRecommended(affiliates
        .filter((a) => a.enforcementState === 'none'
          && (a.risk.band === 'high' || a.fraudTags.some((tag) => tag.startsWith('dub:'))))
        .sort((a, b) => b.risk.score - a.risk.score || b.unpaidCommissionCents - a.unpaidCommissionCents)
        .slice(0, 10));
    } catch {
      setRecommended([]);
    } finally {
      setRecLoading(false);
    }
  }, []);

  useEffect(() => { loadRecommended(); }, [loadRecommended]);

  async function proposeOne(a: WarRoomAffiliate) {
    setProposingId(a.id);
    const t = toast.loading(`Proposing ban on ${a.name}…`);
    try {
      const res = await fetch('/api/enforcement/propose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateIds: [a.id], reason: 'Brand-bidding / paid-ads traffic (war room)' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'failed');
      toast.success(`Staged ban proposal for ${a.name}. Apply it below when ready.`, { id: t });
      await Promise.all([load(), loadRecommended()]);
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : e}`, { id: t });
    } finally {
      setProposingId(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/enforcement');
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      setQueue(j.queue ?? []);
      setLog(j.log ?? []);
    } catch {
      toast.error('Failed to load enforcement data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const proposed = (queue ?? []).filter(q => q.enforcementState === 'proposed_ban');
  const banned = (queue ?? []).filter(q => q.enforcementState === 'banned');
  const applicable = proposed.filter(q => selected.has(q.rewardfulId)).map(q => q.rewardfulId);
  const revertable = banned.filter(q => selected.has(q.rewardfulId)).map(q => q.rewardfulId);

  async function call(path: string, ids: string[], label: string) {
    setBusy(true);
    const t = toast.loading(`${label} ${ids.length} affiliate(s)…`);
    try {
      const res = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateIds: ids }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'failed');
      const results: { id: string; result?: string }[] = j.results ?? [];
      const failed = results.filter(r => r.result && r.result !== 'ok');
      if (failed.length) toast.warning(`${label} done — ${failed.length} failed (see log)`, { id: t });
      else toast.success(`${label} complete`, { id: t });
      setSelected(new Set());
      await load();
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : e}`, { id: t });
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  }

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      {confirmApply && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setConfirmApply(false); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply {applicable.length} ban(s) to Rewardful?</AlertDialogTitle>
              <AlertDialogDescription>
                This writes <code>state=suspicious</code> to the live Rewardful account for each selected
                affiliate: their tracking stops, they can no longer earn commissions, and they lose
                dashboard access. It is reversible from this screen (Revert restores their previous state).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700"
                onClick={() => call('/api/enforcement/apply', applicable, 'Applying ban on')}>
                Apply to Rewardful
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Enforcement</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Staged bans from the war room. Nothing touches Rewardful until you apply it here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageControls />
          {applicable.length > 0 && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmApply(true)}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
              Apply {applicable.length} to Rewardful
            </Button>
          )}
          {revertable.length > 0 && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => call('/api/enforcement/revert', revertable, 'Reverting')}>
              <Undo2 className="size-3.5" /> Revert {revertable.length}
            </Button>
          )}
          {selected.size > 0 && applicable.length === 0 && revertable.length === 0 && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => call('/api/enforcement/revert', [...selected], 'Clearing')}>
              <CheckCircle2 className="size-3.5" /> Clear {selected.size}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-2xl">
        <Card className="w-full gap-0 p-6 py-4 bg-linear-to-tr from-amber-200/40 to-amber-100/40 dark:from-amber-950/40 dark:to-amber-900/40 border-amber-300 dark:border-amber-950 shadow-none">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground text-sm font-medium">Proposed bans</dt>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                <ScrollText className="size-4" />
              </div>
            </div>
            <dd className="text-foreground mt-2 text-3xl font-semibold tabular-nums">{proposed.length}</dd>
            <p className="text-muted-foreground mt-1 text-xs">Staged from the war room, awaiting apply</p>
          </CardContent>
        </Card>
        <Card className="w-full gap-0 p-6 py-4 bg-linear-to-tr from-red-200/40 to-red-100/40 dark:from-red-950/40 dark:to-red-900/40 border-red-300 dark:border-red-950 shadow-none">
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground text-sm font-medium">Banned in Rewardful</dt>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">
                <Ban className="size-4" />
              </div>
            </div>
            <dd className="text-foreground mt-2 text-3xl font-semibold tabular-nums">{banned.length}</dd>
            <p className="text-muted-foreground mt-1 text-xs">Applied to the live Rewardful account</p>
          </CardContent>
        </Card>
      </div>

      {/* Recommended for enforcement */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldAlert className="size-4" />
            Recommended for enforcement
          </CardTitle>
          <CardDescription className="text-xs">
            Top war-room cases (high risk or Dub-flagged) with no action yet. Proposals are staged here and never
            touch Rewardful until applied.
          </CardDescription>
        </CardHeader>
        {recLoading && !recommended ? (
          <div className="grid gap-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (recommended ?? []).length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            No unactioned high-risk or Dub-flagged affiliates right now — check the War Room for details.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Affiliate</TableHead>
                  <TableHead className="text-right">Risk</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead className="text-right">Unpaid $</TableHead>
                  <TableHead className="px-4 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recommended ?? []).map((a) => {
                  const dub = a.fraudTags.filter((tag) => tag.startsWith('dub:'));
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium">{a.name}</p>
                          <Badge
                            variant="outline"
                            className={cn(
                              'rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide',
                              a.source === 'dub'
                                ? 'border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300'
                                : 'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300',
                            )}
                          >
                            {a.source}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-xs">{a.email}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              'rounded-full font-bold tabular-nums',
                              a.risk.band === 'high'
                                ? 'border-red-300 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
                                : a.risk.band === 'medium'
                                  ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
                                  : 'border-border bg-muted text-muted-foreground',
                            )}
                          >
                            {a.risk.score}
                          </Badge>
                          <Progress value={a.risk.score} className="h-1 w-16" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[300px] flex-wrap gap-1">
                          {dub.map((tag) => (
                            <Badge key={tag} variant="outline" className="rounded-full border-red-300 bg-red-100 font-mono text-[10px] text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300">
                              {tag}
                            </Badge>
                          ))}
                          {a.risk.signals.slice(0, 3).map((s) => (
                            <Badge
                              key={s.key}
                              variant="outline"
                              className={cn(
                                'rounded-full text-[10px]',
                                s.severity === 'high'
                                  ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
                                  : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
                              )}
                            >
                              {s.label}
                            </Badge>
                          ))}
                          {dub.length === 0 && a.risk.signals.length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">
                        {fmtUsd(a.unpaidCommissionCents)}
                      </TableCell>
                      <TableCell className="px-4 text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={proposingId !== null || busy}
                          onClick={() => proposeOne(a)}
                        >
                          {proposingId === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
                          Propose ban
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Queue */}
      <Card className="overflow-hidden py-0">
        {loading && !queue ? (
          <div className="grid gap-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (queue ?? []).length === 0 ? (
          <p className="text-muted-foreground p-12 text-center text-sm">
            Queue is empty — propose bans from the War Room.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 px-4">
                  <Checkbox
                    checked={(queue ?? []).length > 0 && (queue ?? []).every(q => selected.has(q.rewardfulId))}
                    onCheckedChange={(c) => setSelected(c ? new Set((queue ?? []).map(q => q.rewardfulId)) : new Set())}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Affiliate</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Unpaid</TableHead>
                <TableHead className="px-5">Timeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(queue ?? []).map((q) => (
                <TableRow key={q.rewardfulId}>
                  <TableCell className="px-4">
                    <Checkbox
                      checked={selected.has(q.rewardfulId)}
                      onCheckedChange={(c) => setSelected(prev => {
                        const next = new Set(prev);
                        if (c) next.add(q.rewardfulId); else next.delete(q.rewardfulId);
                        return next;
                      })}
                      aria-label={`Select ${q.firstName ?? q.rewardfulId}`}
                    />
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{[q.firstName, q.lastName].filter(Boolean).join(' ') || q.rewardfulId}</p>
                    <p className="text-muted-foreground text-xs">{q.email}</p>
                  </TableCell>
                  <TableCell><Badge className={stateBadge(q.enforcementState)}>{q.enforcementState.replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-muted-foreground max-w-[260px] truncate text-xs" title={q.enforcementReason ?? ''}>
                    {q.enforcementReason ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">
                    {fmtUsd(q.unpaidCommissionCents ?? 0)}
                  </TableCell>
                  <TableCell className="text-muted-foreground px-5 text-xs">
                    {q.enforcementProposedAt && <>proposed {new Date(q.enforcementProposedAt).toLocaleDateString()}</>}
                    {q.enforcementAppliedAt && <> · applied {new Date(q.enforcementAppliedAt).toLocaleDateString()}</>}
                    {q.rewardfulStateBefore && <> · was {q.rewardfulStateBefore}</>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </Card>

      {/* Audit log */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="[.border-b]:pb-0 border-b py-4">
          <CardTitle className="text-sm">Audit log</CardTitle>
          <CardDescription className="text-xs">Every enforcement action ever taken, append-only</CardDescription>
        </CardHeader>
        {log.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">No actions logged yet.</p>
        ) : (
          <div className="divide-y">
            {log.slice(0, 50).map((l) => (
              <div key={l.id} className="flex items-center justify-between px-5 py-2.5 text-xs">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="font-mono">{l.action}</Badge>
                  <span className="text-muted-foreground font-mono">{l.affiliateId.slice(0, 8)}…</span>
                  <span className={cn(l.result === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {l.result ?? ''}
                  </span>
                </div>
                <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
