'use client';

import * as React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  DatabaseZap,
  Download,
  Inbox,
  MailQuestion,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export type MailAudience = {
  counts: { total: number; active: number; suspicious: number; unconfirmed: number; emailable: number };
  sync: {
    total: number;
    pending: number;
    syncing: number;
    synced: number;
    errors: number;
    emailChanged: number;
    skippedExisting: number;
    suppressed: number;
    lastSyncedAt: string | null;
    reconciled?: number;
  };
  page: { number: number; size: number; total: number };
  items: MailAudienceItem[];
};

export type MailAudienceItem = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  confirmedAt: string | null;
  joinedAt: string | null;
  sourceUpdatedAt?: string | null;
  lastConversionAt?: string | null;
  visitors: number;
  leads: number;
  conversions: number;
  unpaidCommissionCents: number;
  riskScore: number;
  reviewStatus?: string;
  segment: string;
  syncStatus: string;
  syncError: string | null;
  lastSyncedAt?: string | null;
};

type Props = {
  audience: MailAudience;
  query: string;
  page: number;
  totalPages: number;
  busy: string | null;
  campaignSafe: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onClear: () => void;
  onSyncAll: () => void;
  onSyncContact: (item: MailAudienceItem) => void;
  onOpenInbox: (item: MailAudienceItem) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const calendarDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return (includeTime ? dateTime : calendarDate).format(parsed);
}

function syncPresentation(item: MailAudienceItem) {
  switch (item.syncStatus) {
    case 'synced':
      return { label: 'In campaign', detail: 'Ready in this Instantly draft', variant: 'secondary' as const };
    case 'skipped_existing':
      return { label: 'Existing elsewhere', detail: 'Found elsewhere in the Instantly workspace', variant: 'outline' as const };
    case 'pending':
    case 'syncing':
      return { label: 'Importing', detail: 'Queued for this draft campaign', variant: 'outline' as const };
    case 'error':
    case 'email_changed':
      return { label: 'Needs review', detail: item.syncError || 'The address changed or Instantly rejected it', variant: 'destructive' as const };
    case 'suppressed':
      return { label: 'Suppressed', detail: 'Excluded by contact policy', variant: 'outline' as const };
    default:
      return { label: 'Not queued', detail: 'Available to add to this draft', variant: 'outline' as const };
  }
}

function EmptyAudience({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="relative m-4 grid min-h-52 place-items-center overflow-hidden rounded-xl border border-dashed bg-muted/10 p-8 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="relative max-w-sm">
        <span className="mx-auto grid size-11 place-items-center rounded-full border bg-background"><MailQuestion className="size-5 text-muted-foreground" /></span>
        <h3 className="mt-3 font-semibold">No matching affiliates</h3>
        <p className="mt-1 text-sm text-muted-foreground">{query ? `No name or email matches “${query}”.` : 'Rewardful returned no contacts for this view.'}</p>
        {query && <Button className="mt-4" variant="outline" size="sm" onClick={onClear}><X /> Clear search</Button>}
      </div>
    </div>
  );
}

