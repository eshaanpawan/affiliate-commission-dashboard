export const DASHBOARD_RANGES = ['24h', '7d', '30d', '90d', 'all'] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DASHBOARD_RANGE_LABELS: Record<DashboardRange, string> = {
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  all: 'All time',
};

export function isDashboardRange(value: string | null | undefined): value is DashboardRange {
  return DASHBOARD_RANGES.includes(value as DashboardRange);
}

export function dashboardRangeStart(range: DashboardRange, now = new Date()): string | null {
  if (range === 'all') return null;
  if (range === '24h') return new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const days = Number.parseInt(range, 10);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayUtc - (days - 1) * 86_400_000).toISOString();
}

export function dashboardRangeDescription(range: DashboardRange): string {
  if (range === 'all') return 'All recorded history';
  if (range === '24h') return 'Last 24 hours';
  return `Last ${Number.parseInt(range, 10)} days`;
}
