# Country Breakdown via PostHog — Design Spec

**Date:** 2026-04-15  
**Project:** Affiliate Commission Dashboard  
**Goal:** Show country-wise breakdown of affiliate conversions by enriching Neon DB with country data from PostHog.

---

## Problem

Rewardful does not provide geographic data on conversions. PostHog captures country via GeoIP on `$pageview` events (server-side events have `$geoip_disable: true`). We need to bridge these two systems to answer: "Which countries are our affiliate conversions coming from?"

---

## Conversion Definition

A conversion in PostHog is identified by:
- **Event:** `subscription_updated`
- **Property:** `isUserFirstPaidPlan = true`

This is the first time a user pays, matching what Rewardful tracks as a conversion.

---

## Linking Strategy

PostHog and Rewardful share **email** as the common identifier.

- PostHog: `sign_up` event has `properties.email`
- Rewardful: `referrals` table has `affiliate_id`, linked to `affiliates.email`

Country is not on the conversion event (server-side, geo disabled). Instead, it is looked up by joining with `$pageview` events on `distinct_id` — the same user's browser sessions have country captured there.

**Query pattern:**
```sql
-- PostHog HogQL
SELECT 
  s.distinct_id,
  s.properties.email,
  p.country_code,
  p.country_name
FROM events s
LEFT JOIN (
  SELECT distinct_id,
    properties.$geoip_country_code AS country_code,
    properties.$geoip_country_name AS country_name
  FROM events
  WHERE event = '$pageview' AND properties.$geoip_country_code IS NOT NULL
  GROUP BY distinct_id, country_code, country_name
) p ON s.distinct_id = p.distinct_id
WHERE s.event = 'sign_up'
```

---

## Architecture

### 1. Database Changes

Add two columns to the `referrals` table (via `scripts/migrate.ts`):

```sql
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_name TEXT;
```

### 2. PostHog API Client (`lib/posthog.ts`)

A thin module that:
- Reads `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID` from env
- Exposes one function: `getConversionCountriesByEmail(): Promise<Map<string, { country_code, country_name }>>`
- Runs the HogQL join query above
- Returns a `Map<email, country>` for all sign_up users with known country

### 3. Sync Route Changes (`app/api/sync/route.ts`)

After syncing referrals from Rewardful, enrich with country:
1. Call `getConversionCountriesByEmail()`
2. For each referral with `status = 'converted'`, look up the affiliate's email
3. If a country match is found, `UPDATE referrals SET country_code, country_name WHERE rewardful_id = ?`

Only update rows where `country_code IS NULL` to avoid redundant writes on repeat syncs.

### 4. Dashboard API (`app/api/dashboard/route.ts`)

Add one new query:

```sql
SELECT 
  r.country_name,
  r.country_code,
  COUNT(*) AS conversions
FROM referrals r
WHERE r.status = 'converted'
  AND r.country_code IS NOT NULL
GROUP BY r.country_name, r.country_code
ORDER BY conversions DESC
LIMIT 20
```

Include result as `countriesByConversions` in the dashboard JSON response.

### 5. UI (`app/page.tsx`)

Add a new section below the pie charts:

- **Title:** "Conversions by Country"
- **Component:** Horizontal bar chart (Recharts `BarChart` with `layout="vertical"`)
- Top 10 countries, sorted by conversion count
- Each bar shows country name + count

---

## New Environment Variables

```
POSTHOG_API_KEY=phx_...        # PostHog personal API key (not project key)
POSTHOG_PROJECT_ID=153418      # PostHog project ID
```

Add to `.env.local`. Update `CLAUDE.md` with these vars.

---

## Data Flow

```
PostHog (sign_up events + $pageview geo)
         ↓ HogQL join query
lib/posthog.ts → Map<email, country>
         ↓
/api/sync → UPDATE referrals SET country_code, country_name
         ↓
Neon DB (referrals.country_code, referrals.country_name)
         ↓
/api/dashboard → countriesByConversions[]
         ↓
page.tsx → Horizontal bar chart
```

---

## Edge Cases

- **No country found:** Referral stays with `country_code = NULL`, excluded from chart
- **Multiple countries per user:** Takes the most recent `$pageview` country (GROUP BY keeps one)
- **Email mismatch:** Apple relay emails or users who change email won't match — accepted limitation
- **PostHog API down during sync:** Catch error, log warning, skip country enrichment — existing data unaffected
- **Repeat syncs:** Only update rows where `country_code IS NULL` — idempotent

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/migrate.ts` | Add `country_code`, `country_name` columns to `referrals` |
| `lib/posthog.ts` | New — PostHog HogQL client |
| `app/api/sync/route.ts` | Enrich converted referrals with country after sync |
| `app/api/dashboard/route.ts` | Add `countriesByConversions` query |
| `app/page.tsx` | Add country breakdown bar chart section |
| `.env.local` | Add `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID` |
| `CLAUDE.md` | Document new env vars |
