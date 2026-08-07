import { NextRequest, NextResponse } from 'next/server';
import { verifyRewardfulSignature } from '@/lib/verify-signature';
import sql from '@/lib/db';
import { createHash } from 'node:crypto';

// Dub signs webhooks the same way Rewardful does: hex HMAC-SHA256 of the raw
// body, sent in the `Dub-Signature` header.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('dub-signature') ?? '';
  const secret = process.env.DUB_WEBHOOK_SECRET ?? '';

  if (!verifyRewardfulSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event: string = payload?.event ?? '';
  if (!event || !payload?.data) {
    return NextResponse.json({ error: 'Malformed Dub event' }, { status: 400 });
  }
  const eventId: string = payload?.id
    ?? `dub_${createHash('sha256').update(rawBody).digest('hex')}`;
  const eventType = `dub.${event}`;

  try {
    await sql`
      INSERT INTO webhook_events (event_id, event_type, payload, processed, attempt_count)
      VALUES (${eventId}, ${eventType}, ${JSON.stringify(payload)}::jsonb, TRUE, 1)
      ON CONFLICT (event_id) DO NOTHING
    `;
  } catch (err) {
    console.error('Failed to store Dub webhook event:', err);
    return NextResponse.json({ error: 'Could not persist webhook event' }, { status: 500 });
  }

  // Keep the partner roster fresh in real time; full stats arrive via /api/sync.
  if (event === 'partner.enrolled' || event === 'partner_application.submitted') {
    const partner = payload.data?.partner ?? payload.data;
    if (partner?.id) {
      const [firstName, ...rest] = String(partner.name ?? '').trim().split(/\s+/);
      await sql`
        INSERT INTO affiliates (rewardful_id, first_name, last_name, email, status, created_at, updated_at, source)
        VALUES (
          ${partner.id}, ${firstName || null}, ${rest.join(' ') || null},
          ${partner.email ?? null},
          ${event === 'partner.enrolled' ? 'approved' : 'pending'},
          ${partner.createdAt ?? new Date().toISOString()}, NOW(), 'dub'
        )
        ON CONFLICT (rewardful_id) DO UPDATE SET
          email = COALESCE(EXCLUDED.email, affiliates.email),
          status = EXCLUDED.status, updated_at = NOW(), source = 'dub'
      `.catch((err) => console.error('Failed to upsert Dub partner from webhook:', err));
    }
  }

  // Live row-level updates; the 10-minute cron sync is the reconciliation backstop.
  try {
    const d = payload.data ?? {};
    if (event === 'lead.created' || event === 'sale.created') {
      const customer = d.customer ?? {};
      const partnerId = d.partner?.id ?? d.link?.partnerId ?? null;
      if (customer.id && partnerId) {
        await sql`
          INSERT INTO referrals (rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at, became_lead_at, customer_email, customer_id, country_code)
          VALUES (
            ${customer.id}, ${partnerId}, ${d.link?.id ?? null}, ${d.link?.key ?? null},
            ${event === 'sale.created' ? 'converted' : 'lead'},
            ${customer.createdAt ?? new Date().toISOString()},
            ${event === 'sale.created' ? new Date().toISOString() : null},
            ${customer.createdAt ?? null}, ${customer.email ?? null}, ${customer.id},
            ${customer.country ?? null}
          )
          ON CONFLICT (rewardful_id) DO UPDATE SET
            status = CASE WHEN referrals.status = 'converted' THEN 'converted' ELSE EXCLUDED.status END,
            converted_at = COALESCE(referrals.converted_at, EXCLUDED.converted_at),
            customer_email = COALESCE(EXCLUDED.customer_email, referrals.customer_email)
        `;
      }
    }
    if (event === 'commission.created') {
      const partnerId = d.partner?.id ?? null;
      if (d.id && partnerId) {
        await sql`
          INSERT INTO sales (rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
          VALUES (${`dsale_${d.id}`}, ${partnerId}, ${d.customer?.id ?? null}, ${d.amount ?? 0}, ${(d.currency ?? 'usd').toLowerCase()}, 'created', ${d.createdAt ?? new Date().toISOString()})
          ON CONFLICT (rewardful_id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents
        `;
        await sql`
          INSERT INTO commissions (rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at)
          VALUES (${d.id}, ${partnerId}, ${`dsale_${d.id}`}, ${d.earnings ?? 0}, ${(d.currency ?? 'usd').toLowerCase()}, 'created', ${d.createdAt ?? new Date().toISOString()})
          ON CONFLICT (rewardful_id) DO UPDATE SET amount_cents = EXCLUDED.amount_cents
        `;
      }
    }
  } catch (err) {
    console.error('Dub webhook row-level update failed (cron will reconcile):', err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
