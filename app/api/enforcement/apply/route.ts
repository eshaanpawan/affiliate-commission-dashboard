import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db, affiliates, enforcementLog } from '@/lib/db/index';
import { isAuthed } from '@/lib/auth';
import { getAffiliate, setAffiliateState } from '@/lib/rewardful';

// POST /api/enforcement/apply — the ONLY route that writes to Rewardful.
// Sets each proposed_ban affiliate to 'suspicious' in Rewardful, recording
// the prior state so /api/enforcement/revert can restore it.
export async function POST(req: Request) {
  if (!(await isAuthed(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { affiliateIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { affiliateIds } = body;
  if (
    !Array.isArray(affiliateIds) ||
    affiliateIds.length === 0 ||
    affiliateIds.length > 500 ||
    !affiliateIds.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    return NextResponse.json(
      { error: 'Body must be { affiliateIds: string[] (1-500) }' },
      { status: 400 },
    );
  }

  const proposed = await db
    .select({ rewardfulId: affiliates.rewardfulId })
    .from(affiliates)
    .where(
      and(
        inArray(affiliates.rewardfulId, affiliateIds as string[]),
        eq(affiliates.enforcementState, 'proposed_ban'),
      ),
    );
  const proposedIds = new Set(proposed.map((a) => a.rewardfulId));

  const results: { affiliateId: string; ok: boolean; error?: string; stateBefore?: string }[] = [];

  for (const id of affiliateIds as string[]) {
    if (!proposedIds.has(id)) {
      results.push({ affiliateId: id, ok: false, error: 'not in proposed_ban state' });
      continue;
    }
    try {
      // Rewardful client throttles internally (>=700ms between calls).
      const remote = await getAffiliate(id);
      const stateBefore = remote.state;
      await setAffiliateState(id, 'suspicious');
      await db
        .update(affiliates)
        .set({
          enforcementState: 'banned',
          enforcementAppliedAt: new Date(),
          rewardfulStateBefore: stateBefore,
        })
        .where(eq(affiliates.rewardfulId, id));
      await db.insert(enforcementLog).values({
        affiliateId: id,
        action: 'apply_ban',
        payload: { stateBefore, stateAfter: 'suspicious' },
        result: 'ok',
      });
      results.push({ affiliateId: id, ok: true, stateBefore });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.insert(enforcementLog).values({
        affiliateId: id,
        action: 'apply_ban',
        payload: null,
        result: `error: ${message}`,
      });
      results.push({ affiliateId: id, ok: false, error: message });
    }
  }

  return NextResponse.json({
    applied: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
