import {
  getCampaign,
  getInstantlyCampaignId,
  patchCampaign,
  type InstantlyCampaign,
  type JsonValue,
} from '@/lib/instantly';
import sql from '@/lib/db';
import { mailJson, mailRouteError, requireMailAuth } from '../_shared';

export const dynamic = 'force-dynamic';

type DelayUnit = 'minutes' | 'hours' | 'days';

interface SequenceVariant {
  subject: string;
  body: string;
  v_disabled: boolean;
}

interface SequenceStep {
  type: 'email';
  delay: number;
  delay_unit: DelayUnit;
  variants: SequenceVariant[];
}

// Instantly's async sanitizer strips plain-text bodies with bare newlines
// (subject survives, body comes back empty minutes later). Store bodies as
// HTML paragraphs and convert back to plain text for the editor.
function textToHtml(text: string): string {
  const escape = (value: string) => value
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escape(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function htmlToText(html: string): string {
  if (!/[<>]/.test(html)) return html;
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?div[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeCampaign(campaign: InstantlyCampaign) {
  const rawSteps = campaign.sequences?.[0]?.steps ?? [];
  return {
    campaign: {
      id: campaign.id,
      name: campaign.name ?? null,
      status: campaign.status ?? null,
      updatedAt: campaign.timestamp_updated ?? null,
    },
    steps: rawSteps.map((step) => ({
      type: 'email' as const,
      delay: Math.max(0, Number(step.delay ?? 0)),
      delayUnit: step.delay_unit === 'minutes' || step.delay_unit === 'hours' ? step.delay_unit : 'days',
      variants: (step.variants ?? []).map((variant) => ({
        subject: String(variant.subject ?? ''),
        body: htmlToText(String(variant.body ?? '')),
        disabled: variant.v_disabled === true,
      })),
    })),
  };
}

function parseSteps(value: unknown): { steps?: SequenceStep[]; error?: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    return { error: 'A sequence must contain between 1 and 10 email steps.' };
  }

  const steps: SequenceStep[] = [];
  for (let stepIndex = 0; stepIndex < value.length; stepIndex += 1) {
    const input = value[stepIndex];
    if (!input || typeof input !== 'object') return { error: `Step ${stepIndex + 1} is invalid.` };
    const record = input as Record<string, unknown>;
    const delay = Number(record.delay);
    const delayUnit = record.delayUnit;
    if (!Number.isInteger(delay) || delay < 0 || delay > 90) {
      return { error: `Step ${stepIndex + 1} delay must be a whole number from 0 to 90.` };
    }
    if (delayUnit !== 'minutes' && delayUnit !== 'hours' && delayUnit !== 'days') {
      return { error: `Step ${stepIndex + 1} has an invalid delay unit.` };
    }
    if (!Array.isArray(record.variants) || record.variants.length < 1 || record.variants.length > 5) {
      return { error: `Step ${stepIndex + 1} must have between 1 and 5 variants.` };
    }

    const variants: SequenceVariant[] = [];
    for (let variantIndex = 0; variantIndex < record.variants.length; variantIndex += 1) {
      const inputVariant = record.variants[variantIndex];
      if (!inputVariant || typeof inputVariant !== 'object') {
        return { error: `Step ${stepIndex + 1}, variant ${variantIndex + 1} is invalid.` };
      }
      const variant = inputVariant as Record<string, unknown>;
      const subject = String(variant.subject ?? '').trim();
      const body = String(variant.body ?? '').trim();
      if (!subject || subject.length > 500) {
        return { error: `Step ${stepIndex + 1}, variant ${variantIndex + 1} needs a subject under 500 characters.` };
      }
      if (!body || body.length > 50_000) {
        return { error: `Step ${stepIndex + 1}, variant ${variantIndex + 1} needs a body under 50,000 characters.` };
      }
      variants.push({ subject, body, v_disabled: variant.disabled === true });
    }
    steps.push({ type: 'email', delay, delay_unit: delayUnit, variants });
  }
  return { steps };
}

export async function GET(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;
  try {
    return mailJson(normalizeCampaign(await getCampaign(getInstantlyCampaignId())));
  } catch (error) {
    return mailRouteError(error);
  }
}

export async function PATCH(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;

  let body: { confirm?: unknown; steps?: unknown };
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body.' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit draft-save confirmation is required.', required: { confirm: true } }, 409);
  }
  const parsed = parseSteps(body.steps);
  if (!parsed.steps) return mailJson({ error: parsed.error }, 400);

  try {
    const campaignId = getInstantlyCampaignId();
    const current = await getCampaign(campaignId);
    if (current.status !== 0 && current.status !== 2) {
      return mailJson({ error: 'Sequence editing is blocked unless the campaign is Draft or Paused.' }, 409);
    }
    const htmlSteps = parsed.steps.map((step) => ({
      ...step,
      variants: step.variants.map((variant) => ({ ...variant, body: textToHtml(variant.body) })),
    }));
    const sequences = [{ steps: htmlSteps }] as unknown as JsonValue;
    const campaign = await patchCampaign(campaignId, { sequences });
    if (campaign.status !== 0 && campaign.status !== 2) {
      return mailJson({ error: 'Instantly returned an unsafe campaign state after saving.' }, 409);
    }
    const variants = parsed.steps.reduce((total, step) => total + step.variants.length, 0);
    await sql`
      INSERT INTO outreach_events (campaign_id, event_type, status, payload)
      VALUES (
        ${campaignId}, 'instantly_sequence_draft_saved', 'ok',
        ${JSON.stringify({ steps: parsed.steps.length, variants })}::jsonb
      )
    `;
    return mailJson({
      ok: true,
      safety: 'Sequence copy was saved, but the campaign was not activated and no email was sent.',
      ...normalizeCampaign(campaign),
    });
  } catch (error) {
    return mailRouteError(error);
  }
}
