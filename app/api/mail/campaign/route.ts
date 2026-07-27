import {
  getCampaign,
  getInstantlyApprovedSenders,
  getInstantlyCampaignId,
  patchAccount,
  patchCampaign,
  type JsonValue,
} from '@/lib/instantly';
import sql from '@/lib/db';
import { mailJson, mailRouteError, requireMailAuth } from '../_shared';

interface ConfigureBody {
  confirm?: unknown;
  emailList?: unknown;
  dailyPerAccount?: unknown;
  dailyMaxLeads?: unknown;
  stopOnReply?: unknown;
  stopOnAutoReply?: unknown;
  stopForCompany?: unknown;
  openTracking?: unknown;
  linkTracking?: unknown;
  textOnly?: unknown;
  firstEmailTextOnly?: unknown;
  prioritizeNewLeads?: unknown;
  matchLeadEsp?: unknown;
  insertUnsubscribeHeader?: unknown;
  allowRiskyContacts?: unknown;
  bounceProtection?: unknown;
  isEvergreen?: unknown;
  emailGap?: unknown;
  randomWaitMax?: unknown;
  schedule?: unknown;
  sequences?: unknown;
}

function validSequences(value: unknown): value is JsonValue {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 1) return false;
  const serialized = JSON.stringify(value);
  return serialized.length <= 250_000;
}

const BOOLEAN_FIELDS = [
  'stopOnReply',
  'stopOnAutoReply',
  'stopForCompany',
  'openTracking',
  'linkTracking',
  'textOnly',
  'firstEmailTextOnly',
  'prioritizeNewLeads',
  'matchLeadEsp',
  'insertUnsubscribeHeader',
  'allowRiskyContacts',
  'bounceProtection',
  'isEvergreen',
] as const satisfies readonly (keyof ConfigureBody)[];

function integerInRange(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function scheduleDays(value: unknown): Record<string, boolean> | null {
  const result: Record<string, boolean> = {};
  if (Array.isArray(value)) {
    const selected = new Set(value);
    if ([...selected].some((day) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)) return null;
    for (let day = 0; day <= 6; day += 1) result[String(day)] = selected.has(day);
  } else if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    if (Object.keys(source).some((key) => !/^[0-6]$/.test(key) || typeof source[key] !== 'boolean')) return null;
    for (let day = 0; day <= 6; day += 1) result[String(day)] = source[String(day)] === true;
  } else {
    return null;
  }
  return Object.values(result).some(Boolean) ? result : null;
}

function normalizeSchedule(value: unknown): { schedule?: JsonValue; error?: string } {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'schedule must be an object.' };
  }
  const root = value as Record<string, unknown>;
  const rawSchedules = Array.isArray(root.schedules) ? root.schedules : [root];
  if (rawSchedules.length < 1 || rawSchedules.length > 3) {
    return { error: 'schedule must contain between one and three sending windows.' };
  }
  const schedules: JsonValue[] = [];
  for (let index = 0; index < rawSchedules.length; index += 1) {
    const raw = rawSchedules[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: `schedule window ${index + 1} is invalid.` };
    }
    const window = raw as Record<string, unknown>;
    const timing = window.timing && typeof window.timing === 'object' && !Array.isArray(window.timing)
      ? window.timing as Record<string, unknown>
      : window;
    const from = timing.from;
    const to = timing.to;
    const timezone = window.timezone ?? root.timezone;
    const days = scheduleDays(window.days ?? root.days);
    if (!validTime(from) || !validTime(to) || from >= to) {
      return { error: `schedule window ${index + 1} requires a valid from/to range.` };
    }
    if (!validTimezone(timezone)) {
      return { error: `schedule window ${index + 1} requires a valid IANA timezone.` };
    }
    if (!days) {
      return { error: `schedule window ${index + 1} requires at least one valid weekday.` };
    }
    const name = typeof window.name === 'string' && window.name.trim()
      ? window.name.trim().slice(0, 80)
      : `Sending window ${index + 1}`;
    schedules.push({ name, timing: { from, to }, days, timezone });
  }

  const startDate = root.start_date ?? root.startDate;
  const endDate = root.end_date ?? root.endDate;
  if (startDate !== undefined && startDate !== null && !validDate(startDate)) {
    return { error: 'schedule startDate must be YYYY-MM-DD.' };
  }
  if (endDate !== undefined && endDate !== null && !validDate(endDate)) {
    return { error: 'schedule endDate must be YYYY-MM-DD.' };
  }
  if (typeof startDate === 'string' && typeof endDate === 'string' && startDate > endDate) {
    return { error: 'schedule endDate cannot be earlier than startDate.' };
  }
  return {
    schedule: {
      schedules,
      start_date: typeof startDate === 'string' ? startDate : null,
      end_date: typeof endDate === 'string' ? endDate : null,
    },
  };
}

