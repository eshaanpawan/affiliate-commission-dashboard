import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

// One-shot migration endpoint — applies all idempotent ALTER TABLE IF NOT EXISTS
// statements to whatever Neon DB the deployed function is connected to. Mirrors
// scripts/migrate.ts so we don't need to expose prod credentials locally.
//
// Auth: Authorization: Bearer ${CRON_SECRET}

export async function POST(req: NextRequest) {
  const authToken = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || authToken !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const applied: string[] = [];
  const skipped: { stmt: string; error: string }[] = [];

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      applied.push(label);
    } catch (e) {
      skipped.push({ stmt: label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Tables
  await run('webhook_events table', () => sql`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT UNIQUE, event_type TEXT NOT NULL, payload JSONB NOT NULL,
      received_at TIMESTAMPTZ DEFAULT NOW(), processed BOOLEAN DEFAULT FALSE,
      processing_started_at TIMESTAMPTZ, processed_at TIMESTAMPTZ,
      processing_error TEXT, attempt_count INT NOT NULL DEFAULT 0
    )`);
  await run('webhook_events processed default', () => sql`ALTER TABLE webhook_events ALTER COLUMN processed SET DEFAULT FALSE`);
  await run('webhook_events processing_started_at', () => sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ`);
  await run('webhook_events processed_at', () => sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ`);
  await run('webhook_events processing_error', () => sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processing_error TEXT`);
  await run('webhook_events attempt_count', () => sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0`);
  await run('affiliates table', () => sql`
    CREATE TABLE IF NOT EXISTS affiliates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL, first_name TEXT, last_name TEXT, email TEXT,
      status TEXT DEFAULT 'active', created_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      visitors INT DEFAULT 0, leads INT DEFAULT 0, conversions INT DEFAULT 0
    )`);
  await run('referrals table', () => sql`
    CREATE TABLE IF NOT EXISTS referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL, affiliate_id TEXT, link_id TEXT, link_token TEXT,
      status TEXT DEFAULT 'lead', created_at TIMESTAMPTZ, converted_at TIMESTAMPTZ
    )`);
  await run('sales table', () => sql`
    CREATE TABLE IF NOT EXISTS sales (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL, affiliate_id TEXT, referral_id TEXT,
      amount_cents INT DEFAULT 0, currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'created', created_at TIMESTAMPTZ
    )`);
  await run('commissions table', () => sql`
    CREATE TABLE IF NOT EXISTS commissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL, affiliate_id TEXT, sale_id TEXT,
      amount_cents INT DEFAULT 0, currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'created', created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ
    )`);
  await run('payouts table', () => sql`
    CREATE TABLE IF NOT EXISTS payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL, affiliate_id TEXT,
      amount_cents INT DEFAULT 0, currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'created', created_at TIMESTAMPTZ, paid_at TIMESTAMPTZ
    )`);

  // Affiliates: commission stats + fraud review state
  await run('affiliates.visitors', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS visitors INT DEFAULT 0`);
  await run('affiliates.leads', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS leads INT DEFAULT 0`);
  await run('affiliates.conversions', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS conversions INT DEFAULT 0`);
  await run('affiliates.unpaid_commission_cents', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS unpaid_commission_cents INT DEFAULT 0`);
  await run('affiliates.paid_commission_cents', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS paid_commission_cents INT DEFAULT 0`);
  await run('affiliates.gross_revenue_cents', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS gross_revenue_cents INT DEFAULT 0`);
  await run('affiliates.review_status', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'unreviewed'`);
  await run('affiliates.review_notes', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS review_notes TEXT`);
  await run('affiliates.reviewed_at', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
  await run('affiliates.known_url', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS known_url TEXT`);
  await run('affiliates.risk_score', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS risk_score INT`);
  await run('affiliates.risk_signals', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS risk_signals JSONB`);
  await run('affiliates.risk_updated_at', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS risk_updated_at TIMESTAMPTZ`);
  await run('affiliates.fraud_tags', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS fraud_tags JSONB DEFAULT '[]'::jsonb`);

  // Referrals: link tracking, country (PostHog enrichment), fraud signal capture
  await run('referrals.link_id', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS link_id TEXT`);
  await run('referrals.link_token', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS link_token TEXT`);
  await run('referrals.country_code', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_code TEXT`);
  await run('referrals.country_name', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_name TEXT`);
  await run('referrals.customer_email', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS customer_email TEXT`);
  await run('referrals.became_lead_at', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS became_lead_at TIMESTAMPTZ`);
  await run('referrals.visitor_id', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS visitor_id TEXT`);
  await run('referrals.customer_id', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS customer_id TEXT`);
  await run('referrals.referrer', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referrer TEXT`);
  await run('referrals.landing_page', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS landing_page TEXT`);
  await run('referrals.utm_source', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_source TEXT`);
  await run('referrals.utm_medium', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_medium TEXT`);
  await run('referrals.utm_campaign', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_campaign TEXT`);
  await run('referrals.utm_term', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_term TEXT`);
  await run('referrals.utm_content', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_content TEXT`);
  await run('referrals.gclid', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS gclid TEXT`);
  await run('referrals.fbclid', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS fbclid TEXT`);
  await run('referrals.raw_payload', () => sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS raw_payload JSONB`);

  // Indexes
  await run('idx_referrals_affiliate_id', () => sql`CREATE INDEX IF NOT EXISTS idx_referrals_affiliate_id ON referrals (affiliate_id)`);
  await run('idx_referrals_created_at', () => sql`CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON referrals (created_at)`);
  await run('idx_affiliates_review_status', () => sql`CREATE INDEX IF NOT EXISTS idx_affiliates_review_status ON affiliates (review_status)`);
  await run('idx_affiliates_risk_score', () => sql`CREATE INDEX IF NOT EXISTS idx_affiliates_risk_score ON affiliates (risk_score)`);

  // Ad-detection ground truth from PostHog (per token, per day)
  await run('affiliate_traffic table', () => sql`
    CREATE TABLE IF NOT EXISTS affiliate_traffic (
      via_token TEXT NOT NULL,
      day DATE NOT NULL,
      signups INT DEFAULT 0,
      signups_with_gclid INT DEFAULT 0,
      signups_with_gbraid INT DEFAULT 0,
      signups_with_gad_campaignid INT DEFAULT 0,
      signups_with_google INT DEFAULT 0,
      signups_with_meta INT DEFAULT 0,
      signups_with_microsoft INT DEFAULT 0,
      signups_with_tiktok INT DEFAULT 0,
      signups_with_linkedin INT DEFAULT 0,
      signups_with_reddit INT DEFAULT 0,
      signups_with_x INT DEFAULT 0,
      signups_with_apple INT DEFAULT 0,
      signups_with_any_ad_param INT DEFAULT 0,
      fts INT DEFAULT 0,
      pageviews INT DEFAULT 0,
      campaign_ids TEXT[] DEFAULT '{}',
      campaign_ids_ours TEXT[] DEFAULT '{}',
      synced_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (via_token, day)
    )`);
  await run('affiliate_traffic.signups_with_google', () => sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_google INT DEFAULT 0`);
  await run('affiliate_traffic.signups_with_meta', () => sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_meta INT DEFAULT 0`);
  await run('affiliate_traffic.signups_with_microsoft', () => sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_microsoft INT DEFAULT 0`);
  await run('affiliate_traffic.signups_with_tiktok', () => sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_tiktok INT DEFAULT 0`);
  await run('affiliate_traffic.signups_with_linkedin', () => sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_linkedin INT DEFAULT 0`);
  await run('affiliate_traffic.signups_with_reddit', () => sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_reddit INT DEFAULT 0`);
  await run('affiliate_traffic.signups_with_x', () => sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_x INT DEFAULT 0`);
  await run('affiliate_traffic.signups_with_apple', () => sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_apple INT DEFAULT 0`);
  await run('idx_affiliate_traffic_day', () => sql`CREATE INDEX IF NOT EXISTS idx_affiliate_traffic_day ON affiliate_traffic (day)`);

  // Enforcement (staged bans, applied to Rewardful only via explicit bulk action)
  await run('affiliates.enforcement_state', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS enforcement_state TEXT DEFAULT 'none'`);
  await run('affiliates.enforcement_reason', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS enforcement_reason TEXT`);
  await run('affiliates.enforcement_proposed_at', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS enforcement_proposed_at TIMESTAMPTZ`);
  await run('affiliates.enforcement_applied_at', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS enforcement_applied_at TIMESTAMPTZ`);
  await run('affiliates.rewardful_state_before', () => sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS rewardful_state_before TEXT`);
  await run('idx_affiliates_enforcement', () => sql`CREATE INDEX IF NOT EXISTS idx_affiliates_enforcement ON affiliates (enforcement_state)`);

  await run('enforcement_log table', () => sql`
    CREATE TABLE IF NOT EXISTS enforcement_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT DEFAULT 'dashboard',
      payload JSONB,
      result TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await run('idx_enforcement_log_affiliate', () => sql`CREATE INDEX IF NOT EXISTS idx_enforcement_log_affiliate ON enforcement_log (affiliate_id)`);

  // Commission freeze / payout review
  await run('commission_holds table', () => sql`
    CREATE TABLE IF NOT EXISTS commission_holds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id TEXT UNIQUE NOT NULL,
      amount_cents INT DEFAULT 0,
      reason TEXT,
      status TEXT DEFAULT 'held',
      decided_by TEXT,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

  // Rewardful -> Instantly outreach reconciliation
  await run('outreach_contacts table', () => sql`
    CREATE TABLE IF NOT EXISTS outreach_contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      email TEXT NOT NULL,
      instantly_lead_id TEXT,
      segment TEXT NOT NULL DEFAULT 'onboarding',
      source_updated_at TIMESTAMPTZ,
      payload_hash TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      sync_attempts INT NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ,
      last_synced_at TIMESTAMPTZ,
      suppressed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (affiliate_id, campaign_id)
    )`);
  await run('outreach_contacts sync_attempts', () => sql`ALTER TABLE outreach_contacts ADD COLUMN IF NOT EXISTS sync_attempts INT NOT NULL DEFAULT 0`);
  await run('outreach_contacts next_attempt_at', () => sql`ALTER TABLE outreach_contacts ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ`);
  await run('idx_outreach_contacts_status', () => sql`CREATE INDEX IF NOT EXISTS idx_outreach_contacts_status ON outreach_contacts (sync_status)`);
  await run('idx_outreach_contacts_email', () => sql`CREATE INDEX IF NOT EXISTS idx_outreach_contacts_email ON outreach_contacts (email)`);
  await run('uq_outreach_contacts_campaign_email', () => sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_contacts_campaign_email ON outreach_contacts (campaign_id, LOWER(email))`);

  await run('outreach_events table', () => sql`
    CREATE TABLE IF NOT EXISTS outreach_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id TEXT,
      campaign_id TEXT,
      event_type TEXT NOT NULL,
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await run('idx_outreach_events_campaign', () => sql`CREATE INDEX IF NOT EXISTS idx_outreach_events_campaign ON outreach_events (campaign_id)`);
  await run('idx_outreach_events_created_at', () => sql`CREATE INDEX IF NOT EXISTS idx_outreach_events_created_at ON outreach_events (created_at)`);

  // NOTE: migrate.ts also has an `UPDATE commissions ... FROM sales` data-repair
  // statement. It is intentionally NOT mirrored here — commissions.sale_id is NULL
  // on legacy rows so it matches 0 rows; the real fix is
  // scripts/backfill-commission-affiliates.ts (re-fetches from the Rewardful API).
  await run('idx_commissions_affiliate_id', () => sql`CREATE INDEX IF NOT EXISTS idx_commissions_affiliate_id ON commissions (affiliate_id)`);

  return NextResponse.json({
    ok: true,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    applied,
    skipped,
  });
}
