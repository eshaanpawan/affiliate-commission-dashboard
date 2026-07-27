import { NextRequest, NextResponse } from 'next/server';
import { verifyRewardfulSignature } from '@/lib/verify-signature';
import { processWebhookEvent } from '@/lib/webhook-processor';
import sql from '@/lib/db';
import { createHash } from 'node:crypto';

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
  const eventId: string = payload?.event?.id
    ?? `body_${createHash('sha256').update(rawBody).digest('hex')}`;

  if (!eventType || !payload?.object) {
    return NextResponse.json({ error: 'Malformed Rewardful event' }, { status: 400 });
  }

  try {
    const inserted = await sql`
      INSERT INTO webhook_events (event_id, event_type, payload, processed, attempt_count)
      VALUES (${eventId}, ${eventType}, ${JSON.stringify(payload)}::jsonb, FALSE, 0)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      const [existing] = await sql`
        SELECT processed FROM webhook_events WHERE event_id = ${eventId}
      `;
      if (existing?.processed) {
        return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
      }
    }
  } catch (err) {
    console.error('Failed to store webhook event:', err);
    return NextResponse.json({ error: 'Could not persist webhook event' }, { status: 500 });
  }

  // Claim one processing attempt. Rewardful can retry the same delivery while
  // the first request is still running; without an atomic claim, both requests
  // would apply the event. A crashed worker becomes eligible again after 5 min.
  let claimed;
  try {
    claimed = await sql`
      UPDATE webhook_events
      SET processing_started_at = NOW(), processing_error = NULL,
          attempt_count = attempt_count + 1
      WHERE event_id = ${eventId}
        AND processed = FALSE
        AND (processing_started_at IS NULL OR processing_started_at < NOW() - INTERVAL '5 minutes')
      RETURNING id
    `;
  } catch (err) {
    console.error('Failed to claim webhook event:', err);
    return NextResponse.json({ error: 'Could not claim webhook event' }, { status: 500 });
  }
  if (claimed.length === 0) {
    const [existing] = await sql`
      SELECT processed FROM webhook_events WHERE event_id = ${eventId}
    `;
    return existing?.processed
      ? NextResponse.json({ received: true, duplicate: true }, { status: 200 })
      : NextResponse.json({ received: true, processing: true }, { status: 202 });
  }

  try {
    await processWebhookEvent(eventType, payload.object);
    await sql`
      UPDATE webhook_events
      SET processed = TRUE, processed_at = NOW(), processing_started_at = NULL,
          processing_error = NULL
      WHERE event_id = ${eventId}
    `;
  } catch (err) {
    console.error('Failed to process webhook event:', err);
    await sql`
      UPDATE webhook_events
      SET processed = FALSE, processing_started_at = NULL,
          processing_error = ${err instanceof Error ? err.message : String(err)}
      WHERE event_id = ${eventId}
    `.catch((updateError) => console.error('Failed to record webhook processing error:', updateError));
    return NextResponse.json({ error: 'Webhook processing failed; retry required' }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
