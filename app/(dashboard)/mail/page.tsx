'use client';

import * as React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  CircleAlert,
  FilePenLine,
  Inbox,
  LayoutDashboard,
  MailPlus,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings2,
  X,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { AudienceWorkspace, type MailAudience, type MailAudienceItem } from '@/components/mail/audience-workspace';
import {
  AudienceGroups,
  DraftAudiencePicker,
  type AudienceGroup,
  type AudienceGroupsPayload,
} from '@/components/mail/audience-groups';
import { CampaignSettings, type CampaignSettingsAccount, type CampaignSettingsCampaign } from '@/components/mail/campaign-settings';
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
  campaign: CampaignSettingsCampaign & {
    dailyLimit: number | null;
    steps: number;
    variants: number;
  };
  accounts: {
    approvedSenders: string[];
    approvedConnected: number;
    items: Array<CampaignSettingsAccount & {
      warmupStatus: number | null;
      lastUsedAt: string | null;
    }>;
  };
  unibox: { unread: number; latestThreads: ThreadSummary[] };
};

type Audience = MailAudience;

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

function CompactEmptyState({
  icon: Icon,
  title,
  detail,
  action,
  onAction,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="relative m-3 flex flex-col gap-3 overflow-hidden rounded-xl border border-dashed bg-muted/10 p-4 sm:flex-row sm:items-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] [background-size:16px_16px]" />
      <span className="relative grid size-9 shrink-0 place-items-center rounded-lg border bg-background shadow-xs"><Icon className="size-4 text-muted-foreground" /></span>
      <div className="relative min-w-0 flex-1"><p className="text-sm font-semibold">{title}</p><p className="mt-0.5 text-xs text-muted-foreground">{detail}</p></div>
      {action && onAction && <Button className="relative" variant="outline" size="sm" onClick={onAction}>{action}<ArrowRight /></Button>}
    </div>
  );
}

