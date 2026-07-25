# Knowledge Transfer — Affiliate Dashboard / Fraud War Room

> Written 2026-07-25 after a full rebuild session. Read this top-to-bottom before touching anything.
> Companion context: `CLAUDE.md` (repo root), `AGENTS.md` (Next 16 warning), and
> `~/Desktop/RUNABLE-ANALYTICS-README.md` (raw credentials + the original fraud investigation — SENSITIVE, never commit).

## 1. What this system is

A Next.js 16 (App Router, Turbopack) dashboard for Runable's Rewardful affiliate program, deployed on Vercel
(**team `runable-growth`, project `affiliates-commission-dashboard`**, prod URL
`https://affiliates-commission-dashboard.vercel.app`, git remote `eshaanpawan/affiliate-commission-dashboard`,
prod branch `main`, auto-deploy on push). Data lives in Neon Postgres. Two external sources:

- **Rewardful** (REST, basic auth: `REWARDFUL_API_SECRET` as username, empty password, ~45 req/30s limit) —
  affiliates, referrals, sales, commissions, payouts.
- **PostHog** (project **153418**, us.posthog.com, HogQL via `POSTHOG_API_KEY`) — the *ground truth* for
  traffic: every signup's first-touch URL, and the Google Ads warehouse tables.

All env vars exist in Vercel (Production+Preview+Development) and in `.env.local`:
`NEON_DATABASE_URL`, `REWARDFUL_API_SECRET`, `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`,
`REWARDFUL_WEBHOOK_SECRET`, `CRON_SECRET`, `DASHBOARD_PASSWORD`.

## 2. The core business problem (why the war room exists)

Affiliates are buying **Google Ads on Runable's own brand terms**, intercepting users who were already
converting, and billing 100% commission on them. Verified live against PostHog:

- **96% of affiliate-attributed signups** (63,648 of 66,300 over 365d) carry Google Ads click params
  (`gclid`/`gbraid`/`gad_campaignid`) on their first-touch URL.
- **~110 high-risk affiliates**, ~$21–23k of the ~$29k program-wide unpaid commission is owed to them.
- **30 affiliates stamp their `?via=` token onto Runable's OWN campaign IDs** (ad-credit hijack: we pay
  Google AND the affiliate for the same user). 53 are in **rings** sharing `gad_campaignid`s across accounts.
- Detection method: `person.properties.$initial_current_url` contains both `via=<token>` and ad params.
  Runable's own ads never carry `via=`. Our own 65 campaign IDs come from
  `SELECT DISTINCT campaign_id FROM googleads_campaign_stats` (PostHog warehouse).

**Why the old fraud page showed nothing:** `lib/fraud-detection.ts` scores gclid/utm/referrer columns on
`referrals` — those columns are NULL on all 177k rows (Rewardful's list API can't expand visit data). Only
self-referral signals ever fired. The replacement (`lib/ad-detection.ts` + `affiliate_traffic` table) scores
from PostHog instead. The legacy page still exists at `/fraud` but is out of the nav.

## 3. Architecture (current, post-rebuild)

### Auth
- `proxy.ts` (repo root — **Next 16 renamed middleware.ts to proxy.ts**) gates EVERYTHING behind a
  password session. Public prefixes: `/login`, `/api/auth/`, `/api/webhooks/`, `/api/cron/`, `/api/admin/`,
  plus `/api/sync/posthog` when an Authorization header is present (route validates `CRON_SECRET` itself).
- `lib/auth.ts`: Web-Crypto HMAC session cookie (`runable_session`, 12h TTL, HttpOnly), timing-safe compares,
  signing secret = `CRON_SECRET`. `isAuthed(req)` is used as defence-in-depth inside every mutating API route.
- Login: `POST /api/auth/login` `{password}` (rate-limited 8/min/IP) → sets cookie. Password is in
  `DASHBOARD_PASSWORD` (all Vercel envs + `.env.local`). `POST /api/auth/logout` clears it.

### Database (Neon; Drizzle ORM, database-first)
- Schema source of truth for queries: `lib/db/schema.ts`. `lib/db/index.ts` exports **`db`** (drizzle) and a
  **default export** (raw neon tagged-template client) — legacy routes use `import sql from '@/lib/db'`.
