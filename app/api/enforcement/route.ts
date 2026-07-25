import { NextResponse } from 'next/server';
import { desc, ne, sql } from 'drizzle-orm';
import { db, affiliates, enforcementLog } from '@/lib/db/index';
import { isAuthed } from '@/lib/auth';

// GET /api/enforcement — enforcement queue + recent audit log.
export async function GET(req: Request) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [queue, log] = await Promise.all([
    db
      .select({
        rewardfulId: affiliates.rewardfulId,
        firstName: affiliates.firstName,
        lastName: affiliates.lastName,
        email: affiliates.email,
        status: affiliates.status,
        unpaidCommissionCents: affiliates.unpaidCommissionCents,
        paidCommissionCents: affiliates.paidCommissionCents,
        riskScore: affiliates.riskScore,
        enforcementState: affiliates.enforcementState,
        enforcementReason: affiliates.enforcementReason,
        enforcementProposedAt: affiliates.enforcementProposedAt,
        enforcementAppliedAt: affiliates.enforcementAppliedAt,
        rewardfulStateBefore: affiliates.rewardfulStateBefore,
      })
      .from(affiliates)
      .where(sql`${affiliates.enforcementState} IS NOT NULL AND ${ne(affiliates.enforcementState, 'none')}`)
      .orderBy(desc(affiliates.enforcementProposedAt)),
    db
      .select()
      .from(enforcementLog)
      .orderBy(desc(enforcementLog.createdAt))
      .limit(200),
  ]);

  return NextResponse.json({ queue, log });
}
