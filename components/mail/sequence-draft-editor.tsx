'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  Clock3,
  Copy,
  Eye,
  FilePenLine,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

type DelayUnit = 'minutes' | 'hours' | 'days';
type Variant = { subject: string; body: string; disabled: boolean };
type Step = { type: 'email'; delay: number; delayUnit: DelayUnit; variants: Variant[] };
type SequencePayload = {
  campaign: { id: string; name: string | null; status: number | null; updatedAt: string | null };
  steps: Step[];
};

const EMPTY_VARIANT: Variant = { subject: '', body: '', disabled: false };
const MERGE_TAGS = ['{{firstName}}', '{{lastName}}', '{{companyName}}'];

async function requestSequence(init?: RequestInit): Promise<SequencePayload> {
  const response = await fetch('/api/mail/sequence', { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload as SequencePayload;
}

function cloneSteps(steps: Step[]): Step[] {
  return steps.map((step) => ({ ...step, variants: step.variants.map((variant) => ({ ...variant })) }));
}

function campaignLabel(status: number | null) {
  if (status === 0) return 'Draft';
  if (status === 2) return 'Paused';
  if (status === 1) return 'Active';
  if (status === 3) return 'Completed';
  return 'Unknown';
}

function previewCopy(value: string) {
  return value
    .replaceAll('{{firstName}}', 'Avery')
    .replaceAll('{{lastName}}', 'Patel')
    .replaceAll('{{companyName}}', 'Northstar Media');
}

export function SequenceDraftEditor({ onSaved }: { onSaved: () => Promise<void> }) {
  const [source, setSource] = React.useState<SequencePayload | null>(null);
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [selectedStep, setSelectedStep] = React.useState(0);
  const [selectedVariant, setSelectedVariant] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await requestSequence();
      const nextSteps = next.steps.length ? next.steps : [{ type: 'email' as const, delay: 1, delayUnit: 'days' as const, variants: [{ ...EMPTY_VARIANT }] }];
      setSource(next);
      setSteps(cloneSteps(nextSteps));
      setSelectedStep(0);
      setSelectedVariant(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the sequence draft.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const serialized = JSON.stringify(steps);
  const savedSerialized = JSON.stringify(source?.steps.length ? source.steps : [{ type: 'email', delay: 1, delayUnit: 'days', variants: [{ ...EMPTY_VARIANT }] }]);
  const dirty = serialized !== savedSerialized;
  const activeStep = steps[selectedStep];
  const activeVariant = activeStep?.variants[selectedVariant];
  const variantCount = steps.reduce((total, step) => total + step.variants.length, 0);
  const canSave = Boolean(source && (source.campaign.status === 0 || source.campaign.status === 2) && dirty && steps.length);

  function updateStep(index: number, patch: Partial<Step>) {
    setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  function updateVariant(patch: Partial<Variant>) {
    setSteps((current) => current.map((step, stepIndex) => stepIndex === selectedStep
      ? { ...step, variants: step.variants.map((variant, variantIndex) => variantIndex === selectedVariant ? { ...variant, ...patch } : variant) }
      : step));
  }

  function addStep() {
    if (steps.length >= 10) return;
    const nextIndex = steps.length;
    setSteps((current) => [...current, { type: 'email', delay: 3, delayUnit: 'days', variants: [{ ...EMPTY_VARIANT }] }]);
    setSelectedStep(nextIndex);
    setSelectedVariant(0);
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return;
    setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index));
    setSelectedStep((current) => Math.max(0, Math.min(current > index ? current - 1 : current, steps.length - 2)));
    setSelectedVariant(0);
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSelectedStep(target);
  }

  function addVariant() {
    if (!activeStep || activeStep.variants.length >= 5) return;
    const nextIndex = activeStep.variants.length;
    updateStep(selectedStep, { variants: [...activeStep.variants, { ...EMPTY_VARIANT }] });
    setSelectedVariant(nextIndex);
  }

  function duplicateVariant() {
    if (!activeStep || !activeVariant || activeStep.variants.length >= 5) return;
    const nextIndex = activeStep.variants.length;
    updateStep(selectedStep, { variants: [...activeStep.variants, { ...activeVariant }] });
    setSelectedVariant(nextIndex);
  }

  function removeVariant() {
    if (!activeStep || activeStep.variants.length <= 1) return;
    updateStep(selectedStep, { variants: activeStep.variants.filter((_, index) => index !== selectedVariant) });
    setSelectedVariant((current) => Math.max(0, current - 1));
  }

  function insertTag(tag: string) {
    if (!activeVariant) return;
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? activeVariant.body.length;
    const end = textarea?.selectionEnd ?? start;
    updateVariant({ body: `${activeVariant.body.slice(0, start)}${tag}${activeVariant.body.slice(end)}` });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  function validate() {
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      for (let variantIndex = 0; variantIndex < steps[stepIndex].variants.length; variantIndex += 1) {
        const variant = steps[stepIndex].variants[variantIndex];
        if (!variant.subject.trim() || !variant.body.trim()) {
          setSelectedStep(stepIndex);
          setSelectedVariant(variantIndex);
          toast.error(`Finish the subject and body in step ${stepIndex + 1}, variant ${String.fromCharCode(65 + variantIndex)}.`);
          return false;
        }
      }
    }
    return true;
  }

  async function save() {
    setConfirmOpen(false);
    setSaving(true);
    try {
      const next = await requestSequence({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, steps }),
      });
      setSource(next);
      setSteps(cloneSteps(next.steps));
      toast.success('Sequence draft saved to Instantly. No email was sent.');
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the sequence draft.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Card><CardHeader><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-80" /></CardHeader><CardContent><Skeleton className="h-[420px] w-full" /></CardContent></Card>;
  if (!source || !activeStep || !activeVariant) return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Sequence editor unavailable. <Button variant="link" onClick={() => void load()}>Try again</Button></CardContent></Card>;

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b bg-muted/10 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline"><FilePenLine /> Sequence draft</Badge><Badge variant="secondary"><ShieldCheck /> {campaignLabel(source.campaign.status)} only</Badge>{dirty && <Badge variant="destructive">Unsaved changes</Badge>}</div>
              <CardTitle>Write and edit the email sequence</CardTitle>
              <CardDescription className="mt-1 max-w-2xl">Each step can have up to five A/B variants. Delays happen after the current email before the next step. Saving updates copy only—it cannot activate this campaign.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void load()} disabled={saving}>Reset</Button>
              <Button onClick={() => { if (validate()) setConfirmOpen(true); }} disabled={!canSave || saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />} {saving ? 'Saving…' : 'Save sequence draft'}</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid min-h-[620px] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
            <aside className="border-b bg-muted/10 p-3 xl:border-b-0 xl:border-r">
              <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sequence steps</p><Badge variant="secondary">{steps.length}</Badge></div>
              <div className="grid gap-2">{steps.map((step, index) => (
                <button key={index} type="button" onClick={() => { setSelectedStep(index); setSelectedVariant(0); }} className={`w-full border p-3 text-left transition-colors hover:bg-background ${selectedStep === index ? 'border-foreground bg-background shadow-xs' : 'bg-transparent'}`}>
                  <div className="flex items-center gap-2"><span className="grid size-6 place-items-center bg-foreground text-xs font-semibold text-background">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{index === 0 ? 'Opening email' : `Follow-up ${index}`}</span></div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{step.variants.length} variant{step.variants.length === 1 ? '' : 's'}</span><span>{step.delay} {step.delayUnit}</span></div>
                </button>
              ))}</div>
              <Button className="mt-3 w-full" variant="outline" onClick={addStep} disabled={steps.length >= 10}><Plus /> Add follow-up</Button>
            </aside>

            <section className="min-w-0 p-4 md:p-5">
              <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Step {selectedStep + 1}</p><h3 className="mt-1 font-semibold">{selectedStep === 0 ? 'Opening email' : `Follow-up ${selectedStep}`}</h3></div>
                <div className="flex items-center gap-1"><Button size="icon-sm" variant="ghost" onClick={() => moveStep(selectedStep, -1)} disabled={selectedStep === 0} aria-label="Move step up"><ArrowUp /></Button><Button size="icon-sm" variant="ghost" onClick={() => moveStep(selectedStep, 1)} disabled={selectedStep === steps.length - 1} aria-label="Move step down"><ArrowDown /></Button><Button size="icon-sm" variant="ghost" onClick={() => removeStep(selectedStep)} disabled={steps.length === 1} aria-label="Remove step"><Trash2 /></Button></div>
              </div>

              <div className="grid gap-4 py-4 sm:grid-cols-[1fr_180px]">
                <div><label className="mb-1.5 block text-xs font-medium">Wait after this email</label><Input type="number" min={0} max={90} value={activeStep.delay} onChange={(event) => updateStep(selectedStep, { delay: Math.max(0, Math.min(90, Number.parseInt(event.target.value || '0', 10))) })} /></div>
                <div><label className="mb-1.5 block text-xs font-medium">Delay unit</label><Select value={activeStep.delayUnit} onValueChange={(value: DelayUnit) => updateStep(selectedStep, { delayUnit: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="minutes">Minutes</SelectItem><SelectItem value="hours">Hours</SelectItem><SelectItem value="days">Days</SelectItem></SelectContent></Select></div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-y py-3"><span className="mr-1 text-xs font-medium text-muted-foreground">Variants</span>{activeStep.variants.map((_, index) => <Button key={index} size="sm" variant={selectedVariant === index ? 'default' : 'outline'} onClick={() => setSelectedVariant(index)}>Variant {String.fromCharCode(65 + index)}</Button>)}<Button size="icon-sm" variant="ghost" onClick={addVariant} disabled={activeStep.variants.length >= 5} aria-label="Add variant"><Plus /></Button></div>

              <div className="grid gap-4 pt-4">
                <div><div className="mb-1.5 flex items-center justify-between"><label className="text-xs font-medium">Subject</label><span className="text-[10px] tabular-nums text-muted-foreground">{activeVariant.subject.length} / 500</span></div><Input value={activeVariant.subject} maxLength={500} onChange={(event) => updateVariant({ subject: event.target.value })} placeholder="Write a clear subject line" /></div>
                <div><div className="mb-1.5 flex flex-wrap items-center gap-2"><label className="mr-auto text-xs font-medium">Email body</label><Braces className="size-3.5 text-muted-foreground" />{MERGE_TAGS.map((tag) => <Button key={tag} size="xs" variant="outline" onClick={() => insertTag(tag)}>{tag}</Button>)}</div><Textarea ref={bodyRef} value={activeVariant.body} maxLength={50_000} onChange={(event) => updateVariant({ body: event.target.value })} placeholder="Write the email. Use merge tags for personalisation." className="min-h-64 resize-y font-mono text-sm leading-6" /></div>
                <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={duplicateVariant} disabled={activeStep.variants.length >= 5}><Copy /> Duplicate variant</Button><Button variant="ghost" size="sm" onClick={removeVariant} disabled={activeStep.variants.length === 1}><Trash2 /> Remove variant</Button></div>
              </div>
            </section>

            <aside className="border-t bg-muted/10 p-4 xl:border-l xl:border-t-0">
              <div className="mb-4 flex items-center gap-2"><Eye className="size-4" /><div><p className="text-sm font-semibold">Live preview</p><p className="text-xs text-muted-foreground">Sample merge data only</p></div></div>
              <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
                <div className="border-b bg-muted/20 px-4 py-3"><p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Subject</p><p className="mt-1 break-words text-sm font-semibold">{previewCopy(activeVariant.subject) || 'Your subject appears here'}</p></div>
                <div className="p-4"><div className="mb-5 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-foreground text-xs font-bold text-background">R</span><div><p className="text-sm font-medium">Runable Affiliates</p><p className="text-xs text-muted-foreground">to Avery</p></div></div><p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">{previewCopy(activeVariant.body) || 'Your email body appears here.'}</p></div>
              </div>
              <div className="mt-4 grid gap-2 border p-3 text-xs"><div className="flex items-center gap-2"><Clock3 className="size-3.5 text-muted-foreground" /><span>{activeStep.delay} {activeStep.delayUnit} before the next step</span></div><div className="flex items-center gap-2"><Check className="size-3.5 text-emerald-600" /><span>Stop on reply remains enabled</span></div><div className="flex items-center gap-2"><ShieldCheck className="size-3.5 text-emerald-600" /><span>Save does not launch or send</span></div></div>
            </aside>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogMedia><Save /></AlertDialogMedia><AlertDialogTitle>Save this sequence draft?</AlertDialogTitle><AlertDialogDescription>This writes {steps.length} step{steps.length === 1 ? '' : 's'} and {variantCount} variant{variantCount === 1 ? '' : 's'} to “{source.campaign.name || 'Affiliate campaign'}”. It will remain {campaignLabel(source.campaign.status)} and no email will be sent.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={saving}>Keep editing</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); void save(); }}>Save draft only</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
