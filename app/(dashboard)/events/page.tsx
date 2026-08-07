'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, CircleCheckBig, CircleAlert, RefreshCw, Search } from 'lucide-react';

import { ExpandableRows } from '@/components/ExpandableRows';
import { PageControls } from '@/components/PageControls';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface EventRow {
  event_id: string;
  event_type: string;
  received_at: string;
  processed: boolean;
  processing_error: string | null;
  dub_partner: string | null;
  rewardful_affiliate: string | null;
  dub_customer: string | null;
}

interface EventsResponse {
  events: EventRow[];
  total: number;
  page: number;
  perPage: number;
  typeBreakdown: { type: string; count: number }[];
}

// Fetch the latest 200 events once; ExpandableRows paginates client-side.
const FETCH_LIMIT = 200;

export default function EventsPage() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [source, setSource] = useState<'all' | 'dub' | 'rewardful'>('all');
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ page: '1', perPage: String(FETCH_LIMIT) });
      if (source !== 'all') params.set('type', source);
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/events?${params}`, { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } finally {
      setRefreshing(false);
    }
  }, [source, q]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="@container/main mx-auto w-full max-w-[112rem] space-y-4 px-4 py-6 md:px-6">
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Live events</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Every webhook received from Dub and Rewardful, in real time · refreshes every 30s
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageControls />
          <Button size="sm" variant="outline" onClick={load} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} /> Refresh
          </Button>
        </div>
      </div>

      {/* Type breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Event mix</CardTitle>
          <CardDescription className="text-xs">All-time counts by event type</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {!data ? <Skeleton className="h-6 w-full" /> : data.typeBreakdown.map((t) => (
            <Badge key={t.type} variant="secondary" className="rounded-full font-mono text-[11px]">
              {t.type} · {t.count.toLocaleString()}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Event stream {data ? `(${data.total.toLocaleString()})` : ''}</CardTitle>
              <CardDescription className="text-xs">Newest first</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={source} onValueChange={(v) => setSource(v as typeof source)}>
                <TabsList className="h-8">
                  <TabsTrigger value="all" className="h-7 px-2.5 text-xs">All</TabsTrigger>
                  <TabsTrigger value="dub" className="h-7 px-2.5 text-xs">Dub</TabsTrigger>
                  <TabsTrigger value="rewardful" className="h-7 px-2.5 text-xs">Rewardful</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter by type or id…"
                  className="h-8 w-56 pl-8 text-sm"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!data ? (
            <div className="grid gap-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : data.events.length === 0 ? (
            <div className="text-muted-foreground p-10 text-center text-sm">No events match.</div>
          ) : (
            <ExpandableRows items={data.events} preview={5} perPage={10} label="events" render={(rows) => (
            <div className="overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-5">Event</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-5 text-right">Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => {
                    const isDub = e.event_type.startsWith('dub.');
                    const who = e.dub_partner ?? e.dub_customer ?? e.rewardful_affiliate ?? '—';
                    return (
                      <TableRow key={e.event_id}>
                        <TableCell className="px-5">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`rounded-full font-mono text-[11px] ${isDub
                                ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300'
                                : 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300'}`}
                            >
                              {e.event_type}
                            </Badge>
                            <span className="text-muted-foreground hidden truncate font-mono text-xs xl:inline">{e.event_id}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-sm">{who}</TableCell>
                        <TableCell>
                          {e.processing_error ? (
                            <Badge variant="outline" className="rounded-full border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                              <CircleAlert className="size-3" /> error
                            </Badge>
                          ) : e.processed ? (
                            <Badge variant="outline" className="rounded-full border-lime-300 bg-lime-50 text-lime-700 dark:border-lime-900 dark:bg-lime-950 dark:text-lime-300">
                              <CircleCheckBig className="size-3" /> processed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="rounded-full">
                              <Activity className="size-3" /> received
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground pr-5 text-right text-xs whitespace-nowrap">
                          {new Date(e.received_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            )} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
