# Country Breakdown via PostHog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich Rewardful conversion data with country information from PostHog and display a country breakdown chart on the affiliate dashboard.

**Architecture:** During each sync, query PostHog via HogQL for all signed-up users with known country (from `$pageview` geo data), match to Rewardful referrals by email, and store `country_code`/`country_name` in the `referrals` table. The dashboard API reads these columns and returns a ranked country list. The UI renders a horizontal bar chart.

**Tech Stack:** Next.js 16, Neon (serverless Postgres), PostHog HogQL API, Recharts, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/migrate.ts` | Modify | Add `country_code`, `country_name` columns to `referrals` |
| `lib/posthog.ts` | Create | PostHog HogQL client — returns `Map<email, country>` |
| `app/api/sync/route.ts` | Modify | Call PostHog client after referral sync, update DB |
| `app/api/dashboard/route.ts` | Modify | Add `countriesByConversions` aggregation query |
| `app/page.tsx` | Modify | Add country breakdown bar chart section |
| `.env.local` | Modify | Add `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID` |
| `CLAUDE.md` | Modify | Document new env vars |

---

### Task 1: Add country columns to the database

**Files:**
- Modify: `scripts/migrate.ts`

- [ ] **Step 1: Add the two ALTER TABLE statements to `scripts/migrate.ts`**

Open `scripts/migrate.ts` and add these two lines after the existing `ALTER TABLE referrals` statements (after line that adds `link_token`):

```typescript
await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_code TEXT`;
await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_name TEXT`;
```

The full block of referral alters should look like:
```typescript
await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS link_id TEXT`;
await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS link_token TEXT`;
await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_code TEXT`;
await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_name TEXT`;
```

- [ ] **Step 2: Run the migration**

```bash
cd "/Users/sakshamtewari/Desktop/affiliate project/affiliate-commission-dashboard"
npm run migrate
```

Expected output:
```
Running migrations...
✅ All tables created successfully.
```

- [ ] **Step 3: Verify columns exist in Neon**

```bash
NEON_DATABASE_URL="$(grep NEON_DATABASE_URL .env.local | cut -d= -f2-)" npx tsx -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.NEON_DATABASE_URL!);
const cols = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name = 'referrals' AND column_name IN ('country_code', 'country_name')\`;
console.log(cols);
"
```

Expected: two rows returned with `country_code` and `country_name`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate.ts
git commit -m "feat: add country_code and country_name columns to referrals table"
```

---

### Task 2: Create PostHog HogQL client

**Files:**
- Create: `lib/posthog.ts`

- [ ] **Step 1: Add env vars to `.env.local`**

Open `.env.local` and add (your API key is already there — add the project ID):
```
POSTHOG_PROJECT_ID=153418
```

`POSTHOG_API_KEY` should already be present from the earlier setup. Confirm both lines exist.

- [ ] **Step 2: Create `lib/posthog.ts`**

```typescript
/**
 * PostHog HogQL client.
 * Queries sign_up events joined with $pageview geo data to build
 * a Map<email, { country_code, country_name }> for all users with known country.
 */

interface CountryData {
  country_code: string;
  country_name: string;
}

interface HogQLResponse {
  results: [string, string, string, string][]; // [distinct_id, email, country_code, country_name]
  error?: string;
}

