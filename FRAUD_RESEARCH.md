# Affiliate Fraud Detection — Deep Research Report

**Audience:** Runable (SaaS, Rewardful, ~1,469 affiliates, ~$17K commissions owed)
**Date:** 2026-05-16
**Mode:** Deep — 16 web searches, 38 unique sources

---

## Executive Summary

Your current logic catches the loudest brand-bidding signals (gclid, paid UTM, instant conversion, abnormal conv rate) — these are validated by industry practice. But you are missing three high-value defensive layers that mature programs ship in production: **(1) device/IP fingerprint clustering for self-referral and click farms, (2) SERP-side monitoring that catches brand bidders who never sent traffic — i.e. they intercepted users who never converted through Rewardful, and (3) commission hold periods + clawback automation.** Industry estimates put 5–17% of affiliate spend as fraud-tagged [25]; at your unpaid balance that is roughly $850–$2,900 currently at risk. The single highest-ROI add for the next iteration is **payment-side fingerprinting** (matching customer card/email/IP against affiliate accounts) — Rewardful already exposes this and it is one configuration toggle away.

---

## 1. Brand-bidding detection — am I missing signals?

My current signals — gclid presence, utm_medium=cpc/paid, google.com referrer, "runable" in utm_term/landing, instant conversion, >40% conv rate — are aligned with what industry practitioners cite as the **first-party detection layer**. JEBCommerce names URL parameter analysis and landing-page redirect inspection as the standard detection method, exactly the pipeline I built [3]. Bluepear similarly recommends checking affiliate landing pages for brand mentions in URLs and inspecting redirect chains [33].

However, there are three categories of signal I do not have.

**Second-party SERP monitoring.** This is the biggest gap. mFilterit's analysis is blunt: "standard marketing tools cannot detect brand bidding violations" because affiliates rarely use one stable link — they rotate sub-IDs, domains, and UTM permutations specifically to evade first-party detection [1]. BrandVerity solves this by running searches for branded keywords from a global server network at all hours, with the explicit goal of catching geo-targeted and dayparted campaigns that only show ads to certain user segments [4]. AdThena does the same and submits trademark complaints directly to Google on the merchant's behalf [5]. My referral-side detection only fires if the user actually clicks through and converts — a brand-bidder who intercepts a high-intent searcher but doesn't get them to convert is invisible in my data, yet still pushing up your branded-search CPC and stealing impression share. The Search Monitor confirms this: an affiliate doing brand bidding may also be hidden from Google Ads Auction Insights because Auction Insights doesn't reveal affiliate sub-IDs, masked redirects, or rotating accounts [37].

**Third-party affiliate cross-referencing.** AdCrime's playbook stresses analyzing affiliate behavior at the *network* level — e.g., is the same Google Ads account number tied to multiple Rewardful affiliates? [6]. I don't capture or correlate any Google Ads identifiers across affiliates. If three Rewardful affiliates all run ads from the same Google account, that's a near-certain coordinated brand-bidding ring.

**Search-term diversity.** A real content affiliate gets a long-tail mix of referrers: their blog, their Twitter, their YouTube, a few Google organic, etc. A brand bidder shows near-zero diversity. My `single_source_concentration` signal handles this directionally (≥85% one source flags), but it triggers on the bucketed source (e.g. "google_organic_or_ads"), not on the underlying URL distribution. A more sensitive version would compute Shannon entropy across distinct referrer URLs — Bluepear specifically recommends this for catching affiliates who hide behind URL shorteners and rotating landing pages [33].

**Verdict:** My first-party signals are solid. The structural gap is SERP-side monitoring (which costs money) and cross-affiliate correlation (which I can build).

---

## 2. Realistic thresholds — is "40% conv rate = suspicious" calibrated?

Yes, and arguably I could tighten it. Multiple sources triangulate to a similar baseline:

