// Quick test: are PostHog env vars working + what does the FTS query return?
import { getConversionCountriesByEmail, getFunnelTimingsForFTS } from '../lib/posthog';

async function main() {
  console.log('POSTHOG_API_KEY:', process.env.POSTHOG_API_KEY ? `SET (len=${process.env.POSTHOG_API_KEY.length})` : 'MISSING');
  console.log('POSTHOG_PROJECT_ID:', process.env.POSTHOG_PROJECT_ID || 'MISSING');
  console.log();

  console.log('--- Test 1: getConversionCountriesByEmail (existing, known to work) ---');
  const countries = await getConversionCountriesByEmail();
  console.log(`Returned ${countries.size} email→country mappings`);
  if (countries.size > 0) {
    let i = 0;
    for (const [email, c] of countries) {
      console.log(`  ${email} → ${c.country_code}/${c.country_name}`);
      if (++i >= 5) break;
    }
  }

  console.log();
  console.log('--- Test 2: getFunnelTimingsForFTS (new, what TTS uses) ---');
  const from = new Date('2026-04-01T00:00:00Z');
  const to = new Date('2026-06-01T00:00:00Z');
  const timings = await getFunnelTimingsForFTS(from, to);
  console.log(`Returned ${timings.length} funnel timing rows`);
  for (const t of timings.slice(0, 5)) {
    console.log(`  ${t.email}  pv=${t.firstPvAt}  signup=${t.signupAt}  fts=${t.ftsAt}  src=${t.initialUtmSource}/${t.initialReferrer}  s→f=${t.signupToFtsSec}s`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
