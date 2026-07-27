'use client';

import * as React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Clock3,
  DatabaseZap,
  Download,
  Inbox,
  MailCheck,
  MailPlus,
  Network,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldCheck,
  X,
  Users,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { SequenceDraftEditor } from '@/components/mail/sequence-draft-editor';

type ThreadSummary = {
  id: string;
  threadId: string;
  subject: string;
  from: string | null;
  to: string | null;
  senderAccount: string | null;
  preview: string | null;
  unread: boolean;
  emailType: string | null;
  sentAt: string | null;
};

type Overview = {
  fetchedAt: string;
  campaign: {
    id: string;
    name: string | null;
    status: number | null;
    dailyLimit: number | null;
    dailyMaxLeads: number | null;
    sendingAccounts: string[];
    steps: number;
    variants: number;
  };
  accounts: {
    approvedSenders: string[];
    approvedConnected: number;
    items: Array<{
      email: string;
      name: string | null;
      status: number | null;
      statusMessage: string | null;
      setupPending: boolean | null;
      warmupStatus: number | null;
      warmupScore: number | null;
      dailyLimit: number | null;
      lastUsedAt: string | null;
    }>;
  };
  unibox: { unread: number; latestThreads: ThreadSummary[] };
};

type Audience = {
  counts: { total: number; active: number; suspicious: number; unconfirmed: number; emailable: number };
  sync: { total: number; pending: number; syncing: number; synced: number; errors: number; emailChanged: number; skippedExisting: number; suppressed: number; lastSyncedAt: string | null };
  page: { number: number; size: number; total: number };
  items: Array<{
    id: string;
    name: string;
    email: string | null;
    status: string;
    confirmedAt: string | null;
    joinedAt: string | null;
    visitors: number;
    conversions: number;
    unpaidCommissionCents: number;
    riskScore: number;
    segment: string;
    syncStatus: string;
    syncError: string | null;
  }>;
};

