import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const sql = neon(process.env.NEON_DATABASE_URL!);

async function migrate() {
  console.log('Running migrations...');

  await sql`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      received_at TIMESTAMPTZ DEFAULT NOW(),
      processed BOOLEAN DEFAULT FALSE,
      processing_started_at TIMESTAMPTZ,
      processed_at TIMESTAMPTZ,
      processing_error TEXT,
      attempt_count INT NOT NULL DEFAULT 0
    )
  `;

  await sql`ALTER TABLE webhook_events ALTER COLUMN processed SET DEFAULT FALSE`;
  await sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processing_error TEXT`;
  await sql`ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0`;

  await sql`
    CREATE TABLE IF NOT EXISTS affiliates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      visitors INT DEFAULT 0,
      leads INT DEFAULT 0,
      conversions INT DEFAULT 0
    )
  `;

  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS visitors INT DEFAULT 0`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS leads INT DEFAULT 0`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS conversions INT DEFAULT 0`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS unpaid_commission_cents INT DEFAULT 0`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS paid_commission_cents INT DEFAULT 0`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS gross_revenue_cents INT DEFAULT 0`;

  await sql`
    CREATE TABLE IF NOT EXISTS referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL,
      affiliate_id TEXT,
      link_id TEXT,
      link_token TEXT,
      status TEXT DEFAULT 'lead',
      created_at TIMESTAMPTZ,
      converted_at TIMESTAMPTZ
    )
  `;

  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS link_id TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS link_token TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_code TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS country_name TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS customer_email TEXT`;

  // Brand-bidding / fraud detection: capture traffic source attribution
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS became_lead_at TIMESTAMPTZ`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS visitor_id TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS customer_email TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS customer_id TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referrer TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS landing_page TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_source TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_medium TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_campaign TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_term TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS utm_content TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS gclid TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS fbclid TEXT`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS raw_payload JSONB`;

  // Affiliate manual-review state for fraud workflow
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'unreviewed'`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS review_notes TEXT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS known_url TEXT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS risk_score INT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS risk_signals JSONB`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS risk_updated_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS fraud_tags JSONB DEFAULT '[]'::jsonb`;

  await sql`CREATE INDEX IF NOT EXISTS idx_referrals_affiliate_id ON referrals (affiliate_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON referrals (created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_affiliates_review_status ON affiliates (review_status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_affiliates_risk_score ON affiliates (risk_score)`;

  await sql`
    CREATE TABLE IF NOT EXISTS sales (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL,
      affiliate_id TEXT,
      referral_id TEXT,
      amount_cents INT DEFAULT 0,
      currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'created',
      created_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS commissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL,
      affiliate_id TEXT,
      sale_id TEXT,
      amount_cents INT DEFAULT 0,
      currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'created',
      created_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rewardful_id TEXT UNIQUE NOT NULL,
      affiliate_id TEXT,
      amount_cents INT DEFAULT 0,
      currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'created',
      created_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ
    )
  `;

  // ---- Ad-detection ground truth from PostHog (per token, per day) ----
  await sql`
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
    )
  `;
  await sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_google INT DEFAULT 0`;
  await sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_meta INT DEFAULT 0`;
  await sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_microsoft INT DEFAULT 0`;
  await sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_tiktok INT DEFAULT 0`;
  await sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_linkedin INT DEFAULT 0`;
  await sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_reddit INT DEFAULT 0`;
  await sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_x INT DEFAULT 0`;
  await sql`ALTER TABLE affiliate_traffic ADD COLUMN IF NOT EXISTS signups_with_apple INT DEFAULT 0`;
  await sql`CREATE INDEX IF NOT EXISTS idx_affiliate_traffic_day ON affiliate_traffic (day)`;

  // ---- Enforcement (staged bans, applied to Rewardful only via explicit bulk action) ----
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS enforcement_state TEXT DEFAULT 'none'`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS enforcement_reason TEXT`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS enforcement_proposed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS enforcement_applied_at TIMESTAMPTZ`;
  await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS rewardful_state_before TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_affiliates_enforcement ON affiliates (enforcement_state)`;

  await sql`
    CREATE TABLE IF NOT EXISTS enforcement_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT DEFAULT 'dashboard',
      payload JSONB,
      result TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_enforcement_log_affiliate ON enforcement_log (affiliate_id)`;

  // ---- Commission freeze / payout review ----
  await sql`
    CREATE TABLE IF NOT EXISTS commission_holds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id TEXT UNIQUE NOT NULL,
      amount_cents INT DEFAULT 0,
      reason TEXT,
      status TEXT DEFAULT 'held',
      decided_by TEXT,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // ---- Rewardful -> Instantly outreach reconciliation ----
  await sql`
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
    )
  `;
  await sql`ALTER TABLE outreach_contacts ADD COLUMN IF NOT EXISTS sync_attempts INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE outreach_contacts ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS idx_outreach_contacts_status ON outreach_contacts (sync_status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_outreach_contacts_email ON outreach_contacts (email)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_contacts_campaign_email ON outreach_contacts (campaign_id, LOWER(email))`;

  await sql`
    CREATE TABLE IF NOT EXISTS outreach_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      affiliate_id TEXT,
      campaign_id TEXT,
      event_type TEXT NOT NULL,
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_outreach_events_campaign ON outreach_events (campaign_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_outreach_events_created_at ON outreach_events (created_at)`;

  // ---- Data repair: commissions.affiliate_id is NULL on legacy rows; sales has it ----
  await sql`
    UPDATE commissions c SET affiliate_id = s.affiliate_id
    FROM sales s
    WHERE c.sale_id = s.rewardful_id AND c.affiliate_id IS NULL AND s.affiliate_id IS NOT NULL
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_commissions_affiliate_id ON commissions (affiliate_id)`;

  console.log('✅ All tables created successfully.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
