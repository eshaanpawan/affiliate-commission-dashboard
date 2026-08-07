'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  Clock3,
  Copy,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Library,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

type SavedDraft = { id: string; name: string; steps: Step[]; updatedAt: string };

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

// firstName/lastName vary per recipient (Rewardful profile name) — Avery Patel is a
// stand-in. companyName is NOT per-recipient: the sync hardcodes it, so preview the
// exact string every email will contain.
function previewCopy(value: string) {
  return value
    .replaceAll('{{firstName}}', 'Avery')
    .replaceAll('{{lastName}}', 'Patel')
    .replaceAll('{{companyName}}', 'Runable');
}

function delayLabel(delay: number, unit: DelayUnit) {
  return `${delay} ${delay === 1 ? unit.slice(0, -1) : unit}`;
}

export function SequenceDraftEditor({ onSaved }: { onSaved: () => Promise<void> }) {
  const [source, setSource] = React.useState<SequencePayload | null>(null);
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [selectedStep, setSelectedStep] = React.useState(0);
  const [selectedVariant, setSelectedVariant] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [stepsExpanded, setStepsExpanded] = React.useState(true);
  const [previewVisible, setPreviewVisible] = React.useState(true);
  // null = default 50/50 split; a number = px width set by dragging.
  const [previewWidth, setPreviewWidth] = React.useState<number | null>(null);
  const [library, setLibrary] = React.useState<SavedDraft[]>([]);
  const [saveAsOpen, setSaveAsOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState('');
  const [libraryBusy, setLibraryBusy] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);
  const previewRef = React.useRef<HTMLElement | null>(null);

  function startPreviewResize(event: React.PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = previewWidth ?? previewRef.current?.offsetWidth ?? 360;
    const onMove = (move: PointerEvent) => {
      setPreviewWidth(Math.min(640, Math.max(280, startWidth + (startX - move.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

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

  const loadLibrary = React.useCallback(async () => {
    try {
      const response = await fetch('/api/mail/drafts', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      setLibrary(Array.isArray(payload.drafts) ? payload.drafts : []);
    } catch {
      // The library is optional UI; the editor still works without it.
    }
  }, []);

  React.useEffect(() => { void load(); void loadLibrary(); }, [load, loadLibrary]);

  function loadDraftFromLibrary(draft: SavedDraft) {
    setSteps(cloneSteps(draft.steps));
    setSelectedStep(0);
    setSelectedVariant(0);
    toast.success(`“${draft.name}” loaded into the editor. Review it, then press Save draft to write it to the campaign.`);
  }

  async function saveToLibrary() {
    const name = draftName.trim();
    if (!name) return;
    setLibraryBusy(true);
    try {
      const response = await fetch('/api/mail/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, name, steps }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      toast.success(`Saved “${name}” to the draft library.`);
      setSaveAsOpen(false);
      setDraftName('');
      await loadLibrary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save to the library.');
    } finally {
      setLibraryBusy(false);
    }
  }

  async function deleteFromLibrary(draft: SavedDraft) {
    setLibraryBusy(true);
    try {
      const response = await fetch(`/api/mail/drafts?id=${encodeURIComponent(draft.id)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      toast.success(`Deleted “${draft.name}” from the library.`);
      await loadLibrary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete this draft.');
    } finally {
      setLibraryBusy(false);
    }
  }

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

  if (loading) return <Card className="lg:h-[calc(100dvh-12rem)] lg:min-h-[620px]"><CardHeader><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-80" /></CardHeader><CardContent className="min-h-0 flex-1"><Skeleton className="h-full min-h-[420px] w-full" /></CardContent></Card>;
  if (!source || !activeStep || !activeVariant) return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Sequence editor unavailable. <Button variant="link" onClick={() => void load()}>Try again</Button></CardContent></Card>;

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0 lg:h-[calc(100dvh-12rem)] lg:min-h-[620px] lg:flex-col">
        <CardHeader className="shrink-0 border-b bg-muted/10 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><CardTitle>Sequence draft</CardTitle><Badge variant="secondary"><ShieldCheck /> {campaignLabel(source.campaign.status)}</Badge>{dirty && <Badge variant="destructive">Unsaved</Badge>}</div>
              <CardDescription className="mt-1">{steps.length} step{steps.length === 1 ? '' : 's'} · {variantCount} variant{variantCount === 1 ? '' : 's'}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={libraryBusy}><Library /> Library{library.length > 0 && <Badge variant="secondary">{library.length}</Badge>}</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>Saved drafts</DropdownMenuLabel>
                  {library.length === 0 && <DropdownMenuItem disabled>No saved drafts yet</DropdownMenuItem>}
                  {library.map((draft) => (
                    <DropdownMenuItem key={draft.id} onSelect={() => loadDraftFromLibrary(draft)}>
                      <span className="min-w-0 flex-1 truncate">{draft.name}</span>
                      <span className="text-muted-foreground ml-2 shrink-0 text-[10px]">{draft.steps.length} step{draft.steps.length === 1 ? '' : 's'}</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive ml-1 shrink-0"
                        aria-label={`Delete draft ${draft.name}`}
                        onClick={(event) => { event.stopPropagation(); event.preventDefault(); void deleteFromLibrary(draft); }}
                      ><Trash2 className="size-3.5" /></button>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => { setDraftName(''); setSaveAsOpen(true); }}><Save /> Save current as…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" onClick={() => setStepsExpanded((value) => !value)}>{stepsExpanded ? <ChevronUp /> : <ChevronDown />} {stepsExpanded ? 'Collapse steps' : 'Show steps'}</Button>
              <Button variant="outline" size="sm" onClick={() => setPreviewVisible((value) => !value)}>{previewVisible ? <EyeOff /> : <Eye />} {previewVisible ? 'Hide preview' : 'Show preview'}</Button>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={saving || !dirty}>Reset</Button>
              <Button size="sm" onClick={() => { if (validate()) setConfirmOpen(true); }} disabled={!canSave || saving}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />} {saving ? 'Saving…' : 'Save draft'}</Button>
            </div>
          </div>
        </CardHeader>

        {stepsExpanded && (
          <div className="min-w-0 shrink-0 border-b bg-muted/15 p-3">
            <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1">
              {steps.map((step, index) => (
                <button key={index} type="button" onClick={() => { setSelectedStep(index); setSelectedVariant(0); }} aria-current={selectedStep === index ? 'step' : undefined} className={`flex min-w-40 snap-start shrink-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-44 ${selectedStep === index ? 'border-foreground bg-background shadow-xs' : 'bg-transparent'}`}>
                  <span className={`grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold ${selectedStep === index ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}>{index + 1}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{index === 0 ? 'Opening email' : `Follow-up ${index}`}</span><span className="block text-[11px] text-muted-foreground">{delayLabel(step.delay, step.delayUnit)} · {step.variants.length} variant{step.variants.length === 1 ? '' : 's'}</span></span>
                </button>
              ))}
              <Button className="h-auto min-w-36 shrink-0 border-dashed" variant="outline" onClick={addStep} disabled={steps.length >= 10}><Plus /> Add step</Button>
            </div>
          </div>
        )}

        <CardContent className="min-h-0 flex-1 p-0 lg:overflow-hidden">
          <div
            className={`${previewVisible ? 'grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,var(--preview-w))]' : 'block'} min-h-0 lg:h-full`}
            style={previewVisible ? ({ '--preview-w': previewWidth ? `${previewWidth}px` : '50%' } as React.CSSProperties) : undefined}
          >
            <section className="min-w-0 p-4 md:p-5 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b pb-3">
                <h3 className="font-semibold">{selectedStep === 0 ? 'Opening email' : `Follow-up ${selectedStep}`}</h3>
                <span className="text-muted-foreground text-xs">Step {selectedStep + 1} of {steps.length}</span>
                <div className="ml-auto flex items-center gap-2">
                  <label htmlFor="step-wait" className="text-muted-foreground text-xs">Wait</label>
                  <Input id="step-wait" type="number" min={0} max={90} className="w-18" value={activeStep.delay} onChange={(event) => updateStep(selectedStep, { delay: Math.max(0, Math.min(90, Number.parseInt(event.target.value || '0', 10))) })} />
                  <Select value={activeStep.delayUnit} onValueChange={(value: DelayUnit) => updateStep(selectedStep, { delayUnit: value })}><SelectTrigger className="w-28" aria-label="Wait unit"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="minutes">Minutes</SelectItem><SelectItem value="hours">Hours</SelectItem><SelectItem value="days">Days</SelectItem></SelectContent></Select>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <Button size="icon-sm" variant="ghost" onClick={() => moveStep(selectedStep, -1)} disabled={selectedStep === 0} aria-label="Move step earlier"><ArrowUp /></Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => moveStep(selectedStep, 1)} disabled={selectedStep === steps.length - 1} aria-label="Move step later"><ArrowDown /></Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => removeStep(selectedStep)} disabled={steps.length === 1} aria-label="Remove step"><Trash2 /></Button>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 py-3"><span className="mr-1 text-xs font-medium text-muted-foreground">Variants</span>{activeStep.variants.map((_, index) => <Button key={index} size="sm" variant={selectedVariant === index ? 'default' : 'outline'} onClick={() => setSelectedVariant(index)}>{String.fromCharCode(65 + index)}</Button>)}<Button size="icon-sm" variant="ghost" onClick={addVariant} disabled={activeStep.variants.length >= 5} aria-label="Add variant"><Plus /></Button><span className="mx-1 h-5 w-px bg-border" /><Button variant="ghost" size="sm" onClick={duplicateVariant} disabled={activeStep.variants.length >= 5}><Copy /> Duplicate</Button><Button variant="ghost" size="sm" onClick={removeVariant} disabled={activeStep.variants.length === 1}><Trash2 /> Remove</Button></div>

              <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[auto_minmax(0,1fr)]">
                <div className="shrink-0"><div className="mb-1.5 flex items-center justify-between"><label className="text-xs font-medium">Subject</label><span className="text-[10px] tabular-nums text-muted-foreground">{activeVariant.subject.length} / 500</span></div><Input value={activeVariant.subject} maxLength={500} onChange={(event) => updateVariant({ subject: event.target.value })} placeholder="Subject line" /></div>
                <div className="flex min-h-80 flex-col lg:min-h-0"><div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-2"><label className="mr-auto text-xs font-medium">Message</label><Braces className="size-3.5 text-muted-foreground" />{MERGE_TAGS.map((tag) => <Button key={tag} size="xs" variant="outline" onClick={() => insertTag(tag)}>{tag}</Button>)}</div><Textarea ref={bodyRef} value={activeVariant.body} maxLength={50_000} onChange={(event) => updateVariant({ body: event.target.value })} placeholder="Write the email…" className="min-h-80 flex-1 resize-y font-mono text-sm leading-6 lg:min-h-0 lg:resize-none lg:field-sizing-fixed" /></div>
              </div>
            </section>

            {previewVisible && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize preview panel"
                title="Drag to resize · double-click to reset"
                onPointerDown={startPreviewResize}
                onDoubleClick={() => setPreviewWidth(null)}
                className="group hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center border-l bg-transparent transition-colors hover:bg-muted/70 active:bg-muted lg:flex"
              >
                <span className="h-8 w-0.5 rounded-full bg-border transition-colors group-hover:bg-foreground/40" />
              </div>
            )}
            {previewVisible && (
              <aside ref={previewRef} className="border-t bg-muted/10 p-4 lg:min-h-0 lg:overflow-y-auto lg:border-t-0">
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Eye className="size-4" /><p className="text-sm font-semibold">Preview</p></div><Button size="icon-sm" variant="ghost" onClick={() => setPreviewVisible(false)} aria-label="Hide preview"><X /></Button></div>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900"><p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Subject</p><p className="mt-1 break-words text-sm font-semibold">{previewCopy(activeVariant.subject) || 'Subject preview'}</p></div>
                  <div className="p-4"><div className="mb-5 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-slate-950 text-xs font-bold text-white dark:bg-white dark:text-slate-950">R</span><div><p className="text-sm font-medium">Runable Affiliates</p><p className="text-xs text-slate-500 dark:text-slate-400">to Avery</p></div></div><p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-200">{previewCopy(activeVariant.body) || 'Your message preview will appear here.'}</p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{delayLabel(activeStep.delay, activeStep.delayUnit)}</span><span className="flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600" />Stop on reply</span><span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-600" />Draft only</span></div>
              </aside>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={saveAsOpen} onOpenChange={setSaveAsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save to draft library</DialogTitle>
            <DialogDescription>Stores the current {steps.length}-step sequence in your database. Saving with an existing name overwrites that draft. This does not change the campaign.</DialogDescription>
          </DialogHeader>
          <Input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="e.g. Dormant re-activation"
            maxLength={120}
            onKeyDown={(event) => { if (event.key === 'Enter' && draftName.trim()) void saveToLibrary(); }}
            aria-label="Draft name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveAsOpen(false)} disabled={libraryBusy}>Cancel</Button>
            <Button onClick={() => void saveToLibrary()} disabled={libraryBusy || !draftName.trim()}>{libraryBusy ? <LoaderCircle className="animate-spin" /> : <Save />} Save draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogMedia><Save /></AlertDialogMedia><AlertDialogTitle>Save this sequence draft?</AlertDialogTitle><AlertDialogDescription>This writes {steps.length} step{steps.length === 1 ? '' : 's'} and {variantCount} variant{variantCount === 1 ? '' : 's'} to “{source.campaign.name || 'Affiliate campaign'}”. It will remain {campaignLabel(source.campaign.status)} and no email will be sent.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={saving}>Keep editing</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); void save(); }}>Save draft only</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