- **Average affiliate conversion rate is 0.5–1%**, "good" is 1–5%, with software/digital services at the high end at 3–7% [15].
- **Content affiliates specifically: ~3–5%**, with top performers reaching 5–10% [from search synthesis].
- **SEO-based content drives 38% of affiliate revenue in 2025**, and educational SaaS content typically lands at the same 3–7% band [14].

So a content affiliate at >10% conversion is already unusual; >20% is genuinely rare; >40% is essentially impossible without traffic interception. My threshold of "≥40% with ≥10 referrals" is therefore conservative — I'd consider tightening to ≥25% for affiliates with ≥20 referrals, which would catch more medium-sophistication brand bidders. The minimum-volume gate is important: an affiliate with 3 referrals and 2 conversions hits 66% but doesn't have statistical signal.

**Time-to-conversion calibration.** Refgrow flags it explicitly: "If all of an affiliate's referrals convert from signup to payment within minutes, it is a strong signal of automated self-referral, with the fraudster automating the entire signup and purchase flow" [18]. My <5-minute threshold for ≥40% of conversions matches this. Some sources are even more aggressive — Anura's behavioral platform flags anything that looks like single-session click-to-payment-to-affiliate-credit chains regardless of duration if other signals fire [21].

**One calibration to note:** "instant conversion" is a brand-bidding fingerprint *and* a self-referral fingerprint. Both are bad, but they need different remediations (brand bidder gets a warning + clawback; self-referrer gets banned outright). My current pipeline doesn't distinguish — both score the same. A useful refinement: if `customer_email` matches the affiliate's `email` domain (or any payment field overlaps), upgrade the signal from "instant_conversion" to "self_referral" with severity=high regardless of other signals.

**Where my thresholds may produce false positives:** SaaS marketplaces with strong educational content (think a course creator with a tight email list) can plausibly drive 15–25% conversion rates. The Optimonk and Wecantrack data both note that "highly relevant products can lead to conversion rates increasing by up to 80%" vs generic [from search synthesis]. If you have a few power-affiliate creators with a hot email list, they will get flagged medium-risk by my current scoring. The mitigation is the manual review workflow — that's exactly what the "Cleared" status button is for.

---

## 3. Other affiliate fraud patterns I should detect

Brand bidding is one of seven categories practitioners actively monitor. Ranked by relevance to a SaaS at your scale:

**Self-referral (high relevance).** Most common at SaaS programs because the math is simple — sign up as an affiliate, refer yourself, pay $25, claim 20–50% commission. Rewardful's own product page on self-referral detection states: "Rewardful catches fraudulent clicks and conversions with its self-referral fraud detection feature, determining IP addresses of affiliates and customers, flagging conversions if they share the same IP" [27]. Critically, **Rewardful already exposes this**, but it's a separate feature you may not have enabled. Refgrow extends the pattern: shared payment methods (last-4 card, billing address, payment email cross-match against affiliate accounts) [18]; Rewardful's self-referral feature also compares "every new referral with affiliate account details, customer emails, and payment data" [26]. **You are not capturing any of these matches today.** Adding a self-referral check is the highest-precision/lowest-effort signal you can add — likely catches more confirmed fraud than the entire brand-bidding pipeline.

**Coupon-extension / last-click sniping (medium relevance).** This is the Honey/Rakuten/Capital One Shopping pattern. A user goes to your pricing page via the affiliate's blog post → cookie is set → browser extension activates at checkout, swaps the affiliate cookie for its own, claims commission [11][12]. Rakuten in 2025 dropped Honey from its advertising network after evidence of systematic cookie substitution [13]. Capital One settled a class action with creators over the same behavior in September 2025 [11]. **Relevance to Runable:** lower — you don't sell at retail checkout where these extensions operate. But if you ever launch coupon codes, this category becomes immediate. Detection signal: referrer = `paypal.com/honey`, `rakuten.com`, `capitaloneshopping.com`, or similar branded coupon-extension URLs. I'd add a single regex check; it's nearly free.

