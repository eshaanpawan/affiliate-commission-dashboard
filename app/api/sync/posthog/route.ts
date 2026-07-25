/**
 * POST /api/sync/posthog?days=N
 *
 * Populates the affiliate_traffic table from PostHog: per via_token per day —
 * signups (with ad-param breakdowns), FTS, pageviews, and gad_campaignid lists
 * (matched against our own Google Ads campaign ids).
 *
 * Auth: dashboard session cookie OR `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextResponse } from 'next/server';
import { sql as dsql } from 'drizzle-orm';
import { isAuthed } from '@/lib/auth';
import { runHogQL } from '@/lib/posthog';
import { db, affiliateTraffic } from '@/lib/db/index';

export const maxDuration = 120;

interface Row {
  viaToken: string;
  day: string;
  signups: number;
  signupsWithGclid: number;
  signupsWithGbraid: number;
  signupsWithGadCampaignid: number;
  signupsWithAnyAdParam: number;
  fts: number;
  pageviews: number;
  campaignIds: string[];
  campaignIdsOurs: string[];
  syncedAt: Date;
}

// The $initial_current_url person property, referenced constantly below.
const u = 'person.properties.$initial_current_url';

/** `excluded."col"` — take the incoming row's value on conflict. */
function sqlExcluded(col: string) {
  return dsql.raw(`excluded."${col}"`);
}

