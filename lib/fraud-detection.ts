// Brand-bidding & affiliate fraud signal detection.
//
// "Brand bidding" = an affiliate runs paid Google/Meta ads on brand keywords
// (e.g. "runable", "runable ai", "runable login"), intercepts traffic that was
// already going to convert, and pockets the commission. The user was never
// actually referred by the affiliate's content — they were searching for us.
//
// Signals we look for:
//   1. Paid-traffic indicators on the referral itself (gclid, utm_medium=cpc,
//      referrer=google.com/aclk, fbclid). A real content affiliate should be
//      driving organic traffic from their blog/YouTube/Twitter — not paid ads.
//   2. Instant conversion (< 5 min from first click → signup). Means the
//      visitor was already high-intent — classic brand-bidding fingerprint.
//   3. Suspiciously high conversion rate. Typical content affiliate conv rate
//      is 5-20%. Brand bidders see 40%+ because they're snipng buyer-intent.
//   4. Single-source concentration. Real affiliates have varied referrers
//      (their blog + Twitter + YouTube etc.). Brand bidders only have Google.

export interface ReferralSignalRow {
  referrer: string | null;
  landing_page: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  gclid: string | null;
  fbclid: string | null;
  created_at: string | Date | null;
  converted_at: string | Date | null;
  status: string;
  customer_email?: string | null;
  visitor_id?: string | null;
}

export interface AffiliateContext {
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  link_tokens?: string[];
}

export interface RefundContext {
  total_commissions: number;
  refunded_commissions: number;
  refunded_amount_cents: number;
}

export interface CrossAffiliateContext {
  // visitor_ids that appeared under multiple affiliates
  shared_visitor_count: number;
  // customer_emails that appeared under multiple affiliates
  shared_customer_count: number;
}

export interface AffiliateRiskInput {
  rewardful_id: string;
  referrals: ReferralSignalRow[];
  affiliate?: AffiliateContext;
  refunds?: RefundContext;
  crossAffiliate?: CrossAffiliateContext;
}

export interface RiskSignal {
  key: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
  value: number | string;
  detail: string;
}

export interface AffiliateRisk {
  rewardful_id: string;
  score: number; // 0-100
  band: 'low' | 'medium' | 'high';
  signals: RiskSignal[];
  stats: {
    referrals: number;
    conversions: number;
    convRate: number;
    instantConvPct: number;
    gclidPct: number;
    googleReferrerPct: number;
    paidUtmPct: number;
    fbclidPct: number;
    topSourcePct: number;
    topSource: string | null;
    medianTimeToConvSec: number | null;
    refundRate: number;
    selfReferralCount: number;
    sharedVisitorCount: number;
    sharedCustomerCount: number;
  };
}

const BRAND_TERMS = ['runable'];

function isPaidUtm(medium: string | null): boolean {
  if (!medium) return false;
  const m = medium.toLowerCase();
  return ['cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'paid_search', 'sem'].includes(m);
}

function isGoogleReferrer(ref: string | null): boolean {
  if (!ref) return false;
  const r = ref.toLowerCase();
  return r.includes('google.') || r.includes('googleadservices') || r.includes('/aclk');
}

function classifySource(r: ReferralSignalRow): string {
  if (r.gclid) return 'google_ads';
  if (isPaidUtm(r.utm_medium)) return `paid:${r.utm_source ?? 'unknown'}`;
  if (r.fbclid) return 'meta_ads';
  if (isGoogleReferrer(r.referrer)) return 'google_organic_or_ads';
  if (r.utm_source) return r.utm_source.toLowerCase();
  if (r.referrer) {
    try {
      const host = new URL(r.referrer).hostname.replace(/^www\./, '');
      return host;
    } catch {
      return 'unknown';
    }
  }
  return 'direct';
}

// Normalize an email so Gmail-style aliases collapse to the same identity.
// "Kate.Lee+promo@gmail.com" → "katelee@gmail.com". Catches the obvious
// self-referral trick where someone sub-addresses their own gmail.
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 0) return lower;
  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  // Strip plus-addressing on all providers
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  // Strip dots only on Gmail/Google Workspace (they ignore dots in local part)
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