export function AudienceWorkspace({
  audience,
  query,
  page,
  totalPages,
  busy,
  campaignSafe,
  onQueryChange,
  onSearch,
  onClear,
  onSyncAll,
  onSyncContact,
  onOpenInbox,
  onPreviousPage,
  onNextPage,
}: Props) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const reconciled = audience.sync.reconciled ?? audience.sync.synced + audience.sync.skippedExisting;
  const unresolved = audience.sync.pending + audience.sync.syncing + audience.sync.errors + audience.sync.emailChanged;
  const start = (audience.page.number - 1) * audience.page.size + (audience.items.length ? 1 : 0);
  const end = (audience.page.number - 1) * audience.page.size + audience.items.length;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex flex-row flex-wrap items-center gap-3 border-b py-3">
        <div className="mr-auto">
          <CardTitle>Audience</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{reconciled.toLocaleString()} / {audience.counts.emailable.toLocaleString()}</span> reconciled
            {' · '}{audience.sync.synced.toLocaleString()} in this campaign
            {audience.sync.skippedExisting > 0 && ` · ${audience.sync.skippedExisting.toLocaleString()} elsewhere`}
          </p>
        </div>
        {unresolved > 0 ? <Badge variant="destructive"><ShieldAlert /> {unresolved} need review</Badge> : <Badge variant="secondary"><CircleCheck /> Up to date</Badge>}
        <Button variant="outline" size="sm" asChild><a href="/api/mail/affiliates.csv"><Download /> CSV</a></Button>
        <Button size="sm" onClick={onSyncAll} disabled={!campaignSafe || busy === 'sync'}><DatabaseZap /> {busy === 'sync' ? 'Syncing…' : 'Sync all'}</Button>
      </CardHeader>

      <div className="flex flex-col gap-2 border-b bg-muted/10 p-3 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search affiliate or email"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }}
          />
        </div>
        <Button variant="outline" size="sm" onClick={onSearch}>Search</Button>
        {query && <Button variant="ghost" size="sm" onClick={onClear}><X /> Clear</Button>}
        <p className="text-xs text-muted-foreground sm:ml-auto">{audience.counts.suspicious} suspicious · {audience.counts.unconfirmed} awaiting confirmation</p>
      </div>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1160px] text-sm">
            <thead className="border-b bg-muted/20 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-3"><span className="sr-only">Details</span></th>
                <th className="px-3 py-3">Affiliate</th>
                <th className="px-3 py-3">Contact state</th>
                <th className="px-3 py-3">Last conversion</th>
                <th className="px-3 py-3 text-right">Conversions</th>
                <th className="px-3 py-3 text-right">Due</th>
                <th className="px-3 py-3 text-right">Risk</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {audience.items.map((item) => {
                const state = syncPresentation(item);
                const isExpanded = expanded === item.id;
                const canRetry = item.syncStatus !== 'synced' && item.syncStatus !== 'syncing';
                return (
                  <React.Fragment key={item.id}>
                    <tr className="border-b hover:bg-muted/20">
                      <td className="px-2 py-2">
                        <Button variant="ghost" size="icon-sm" onClick={() => setExpanded(isExpanded ? null : item.id)} aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${item.name}`} aria-expanded={isExpanded}>
                          {isExpanded ? <ChevronUp /> : <ChevronDown />}
                        </Button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">{item.name}</p>
                          <Badge variant="outline" className="hidden shrink-0 xl:inline-flex">{item.segment.replaceAll('_', ' ')}</Badge>
                          {item.reviewStatus && item.reviewStatus !== 'unreviewed' && <Badge variant="secondary" className="shrink-0">{item.reviewStatus.replaceAll('_', ' ')}</Badge>}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.email || 'No email address'}</p>
                      </td>
                      <td className="px-3 py-2"><Badge variant={state.variant} title={state.detail}>{state.label}</Badge></td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDate(item.lastConversionAt)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{item.conversions.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money.format(item.unpaidCommissionCents / 100)}</td>
                      <td className="px-3 py-2 text-right"><Badge variant={item.riskScore >= 60 ? 'destructive' : 'secondary'}>{item.riskScore}</Badge></td>
                      <td className="px-4 py-2"><div className="flex justify-end gap-2">
                        {canRetry && <Button variant="outline" size="sm" disabled={!item.email || !campaignSafe || busy === `sync-${item.id}`} onClick={() => onSyncContact(item)}><DatabaseZap /> {busy === `sync-${item.id}` ? 'Syncing…' : 'Add'}</Button>}
                        <Button variant="outline" size="sm" disabled={!item.email || busy === 'contact-inbox'} onClick={() => onOpenInbox(item)}><Inbox /> Inbox</Button>
                      </div></td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b bg-muted/10">
                        <td />
                        <td colSpan={7} className="px-3 py-4">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="border-l-2 border-foreground/20 pl-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Rewardful activity</p><p className="mt-1 font-medium">{item.visitors.toLocaleString()} visitors · {item.leads.toLocaleString()} leads</p><p className="text-xs text-muted-foreground">Joined {formatDate(item.joinedAt)}</p></div>
                            <div className="border-l-2 border-foreground/20 pl-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Partner status</p><p className="mt-1 font-medium capitalize">{item.status.replaceAll('_', ' ')}</p><p className="text-xs text-muted-foreground">{item.confirmedAt ? `Confirmed ${formatDate(item.confirmedAt)}` : 'Awaiting affiliate confirmation'}</p></div>
                            <div className="border-l-2 border-foreground/20 pl-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Instantly activity</p><p className="mt-1 font-medium">{state.label}</p><p className="text-xs text-muted-foreground">Last sync {formatDate(item.lastSyncedAt, true)}</p></div>
                            <div className="border-l-2 border-foreground/20 pl-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Latest conversion</p><p className="mt-1 flex items-center gap-1.5 font-medium"><CalendarClock className="size-4" /> {formatDate(item.lastConversionAt)}</p><p className="text-xs text-muted-foreground">Rewardful attribution</p></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {audience.items.length === 0 && <EmptyAudience query={query} onClear={onClear} />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/10 px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            Showing <span className="font-medium text-foreground tabular-nums">{start.toLocaleString()}–{end.toLocaleString()}</span> of <span className="font-medium text-foreground tabular-nums">{audience.page.total.toLocaleString()}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={onPreviousPage} aria-label="Previous audience page"><ArrowLeft /> Prev</Button>
            <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={onNextPage} aria-label="Next audience page">Next <ArrowRight /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