export async function POST(req: Request) {
  const t0 = Date.now();

  const bearer = req.headers.get('authorization');
  const cronOk = !!process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronOk && !(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 1), 400);

  // 1. Our Google Ads campaign ids (warehouse table). HogQL cannot do
  // IN (SELECT ...) from a warehouse table inside the events query (500s),
  // so we fetch them here and intersect in JS.
  const oursRes = await runHogQL(
    `SELECT DISTINCT campaign_id FROM googleads_campaign_stats LIMIT 10000`
  );
  if (!oursRes || oursRes.error) {
    return NextResponse.json(
      { error: 'PostHog query failed (googleads_campaign_stats)', detail: oursRes?.error ?? 'no response' },
      { status: 502 }
    );
  }
  const oursIds = new Set(
    oursRes.results.map((r) => String((r as unknown[])[0])).filter((s) => s && s !== 'null')
  );

  // 2. Per-token/per-day signups with ad-param breakdowns.
  const signupsQuery = `
    SELECT
      extract(${u},'[?&]via=([^&#]+)') AS token,
      toDate(timestamp) AS day,
      count(DISTINCT person_id) AS signups,
      countIf(${u} ILIKE '%gclid=%') AS with_gclid,
      countIf(${u} ILIKE '%gbraid=%' OR ${u} ILIKE '%wbraid=%') AS with_gbraid,
      countIf(${u} ILIKE '%gad_campaignid=%') AS with_campaignid,
      countIf(${u} ILIKE '%gclid=%' OR ${u} ILIKE '%gbraid=%' OR ${u} ILIKE '%wbraid=%' OR ${u} ILIKE '%gad_campaignid=%' OR ${u} ILIKE '%gad_source=%') AS with_any,
      groupUniqArray(10)(extract(${u},'gad_campaignid=([0-9]+)')) AS campaign_ids
    FROM events
    WHERE event='sign_up' AND ${u} ILIKE '%via=%'
      AND timestamp > now() - INTERVAL ${days} DAY
    GROUP BY token, day
    LIMIT 50000
  `;

  // 3. Same shape for FTS and pageviews.
  const ftsQuery = `
    SELECT
      extract(${u},'[?&]via=([^&#]+)') AS token,
      toDate(timestamp) AS day,
      count(DISTINCT person_id) AS fts
    FROM events
    WHERE event='subscription_updated'
      AND properties.isUserFirstPaidPlan = true
      AND properties.scenario = 'upgrade'
      AND ${u} ILIKE '%via=%'
      AND timestamp > now() - INTERVAL ${days} DAY
    GROUP BY token, day
    LIMIT 50000
  `;

  const pageviewsQuery = `
    SELECT
      extract(${u},'[?&]via=([^&#]+)') AS token,
      toDate(timestamp) AS day,
      count(DISTINCT person_id) AS pageviews
    FROM events
    WHERE event='$pageview' AND ${u} ILIKE '%via=%'
      AND timestamp > now() - INTERVAL ${days} DAY
    GROUP BY token, day
    LIMIT 50000
  `;

  const [signupsRes, ftsRes, pvRes] = await Promise.all([
    runHogQL(signupsQuery),
    runHogQL(ftsQuery),
    runHogQL(pageviewsQuery),
  ]);

  for (const [name, res] of [['signups', signupsRes], ['fts', ftsRes], ['pageviews', pvRes]] as const) {
    if (!res || res.error) {
      return NextResponse.json(
        { error: `PostHog query failed (${name})`, detail: res?.error ?? 'no response' },
        { status: 502 }
      );
    }
  }

  // 4. Merge in JS keyed by token|day.
  const syncedAt = new Date();
  const merged = new Map<string, Row>();
  const get = (token: string, day: string): Row => {
    const key = `${token}|${day}`;
    let row = merged.get(key);
    if (!row) {
      row = {
        viaToken: token, day,
        signups: 0, signupsWithGclid: 0, signupsWithGbraid: 0,
        signupsWithGadCampaignid: 0, signupsWithAnyAdParam: 0,
        fts: 0, pageviews: 0, campaignIds: [], campaignIdsOurs: [],
        syncedAt,
      };
      merged.set(key, row);
    }
    return row;
  };

  for (const r of signupsRes!.results) {
    const [token, day, signups, gclid, gbraid, campaignid, any, ids] = r as
      [string | null, string, number, number, number, number, number, string[]];
    if (!token || !day) continue;
    const row = get(token, day);
    row.signups = Number(signups);
    row.signupsWithGclid = Number(gclid);
    row.signupsWithGbraid = Number(gbraid);
    row.signupsWithGadCampaignid = Number(campaignid);
    row.signupsWithAnyAdParam = Number(any);
    row.campaignIds = (ids ?? []).filter((id) => id && id.length > 0);
    row.campaignIdsOurs = row.campaignIds.filter((id) => oursIds.has(id));
  }
  for (const r of ftsRes!.results) {
    const [token, day, fts] = r as [string | null, string, number];
    if (!token || !day) continue;
    get(token, day).fts = Number(fts);
  }
  for (const r of pvRes!.results) {
    const [token, day, pv] = r as [string | null, string, number];
    if (!token || !day) continue;
    get(token, day).pageviews = Number(pv);
  }

  // 5. Upsert in chunks of 500.
  const rows = Array.from(merged.values());
  let rowsUpserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await db
      .insert(affiliateTraffic)
      .values(batch)
      .onConflictDoUpdate({
        target: [affiliateTraffic.viaToken, affiliateTraffic.day],
        set: {
          signups: sqlExcluded('signups'),
          signupsWithGclid: sqlExcluded('signups_with_gclid'),
          signupsWithGbraid: sqlExcluded('signups_with_gbraid'),
          signupsWithGadCampaignid: sqlExcluded('signups_with_gad_campaignid'),
          signupsWithAnyAdParam: sqlExcluded('signups_with_any_ad_param'),
          fts: sqlExcluded('fts'),
          pageviews: sqlExcluded('pageviews'),
          campaignIds: sqlExcluded('campaign_ids'),
          campaignIdsOurs: sqlExcluded('campaign_ids_ours'),
          syncedAt: sqlExcluded('synced_at'),
        },
      });
    rowsUpserted += batch.length;
  }

  const tokens = new Set(rows.map((r) => r.viaToken)).size;

  return NextResponse.json({
    ok: true,
    days,
    tokens,
    rowsUpserted,
    oursCampaignCount: oursIds.size,
    tookMs: Date.now() - t0,
  });
}
