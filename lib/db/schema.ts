// Drizzle schema — single source of truth for the database.
// Matches the live Neon schema created by scripts/migrate.ts; new tables and
// columns are added here first and pushed with `npx drizzle-kit push`.

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: text('event_id').unique(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow(),
  processed: boolean('processed').default(false),
  processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingError: text('processing_error'),
  attemptCount: integer('attempt_count').default(0).notNull(),
});

export const affiliates = pgTable('affiliates', {
  id: uuid('id').primaryKey().defaultRandom(),
  rewardfulId: text('rewardful_id').unique().notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  visitors: integer('visitors').default(0),
  leads: integer('leads').default(0),
  conversions: integer('conversions').default(0),
  unpaidCommissionCents: integer('unpaid_commission_cents').default(0),
  paidCommissionCents: integer('paid_commission_cents').default(0),
  grossRevenueCents: integer('gross_revenue_cents').default(0),
  reviewStatus: text('review_status').default('unreviewed'),
  reviewNotes: text('review_notes'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  knownUrl: text('known_url'),
  riskScore: integer('risk_score'),
  riskSignals: jsonb('risk_signals'),
  riskUpdatedAt: timestamp('risk_updated_at', { withTimezone: true }),
  fraudTags: jsonb('fraud_tags').default([]),
  enforcementState: text('enforcement_state').default('none'),
  enforcementReason: text('enforcement_reason'),
  enforcementProposedAt: timestamp('enforcement_proposed_at', { withTimezone: true }),
  enforcementAppliedAt: timestamp('enforcement_applied_at', { withTimezone: true }),
  rewardfulStateBefore: text('rewardful_state_before'),
}, (t) => [
  index('idx_affiliates_review_status').on(t.reviewStatus),
  index('idx_affiliates_risk_score').on(t.riskScore),
  index('idx_affiliates_enforcement').on(t.enforcementState),
]);

export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  rewardfulId: text('rewardful_id').unique().notNull(),
  affiliateId: text('affiliate_id'),
  linkId: text('link_id'),
  linkToken: text('link_token'),
  status: text('status').default('lead'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  becameLeadAt: timestamp('became_lead_at', { withTimezone: true }),
  countryCode: text('country_code'),
  countryName: text('country_name'),
  customerEmail: text('customer_email'),
  customerId: text('customer_id'),
  visitorId: text('visitor_id'),
  referrer: text('referrer'),
  landingPage: text('landing_page'),
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  utmTerm: text('utm_term'),
  utmContent: text('utm_content'),
  gclid: text('gclid'),
  fbclid: text('fbclid'),
  rawPayload: jsonb('raw_payload'),
}, (t) => [
  index('idx_referrals_affiliate_id').on(t.affiliateId),
  index('idx_referrals_created_at').on(t.createdAt),
]);

export const sales = pgTable('sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  rewardfulId: text('rewardful_id').unique().notNull(),
  affiliateId: text('affiliate_id'),
  referralId: text('referral_id'),
  amountCents: integer('amount_cents').default(0),
  currency: text('currency').default('usd'),
  status: text('status').default('created'),
  createdAt: timestamp('created_at', { withTimezone: true }),
});

export const commissions = pgTable('commissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  rewardfulId: text('rewardful_id').unique().notNull(),
  affiliateId: text('affiliate_id'),
  saleId: text('sale_id'),
  amountCents: integer('amount_cents').default(0),
  currency: text('currency').default('usd'),
  status: text('status').default('created'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
}, (t) => [
  index('idx_commissions_affiliate_id').on(t.affiliateId),
]);

export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  rewardfulId: text('rewardful_id').unique().notNull(),
  affiliateId: text('affiliate_id'),
  amountCents: integer('amount_cents').default(0),
  currency: text('currency').default('usd'),
  status: text('status').default('created'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

/** Ad-detection ground truth from PostHog, per (via_token, day). */
export const affiliateTraffic = pgTable('affiliate_traffic', {
  viaToken: text('via_token').notNull(),
  day: date('day').notNull(),
  signups: integer('signups').default(0),
  signupsWithGclid: integer('signups_with_gclid').default(0),
  signupsWithGbraid: integer('signups_with_gbraid').default(0),
  signupsWithGadCampaignid: integer('signups_with_gad_campaignid').default(0),
  signupsWithGoogle: integer('signups_with_google').default(0),
  signupsWithMeta: integer('signups_with_meta').default(0),
  signupsWithMicrosoft: integer('signups_with_microsoft').default(0),
  signupsWithTiktok: integer('signups_with_tiktok').default(0),
  signupsWithLinkedin: integer('signups_with_linkedin').default(0),
  signupsWithReddit: integer('signups_with_reddit').default(0),
  signupsWithX: integer('signups_with_x').default(0),
  signupsWithApple: integer('signups_with_apple').default(0),
  signupsWithAnyAdParam: integer('signups_with_any_ad_param').default(0),
  fts: integer('fts').default(0),
  pageviews: integer('pageviews').default(0),
  campaignIds: text('campaign_ids').array().default([]),
  campaignIdsOurs: text('campaign_ids_ours').array().default([]),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.viaToken, t.day] }),
  index('idx_affiliate_traffic_day').on(t.day),
]);

/** Audit trail — every enforcement action ever taken, applied or not. */
export const enforcementLog = pgTable('enforcement_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: text('affiliate_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').default('dashboard'),
  payload: jsonb('payload'),
  result: text('result'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_enforcement_log_affiliate').on(t.affiliateId),
]);

/** Frozen commissions pending a payout-review decision. */
export const commissionHolds = pgTable('commission_holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: text('affiliate_id').unique().notNull(),
  amountCents: integer('amount_cents').default(0),
  reason: text('reason'),
  status: text('status').default('held'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/** Durable Rewardful -> Instantly contact mapping and reconciliation state. */
export const outreachContacts = pgTable('outreach_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: text('affiliate_id').notNull(),
  campaignId: text('campaign_id').notNull(),
  email: text('email').notNull(),
  instantlyLeadId: text('instantly_lead_id'),
  segment: text('segment').default('onboarding').notNull(),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
  payloadHash: text('payload_hash'),
  syncStatus: text('sync_status').default('pending').notNull(),
  syncError: text('sync_error'),
  syncAttempts: integer('sync_attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('uq_outreach_contact_affiliate_campaign').on(t.affiliateId, t.campaignId),
  index('idx_outreach_contacts_status').on(t.syncStatus),
  index('idx_outreach_contacts_email').on(t.email),
]);

/** Append-only audit trail for imports, configuration changes, and mail actions. */
export const outreachEvents = pgTable('outreach_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: text('affiliate_id'),
  campaignId: text('campaign_id'),
  eventType: text('event_type').notNull(),
  externalId: text('external_id'),
  status: text('status').default('ok').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_outreach_events_campaign').on(t.campaignId),
  index('idx_outreach_events_created_at').on(t.createdAt),
]);
