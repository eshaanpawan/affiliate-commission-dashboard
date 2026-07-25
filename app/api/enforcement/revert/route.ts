import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db, affiliates, enforcementLog } from '@/lib/db/index';
import { isAuthed } from '@/lib/auth';
import { setAffiliateState } from '@/lib/rewardful';

// POST /api/enforcement/revert — undo a ban (restores the affiliate's prior
// Rewardful state) or clear a proposal (local-only, no Rewardful call).
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

  const rows = await db
    .select({
      rewardfulId: affiliates.rewardfulId,
      enforcementState: affiliates.enforcementState,
      rewardfulStateBefore: affiliates.rewardfulStateBefore,
    })
    .from(affiliates)
    .where(inArray(affiliates.rewardfulId, affiliateIds as string[]));
  const byId = new Map(rows.map((r) => [r.rewardfulId, r]));

  const results: { affiliateId: string; ok: boolean; action?: string; error?: string }[] = [];

  for (const id of affiliateIds as string[]) {
    const row = byId.get(id);
    if (!row) {
      results.push({ affiliateId: id, ok: false, error: 'affiliate not found' });
      continue;
    }
    if (row.enforcementState === 'banned') {
      const restoreTo = (row.rewardfulStateBefore ?? 'active') as 'active' | 'disabled' | 'suspicious';
      try {
        await setAffiliateState(id, restoreTo);
        await db
          .update(affiliates)
          .set({ enforcementState: 'cleared' })
          .where(eq(affiliates.rewardfulId, id));
        await db.insert(enforcementLog).values({
          affiliateId: id,
          action: 'revert',
          payload: { restoredState: restoreTo },
          result: 'ok',
        });
        results.push({ affiliateId: id, ok: true, action: 'revert' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.insert(enforcementLog).values({
          affiliateId: id,
          action: 'revert',
          payload: { restoredState: restoreTo },
          result: `error: ${message}`,
        });
        results.push({ affiliateId: id, ok: false, error: message });
      }
    } else if (row.enforcementState === 'proposed_ban') {
      await db
        .update(affiliates)
        .set({ enforcementState: 'cleared' })
        .where(eq(affiliates.rewardfulId, id));
      await db.insert(enforcementLog).values({
        affiliateId: id,
        action: 'clear_proposal',
        payload: null,
        result: 'ok',
      });
      results.push({ affiliateId: id, ok: true, action: 'clear_proposal' });
    } else {
      results.push({ affiliateId: id, ok: false, error: `nothing to revert (state: ${row.enforcementState})` });
    }
  }

  return NextResponse.json({
    reverted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
