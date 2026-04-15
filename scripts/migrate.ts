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
      processed BOOLEAN DEFAULT TRUE
    )
  `;

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

  console.log('✅ All tables created successfully.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
