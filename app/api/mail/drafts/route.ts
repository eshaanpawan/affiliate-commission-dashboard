import sql from '@/lib/db';
import { mailJson, mailRouteError, requireMailAuth, safeString } from '../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

type DelayUnit = 'minutes' | 'hours' | 'days';
interface DraftVariant { subject: string; body: string; disabled: boolean }
interface DraftStep { type: 'email'; delay: number; delayUnit: DelayUnit; variants: DraftVariant[] }

interface DraftRow {
  id: string;
  name: string;
  steps: unknown;
  updated_at: string;
}

function parseSteps(value: unknown): { steps?: DraftStep[]; error?: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    return { error: 'A draft must contain between 1 and 10 email steps.' };
  }
  const steps: DraftStep[] = [];
  for (let stepIndex = 0; stepIndex < value.length; stepIndex += 1) {
    const record = value[stepIndex] as Record<string, unknown> | null;
    if (!record || typeof record !== 'object') return { error: `Step ${stepIndex + 1} is invalid.` };
    const delay = Math.max(0, Math.min(90, Number(record.delay ?? 0) || 0));
    const delayUnit = record.delayUnit === 'minutes' || record.delayUnit === 'hours' ? record.delayUnit : 'days';
    if (!Array.isArray(record.variants) || record.variants.length < 1 || record.variants.length > 5) {
      return { error: `Step ${stepIndex + 1} must have between 1 and 5 variants.` };
    }
    const variants: DraftVariant[] = [];
    for (let variantIndex = 0; variantIndex < record.variants.length; variantIndex += 1) {
      const variant = record.variants[variantIndex] as Record<string, unknown> | null;
      const subject = String(variant?.subject ?? '').trim();
      const body = String(variant?.body ?? '').trim();
      if (!subject || subject.length > 500) return { error: `Step ${stepIndex + 1}, variant ${variantIndex + 1} needs a subject under 500 characters.` };
      if (!body || body.length > 50_000) return { error: `Step ${stepIndex + 1}, variant ${variantIndex + 1} needs a body under 50,000 characters.` };
      variants.push({ subject, body, disabled: variant?.disabled === true });
    }
    steps.push({ type: 'email', delay, delayUnit, variants });
  }
  return { steps };
}

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;
  try {
    const rows = await sql`
      SELECT id, name, steps, updated_at FROM mail_drafts ORDER BY updated_at DESC
    ` as unknown as DraftRow[];
    return mailJson({
      drafts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        steps: row.steps,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return mailRouteError(error);
  }
}

/** Save (upsert by name) a named draft in the local database. Never touches Instantly. */
export async function POST(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  let body: { confirm?: unknown; name?: unknown; steps?: unknown };
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body.' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit confirmation is required.', required: { confirm: true } }, 409);
  }
  const name = safeString(body.name, 120);
  if (!name) return mailJson({ error: 'A draft name is required.' }, 400);
  const parsed = parseSteps(body.steps);
  if (!parsed.steps) return mailJson({ error: parsed.error }, 400);

  try {
    const rows = await sql`
      INSERT INTO mail_drafts (name, steps)
      VALUES (${name}, ${JSON.stringify(parsed.steps)}::jsonb)
      ON CONFLICT (name)
      DO UPDATE SET steps = EXCLUDED.steps, updated_at = NOW()
      RETURNING id, name, updated_at
    ` as unknown as DraftRow[];
    return mailJson({ ok: true, draft: { id: rows[0].id, name: rows[0].name, updatedAt: rows[0].updated_at } });
  } catch (error) {
    return mailRouteError(error);
  }
}

export async function DELETE(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;
  const url = new URL(req.url);
  const id = safeString(url.searchParams.get('id'), 100);
  if (!id) return mailJson({ error: 'A draft id is required.' }, 400);
  try {
    const rows = await sql`DELETE FROM mail_drafts WHERE id = ${id}::uuid RETURNING id` as unknown as { id: string }[];
    if (!rows.length) return mailJson({ error: 'Draft not found.' }, 404);
    return mailJson({ ok: true, id });
  } catch (error) {
    return mailRouteError(error);
  }
}
