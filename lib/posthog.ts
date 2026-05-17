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
