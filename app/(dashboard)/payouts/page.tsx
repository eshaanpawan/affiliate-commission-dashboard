'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, PauseCircle, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageControls } from '@/components/PageControls';
import { ExpandableRows } from '@/components/ExpandableRows';

interface Hold {
  id: string;
  affiliateId: string;
  amountCents: number;
  reason: string | null;
  status: 'held' | 'released' | 'voided';
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  name?: string | null;
  email?: string | null;
  unpaidCommissionCents?: number | null;
}

interface SourcePayout {
  id: string;
  affiliateId: string | null;
  affiliateName: string;
  email: string | null;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string | null;
  paidAt: string | null;
  holdStatus: string | null;
  holdReason: string | null;
}

const fmtUsd = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BADGE_GREEN = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
const BADGE_AMBER = 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
const BADGE_RED = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';

function holdBadgeClass(s: string) {
  return s === 'held' ? BADGE_AMBER : s === 'released' ? BADGE_GREEN : BADGE_RED;
}

function payoutBadgeClass(s: string) {
  return s === 'paid' ? BADGE_GREEN : s === 'failed' ? BADGE_RED : BADGE_AMBER;
}

export default function PayoutReviewPage() {
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [payouts, setPayouts] = useState<SourcePayout[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'rewardful' | 'holds'>('rewardful');
  const [filter, setFilter] = useState<'held' | 'released' | 'voided' | 'all'>('held');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<Hold | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [holdsResponse, payoutsResponse] = await Promise.all([
        fetch('/api/holds', { cache: 'no-store' }),
        fetch('/api/payouts', { cache: 'no-store' }),
      ]);
      if (!holdsResponse.ok || !payoutsResponse.ok) throw new Error('Payout data request failed');
      const [holdsPayload, payoutsPayload] = await Promise.all([holdsResponse.json(), payoutsResponse.json()]);
      setHolds(holdsPayload.holds ?? holdsPayload);
      setPayouts(payoutsPayload.payouts ?? []);
    } catch {
      toast.error('Failed to load holds');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(h: Hold, decision: 'released' | 'held' | 'voided') {
    setBusyId(h.affiliateId);
    const t = toast.loading(`Marking ${decision}…`);
    try {
      const res = await fetch('/api/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiliateId: h.affiliateId, decision, decidedBy: 'dashboard' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'failed');
      toast.success(`${h.name ?? h.affiliateId} → ${decision}`, { id: t });
      await load();
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : e}`, { id: t });
    } finally {
      setBusyId(null);
      setConfirmVoid(null);
    }
  }

  const rows = useMemo(() => {
    if (!holds) return [];
    const q = search.toLowerCase();
    return holds
      .filter(h => filter === 'all' || h.status === filter)
      .filter(h => !q || (h.name ?? '').toLowerCase().includes(q) || (h.email ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.amountCents - a.amountCents);
  }, [holds, filter, search]);

  const heldRows = (holds ?? []).filter(h => h.status === 'held');
  const heldTotal = heldRows.reduce((s, h) => s + h.amountCents, 0);

  const buckets = [
    { label: 'Due / pending', rows: (payouts ?? []).filter((p) => ['created', 'pending', 'due'].includes(p.status)) },
    { label: 'Processing', rows: (payouts ?? []).filter((p) => p.status === 'processing') },
    { label: 'Paid', rows: (payouts ?? []).filter((p) => p.status === 'paid') },
    { label: 'On fraud hold', rows: (payouts ?? []).filter((p) => p.holdStatus === 'held') },
  ].map((b) => ({ ...b, cents: b.rows.reduce((sum, payout) => sum + payout.amountCents, 0) }));
  const maxBucket = Math.max(...buckets.map((b) => b.cents), heldTotal, 1);

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      {confirmVoid && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setConfirmVoid(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Void {fmtUsd(confirmVoid.amountCents)} for {confirmVoid.name ?? confirmVoid.affiliateId}?</AlertDialogTitle>
              <AlertDialogDescription>
                This records a local forfeiture decision and audit event. It does not delete or void a
                Rewardful commission. A separate reviewed source action is still required before the
                commercial balance changes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() => decide(confirmVoid, 'voided')}
              >
                Void it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Header */}
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Payout Review</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Reconcile Rewardful payout state with local fraud holds before any payment is approved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageControls />
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {buckets.map((item) => (
          <Card key={item.label} className="w-full gap-0 p-6 py-4">
            <CardContent className="p-0">
              <dt className="text-muted-foreground text-sm font-medium">{item.label}</dt>
              <dd className="text-foreground mt-2 text-3xl font-semibold tabular-nums">{fmtUsd(item.cents)}</dd>
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-muted-foreground text-xs">{item.rows.length.toLocaleString()} payouts</p>
                <Progress value={Math.min(100, (item.cents / maxBucket) * 100)} className="h-1" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Currently frozen */}
      <div className="bg-muted border-border flex flex-col gap-3 rounded-md border p-4 lg:max-w-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-background border-border flex size-8 items-center justify-center rounded-md border">
              <ShieldAlert className="size-4" />
            </div>
            <div>
              <span className="text-sm">Currently frozen</span>
              <p className="text-muted-foreground text-xs">{heldRows.length} affiliates on hold</p>
            </div>
          </div>
          <div className="font-semibold tabular-nums">{fmtUsd(heldTotal)}</div>
        </div>
        <Progress value={Math.min(100, (heldTotal / maxBucket) * 100)} className="h-1" />
      </div>

      <Tabs value={view} onValueChange={(value) => setView(value as typeof view)}>
        <TabsList><TabsTrigger value="rewardful">Rewardful payouts</TabsTrigger><TabsTrigger value="holds">Fraud holds</TabsTrigger></TabsList>
      </Tabs>

      {view === 'holds' && <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="held">Held</TabsTrigger>
            <TabsTrigger value="released">Released</TabsTrigger>
            <TabsTrigger value="voided">Voided</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input type="search" placeholder="Search name or email…" value={search}
          onChange={(e) => setSearch(e.target.value)} className="ml-auto h-9 w-64 text-xs" />
      </div>}

      {view === 'rewardful' ? (
        <Card className="overflow-x-auto py-0">
          {loading && !payouts ? <div className="grid gap-2 p-4">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12" />)}</div> : (payouts ?? []).length === 0 ? (
            <p className="text-muted-foreground p-12 text-center text-sm">No Rewardful payouts have been synchronized yet. Run Sync Rewardful from the header.</p>
          ) : (
            <ExpandableRows items={payouts ?? []} preview={5} perPage={10} label="payouts" render={(pageRows) => (
            <Table className="min-w-[900px]">
              <TableHeader><TableRow><TableHead className="px-5">Affiliate</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Created</TableHead><TableHead>Paid</TableHead><TableHead className="px-5">Review gate</TableHead></TableRow></TableHeader>
              <TableBody>{pageRows.map((payout) => <TableRow key={payout.id}><TableCell className="px-5"><p className="font-medium">{payout.affiliateName}</p><p className="text-muted-foreground text-xs">{payout.email}</p></TableCell><TableCell><Badge variant="outline" className={cn('rounded-full capitalize', payoutBadgeClass(payout.status))}>{payout.status}</Badge></TableCell><TableCell className="text-right font-semibold tabular-nums">{fmtUsd(payout.amountCents)}</TableCell><TableCell className="text-muted-foreground text-xs">{payout.createdAt ? new Date(payout.createdAt).toLocaleDateString() : '—'}</TableCell><TableCell className="text-muted-foreground text-xs">{payout.paidAt ? new Date(payout.paidAt).toLocaleDateString() : '—'}</TableCell><TableCell className="px-5">{payout.holdStatus === 'held' ? <Badge variant="outline" className={cn('rounded-full', BADGE_AMBER)}>Held · investigate</Badge> : <span className="text-muted-foreground text-xs">No local hold</span>}</TableCell></TableRow>)}</TableBody>
            </Table>
            )} />
          )}
        </Card>
      ) : <Card className="overflow-x-auto py-0">
        {loading && !holds ? (
          <div className="grid gap-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-12 text-center text-sm">
            {filter === 'held' ? 'Nothing on hold.' : 'No holds match this filter.'}
          </p>
        ) : (
          <ExpandableRows items={rows} preview={5} perPage={10} label="holds" render={(pageRows) => (
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">Affiliate</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Frozen amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decided</TableHead>
                <TableHead className="px-5 text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="px-5">
                    <p className="font-medium">{h.name ?? h.affiliateId}</p>
                    <p className="text-muted-foreground text-xs">{h.email}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[280px] truncate text-xs" title={h.reason ?? ''}>
                    {h.reason ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{fmtUsd(h.amountCents)}</TableCell>
                  <TableCell><Badge variant="outline" className={cn('rounded-full capitalize', holdBadgeClass(h.status))}>{h.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {h.decidedAt ? `${new Date(h.decidedAt).toLocaleDateString()} · ${h.decidedBy ?? ''}` : '—'}
                  </TableCell>
                  <TableCell className="px-5">
                    <div className="flex justify-end gap-1.5">
                      {h.status !== 'released' && (
                        <Button size="sm" variant="outline" disabled={busyId === h.affiliateId}
                          className="text-emerald-700 dark:text-emerald-300"
                          onClick={() => decide(h, 'released')}>
                          {busyId === h.affiliateId ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                          Release
                        </Button>
                      )}
                      {h.status !== 'held' && (
                        <Button size="sm" variant="outline" disabled={busyId === h.affiliateId} onClick={() => decide(h, 'held')}>
                          <PauseCircle className="size-3.5" /> Re-hold
                        </Button>
                      )}
                      {h.status !== 'voided' && (
                        <Button size="sm" variant="outline" disabled={busyId === h.affiliateId}
                          className="text-red-600 dark:text-red-400"
                          onClick={() => setConfirmVoid(h)}>
                          <XCircle className="size-3.5" /> Void
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )} />
        )}
      </Card>}
    </div>
  );
}
