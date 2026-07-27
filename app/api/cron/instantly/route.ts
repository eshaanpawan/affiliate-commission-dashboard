import { NextResponse } from 'next/server';
import { drainOutreachQueueFully } from '@/lib/outreach-sync';
import { outreachSyncSummary } from '@/lib/outreach';

export const maxDuration = 120;

export async function GET(req: Request) {
  const authorization = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const batch = await drainOutreachQueueFully({ maxBatches: 3 });
    return NextResponse.json({ ok: true, batch, sync: await outreachSyncSummary() });
  } catch (error) {
    console.error('[instantly-cron] contact reconciliation failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Instantly contact reconciliation failed' }, { status: 502 });
  }
}