export async function getConversionCountriesByEmail(): Promise<Map<string, CountryData>> {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;

  if (!apiKey || !projectId) {
    console.warn('[posthog] POSTHOG_API_KEY or POSTHOG_PROJECT_ID not set — skipping country enrichment');
    return new Map();
  }

  const query = `
    SELECT
      s.distinct_id,
      s.properties.email AS email,
      p.country_code,
      p.country_name
    FROM events s
    LEFT JOIN (
      SELECT
        distinct_id,
        properties.$geoip_country_code AS country_code,
        properties.$geoip_country_name AS country_name
      FROM events
      WHERE event = '$pageview'
        AND properties.$geoip_country_code IS NOT NULL
      GROUP BY distinct_id, country_code, country_name
    ) p ON s.distinct_id = p.distinct_id
    WHERE s.event = 'sign_up'
      AND p.country_code IS NOT NULL
  `;

  const res = await fetch(
    `https://us.posthog.com/api/projects/${projectId}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    }
  );

  if (!res.ok) {
    console.error('[posthog] Query failed:', res.status, await res.text());
    return new Map();
  }

  const data = await res.json() as HogQLResponse;

  if (data.error) {
    console.error('[posthog] HogQL error:', data.error);
    return new Map();
  }

  const map = new Map<string, CountryData>();
  for (const [, email, country_code, country_name] of data.results) {
    if (email && country_code && country_name) {
      map.set(email.toLowerCase(), { country_code, country_name });
    }
  }

  return map;
}
```

- [ ] **Step 3: Smoke-test the client manually**

```bash
cd "/Users/sakshamtewari/Desktop/affiliate project/affiliate-commission-dashboard"
npx tsx -e "
import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
const { getConversionCountriesByEmail } = await import('./lib/posthog.ts');
const map = await getConversionCountriesByEmail();
console.log('Total entries:', map.size);
console.log('Sample:', [...map.entries()].slice(0, 3));
"
```

Expected: `Total entries: <some number>` and a few sample email→country pairs. If 0, double-check `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID` in `.env.local`.

- [ ] **Step 4: Commit**

```bash
git add lib/posthog.ts .env.local
git commit -m "feat: add PostHog HogQL client for country lookup by email"
```

---

### Task 3: Enrich referrals with country during sync

**Files:**
- Modify: `app/api/sync/route.ts`

- [ ] **Step 1: Add the PostHog import at the top of `app/api/sync/route.ts`**

Add after the existing imports at the top of the file:
```typescript
import { getConversionCountriesByEmail } from '@/lib/posthog';
```

- [ ] **Step 2: Add country enrichment after the referrals sync block**

In `app/api/sync/route.ts`, after the referrals `INSERT` block (around line 121, after the `if (referrals.length > 0)` block closes), add:

```typescript
    // Enrich converted referrals with country data from PostHog
    let countriesEnriched = 0;
    try {
      const countryMap = await getConversionCountriesByEmail();
      if (countryMap.size > 0) {
        // Get all converted referrals missing country, joined with affiliate email
        const toEnrich = await sql`
          SELECT r.rewardful_id, a.email
          FROM referrals r
          JOIN affiliates a ON a.rewardful_id = r.affiliate_id
          WHERE r.status = 'converted'
            AND r.country_code IS NULL
            AND a.email IS NOT NULL
        `;
        for (const row of toEnrich) {
          const email = (row.email as string).toLowerCase();
          const country = countryMap.get(email);
          if (country) {
            await sql`
              UPDATE referrals
              SET country_code = ${country.country_code}, country_name = ${country.country_name}
              WHERE rewardful_id = ${row.rewardful_id as string}
            `;
            countriesEnriched++;
          }
        }
      }
    } catch (err) {
      console.error('[sync] Country enrichment failed (non-fatal):', err);
    }
```

- [ ] **Step 3: Include `countriesEnriched` in the sync response**

Find the final `return NextResponse.json(...)` at the bottom of the POST handler and update it:

```typescript
    return NextResponse.json({
      synced: { affiliates: affiliates.length, referrals: referrals.length, sales: sales.length, commissions: commissions.length, commissionStatsUpdated, countriesEnriched },
      syncedAt: new Date().toISOString(),
    });
```

- [ ] **Step 4: Test by triggering a sync**

With `npm run dev` running, open `localhost:3000` and click **Sync now**. Check the terminal for:
- No `[sync] Country enrichment failed` errors
- The sync completes successfully

Also check the DB directly:
```bash
npx tsx -e "
import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.NEON_DATABASE_URL!);
const rows = await sql\`SELECT country_code, country_name, COUNT(*) FROM referrals WHERE country_code IS NOT NULL GROUP BY country_code, country_name ORDER BY count DESC LIMIT 10\`;
console.log(rows);
"
```

Expected: a list of countries with counts.

- [ ] **Step 5: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat: enrich converted referrals with country data from PostHog during sync"
```

---

### Task 4: Add country breakdown to dashboard API

**Files:**
- Modify: `app/api/dashboard/route.ts`

- [ ] **Step 1: Add the country query to the `Promise.all` block**

In `app/api/dashboard/route.ts`, add `countriesByConversions` as the last entry in the `Promise.all([...])` array. Find the closing `]);` of the `Promise.all` and add before it:

```typescript
    // Countries by conversions
    sql`
      SELECT
        country_name,
        country_code,
        COUNT(*) AS conversions
      FROM referrals
      WHERE status = 'converted'
        AND country_code IS NOT NULL
      GROUP BY country_name, country_code
      ORDER BY conversions DESC
      LIMIT 20
    `,
