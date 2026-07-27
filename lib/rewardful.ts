// Minimal Rewardful API client.
//
// Auth: HTTP Basic with REWARDFUL_API_SECRET as username, empty password.
// Rate limit: ~45 requests / 30s — every request goes through throttle(),
// which enforces >= 700ms between calls process-wide.

const BASE = 'https://api.getrewardful.com/v1';
const MIN_INTERVAL_MS = 700;

let lastCallAt = 0;

/** Waits until at least 700ms have passed since the previous Rewardful call. */
export async function throttle(): Promise<void> {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

function authHeader(): string {
  const secret = process.env.REWARDFUL_API_SECRET;
  if (!secret) throw new Error('REWARDFUL_API_SECRET is not set');
  return 'Basic ' + Buffer.from(`${secret}:`).toString('base64');
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  await throttle();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Rewardful ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

interface RewardfulPage<T> {
  data: T[];
  pagination: {
    current_page: number;
    total_pages: number;
  };
}

interface RewardfulCommission {
  amount?: number | null;
  state?: string | null;
  due_at?: string | null;
  paid_at?: string | null;
  voided_at?: string | null;
}

export interface AffiliateCommissionSummary {
  dueCents: number;
  pendingCents: number;
  unpaidCents: number;
  paidCents: number;
  dueCount: number;
  pendingCount: number;
  paidCount: number;
  nextDueAt: string | null;
  fetchedAt: string;
}

export interface RewardfulAffiliate {
  id: string;
  state: string;
  [key: string]: unknown;
}

export async function getAffiliate(id: string): Promise<RewardfulAffiliate> {
  return request<RewardfulAffiliate>(`/affiliates/${id}`);
}

/**
 * Reads commission settlement state directly from Rewardful. The affiliate
 * snapshot only exposes a combined unpaid balance; this split is required to
 * distinguish money payable now from commissions that are still pending.
 */
export async function getAffiliateCommissionSummary(
  affiliateId: string,
): Promise<AffiliateCommissionSummary> {
  const commissions: RewardfulCommission[] = [];
  let page = 1;

  while (true) {
    const query = new URLSearchParams({
      affiliate_id: affiliateId,
      limit: '100',
      page: String(page),
    });
    const response = await request<RewardfulPage<RewardfulCommission>>(
      `/commissions?${query.toString()}`,
      { cache: 'no-store' },
    );
    commissions.push(...response.data);
    if (page >= response.pagination.total_pages) break;
    page += 1;
  }

  const now = Date.now();
  let dueCents = 0;
  let pendingCents = 0;
  let paidCents = 0;
  let dueCount = 0;
  let pendingCount = 0;
  let paidCount = 0;
  let nextDueAt: string | null = null;

  for (const commission of commissions) {
    const amount = Number(commission.amount ?? 0);
    const inferredState = commission.paid_at
      ? 'paid'
      : commission.voided_at
        ? 'voided'
        : commission.due_at && new Date(commission.due_at).getTime() <= now
          ? 'due'
          : 'pending';
    const state = String(commission.state ?? inferredState).toLowerCase();

    if (state === 'paid') {
      paidCents += amount;
      paidCount += 1;
    } else if (state === 'due') {
      dueCents += amount;
      dueCount += 1;
    } else if (!['voided', 'deleted'].includes(state)) {
      pendingCents += amount;
      pendingCount += 1;
      if (commission.due_at && (!nextDueAt || commission.due_at < nextDueAt)) {
        nextDueAt = commission.due_at;
      }
    }
  }

  return {
    dueCents,
    pendingCents,
    unpaidCents: dueCents + pendingCents,
    paidCents,
    dueCount,
    pendingCount,
    paidCount,
    nextDueAt,
    fetchedAt: new Date().toISOString(),
  };
}

export async function setAffiliateState(
  id: string,
  state: 'active' | 'disabled' | 'suspicious',
): Promise<RewardfulAffiliate> {
  return request<RewardfulAffiliate>(`/affiliates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ state }).toString(),
  });
}