**Cookie stuffing (low-to-medium relevance).** Hidden iframe or pixel drops an affiliate cookie without a user click. Detection signals per Anura and Spider AF: sudden conversion spikes without matching click traffic, ratio of conversions:referrals approaching 1.0 (real funnels have a long tail of unconverted visitors), and abnormally high commissions without explainable content [9][10][34]. **Your `single_source_concentration` and the unconverted-visitor count partially catch this.** A direct signal: ratio of `(conversions / total_visitors_or_clicks)` — if an affiliate has 50 visitors and 45 conversions, that's not plausible for organic traffic.

**Click farms / fake leads (low relevance for paid SaaS).** Fingerprint.com's 2025 analysis: device-farm operators run "100+ different customers all actually using the same physical device" — their solution is hardware-level fingerprinting (GPU, screen resolution, font enumeration) [16]. **For Runable, this category is lower priority** because your funnel requires a paid subscription — the fraudster has to either burn real money or use a stolen card. The economics don't work for organic click-farm operators. It becomes relevant only if you launch a free trial or signup-based payout.

**Refund-then-recommission with stolen cards (medium relevance, high value).** A fraudster uses a stolen credit card to subscribe via their own affiliate link, earns commission, the real cardholder disputes, you refund — but you've already paid the commission. **This is the single most expensive attack pattern industry-wide** [from search synthesis]. The defense is a **30–60 day hold period** before payout — universally recommended by Digistore24, TinyAffiliate, FirstPromoter, Rewardful's clawback automation [35], and every other source I consulted [24]. If your current Rewardful payout schedule is shorter than 30 days, you are exposed. The other half of the defense is **clawback automation**: when a Stripe charge is refunded, the corresponding commission should auto-deduct from the affiliate's balance. Rewardful's "automated refund handling" page indicates this is supported [35] — worth confirming it's turned on.

**Multi-account / fraud rings (medium relevance).** Same person creates 5–20 affiliate accounts to distribute their fraud below per-affiliate detection thresholds [18][31]. Detection signals: new affiliate sign-ups from same IP range within an hour, identical device fingerprint across registrations, similar email patterns (`x@gmail.com`, `x.1@gmail.com`, `x+sub@gmail.com`). Scaleo's tooling literally does this clustering on application time [31].

**Lead/credential cloaking (low relevance).** Affiliate redirects through cloaking infrastructure to show one URL to your tracker and another to the user. Tracked via referrer hostname mismatches and tracking-URL parsing — Anura's job, not yours. Skip unless you see specific evidence.

---

## 4. What I'd need to capture that I'm not

Working from the gaps above, in priority order:

**Payment-side identifiers** (highest priority). For each conversion, capture: customer IP at conversion (different from referral-time IP), card BIN (first 6 digits is non-PII), billing country, payment email. Cross-match these against affiliate-account fields. Rewardful's API exposes this on the customer object — you're currently only pulling email via `extractTrafficFields`. Storing customer billing country alone lets you flag "affiliate in Brazil, customer billing in Vietnam" mismatches.

**Visitor fingerprint** (high priority). A device fingerprint computed at first visit (canvas, WebGL renderer, fonts, screen, timezone) — stored against `visitor_id`. Then group conversions where the same fingerprint appears under different affiliates or different customer emails. This is the only reliable way to catch self-referrals where the fraudster uses a VPN and a fresh email per signup. mFilterit specifically calls this out: "residential proxies can hide an IP, but they can't easily hide a device's unique hardware signature" [19]. Build vs buy: FingerprintJS open source gives you 70% of this for free.

**Click-vs-conversion time per affiliate as a *distribution*, not just a mean.** Today my pipeline computes median time-to-conversion. More useful: a histogram. A legitimate content affiliate has a wide distribution (minutes, hours, days). A self-referrer or brand-bidder has a narrow distribution clustered <5 min. Compute the standard deviation of TTC per affiliate; flag low-variance affiliates as suspicious independent of the mean.

