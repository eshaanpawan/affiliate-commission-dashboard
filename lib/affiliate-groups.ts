export const AFFILIATE_GROUP_IDS = [
  'brand_bidding_review',
  'high_risk_review',
  'good_performers',
  'new_unproven',
  'dormant',
  'developing_partners',
  'all_emailable',
] as const;

export type AffiliateGroupId = (typeof AFFILIATE_GROUP_IDS)[number];
export type PrimaryAffiliateGroupId = Exclude<AffiliateGroupId, 'all_emailable'>;

export const AFFILIATE_GROUP_PRIORITY: readonly PrimaryAffiliateGroupId[] = [
  'brand_bidding_review',
  'high_risk_review',
  'good_performers',
  'new_unproven',
  'dormant',
  'developing_partners',
] as const;

export const AFFILIATE_GROUP_POLICY = {
  evidenceWindowDays: 180,
  newWindowDays: 30,
  dormantMinimumAgeDays: 90,
  goodPerformerMinimumConversions: 3,
} as const;

export interface AffiliateGroupFacts {
  brandBiddingEvidence: boolean;
  segment: string;
  conversions: number;
  joinedAt: string | null;
}

export interface AffiliateGroupDefinition {
  id: AffiliateGroupId;
  label: string;
  description: string;
  criteria: readonly string[];
  safety: string;
  safetyLevel: 'safe' | 'review' | 'restricted';
  selectable: boolean;
}

export const AFFILIATE_GROUP_DEFINITIONS: readonly AffiliateGroupDefinition[] = [
  {
    id: 'brand_bidding_review',
    label: 'Brand-bidding evidence',
    description: 'Affiliates with stored Runable-brand or owned-campaign evidence that requires human review.',
    criteria: [
      'At least one evidence match in the last 180 days: a Runable-owned campaign ID in PostHog or an explicit Runable UTM term/campaign.',
      'A manual brand_bidding fraud tag also qualifies, regardless of event age.',
      'Evidence is a review trigger, not automatic proof that the affiliate bought the ad.',
    ],
    safety: 'Review before contact',
    safetyLevel: 'restricted',
    selectable: true,
  },
  {
    id: 'high_risk_review',
    label: 'High-risk / fraud review',
    description: 'Risk-scored or manually flagged affiliates without the stronger brand-bidding evidence above.',
    criteria: [
      'Current outreach segment is risk_review_high or risk_review_medium.',
      'The segment combines saved review/enforcement state with the 180-day PostHog traffic-risk score.',
      'Brand-bidding-evidence members are removed first so the operating cohorts do not duplicate people.',
    ],
    safety: 'Restricted review',
    safetyLevel: 'restricted',
    selectable: true,
  },
  {
    id: 'good_performers',
    label: 'Good-performing / low-risk',
    description: 'Established affiliates with meaningful conversions and no higher-priority risk evidence.',
    criteria: [
      'At least 3 lifetime Rewardful conversions.',
      'No brand-bidding evidence and no current high/medium risk-review segment.',
      'Use for partner growth drafts; conversion volume does not by itself prove incremental value.',
    ],
    safety: 'Growth eligible',
    safetyLevel: 'safe',
    selectable: true,
  },
  {
    id: 'new_unproven',
    label: 'New / unproven',
    description: 'Recently joined affiliates who have not yet produced a conversion.',
    criteria: [
      'Joined in the last 30 days and has 0 lifetime Rewardful conversions.',
      'No brand-bidding evidence and no current high/medium risk-review segment.',
      'Use for onboarding and enablement drafts, not enforcement.',
    ],
    safety: 'Onboarding only',
    safetyLevel: 'safe',
    selectable: true,
  },
  {
    id: 'dormant',
    label: 'Dormant',
    description: 'Older affiliates with no recorded conversions and no higher-priority risk evidence.',
    criteria: [
      'Joined at least 90 days ago and has 0 lifetime Rewardful conversions.',
      'No brand-bidding evidence and no current high/medium risk-review segment.',
      'Use for reactivation or exit-review drafts; inactivity alone is not fraud.',
    ],
    safety: 'Reactivation eligible',
    safetyLevel: 'review',
    selectable: true,
  },
  {
    id: 'developing_partners',
    label: 'Developing partners',
    description: 'Lower-risk affiliates still between the onboarding, growth, and dormant thresholds.',
    criteria: [
      'Has 1–2 lifetime conversions, or has 0 conversions but is not new (0–30 days) or dormant (90+ days).',
      'Also includes affiliates with an unknown join date that meet no higher-priority cohort.',
      'No brand-bidding evidence and no current high/medium risk-review segment.',
    ],
    safety: 'Nurture eligible',
    safetyLevel: 'safe',
    selectable: true,
  },
  {
    id: 'all_emailable',
    label: 'All emailable affiliates',
    description: 'Every active, non-deleted affiliate with a syntactically valid email address.',
    criteria: [
      'Rewardful affiliate is not deleted and has a valid email address.',
      'This is an intentional superset of every operating cohort, including risk-review contacts.',
      'Review exclusions before using this broad audience; selecting it does not import or send anything.',
    ],
    safety: 'Mixed evidence',
    safetyLevel: 'review',
    selectable: true,
  },
] as const;

export function isAffiliateGroupId(value: unknown): value is AffiliateGroupId {
  return typeof value === 'string'
    && (AFFILIATE_GROUP_IDS as readonly string[]).includes(value);
}

function ageInDays(joinedAt: string | null, now: Date): number | null {
  if (!joinedAt) return null;
  const joined = new Date(joinedAt);
  if (Number.isNaN(joined.getTime())) return null;
  return Math.floor((now.getTime() - joined.getTime()) / 86_400_000);
}

/**
 * Assigns at most one operational cohort. `all_emailable` is intentionally not
 * returned because it is the superset rather than an operating cohort.
 */
export function classifyPrimaryAffiliateGroup(
  facts: AffiliateGroupFacts,
  now = new Date(),
): PrimaryAffiliateGroupId | null {
  if (facts.brandBiddingEvidence) return 'brand_bidding_review';
  if (facts.segment === 'risk_review_high' || facts.segment === 'risk_review_medium') {
    return 'high_risk_review';
  }
  if (Math.max(0, facts.conversions) >= AFFILIATE_GROUP_POLICY.goodPerformerMinimumConversions) {
    return 'good_performers';
  }

  const age = ageInDays(facts.joinedAt, now);
  if (
    Math.max(0, facts.conversions) === 0
    && age !== null
    && age >= 0
    && age <= AFFILIATE_GROUP_POLICY.newWindowDays
  ) return 'new_unproven';
  if (
    Math.max(0, facts.conversions) === 0
    && age !== null
    && age >= AFFILIATE_GROUP_POLICY.dormantMinimumAgeDays
  ) return 'dormant';
  return 'developing_partners';
}

export function belongsToAffiliateGroup(
  groupId: AffiliateGroupId,
  facts: AffiliateGroupFacts,
  now = new Date(),
): boolean {
  if (groupId === 'all_emailable') return true;
  return classifyPrimaryAffiliateGroup(facts, now) === groupId;
}
