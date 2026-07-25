import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, affiliates, commissionHolds, enforcementLog } from '@/lib/db/index';
import { isAuthed } from '@/lib/auth';

// GET /api/holds — all commission holds with affiliate identity attached.
export async function GET(req: Request) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const holds = await db
    .select({
      id: commissionHolds.id,
      affiliateId: commissionHolds.affiliateId,
      amountCents: commissionHolds.amountCents,
      reason: commissionHolds.reason,
      status: commissionHolds.status,
      decidedBy: commissionHolds.decidedBy,
      decidedAt: commissionHolds.decidedAt,
      createdAt: commissionHolds.createdAt,
      firstName: affiliates.firstName,
      lastName: affiliates.lastName,
      email: affiliates.email,
      unpaidCommissionCents: affiliates.unpaidCommissionCents,
    })
    .from(commissionHolds)
    .leftJoin(affiliates, eq(affiliates.rewardfulId, commissionHolds.affiliateId))
    .orderBy(desc(commissionHolds.createdAt));

  return NextResponse.json({ holds });
}

const DECISIONS = ['released', 'held', 'voided'] as const;
type Decision = (typeof DECISIONS)[number];

// POST /api/holds — record a payout decision on a hold.
export async function POST(req: Request) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { affiliateId?: unknown; decision?: unknown; decidedBy?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { affiliateId, decision, decidedBy } = body;
  if (
    typeof affiliateId !== 'string' ||
    affiliateId.length === 0 ||
    !DECISIONS.includes(decision as Decision) ||
    (decidedBy !== undefined && typeof decidedBy !== 'string')
  ) {
    return NextResponse.json(
      { error: "Body must be { affiliateId: string, decision: 'released'|'held'|'voided', decidedBy?: string }" },
      { status: 400 },
    );
  }

  const updated = await db
    .update(commissionHolds)
    .set({
      status: decision as Decision,
      decidedAt: new Date(),
      decidedBy: (decidedBy as string | undefined) ?? 'dashboard',
    })
    .where(eq(commissionHolds.affiliateId, affiliateId))
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: 'No hold found for that affiliate' }, { status: 404 });
  }

  await db.insert(enforcementLog).values({
    affiliateId,
    action: `hold_${decision}`,
    payload: { amountCents: updated[0].amountCents },
    result: 'ok',
  });

  return NextResponse.json({ hold: updated[0] });
}
