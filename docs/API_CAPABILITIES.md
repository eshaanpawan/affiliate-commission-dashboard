# Rewardful and PostHog capability map

Last reviewed: 2026-07-25

## Rewardful REST API

Rewardful is the commercial system of record. The dashboard can use:

- campaigns for commission terms, minimum payout, referral expiry, due delay, affiliate counts, and program messaging;
- affiliates for identity, active/disabled/suspicious state, campaign membership, payment details, links, commission statistics, and SSO magic links;
- affiliate links and coupons for token/URL ownership and visitor/lead/conversion rollups;
- referrals for visitor/lead/conversion state, customer, visits, link, expiry, and update-window reconciliation;
- sales for revenue/refunds and referral/affiliate linkage;
- commissions for pending/due/paid/voided state and due/paid dates;
- payouts for pending/due/processing/paid state and the explicit mark-paid operation;
- webhooks for low-latency source changes.

Operational requirements:

- paginate at 100 rows and honor the usual 45 requests per 30 seconds limit;
- use `updated_since` for changed referrals rather than only `created_at`;
- request `links` and `commission_stats` expansions with the affiliate list instead of making thousands of individual requests;
- keep a resumable full reconciliation separate from the normal incremental sync;
- store source IDs and previous state for mutations;
- never use commission deletion as a substitute for a reviewed void workflow.

Primary documentation: <https://developers.rewardful.com/rest-api/overview>

## PostHog APIs and CLI

PostHog is the behavioral source and can support:

- HogQL queries across events, persons, and connected warehouse tables;
- sequential funnels, strict funnels, attribution, breakdowns, conversion windows, and time-to-convert;
- token-level pageview/signup/FTS materialization;
- initial UTM/referrer/URL attribution and device/geo properties;
- event and property definitions for validating the tracking contract;
- batch exports for repeatable large extracts instead of interactive queries;
- Google Ads warehouse joins for Runable-owned campaign IDs and spend context;
- the PostHog CLI `api` and SQL commands for reproducible diagnostics and CI checks.

Operational requirements:

- use the correct regional host and a least-privilege personal API key for private endpoints;
- materialize high-volume daily facts and reserve live HogQL for analyses requiring raw event sequencing;
- set explicit limits because grouped results otherwise truncate;
- report partial query failure separately from a genuine zero-result window;
- validate event names and required properties before computing a funnel;
- never cache a degraded empty response as valid funnel data.

Primary documentation: <https://posthog.com/docs/api>, <https://posthog.com/docs/product-analytics/funnels>, and <https://posthog.com/docs/cli>.
