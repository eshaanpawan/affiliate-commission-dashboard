import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { InstantlyApiError, InstantlyConfigurationError } from '@/lib/instantly';

export async function requireMailAuth(req: Request): Promise<NextResponse | null> {
  if (await isAuthed(req)) return null;
  return mailJson({ error: 'Unauthorized' }, 401);
}

export function mailJson(data: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

export function mailRouteError(error: unknown): NextResponse {
  if (error instanceof InstantlyConfigurationError) {
    return mailJson({ error: 'Instantly integration is not configured' }, 503);
  }
  if (error instanceof InstantlyApiError) {
    const status = error.status === 429
      ? 429
      : error.status === 404
        ? 404
        : error.status === 402
          ? 424
          : 502;
    return mailJson(
      {
        error: status === 429 ? 'Instantly rate limit reached' : 'Instantly request failed',
        upstreamStatus: error.status,
        ...(error.code ? { code: error.code } : {}),
      },
      status,
      error.retryAfterSeconds === undefined
        ? undefined
        : { 'Retry-After': String(error.retryAfterSeconds) },
    );
  }
  console.error('[mail-api] request failed', error instanceof Error ? error.name : 'UnknownError');
  return mailJson({ error: 'Mail request failed' }, 500);
}

/**
 * Instantly thread ids are UUIDs for received threads but short base62-ish
 * tokens (e.g. "2f-QZ5s03W9DDdSgwXunrI5eDd") for sent campaign emails.
 */
export function isThreadId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function clampInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function safeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  return normalized;
}
