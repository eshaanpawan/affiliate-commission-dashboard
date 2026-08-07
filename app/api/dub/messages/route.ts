import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';

// Server-side proxy for Dub's message center so the API key never reaches the
// browser. Requires the Dub key to have the `messages.read` / `messages.write`
// permissions — we surface a `needsPermission` flag instead of a hard error
// when the key is missing them.

const BASE = 'https://api.dub.co/messages';

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.DUB_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function passthrough(res: Response): Promise<NextResponse> {
  const body = await res.text();
  if (res.status === 403 || res.status === 401) {
    return NextResponse.json({ needsPermission: true, detail: body }, { status: 200 });
  }
  return new NextResponse(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.DUB_API_KEY) return NextResponse.json({ needsPermission: true }, { status: 200 });
  const partnerId = req.nextUrl.searchParams.get('partnerId');
  const url = partnerId ? `${BASE}?partnerId=${encodeURIComponent(partnerId)}` : BASE;
  const res = await fetch(url, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  return passthrough(res);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.DUB_API_KEY) return NextResponse.json({ needsPermission: true }, { status: 200 });
  const { partnerId, text } = await req.json().catch(() => ({}));
  if (!partnerId || !text?.trim()) {
    return NextResponse.json({ error: 'partnerId and text are required' }, { status: 400 });
  }
  const res = await fetch(BASE, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ partnerId, text }),
    signal: AbortSignal.timeout(15_000),
  });
  return passthrough(res);
}
