'use client';

import * as React from 'react';
import { CircleAlert, CircleCheckBig, LoaderCircle, Pause, RefreshCw, Rocket, Users } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type LaunchPreview = {
  campaignStatus: number | null;
  campaignName: string | null;
  groups: { ids: string[]; labels: string[] };
  targetCount: number;
  remoteLeadCount: number;
  remoteTruncated: boolean;
  toAdd: number;
  toRemove: number;
  ready: boolean;
  problems: string[];
};

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload as T;
}

function statusLabel(status: number | null) {
  if (status === 0) return { label: 'Draft', active: false };
  if (status === 2) return { label: 'Paused', active: false };
  if (status === 1) return { label: 'Sending', active: true };
  if (status === 3) return { label: 'Completed', active: false };
  return { label: 'Unknown', active: false };
}

export function LaunchPanel({ onChanged, className }: { onChanged?: () => void; className?: string }) {
  const [preview, setPreview] = React.useState<LaunchPreview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [sendNow, setSendNow] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setPreview(await readJson<LaunchPreview>('/api/mail/campaign/launch'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load launch status.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  async function reconcile() {
    setBusy('reconcile');
    try {
      let added = 0;
      let removed = 0;
      for (let round = 0; round < 12; round += 1) {
        const result = await readJson<{ added: number; removed: number; remainingRemovals: number; done: boolean; removeErrors: string[] }>(
          '/api/mail/campaign/launch',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, action: 'reconcile' }) },
        );
        added += result.added;
        removed += result.removed;
        if (result.removeErrors?.length) toast.warning(`Some removals failed: ${result.removeErrors[0]}`);
        if (result.done || result.remainingRemovals === 0) break;
      }
      toast.success(`Recipients reconciled: ${added.toLocaleString()} added, ${removed.toLocaleString()} removed.`);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Recipient reconciliation failed.');
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    setConfirmOpen(false);
    setBusy('launch');
    try {
      const result = await readJson<{ recipients: number }>('/api/mail/campaign/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, action: 'launch', sendNow }),
      });
      toast.success(sendNow
        ? `Campaign launched — delivery starts immediately to ${result.recipients.toLocaleString()} recipients.`
        : `Campaign launched. Instantly is now delivering to ${result.recipients.toLocaleString()} recipients on your schedule.`);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Launch failed.');
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function pause() {
    setBusy('pause');
    try {
      await readJson('/api/mail/campaign/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, action: 'pause' }),
      });
      toast.success('Campaign paused. Delivery stopped.');
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Pause failed.');
    } finally {
      setBusy(null);
    }
  }

  if (loading && !preview) return <Skeleton className={cn('h-24 w-full rounded-xl', className)} />;
  if (!preview) return null;

  const state = statusLabel(preview.campaignStatus);
  const needsReconcile = preview.toAdd > 0 || preview.toRemove > 0 || preview.remoteTruncated;

  return (
    <>
      <Card className={cn('gap-0 overflow-hidden py-0', state.active && 'border-emerald-500/50', className)}>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', state.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground')}>
            {state.active ? <LoaderCircle className="size-5 animate-spin" /> : <Rocket className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">Send campaign</p>
              <Badge variant={state.active ? 'default' : 'secondary'}>{state.label}</Badge>
            </div>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
              <Users className="size-3.5" />
              <span><strong className="text-foreground tabular-nums">{preview.targetCount.toLocaleString()}</strong> recipients · {preview.groups.labels.join(' + ')}</span>
              <span>· {preview.remoteLeadCount.toLocaleString()} in campaign now</span>
              {needsReconcile && <span className="text-amber-600">· {preview.toAdd.toLocaleString()} to add, {preview.toRemove.toLocaleString()} to remove</span>}
            </p>
            {preview.problems.length > 0 && (
              <p className="text-destructive mt-1 flex items-center gap-1.5 text-xs"><CircleAlert className="size-3.5" /> {preview.problems.join(' ')}</p>
            )}
            {!needsReconcile && !state.active && preview.problems.length === 0 && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600"><CircleCheckBig className="size-3.5" /> Recipients match the selected groups — ready to launch.</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => void load()} disabled={busy !== null} aria-label="Refresh launch status"><RefreshCw className={loading ? 'animate-spin' : undefined} /></Button>
            {state.active ? (
              <Button variant="outline" size="sm" onClick={() => void pause()} disabled={busy !== null}><Pause /> {busy === 'pause' ? 'Pausing…' : 'Pause sending'}</Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => void reconcile()} disabled={busy !== null || preview.campaignStatus === 3}>
                  {busy === 'reconcile' ? <LoaderCircle className="animate-spin" /> : <Users />} {busy === 'reconcile' ? 'Reconciling…' : 'Prepare recipients'}
                </Button>
                <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={busy !== null || !preview.ready}>
                  {busy === 'launch' ? <LoaderCircle className="animate-spin" /> : <Rocket />} {busy === 'launch' ? 'Launching…' : 'Launch'}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia><Rocket className="text-destructive" /></AlertDialogMedia>
            <AlertDialogTitle>Launch and send real email?</AlertDialogTitle>
            <AlertDialogDescription>
              Instantly will start delivering the saved sequence to {preview.targetCount.toLocaleString()} recipients
              ({preview.groups.labels.join(' + ')}) on your schedule and daily limits. This sends real email and cannot be unsent —
              you can pause delivery, but not recall messages already sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-muted/20 p-3">
            <Checkbox checked={sendNow} onCheckedChange={(checked) => setSendNow(checked === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Start sending immediately</span>
              <span className="text-muted-foreground block text-xs">Opens the schedule to all days, 00:00–23:59 — first emails go out within minutes instead of waiting for the next window. Daily limits still apply.</span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Not yet</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy !== null} onClick={(event) => { event.preventDefault(); void launch(); }}>
              Launch campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
