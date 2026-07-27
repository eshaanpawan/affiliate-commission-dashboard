'use client';

import * as React from 'react';
import {
  CalendarClock,
  Check,
  Clock3,
  Gauge,
  LoaderCircle,
  MailCheck,
  Save,
  ShieldCheck,
  ShieldOff,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const DAY_OPTIONS = [
  ['monday', 'Mon', 1],
  ['tuesday', 'Tue', 2],
  ['wednesday', 'Wed', 3],
  ['thursday', 'Thu', 4],
  ['friday', 'Fri', 5],
  ['saturday', 'Sat', 6],
  ['sunday', 'Sun', 0],
] as const;

type DayKey = (typeof DAY_OPTIONS)[number][0];
type ScheduleDays = Record<DayKey, boolean>;

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
] as const;

const DEFAULT_DAYS: ScheduleDays = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
};

export interface CampaignSettingsAccount {
  email: string;
  name?: string | null;
  status: number | null;
  statusMessage?: string | null;
  setupPending: boolean | null;
  warmupScore?: number | null;
  dailyLimit?: number | null;
}

export interface CampaignSettingsSchedule {
  schedules?: Array<{
    name?: string | null;
    timing?: { from?: string | null; to?: string | null } | null;
    days?: Record<string, boolean> | null;
    timezone?: string | null;
  }> | null;
}

export interface CampaignSettingsCampaign {
  id: string;
  name: string | null;
  status: number | null;
  updatedAt?: string | null;
  sendingAccounts: string[];
  dailyMaxLeads: number | null;
  stopOnReply: boolean;
  stopOnAutoReply?: boolean;
  stopForCompany?: boolean;
  openTracking?: boolean;
  linkTracking?: boolean;
  textOnly?: boolean;
  firstEmailTextOnly?: boolean;
  prioritizeNewLeads?: boolean;
  matchLeadEsp?: boolean;
  insertUnsubscribeHeader?: boolean;
  allowRiskyContacts?: boolean;
  bounceProtection?: boolean;
  emailGap?: number | null;
  randomWaitMax?: number | null;
  schedule?: CampaignSettingsSchedule | null;
}

export interface CampaignSettingsProps {
  campaign: CampaignSettingsCampaign;
  accounts: CampaignSettingsAccount[];
  onSaved?: () => void | Promise<void>;
  className?: string;
}

type FormState = {
  emailList: string[];
  dailyMaxLeads: number;
  timezone: string;
  from: string;
  to: string;
  days: ScheduleDays;
  emailGap: number;
  randomWaitMax: number;
  stopOnReply: boolean;
  stopOnAutoReply: boolean;
  stopForCompany: boolean;
  openTracking: boolean;
  linkTracking: boolean;
  prioritizeNewLeads: boolean;
  matchLeadEsp: boolean;
  textOnly: boolean;
  firstEmailTextOnly: boolean;
  insertUnsubscribeHeader: boolean;
  bounceProtection: boolean;
  allowRiskyContacts: boolean;
};

function healthyAccounts(accounts: CampaignSettingsAccount[]) {
  return accounts.filter((account) => account.status === 1 && !account.setupPending);
}

function makeForm(campaign: CampaignSettingsCampaign, accounts: CampaignSettingsAccount[]): FormState {
  const healthyEmails = new Set(healthyAccounts(accounts).map((account) => account.email.toLowerCase()));
  const configured = campaign.sendingAccounts
    .map((email) => email.toLowerCase())
    .filter((email) => healthyEmails.has(email));
  const emailList = configured.length ? configured : [...healthyEmails];
  const schedule = campaign.schedule?.schedules?.[0];
  const days = { ...DEFAULT_DAYS };
  if (schedule?.days) {
    for (const [key, , dayNumber] of DAY_OPTIONS) {
      const value = schedule.days[key] ?? schedule.days[String(dayNumber)];
      if (typeof value === 'boolean') days[key] = value;
    }
  }
  const capacity = Math.max(30, emailList.length * 30);
  return {
    emailList,
    dailyMaxLeads: Math.min(capacity, Math.max(1, campaign.dailyMaxLeads ?? capacity)),
    timezone: schedule?.timezone || 'UTC',
    from: schedule?.timing?.from || '09:00',
    to: schedule?.timing?.to || '17:00',
    days,
    emailGap: Math.min(60, Math.max(1, campaign.emailGap ?? 10)),
    randomWaitMax: Math.min(60, Math.max(0, campaign.randomWaitMax ?? 5)),
    stopOnReply: campaign.stopOnReply !== false,
    stopOnAutoReply: campaign.stopOnAutoReply === true,
    stopForCompany: campaign.stopForCompany === true,
    openTracking: campaign.openTracking !== false,
    linkTracking: campaign.linkTracking !== false,
    prioritizeNewLeads: campaign.prioritizeNewLeads === true,
    matchLeadEsp: campaign.matchLeadEsp === true,
    textOnly: campaign.textOnly === true,
    firstEmailTextOnly: campaign.firstEmailTextOnly === true,
    insertUnsubscribeHeader: campaign.insertUnsubscribeHeader === true,
    bounceProtection: campaign.bounceProtection !== false,
    allowRiskyContacts: campaign.allowRiskyContacts === true,
  };
}

