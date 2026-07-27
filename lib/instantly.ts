import 'server-only';

const INSTANTLY_BASE_URL = 'https://api.instantly.ai/api/v2';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_READ_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export const DEFAULT_INSTANTLY_AFFILIATE_CAMPAIGN_ID =
  '2fc18ca4-4de3-41e4-be9a-b7c17211010d';

export const DEFAULT_INSTANTLY_APPROVED_SENDERS = [
  'saksham@tryrunable.com',
  'marley@runable.uk',
  'shriya@getrunable.com',
  'nadia@runable.run',
  'sutton@runable.new',
  'naomiprice@runable.uk',
  'vera@runable.run',
  'yashwanth@tryrunable.com',
] as const;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export class InstantlyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstantlyConfigurationError';
  }
}

export class InstantlyApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options: { status: number; code?: string; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = 'InstantlyApiError';
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface InstantlyCursorPage<T> {
  items: T[];
  next_starting_after?: string | null;
}

export interface InstantlyAccount {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  status?: number | null;
  status_message?: string | null;
  warmup_status?: number | null;
  stat_warmup_score?: number | null;
  daily_limit?: number | null;
  daily_limit_max?: number | null;
  sending_gap?: number | null;
  setup_pending?: boolean | null;
  timestamp_created?: string | null;
  timestamp_last_used?: string | null;
  tags?: Array<{ id?: string; name?: string }> | null;
  [key: string]: unknown;
}

export interface InstantlyCampaignVariant {
  subject?: string | null;
  body?: string | null;
  [key: string]: unknown;
}

export interface InstantlyCampaignStep {
  type?: string | null;
  delay?: number | null;
  variants?: InstantlyCampaignVariant[] | null;
  [key: string]: unknown;
}

export interface InstantlyCampaignSequence {
  steps?: InstantlyCampaignStep[] | null;
  [key: string]: unknown;
}

export interface InstantlyCampaign {
  id: string;
  name?: string | null;
  status?: number | null;
  is_evergreen?: boolean | null;
  campaign_schedule?: {
    schedules?: Array<{
      name?: string | null;
      timing?: { from?: string | null; to?: string | null } | null;
      days?: Record<string, boolean> | null;
      timezone?: string | null;
    }> | null;
    start_date?: string | null;
    end_date?: string | null;
  } | null;
  email_gap?: number | null;
  random_wait_max?: number | null;
  text_only?: boolean | null;
  first_email_text_only?: boolean | null;
  daily_limit?: number | null;
  daily_max_leads?: number | null;
  stop_on_reply?: boolean | null;
  link_tracking?: boolean | null;
  open_tracking?: boolean | null;
  stop_on_auto_reply?: boolean | null;
  prioritize_new_leads?: boolean | null;
  match_lead_esp?: boolean | null;
  stop_for_company?: boolean | null;
  insert_unsubscribe_header?: boolean | null;
  allow_risky_contacts?: boolean | null;
  disable_bounce_protect?: boolean | null;
  email_list?: string[] | null;
  sequences?: InstantlyCampaignSequence[] | null;
  timestamp_created?: string | null;
  timestamp_updated?: string | null;
  [key: string]: unknown;
}

export interface InstantlyEmailBody {
  text?: string | null;
  html?: string | null;
}

export interface InstantlyEmail {
  id: string;
  thread_id?: string | null;
  message_id?: string | null;
  campaign_id?: string | null;
  lead_id?: string | null;
  lead?: string | null;
  eaccount?: string | null;
  from_address_email?: string | null;
  from_address_json?: JsonValue;
  to_address_email_list?: string | null;
  to_address_json?: JsonValue;
  cc_address_email_list?: string | null;
  bcc_address_email_list?: string | null;
  subject?: string | null;
  body?: InstantlyEmailBody | string | null;
  content_preview?: string | null;
  is_unread?: boolean | null;
  is_automated?: boolean | null;
  i_status?: number | null;
  email_type?: string | null;
  timestamp_email?: string | null;
  timestamp_created?: string | null;
  attachment_json?: JsonValue;
  [key: string]: unknown;
}

export interface InstantlyLead {
  id?: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  campaign_id?: string | null;
  list_id?: string | null;
  custom_variables?: Record<string, JsonValue> | null;
  [key: string]: unknown;
}

export interface InstantlyCampaignSendingStatus {
  status?: number | string | null;
  summary?: JsonValue;
  diagnostics?: JsonValue;
  [key: string]: unknown;
}

export interface CursorCollection<T> {
  items: T[];
  nextStartingAfter: string | null;
  pages: number;
  truncated: boolean;
}

interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  retry?: boolean;
}