- **Migrations are NOT drizzle-kit** — `drizzle-kit push` wants to truncate tables (constraint-name mismatch);
  never run it against this DB. Migrations = idempotent statements in `scripts/migrate.ts` (local:
  `npm run migrate`) mirrored statement-for-statement in `app/api/admin/migrate/route.ts` (prod: POST with
  `Authorization: Bearer $CRON_SECRET`). Dev and prod share the SAME Neon database.
- Tables: `affiliates` (rollups + review_* + fraud_tags + enforcement_* columns), `referrals` (traffic columns
  exist but are empty — see §2), `sales`, `commissions` (**affiliate_id backfilled 5,265/5,268 via
  `scripts/backfill-commission-affiliates.ts`**, re-runnable), `payouts`, `webhook_events`,
  **`affiliate_traffic`** (PostHog ground truth, PK (via_token, day): signups, per-ad-param counts, fts,
  pageviews, campaign_ids[], campaign_ids_ours[]), **`enforcement_log`** (append-only audit),
  **`commission_holds`** (payout freezes).

### Sync paths
1. `POST /api/sync` — Rewardful → DB, 48h lookback (affiliates always full). Called by the Overview "Sync" button.
2. `GET /api/cron/sync` (daily 06:00, `vercel.json`) — same, CRON_SECRET-gated.
3. `POST /api/sync/posthog?days=N` — PostHog → `affiliate_traffic`. Session cookie OR bearer CRON_SECRET.
   Fetches our 65 campaign IDs first and intersects **in JS** (HogQL `IN (SELECT …)` on warehouse tables 500s).
   All grouped HogQL needs explicit `LIMIT` (PostHog silently caps GROUP BY at 100 rows).
4. `GET /api/cron/posthog` (daily 06:30) — wrapper calling #3 with days=30.
5. Rewardful webhooks → `/api/webhooks/rewardful` (HMAC-verified) → `webhook_events`.

### Detection
- `lib/ad-detection.ts` — `computeAdRisk()` per affiliate over all their tokens' `affiliate_traffic` rows.
  Signals/weights: `paid_ads_traffic` (≥50% ad share, up to 45), `campaign_hijack` (our campaign id, +60),
  `shared_campaign_ring` (+35), `brand_token_name` (tokens like official/cancel/utm/signin, +20),
  `zero_organic` (+15). Bands: high ≥60, medium ≥30. `MIN_SIGNUPS_TO_FLAG = 10` guards against noise.
- `app/api/warroom/route.ts` — assembles everything: aggregates `affiliate_traffic` per token
  (correlated subqueries for the array unions — a plain GROUP BY over the arrays fails), maps token→affiliate
  via earliest referral (same rule as the tts route), joins holds/enforcement, returns summary + daily
  ad-vs-organic series + scored affiliates + campaign-overlap table.
