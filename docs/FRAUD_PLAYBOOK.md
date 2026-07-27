# Affiliate fraud and brand-bidding playbook

Last reviewed: 2026-07-25

## What the dashboard can prove today

The current data can show that an affiliate token was present on first-touch traffic, that paid-ad parameters were present, whether the Google campaign ID matches a campaign in Runable's connected Google Ads data, how many signups and first paid subscriptions followed, the countries of matched conversions, and how much unpaid commission is exposed. Where Rewardful captured `utm_term` or `utm_campaign`, the War Room also shows those exact values and their referral counts.

An observed UTM term is useful evidence but does not independently prove the user's live search query, ad creative, advertiser identity, impression volume, or SERP position. Those require search monitoring or ad-transparency evidence. The UI must say “signal,” “likely,” or “needs review” until that evidence is attached.

## Evidence ladder

1. **Observe** — token-level paid parameters, source, campaign IDs, country, signup/FTS, refunds, and commission exposure.
2. **Corroborate** — capture the live ad/landing URL, keyword, country/device/time, advertiser identity, and screenshot from an independent SERP or transparency source.
3. **Test incrementality** — compare geo/time holdouts, new-customer rate, time-to-pay, refund/churn, and organic/direct cannibalization.
4. **Classify** — allowed incremental paid acquisition, policy breach but commercially positive, non-incremental brand interception, campaign hijack, cookie/token stuffing, coordinated ring, self-referral, or insufficient evidence.
5. **Decide** — clear, warn, cap, change campaign, freeze payout, void specific commission, or propose disablement.
6. **Apply with approval** — Rewardful mutation happens only from a reviewed case, with the previous state and source response logged.

## Primary signal definitions

- **Paid-ads traffic:** at least 10 PostHog signups and at least 50% carrying `gclid`, `gbraid`, or `gad_campaignid` on first touch.
- **Our-campaign overlap:** affiliate-attributed traffic contains a Google campaign ID owned by Runable. This is high-priority evidence of commission cannibalization, but the landing URL still needs review.
- **Shared-campaign ring:** one campaign ID appears under multiple affiliate tokens. It may indicate one operator with several accounts, an agency, a shared redirect, or a tracking implementation problem.
- **Brand-intent token:** generic tokens such as `login`, `official`, `download`, or `coupon`. Useful supporting context, never sufficient alone.
- **Zero-organic profile:** meaningful signup volume with no signups lacking paid parameters. Stronger when combined with a brand token or campaign overlap.
- **Google-like time to pay:** affiliate customers convert at a speed similar to the strict Google brand baseline. This suggests intercepted existing intent but does not identify who placed an ad.

## Finding keywords and ads by country

Add a search-evidence collector with the following fields:

- keyword and match theme;
- country, language, device, and observed timestamp;
- advertiser/domain, headline, description, display URL, and final URL;
- affiliate token and redirect chain;
- screenshot and evidence URL;
- linked PostHog signups/FTS, Rewardful revenue/commission, refunds/churn, and new-vs-existing customer status.

Possible evidence sources include Google Ads Transparency Center, policy-compliant SERP monitoring from target geographies, the Google Ads search terms report for Runable-owned campaigns, and a contracted brand-protection/ad-verification provider. Do not scrape authenticated or restricted surfaces in violation of their terms.

## Beneficial paid affiliate traffic

Paid traffic is not automatically bad. Treat it as beneficial when it is contractually allowed, measurably incremental, uses approved non-brand keywords or new audiences, does not reuse Runable campaign IDs, has acceptable payback/refund/churn, and does not displace organic or Runable-paid conversions.

A useful decision metric is incremental contribution, not gross revenue:

`incremental gross margin - ad subsidy - commission - refunds - support cost`

Run geo/time holdouts or controlled coupon/landing-page experiments before raising commission rates. High conversion alone can be the signature of intercepted brand demand.

## Payout safeguards

- Freeze the unpaid amount locally first; do not mark a Rewardful payout paid or delete a commission during investigation.
- Review individual evidence and affected commissions, not only an affiliate-level risk score.
- Require a reason, reviewer, timestamp, and previous Rewardful state for every decision.
- Release, void, or disable as separate explicit actions.
- Never expose Rewardful's destructive commission delete endpoint as a casual dashboard control.
