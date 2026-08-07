import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { isAuthed } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Paginated webhook event feed for the Live Events page.
export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const perPage = Math.min(100, Math.max(10, Number(params.get('perPage') ?? 50) || 50));
  const type = params.get('type') ?? '';
  const q = params.get('q') ?? '';
  const offset = (page - 1) * perPage;

  const typeFilter = type === 'dub' ? 'dub.%' : type === 'rewardful' ? '%' : '%';
  const [rows, [count], types] = await Promise.all([
    sql`
      SELECT event_id, event_type, received_at, processed, processing_error,
             payload->'data'->'partner'->>'name' AS dub_partner,
             payload->'object'->'affiliate'->>'email' AS rewardful_affiliate,
             payload->'data'->'customer'->>'email' AS dub_customer
      FROM webhook_events
      WHERE event_type LIKE ${typeFilter}
        AND (${type} <> 'rewardful' OR event_type NOT LIKE 'dub.%')
        AND (${q} = '' OR event_type ILIKE ${'%' + q + '%'} OR event_id ILIKE ${'%' + q + '%'})
      ORDER BY received_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*) AS total FROM webhook_events
      WHERE event_type LIKE ${typeFilter}
        AND (${type} <> 'rewardful' OR event_type NOT LIKE 'dub.%')
        AND (${q} = '' OR event_type ILIKE ${'%' + q + '%'} OR event_id ILIKE ${'%' + q + '%'})
    `,
    sql`
      SELECT event_type, COUNT(*) AS count FROM webhook_events
      GROUP BY event_type ORDER BY count DESC LIMIT 30
    `,
  ]);

  return NextResponse.json({
    events: rows,
    total: Number(count?.total ?? 0),
    page,
    perPage,
    typeBreakdown: types.map((t) => ({ type: String(t.event_type), count: Number(t.count) })),
  });
}