export default function MailCenterPage() {
  const { refreshVersion } = useDashboardRange();
  const [activeTab, setActiveTab] = React.useState('dashboard');
  const [overview, setOverview] = React.useState<Overview | null>(null);
  const [audience, setAudience] = React.useState<Audience | null>(null);
  const [groups, setGroups] = React.useState<AudienceGroupsPayload | null>(null);
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
  const [groupBusy, setGroupBusy] = React.useState(false);
  const [replyText, setReplyText] = React.useState('');
  const routeStateApplied = React.useRef(false);
  const observedRefreshVersion = React.useRef(refreshVersion);

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

  const loadGroups = React.useCallback(async () => {
    try {
      setGroups(await readJson<AudienceGroupsPayload>('/api/mail/groups'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load affiliate groups.');
    }
  }, []);

  const load = React.useCallback(async (options: {
    audiencePage?: number;
    audienceSearch?: string;
    threadSearch?: string;
  } = {}) => {
    setLoading(true);
    try {
      const requestedPage = options.audiencePage ?? 1;
      const requestedAudienceSearch = options.audienceSearch ?? '';
      const requestedThreadSearch = options.threadSearch ?? '';
      const [nextOverview, nextThreads, nextAudience] = await Promise.all([
        readJson<Overview>('/api/mail/overview'),
        readJson<{ items: ThreadSummary[]; nextStartingAfter: string | null }>(`/api/mail/threads?limit=30${requestedThreadSearch ? `&search=${encodeURIComponent(requestedThreadSearch)}` : ''}`),
        readJson<Audience>(`/api/mail/audience?page=${requestedPage}&pageSize=25&q=${encodeURIComponent(requestedAudienceSearch)}`),
      ]);
      setOverview(nextOverview);
      setThreads(nextThreads.items);
      setThreadCursor(nextThreads.nextStartingAfter);
      setAudience(nextAudience);
      const configured = nextOverview.campaign.sendingAccounts;
      const recommended = [...nextOverview.accounts.items]
        .filter((account) => account.status === 1 && !account.setupPending)
        .sort((a, b) => (b.dailyLimit ?? 0) - (a.dailyLimit ?? 0))
        .map((account) => account.email);
      setSelectedSenders(configured.length > 0 ? configured : recommended);
      setReplySender((current) => current || configured[0] || recommended[0] || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the Mail center');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    void loadGroups();
  }, [load, loadGroups]);

  React.useEffect(() => {
    if (observedRefreshVersion.current === refreshVersion) return;
    observedRefreshVersion.current = refreshVersion;
    void load({ audiencePage, audienceSearch, threadSearch: search });
    void loadGroups();
  }, [audiencePage, audienceSearch, load, loadGroups, refreshVersion, search]);

  React.useEffect(() => {
    if (loading || routeStateApplied.current) return;
    routeStateApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    if (requestedTab && ['dashboard', 'inbox', 'drafts', 'campaign', 'audience'].includes(requestedTab)) {
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

  async function findThreads(query = search) {
    setBusy('search');
    try {
      const result = await readJson<{ items: ThreadSummary[]; nextStartingAfter: string | null }>(`/api/mail/threads?limit=30&search=${encodeURIComponent(query)}`);
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

  async function openAffiliateInbox(item: MailAudienceItem) {
    if (!item.email) {
      toast.error('This affiliate has no email address.');
      return;
    }
    setActiveTab('inbox');
    setSearch(item.email);
    setBusy('contact-inbox');
    updateRoute({ tab: 'inbox', thread: null, contact: item.email, q: null, page: null });
    try {
      const result = await readJson<{ items: ThreadSummary[]; nextStartingAfter: string | null }>(`/api/mail/threads?limit=30&search=${encodeURIComponent(item.email)}`);
      setThreads(result.items);
      setThreadCursor(result.nextStartingAfter);
      setSelectedThread(null);
      setThread(null);
      setThreadError(null);
      if (result.items[0]) await openThread(result.items[0].threadId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open this affiliate inbox.');
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

  async function syncAudience() {
    setBusy('sync');
    try {
      const result = await readJson<{ imported: { synced?: number } | null }>('/api/mail/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, importNow: true, includeExisting: true }),
      });
      toast.success(`Audience reconciled${result.imported?.synced ? ` · ${result.imported.synced} added to this draft` : ''}.`);
      await Promise.all([loadAudience(1, audienceSearch), load()]);
      setAudiencePage(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Audience sync failed');
    } finally {
      setBusy(null);
    }
  }

  async function syncAudienceContact(item: MailAudienceItem) {
    setBusy(`sync-${item.id}`);
    try {
      await readJson('/api/mail/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          importNow: true,
          includeExisting: true,
          affiliateId: item.id,
        }),
      });
      toast.success(`${item.name} reconciled with this Draft campaign.`);
      await loadAudience(audiencePage, audienceSearch);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sync this affiliate.');
    } finally {
      setBusy(null);
    }
  }

  async function selectAudienceGroup(group: AudienceGroup) {
    setGroupBusy(true);
    try {
      const result = await readJson<{
        safety?: string;
        draftTarget?: AudienceGroupsPayload['draftTarget'];
      }>('/api/mail/groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, groupId: group.id }),
      });
      setGroups((current) => current ? {
        ...current,
        selectedGroupId: group.id,
        draftTarget: result.draftTarget ?? current.draftTarget,
        groups: current.groups.map((item) => ({ ...item, selected: item.id === group.id })),
      } : current);
      toast.success(`${group.label} selected for this draft.`, {
        description: result.safety || 'No campaign was activated and no email was sent.',
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the draft audience.');
    } finally {
      setGroupBusy(false);
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
  const reconciledContacts = audience.sync.reconciled ?? audience.sync.synced + audience.sync.skippedExisting;
  const reconciliationPercent = (reconciledContacts / Math.max(1, audience.counts.emailable)) * 100;
  const latestMessage = thread?.messages.at(-1);
  const selectedGroupId = groups?.selectedGroupId
    ?? groups?.draftTarget?.groupId
    ?? groups?.groups.find((group) => group.selected)?.id
    ?? 'all_emailable';
  const replyRecipient = latestMessage?.emailType === 'received'
    ? latestMessage.from
    : latestMessage?.to;

  return (
    <div className="grid min-h-[calc(100dvh-4rem)] gap-3 px-3 py-3 md:px-5">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          updateRoute({ tab: value === 'dashboard' ? null : value, thread: value === 'inbox' ? selectedThread : null, contact: value === 'inbox' ? search || null : null });
        }}
        className="grid min-h-[calc(100dvh-5.5rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3"
      >
        <TabsList className="sticky top-[6.5rem] z-40 grid h-11 w-full grid-cols-5 overflow-x-auto rounded-xl border bg-background/90 p-1 shadow-xs backdrop-blur sm:top-16">
          <TabsTrigger value="dashboard" className="h-8 min-w-24"><LayoutDashboard /> <span className="hidden sm:inline">Dashboard</span></TabsTrigger>
          <TabsTrigger value="inbox" className="h-8 min-w-24"><Inbox /> <span className="hidden sm:inline">Inbox</span>{overview.unibox.unread > 0 && <Badge variant="destructive">{overview.unibox.unread}</Badge>}</TabsTrigger>
          <TabsTrigger value="drafts" className="h-8 min-w-24"><FilePenLine /> <span className="hidden sm:inline">Drafts</span><Badge variant="secondary">{overview.campaign.steps}</Badge></TabsTrigger>
          <TabsTrigger value="campaign" className="h-8 min-w-24"><Settings2 /> <span className="hidden sm:inline">Campaign</span></TabsTrigger>
          <TabsTrigger value="audience" className="h-8 min-w-24"><Users /> <span className="hidden sm:inline">Audience</span><Badge variant="secondary">{audience.counts.total}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="grid gap-4">
          <section className="grid overflow-hidden rounded-xl border bg-background sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Affiliate contacts" value={audience.counts.total.toLocaleString()} detail={`${audience.counts.emailable.toLocaleString()} can receive email`} />
            <Stat label="Unread replies" value={overview.unibox.unread.toLocaleString()} detail={overview.unibox.unread ? 'Needs review' : 'Inbox clear'} tone={overview.unibox.unread ? 'warn' : 'good'} />
            <Stat label="Send capacity" value={`${selectedCapacity}/day`} detail={`${selectedSenders.length} senders · 30/day each`} tone="good" />
            <Stat label="Audience reconciled" value={`${reconciledContacts.toLocaleString()} / ${audience.counts.emailable.toLocaleString()}`} detail={`${audience.sync.synced.toLocaleString()} in campaign · ${audience.sync.skippedExisting.toLocaleString()} elsewhere`} tone={audience.sync.errors + audience.sync.emailChanged ? 'warn' : 'good'} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
            <Card className="gap-0 overflow-hidden py-0"><CardHeader className="border-b py-4"><div><CardTitle>Operations</CardTitle><CardDescription>Current mail infrastructure and work queues</CardDescription></div></CardHeader><CardContent className="grid p-0 md:grid-cols-2">
              <button type="button" onClick={() => setActiveTab('inbox')} className="group flex items-start gap-4 border-b p-5 text-left transition-colors hover:bg-muted/30 md:border-r"><span className="grid size-10 place-items-center rounded-lg bg-blue-500/10 text-blue-600"><Inbox className="size-5" /></span><span><span className="block text-sm font-semibold">Inbox</span><span className="mt-1 block text-2xl font-semibold tabular-nums">{overview.unibox.unread}</span><span className="text-xs text-muted-foreground">unread conversations</span></span><ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-1" /></button>
              <button type="button" onClick={() => setActiveTab('drafts')} className="group flex items-start gap-4 border-b p-5 text-left transition-colors hover:bg-muted/30"><span className="grid size-10 place-items-center rounded-lg bg-amber-500/10 text-amber-700"><FilePenLine className="size-5" /></span><span><span className="block text-sm font-semibold">Sequence draft</span><span className="mt-1 block text-2xl font-semibold tabular-nums">{overview.campaign.steps}</span><span className="text-xs text-muted-foreground">steps · {overview.campaign.variants} variants</span></span><ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-1" /></button>
              <button type="button" onClick={() => setActiveTab('campaign')} className="group flex items-start gap-4 border-b p-5 text-left transition-colors hover:bg-muted/30 md:border-b-0 md:border-r"><span className="grid size-10 place-items-center rounded-lg bg-emerald-500/10 text-emerald-700"><Activity className="size-5" /></span><span><span className="block text-sm font-semibold">Sending accounts</span><span className="mt-1 block text-2xl font-semibold tabular-nums">{selectedSenders.length}</span><span className="text-xs text-muted-foreground">{selectedCapacity} emails/day</span></span><ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-1" /></button>
              <button type="button" onClick={() => setActiveTab('audience')} className="group flex items-start gap-4 p-5 text-left transition-colors hover:bg-muted/30"><span className="grid size-10 place-items-center rounded-lg bg-violet-500/10 text-violet-700"><Users className="size-5" /></span><span><span className="block text-sm font-semibold">Audience</span><span className="mt-1 block text-2xl font-semibold tabular-nums">{audience.counts.suspicious}</span><span className="text-xs text-muted-foreground">risk-flagged contacts</span></span><ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-1" /></button>
            </CardContent></Card>

            <Card className="gap-0 py-0"><CardHeader className="border-b py-4"><CardTitle>System status</CardTitle></CardHeader><CardContent className="grid gap-4 py-5">
              <div><div className="mb-2 flex items-center justify-between text-sm"><span>Contact reconciliation</span><strong>{Math.round(reconciliationPercent)}%</strong></div><Progress value={reconciliationPercent} /></div>
              <div className="grid gap-2 text-sm"><div className="flex items-center justify-between border-b py-2"><span className="text-muted-foreground">Campaign</span><Badge variant={state.safe ? 'secondary' : 'destructive'}>{state.label}</Badge></div><div className="flex items-center justify-between border-b py-2"><span className="text-muted-foreground">Stop on reply</span><strong>{overview.campaign.stopOnReply ? 'On' : 'Off'}</strong></div><div className="flex items-center justify-between border-b py-2"><span className="text-muted-foreground">Daily lead limit</span><strong>{overview.campaign.dailyMaxLeads ?? 0}</strong></div><div className="flex items-center justify-between py-2"><span className="text-muted-foreground">Sender health</span><strong>{overview.accounts.items.filter((account) => account.status === 1 && !account.setupPending).length}/{overview.accounts.items.length} ready</strong></div></div>
            </CardContent></Card>
          </section>

          <Card className="gap-0 overflow-hidden py-0"><CardHeader className="border-b py-4"><div><CardTitle>Recent conversations</CardTitle><CardDescription>Latest activity from Instantly</CardDescription></div><Button variant="outline" size="sm" onClick={() => setActiveTab('inbox')}>Open inbox <ArrowRight /></Button></CardHeader><CardContent className="p-0">{threads.slice(0, 5).map((item) => <button key={item.threadId} type="button" onClick={() => { setActiveTab('inbox'); void openThread(item.threadId); }} className="grid w-full gap-1 border-b px-4 py-3 text-left last:border-0 hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_180px_100px] sm:items-center"><span><span className="block truncate text-sm font-medium">{item.subject}</span><span className="block truncate text-xs text-muted-foreground">{item.preview || 'No preview'}</span></span><span className="truncate text-xs text-muted-foreground">{item.emailType === 'received' ? item.from : item.to}</span><span className="text-xs text-muted-foreground sm:text-right">{formatDate(item.sentAt)}</span></button>)}{threads.length === 0 && <CompactEmptyState icon={Inbox} title="No conversations yet" detail="Replies will appear here after outreach begins." action="Review the draft" onAction={() => setActiveTab('drafts')} />}</CardContent></Card>
        </TabsContent>

        <TabsContent value="inbox" className="min-h-0">
          <div className="grid h-full min-h-[calc(100dvh-8.75rem)] overflow-hidden rounded-xl border bg-background shadow-xs lg:grid-cols-[380px_minmax(0,1fr)]">
            <aside className={`${selectedThread ? 'hidden lg:block' : 'block'} border-b bg-muted/15 lg:border-b-0 lg:border-r`}>
              <div className="border-b p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Inbox</h2><p className="text-xs text-muted-foreground">{overview.unibox.unread} unread</p></div><Button variant="ghost" size="icon-sm" onClick={() => void load()} aria-label="Refresh inbox"><RefreshCw /></Button></div><div className="flex gap-2">
                <Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void findThreads(); }} placeholder="Search replies, subject, affiliate…" />
                <Button size="icon-sm" variant="outline" onClick={() => void findThreads()} disabled={busy === 'search'} aria-label="Search mail"><Search /></Button>
                {search && <Button size="icon-sm" variant="ghost" onClick={() => { setSearch(''); updateRoute({ contact: null }); setBusy('search'); void readJson<{ items: ThreadSummary[]; nextStartingAfter: string | null }>('/api/mail/threads?limit=30').then((result) => { setThreads(result.items); setThreadCursor(result.nextStartingAfter); }).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not clear search')).finally(() => setBusy(null)); }} aria-label="Clear mail search"><X /></Button>}
              </div></div>
              <ScrollArea className="h-[calc(100dvh-13.5rem)] min-h-[560px]">
                {threads.map((item) => (
                  <button key={item.threadId} type="button" onClick={() => void openThread(item.threadId)} aria-current={selectedThread === item.threadId ? 'true' : undefined} className={`block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedThread === item.threadId ? 'bg-muted' : ''}`}>
                    <div className="flex items-center gap-2"><span className={`min-w-0 flex-1 truncate text-sm ${item.unread ? 'font-semibold' : 'font-medium'}`}>{item.subject}</span>{item.unread && <span className="size-2 rounded-full bg-blue-500" />}</div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.emailType === 'received' ? item.from : item.to}</p>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.preview || 'No preview'}</p>
                    <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{formatDate(item.sentAt)}</p>
                  </button>
                ))}
                {threads.length === 0 && <CompactEmptyState icon={Search} title={search ? 'No matching conversation' : 'Inbox is ready'} detail={search ? `Nothing matched “${search}”.` : 'Affiliate replies will land here.'} action={search ? 'Clear search' : 'Review the draft'} onAction={() => { if (search) { setSearch(''); updateRoute({ contact: null }); void findThreads(''); } else { setActiveTab('drafts'); } }} />}
                {threadCursor && <div className="p-3"><Button className="w-full" variant="outline" size="sm" onClick={() => void loadMoreThreads()} disabled={busy === 'more-threads'}>{busy === 'more-threads' ? <RefreshCw className="animate-spin" /> : <ArrowRight />} {busy === 'more-threads' ? 'Loading…' : 'Load more conversations'}</Button></div>}
              </ScrollArea>
            </aside>

            <section className={`${selectedThread ? 'block' : 'hidden lg:block'} min-w-0`}>
              {!selectedThread ? (
                <div className="p-4"><CompactEmptyState icon={MailPlus} title={threads.length ? 'Choose a conversation' : 'Nothing to read yet'} detail={threads.length ? 'Select a thread to read and reply.' : 'Review the draft while you wait for replies.'} action={threads.length ? undefined : 'Open sequence draft'} onAction={threads.length ? undefined : () => setActiveTab('drafts')} /></div>
              ) : threadError ? (
                <div className="flex min-h-[560px] items-center justify-center p-8 text-center"><div><CircleAlert className="mx-auto size-8 text-destructive" /><h2 className="mt-4 font-semibold">Conversation unavailable</h2><p className="mt-1 text-sm text-muted-foreground">{threadError}</p><div className="mt-4 flex justify-center gap-2"><Button variant="outline" onClick={() => { setSelectedThread(null); setThreadError(null); updateRoute({ thread: null }); }}><ArrowLeft /> Back to inbox</Button><Button onClick={() => void openThread(selectedThread)}><RefreshCw /> Try again</Button></div></div></div>
              ) : !thread ? <div className="grid gap-3 p-6"><Skeleton className="h-16" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : (
                <div className="flex h-full min-h-[620px] flex-col">
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
                    <Textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder="Write a reply…" className="min-h-28 resize-y" />
                    <div className="mt-3 flex justify-end"><Button onClick={() => setConfirmReplyOpen(true)} disabled={!replyText.trim() || !replySender || busy === 'reply'}><Reply /> {busy === 'reply' ? 'Sending…' : 'Review reply'}</Button></div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="drafts">
          <div className="grid gap-3">
            {groups ? (
              <DraftAudiencePicker
                payload={groups}
                selectedGroupId={selectedGroupId}
                onSelectedGroupChange={(group) => void selectAudienceGroup(group)}
                disabled={groupBusy || !state.safe}
              />
            ) : <Skeleton className="h-16 w-full" />}
            <SequenceDraftEditor onSaved={load} />
          </div>
        </TabsContent>

        <TabsContent value="campaign">
          <div className="grid gap-4">
            {groups ? (
              <AudienceGroups
                payload={groups}
                selectedGroupId={selectedGroupId}
                onSelectedGroupChange={(group) => void selectAudienceGroup(group)}
                disabled={groupBusy || !state.safe}
              />
            ) : <Skeleton className="h-[420px] w-full" />}
            <CampaignSettings campaign={overview.campaign} accounts={overview.accounts.items} onSaved={load} />
          </div>
        </TabsContent>

        <TabsContent value="audience">
          <AudienceWorkspace
            audience={audience}
            query={audienceSearch}
            page={audiencePage}
            totalPages={totalPages}
            busy={busy}
            campaignSafe={state.safe}
            onQueryChange={setAudienceSearch}
            onSearch={() => {
              setAudiencePage(1);
              updateRoute({ tab: 'audience', q: audienceSearch, page: null });
              void loadAudience(1, audienceSearch);
            }}
            onClear={() => {
              setAudienceSearch('');
              setAudiencePage(1);
              updateRoute({ tab: 'audience', q: null, page: null });
              void loadAudience(1, '');
            }}
            onSyncAll={() => void syncAudience()}
            onSyncContact={(item) => void syncAudienceContact(item)}
            onOpenInbox={(item) => void openAffiliateInbox(item)}
            onPreviousPage={() => {
              const next = audiencePage - 1;
              setAudiencePage(next);
              updateRoute({ tab: 'audience', q: audienceSearch, page: next });
              void loadAudience(next, audienceSearch);
            }}
            onNextPage={() => {
              const next = audiencePage + 1;
              setAudiencePage(next);
              updateRoute({ tab: 'audience', q: audienceSearch, page: next });
              void loadAudience(next, audienceSearch);
            }}
          />
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
