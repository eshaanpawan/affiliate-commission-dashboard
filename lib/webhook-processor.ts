import sql from './db';
import { extractTrafficFields } from './fraud-detection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processWebhookEvent(eventType: string, object: any) {
  switch (true) {
    case eventType.startsWith('affiliate.'):
      await upsertAffiliate(object);
      break;
    case eventType.startsWith('referral.'):
      await upsertReferral(eventType, object);
      break;
    case eventType.startsWith('sale.'):
      await upsertSale(eventType, object);
      break;
    case eventType.startsWith('commission.'):
      await upsertCommission(eventType, object);
      break;
    case eventType.startsWith('payout.'):
      await upsertPayout(eventType, object);
      break;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertAffiliate(obj: any) {
  const usd = obj.commission_stats?.currencies?.USD;
  await sql`
    INSERT INTO affiliates (
      rewardful_id, first_name, last_name, email, status, created_at, confirmed_at, updated_at,
      visitors, leads, conversions, unpaid_commission_cents, paid_commission_cents, gross_revenue_cents
    )
    VALUES (
      ${obj.id},
      ${obj.first_name ?? null},
      ${obj.last_name ?? null},
      ${obj.email ?? null},
      ${obj.state ?? 'active'},
      ${obj.created_at ?? new Date().toISOString()},
      ${obj.confirmed_at ?? null},
      ${new Date().toISOString()},
      ${obj.visitors ?? 0}, ${obj.leads ?? 0}, ${obj.conversions ?? 0},
      ${usd?.unpaid?.cents ?? 0}, ${usd?.paid?.cents ?? 0}, ${usd?.gross_revenue?.cents ?? 0}
    )
    ON CONFLICT (rewardful_id) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      email = EXCLUDED.email,
      status = EXCLUDED.status,
      confirmed_at = EXCLUDED.confirmed_at,
      updated_at = EXCLUDED.updated_at,
      visitors = EXCLUDED.visitors,
      leads = EXCLUDED.leads,
      conversions = EXCLUDED.conversions,
      unpaid_commission_cents = CASE WHEN ${obj.commission_stats != null} THEN EXCLUDED.unpaid_commission_cents ELSE affiliates.unpaid_commission_cents END,
      paid_commission_cents = CASE WHEN ${obj.commission_stats != null} THEN EXCLUDED.paid_commission_cents ELSE affiliates.paid_commission_cents END,
      gross_revenue_cents = CASE WHEN ${obj.commission_stats != null} THEN EXCLUDED.gross_revenue_cents ELSE affiliates.gross_revenue_cents END
  `;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertReferral(eventType: string, obj: any) {
  const convertedAt = eventType === 'referral.converted' ? new Date().toISOString() : (obj.converted_at ?? null);
  const status = eventType === 'referral.deleted' ? 'deleted'
    : eventType === 'referral.converted' ? 'converted'
    : eventType === 'referral.lead' ? 'lead'
    : obj.conversion_state === 'conversion' ? 'converted'
    : obj.conversion_state === 'lead' ? 'lead'
    : (obj.state ?? 'visitor');
  const traffic = extractTrafficFields(obj);
  const linkId = obj.link?.id ?? obj.link_id ?? null;
  const linkToken = obj.link?.token ?? obj.link_token ?? null;

  await sql`
    INSERT INTO referrals (
      rewardful_id, affiliate_id, link_id, link_token, status, created_at, converted_at,
      became_lead_at, visitor_id, customer_email, customer_id, referrer, landing_page,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, raw_payload
    )
    VALUES (
      ${obj.id},
      ${obj.affiliate?.id ?? obj.affiliate_id ?? null},
      ${linkId},
      ${linkToken},
      ${status},
      ${obj.created_at ?? new Date().toISOString()},
      ${convertedAt},
      ${traffic.became_lead_at}, ${traffic.visitor_id}, ${traffic.customer_email}, ${traffic.customer_id},
      ${traffic.referrer}, ${traffic.landing_page}, ${traffic.utm_source}, ${traffic.utm_medium},
      ${traffic.utm_campaign}, ${traffic.utm_term}, ${traffic.utm_content}, ${traffic.gclid}, ${traffic.fbclid},
      ${JSON.stringify(obj)}::jsonb
    )
    ON CONFLICT (rewardful_id) DO UPDATE SET
      affiliate_id = COALESCE(EXCLUDED.affiliate_id, referrals.affiliate_id),
      link_id = COALESCE(EXCLUDED.link_id, referrals.link_id),
      link_token = COALESCE(EXCLUDED.link_token, referrals.link_token),
      status = EXCLUDED.status,
      converted_at = COALESCE(EXCLUDED.converted_at, referrals.converted_at),
      became_lead_at = COALESCE(EXCLUDED.became_lead_at, referrals.became_lead_at),
      customer_email = COALESCE(EXCLUDED.customer_email, referrals.customer_email),
      customer_id = COALESCE(EXCLUDED.customer_id, referrals.customer_id),
      visitor_id = COALESCE(EXCLUDED.visitor_id, referrals.visitor_id),
      raw_payload = EXCLUDED.raw_payload
  `;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertSale(eventType: string, obj: any) {
  const status = eventType === 'sale.deleted' ? 'deleted'
    : eventType === 'sale.refunded' ? 'refunded'
    : 'created';

  await sql`
    INSERT INTO sales (rewardful_id, affiliate_id, referral_id, amount_cents, currency, status, created_at)
    VALUES (
      ${obj.id},
      ${obj.affiliate?.id ?? obj.affiliate_id ?? null},
      ${obj.referral?.id ?? obj.referral_id ?? null},
      ${obj.sale_amount_cents ?? obj.amount ?? 0},
      ${obj.currency ?? 'usd'},
      ${status},
      ${obj.created_at ?? new Date().toISOString()}
    )
    ON CONFLICT (rewardful_id) DO UPDATE SET
      status = EXCLUDED.status,
      amount_cents = EXCLUDED.amount_cents
  `;

  // Cascade: when a sale is refunded/deleted, void any commissions tied to it
  // so the clawback shows up immediately without waiting for the next sync.
  if (eventType === 'sale.refunded' || eventType === 'sale.deleted') {
    await sql`
      UPDATE commissions
      SET status = ${eventType === 'sale.deleted' ? 'deleted' : 'voided'}
      WHERE sale_id = ${obj.id}
        AND status NOT IN ('voided', 'deleted')
    `;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertCommission(eventType: string, obj: any) {
  const status = eventType === 'commission.deleted' ? 'deleted'
    : eventType === 'commission.paid' ? 'paid'
    : eventType === 'commission.voided' ? 'voided'
    : (obj.state ?? 'pending');
  const paidAt = eventType === 'commission.paid' ? new Date().toISOString() : (obj.paid_at ?? null);

  await sql`
    INSERT INTO commissions (rewardful_id, affiliate_id, sale_id, amount_cents, currency, status, created_at, paid_at)
    VALUES (
      ${obj.id},
      ${obj.affiliate?.id ?? obj.affiliate_id ?? null},
      ${obj.sale?.id ?? obj.sale_id ?? null},
      ${obj.amount ?? 0},
      ${obj.currency ?? 'usd'},
      ${status},
      ${obj.created_at ?? new Date().toISOString()},
      ${paidAt}
    )
    ON CONFLICT (rewardful_id) DO UPDATE SET
      status = EXCLUDED.status,
      paid_at = COALESCE(EXCLUDED.paid_at, commissions.paid_at),
      amount_cents = EXCLUDED.amount_cents
  `;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertPayout(eventType: string, obj: any) {
  const status = eventType === 'payout.deleted' ? 'deleted'
    : eventType === 'payout.paid' ? 'paid'
    : eventType === 'payout.failed' ? 'failed'
    : eventType === 'payout.due' ? 'due'
    : (obj.state ?? 'created');
  const paidAt = eventType === 'payout.paid' ? new Date().toISOString() : (obj.paid_at ?? null);

  await sql`
    INSERT INTO payouts (rewardful_id, affiliate_id, amount_cents, currency, status, created_at, paid_at)
    VALUES (
      ${obj.id},
      ${obj.affiliate?.id ?? obj.affiliate_id ?? null},
      ${obj.amount ?? 0},
      ${obj.currency ?? 'usd'},
      ${status},
      ${obj.created_at ?? new Date().toISOString()},
      ${paidAt}
    )
    ON CONFLICT (rewardful_id) DO UPDATE SET
      status = EXCLUDED.status,
      paid_at = COALESCE(EXCLUDED.paid_at, payouts.paid_at),
      amount_cents = EXCLUDED.amount_cents
  `;
}
