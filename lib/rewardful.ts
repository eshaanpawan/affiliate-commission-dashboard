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

export interface RewardfulAffiliate {
  id: string;
  state: string;
  [key: string]: unknown;
}

export async function getAffiliate(id: string): Promise<RewardfulAffiliate> {
  return request<RewardfulAffiliate>(`/affiliates/${id}`);
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
