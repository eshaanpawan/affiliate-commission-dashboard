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
  results: [string, string, string, string][];
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
  for (const [, email, country_code, country_name] of data.results) {
    if (email && country_code && country_name) {
      map.set(email.toLowerCase(), { country_code, country_name });
    }
  }

  return map;
}
