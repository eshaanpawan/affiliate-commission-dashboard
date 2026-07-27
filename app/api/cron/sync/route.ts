import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authToken = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || authToken !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const response = await fetch(`${origin}/api/sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({ error: 'Sync returned invalid JSON' }));
  return NextResponse.json(payload, { status: response.status });
}
