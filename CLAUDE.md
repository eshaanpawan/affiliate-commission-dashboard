@AGENTS.md

# Affiliate Commission Dashboard

Next.js dashboard syncing affiliate, referral, sales, and commission data from Rewardful into a Neon (Postgres) database.

## Stack

- **Next.js** (see AGENTS.md — this version has breaking changes)
- **Neon** (serverless Postgres via `@neondatabase/serverless`)
- **Rewardful** (affiliate tracking API)
- **Tailwind CSS v4**, **Recharts**

## Environment Setup

Create `.env.local` in the project root (Next.js loads this automatically):

```
NEON_DATABASE_URL=postgresql://...
REWARDFUL_API_SECRET=...
POSTHOG_API_KEY=phx_...          # PostHog personal API key (read-only)
POSTHOG_PROJECT_ID=153418        # PostHog project ID (Runable)
```

Optional (only needed for webhooks and cron):
```
REWARDFUL_WEBHOOK_SECRET=...
CRON_SECRET=...
```

> **Gotcha:** `npm run migrate` and `npm run backfill` also load `.env.local` via dotenv — no need for a separate `.env` file.

## Commands

```bash
npm run dev          # Start dev server on localhost:3000
npm run build        # Production build
npm run migrate      # Create/update database tables (safe to re-run)
npm run backfill     # Backfill historical data from Rewardful API
npm run lint         # Run ESLint
```

## Architecture

```
app/
  page.tsx                        # Main dashboard (client component)
  api/
    dashboard/route.ts            # GET — aggregated stats from DB
    sync/route.ts                 # POST — pull latest data from Rewardful into DB
    affiliates/[id]/route.ts      # GET — per-affiliate detail data
    webhooks/rewardful/route.ts   # POST — receive Rewardful webhook events
    cron/sync/route.ts            # GET — cron-triggered sync (requires CRON_SECRET)
scripts/
  migrate.ts                      # DB schema creation (idempotent)
  backfill.ts                     # Historical data backfill from Rewardful
  backfill-customer-emails.ts     # One-time: backfill customer_email + PostHog country data on existing referrals
  fix-commissions.ts              # One-off commission correction utility
lib/
  db.ts                           # Neon SQL client
  posthog.ts                      # PostHog HogQL client — returns email→country map for geo enrichment
components/                       # MetricCard, DayOnDayChart, TopAffiliatesPie
```

## Data Flow

```
Rewardful API
     ↓
POST /api/sync  (runs every 3 min, 48h lookback window)
     ↓  upserts via ON CONFLICT (rewardful_id)
Neon Postgres
  affiliates       ← all affiliates + visitor/lead/conversion counts
  referrals        ← every referral: status, customer_email, country_code, country_name
  sales            ← every sale with amount in cents
  commissions      ← per-sale commission, paid/unpaid status
  payouts          ← payout records
  webhook_events   ← raw Rewardful webhook payloads (real-time)
     ↓
GET /api/dashboard?period=  (aggregates all tables into one JSON response)
     ↓
page.tsx  (client component, polls /api/dashboard every 30s)

PostHog geo enrichment (runs inside POST /api/sync):
  HogQL joins subscription_updated (isUserFirstPaidPlan=true)
  → sign_up (email) → $pageview (country)
  → updates referrals.country_code / country_name where customer_email matches
```

Rewardful also pushes **webhooks** in real-time to `/api/webhooks/rewardful`, which are stored directly into `webhook_events`.

## How the UI Is Built

`page.tsx` is a single client component that:

1. On mount, calls `GET /api/dashboard` immediately (fast local DB read), then `POST /api/sync` in the background
2. Auto-refreshes dashboard data every **30 seconds**
3. Auto-syncs with Rewardful every **3 minutes**

The dashboard JSON from `/api/dashboard?period=7d|30d|90d|all` contains everything pre-aggregated:
- `overview` — counts and amounts filtered by `?period` (default: all). **Only these 8 metric cards respect the period filter** — all other data is always all-time.
- `charts.dailyAffiliates/Referrals/Revenue/Commissions` — 30-day day-by-day arrays (bar charts)
- `monthly` — month-by-month rollups (MoM charts + table)
- `affiliates` — full list with per-affiliate stats (sortable table)
- `topByReferrals` / `topByConversions` — top 15 for pie charts
- `weeklyLeaderboard` — ranked list for current Mon–Sun week
- `recentActivity` — latest webhook events
- `countriesByConversions` — top 20 countries by conversion count
- `affiliateCountries` — per-affiliate country breakdown with conversion counts

Clicking an affiliate row calls `GET /api/affiliates/[id]` for their individual 30-day charts (referrals, revenue, commissions).

## Key Behaviours

- Dashboard auto-syncs with Rewardful every 3 minutes and refreshes every 30 seconds
- Sync uses a 48-hour lookback window to cover missed syncs
- All affiliate commission stats are fetched individually if not present in list response
- Tables: `affiliates`, `referrals`, `sales`, `commissions`, `payouts`, `webhook_events`

## Gotchas

- **Country data comes from PostHog, not Rewardful.** Rewardful has no geo. Country is looked up via the customer's email: Rewardful `referral.customer.email` → PostHog `sign_up` event → `$pageview` geo properties.
- **Server-side PostHog events have no geo.** `$geoip_disable: true` is set on server events — only `$pageview` (client-side) carries `$geoip_country_code`. Never query geo directly from `subscription_updated`.
- **Conversion definition:** Rewardful `conversion_state = 'conversion'` ↔ PostHog `subscription_updated` with `properties.isUserFirstPaidPlan = true`.
- **Period filter scope:** `?period=` only affects the 8 overview metric cards. All charts, tables, leaderboard, and country breakdowns always show all-time data.
- **Re-run country backfill:** `npx tsx scripts/backfill-customer-emails.ts` — safe to re-run, only fills rows where `country_code IS NULL`.
