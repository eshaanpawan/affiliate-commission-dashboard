'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, Loader2, RefreshCw, ScrollText, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

const fmtUsd = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function stateBadge(state: string) {
  return state === 'banned' ? 'bg-red-600 text-white'
    : state === 'proposed_ban' ? 'bg-amber-500 text-white'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
}

export default function EnforcementPage() {
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

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
    <div className="grid gap-6 p-6">
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ScrollText className="size-6" /> Enforcement
          </h1>
          <p className="text-muted-foreground text-sm">
            Staged bans from the war room. Nothing touches Rewardful until you apply it here.
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="grid grid-cols-2 gap-4 lg:max-w-md">
        <Card className="gap-1 border-amber-200 bg-amber-50/60 py-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardHeader className="px-4">
            <CardDescription className="text-xs font-medium text-amber-700 dark:text-amber-300">Proposed</CardDescription>
            <CardTitle className="mt-1 text-2xl tabular-nums text-amber-700 dark:text-amber-300">{proposed.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-1 border-red-200 bg-red-50/60 py-4 dark:border-red-500/30 dark:bg-red-500/10">
          <CardHeader className="px-4">
            <CardDescription className="text-xs font-medium text-red-700 dark:text-red-300">Banned in Rewardful</CardDescription>
            <CardTitle className="mt-1 text-2xl tabular-nums text-red-700 dark:text-red-300">{banned.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Queue */}
      <Card className="overflow-x-auto py-0">
        {loading && !queue ? (
          <div className="grid gap-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (queue ?? []).length === 0 ? (
          <p className="text-muted-foreground p-12 text-center text-sm">
            Queue is empty — propose bans from the War Room.
          </p>
        ) : (
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
