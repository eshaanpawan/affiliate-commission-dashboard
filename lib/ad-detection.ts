// Ad-driven-traffic detection built on PostHog ground truth (affiliate_traffic).
//
// The legacy scorer in lib/fraud-detection.ts reads referral columns
// (gclid/utm/referrer) that Rewardful's list API never populates — they are
// NULL on all 177k rows, so those signals can never fire. This module scores
// from what PostHog actually recorded on each signup's first-touch URL.

export interface TokenTraffic {
  viaToken: string;
  signups: number;
  signupsWithAnyAdParam: number;
  fts: number;
  pageviews: number;
  campaignIds: string[];
  campaignIdsOurs: string[];
}

export interface AdRiskSignal {
  key: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
  value: string;
  detail: string;
}

export interface AdRisk {
  score: number; // 0-100
  band: 'low' | 'medium' | 'high';
  signals: AdRiskSignal[];
  stats: {
    signups: number;
    adSignups: number;
    adPct: number;
    fts: number;
    pageviews: number;
    organicSignups: number;
    campaignIds: string[];
    ourCampaignIds: string[];
    sharedCampaignIds: string[];
    tokens: string[];
  };
}

// Token names that exist to catch brand-intent searches, not to identify a creator.
const BRAND_ARBITRAGE_TOKENS = new Set([
  'official', 'utm', 'cancel', 'signin', 'sign-in', 'login', 'log-in', 'welcome',
  'mainpage', 'main-page', 'bestdeals', 'best-deals', 'join', 'link', 'app',
  'download', 'free', 'deal', 'discount', 'promo', 'coupon', 'runable',
]);

// Don't flag on noise: below this many signups the ad percentage is meaningless.
export const MIN_SIGNUPS_TO_FLAG = 10;

/**
 * Score one affiliate from the union of all their tokens' traffic.
 *
 * @param rows           this affiliate's affiliate_traffic rows (any granularity — summed here)
 * @param campaignOwners map campaign_id -> Set of affiliate ids seen using it (for ring detection)
 * @param affiliateId    this affiliate's id (excluded from ring counts)
 */
export function computeAdRisk(
  rows: TokenTraffic[],
  campaignOwners: Map<string, Set<string>>,
  affiliateId: string,
): AdRisk {
  const tokens = [...new Set(rows.map(r => r.viaToken))];
  const signups = rows.reduce((s, r) => s + r.signups, 0);
  const adSignups = rows.reduce((s, r) => s + r.signupsWithAnyAdParam, 0);
  const fts = rows.reduce((s, r) => s + r.fts, 0);
  const pageviews = rows.reduce((s, r) => s + r.pageviews, 0);
  const campaignIds = [...new Set(rows.flatMap(r => r.campaignIds))].filter(Boolean);
  const ourCampaignIds = [...new Set(rows.flatMap(r => r.campaignIdsOurs))].filter(Boolean);
  const sharedCampaignIds = campaignIds.filter(cid => {
    const owners = campaignOwners.get(cid);
    return owners && [...owners].some(a => a !== affiliateId);
  });

  const adPct = signups > 0 ? adSignups / signups : 0;
  const organicSignups = Math.max(0, signups - adSignups);
  const signals: AdRiskSignal[] = [];
  let score = 0;

  const enoughVolume = signups >= MIN_SIGNUPS_TO_FLAG;

  if (enoughVolume && adPct >= 0.5) {
    // 50% ads → 22 pts, scaling to 45 at 100%.
    score += Math.round(45 * Math.min(1, adPct));
    signals.push({
      key: 'paid_ads_traffic',
      label: 'Paid-ads traffic',
      severity: adPct >= 0.9 ? 'high' : 'medium',
      value: `${Math.round(adPct * 100)}%`,
      detail: `${adSignups.toLocaleString()} of ${signups.toLocaleString()} signups arrived with Google Ads click params (gclid/gbraid/gad_campaignid) on their first-touch URL. Affiliates were approved for organic promotion, not ad buying.`,
    });
  }

  if (ourCampaignIds.length > 0) {
    score += 60;
    signals.push({
      key: 'campaign_hijack',
      label: 'Our-campaign overlap',
      severity: 'high',
      value: `${ourCampaignIds.length} campaign${ourCampaignIds.length > 1 ? 's' : ''}`,
      detail: `Signups carry gad_campaignid values belonging to Runable's Google Ads account (${ourCampaignIds.join(', ')}). This is strong evidence of possible commission cannibalization, but the landing URL and redirect chain should be reviewed before enforcement.`,
    });
  }

  if (sharedCampaignIds.length > 0) {
    score += 35;
    signals.push({
      key: 'shared_campaign_ring',
      label: 'Campaign ID shared across affiliates',
      severity: 'high',
      value: `${sharedCampaignIds.length} shared`,
      detail: `Google Ads campaign id(s) ${sharedCampaignIds.slice(0, 5).join(', ')} also appear under other affiliates' tokens. This can indicate one operator with multiple accounts, an agency, a shared redirect, or a tracking fault; corroboration is required.`,
    });
  }

  const brandTokens = tokens.filter(t => BRAND_ARBITRAGE_TOKENS.has(t.toLowerCase()));
  if (brandTokens.length > 0 && enoughVolume) {
    score += 20;
    signals.push({
      key: 'brand_token_name',
      label: 'Brand-arbitrage token name',
      severity: 'medium',
      value: brandTokens.join(', '),
      detail: `Token name is generic brand-intent bait (${brandTokens.join(', ')}) rather than a creator identity — typical of ads targeting people already searching for Runable.`,
    });
  }

  if (enoughVolume && organicSignups === 0 && adSignups > 0) {
    score += 15;
    signals.push({
      key: 'zero_organic',
      label: 'Zero organic signups',
      severity: 'medium',
      value: '0 organic',
      detail: 'Not a single signup arrived without ad click params. Real content/audience affiliates always have some direct or organic arrivals.',
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const band: AdRisk['band'] = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';

  return {
    score,
    band,
    signals,
    stats: {
      signups, adSignups, adPct, fts, pageviews, organicSignups,
      campaignIds, ourCampaignIds, sharedCampaignIds, tokens,
    },
  };
}

/** Build campaign_id -> owning affiliate ids from (token traffic, token->affiliate). */
export function buildCampaignOwners(
  trafficByToken: Map<string, TokenTraffic>,
  affiliateByToken: Map<string, string>,
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const [token, t] of trafficByToken) {
    const aff = affiliateByToken.get(token);
    if (!aff) continue;
    for (const cid of t.campaignIds) {
      if (!cid) continue;
      let set = owners.get(cid);
      if (!set) owners.set(cid, (set = new Set()));
      set.add(aff);
    }
  }
  return owners;
}

/**
 * Blend the ad score with the legacy referral-based score (self-referral,
 * refunds, shared customers still work — their columns are populated).
 * Ad evidence dominates; the legacy score can only add.
 */
export function blendScores(adScore: number, legacyScore: number): number {
  return Math.min(100, Math.round(adScore + legacyScore * (1 - adScore / 130)));
}