- `/api/affiliates/tts` — PostHog funnel vs the Google brand-search baseline (SER_BRAND campaign,
  utm_source googleads + campaign 'brand'). Counts attributed by via_token (now summed over ALL an
  affiliate's tokens), medians/similarity attributed by customer email. PostHog sometimes 504s
  ("max execution time") — handled, retry usually works.

### Enforcement (the ban flow — human-gated by design)
1. War room → select rows → **Propose ban** (`POST /api/enforcement/propose`): sets
   `enforcement_state='proposed_ban'` locally, logs, and auto-creates a `commission_holds` row for their
   unpaid balance. **No Rewardful write.**
2. `/enforcement` page → review → **Apply** (`POST /api/enforcement/apply`, confirm dialog): the ONLY code
   path that writes to Rewardful — `PUT /v1/affiliates/:id` `state=suspicious` (stops tracking, earnings,
   dashboard login), sequential + throttled ≥700ms, per-affiliate result logged, previous state stored in
   `rewardful_state_before`.
3. **Revert** (`POST /api/enforcement/revert`) restores the previous Rewardful state; clearing a proposal is
   local-only. `lib/rewardful.ts` is the client.
4. `/payouts` page: holds with Release / Re-hold / Void (Void = local intent flag behind an AlertDialog; it
   does NOT delete anything in Rewardful).
5. **Nothing has been banned yet.** The 110 high-risk are surfaced but unactioned. Recommended order:
   hijackers first, in tranches — the list includes the top signup producers (tokens `304739`,
   `david-xakura`, `cuong`, `official`, `utm`, `cancel`…), so a bulk ban craters topline signups.

### UI (shadcn/ui everywhere; admincn template palette is the standard)
- `app/(dashboard)/layout.tsx`: sidebar shell. **`SidebarInset` has `min-w-0 overflow-x-hidden` — do not
  remove.** Flex children otherwise refuse to shrink and any `min-w` table pushes the page past the viewport
  (this was a real shipped bug, verified with headless Chrome: 1,696px page in a 1,440px window).
- Pages: `/` (KPIs + MonthlySummary + Last-30-Days + webhooks), `/monthly`, `/affiliates` (25/page),
  `/countries` (15/page), `/leaderboard` (15/page), `/funnel` (25/page), `/warroom`, `/payouts`,
  `/enforcement`, `/login`, `/fraud` (legacy, off-nav).
- Shared: `lib/use-dashboard.ts` (ONE data hook + localStorage cache + `paginate()`; all split pages use it —
  don't add per-page fetches of `/api/dashboard`), `components/Pager.tsx`, `SectionCard`, `AffiliateModal`,
  `MonthlySummary` (Rewardful-style dual-axis chart, cumulative toggle, CSV export, self-fetches
  `/api/monthly`), `DayOnDayChart` (**never give charts negative left margins — clips 4-digit tick labels**).
- Palette: `--chart-1..10` in `app/globals.css`, taken from the admincn template
  (`~/Downloads/shadcn-nextjs-admincn-admin-template-free-1.0.0.zip`); orange=chart-1, teal=chart-2.
  Convention: ad-driven/commissions = orange, organic/revenue/conversions = teal. Light+dark defined; always
  use tokens, never hex.

## 4. Gotchas that will bite you

- **Next 16**: `middleware.ts` → `proxy.ts`. Read `node_modules/next/dist/docs` before using unfamiliar APIs.
  Only ONE dev server per directory (a second `next dev` exits immediately).
- `@/lib/db` resolves to `lib/db/index.ts` (the old `lib/db.ts` was deleted; don't recreate it — it shadows
  the directory and breaks the drizzle import).
- Rewardful: list endpoints can't expand referral visit data (that's why referral traffic columns are empty
  — don't try to "fix" the sync to fill them); commissions need `?expand[]=sale` for affiliate attribution;
  no API param to void a commission (only delete); state changes ARE supported via PUT.
- PostHog: server-side events have no geo (`$geoip_disable`) — geo only from `$pageview`. FTS definition:
  `subscription_updated` + `isUserFirstPaidPlan=true` + `scenario='upgrade'`.
- `vercel env add NAME preview --yes` is broken in CLI 51.8.0 (`git_branch_required` loop) — use the REST API
  (`POST /v10/projects/:id/env?teamId=…`) as was done for all Preview vars.
- The period filter on `/` only affects the 8 KPI cards; everything else is all-time.
- localStorage cache keys: `affiliateDashboard:v1`, `affiliateTts:v1` — bump the suffix if response shapes change.
- To verify UI changes, drive headless Chrome (playwright via
  `/Users/niladri/Documents/mine/klipeolanding/node_modules/.bun/playwright@1.60.0/...`, channel:'chrome') —
  login first, then measure `document.documentElement.scrollWidth` vs `window.innerWidth`.

## 5. Open business decisions (need the owner, not code)

1. **Apply bans?** 110 high-risk staged-ready; nothing applied. Hijackers (30) are the least defensible start.
2. **The frozen money**: holds exist for proposed bans; the ~$21–23k at risk needs case-by-case
   Release/Void decisions on `/payouts`.
3. **Program config mismatches (live in Rewardful now)**: a 200% commission campaign on 20 affiliates
   (intentional?); `max_commission_period_months=2` on all campaigns while marketing says "up to 4 months".
4. Growth plan (ranked, in the plan file): stop the leak → fix terms (brand-bidding clause, negative
   keywords, 30-day hold) → recruit real creators → tiered commission → creator assets → brand-defence ads.

## 6. How to verify anything end-to-end

```bash
npm run dev                             # localhost:3000 → redirects to /login
# login: POST /api/auth/login {"password": $DASHBOARD_PASSWORD} → cookie
npm run lint && npx tsc --noEmit && npm run build   # must all be clean
# war-room sanity: GET /api/warroom?days=365 with the cookie →
#   summary.adPct ≈ 0.96, highRisk ≈ 110, unpaidAtRiskCents ≈ $21-23k
# refresh ground truth: POST /api/sync/posthog?days=30
```

Deploy = push to `main`. Vercel builds automatically; verify with the login + page curl loop above against
the prod URL.
