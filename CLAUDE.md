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
  backfill.ts                     # Historical data backfill
  fix-commissions.ts              # One-off commission correction utility
lib/
  db.ts                           # Neon SQL client
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
  referrals        ← every referral with status (lead / converted)
  sales            ← every sale with amount in cents
  commissions      ← per-sale commission, paid/unpaid status
  payouts          ← payout records
  webhook_events   ← raw Rewardful webhook payloads (real-time)
     ↓
GET /api/dashboard  (aggregates all tables into one JSON response)
     ↓
page.tsx  (client component, polls /api/dashboard every 30s)
```

Rewardful also pushes **webhooks** in real-time to `/api/webhooks/rewardful`, which are stored directly into `webhook_events`.

## How the UI Is Built

`page.tsx` is a single client component that:

1. On mount, calls `POST /api/sync` (fetches latest from Rewardful → writes to DB) then `GET /api/dashboard`
2. Auto-refreshes dashboard data every **30 seconds**
3. Auto-syncs with Rewardful every **3 minutes**

The dashboard JSON from `/api/dashboard` contains everything pre-aggregated:
- `overview` — total counts and dollar amounts (metric cards at the top)
- `charts.dailyAffiliates/Referrals/Revenue/Commissions` — 30-day day-by-day arrays (bar charts)
- `monthly` — month-by-month rollups (MoM charts + table)
- `affiliates` — full list with per-affiliate stats (sortable table)
- `topByReferrals` / `topByConversions` — top 5 for pie charts
- `weeklyLeaderboard` — ranked list for current Mon–Sun week
- `recentActivity` — latest webhook events

Clicking an affiliate row calls `GET /api/affiliates/[id]` for their individual 30-day charts (referrals, revenue, commissions).

## Key Behaviours

- Dashboard auto-syncs with Rewardful every 3 minutes and refreshes every 30 seconds
- Sync uses a 48-hour lookback window to cover missed syncs
- All affiliate commission stats are fetched individually if not present in list response
- Tables: `affiliates`, `referrals`, `sales`, `commissions`, `payouts`, `webhook_events`