export async function PATCH(req: Request) {
  const unauthorized = await requireMailAuth(req);
  if (unauthorized) return unauthorized;
  let body: ConfigureBody;
  try {
    body = await req.json();
  } catch {
    return mailJson({ error: 'Invalid JSON body' }, 400);
  }
  if (body.confirm !== true) {
    return mailJson({ error: 'Explicit confirmation is required', required: { confirm: true } }, 409);
  }

  const invalidBoolean = BOOLEAN_FIELDS.find(
    (field) => body[field] !== undefined && typeof body[field] !== 'boolean',
  );
  if (invalidBoolean) {
    return mailJson({ error: `${invalidBoolean} must be a boolean.` }, 400);
  }

  const approved = new Set(getInstantlyApprovedSenders());
  const emailList = Array.isArray(body.emailList)
    ? [...new Set(body.emailList.map((email) => String(email).trim().toLowerCase()))]
    : [];
  if (emailList.length < 1 || emailList.length > approved.size || emailList.some((email) => !approved.has(email))) {
    return mailJson({ error: 'Choose one or more approved sender accounts.' }, 400);
  }
  const dailyPerAccount = integerInRange(body.dailyPerAccount ?? 30, 1, 30);
  if (dailyPerAccount === null) {
    return mailJson({ error: 'dailyPerAccount must be an integer from 1 to 30.' }, 400);
  }
  const capacity = dailyPerAccount * emailList.length;
  const dailyMaxLeads = integerInRange(body.dailyMaxLeads ?? capacity, 1, capacity);
  if (dailyMaxLeads === null) {
    return mailJson({ error: `dailyMaxLeads must be an integer from 1 to ${capacity}.` }, 400);
  }
  const emailGap = body.emailGap === undefined ? undefined : integerInRange(body.emailGap, 1, 120);
  if (body.emailGap !== undefined && emailGap === null) {
    return mailJson({ error: 'emailGap must be an integer from 1 to 120 minutes.' }, 400);
  }
  const randomWaitMax = body.randomWaitMax === undefined
    ? undefined
    : integerInRange(body.randomWaitMax, 0, 120);
  if (body.randomWaitMax !== undefined && randomWaitMax === null) {
    return mailJson({ error: 'randomWaitMax must be an integer from 0 to 120 minutes.' }, 400);
  }
  const normalizedSchedule = normalizeSchedule(body.schedule);
  if (normalizedSchedule.error) {
    return mailJson({ error: normalizedSchedule.error }, 400);
  }
  if (!validSequences(body.sequences)) {
    return mailJson({ error: 'Sequences must be a reasonably sized JSON array.' }, 400);
  }

  try {
    const campaignId = getInstantlyCampaignId();
    const current = await getCampaign(campaignId);
    if (current.status !== 0 && current.status !== 2) {
      return mailJson({ error: 'Configuration is blocked unless the campaign is Draft or Paused.' }, 409);
    }

    const accountResults: { email: string; dailyLimit: number }[] = [];
    for (const email of emailList) {
      const account = await patchAccount(email, { daily_limit: dailyPerAccount });
      accountResults.push({ email, dailyLimit: Number(account.daily_limit ?? dailyPerAccount) });
    }
    const patch: Record<string, JsonValue | undefined> = {
      email_list: emailList,
      daily_limit: capacity,
      daily_max_leads: dailyMaxLeads,
      stop_on_reply: body.stopOnReply === false ? false : true,
      sequences: body.sequences as JsonValue | undefined,
      campaign_schedule: normalizedSchedule.schedule,
      email_gap: emailGap ?? undefined,
      random_wait_max: randomWaitMax ?? undefined,
      stop_on_auto_reply: body.stopOnAutoReply as boolean | undefined,
      stop_for_company: body.stopForCompany as boolean | undefined,
      open_tracking: body.openTracking as boolean | undefined,
      link_tracking: body.linkTracking as boolean | undefined,
      text_only: body.textOnly as boolean | undefined,
      first_email_text_only: body.firstEmailTextOnly as boolean | undefined,
      prioritize_new_leads: body.prioritizeNewLeads as boolean | undefined,
      match_lead_esp: body.matchLeadEsp as boolean | undefined,
      insert_unsubscribe_header: body.insertUnsubscribeHeader as boolean | undefined,
      allow_risky_contacts: body.allowRiskyContacts as boolean | undefined,
      disable_bounce_protect: body.bounceProtection === undefined
        ? undefined
        : body.bounceProtection !== true,
      is_evergreen: body.isEvergreen as boolean | undefined,
    };
    const campaign = await patchCampaign(campaignId, patch);
    await sql`
      INSERT INTO outreach_events (campaign_id, event_type, status, payload)
      VALUES (
        ${campaignId}, 'instantly_campaign_configured', 'ok',
        ${JSON.stringify({
          emailList,
          dailyPerAccount,
          dailyMaxLeads,
          stopOnReply: patch.stop_on_reply,
          scheduleChanged: normalizedSchedule.schedule !== undefined,
          advancedControlsChanged: BOOLEAN_FIELDS.filter((field) => body[field] !== undefined),
        })}::jsonb
      )
    `;
    return mailJson({
      ok: true,
      safety: 'Campaign remains Draft or Paused; no email was sent.',
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        emailList: campaign.email_list,
        dailyLimit: campaign.daily_limit,
        dailyMaxLeads: campaign.daily_max_leads,
        schedule: campaign.campaign_schedule ?? null,
        emailGap: campaign.email_gap ?? null,
        randomWaitMax: campaign.random_wait_max ?? null,
        stopOnReply: campaign.stop_on_reply !== false,
        stopOnAutoReply: campaign.stop_on_auto_reply === true,
        stopForCompany: campaign.stop_for_company === true,
        openTracking: campaign.open_tracking !== false,
        linkTracking: campaign.link_tracking !== false,
        textOnly: campaign.text_only === true,
        firstEmailTextOnly: campaign.first_email_text_only === true,
        prioritizeNewLeads: campaign.prioritize_new_leads === true,
        matchLeadEsp: campaign.match_lead_esp === true,
        insertUnsubscribeHeader: campaign.insert_unsubscribe_header === true,
        allowRiskyContacts: campaign.allow_risky_contacts === true,
        bounceProtection: campaign.disable_bounce_protect !== true,
      },
      accounts: accountResults,
    });
  } catch (error) {
    return mailRouteError(error);
  }
}
