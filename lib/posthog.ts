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
  results: unknown[][];
  error?: string;
}

export interface SignupToFTS {
  signupAt: string;        // ISO timestamp of sign_up event
  ftsAt: string;           // ISO timestamp of first-time-paid subscription_updated
  ttsSec: number;          // seconds between sign_up and FTS
}

export interface FunnelTiming {
  email: string;
  firstPvAt: string | null;        // earliest $pageview for this user
  signupAt: string | null;
  ftsAt: string;
  initialUtmSource: string | null;   // person property $initial_utm_source
  initialUtmCampaign: string | null; // person property $initial_utm_campaign
  initialReferrer: string | null;    // person property $initial_referring_domain
  countryCode: string | null;
  countryName: string | null;
  pvToSignupSec: number | null;
  signupToFtsSec: number | null;
  pvToFtsSec: number | null;
}

async function runHogQL(query: string): Promise<HogQLResponse | null> {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) {
    console.warn('[posthog] POSTHOG_API_KEY or POSTHOG_PROJECT_ID not set');
    return null;
  }
  const res = await fetch(
    `https://us.posthog.com/api/projects/${projectId}/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    }
  );
  if (!res.ok) {
    console.error('[posthog] Query failed:', res.status, await res.text());
    return null;
  }
  return await res.json() as HogQLResponse;
}

// Returns Map<lower(email), { signupAt, ftsAt, ttsSec }> for users whose FTS
// happened within [from, to). FTS = subscription_updated with
// isUserFirstPaidPlan=true and scenario='upgrade'. Used to compute per-affiliate
// median Time-to-Subscribe (TTS) — short TTS = intercepted buyer intent.
export async function getSignupToFirstPurchaseByEmail(
  from: Date,
  to: Date
): Promise<Map<string, SignupToFTS>> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const query = `
    SELECT
      LOWER(fts.email) AS email,
      signup.signup_at AS signup_at,
      fts.fts_at AS fts_at
    FROM (
      SELECT
        distinct_id,
        properties.email AS email,
        MIN(timestamp) AS fts_at
      FROM events
      WHERE event = 'subscription_updated'
        AND properties.isUserFirstPaidPlan = true
        AND properties.scenario = 'upgrade'
        AND properties.email IS NOT NULL
        AND timestamp >= toDateTime('${fromIso}')
        AND timestamp < toDateTime('${toIso}')
      GROUP BY distinct_id, email
    ) fts
    INNER JOIN (
      SELECT distinct_id, MIN(timestamp) AS signup_at
      FROM events
      WHERE event = 'sign_up'
      GROUP BY distinct_id
    ) signup ON signup.distinct_id = fts.distinct_id
    WHERE signup.signup_at IS NOT NULL
      AND fts.email IS NOT NULL
    LIMIT 50000
  `;

  const data = await runHogQL(query);
  if (!data) return new Map();
  if (data.error) {
    console.error('[posthog] HogQL error:', data.error);
    return new Map();
  }

  const map = new Map<string, SignupToFTS>();
  for (const row of data.results) {
    const [email, signupAt, ftsAt] = row as [string, string, string];
    if (!email || !signupAt || !ftsAt) continue;
    const signupMs = new Date(signupAt).getTime();
    const ftsMs = new Date(ftsAt).getTime();
    if (!isFinite(signupMs) || !isFinite(ftsMs) || ftsMs < signupMs) continue;
    map.set(email.toLowerCase(), {
      signupAt,
      ftsAt,
      ttsSec: (ftsMs - signupMs) / 1000,
    });
  }
  return map;
}

export interface FunnelCounts {
  pageviews: number;
  signups: number;
  fts: number;
  signupToFtsSec: number | null; // overall median in this group
}

// Pageview / signup / FTS user counts per source, for ALL users active in window
// (not just those who FTS'd). Used to compute funnel conversion rates per group.
export async function getFunnelCountsBySource(
  from: Date,
  to: Date
): Promise<{ google: FunnelCounts; affiliate_emails: Set<string>; other: FunnelCounts }> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // For each distinct_id, what was their max funnel stage reached, and what's
  // their initial source? Group by source bucket and count users at each stage.
  const query = `
    WITH user_funnel AS (
      SELECT
        events.distinct_id AS distinct_id,
        any(person.properties.$initial_utm_source) AS initial_utm,
        any(person.properties.$initial_utm_campaign) AS initial_campaign,
        any(person.properties.$initial_referring_domain) AS initial_ref,
        MAX(events.event = '$pageview') AS had_pv,
        MAX(events.event = 'sign_up') AS had_signup,
        MAX(events.event = 'subscription_updated'
            AND events.properties.isUserFirstPaidPlan = true
            AND events.properties.scenario = 'upgrade') AS had_fts,
        MIN(CASE WHEN events.event = 'sign_up' THEN events.timestamp ELSE NULL END) AS signup_at,
        MIN(CASE WHEN events.event = 'subscription_updated'
                  AND events.properties.isUserFirstPaidPlan = true
                  AND events.properties.scenario = 'upgrade' THEN events.timestamp ELSE NULL END) AS fts_at
      FROM events
      WHERE events.timestamp >= toDateTime('${fromIso}')
        AND events.timestamp < toDateTime('${toIso}')
      GROUP BY events.distinct_id
    )
    SELECT
      CASE
        -- Strict brand-search Ad: utm_source in (googleads, google_ads) AND utm_campaign = 'brand'
        WHEN LOWER(COALESCE(initial_utm, '')) IN ('googleads', 'google_ads')
             AND LOWER(COALESCE(initial_campaign, '')) = 'brand' THEN 'google'
        ELSE 'other'
      END AS source,
      COUNT(DISTINCT CASE WHEN had_pv THEN distinct_id ELSE NULL END) AS pv_users,
      COUNT(DISTINCT CASE WHEN had_signup THEN distinct_id ELSE NULL END) AS signup_users,
      COUNT(DISTINCT CASE WHEN had_fts THEN distinct_id ELSE NULL END) AS fts_users,
      quantile(0.5)(CASE WHEN had_fts AND signup_at IS NOT NULL AND fts_at IS NOT NULL
                        THEN dateDiff('second', signup_at, fts_at) ELSE NULL END) AS sf_median_sec
    FROM user_funnel
    GROUP BY source
  `;

  const data = await runHogQL(query);
  const result = {
    google: { pageviews: 0, signups: 0, fts: 0, signupToFtsSec: null as number | null },
    affiliate_emails: new Set<string>(),
    other: { pageviews: 0, signups: 0, fts: 0, signupToFtsSec: null as number | null },
  };
  if (!data || data.error) return result;

  for (const row of data.results) {
    const [source, pv, signup, fts, sfMed] = row as [string, number, number, number, number | null];
    const target = source === 'google' ? result.google : result.other;
    target.pageviews = Number(pv);
    target.signups = Number(signup);
    target.fts = Number(fts);
    target.signupToFtsSec = sfMed !== null && sfMed !== undefined ? Number(sfMed) : null;
  }
  return result;
}

// Returns full funnel timings (pageview → signup → FTS) + traffic-source
// attribution for every user whose FTS occurred in [from, to). Used to compare
// affiliate-attributed conversions against the Google-brand-search baseline.
export async function getFunnelTimingsForFTS(
  from: Date,
  to: Date
): Promise<FunnelTiming[]> {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // Per-user aggregation: earliest pageview, earliest signup, earliest in-window FTS.
  // Look back to 2025-01-01 to ensure we catch the first pageview/signup even for
  // users who signed up well before their FTS.
  const query = `
    SELECT
      events.distinct_id AS distinct_id,
      LOWER(MAX(CASE
        WHEN events.event = 'sign_up' THEN events.properties.email
        WHEN events.event = 'subscription_updated' THEN events.properties.email
        ELSE NULL
      END)) AS email,
      MIN(CASE WHEN events.event = '$pageview' THEN events.timestamp ELSE NULL END) AS first_pv_at,
      MIN(CASE WHEN events.event = 'sign_up' THEN events.timestamp ELSE NULL END) AS signup_at,
      MIN(CASE
        WHEN events.event = 'subscription_updated'
         AND events.properties.isUserFirstPaidPlan = true
         AND events.properties.scenario = 'upgrade'
        THEN events.timestamp ELSE NULL END) AS fts_at,
      any(person.properties.$initial_utm_source) AS initial_utm_source,
      any(person.properties.$initial_utm_campaign) AS initial_utm_campaign,
      any(person.properties.$initial_referring_domain) AS initial_referring_domain
    FROM events
    WHERE events.timestamp >= toDateTime('2025-01-01')
    GROUP BY events.distinct_id
    HAVING fts_at >= toDateTime('${fromIso}')
       AND fts_at < toDateTime('${toIso}')
       AND email IS NOT NULL
    LIMIT 50000
  `;

  const data = await runHogQL(query);
  if (!data || data.error) {
    if (data?.error) console.error('[posthog] HogQL error:', data.error);
    return [];
  }

  const out: FunnelTiming[] = [];
  for (const row of data.results) {
    const [, email, firstPvRaw, signupRaw, ftsRaw, utmSource, utmCampaign, refDomain] = row as
      [string, string, string | null, string | null, string, string | null, string | null, string | null];
    const countryCode: string | null = null;
    const countryName: string | null = null;
    if (!email || !ftsRaw) continue;
    const firstPvAt = firstPvRaw || null;
    const signupAt = signupRaw || null;
    const ftsAt = ftsRaw;
    const ftsMs = new Date(ftsAt).getTime();
    if (!isFinite(ftsMs)) continue;
    const firstPvMs = firstPvAt ? new Date(firstPvAt).getTime() : NaN;
    const signupMs = signupAt ? new Date(signupAt).getTime() : NaN;

    const pvToSignup = (isFinite(firstPvMs) && isFinite(signupMs) && signupMs >= firstPvMs)
      ? (signupMs - firstPvMs) / 1000 : null;
    const signupToFts = (isFinite(signupMs) && ftsMs >= signupMs)
      ? (ftsMs - signupMs) / 1000 : null;
    const pvToFts = (isFinite(firstPvMs) && ftsMs >= firstPvMs)
      ? (ftsMs - firstPvMs) / 1000 : null;

    out.push({
      email,
      firstPvAt,
      signupAt,
      ftsAt,
      initialUtmSource: utmSource ?? null,
      initialUtmCampaign: utmCampaign ?? null,
      initialReferrer: refDomain ?? null,
      countryCode: countryCode ?? null,
      countryName: countryName ?? null,
      pvToSignupSec: pvToSignup,
      signupToFtsSec: signupToFts,
      pvToFtsSec: pvToFts,
    });
  }
  return out;
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
      e.email,
      p.country_code,
      p.country_name
    FROM events s
    LEFT JOIN (
      SELECT distinct_id, properties.email AS email
      FROM events
      WHERE event = 'sign_up' AND properties.email IS NOT NULL
      GROUP BY distinct_id, email
    ) e ON s.distinct_id = e.distinct_id
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
    WHERE s.event = 'subscription_updated'
      AND s.properties.isUserFirstPaidPlan = true
      AND p.country_code IS NOT NULL
    LIMIT 50000
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
  for (const row of data.results) {
    const [, email, country_code, country_name] = row as [string, string, string, string];
    if (email && country_code && country_name) {
      map.set(email.toLowerCase(), { country_code, country_name });
    }
  }

  return map;
}
