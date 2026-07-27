// Next.js 16 renamed `middleware.ts` to `proxy.ts` (same functionality).
//
// Gates the whole dashboard behind the shared password. Machine-called routes
// are excluded because they already authenticate themselves and must stay
// reachable without a browser session:
//   /api/webhooks/* — Rewardful HMAC signature
//   /api/cron/*     — CRON_SECRET bearer token
//   /api/admin/*    — CRON_SECRET bearer token

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

const PUBLIC_PREFIXES = ['/login', '/api/auth/', '/api/webhooks/', '/api/cron/', '/api/admin/'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Machine-to-machine: cron jobs call the source sync handlers with a bearer
  // token. Pass those requests through; each handler validates CRON_SECRET.
  if ((pathname === '/api/sync' || pathname === '/api/sync/posthog') && request.headers.get('authorization')) {
    return NextResponse.next();
  }

  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // APIs get a 401 rather than an HTML redirect, so fetch() callers see a clear error.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
