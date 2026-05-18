import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

const ALLOWED_STATUSES = new Set(['unreviewed', 'flagged', 'cleared', 'paused']);
const ALLOWED_TAGS = new Set([
  'brand_bidding',
  'self_referral',
  'fake_traffic',
  'duplicate_account',
  'identity_mismatch',
  'coupon_sniping',
  'click_farm',
  'low_quality',
  'manual_review',
  'verified_legit',
]);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));

  const reviewStatus: string | undefined = body.reviewStatus;
  const reviewNotes: string | null | undefined = body.reviewNotes;
  const knownUrl: string | null | undefined = body.knownUrl;
  const fraudTags: string[] | undefined = Array.isArray(body.fraudTags) ? body.fraudTags : undefined;

  if (reviewStatus !== undefined && !ALLOWED_STATUSES.has(reviewStatus)) {
    return NextResponse.json({ error: 'Invalid reviewStatus' }, { status: 400 });
  }
  if (fraudTags !== undefined) {
    const bad = fraudTags.find(t => !ALLOWED_TAGS.has(t));
    if (bad) return NextResponse.json({ error: `Invalid fraudTag: ${bad}` }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Auto-migrate fraud_tags column on first save (idempotent ALTER).
  if (fraudTags !== undefined) {
    try {
      await sql`ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS fraud_tags JSONB DEFAULT '[]'::jsonb`;
    } catch (e) {
      console.error('Could not ensure fraud_tags column:', e);
    }
  }

  if (fraudTags !== undefined) {
    await sql`
      UPDATE affiliates
      SET
        review_status = COALESCE(${reviewStatus ?? null}, review_status),
        review_notes = CASE WHEN ${reviewNotes === undefined} THEN review_notes ELSE ${reviewNotes ?? null} END,
        known_url = CASE WHEN ${knownUrl === undefined} THEN known_url ELSE ${knownUrl ?? null} END,
        fraud_tags = ${JSON.stringify(fraudTags)}::jsonb,
        reviewed_at = ${now}
      WHERE rewardful_id = ${id}
    `;
  } else {
    await sql`
      UPDATE affiliates
      SET
        review_status = COALESCE(${reviewStatus ?? null}, review_status),
        review_notes = CASE WHEN ${reviewNotes === undefined} THEN review_notes ELSE ${reviewNotes ?? null} END,
        known_url = CASE WHEN ${knownUrl === undefined} THEN known_url ELSE ${knownUrl ?? null} END,
        reviewed_at = ${now}
      WHERE rewardful_id = ${id}
    `;
  }

  const updated = await sql`
    SELECT rewardful_id, review_status, review_notes, reviewed_at, known_url
    FROM affiliates WHERE rewardful_id = ${id} LIMIT 1
  `;

  return NextResponse.json({ ok: true, affiliate: updated[0] ?? null });
}