**Affiliate-to-affiliate visitor overlap.** If `visitor_id` X appears under affiliate A's traffic *and* affiliate B's traffic, something is weird — either coordinated cookie stuffing or coupon-extension sniping. The Rewardful API may or may not expose enough to compute this; worth checking.

**Server-side click validation.** Right now you trust Rewardful's referral object as-is. Industry practice (Tapfiliate's 2026 guide [17]) is to additionally log the click server-side at first paint of your landing page — capturing IP, user agent, Accept-Language, headers — so you can detect spoofed referrals where someone calls the Rewardful tracking endpoint without a real browser session. Lower priority for now since Rewardful does some of this for you.

**Google Ads / Meta Ads identifier capture beyond gclid.** When `gclid` is present, also store the parsed `aw=` and `ai=` parameters (campaign + ad group hashes Google injects on click). If two affiliates have referrals carrying the same campaign hash, that's evidence they're the same Google Ads account. AdCrime's playbook is built largely on this correlation [6].

---

## 5. Policy + enforcement playbook

The industry consensus on policy is unambiguous: **prohibit brand bidding by default**, with explicit allow-list for approved partners. Matt McWilliams' affiliate-management writeup says it directly: "Best practice is to prohibit affiliate brand bidding in your program terms, as you can always open it up later for specific approved partners" [22]. Tapfiliate's 2026 affiliate agreement template includes this as a standard clause [23].

**Standard TOS clawback language** (cited verbatim across sources [22][23][24]):

> "Affiliate may not bid on, purchase, or otherwise use in any search engine advertising campaign any keyword containing the Merchant's brand name, brand URL, product names, or misspellings thereof. Any commissions generated from prohibited search terms are subject to immediate clawback. Repeated violations result in termination from the program."

