import { requireMailAuth } from '../_shared';
import { getOutreachCandidates } from '@/lib/outreach';

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  const candidates = await getOutreachCandidates();
  const headers = [
    'email', 'first_name', 'last_name', 'rewardful_affiliate_id', 'segment',
    'affiliate_status', 'review_status', 'risk_score', 'paid_conversions',
    'unpaid_commission_usd', 'source_updated_at',
  ];
  const lines = [headers.map(csvCell).join(',')];
  for (const candidate of candidates) {
    const custom = candidate.lead.custom_variables;
    lines.push([
      candidate.email,
      candidate.firstName,
      candidate.lastName,
      candidate.affiliateId,
      candidate.segment,
      custom.affiliate_status,
      custom.review_status,
      custom.risk_score,
      custom.paid_conversions,
      custom.unpaid_commission_usd,
      candidate.sourceUpdatedAt,
    ].map(csvCell).join(','));
  }
  return new Response(`\uFEFF${lines.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="runable-affiliates-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