function apiKey(): string {
  const key = process.env.INSTANTLY_API_KEY?.trim();
  if (!key) {
    throw new InstantlyConfigurationError('INSTANTLY_API_KEY is not configured');
  }
  return key;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function getInstantlyCampaignId(): string {
  const configured = process.env.INSTANTLY_AFFILIATE_CAMPAIGN_ID?.trim();
  const campaignId = configured || DEFAULT_INSTANTLY_AFFILIATE_CAMPAIGN_ID;
  if (!isUuid(campaignId)) {
    throw new InstantlyConfigurationError(
      'INSTANTLY_AFFILIATE_CAMPAIGN_ID must be a valid UUID',
    );
  }
  return campaignId;
}

export function getInstantlyApprovedSenders(): string[] {
  const configured = process.env.INSTANTLY_APPROVED_SENDERS?.trim();
  const candidates = configured
    ? configured.split(/[\n,]/)
    : [...DEFAULT_INSTANTLY_APPROVED_SENDERS];
  const senders = [...new Set(candidates.map((value) => value.trim().toLowerCase()).filter(Boolean))];

  if (senders.length === 0 || senders.some((sender) => !isEmail(sender))) {
    throw new InstantlyConfigurationError(
      'INSTANTLY_APPROVED_SENDERS must contain only valid email addresses',
    );
  }
  return senders;
}

export function isInstantlyApprovedSender(sender: string): boolean {
  return getInstantlyApprovedSenders().includes(sender.trim().toLowerCase());
}

function queryString(values: Record<string, string | number | boolean | string[] | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function safeMessage(payload: unknown, fallback: string): { message: string; code?: string } {
  if (!payload || typeof payload !== 'object') return { message: fallback };
  const record = payload as Record<string, unknown>;
  const rawMessage =
    typeof record.message === 'string'
      ? record.message
      : typeof record.error === 'string'
        ? record.error
        : fallback;
  const code = typeof record.code === 'string' ? record.code.slice(0, 100) : undefined;
  return { message: rawMessage.replace(/[\r\n]+/g, ' ').slice(0, 500), code };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function instantlyFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const retry = options.retry ?? (method === 'GET');
  const attempts = retry ? MAX_READ_ATTEMPTS : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${INSTANTLY_BASE_URL}${path}`, {
        ...options,
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey()}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      });
      const payload = await parseJson(response);
      if (response.ok) return payload as T;

      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
      const details = safeMessage(payload, `Instantly request failed with status ${response.status}`);
      const error = new InstantlyApiError(details.message, {
        status: response.status,
        code: details.code,
        retryAfterSeconds,
      });
      lastError = error;

      if (!retry || !RETRYABLE_STATUS_CODES.has(response.status) || attempt === attempts) {
        throw error;
      }
      const retryDelay = retryAfterSeconds
        ? Math.min(retryAfterSeconds * 1000, 20_000)
        : Math.min(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250), 5_000);
      await wait(retryDelay);
    } catch (error) {
      lastError = error;
      if (error instanceof InstantlyApiError || error instanceof InstantlyConfigurationError) {
        throw error;
      }
      if (!retry || attempt === attempts) {
        const message = error instanceof Error && error.name === 'AbortError'
          ? 'Instantly request timed out'
          : 'Unable to reach Instantly';
        throw new InstantlyApiError(message, { status: 503 });
      }
      await wait(Math.min(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250), 5_000));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new InstantlyApiError('Unable to reach Instantly', { status: 503 });
}

export async function collectCursorPages<T>(
  fetchPage: (startingAfter?: string) => Promise<InstantlyCursorPage<T>>,
  options: { maxPages?: number } = {},
): Promise<CursorCollection<T>> {
  const maxPages = Math.max(1, options.maxPages ?? 10);
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let startingAfter: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
    const page = await fetchPage(startingAfter);
    items.push(...(Array.isArray(page.items) ? page.items : []));
    pages += 1;
    const next = page.next_starting_after?.trim() || undefined;
    if (!next) {
      return { items, nextStartingAfter: null, pages, truncated: false };
    }
    if (seenCursors.has(next)) {
      throw new InstantlyApiError('Instantly returned a repeated pagination cursor', { status: 502 });
    }
    seenCursors.add(next);
    startingAfter = next;
  }

  return {
    items,
    nextStartingAfter: startingAfter ?? null,
    pages,
    truncated: Boolean(startingAfter),
  };
}

export interface ListAccountsOptions {
  limit?: number;
  startingAfter?: string;
  search?: string;
  status?: number;
  providerCode?: number;
  includeTags?: boolean;
}

export function listAccountsPage(options: ListAccountsOptions = {}): Promise<InstantlyCursorPage<InstantlyAccount>> {
  return instantlyFetch(
    `/accounts${queryString({
      limit: options.limit ?? 100,
      starting_after: options.startingAfter,
      search: options.search,
      status: options.status,
      provider_code: options.providerCode,
      include_tags: options.includeTags,
    })}`,
  );
}

export interface ListCampaignsOptions {
  limit?: number;
  startingAfter?: string;
  search?: string;
  status?: number;
  tagIds?: string[];
}

export function listCampaignsPage(options: ListCampaignsOptions = {}): Promise<InstantlyCursorPage<InstantlyCampaign>> {
  return instantlyFetch(
    `/campaigns${queryString({
      limit: options.limit ?? 100,
      starting_after: options.startingAfter,
      search: options.search,
      status: options.status,
      tag_ids: options.tagIds,
    })}`,
  );
}

export interface ListEmailsOptions {
  limit?: number;
  startingAfter?: string;
  search?: string;
  campaignId?: string;
  eaccount?: string;
  isUnread?: boolean;
  mode?: 'emode_focused' | 'emode_others' | 'emode_all';
  previewOnly?: boolean;
  sortOrder?: 'asc' | 'desc';
  emailType?: string;
  latestOfThread?: boolean;
  lead?: string;
  minTimestamp?: string;
  maxTimestamp?: string;
}

export function listEmailsPage(options: ListEmailsOptions = {}): Promise<InstantlyCursorPage<InstantlyEmail>> {
  return instantlyFetch(
    `/emails${queryString({
      limit: options.limit ?? 100,
      starting_after: options.startingAfter,
      search: options.search,
      campaign_id: options.campaignId,
      eaccount: options.eaccount,
      is_unread: options.isUnread,
      mode: options.mode,
      preview_only: options.previewOnly,
      sort_order: options.sortOrder,
      email_type: options.emailType,
      latest_of_thread: options.latestOfThread,
      lead: options.lead,
      min_timestamp: options.minTimestamp,
      max_timestamp: options.maxTimestamp,
    })}`,
  );
}

export interface ListLeadsOptions {
  campaignId?: string;
  listId?: string;
  limit?: number;
  startingAfter?: string;
  search?: string;
}

export function listLeadsPage(options: ListLeadsOptions = {}): Promise<InstantlyCursorPage<InstantlyLead>> {
  return instantlyFetch('/leads/list', {
    method: 'POST',
    retry: true,
    body: JSON.stringify({
      campaign: options.campaignId,
      list_id: options.listId,
      limit: options.limit ?? 100,
      starting_after: options.startingAfter,
      search: options.search,
    }),
  });
}

export function getCampaign(campaignId: string): Promise<InstantlyCampaign> {
  return instantlyFetch(`/campaigns/${encodeURIComponent(campaignId)}`);
}

export function getCampaignSendingStatus(
  campaignId: string,
  options: { withAiSummary?: boolean } = {},
): Promise<InstantlyCampaignSendingStatus> {
  return instantlyFetch(
    `/campaigns/${encodeURIComponent(campaignId)}/sending-status${queryString({
      with_ai_summary: options.withAiSummary ?? false,
    })}`,
  );
}

export function getEmail(emailId: string): Promise<InstantlyEmail> {
  return instantlyFetch(`/emails/${encodeURIComponent(emailId)}`);
}

export function countUnreadEmails(): Promise<{ count: number }> {
  return instantlyFetch('/emails/unread/count');
}

export interface AddLeadInput extends Omit<InstantlyLead, 'campaign_id' | 'list_id'> {
  email: string;
}

export async function bulkAddLeads(input: {
  leads: AddLeadInput[];
  campaignId?: string;
  listId?: string;
  skipIfInWorkspace?: boolean;
}): Promise<JsonValue> {
  if (input.leads.length < 1 || input.leads.length > 1_000) {
    throw new TypeError('Instantly bulk lead operations require 1 to 1000 leads');
  }
  if (!input.campaignId && !input.listId) {
    throw new TypeError('An Instantly campaignId or listId is required');
  }
  return instantlyFetch('/leads/add', {
    method: 'POST',
    retry: false,
    body: JSON.stringify({
      leads: input.leads,
      campaign_id: input.campaignId,
      list_id: input.listId,
      skip_if_in_workspace: input.skipIfInWorkspace ?? true,
    }),
  });
}

export function patchCampaign(
  campaignId: string,
  patch: Record<string, JsonValue | undefined>,
): Promise<InstantlyCampaign> {
  if (patch.status !== undefined) {
    throw new TypeError('Campaign status changes are not supported by this client');
  }
  return instantlyFetch(`/campaigns/${encodeURIComponent(campaignId)}`, {
    method: 'PATCH',
    retry: true,
    body: JSON.stringify(patch),
  });
}

export function patchAccount(
  accountEmail: string,
  patch: Record<string, JsonValue | undefined>,
): Promise<InstantlyAccount> {
  return instantlyFetch(`/accounts/${encodeURIComponent(accountEmail)}`, {
    method: 'PATCH',
    retry: true,
    body: JSON.stringify(patch),
  });
}

export interface ReplyToEmailInput {
  eaccount: string;
  replyToUuid: string;
  subject: string;
  text?: string;
  html?: string;
  additionalRecipients?: string[];
  ccAddressEmailList?: string;
  bccAddressEmailList?: string;
  reminderTs?: string;
  assignedTo?: string;
}

export function replyToEmail(input: ReplyToEmailInput): Promise<InstantlyEmail> {
  return instantlyFetch('/emails/reply', {
    method: 'POST',
    retry: false,
    body: JSON.stringify({
      eaccount: input.eaccount,
      reply_to_uuid: input.replyToUuid,
      subject: input.subject,
      body: { text: input.text, html: input.html },
      additional_recipients: input.additionalRecipients,
      cc_address_email_list: input.ccAddressEmailList,
      bcc_address_email_list: input.bccAddressEmailList,
      reminder_ts: input.reminderTs,
      assigned_to: input.assignedTo,
    }),
  });
}

export function markThreadRead(threadId: string): Promise<JsonValue> {
  return instantlyFetch(`/emails/threads/${encodeURIComponent(threadId)}/mark-as-read`, {
    method: 'POST',
    retry: true,
  });
}
