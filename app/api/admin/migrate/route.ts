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
      received_at TIMESTAMPTZ DEFAULT NOW(), processed BOOLEAN DEFAULT TRUE
    )`);
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

  return NextResponse.json({
    ok: true,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    applied,
    skipped,
  });
}
