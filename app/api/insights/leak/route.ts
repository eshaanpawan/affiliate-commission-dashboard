import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { runHogQL } from '@/lib/posthog';
import sql from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Attribution leak report (last 30 days): per affiliate token, how many
// sign-ups PostHog OBSERVED arriving through ?via=token vs how many the
// Rewardful/Dub tracking actually RECORDED as leads. The gap is commission
// attribution silently lost. Cached 30 minutes.

const OBSERVED_QUERY = `
  SELECT
    extract(toString(person.properties.$initial_current_url), 'via=([^&#]+)') AS token,
    extract(toString(person.properties.$initial_current_url), 'https?://[^/]+(/[^?#]*)') AS path,
    count() AS signups
  FROM events
  WHERE event = 'sign_up' AND timestamp > now() - INTERVAL 30 DAY
    AND toString(person.properties.$initial_current_url) LIKE '%via=%'
  GROUP BY token, path
  ORDER BY signups DESC
  LIMIT 500
`;

let cached: { at: number; data: unknown } | null = null;

export async function GET(req: Request) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (cached && Date.now() - cached.at < 30 * 60_000) {
    return NextResponse.json(cached.data, { headers: { 'X-Cache': 'hit' } });
  }

  const [observed, tracked] = await Promise.all([
    runHogQL(OBSERVED_QUERY),
    sql`
      SELECT link_token, COUNT(*) AS tracked
      FROM referrals
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND status IN ('lead', 'converted') AND link_token IS NOT NULL
      GROUP BY link_token
    `,
  ]);

  const trackedByToken = new Map<string, number>(
    tracked.map((r) => [String(r.link_token).toLowerCase(), Number(r.tracked)]),
  );

  const byToken = new Map<string, { token: string; observed: number; tracked: number; paths: Map<string, number> }>();
  for (const row of observed?.results ?? []) {
    const [token, path, signups] = row as [string, string, number];
    if (!token) continue;
    const key = String(token).toLowerCase();
    const entry = byToken.get(key) ?? { token: String(token), observed: 0, tracked: trackedByToken.get(key) ?? 0, paths: new Map() };
    entry.observed += Number(signups);
    const p = String(path || '/');
    entry.paths.set(p, (entry.paths.get(p) ?? 0) + Number(signups));
    byToken.set(key, entry);
  }

  const tokens = [...byToken.values()]
    .map((t) => ({
      token: t.token,
      observed: t.observed,
      tracked: Math.min(t.tracked, t.observed) || t.tracked,
      leakPct: t.observed > 0 ? Math.max(0, (1 - t.tracked / t.observed) * 100) : 0,
      topPath: [...t.paths.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '/',
    }))
    .sort((a, b) => (b.observed - b.tracked) - (a.observed - a.tracked));

  // Landing-path rollup — where the untracked traffic lands.
  const byPath = new Map<string, number>();
  for (const row of observed?.results ?? []) {
    const [, path, signups] = row as [string, string, number];
    const p = String(path || '/');
    byPath.set(p, (byPath.get(p) ?? 0) + Number(signups));
  }

  const totalObserved = tokens.reduce((s, t) => s + t.observed, 0);
  const totalTracked = tokens.reduce((s, t) => s + t.tracked, 0);

  const data = {
    windowDays: 30,
    totalObserved,
    totalTracked,
    leakPct: totalObserved > 0 ? (1 - totalTracked / totalObserved) * 100 : 0,
    tokens: tokens.slice(0, 100),
    paths: [...byPath.entries()].map(([path, signups]) => ({ path, signups }))
      .sort((a, b) => b.signups - a.signups).slice(0, 10),
    generatedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), data };
  return NextResponse.json(data);
}