```

- [ ] **Step 2: Destructure the new query result**

At the top of the `Promise.all` destructuring, add `countriesByConversions` as the last variable:

```typescript
  const [
    affiliateStats,
    referralStats,
    revenueStats,
    commissionStats,
    payoutStats,
    dailyAffiliates,
    dailyReferrals,
    dailyRevenue,
    dailyCommissions,
    affiliateList,
    recentEvents,
    weeklyLeaderboard,
    topByReferrals,
    topByConversions,
    monthlyReferrals,
    monthlyRevenue,
    monthlyCommissions,
    countriesByConversions,
  ] = await Promise.all([
```

- [ ] **Step 3: Include it in the JSON response**

In the `return NextResponse.json({...})` at the bottom, add:

```typescript
    countriesByConversions: countriesByConversions.map((r) => ({
      country_code: r.country_code as string,
      country_name: r.country_name as string,
      conversions: Number(r.conversions),
    })),
```

- [ ] **Step 4: Verify the API response**

With `npm run dev` running:
```bash
curl -s http://localhost:3000/api/dashboard | npx tsx -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
console.log(data.countriesByConversions);
"
```

Expected: an array of `{ country_code, country_name, conversions }` objects.

- [ ] **Step 5: Commit**

```bash
git add app/api/dashboard/route.ts
git commit -m "feat: add countriesByConversions to dashboard API response"
```

---

### Task 5: Add country breakdown chart to the UI

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add `countriesByConversions` to the `DashboardData` interface**

In `app/page.tsx`, find the `DashboardData` interface and add the new field:

```typescript
interface DashboardData {
  overview: { ... };
  charts: { ... };
  affiliates: Affiliate[];
  recentActivity: { event_type: string; received_at: string; event_id: string }[];
  monthly: { ... }[];
  topByReferrals: { name: string; value: number }[];
  topByConversions: { name: string; value: number }[];
  weeklyLeaderboard: { ... }[];
  countriesByConversions: { country_code: string; country_name: string; conversions: number }[];
}
```

- [ ] **Step 2: Add the country breakdown section to the JSX**

In `app/page.tsx`, find the pie charts section (the `<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">` with `TopAffiliatesPie`) and add this new section directly after it (before the Monthly section):

```tsx
        {/* Country breakdown */}
        {data.countriesByConversions.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Conversions by Country</h2>
            <ResponsiveContainer width="100%" height={Math.max(200, data.countriesByConversions.slice(0, 10).length * 36)}>
              <BarChart
                data={data.countriesByConversions.slice(0, 10)}
                layout="vertical"
                margin={{ top: 0, right: 40, left: 100, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="country_name"
                  tick={{ fontSize: 12 }}
                  width={95}
                />
                <Tooltip formatter={(v) => [`${v} conversions`, 'Conversions']} />
                <Bar dataKey="conversions" fill="#6366f1" radius={[0, 4, 4, 0]}>
                  {data.countriesByConversions.slice(0, 10).map((entry) => (
                    <text
                      key={entry.country_code}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
```

Note: `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer` are already imported from `recharts` in `page.tsx`.

- [ ] **Step 3: Check the dashboard renders correctly**

Open `localhost:3000` in the browser. Scroll down past the pie charts. You should see a "Conversions by Country" horizontal bar chart. If `countriesByConversions` is empty (no data yet), the section won't render — trigger a sync first by clicking **Sync now**.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add country breakdown horizontal bar chart to dashboard"
```

---

### Task 6: Update CLAUDE.md with new env vars

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add PostHog env vars to the Environment Setup section in `CLAUDE.md`**

Find the `## Environment Setup` section in `CLAUDE.md` and add the two new vars:

```markdown
POSTHOG_API_KEY=phx_...          # PostHog personal API key (read-only)
POSTHOG_PROJECT_ID=153418        # PostHog project ID (Runable)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add PostHog env vars to CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**
- ✅ DB columns — Task 1
- ✅ `lib/posthog.ts` client — Task 2
- ✅ Sync enrichment — Task 3
- ✅ Dashboard API — Task 4
- ✅ UI chart — Task 5
- ✅ Env vars documented — Task 6
- ✅ Edge case: PostHog down → non-fatal, sync continues — Task 3 Step 2 (try/catch)
- ✅ Edge case: Only fill NULL rows → idempotent — Task 3 Step 2 (`country_code IS NULL`)
- ✅ Edge case: Email normalised to lowercase — Task 2 Step 2 (`email.toLowerCase()`)

**Placeholder scan:** None found.

**Type consistency:**
- `getConversionCountriesByEmail()` defined in Task 2, imported in Task 3 ✅
- `countriesByConversions` field added to interface in Task 5, returned from API in Task 4 ✅
- `CountryData.country_code` / `country_name` consistent across all tasks ✅