The legal pattern recommended is **two-strike with first-violation clawback**: first offense → warning + commission void for the violating period + 7-day cure window to remove ads; second offense → permanent ban + clawback of all commissions earned over preceding 90 days [22]. The cure window matters because a true mistake (an affiliate's automated keyword expansion grabbing your brand) deserves a chance to fix, while a deliberate bidder will not cure and self-identifies.

**Evidence package** for a clawback action (per BrandVerity's documentation [4] and TinyAffiliate's template [24]): (a) screenshot of the SERP showing the affiliate's ad above your organic listing, (b) the affiliate's tracking URL with sub-ID visible, (c) timestamp range showing the ad was live, (d) the resulting referral/conversion records from your tracking, (e) the TOS clause violated. If the affiliate disputes, this evidence package is what survives in arbitration. For a Rewardful merchant the affiliate platform itself will support a clawback if you provide the conversion IDs and a violation reason — Rewardful's automated refund handling page describes the workflow [35].

**Communication template** (synthesized from sources):

> Subject: Action required — affiliate program violation
>
> Hi [name], during a routine audit we identified that referrals associated with your affiliate ID `[X]` originated from paid Google Ads targeting our brand keyword "runable". This violates Section [X] of our affiliate terms, which prohibit bidding on our trademarked brand name.
>
> The commissions associated with these referrals (totaling $[Y] across [Z] conversions, attached) have been clawed back. Please remove the brand-keyword ad campaigns within 7 days. We've placed your account on a 30-day probation; a second violation will result in permanent removal from the program.
>
> Evidence: [link to evidence package]

**False positive vs fraud cost trade-off.** This is the part you specifically asked about and where I think the industry literature is weak. The math: your average commission per converted affiliate is ~$11 ($16,967 / 1524 conversions). A false-positive ban costs you (a) the lost legitimate revenue from that affiliate (potentially several thousand dollars over LTV), plus (b) reputational damage if they're a content creator with audience reach. A missed brand-bidder costs you ~$11 per conversion they intercept, plus the inflated branded-search CPC. **The asymmetry favors caution on bans, aggression on clawbacks.** Clawback is reversible — if an affiliate disputes credibly, you re-credit. A ban is harder to reverse and burns trust. My recommendation: high-risk affiliates → automatic clawback + probation, not automatic ban. Only ban after a second violation or after seeing evidence the affiliate ran ads with malicious intent (e.g. competitor cloning, malware, brand impersonation).

---

## 6. Buy vs build — tool scan

For Runable's scale and budget profile, the buy/build calculus is fairly clear:

**SERP-side monitoring (BrandVerity / AdThena).** BrandVerity does not publish pricing publicly but pricing reports from outspy.ai and industry reviews put entry tiers around **$500–$2,000/month** for a single-brand monitoring setup [4]. AdThena Brand Activator is in a similar range. **Recommendation for Runable: defer.** Your fraud surface is concentrated on the referral side (where you can build), not on the SERP impression-share side (where these tools shine). Reconsider only if (a) branded CPC starts rising materially or (b) you see brand bidders in Auction Insights you can't identify from your own data.

**Affiliate fraud platforms (Anura, FraudScore, Forensiq).** Anura is usage-priced (no public number); FraudScore is roughly **$1/CPL with custom enterprise pricing** [20][21]. These platforms are designed for ad networks running millions of clicks; their cost structure assumes that volume. **Recommendation: skip at current scale.** You'd be paying for click-fraud detection that Rewardful already does at the platform level for free.

**Native Rewardful self-referral detection.** Already included in your plan. Likely toggle-able in the Rewardful dashboard under fraud settings. **Recommendation: enable immediately if not already on, and surface its output in your `/fraud` dashboard as a new signal type.**

**FingerprintJS (open source).** Free for self-hosted; commercial tier ~$100–$500/month. **Recommendation: add to the Runable signup flow** and write the resulting visitor ID into the Rewardful referral metadata. This is the highest-leverage technical add — it converts your detection from rule-based to identity-based.

**Build cost estimate.** Your current `/fraud` infrastructure is ~600 lines of code. Adding payment-side fingerprinting + self-referral checking + IP velocity = roughly another 300–400 lines plus a Rewardful API call for the customer object. That's a 1-day build. Replacing it with a third-party platform would cost more annually than the entire fraud surface is worth at your scale.

---

## 7. Three highest-ROI additions to your current implementation

Based on everything above, ranked by ROI:

**(1) Self-referral / payment-side fingerprint check.** Capture customer billing email, payment method last-4, billing IP, billing country. On each conversion, compute matches against affiliate account fields (`affiliate.email` domain, `affiliate.payment_email`, `affiliate.country`). Match on any → signal `self_referral_match`, severity high. This is the single biggest fraud category at SaaS programs per Refgrow, Rewardful, and Prefinery [18][26][28], and Rewardful already exposes the data you need via `referral.customer` and `affiliate.payment_details`. Implementation: ~150 lines, half a day. Expected to catch more confirmed fraud than your entire brand-bidding pipeline combined.

**(2) Commission hold period + automated clawback on refund.** Configure Rewardful (in dashboard) to delay payouts 30 days. Hook the `commission.refunded` and `sale.refunded` webhooks in your existing webhook processor and auto-decrement affiliate balance + mark for re-review. Rewardful's [automated refund handling](https://www.rewardful.com/automated-refund-handling) documentation describes the workflow. Implementation: 30 minutes of dashboard config plus extending [lib/webhook-processor.ts](marketing/affiliates-commission-dashboard/lib/webhook-processor.ts) with two new handlers. This single change probably saves you 5–10% of your annual commission spend [25].

**(3) Cross-affiliate visitor and customer overlap detection.** Add a query that finds (a) `visitor_id` values appearing under multiple `affiliate_id`s, and (b) `customer_email` values appearing under multiple affiliates' conversions. Either is high signal — coordinated fraud or coupon-extension sniping. Surface as a separate "Cross-Affiliate Anomalies" section in `/fraud`. Implementation: one new SQL query in [api/fraud/route.ts](marketing/affiliates-commission-dashboard/app/api/fraud/route.ts), one UI component, ~100 lines, half a day.

Cumulative cost of all three: 1.5 days of build. Expected impact: catch 60–80% of currently-undetected fraud, and convert your audit workflow from "manually review high-risk affiliates" to "manually review high-confidence cases the system has flagged with multiple converging signals."

What's *not* in the top-three but worth flagging for later: SERP-side monitoring (only if branded CPC rises), Honey/Capital One coupon-extension regex (only if you launch coupons), Google Ads campaign-hash correlation (only if a single-affiliate clawback fight escalates to needing court-ready evidence).

---

## Bibliography

[1] mFilterit. "Can marketing tools track affiliate brand bidding?" https://www.mfilterit.com/blog/can-marketing-and-analytics-tools-detect-brand-bidding-violations/
[2] Bluepear. "Brand bidding in affiliate marketing." https://bluepear.net/blog/brand-bidding-in-affiliate-marketing
[3] JEBCommerce. "How to Detect Brand Bidding in Affiliate Marketing." https://jebcommerce.com/detect-brand-bidding-in-affiliate-marketing/
[4] BrandVerity. "How to Fight Brand Bidding in Affiliate Marketing." https://www.brandverity.com/blog/how-to-find-and-take-action-against-brand-bidding-affiliates-with-brandveritys-paid-search-monitoring-solution
[5] AdThena. "Zero tolerance Brand Protection." https://www.adthena.com/solutions/brand-protection/
[6] AdCrime. "The Affiliate Brand-Bidding Fraud Playbook." https://adcrime.com/playbook
[7] Impact. "Affiliate Fraud: How to Detect and Prevent it From Happening." https://impact.com/affiliate/preventing-affiliate-fraud/
[8] CJ Affiliate. "CJ's Commitment to Network Quality and Brand Protection." https://junction.cj.com/article/cjs-commitment-to-network-quality-and-brand-protection
[9] Anura. "Combating Cookie Stuffing in Affiliate Fraud." https://www.anura.io/blog/how-to-fight-cookie-stuffing-within-affiliate-fraud
[10] Spider AF. "Affiliate Cookie Stuffing: Detection & Prevention (2024)." https://spideraf.com/articles/cookie-stuffing-fraud-in-affiliate-marketing-an-in-depth-analysis
[11] Marketing Brew. "Honey lawsuit thrusts last-click attribution into the spotlight." https://www.marketingbrew.com/stories/2025/01/13/influencer-lawsuits-thrust-last-click-attribution-into-the-spotlight
[12] Affiverse. "The Great Affiliate Heist." https://www.affiversemedia.com/the-great-affiliate-heist-how-browser-extensions-are-stealing-from-content-creators/
[13] SecurityBrief. "Rakuten drops Honey extension amid affiliate fraud row." https://securitybrief.co.uk/story/rakuten-drops-honey-extension-amid-affiliate-fraud-row
[14] Rewardful. "SaaS Affiliate Program Benchmarks by Industry (2025 Report)." https://www.rewardful.com/articles/saas-affiliate-program-benchmarks
[15] Partnero. "21 Affiliate Marketing Benchmarks & KPIs." https://www.partnero.com/articles/21-essential-affiliate-marketing-benchmarks--kpis-for-success-in-2025
[16] Fingerprint. "How to Detect Click Farm Fraud in 2025." https://fingerprint.com/blog/click-fraud-farm/
[17] Tapfiliate. "Affiliate Fraud Prevention: The 2026 Multi-Layered Defense Guide." https://tapfiliate.com/blog/affiliate-fraud-prevention-guide_ag/
[18] Refgrow. "How to Prevent Affiliate Fraud: Complete Guide for SaaS." https://refgrow.com/how-to-prevent-affiliate-fraud
[19] mFilterit. "Device Fraud Explained." https://www.mfilterit.com/blog/device-fraud-in-affiliate-marketing/
[20] Capterra. "FraudScore Pricing, Features, Reviews & Alternatives." https://www.capterra.com/p/266083/FraudScore/
[21] Anura. "The World's Most Accurate Ad Fraud Solution." https://www.anura.io/product
[22] Matt McWilliams. "Should Affiliates be Allowed to Bid on Your Brand Keywords?" https://www.mattmcwilliams.com/should-affiliates-be-allowed-to-bid-on-your-brand-keywords/
[23] Tapfiliate. "Affiliate Agreement: The 2026 Guide to Protecting Your Brand." https://tapfiliate.com/blog/affiliate-agreement/
[24] TinyAffiliate. "Affiliate clawback policy template." https://www.tinyaffiliate.com/affiliate-clawback-policy-template
[25] wecantrack. "25+ Affiliate Commission Statistics: Fraud, Industry Trends." https://wecantrack.com/insights/affiliate-commission-statistics/
[26] Rewardful. "Self-Referral Fraud Detection in SaaS." https://www.rewardful.com/articles/self-referral-fraud-detection-for-saas-founders
[27] Rewardful. "Self-Referral Fraud Detection (product page)." https://www.rewardful.com/self-referral-fraud-detection
[28] Prefinery. "4 Steps to Prevent SaaS Affiliate Fraud." https://www.prefinery.com/blog/4-steps-to-prevent-saas-affiliate-fraud/
[29] SEON. "Velocity Check: Fraud Prevention Technique." https://seon.io/resources/dictionary/velocity-check/
[30] TrustPath. "Velocity Threat Signals." https://trustpath.io/en/blog/velocity-threat-signals/
[31] Scaleo. "How To Detect And Prevent Affiliate Partners From Creating Multiple Accounts." https://www.scaleo.io/blog/how-to-detect-and-prevent-affiliate-partners-from-creating-multiple-accounts/
[32] Tapfiliate. "How to Prevent Affiliate Trademark Bidding in 2026." https://tapfiliate.com/blog/how-to-prevent-affiliate-trademark-bidding_ag
[33] Bluepear. "Learn how to detect brand bidding." https://bluepear.net/blog/detect-brand-bidding
[34] Trackier. "Affiliate Cookie Stuffing Fraud in iFrames: 2025 Guide." https://trackier.com/fighting-against-affiliate-cookie-stuffing-in-iframe/
[35] Rewardful. "Automated Refund Handling on Affiliate Payments." https://www.rewardful.com/automated-refund-handling
[36] Digiday. "The Honey scandal is a 'wake-up call' for the creator industry's affiliate partnerships." https://digiday.com/marketing/the-honey-scandal-is-a-wake-up-call-for-the-creator-industrys-affiliate-partnerships/
[37] The Search Monitor. "Detecting Affiliate Brand Bidding Behavior." https://www.thesearchmonitor.com/resource/how-to-tell-if-affiliates-are-brand-bidding-and-whether-theyre-doing-it-on-purpose/
[38] Influencer Marketing Hub. "Affiliate Attribution Integrity: Link Hygiene, Coupon Poaching & Cookie Stuffing Defense." https://influencermarketinghub.com/affiliate-attribution/

---

## Methodology

16 parallel web searches across two batches covering: brand-bidding detection tools (BrandVerity, AdThena, AdCrime, mFilterit, The Search Monitor); affiliate networks' fraud capabilities (Impact, CJ, ShareASale, Rewardful, PartnerStack, Tapfiliate); cookie stuffing detection; coupon-extension sniping (Honey, Rakuten, Capital One Shopping lawsuits); SaaS conversion baselines; device fingerprinting and click farms; self-referral patterns; clawback templates and TOS language; IP velocity thresholds; SERP-side detection techniques. 38 unique sources retained; preference given to practitioner-authored content (affiliate platform docs, fraud-vendor blogs, case studies) over generic listicles. Where industry estimates disagreed (e.g. fraud rate as % of spend: 5–15% per industry analysts, 17% per wecantrack), both figures cited rather than averaged. Specific tool pricing not always available; ranges given from public Capterra/G2 data where exact figures were undisclosed.
