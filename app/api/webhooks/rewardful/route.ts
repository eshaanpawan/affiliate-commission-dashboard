import { NextRequest, NextResponse } from 'next/server';
import { verifyRewardfulSignature } from '@/lib/verify-signature';
import { processWebhookEvent } from '@/lib/webhook-processor';
import sql from '@/lib/db';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-rewardful-signature') ?? '';
  const secret = process.env.REWARDFUL_WEBHOOK_SECRET ?? '';

  if (!verifyRewardfulSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType: string = payload?.event?.type ?? '';
  const eventId: string = payload?.event?.id ?? '';

  // Store raw event
  try {
    await sql`
      INSERT INTO webhook_events (event_id, event_type, payload)
      VALUES (${eventId || null}, ${eventType}, ${payload})
      ON CONFLICT (event_id) DO NOTHING
    `;
  } catch (err) {
    console.error('Failed to store webhook event:', err);
  }

  // Process event
  try {
    await processWebhookEvent(eventType, payload.object);
  } catch (err) {
    console.error('Failed to process webhook event:', err);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