function campaignState(status: number | null) {
  if (status === 0) return { label: 'Draft', safe: true };
  if (status === 2) return { label: 'Paused', safe: true };
  if (status === 1) return { label: 'Active', safe: false };
  if (status === 3) return { label: 'Completed', safe: false };
  return { label: 'Unknown', safe: false };
}

function ToggleRow({ label, detail, checked, onCheckedChange, danger = false, disabled = false }: {
  label: string;
  detail?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b py-2.5 last:border-0">
      <div className="min-w-0">
        <Label className={danger && checked ? 'text-destructive' : undefined}>{label}</Label>
        {detail && <p className="text-muted-foreground mt-1 text-[11px] leading-4">{detail}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} />
    </div>
  );
}

function NumberField({ id, label, value, min, max, onChange, suffix }: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="relative">
        <Input id={id} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="pr-16 tabular-nums" />
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[10px] uppercase">{suffix}</span>
      </div>
    </div>
  );
}

export function CampaignSettings({ campaign, accounts, onSaved, className }: CampaignSettingsProps) {
  const initial = React.useMemo(() => makeForm(campaign, accounts), [campaign, accounts]);
  const [form, setForm] = React.useState<FormState>(initial);
  const [savedSnapshot, setSavedSnapshot] = React.useState(() => JSON.stringify(initial));
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setForm(initial);
    setSavedSnapshot(JSON.stringify(initial));
  }, [initial]);

  const healthy = healthyAccounts(accounts);
  const selectedSet = new Set(form.emailList);
  const capacity = form.emailList.length * 30;
  const dirty = JSON.stringify(form) !== savedSnapshot;
  const state = campaignState(campaign.status);
  const validSchedule = form.from < form.to && Object.values(form.days).some(Boolean);
  const validLimits = form.dailyMaxLeads >= 1 && form.dailyMaxLeads <= capacity && form.emailGap >= 1 && form.emailGap <= 60 && form.randomWaitMax >= 0 && form.randomWaitMax <= 60;
  const canSave = state.safe && dirty && form.emailList.length > 0 && validSchedule && validLimits && !saving;

  const setField = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleSender = (email: string, selected: boolean) => {
    setForm((current) => {
      const nextEmails = selected
        ? [...new Set([...current.emailList, email])]
        : current.emailList.filter((item) => item !== email);
      const nextCapacity = nextEmails.length * 30;
      return { ...current, emailList: nextEmails, dailyMaxLeads: Math.min(current.dailyMaxLeads, Math.max(1, nextCapacity)) };
    });
  };

  const selectAllHealthy = () => {
    const emails = healthy.map((account) => account.email.toLowerCase());
    setForm((current) => ({ ...current, emailList: emails, dailyMaxLeads: Math.max(current.dailyMaxLeads, emails.length * 30) }));
  };

  const reset = () => setForm(JSON.parse(savedSnapshot) as FormState);

  const reviewSave = () => {
    if (form.emailList.length === 0) return toast.error('Select at least one healthy sender.');
    if (!Object.values(form.days).some(Boolean)) return toast.error('Select at least one sending day.');
    if (form.from >= form.to) return toast.error('The schedule must end after it starts.');
    if (!validLimits) return toast.error('Check the daily volume and timing limits.');
    setConfirmOpen(true);
  };

  const save = async () => {
    setConfirmOpen(false);
    setSaving(true);
    try {
      const response = await fetch('/api/mail/campaign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          emailList: form.emailList,
          dailyPerAccount: 30,
          dailyMaxLeads: form.dailyMaxLeads,
          schedule: {
            schedules: [{
              name: 'Affiliate outreach',
              timing: { from: form.from, to: form.to },
              days: Object.fromEntries(DAY_OPTIONS.map(([key, , dayNumber]) => [String(dayNumber), form.days[key]])),
              timezone: form.timezone,
            }],
          },
          emailGap: form.emailGap,
          randomWaitMax: form.randomWaitMax,
          stopOnReply: form.stopOnReply,
          stopOnAutoReply: form.stopOnAutoReply,
          stopForCompany: form.stopForCompany,
          openTracking: form.openTracking,
          linkTracking: form.linkTracking,
          prioritizeNewLeads: form.prioritizeNewLeads,
          matchLeadEsp: form.matchLeadEsp,
          textOnly: form.textOnly,
          firstEmailTextOnly: form.firstEmailTextOnly,
          insertUnsubscribeHeader: form.insertUnsubscribeHeader,
          bounceProtection: form.bounceProtection,
          allowRiskyContacts: form.allowRiskyContacts,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Could not save campaign settings (${response.status})`);
      setSavedSnapshot(JSON.stringify(form));
      toast.success(payload.safety || 'Campaign settings saved. No email was sent.');
      await onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save campaign settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card className={cn('gap-0 overflow-hidden py-0', className)}>
        <CardHeader className="border-b bg-muted/10 py-5">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={state.safe ? 'secondary' : 'destructive'}><ShieldCheck /> {state.label}</Badge>
              {dirty && <Badge variant="destructive">Unsaved</Badge>}
            </div>
            <CardTitle>Campaign controls</CardTitle>
            <CardDescription className="mt-1">{campaign.name || 'Affiliate outreach'}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={reset} disabled={!dirty || saving}>Reset</Button>
            <Button size="sm" onClick={reviewSave} disabled={!canSave}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}{saving ? 'Saving…' : 'Review & save'}</Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(25rem,0.85fr)]">
            <div className="grid content-start border-b xl:border-r xl:border-b-0">
              <section className="border-b p-4 md:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4" /> Healthy senders</h3><p className="text-muted-foreground mt-1 text-xs">30 emails/day per selected account</p></div>
                  <div className="flex gap-2"><Button size="sm" variant="outline" onClick={selectAllHealthy}>Select all</Button><Button size="sm" variant="ghost" onClick={() => setField('emailList', [])}>Clear</Button></div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {healthy.map((account) => {
                    const selected = selectedSet.has(account.email.toLowerCase());
                    return (
                      <label key={account.email} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30', selected && 'border-foreground/25 bg-muted/20')}>
                        <Checkbox checked={selected} onCheckedChange={(checked) => toggleSender(account.email.toLowerCase(), checked === true)} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{account.email}</span><span className="text-muted-foreground mt-1 flex items-center gap-2 text-[10px]"><span className="text-emerald-600">Ready</span><span>Warmup {account.warmupScore ?? '—'}%</span></span></span>
                        {selected && <Check className="size-3.5 text-emerald-600" />}
                      </label>
                    );
                  })}
                </div>
                {healthy.length === 0 && <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">No healthy approved senders are connected.</p>}
              </section>

              <section className="grid gap-5 border-b p-4 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] md:p-5">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4" /> Volume</h3>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-lg border bg-muted/15 p-3"><p className="text-muted-foreground text-[10px] uppercase tracking-wide">Selected</p><p className="mt-1 text-xl font-semibold tabular-nums">{form.emailList.length}</p></div>
                    <div className="rounded-lg border bg-muted/15 p-3"><p className="text-muted-foreground text-[10px] uppercase tracking-wide">Capacity</p><p className="mt-1 text-xl font-semibold tabular-nums">{capacity}<span className="text-muted-foreground text-xs font-normal">/day</span></p></div>
                  </div>
                </div>
                <div className="grid content-start gap-2">
                  <NumberField id="daily-max" label="Campaign daily maximum" value={form.dailyMaxLeads} min={1} max={Math.max(1, capacity)} onChange={(value) => setField('dailyMaxLeads', value)} suffix={`of ${capacity}`} />
                  {form.dailyMaxLeads > capacity && <p className="text-destructive text-[11px]">Maximum cannot exceed selected sender capacity.</p>}
                </div>
              </section>

              <section className="p-4 md:p-5">
                <div className="mb-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" /> Sending schedule</h3></div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5 sm:col-span-3"><Label className="text-xs">Timezone</Label><Select value={form.timezone} onValueChange={(value) => setField('timezone', value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map((timezone) => <SelectItem key={timezone} value={timezone}>{timezone.replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select></div>
                  <div className="grid gap-1.5"><Label htmlFor="schedule-from" className="text-xs">From</Label><Input id="schedule-from" type="time" value={form.from} onChange={(event) => setField('from', event.target.value)} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="schedule-to" className="text-xs">To</Label><Input id="schedule-to" type="time" value={form.to} onChange={(event) => setField('to', event.target.value)} /></div>
                  <div className="grid gap-1.5"><Label className="text-xs">Active days</Label><p className="text-muted-foreground h-8 content-center text-xs">{Object.values(form.days).filter(Boolean).length} selected</p></div>
                </div>
                <div className="mt-3 grid grid-cols-7 gap-1">
                  {DAY_OPTIONS.map(([key, label]) => <Button key={key} type="button" size="sm" variant={form.days[key] ? 'default' : 'outline'} aria-pressed={form.days[key]} onClick={() => setField('days', { ...form.days, [key]: !form.days[key] })} className="px-1">{label}</Button>)}
                </div>
                {!validSchedule && <p className="text-destructive mt-2 text-[11px]">Choose a valid time window and at least one day.</p>}
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <NumberField id="email-gap" label="Gap between emails" value={form.emailGap} min={1} max={60} onChange={(value) => setField('emailGap', value)} suffix="minutes" />
                  <NumberField id="random-wait" label="Random wait maximum" value={form.randomWaitMax} min={0} max={60} onChange={(value) => setField('randomWaitMax', value)} suffix="minutes" />
                </div>
              </section>
            </div>

            <div className="grid content-start">
              <section className="border-b p-4 md:p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><MailCheck className="size-4" /> Response handling</h3>
                <div className="mt-2">
                  <ToggleRow label="Stop on reply" checked={form.stopOnReply} onCheckedChange={(checked) => setField('stopOnReply', checked)} />
                  <ToggleRow label="Stop on auto-reply" checked={form.stopOnAutoReply} onCheckedChange={(checked) => setField('stopOnAutoReply', checked)} />
                  <ToggleRow label="Stop for the whole company" checked={form.stopForCompany} onCheckedChange={(checked) => setField('stopForCompany', checked)} />
                </div>
              </section>

              <section className="border-b p-4 md:p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="size-4" /> Delivery strategy</h3>
                <div className="mt-2">
                  <ToggleRow label="Prioritize new leads" checked={form.prioritizeNewLeads} onCheckedChange={(checked) => setField('prioritizeNewLeads', checked)} />
                  <ToggleRow label="Match lead ESP" checked={form.matchLeadEsp} onCheckedChange={(checked) => setField('matchLeadEsp', checked)} />
                  <ToggleRow label="Text-only emails" checked={form.textOnly} onCheckedChange={(checked) => setField('textOnly', checked)} />
                  <ToggleRow label="First email text-only" checked={form.firstEmailTextOnly} onCheckedChange={(checked) => setField('firstEmailTextOnly', checked)} disabled={form.textOnly} />
                </div>
              </section>

              <section className="p-4 md:p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4" /> Tracking & protection</h3>
                <div className="mt-2">
                  <ToggleRow label="Open tracking" checked={form.openTracking} onCheckedChange={(checked) => setField('openTracking', checked)} />
                  <ToggleRow label="Link tracking" checked={form.linkTracking} onCheckedChange={(checked) => setField('linkTracking', checked)} />
                  <ToggleRow label="Unsubscribe header" checked={form.insertUnsubscribeHeader} onCheckedChange={(checked) => setField('insertUnsubscribeHeader', checked)} />
                  <ToggleRow label="Bounce protection" checked={form.bounceProtection} onCheckedChange={(checked) => setField('bounceProtection', checked)} />
                  <ToggleRow label="Allow risky contacts" detail="May reduce deliverability and increase bounce risk." checked={form.allowRiskyContacts} onCheckedChange={(checked) => setField('allowRiskyContacts', checked)} danger />
                </div>
              </section>
            </div>
          </div>

          {!state.safe && <div className="flex items-center gap-2 border-t bg-destructive/5 px-5 py-3 text-xs text-destructive"><ShieldOff className="size-4" /> Settings are locked while the campaign is {state.label.toLowerCase()}. Pause it in Instantly before editing.</div>}
          <div className="flex flex-col gap-2 border-t bg-muted/15 px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Saving changes keeps the campaign {state.label}. It never starts delivery.</span><span className="font-medium text-foreground">{form.emailList.length} senders · {form.dailyMaxLeads}/day · {form.timezone}</span></div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia><ShieldCheck /></AlertDialogMedia>
            <AlertDialogTitle>Save campaign configuration?</AlertDialogTitle>
            <AlertDialogDescription>This updates the Draft or Paused campaign in Instantly. It will not launch the campaign or send email.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-3 text-xs">
            <span className="text-muted-foreground">Senders</span><strong className="text-right">{form.emailList.length} × 30/day</strong>
            <span className="text-muted-foreground">Daily maximum</span><strong className="text-right">{form.dailyMaxLeads}</strong>
            <span className="text-muted-foreground">Schedule</span><strong className="text-right">{form.from}–{form.to}</strong>
            <span className="text-muted-foreground">Reply stop</span><strong className="text-right">{form.stopOnReply ? 'Enabled' : 'Disabled'}</strong>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep editing</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); void save(); }}>{saving ? 'Saving…' : 'Save settings only'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
