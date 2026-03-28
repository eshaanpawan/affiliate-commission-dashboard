import sql from './db';

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
  await sql`
    INSERT INTO affiliates (rewardful_id, first_name, last_name, email, status, created_at, confirmed_at, updated_at)
    VALUES (
      ${obj.id},
      ${obj.first_name ?? null},
      ${obj.last_name ?? null},
      ${obj.email ?? null},
      ${obj.state ?? 'active'},
      ${obj.created_at ?? new Date().toISOString()},
      ${obj.confirmed_at ?? null},
      ${new Date().toISOString()}
    )
    ON CONFLICT (rewardful_id) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      email = EXCLUDED.email,
      status = EXCLUDED.status,
      confirmed_at = EXCLUDED.confirmed_at,
      updated_at = EXCLUDED.updated_at
  `;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertReferral(eventType: string, obj: any) {
  const convertedAt = eventType === 'referral.converted' ? new Date().toISOString() : (obj.converted_at ?? null);
  const status = eventType === 'referral.deleted' ? 'deleted'
    : eventType === 'referral.converted' ? 'converted'
    : eventType === 'referral.lead' ? 'lead'
    : (obj.state ?? 'lead');

  await sql`
    INSERT INTO referrals (rewardful_id, affiliate_id, status, created_at, converted_at)
    VALUES (
      ${obj.id},
      ${obj.affiliate?.id ?? obj.affiliate_id ?? null},
      ${status},
      ${obj.created_at ?? new Date().toISOString()},
      ${convertedAt}
    )
    ON CONFLICT (rewardful_id) DO UPDATE SET
      status = EXCLUDED.status,
      converted_at = COALESCE(EXCLUDED.converted_at, referrals.converted_at)
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
      ${obj.amount ?? 0},
      ${obj.currency ?? 'usd'},
      ${status},
      ${obj.created_at ?? new Date().toISOString()}
    )
    ON CONFLICT (rewardful_id) DO UPDATE SET
      status = EXCLUDED.status,
      amount_cents = EXCLUDED.amount_cents
  `;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertCommission(eventType: string, obj: any) {
  const status = eventType === 'commission.deleted' ? 'deleted'
    : eventType === 'commission.paid' ? 'paid'
    : eventType === 'commission.voided' ? 'voided'
    : 'created';
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
    : 'created';
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
