'use client';

// Stale-while-revalidate fetch for /api/monthly report windows.
// Cached per window key (bucket + from + to) in the module memory cache so
// switching between reports repaints instantly while a background refresh
// (tracked by the global "Updating data" indicator) fetches fresh numbers.

import * as React from 'react';
import { lsGet, lsSet, memGet, memSet, trackRefresh } from '@/lib/client-cache';

export interface MonthlyRow {
  month: string; // 'YYYY-MM' (month bucket) or 'YYYY-MM-DD' (day bucket)
  visitors: number;
  leads: number;
  conversions: number;
  salesCents: number;
  commissionsCents: number;
  netCents: number;
}

export interface MonthlyResponse {
  months: MonthlyRow[];
  totals: Omit<MonthlyRow, 'month'>;
}

export type ReportBucket = 'day' | 'month';

export interface ReportWindow {
  /** Inclusive ISO start, or null for open start. */
  from: string | null;
  /** Exclusive ISO end, or null for open end. */
  to: string | null;
  bucket: ReportBucket;
}

const inflight = new Map<string, Promise<MonthlyResponse>>();

function windowKey(w: ReportWindow): string {
  return `monthly-report:${w.bucket}:${w.from ?? 'open'}:${w.to ?? 'open'}`;
}

function buildUrl(w: ReportWindow): string {
  const params = new URLSearchParams();
  if (w.from) params.set('from', w.from);
  if (w.to) params.set('to', w.to);
  if (!w.from && !w.to) params.set('period', 'all');
  params.set('bucket', w.bucket);
  return `/api/monthly?${params.toString()}`;
}

function fetchWindow(w: ReportWindow): Promise<MonthlyResponse> {
  const key = windowKey(w);
  const running = inflight.get(key);
  if (running) return running;
  const request = trackRefresh(
    fetch(buildUrl(w), { cache: 'no-store' })
      .then(async (res) => {
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error ?? `Request failed (${res.status})`);
        memSet(key, payload);
        lsSet(key, payload);
        return payload as MonthlyResponse;
      })
      .finally(() => inflight.delete(key)),
  );
  inflight.set(key, request);
  return request;
}

export function useMonthlyReport(w: ReportWindow | null, refreshVersion = 0) {
  const key = w ? windowKey(w) : null;
  const [data, setData] = React.useState<MonthlyResponse | null>(() =>
    key ? memGet<MonthlyResponse>(key) ?? lsGet<MonthlyResponse>(key) : null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const keyRef = React.useRef(key);
  keyRef.current = key;

  React.useEffect(() => {
    if (!w || !key) return;
    const stale = memGet<MonthlyResponse>(key) ?? lsGet<MonthlyResponse>(key);
    setData(stale);
    setError(null);
    let cancelled = false;
    fetchWindow(w)
      .then((json) => {
        if (!cancelled && keyRef.current === key) setData(json);
      })
      .catch((err: unknown) => {
        if (!cancelled && keyRef.current === key) {
          setError(err instanceof Error ? err.message : 'Failed to load');
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshVersion]);

  return { data, error, loading: data === null && error === null };
}
