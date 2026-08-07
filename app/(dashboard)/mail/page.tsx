'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CircleAlert, MessageCircle, RefreshCw, Search, Send } from 'lucide-react';

import { ExpandableRows } from '@/components/ExpandableRows';
import { useDashboard } from '@/lib/use-dashboard';
import { dubMessageUrl, isDubPartner } from '@/lib/dub-links';
import { fmtCents as fmt } from '@/lib/format';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageControls } from '@/components/PageControls';

interface DubMessage {
  id: string;
  text: string;
  createdAt: string;
  senderPartnerId?: string | null;
  senderPartner?: { id: string } | null;
  senderUserId?: string | null;
}

interface DubThread {
  partner: { id: string; name?: string | null; email?: string | null };
  messages: DubMessage[];
}

function normalizeThreads(raw: unknown): DubThread[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is DubThread => !!t && typeof t === 'object' && !!(t as DubThread).partner?.id)
    .map((t) => ({ partner: t.partner, messages: Array.isArray(t.messages) ? t.messages : [] }));
}

function fromPartner(m: DubMessage): boolean {
  return Boolean(m.senderPartnerId ?? m.senderPartner?.id);
}

function DubInbox() {
  const [threads, setThreads] = useState<DubThread[] | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/dub/messages', { cache: 'no-store' });
      const json = await res.json();
      if (json?.needsPermission) { setNeedsPermission(true); setThreads([]); return; }
      setNeedsPermission(false);
      setThreads(normalizeThreads(json));
    } catch {
      setThreads([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const active = threads?.find((t) => t.partner.id === selected) ?? null;

  const send = async () => {
    if (!active || !draft.trim() || sending) return;
    setSending(true);
    try {
      await fetch('/api/dub/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: active.partner.id, text: draft.trim() }),
      });
      setDraft('');
      await load();
    } finally {
      setSending(false);
    }
  };

  if (needsPermission) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-900 dark:text-amber-200">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Inbox needs extra API permissions</p>
          <p className="mt-1 text-xs opacity-80">
            The Dub API key is missing the <code>messages.read</code> / <code>messages.write</code> permissions.
            In Dub: Settings → API Keys → edit the key → grant <strong>Messages: Read &amp; Write</strong>. The inbox
            appears here automatically once granted — meanwhile use the per-partner Message buttons below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex-row items-center justify-between border-b py-4">
        <div>
          <CardTitle className="text-sm">Inbox</CardTitle>
          <CardDescription className="text-xs">Live Dub partner conversations · refreshes every 30s</CardDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={load} aria-label="Refresh inbox">
          <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </CardHeader>
      <CardContent className="grid p-0 md:grid-cols-[280px_1fr]">
        <div className="max-h-[420px] overflow-y-auto border-r">
          {threads === null ? (
            <div className="grid gap-2 p-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : threads.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">No conversations yet.</p>
          ) : (
            threads.map((t) => {
              const last = t.messages[t.messages.length - 1];
              return (
                <button
                  key={t.partner.id}
                  onClick={() => setSelected(t.partner.id)}
                  className={`block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/60 ${selected === t.partner.id ? 'bg-muted' : ''}`}
                >
                  <p className="truncate text-sm font-medium">{t.partner.name || t.partner.email || t.partner.id}</p>
                  <p className="text-muted-foreground truncate text-xs">{last?.text ?? 'No messages'}</p>
                </button>
              );
            })
          )}
        </div>
        <div className="flex max-h-[420px] flex-col">
          {!active ? (
            <p className="text-muted-foreground m-auto p-8 text-sm">Select a conversation.</p>
          ) : (
            <>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {active.messages.map((m) => (
                  <div key={m.id} className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${fromPartner(m) ? 'bg-muted' : 'bg-primary text-primary-foreground ml-auto'}`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    <p className={`mt-0.5 text-[10px] ${fromPartner(m) ? 'text-muted-foreground' : 'opacity-70'}`}>{new Date(m.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 border-t p-3">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={`Message ${active.partner.name ?? 'partner'}…`}
                  className="h-9"
                />
                <Button size="sm" onClick={send} disabled={sending || !draft.trim()}>
                  <Send className="size-3.5" /> Send
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MessageCenter() {
  const { data, loading } = useDashboard();
  const [query, setQuery] = useState('');

  const partners = useMemo(() => {
    const rows = (data?.affiliates ?? []).filter((a) => isDubPartner(a.source, a.id) && a.status !== 'deleted');
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
      : rows;
    return [...filtered].sort((a, b) => b.conversions - a.conversions || b.referrals - a.referrals);
  }, [data, query]);

  if (loading && !data) {
    return (
      <div className="grid gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[480px]" />
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[112rem] gap-6 px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Message center</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Message any Dub partner directly — each row opens their thread in Dub&apos;s message center.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageControls />
          <Button asChild variant="outline" size="sm">
            <a href="https://app.dub.co/runable/program/messages" target="_blank" rel="noreferrer">
              <MessageCircle className="size-3.5" /> Open Dub inbox <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <DubInbox />

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-sm">Dub partners ({partners.length.toLocaleString()})</CardTitle>
          <CardDescription className="text-xs">Sorted by paid conversions. Search, click, chat.</CardDescription>
          <div className="relative mt-2 max-w-sm">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search partners by name or email…"
              className="h-9 pl-8"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ExpandableRows items={partners} preview={5} perPage={10} label="partners" render={(pageRows) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">Partner</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Signups</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="px-5 py-3">
                    <p className="font-medium">{a.name}</p>
                    <p className="text-muted-foreground text-xs">{a.email}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{a.referrals.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.signups.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.conversions.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(a.revenueCents)}</TableCell>
                  <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button asChild size="sm" variant="outline">
                      <a href={dubMessageUrl(a.id)} target="_blank" rel="noreferrer">
                        <MessageCircle className="size-3.5" /> Message
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {pageRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground p-10 text-center text-sm">No Dub partners match.</TableCell></TableRow>
              ) : null}
            </TableBody>
          </Table>
          )} />
        </CardContent>
      </Card>
    </div>
  );
}
