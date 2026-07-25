// Session auth for the dashboard.
//
// Uses Web Crypto only (no node:crypto) so the same helpers run in the Edge
// runtime that `proxy.ts` executes in and in the Node runtime the API routes use.
//
// The cookie holds `<expiry>.<hmac>` — never the password itself.

export const SESSION_COOKIE = 'runable_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function secret(): string {
  // CRON_SECRET already exists in every environment; fall back to the password
  // so a misconfigured deploy fails closed rather than signing with a constant.
  const s = process.env.CRON_SECRET || process.env.DASHBOARD_PASSWORD;
  if (!s) throw new Error('No signing secret: set CRON_SECRET or DASHBOARD_PASSWORD');
  return s;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Constant-time string compare — `===` leaks length/prefix timing to an attacker. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${await hmac(exp)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(exp));
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  return safeEqual(candidate, expected);
}

/** Guard for API route handlers — defence in depth behind the proxy. */
export async function isAuthed(req: Request): Promise<boolean> {
  const cookie = req.headers.get('cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySessionToken(match?.[1]);
}