function isFreeMailDomain(domain: string): boolean {
  const free = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'live.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
    'mail.ru', 'yandex.ru', 'qq.com', '163.com',
  ]);
  return free.has(domain.toLowerCase());
}

// Detect self-referral: customer_email matches the affiliate themselves.
// Three confidence levels:
//   exact   — normalized emails are identical
//   alias   — same local-part heuristics (Gmail dots/plus)
//   domain  — same business email domain (only flagged for non-free domains)
type SelfReferralLevel = 'exact' | 'alias' | 'domain' | null;
function selfReferralLevel(customerEmail: string | null, affiliateEmail: string | null): SelfReferralLevel {
  if (!customerEmail || !affiliateEmail) return null;
  const a = normalizeEmail(affiliateEmail);
  const c = normalizeEmail(customerEmail);
  if (!a || !c) return null;
  if (a === c) return 'exact';
  const [aLocal, aDomain] = a.split('@');
  const [cLocal, cDomain] = c.split('@');
  if (!aDomain || !cDomain) return null;
  if (aLocal === cLocal && aDomain === cDomain) return 'alias';
  if (aDomain === cDomain && !isFreeMailDomain(aDomain)) return 'domain';
  return null;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeAffiliateRisk(input: AffiliateRiskInput): AffiliateRisk {
  const refs = input.referrals;
  const n = refs.length;
  const convs = refs.filter(r => r.status === 'converted');
  const convRate = n > 0 ? convs.length / n : 0;

  const gclidCount = refs.filter(r => !!r.gclid).length;
  const fbclidCount = refs.filter(r => !!r.fbclid).length;
  const googleRefCount = refs.filter(r => isGoogleReferrer(r.referrer)).length;
  const paidUtmCount = refs.filter(r => isPaidUtm(r.utm_medium)).length;

  const gclidPct = n > 0 ? gclidCount / n : 0;
  const fbclidPct = n > 0 ? fbclidCount / n : 0;
  const googleReferrerPct = n > 0 ? googleRefCount / n : 0;
  const paidUtmPct = n > 0 ? paidUtmCount / n : 0;

  // Time-to-conversion (only for converted referrals with both timestamps)
  const ttcSecs: number[] = [];
  let instantCount = 0;
  for (const r of convs) {
    if (!r.created_at || !r.converted_at) continue;
    const start = new Date(r.created_at).getTime();
    const end = new Date(r.converted_at).getTime();
    if (!isFinite(start) || !isFinite(end) || end < start) continue;
    const secs = (end - start) / 1000;
    ttcSecs.push(secs);
    if (secs < 300) instantCount++;
  }
  const instantConvPct = convs.length > 0 ? instantCount / convs.length : 0;
  const medianTimeToConvSec = median(ttcSecs);

  // Source concentration
  const sourceCounts = new Map<string, number>();
  for (const r of refs) {
    const s = classifySource(r);
    sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
  }
  let topSource: string | null = null;
  let topSourceCount = 0;
  for (const [s, c] of sourceCounts) {
    if (c > topSourceCount) { topSource = s; topSourceCount = c; }
  }
  const topSourcePct = n > 0 ? topSourceCount / n : 0;

  // Brand term in landing page query string (e.g. utm_term=runable)
  const brandInUtmCount = refs.filter(r => {
    const haystack = `${r.utm_term ?? ''} ${r.utm_campaign ?? ''} ${r.landing_page ?? ''}`.toLowerCase();
    return BRAND_TERMS.some(t => haystack.includes(t));
  }).length;
  const brandInUtmPct = n > 0 ? brandInUtmCount / n : 0;

  // Self-referral: customer email matches affiliate's own email or alias.
  // The single highest-precision fraud signal at SaaS scale (Rewardful/Refgrow).
  const affEmail = input.affiliate?.email ?? null;
  let selfExact = 0, selfAlias = 0, selfDomain = 0;
  for (const r of refs) {
    const level = selfReferralLevel(r.customer_email ?? null, affEmail);
    if (level === 'exact') selfExact++;
    else if (level === 'alias') selfAlias++;
    else if (level === 'domain') selfDomain++;
  }
  const selfReferralCount = selfExact + selfAlias + selfDomain;

  // Refund-rate signal — high refund rate suggests stolen-card / refund-recommission fraud
  const totalCommissions = input.refunds?.total_commissions ?? 0;
  const refundedCommissions = input.refunds?.refunded_commissions ?? 0;
  const refundRate = totalCommissions > 0 ? refundedCommissions / totalCommissions : 0;

  // Cross-affiliate overlap (visitor or customer reuse across affiliates)
  const sharedVisitorCount = input.crossAffiliate?.shared_visitor_count ?? 0;
  const sharedCustomerCount = input.crossAffiliate?.shared_customer_count ?? 0;

  // Compose signals
  const signals: RiskSignal[] = [];

  if (gclidPct >= 0.05) {
    signals.push({
      key: 'gclid',
      label: 'Google ad clicks detected',
      severity: gclidPct >= 0.3 ? 'high' : gclidPct >= 0.15 ? 'medium' : 'low',
      value: `${(gclidPct * 100).toFixed(0)}%`,
      detail: `${gclidCount} of ${n} referrals arrived with a Google gclid — they came through a paid Google Ad. Real content affiliates should drive organic traffic.`,
    });
  }
  if (fbclidPct >= 0.05) {
    signals.push({
      key: 'fbclid',
      label: 'Meta ad clicks detected',
      severity: fbclidPct >= 0.3 ? 'high' : 'medium',
      value: `${(fbclidPct * 100).toFixed(0)}%`,
      detail: `${fbclidCount} of ${n} referrals arrived with a Meta fbclid — paid Facebook/Instagram traffic.`,
    });
  }
  if (paidUtmPct >= 0.05) {
    signals.push({
      key: 'paid_utm',
      label: 'Paid UTM medium',
      severity: paidUtmPct >= 0.3 ? 'high' : 'medium',
      value: `${(paidUtmPct * 100).toFixed(0)}%`,
      detail: `${paidUtmCount} referrals tagged with utm_medium=cpc/ppc/paid — affiliate is sending paid ad traffic.`,
    });
  }
  if (googleReferrerPct >= 0.3) {
    signals.push({
      key: 'google_referrer',
      label: 'Mostly Google referrer',
      severity: googleReferrerPct >= 0.6 ? 'high' : 'medium',
      value: `${(googleReferrerPct * 100).toFixed(0)}%`,
      detail: `${googleRefCount} of ${n} referrals had google.com as the HTTP referrer — could be brand-bid search ads.`,
    });
  }
  if (instantConvPct >= 0.4 && convs.length >= 3) {
    signals.push({
      key: 'instant_conversion',
      label: 'Instant conversions',
      severity: instantConvPct >= 0.7 ? 'high' : 'medium',
      value: `${(instantConvPct * 100).toFixed(0)}%`,
      detail: `${instantCount} of ${convs.length} conversions happened within 5 minutes of first click. Classic brand-bidding fingerprint — the visitor was already buyer-intent.`,
    });
  }
  if (convRate >= 0.4 && n >= 10) {
    signals.push({
      key: 'high_conv_rate',
      label: 'Abnormal conversion rate',
      severity: convRate >= 0.6 ? 'high' : 'medium',
      value: `${(convRate * 100).toFixed(0)}%`,
      detail: `Conversion rate is ${(convRate * 100).toFixed(0)}% (${convs.length}/${n}). Typical content affiliate is 5-20% — anything >40% strongly suggests intercepted high-intent traffic.`,
    });
  }
  if (topSourcePct >= 0.85 && n >= 5 && topSource && topSource !== 'direct') {
    signals.push({
      key: 'single_source',
      label: 'Single-source traffic',
      severity: topSource.startsWith('google') || topSource.startsWith('paid') ? 'high' : 'low',
      value: `${(topSourcePct * 100).toFixed(0)}% ${topSource}`,
      detail: `${topSourceCount} of ${n} referrals come from "${topSource}". Real content affiliates have a diversified mix; concentration this high is a red flag — especially if the source is paid.`,
    });
  }
  if (brandInUtmPct >= 0.1) {
    signals.push({
      key: 'brand_in_utm',
      label: 'Brand term in UTM/landing',
      severity: 'high',
      value: `${(brandInUtmPct * 100).toFixed(0)}%`,
      detail: `${brandInUtmCount} referrals have "runable" inside the utm_term/utm_campaign/landing page query — almost certainly a brand-keyword ad.`,
    });
  }
  if (selfExact > 0) {
    signals.push({
      key: 'self_referral_exact',
      label: 'Self-referral (exact email match)',
      severity: 'high',
      value: `${selfExact} conversion(s)`,
      detail: `${selfExact} converted referrals have a customer email that exactly matches this affiliate's account email. The affiliate is paying for the product through their own link to claim commission.`,
    });
  }
  if (selfAlias > 0) {
    signals.push({
      key: 'self_referral_alias',
      label: 'Self-referral (email alias)',
      severity: 'high',
      value: `${selfAlias} conversion(s)`,
      detail: `${selfAlias} customer emails differ from the affiliate's email only by Gmail-style aliasing (dots, +tags). Same person — self-referral.`,
    });
  }
  if (selfDomain > 0) {
    signals.push({
      key: 'self_referral_domain',
      label: 'Same business-email domain',
      severity: 'medium',
      value: `${selfDomain} conversion(s)`,
      detail: `${selfDomain} customer emails share a non-free business email domain with the affiliate. Could be a colleague — manually verify before clawback.`,
    });
  }
  if (refundRate >= 0.15 && totalCommissions >= 3) {
    signals.push({
      key: 'high_refund_rate',
      label: 'High refund rate',
      severity: refundRate >= 0.4 ? 'high' : 'medium',
      value: `${(refundRate * 100).toFixed(0)}%`,
      detail: `${refundedCommissions} of ${totalCommissions} commissions ($${((input.refunds?.refunded_amount_cents ?? 0) / 100).toFixed(2)}) have been refunded or voided. Industry typical is <5% — high refund rates indicate stolen-card or refund-recommission fraud.`,
    });
  }
  if (sharedVisitorCount > 0) {
    signals.push({
      key: 'shared_visitors',
      label: 'Visitor IDs shared across affiliates',
      severity: sharedVisitorCount >= 5 ? 'high' : 'medium',
      value: `${sharedVisitorCount} visitor(s)`,
      detail: `${sharedVisitorCount} of this affiliate's visitors also appeared under other affiliates. Signs of coordinated ring fraud, coupon-extension sniping, or attribution gaming.`,
    });
  }
  if (sharedCustomerCount > 0) {
    signals.push({
      key: 'shared_customers',
      label: 'Customer emails seen under other affiliates',
      severity: 'high',
      value: `${sharedCustomerCount} customer(s)`,
      detail: `${sharedCustomerCount} of this affiliate's customer emails were also referred by another affiliate. Strong indicator of attribution theft (e.g. browser extension sniping last-click) or coordinated fraud.`,
    });
  }

  // Compose risk score 0-100
  let score = 0;
  score += Math.min(35, gclidPct * 100);            // 0-35 from gclid
  score += Math.min(15, fbclidPct * 50);            // 0-15 from fbclid
  score += Math.min(15, paidUtmPct * 50);           // 0-15 from paid utm
  score += Math.min(20, googleReferrerPct * 30);    // 0-20 from google referrer
  score += Math.min(20, instantConvPct * 25);       // 0-20 from instant conv
  if (convRate >= 0.4 && n >= 10) score += Math.min(15, (convRate - 0.4) * 50);
  if (topSourcePct >= 0.85 && n >= 5 && topSource && (topSource.startsWith('google') || topSource.startsWith('paid'))) score += 10;
  if (brandInUtmPct >= 0.1) score += 25;
  // Self-referral is the strongest signal at SaaS scale — score aggressively
  if (selfExact > 0) score += 60;        // near-certain fraud, bypass any other gates
  else if (selfAlias > 0) score += 50;
  else if (selfDomain > 0) score += 15;  // softer — could be a legitimate colleague
  if (refundRate >= 0.15 && totalCommissions >= 3) score += Math.min(25, refundRate * 50);
  if (sharedCustomerCount > 0) score += Math.min(25, sharedCustomerCount * 8);
  if (sharedVisitorCount > 0) score += Math.min(15, sharedVisitorCount * 3);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const band: 'low' | 'medium' | 'high' = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';

  return {
    rewardful_id: input.rewardful_id,
    score,
    band,
    signals,
    stats: {
      referrals: n,
      conversions: convs.length,
      convRate,
      instantConvPct,
      gclidPct,
      googleReferrerPct,
      paidUtmPct,
      fbclidPct,
      topSourcePct,
      topSource,
      medianTimeToConvSec,
      refundRate,
      selfReferralCount,
      sharedVisitorCount,
      sharedCustomerCount,
    },
  };
}

// Extract referrer/landing/utm/gclid from a Rewardful referral payload.
// Rewardful exposes these under different shapes depending on plan and expand[]
// options, so we look in several plausible places and merge.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractTrafficFields(payload: any) {
  const out: {
    referrer: string | null;
    landing_page: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
    gclid: string | null;
    fbclid: string | null;
    visitor_id: string | null;
    customer_email: string | null;
    customer_id: string | null;
    became_lead_at: string | null;
  } = {
    referrer: null, landing_page: null, utm_source: null, utm_medium: null,
    utm_campaign: null, utm_term: null, utm_content: null,
    gclid: null, fbclid: null, visitor_id: null,
    customer_email: null, customer_id: null, became_lead_at: null,
  };

  if (!payload || typeof payload !== 'object') return out;

  // Direct fields on referral
  out.referrer = payload.referrer ?? payload.referer ?? null;
  out.landing_page = payload.landing_page ?? null;
  out.visitor_id = payload.visitor_id ?? null;
  out.became_lead_at = payload.became_lead_at ?? null;
  out.customer_email = payload.customer?.email ?? payload.email ?? null;
  out.customer_id = payload.customer?.id ?? payload.stripe_customer_id ?? null;

  // Visits expansion (most common location for traffic data on Rewardful)
  const visits = Array.isArray(payload.visits) ? payload.visits : [];
  const firstVisit = visits[0] ?? payload.first_visit ?? payload.visitor?.last_visit ?? null;

  if (firstVisit && typeof firstVisit === 'object') {
    out.referrer = out.referrer ?? firstVisit.referrer ?? firstVisit.referer ?? null;
    out.landing_page = out.landing_page ?? firstVisit.landing_page ?? firstVisit.url ?? null;
    out.utm_source = firstVisit.utm_source ?? null;
    out.utm_medium = firstVisit.utm_medium ?? null;
    out.utm_campaign = firstVisit.utm_campaign ?? null;
    out.utm_term = firstVisit.utm_term ?? null;
    out.utm_content = firstVisit.utm_content ?? null;
    out.gclid = firstVisit.gclid ?? null;
    out.fbclid = firstVisit.fbclid ?? null;
  }

  // Last-resort: parse landing_page query string
  if (out.landing_page) {
    try {
      const url = new URL(out.landing_page);
      out.utm_source = out.utm_source ?? url.searchParams.get('utm_source');
      out.utm_medium = out.utm_medium ?? url.searchParams.get('utm_medium');
      out.utm_campaign = out.utm_campaign ?? url.searchParams.get('utm_campaign');
      out.utm_term = out.utm_term ?? url.searchParams.get('utm_term');
      out.utm_content = out.utm_content ?? url.searchParams.get('utm_content');
      out.gclid = out.gclid ?? url.searchParams.get('gclid');
      out.fbclid = out.fbclid ?? url.searchParams.get('fbclid');
    } catch { /* ignore */ }
  }

  return out;
}
