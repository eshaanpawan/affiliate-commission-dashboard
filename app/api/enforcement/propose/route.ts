import { NextResponse } from 'next/server';
import { and, inArray, sql } from 'drizzle-orm';
import { db, affiliates, enforcementLog, commissionHolds } from '@/lib/db/index';
import { isAuthed } from '@/lib/auth';

// POST /api/enforcement/propose — mark affiliates as proposed_ban and freeze
// their unpaid commission balance in commission_holds. No Rewardful writes.
export async function POST(req: Request) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { affiliateIds?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { affiliateIds, reason } = body;
  if (
    !Array.isArray(affiliateIds) ||
    affiliateIds.length === 0 ||
    affiliateIds.length > 500 ||
    !affiliateIds.every((id) => typeof id === 'string' && id.length > 0) ||
    typeof reason !== 'string' ||
    reason.trim().length === 0
  ) {
    return NextResponse.json(
      { error: 'Body must be { affiliateIds: string[] (1-500), reason: string }' },
      { status: 400 },
    );
  }

  const updated = await db
    .update(affiliates)
    .set({
      enforcementState: 'proposed_ban',
      enforcementReason: reason,
      enforcementProposedAt: new Date(),
    })
    .where(
      and(
        inArray(affiliates.rewardfulId, affiliateIds as string[]),
        sql`${affiliates.enforcementState} IS DISTINCT FROM 'banned'`,
      ),
    )
    .returning({
      rewardfulId: affiliates.rewardfulId,
      unpaidCommissionCents: affiliates.unpaidCommissionCents,
    });

  if (updated.length > 0) {
    await db.insert(enforcementLog).values(
      updated.map((a) => ({
        affiliateId: a.rewardfulId,
        action: 'propose_ban',
        payload: { reason },
        result: 'ok',
      })),
    );
    await db
      .insert(commissionHolds)
      .values(
        updated.map((a) => ({
          affiliateId: a.rewardfulId,
          amountCents: a.unpaidCommissionCents ?? 0,
          reason,
        })),
      )
      .onConflictDoNothing({ target: commissionHolds.affiliateId });
  }

  return NextResponse.json({
    requested: affiliateIds.length,
    proposed: updated.length,
    skipped: affiliateIds.length - updated.length,
  });
}
