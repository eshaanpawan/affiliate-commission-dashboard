# Affiliate dashboard data contract

Last reviewed: 2026-07-25

This document is the source of truth for what every dashboard number means. It prevents Rewardful account state, PostHog behavior, and inferred fraud signals from being mixed into one ambiguous metric.

## Reporting window rules

- Global ranges are `7d`, `30d`, `90d`, and `all`.
- All calculations use UTC calendar days. A 7-day window starts at 00:00 UTC six days before today and includes the partial current day. Explicit funnel dates use half-open windows: `from <= timestamp < to`.
- A chart inherits the global range until it is explicitly overridden. A chart override wins until reset to Global.
- Flow metrics are filtered: referral visits, conversions, sales, commissions created, PostHog pageviews, signups, and FTS.
- Stock metrics are point-in-time and do not change with a reporting window: current affiliate status, payout holds, current pending payouts, and enforcement state. The UI must label these as current.

## Metric ownership

| Metric | System of record | Grain | Window timestamp | Notes |
|---|---|---|---|---|
| Affiliate account and state | Rewardful | affiliate | `affiliate.created_at` for new affiliates | Current state is active, suspicious, disabled, or deleted. |
| Referral visits | Rewardful | referral | `referral.created_at` | A Rewardful referral is not the same thing as a PostHog pageview. |
| Referral cohort conversions | Rewardful | referral | `referral.created_at` | Conversion rate answers “what share of referrals acquired in the window are now converted?” |
| Sales and revenue | Rewardful | sale | `sale.created_at` | Excludes deleted/refunded sales where source state is known. |
| Commission generated | Rewardful | commission | `commission.created_at` | Excludes voided/deleted. Never label this “owed.” |
| Paid commission | Rewardful | commission | `commission.created_at`, state `paid` | Amount generated in the window that is now paid. |
| Pending payout exposure | Rewardful | payout | current state | Point-in-time; includes pending/due/processing. |
| Pageviews, signups, FTS | PostHog | person/event, materialized per token/day | event day | `affiliate_traffic` is the dashboard read model. FTS is first paid upgrade only. |
| Country | PostHog-enriched Rewardful conversion | referral conversion | referral acquisition window | Unmatched conversions remain unknown; they are not guessed. |
| Observed ad terms | Rewardful referral UTM fields | affiliate + term | referral acquisition window | `utm_term` and `utm_campaign` are shown exactly as captured. Missing values remain “not captured”; neither field independently proves the live search query. |
| Brand-search baseline | PostHog | person funnel | FTS event window | Strict baseline is initial UTM source `googleads`/`google_ads` and campaign `brand`. |
| Fraud risk | Derived | affiliate/window | selected window | A triage score, never proof by itself. Every signal must retain evidence. |

## Attribution rules

- Affiliate behavioral attribution uses the `via` token found in PostHog `person.$initial_current_url`.
- Token ownership is resolved to the earliest Rewardful referral that contains that link token.
- If ownership is missing or ambiguous, traffic remains unattributed; it is not assigned by email guesswork.
- Google brand-search comparison uses first-touch UTM properties. It measures similarity to brand intent, not a confirmed ad purchase by the affiliate.
- Per-affiliate time-to-pay may use email matching only when explicitly labeled, because historical FTS events do not always carry a usable `via` token.

## Source reconciliation gates

As of 2026-07-25, direct source counts and the local read model did not reconcile:

| Resource | Rewardful API | Local database | Difference |
|---|---:|---:|---:|
| Affiliates | 2,537 | 2,540 | +3 local |
| Referrals | 203,909 | 177,781 | -26,128 local |
| Commissions | 5,475 | 5,268 | -207 local |
| Payouts | 223 | not previously reconciled | unknown |

This means all-time totals must be considered provisional until the resumable full reconciliation completes. The normal UI sync is incremental; it cannot repair an old 26k-row gap by itself.

Before declaring a source healthy, verify:

1. Source and local counts reconcile by resource and state.
2. IDs are unique at the documented grain.
3. The newest source update is inside the freshness SLA.
4. Commission totals reconcile by state and currency, not only in aggregate.
5. Null affiliate IDs and unknown token ownership are reported separately.
6. UTC boundary tests pass for 7d, 30d, 90d, and all-time.

## Rewardful campaign facts requiring a business decision

The live account currently contains three campaigns, including a 200% commission campaign and programs with a two-month maximum commission duration. Those commercial terms should be reviewed against public affiliate messaging. The dashboard must surface the mismatch; it must not silently rewrite source configuration.