type ThreadDetail = {
  threadId: string;
  approvedSenders: string[];
  messages: Array<{
    id: string;
    subject: string;
    from: string | null;
    to: string | null;
    senderAccount: string | null;
    body: string | { text?: string | null; html?: string | null } | null;
    preview: string | null;
    emailType: string | null;
    sentAt: string | null;
  }>;
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function formatDate(value: string | null) {
  if (!value) return 'No timestamp';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unknown time' : date.format(parsed);
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload as T;
}

function campaignState(status: number | null) {
  if (status === 0) return { label: 'Draft', safe: true };
  if (status === 2) return { label: 'Paused', safe: true };
  if (status === 1) return { label: 'Active', safe: false };
  if (status === 3) return { label: 'Completed', safe: false };
  return { label: 'Unknown', safe: false };
}

function bodyText(body: ThreadDetail['messages'][number]['body'], preview: string | null) {
  if (typeof body === 'string') return body;
  if (body?.text) return body.text;
  if (body?.html) return body.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return preview || 'No readable message body returned.';
}

function Stat({ label, value, detail, tone = 'plain' }: { label: string; value: string; detail: string; tone?: 'plain' | 'good' | 'warn' }) {
  return (
    <div className={`border-l-2 px-4 py-3 ${tone === 'good' ? 'border-emerald-500 bg-emerald-500/5' : tone === 'warn' ? 'border-amber-500 bg-amber-500/5' : 'border-foreground/20 bg-muted/25'}`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function MailCenterPage() {
  const [activeTab, setActiveTab] = React.useState('inbox');
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [audience, setAudience] = React.useState<Audience | null>(null);
  const [threads, setThreads] = React.useState<ThreadSummary[]>([]);
  const [threadCursor, setThreadCursor] = React.useState<string | null>(null);
  const [selectedThread, setSelectedThread] = React.useState<string | null>(null);
  const [thread, setThread] = React.useState<ThreadDetail | null>(null);
  const [threadError, setThreadError] = React.useState<string | null>(null);
  const [selectedSenders, setSelectedSenders] = React.useState<string[]>([]);
  const [replySender, setReplySender] = React.useState('');
  const [confirmReplyOpen, setConfirmReplyOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [audienceSearch, setAudienceSearch] = React.useState('');
  const [audiencePage, setAudiencePage] = React.useState(1);
  const [replyText, setReplyText] = React.useState('');
  const routeStateApplied = React.useRef(false);

  const updateRoute = React.useCallback((updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '' || value === 1) params.delete(key);
      else params.set(key, String(value));
    }
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);

  const loadAudience = React.useCallback(async (page = audiencePage, query = audienceSearch) => {
    const data = await readJson<Audience>(`/api/mail/audience?page=${page}&pageSize=25&q=${encodeURIComponent(query)}`);
    setAudience(data);
  }, [audiencePage, audienceSearch]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, nextThreads, nextAudience] = await Promise.all([
        readJson<Overview>('/api/mail/overview'),
        readJson<{ items: ThreadSummary[]; nextStartingAfter: string | null }>('/api/mail/threads?limit=30'),
        readJson<Audience>('/api/mail/audience?page=1&pageSize=25'),
      ]);
      setOverview(nextOverview);
      setThreads(nextThreads.items);
      setThreadCursor(nextThreads.nextStartingAfter);
      setAudience(nextAudience);
      const configured = nextOverview.campaign.sendingAccounts;
      const recommended = [...nextOverview.accounts.items]
        .filter((account) => account.status === 1 && !account.setupPending)
        .sort((a, b) => (b.dailyLimit ?? 0) - (a.dailyLimit ?? 0))
        .slice(0, 5)
        .map((account) => account.email);
      setSelectedSenders(configured.length > 0 ? configured : recommended);
      setReplySender((current) => current || configured[0] || recommended[0] || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the Mail center');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (loading || routeStateApplied.current) return;
    routeStateApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    if (requestedTab && ['inbox', 'campaign', 'workflow', 'audience'].includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
    const requestedQuery = params.get('q')?.trim() ?? '';
    const requestedPage = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
    const requestedThread = params.get('thread')?.trim() ?? '';
    if (requestedQuery) {
      setAudienceSearch(requestedQuery);
    }
    if (requestedQuery || requestedPage > 1) {
      setAudiencePage(requestedPage);
      void readJson<Audience>(`/api/mail/audience?page=${requestedPage}&pageSize=25&q=${encodeURIComponent(requestedQuery)}`)
        .then(setAudience)
        .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not filter the audience'));
    }
    if (/^[0-9a-f-]{36}$/i.test(requestedThread)) {
      setActiveTab('inbox');
      void openThread(requestedThread, false);
    }
    // Route state is intentionally applied once after the initial data load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function openThread(threadId: string, updateUrl = true) {
    setSelectedThread(threadId);
    setThread(null);
    setThreadError(null);
    if (updateUrl) updateRoute({ tab: 'inbox', thread: threadId });
    try {
      const detail = await readJson<ThreadDetail>(`/api/mail/threads/${threadId}`);
      setThread(detail);
      const wasUnread = threads.some((item) => item.threadId === threadId && item.unread);
      if (wasUnread) {
        const response = await fetch(`/api/mail/threads/${threadId}/mark-read`, { method: 'POST' });
        if (response.ok) {
          setThreads((items) => items.map((item) => item.threadId === threadId ? { ...item, unread: false } : item));
          setOverview((current) => current ? {
            ...current,
            unibox: { ...current.unibox, unread: Math.max(0, current.unibox.unread - 1) },
          } : current);
        }
      }
      const account = detail.messages.at(-1)?.senderAccount;
      if (account && detail.approvedSenders.includes(account)) setReplySender(account);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open thread';
      setThreadError(message);
      toast.error(message);
    }
  }

  async function findThreads() {
    setBusy('search');
    try {
      const result = await readJson<{ items: ThreadSummary[]; nextStartingAfter: string | null }>(`/api/mail/threads?limit=30&search=${encodeURIComponent(search)}`);
      setThreads(result.items);
      setThreadCursor(result.nextStartingAfter);
      setSelectedThread(null);
      setThread(null);
      setThreadError(null);
      updateRoute({ thread: null });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreThreads() {
    if (!threadCursor) return;
    setBusy('more-threads');
    try {
      const result = await readJson<{ items: ThreadSummary[]; nextStartingAfter: string | null }>(`/api/mail/threads?limit=30&cursor=${encodeURIComponent(threadCursor)}&search=${encodeURIComponent(search)}`);
      setThreads((items) => {
        const byThread = new Map(items.map((item) => [item.threadId, item]));
        result.items.forEach((item) => byThread.set(item.threadId, item));
        return [...byThread.values()];
      });
      setThreadCursor(result.nextStartingAfter);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load more conversations');
    } finally {
      setBusy(null);
    }
  }

  async function configureCampaign() {
    if (selectedSenders.length !== 5) {
      toast.error('Select exactly five sender accounts for the 150/day plan.');
      return;
    }
    setBusy('campaign');
    try {
      await readJson('/api/mail/campaign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, emailList: selectedSenders, dailyPerAccount: 30, dailyMaxLeads: 150, stopOnReply: true }),
      });
      toast.success('Draft campaign configured. No email was sent.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Campaign configuration failed');
    } finally {
      setBusy(null);
    }
  }

  async function syncAudience() {
    setBusy('sync');
    try {
      const result = await readJson<{ imported: { synced?: number } | null }>('/api/mail/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, importNow: true }),
      });
      toast.success(`Rewardful audience reconciled${result.imported?.synced ? ` · ${result.imported.synced} imported` : ''}.`);
      await Promise.all([loadAudience(1, audienceSearch), load()]);
      setAudiencePage(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Audience sync failed');
    } finally {
      setBusy(null);
    }
  }

  async function sendReply() {
    const currentThreadId = thread?.threadId;
    const latest = thread?.messages.at(-1);
    const sender = replySender;
    if (!currentThreadId || !latest || !sender || !replyText.trim()) return;
    setConfirmReplyOpen(false);
    setBusy('reply');
    try {
      await readJson('/api/mail/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, eaccount: sender, replyToUuid: latest.id, subject: latest.subject.startsWith('Re:') ? latest.subject : `Re: ${latest.subject}`, text: replyText.trim() }),
      });
      setReplyText('');
      toast.success('Reply sent.');
      await openThread(currentThreadId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Reply failed');
    } finally {
      setBusy(null);
    }
  }

  if (loading || !overview || !audience) {
    return <div className="grid gap-4 px-4 py-6 md:px-6"><Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-[560px]" /></div>;
  }

  const state = campaignState(overview.campaign.status);
  const totalPages = Math.max(1, Math.ceil(audience.page.total / audience.page.size));
  const selectedCapacity = selectedSenders.length * 30;
  const latestMessage = thread?.messages.at(-1);
  const replyRecipient = latestMessage?.emailType === 'received'
    ? latestMessage.from
    : latestMessage?.to;

  return (
    <div className="grid gap-5 px-4 py-6 md:px-6">
      <section className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"><MailCheck className="size-3.5" /> Runable partner communications</div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Affiliate Mail Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">One place to reconcile Rewardful contacts, inspect Instantly replies, design outreach paths, and control who can send. Campaign launch remains a separate human approval.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={state.safe ? 'secondary' : 'destructive'}><ShieldCheck /> {overview.campaign.name || 'Affiliate campaign'} · {state.label}</Badge>
          <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw /> Refresh</Button>
        </div>
      </section>

      <section className="grid border-y sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Rewardful audience" value={audience.counts.total.toLocaleString()} detail={`${audience.counts.emailable.toLocaleString()} valid email addresses`} />
        <Stat label="Inbox requiring review" value={overview.unibox.unread.toLocaleString()} detail="Unread Instantly conversations" tone={overview.unibox.unread ? 'warn' : 'good'} />
        <Stat label="Draft send capacity" value={`${selectedCapacity}/day`} detail={`${selectedSenders.length} selected · 30 per sender`} tone={selectedSenders.length === 5 ? 'good' : 'warn'} />
        <Stat label="Contact reconciliation" value={`${audience.sync.synced.toLocaleString()} / ${audience.sync.total.toLocaleString()}`} detail={`${audience.sync.pending} queued · ${audience.sync.skippedExisting} existing/protected · ${audience.sync.errors + audience.sync.emailChanged} need review`} tone={audience.sync.errors + audience.sync.emailChanged ? 'warn' : 'plain'} />
      </section>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          updateRoute({ tab: value === 'inbox' ? null : value, thread: value === 'inbox' ? selectedThread : null });
        }}
        className="min-w-0 gap-4"
      >
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="inbox" className="h-10 px-4"><Inbox /> Inbox <Badge variant="secondary">{overview.unibox.unread}</Badge></TabsTrigger>
          <TabsTrigger value="campaign" className="h-10 px-4"><Send /> Campaign</TabsTrigger>
          <TabsTrigger value="workflow" className="h-10 px-4"><Workflow /> Workflow</TabsTrigger>
          <TabsTrigger value="audience" className="h-10 px-4"><Users /> Audience <Badge variant="secondary">{audience.counts.total}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <div className="grid min-h-[620px] overflow-hidden rounded-xl border bg-background shadow-xs lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className={`${selectedThread ? 'hidden lg:block' : 'block'} border-b bg-muted/15 lg:border-b-0 lg:border-r`}>
              <div className="flex gap-2 border-b p-3">
                <Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void findThreads(); }} placeholder="Search replies, subject, affiliate…" />
                <Button size="icon-sm" variant="outline" onClick={() => void findThreads()} disabled={busy === 'search'} aria-label="Search mail"><Search /></Button>
                {search && <Button size="icon-sm" variant="ghost" onClick={() => { setSearch(''); setBusy('search'); void readJson<{ items: ThreadSummary[]; nextStartingAfter: string | null }>('/api/mail/threads?limit=30').then((result) => { setThreads(result.items); setThreadCursor(result.nextStartingAfter); }).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not clear search')).finally(() => setBusy(null)); }} aria-label="Clear mail search"><X /></Button>}
              </div>
              <ScrollArea className="h-[620px] lg:h-[560px]">
                {threads.map((item) => (
                  <button key={item.threadId} type="button" onClick={() => void openThread(item.threadId)} aria-current={selectedThread === item.threadId ? 'true' : undefined} className={`block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedThread === item.threadId ? 'bg-muted' : ''}`}>
                    <div className="flex items-center gap-2"><span className={`min-w-0 flex-1 truncate text-sm ${item.unread ? 'font-semibold' : 'font-medium'}`}>{item.subject}</span>{item.unread && <span className="size-2 rounded-full bg-blue-500" />}</div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.emailType === 'received' ? item.from : item.to}</p>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.preview || 'No preview'}</p>
                    <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{formatDate(item.sentAt)}</p>
                  </button>
                ))}
                {threads.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground"><Inbox className="mx-auto mb-3 size-6" />No campaign threads found.</div>}
                {threadCursor && <div className="p-3"><Button className="w-full" variant="outline" size="sm" onClick={() => void loadMoreThreads()} disabled={busy === 'more-threads'}>{busy === 'more-threads' ? <RefreshCw className="animate-spin" /> : <ArrowRight />} {busy === 'more-threads' ? 'Loading…' : 'Load more conversations'}</Button></div>}
              </ScrollArea>
            </aside>

            <section className={`${selectedThread ? 'block' : 'hidden lg:block'} min-w-0`}>
              {!selectedThread ? (
                <div className="flex h-full min-h-[560px] items-center justify-center p-8 text-center"><div><MailPlus className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-4 font-semibold">Open an affiliate conversation</h2><p className="mt-1 text-sm text-muted-foreground">Replies and sent messages appear together as one thread.</p></div></div>
              ) : threadError ? (
                <div className="flex min-h-[560px] items-center justify-center p-8 text-center"><div><CircleAlert className="mx-auto size-8 text-destructive" /><h2 className="mt-4 font-semibold">Conversation unavailable</h2><p className="mt-1 text-sm text-muted-foreground">{threadError}</p><div className="mt-4 flex justify-center gap-2"><Button variant="outline" onClick={() => { setSelectedThread(null); setThreadError(null); updateRoute({ thread: null }); }}><ArrowLeft /> Back to inbox</Button><Button onClick={() => void openThread(selectedThread)}><RefreshCw /> Try again</Button></div></div></div>
              ) : !thread ? <div className="grid gap-3 p-6"><Skeleton className="h-16" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : (
                <div className="flex min-h-[620px] flex-col">
                  <div className="flex items-center gap-3 border-b px-4 py-3 md:px-5 md:py-4"><Button className="lg:hidden" size="icon-sm" variant="ghost" onClick={() => { setSelectedThread(null); setThread(null); updateRoute({ thread: null }); }} aria-label="Back to inbox"><ArrowLeft /></Button><div className="min-w-0"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Conversation · {thread.messages.length} message{thread.messages.length === 1 ? '' : 's'}</p><h2 className="mt-1 truncate font-semibold">{thread.messages.at(-1)?.subject}</h2></div></div>
                  <ScrollArea className="h-[390px] flex-1 p-5">
                    <div className="grid gap-4 pr-4">{thread.messages.map((message) => <article key={message.id} className={`max-w-[88%] border p-4 ${message.emailType === 'received' ? 'mr-auto border-l-2 border-l-blue-500' : 'ml-auto border-r-2 border-r-emerald-500 bg-muted/20'}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">{message.emailType === 'received' ? message.from : message.senderAccount || message.from}</p><span className="text-[10px] uppercase tracking-wide text-muted-foreground">{formatDate(message.sentAt)}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/85">{bodyText(message.body, message.preview)}</p></article>)}</div>
                  </ScrollArea>
                  <div className="border-t bg-muted/10 p-4">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <p className="text-xs font-medium text-muted-foreground">Reply from</p>
                      <Select value={replySender} onValueChange={setReplySender}>
                        <SelectTrigger className="w-full sm:w-[260px]" aria-label="Reply sender"><SelectValue placeholder="Choose an approved sender" /></SelectTrigger>
                        <SelectContent>{selectedSenders.map((sender) => <SelectItem key={sender} value={sender}>{sender}</SelectItem>)}</SelectContent>
                      </Select>
                      <p className="truncate text-xs text-muted-foreground sm:ml-auto">To {replyRecipient || 'affiliate'}</p>
                    </div>
                    <Textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Write a manual reply. Nothing leaves Instantly until you confirm the final review." className="min-h-28 resize-y" />
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Manual reply · approved sender only · final confirmation required</p><Button onClick={() => setConfirmReplyOpen(true)} disabled={!replyText.trim() || !replySender || busy === 'reply'}><Reply /> {busy === 'reply' ? 'Sending…' : 'Review reply'}</Button></div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="campaign">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-4"><CardTitle>Approved sender pool</CardTitle><CardDescription>Select exactly five healthy accounts for 30 emails/day each. These are the only addresses the backend accepts.</CardDescription></CardHeader>
              <CardContent className="grid gap-px bg-border p-0 sm:grid-cols-2">{overview.accounts.items.map((account) => {
                const selected = selectedSenders.includes(account.email);
                const healthy = account.status === 1 && !account.setupPending;
                return <label key={account.email} className="flex cursor-pointer items-start gap-3 bg-background p-4 hover:bg-muted/30"><Checkbox checked={selected} onCheckedChange={(checked) => setSelectedSenders((items) => checked ? [...new Set([...items, account.email])] : items.filter((email) => email !== account.email))} disabled={(!healthy && !selected) || (!selected && selectedSenders.length >= 5)} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{account.email}</p><Badge variant={healthy ? 'secondary' : 'destructive'}>{healthy ? 'ready' : 'attention'}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Current limit {account.dailyLimit ?? 0}/day · warmup {account.warmupScore ?? '—'}%</p><Progress className="mt-3" value={Math.min(100, account.warmupScore ?? 0)} /></div></label>;
              })}</CardContent>
            </Card>
            <div className="grid content-start gap-4">
              <Card><CardHeader><CardTitle>Safe campaign configuration</CardTitle><CardDescription>The setup writes accounts and limits, but does not activate or send.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid grid-cols-2 gap-3 text-sm"><div className="border p-3"><p className="text-muted-foreground">Selected</p><p className="mt-1 text-xl font-semibold">{selectedSenders.length} / 5</p></div><div className="border p-3"><p className="text-muted-foreground">Capacity</p><p className="mt-1 text-xl font-semibold">{selectedCapacity}/day</p></div></div><div className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed"><CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" /><span>Email copy is not approved yet. The campaign must stay <strong>Draft</strong>; contact import cannot trigger delivery.</span></div><Button onClick={() => void configureCampaign()} disabled={selectedSenders.length !== 5 || !state.safe || busy === 'campaign'}><DatabaseZap /> {busy === 'campaign' ? 'Configuring…' : 'Apply 5 × 30 draft setup'}</Button></CardContent></Card>
              <Card><CardHeader><CardTitle>Sequence readiness</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Steps</span><strong>{overview.campaign.steps}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Variants</span><strong>{overview.campaign.variants}</strong></div><div className="flex justify-between"><span className="text-muted-foreground">Daily max leads</span><strong>{overview.campaign.dailyMaxLeads ?? 0}</strong></div><Badge variant="destructive" className="mt-2">Copy approval required before launch</Badge></CardContent></Card>
            </div>
          </div>
          <div className="mt-4">
            <SequenceDraftEditor onSaved={load} />
          </div>
        </TabsContent>

        <TabsContent value="workflow">
          <Card className="overflow-hidden py-0"><CardHeader className="border-b py-5"><CardTitle>Fraud-aware outreach workflow</CardTitle><CardDescription>A clear operating model for onboarding, growth, and policy review. Nodes below are a draft plan; they do not send until copy and launch are separately approved.</CardDescription></CardHeader><CardContent className="p-5"><div className="grid gap-3 lg:grid-cols-[1fr_48px_1fr_48px_1fr] lg:items-stretch"><WorkflowNode icon={Users} eyebrow="Trigger" title="Rewardful roster sync" detail="New or changed affiliates enter the durable queue. Email changes are quarantined." status="live" /><Connector /><WorkflowNode icon={Network} eyebrow="Decision" title="Segment by evidence" detail="Verification pending, onboarding, active partner, medium risk, or high-risk review." status="rules" /><Connector /><WorkflowNode icon={MailPlus} eyebrow="Draft action" title="Choose approved sequence" detail="Select tone and evidence level. No copy exists until you write and approve it." status="blocked" /></div><div className="my-4 border-l-2 border-dashed border-border pl-6 lg:ml-[calc(50%-1px)]"><Clock3 className="size-4 text-muted-foreground" /></div><div className="grid gap-3 lg:grid-cols-3"><WorkflowNode icon={MailCheck} eyebrow="Path A" title="Onboarding & activation" detail="Welcome → assets → placement date → performance check-in." status="draft" /><WorkflowNode icon={Send} eyebrow="Path B" title="Partner growth" detail="Co-marketing experiment → conversion asset → measured follow-up." status="draft" /><WorkflowNode icon={ShieldCheck} eyebrow="Path C" title="Risk clarification" detail="Evidence notice → response window → human review → payout/enforcement decision." status="draft" /></div><div className="mt-5 grid gap-px border bg-border md:grid-cols-3"><div className="bg-background p-4"><p className="text-xs font-semibold">Variant A</p><p className="mt-1 text-xs text-muted-foreground">Direct, concise operational note.</p></div><div className="bg-background p-4"><p className="text-xs font-semibold">Variant B</p><p className="mt-1 text-xs text-muted-foreground">Context-first partner education.</p></div><div className="bg-background p-4"><p className="text-xs font-semibold">Global stop rule</p><p className="mt-1 text-xs text-muted-foreground">Stop on reply; never auto-ban or release payouts.</p></div></div></CardContent></Card>
        </TabsContent>

        <TabsContent value="audience">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4"><div><CardTitle>Rewardful source roster</CardTitle><CardDescription>Canonical affiliate contacts with Instantly reconciliation and risk-aware segments.</CardDescription></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" asChild><a href="/api/mail/affiliates.csv"><Download /> Download CSV</a></Button><Button size="sm" onClick={() => void syncAudience()} disabled={!state.safe || busy === 'sync'}><DatabaseZap /> {busy === 'sync' ? 'Reconciling…' : 'Sync to draft campaign'}</Button></div></CardHeader>
            <div className="flex flex-col gap-3 border-b bg-muted/15 p-3 sm:flex-row sm:items-center"><div className="relative max-w-md flex-1"><Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search name or email" value={audienceSearch} onChange={(event) => setAudienceSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setAudiencePage(1); updateRoute({ tab: 'audience', q: audienceSearch, page: null }); void loadAudience(1, audienceSearch); } }} /></div><Button variant="outline" size="sm" onClick={() => { setAudiencePage(1); updateRoute({ tab: 'audience', q: audienceSearch, page: null }); void loadAudience(1, audienceSearch); }}>Search</Button>{audienceSearch && <Button variant="ghost" size="sm" onClick={() => { setAudienceSearch(''); setAudiencePage(1); updateRoute({ tab: 'audience', q: null, page: null }); void loadAudience(1, ''); }}><X /> Clear</Button>}<p className="text-xs text-muted-foreground sm:ml-auto">{audience.counts.suspicious} suspicious · {audience.counts.unconfirmed} awaiting confirmation</p></div>
            <CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="border-b bg-muted/20 text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Affiliate</th><th className="px-3 py-3">Lifecycle</th><th className="px-3 py-3">Mail sync</th><th className="px-3 py-3 text-right">Visitors</th><th className="px-3 py-3 text-right">Paid</th><th className="px-3 py-3 text-right">Due</th><th className="px-4 py-3 text-right">Risk</th></tr></thead><tbody>{audience.items.map((item) => <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20"><td className="px-4 py-3"><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.email || 'No email'}</p></td><td className="px-3 py-3"><Badge variant="outline">{item.segment.replaceAll('_', ' ')}</Badge></td><td className="px-3 py-3"><Badge variant={item.syncStatus === 'synced' ? 'secondary' : item.syncStatus === 'error' || item.syncStatus === 'email_changed' ? 'destructive' : 'outline'}>{item.syncStatus.replaceAll('_', ' ')}</Badge>{item.syncError && <p className="mt-1 max-w-xs truncate text-[10px] text-destructive">{item.syncError}</p>}</td><td className="px-3 py-3 text-right tabular-nums">{item.visitors.toLocaleString()}</td><td className="px-3 py-3 text-right font-medium tabular-nums">{item.conversions.toLocaleString()}</td><td className="px-3 py-3 text-right tabular-nums">{money.format(item.unpaidCommissionCents / 100)}</td><td className="px-4 py-3 text-right"><Badge variant={item.riskScore >= 60 ? 'destructive' : 'secondary'}>{item.riskScore}</Badge></td></tr>)}</tbody></table></div>{audience.items.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No affiliates match this search.</div>}<div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Showing {(audience.page.number - 1) * audience.page.size + (audience.items.length ? 1 : 0)}–{(audience.page.number - 1) * audience.page.size + audience.items.length} of {audience.page.total.toLocaleString()}</p><div className="flex items-center gap-2"><Button variant="outline" size="icon-sm" disabled={audiencePage <= 1} onClick={() => { const next = audiencePage - 1; setAudiencePage(next); updateRoute({ tab: 'audience', q: audienceSearch, page: next }); void loadAudience(next, audienceSearch); }} aria-label="Previous audience page"><ArrowLeft /></Button><span className="text-xs tabular-nums">Page {audiencePage} / {totalPages}</span><Button variant="outline" size="icon-sm" disabled={audiencePage >= totalPages} onClick={() => { const next = audiencePage + 1; setAudiencePage(next); updateRoute({ tab: 'audience', q: audienceSearch, page: next }); void loadAudience(next, audienceSearch); }} aria-label="Next audience page"><ArrowRight /></Button></div></div></CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmReplyOpen} onOpenChange={setConfirmReplyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia><Send className="text-destructive" /></AlertDialogMedia>
            <AlertDialogTitle>Send this real email?</AlertDialogTitle>
            <AlertDialogDescription>This is the final manual-send checkpoint. Instantly will deliver the reply immediately; campaign automation will remain {state.label}.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">From</span><strong className="min-w-0 break-all">{replySender || 'No sender selected'}</strong></div>
            <div className="flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">To</span><strong className="min-w-0 break-all">{replyRecipient || 'Unknown recipient'}</strong></div>
            <div className="flex gap-3"><span className="w-12 shrink-0 text-muted-foreground">Body</span><span className="line-clamp-3 whitespace-pre-wrap">{replyText}</span></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'reply'}>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy === 'reply' || !replyRecipient || !replyText.trim()} onClick={(event) => { event.preventDefault(); void sendReply(); }}>{busy === 'reply' ? 'Sending…' : 'Send real email'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WorkflowNode({ icon: Icon, eyebrow, title, detail, status }: { icon: typeof Users; eyebrow: string; title: string; detail: string; status: string }) {
  return <div className="relative border bg-background p-4"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center border bg-muted/30"><Icon className="size-4" /></span><div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p><h3 className="mt-1 text-sm font-semibold">{title}</h3></div></div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{detail}</p><Badge variant={status === 'blocked' ? 'destructive' : 'outline'} className="mt-4">{status}</Badge></div>;
}

function Connector() {
  return <div className="hidden items-center justify-center lg:flex"><div className="h-px w-full bg-border" /><ArrowRight className="-ml-1 size-4 shrink-0 text-muted-foreground" /></div>;
}
