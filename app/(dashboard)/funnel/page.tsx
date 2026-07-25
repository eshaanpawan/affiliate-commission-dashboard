'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { useDashboard, paginate, TTS_FROM, TTS_TO, type TtsResponse } from '@/lib/use-dashboard';
import { Pager } from '@/components/Pager';
import { fmtDuration, ttsTone, similarityTone } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const PER_PAGE = 25;

export default function FunnelPage() {
  const { ttsData: sharedTts, loading, refresh } = useDashboard();

  // Local state seeded from the shared hook so the page renders instantly,
  // but Recompute with a custom date range only updates this page.
  const [ttsData, setTtsData] = useState<TtsResponse | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsFrom, setTtsFrom] = useState(TTS_FROM);
  const [ttsTo, setTtsTo] = useState(TTS_TO);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (sharedTts && !ttsData) setTtsData(sharedTts);
  }, [sharedTts, ttsData]);

  async function loadTts(from = ttsFrom, to = ttsTo) {
    setTtsLoading(true);
    try {
      const res = await fetch(`/api/affiliates/tts?from=${from}&to=${to}`);
      const json = await res.json();
      setTtsData(json);
      setPage(1);
    } finally {
      setTtsLoading(false);
    }
  }

  const paged = paginate(ttsData?.affiliates ?? [], page, PER_PAGE);

  return (
    <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Funnel vs Google Baseline</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Pageview → Signup → FTS counts + median Signup→FTS time. Affiliates whose timings match the Google baseline are likely intercepting brand-search intent (brand bidding).
          </p>
        </div>
        <Button size="sm" onClick={() => refresh()} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div className="p-5">
        {/* Date range controls */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Label htmlFor="tts-from" className="text-muted-foreground text-xs">From</Label>
          <Input id="tts-from" type="date" value={ttsFrom} onChange={(e) => setTtsFrom(e.target.value)} className="h-8 w-auto text-xs" />
          <Label htmlFor="tts-to" className="text-muted-foreground text-xs">To</Label>
          <Input id="tts-to" type="date" value={ttsTo} onChange={(e) => setTtsTo(e.target.value)} className="h-8 w-auto text-xs" />
          <Button size="sm" onClick={() => loadTts(ttsFrom, ttsTo)} disabled={ttsLoading}>
            {ttsLoading ? 'Loading…' : 'Recompute'}
          </Button>
          <span className="text-muted-foreground ml-auto text-xs">
            Signup→FTS time: <span className="font-bold text-red-600 dark:text-red-400">red</span> &lt;1h · <span className="font-semibold text-amber-600 dark:text-amber-400">amber</span> &lt;1d · <span className="text-foreground">gray</span> &lt;1w · <span className="text-emerald-600 dark:text-emerald-400">green</span> 1w+
          </span>
        </div>

        {(ttsLoading || loading) && !ttsData && <Skeleton className="h-64 w-full" />}
        {ttsData?.note && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            {ttsData.note}
          </div>
        )}
        {ttsData && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Pageviews</TableHead>
                  <TableHead className="text-right">Signups</TableHead>
                  <TableHead className="text-right">FTS</TableHead>
                  <TableHead className="text-right">PV→Signup</TableHead>
                  <TableHead className="text-right">Signup→FTS</TableHead>
                  <TableHead className="text-right">Signup→FTS time</TableHead>
                  <TableHead>vs Google</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Baseline rows */}
                {ttsData.baselines.map((r) => (
                  <TableRow key={r.source} className="bg-indigo-50/50 font-medium hover:bg-indigo-50/70 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15">
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.pageviews?.toLocaleString() ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.signups.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.fts.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{r.pvToSignupRate !== null ? `${(r.pvToSignupRate * 100).toFixed(2)}%` : '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{r.signupToFtsRate !== null ? `${(r.signupToFtsRate * 100).toFixed(2)}%` : '—'}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', ttsTone(r.signupToFtsSecMedian))}>{fmtDuration(r.signupToFtsSecMedian)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">—</TableCell>
                  </TableRow>
                ))}
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="text-muted-foreground pt-4 pb-1 text-xs font-semibold uppercase">
                    Per affiliate (sorted by similarity to Google baseline — highest = most likely intercepting brand search)
                  </TableCell>
                </TableRow>
                {paged.rows.map((a) => (
                  <TableRow key={a.affiliateId}>
                    <TableCell>
                      <p className="text-sm font-medium">{a.label}</p>
                      <p className="text-muted-foreground text-xs">{a.email}</p>
                      {a.linkToken && (
                        <Badge asChild variant="secondary" className="mt-1 bg-indigo-50 font-mono text-[10px] text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
                          <a href={`https://runable.com/?via=${a.linkToken}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            ?via={a.linkToken}
                          </a>
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right">—</TableCell>
                    <TableCell className="text-right tabular-nums">{a.signups}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{a.fts}</TableCell>
                    <TableCell className="text-muted-foreground text-right">—</TableCell>
                    <TableCell className="text-muted-foreground text-right">—</TableCell>
                    <TableCell className={cn('text-right tabular-nums', ttsTone(a.signupToFtsSecMedian))}>{fmtDuration(a.signupToFtsSecMedian)}</TableCell>
                    <TableCell className="text-xs">
                      {a.googleSimilarity !== null && a.googleSimilarity !== undefined ? (
                        <div className="flex items-center gap-2">
                          <div className="bg-muted h-2 w-20 overflow-hidden rounded-full">
                            <div className={cn('h-full', similarityTone(a.googleSimilarity))} style={{ width: `${Math.round(a.googleSimilarity * 100)}%` }} />
                          </div>
                          <span className="text-muted-foreground tabular-nums">{Math.round(a.googleSimilarity * 100)}%</span>
                        </div>
                      ) : <span className="text-muted-foreground">n/a</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              page={paged.page}
              totalPages={paged.totalPages}
              total={paged.total}
              perPage={PER_PAGE}
              onPage={setPage}
              label="affiliates"
            />
          </div>
        )}
        {ttsData && ttsData.affiliates.length === 0 && ttsData.baselines.length === 0 && !ttsLoading && (
          <div className="text-muted-foreground py-8 text-center text-sm">No PostHog FTS data for this window.</div>
        )}
      </div>
    </div>
  );
}
