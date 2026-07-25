'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronsUpDown, ExternalLink, RefreshCw, Search } from 'lucide-react';

import { fmtDuration, ttsTone, similarityTone } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface RiskSignal {
  key: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
  value: number | string;
  detail: string;
}

interface AffiliateRisk {
  score: number;
  band: 'low' | 'medium' | 'high';
  signals: RiskSignal[];
  stats: {
    referrals: number;
    conversions: number;
    convRate: number;
    instantConvPct: number;
    gclidPct: number;
    googleReferrerPct: number;
    paidUtmPct: number;
    fbclidPct: number;
    topSourcePct: number;
    topSource: string | null;
    medianTimeToConvSec: number | null;
    refundRate: number;
    selfReferralCount: number;
    sharedVisitorCount: number;
    sharedCustomerCount: number;
    maxDailyRefs: number;
    activeDays: number;
    burstConcentration: number;
    superFastConvCount: number;
    ttcStddevSec: number | null;
    duplicateNameCount: number;
    signupClusterMinutes: number | null;
  };
}

interface FraudAffiliate {
  id: string;
  name: string;
  email: string | null;
  status: string;
  reviewStatus: 'unreviewed' | 'flagged' | 'cleared' | 'paused';
  reviewNotes: string | null;
  knownUrl: string | null;
  fraudTags: string[];
  linkToken: string | null;
  unpaidCommissionCents: number;
  paidCommissionCents: number;
  referrals: number;
  conversions: number;
  duplicateNames?: { id: string; name: string; email: string | null }[];
  risk: AffiliateRisk;
}

const FRAUD_TAG_OPTIONS: { key: string; label: string; emoji: string }[] = [
  { key: 'brand_bidding', label: 'Brand bidding', emoji: '🎯' },
  { key: 'self_referral', label: 'Self-referral', emoji: '🪞' },
  { key: 'fake_traffic', label: 'Fake traffic', emoji: '🤖' },
  { key: 'duplicate_account', label: 'Duplicate account', emoji: '👥' },
  { key: 'identity_mismatch', label: 'Identity mismatch', emoji: '🆔' },
  { key: 'coupon_sniping', label: 'Coupon sniping', emoji: '🍯' },
  { key: 'click_farm', label: 'Click farm', emoji: '🚜' },
  { key: 'low_quality', label: 'Low quality', emoji: '📉' },
  { key: 'manual_review', label: 'Needs review', emoji: '🔍' },
  { key: 'verified_legit', label: 'Verified legit', emoji: '✓' },
];

function FraudTagPill({ tag }: { tag: string }) {
  const opt = FRAUD_TAG_OPTIONS.find(o => o.key === tag);
  const positive = tag === 'verified_legit';
  return (
    <Badge
      variant="secondary"
      className={cn(
        'text-[10px]',
        positive
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
          : 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
      )}
    >
      {opt?.emoji ?? '🚩'} {opt?.label ?? tag.replace(/_/g, ' ')}
    </Badge>
  );
}

interface FraudListResponse {
  summary: {
    totalReviewed: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    flagged: number;
    cleared: number;
    unpaidAtRiskCents: number;
    affiliatesWithSelfReferral: number;
    affiliatesWithSharedCustomers: number;
    affiliatesWithHighRefundRate: number;
    affiliatesWithDuplicateName: number;
    affiliatesWithBurstPattern: number;
    affiliatesWithSuperFastConv: number;
    affiliatesTaggedBrandBidding: number;
    affiliatesTaggedAnyFraud: number;
  };
  affiliates: FraudAffiliate[];
}

interface ReferralDetail {
  id: string;
  status: string;
  createdAt: string;
  convertedAt: string | null;
  customerEmail: string | null;
  referrer: string | null;
  landingPage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  gclid: string | null;
  fbclid: string | null;
  ttcSeconds: number | null;
  flags: string[];
}

interface FraudDetail {
  affiliate: FraudAffiliate;
  risk: AffiliateRisk;
  linkTokens: string[];
  topReferrers: { host: string; count: number }[];
  topLandings: { path: string; count: number }[];
  referrals: ReferralDetail[];
}

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTtc(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

function bandClass(band: string) {
  return band === 'high' ? 'border-red-200 bg-red-100 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
    : band === 'medium' ? 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300';
}

function reviewBadgeClass(status: string) {
  return status === 'flagged' ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
    : status === 'cleared' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : status === 'paused' ? 'bg-muted-foreground/20 text-foreground'
    : 'bg-muted text-muted-foreground';
}

function severityDot(sev: string) {
  return sev === 'high' ? 'bg-red-500' : sev === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground/40';
}

function googleBrandCheckUrl(name: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(`runable ${name}`)}`;
}

function googleSiteSearchUrl(name: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(`"${name}" runable affiliate`)}`;
}

function FraudModal({ affiliate, tts, onClose, onReviewUpdate }: {
  affiliate: FraudAffiliate;
  tts?: TtsPerAffiliate;
  onClose: () => void;
  onReviewUpdate: (id: string, patch: Partial<FraudAffiliate>) => void;
}) {
  const [detail, setDetail] = useState<FraudDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState(affiliate.reviewNotes ?? '');
  const [knownUrl, setKnownUrl] = useState(affiliate.knownUrl ?? '');
  const [tags, setTags] = useState<string[]>(affiliate.fraudTags ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/fraud/${affiliate.id}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [affiliate.id]);

  async function saveAll(patch: { reviewStatus?: 'flagged' | 'cleared' | 'paused' | 'unreviewed'; tags?: string[] }) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { reviewNotes: notes, knownUrl };
      if (patch.reviewStatus !== undefined) body.reviewStatus = patch.reviewStatus;
      if (patch.tags !== undefined) body.fraudTags = patch.tags;
      const res = await fetch(`/api/affiliates/${affiliate.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        onReviewUpdate(affiliate.id, {
          reviewNotes: notes,
          knownUrl,
          ...(patch.reviewStatus !== undefined ? { reviewStatus: patch.reviewStatus } : {}),
          ...(patch.tags !== undefined ? { fraudTags: patch.tags } : {}),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  function setStatus(reviewStatus: 'flagged' | 'cleared' | 'paused' | 'unreviewed') {
    return saveAll({ reviewStatus });
  }

  function toggleTag(tagKey: string) {
    const next = tags.includes(tagKey) ? tags.filter(t => t !== tagKey) : [...tags, tagKey];
    setTags(next);
    saveAll({ tags: next });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-3">
            <DialogTitle>{affiliate.name}</DialogTitle>
            <Badge variant="outline" className={bandClass(affiliate.risk.band)}>
              Risk {affiliate.risk.score} · {affiliate.risk.band.toUpperCase()}
            </Badge>
            <Badge variant="secondary" className={reviewBadgeClass(affiliate.reviewStatus)}>{affiliate.reviewStatus}</Badge>
          </div>
          <DialogDescription>{affiliate.email}</DialogDescription>
        </DialogHeader>

        {/* Quick action investigation links */}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary">
            <a href={googleBrandCheckUrl(affiliate.name)} target="_blank" rel="noreferrer">
              <Search className="size-3.5" /> Google &ldquo;runable {affiliate.name}&rdquo;
            </a>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <a href={googleSiteSearchUrl(affiliate.name)} target="_blank" rel="noreferrer">
              <Search className="size-3.5" /> Find affiliate page
            </a>
          </Button>
          {affiliate.email && (
            <Button asChild size="sm" variant="secondary">
              <a href={`https://www.google.com/search?q=${encodeURIComponent(affiliate.email.split('@')[0])}`} target="_blank" rel="noreferrer">
                <Search className="size-3.5" /> Search by handle
              </a>
            </Button>
          )}
          {detail?.linkTokens.slice(0, 2).map((token) => (
            <Button key={token} asChild size="sm" variant="outline" className="font-mono">
              <a href={`https://runable.com/?via=${token}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" /> ?via={token}
              </a>
            </Button>
          ))}
          {detail?.linkTokens[0] && (
            <Button asChild size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300">
              <a href={`https://www.google.com/search?q=${encodeURIComponent(`"via=${detail.linkTokens[0]}"`)}`} target="_blank" rel="noreferrer">
                <Search className="size-3.5" /> Where they post links
              </a>
            </Button>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          <Stat label="Referrals" value={affiliate.referrals.toString()} />
          <Stat label="Conversions" value={affiliate.conversions.toString()} />
          <Stat label="Conv Rate" value={`${(affiliate.risk.stats.convRate * 100).toFixed(0)}%`}
                tone={affiliate.risk.stats.convRate > 0.4 ? 'danger' : undefined} />
          <Stat label="gclid %" value={`${(affiliate.risk.stats.gclidPct * 100).toFixed(0)}%`}
                tone={affiliate.risk.stats.gclidPct > 0.15 ? 'danger' : undefined} />
          <Stat label="Instant conv" value={`${(affiliate.risk.stats.instantConvPct * 100).toFixed(0)}%`}
                tone={affiliate.risk.stats.instantConvPct > 0.4 ? 'danger' : undefined} />
          <Stat label="Median TTC" value={formatTtc(affiliate.risk.stats.medianTimeToConvSec)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Unpaid (at risk)" value={fmt(affiliate.unpaidCommissionCents)}
                tone={affiliate.risk.band === 'high' ? 'danger' : undefined} />
          <Stat label="Already paid" value={fmt(affiliate.paidCommissionCents)} />
        </div>

        {/* Other affiliates with the same first+last name (multi-account ring indicator) */}
        {affiliate.duplicateNames && affiliate.duplicateNames.length > 0 && (
          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
              ⚠️ Other affiliates with the same name ({affiliate.duplicateNames.length})
            </h3>
            <div className="space-y-1.5 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
              {affiliate.duplicateNames.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{d.name}</span>
                  {d.email && <span className="text-muted-foreground font-mono text-xs">&lt;{d.email}&gt;</span>}
                  <span className="text-muted-foreground font-mono text-[10px]">{d.id.slice(0, 8)}…</span>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-1.5 text-[11px]">Same first+last name across multiple accounts. Could be a multi-account ring or a coincidence — verify by checking funnel pages, signup IPs, and payout details.</p>
          </div>
        )}

        {/* Country breakdown of FTS customers (from PostHog $pageview geo) */}
        {tts?.countries && tts.countries.length > 0 && (
          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Where this affiliate&apos;s paid customers come from</h3>
            <div className="flex flex-wrap gap-2">
              {tts.countries.slice(0, 12).map((c) => (
                <div key={c.code} className="bg-muted inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400">{c.count}</span>
                </div>
              ))}
              {tts.countries.length > 12 && (
                <span className="text-muted-foreground self-center text-xs">+{tts.countries.length - 12} more</span>
              )}
            </div>
            <p className="text-muted-foreground mt-1.5 text-[11px]">From PostHog $geoip_country on the customer&apos;s latest pageview. Shows {tts.countries.reduce((s, c) => s + c.count, 0)} of {tts.fts} matched FTS (rest had no geo data).</p>
          </div>
        )}

        {/* Signals */}
        {affiliate.risk.signals.length === 0 ? (
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
            ✓ No fraud signals fired for this affiliate.
          </div>
        ) : (
          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Why this affiliate is flagged</h3>
            <div className="space-y-2">
              {affiliate.risk.signals.map((s) => (
                <div key={s.key} className="bg-muted flex items-start gap-2 rounded-lg p-3">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', severityDot(s.severity))} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{s.label}</p>
                      <span className="text-muted-foreground text-xs font-medium">{s.value}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top traffic sources */}
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : detail && (
          <>
            {(detail.topReferrers.length > 0 || detail.topLandings.length > 0) && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {detail.topReferrers.length > 0 && (
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Top referrers</p>
                    <ul className="space-y-1 text-sm">
                      {detail.topReferrers.map((r) => (
                        <li key={r.host} className="flex justify-between">
                          <span className={cn('font-mono', r.host.includes('google') && 'text-red-600 dark:text-red-400')}>{r.host}</span>
                          <span className="text-muted-foreground tabular-nums">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {detail.topLandings.length > 0 && (
                  <div className="bg-muted rounded-lg p-3">
                    <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Top landing pages</p>
                    <ul className="space-y-1 text-sm">
                      {detail.topLandings.map((r) => (
                        <li key={r.path} className="flex justify-between gap-2">
                          <span className="truncate font-mono" title={r.path}>{r.path}</span>
                          <span className="text-muted-foreground tabular-nums">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Recent referrals table */}
            {detail.referrals.length > 0 && (
              <div>
                <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Recent referrals ({detail.referrals.length})</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <Table className="text-xs">
                    <TableHeader className="bg-muted">
                      <TableRow>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>TTC</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.referrals.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-muted-foreground whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge variant={r.status === 'converted' ? 'default' : 'secondary'} className="text-[10px]">{r.status}</Badge>
                          </TableCell>
                          <TableCell className={cn('tabular-nums', r.ttcSeconds !== null && r.ttcSeconds < 300 && 'font-semibold text-red-600 dark:text-red-400')}>
                            {formatTtc(r.ttcSeconds)}
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate font-mono" title={r.referrer ?? ''}>
                            {r.utmSource ? `${r.utmSource}/${r.utmMedium ?? '?'}` : (r.referrer ? new URL(r.referrer).hostname.replace(/^www\./, '') : 'direct')}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[160px] truncate" title={r.customerEmail ?? ''}>{r.customerEmail ?? '—'}</TableCell>
                          <TableCell>
                            {r.flags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {r.flags.map(f => (
                                  <Badge key={f} variant="secondary" className="bg-red-50 font-mono text-[10px] text-red-700 dark:bg-red-500/15 dark:text-red-300">{f}</Badge>
                                ))}
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Review controls */}
        <Separator />
        <div>
          <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Tag fraud type</h3>
          <p className="text-muted-foreground mb-2 text-xs">Click to toggle. Tags save automatically.</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {FRAUD_TAG_OPTIONS.map((opt) => {
              const active = tags.includes(opt.key);
              const isPositive = opt.key === 'verified_legit';
              return (
                <Button
                  key={opt.key}
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={saving}
                  onClick={() => toggleTag(opt.key)}
                  className={cn(
                    active && (isPositive
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-red-600 text-white hover:bg-red-700'),
                  )}
                >
                  {opt.emoji} {opt.label}
                </Button>
              );
            })}
          </div>

          <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">Manual review</h3>
          <div className="mb-3 grid gap-1.5">
            <Label htmlFor="known-url" className="text-muted-foreground text-xs">Known affiliate URL (their site/channel/funnel)</Label>
            <Input id="known-url" type="text" value={knownUrl} onChange={(e) => setKnownUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="mb-3 grid gap-1.5">
            <Label htmlFor="review-notes" className="text-muted-foreground text-xs">Review notes</Label>
            <textarea
              id="review-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What did you find when you checked them?"
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={() => setStatus('flagged')} className="bg-red-600 text-white hover:bg-red-700">🚩 Flag as fraud</Button>
            <Button size="sm" disabled={saving} onClick={() => setStatus('paused')} variant="secondary">⏸ Pause</Button>
            <Button size="sm" disabled={saving} onClick={() => setStatus('cleared')} className="bg-emerald-600 text-white hover:bg-emerald-700">✓ Cleared</Button>
            <Button size="sm" disabled={saving} onClick={() => setStatus('unreviewed')} variant="outline">Reset</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className={cn('rounded-lg p-3', tone === 'danger' ? 'bg-red-50 dark:bg-red-500/10' : 'bg-muted')}>
      <p className="text-muted-foreground mb-0.5 text-xs">{label}</p>
      <p className={cn('text-lg font-bold tabular-nums', tone === 'danger' && 'text-red-700 dark:text-red-400')}>{value}</p>
    </div>
  );
}

/** A small stat card used across the fraud summary rows. */
function SummaryCard({ label, value, sub, tone }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: 'danger' | 'warn' | 'caution';
}) {
  const toneClass =
    tone === 'danger' ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10'
    : tone === 'warn' ? 'border-orange-200 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/10'
    : tone === 'caution' ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
    : '';
  const textClass =
    tone === 'danger' ? 'text-red-700 dark:text-red-300'
    : tone === 'warn' ? 'text-orange-700 dark:text-orange-300'
    : tone === 'caution' ? 'text-amber-700 dark:text-amber-300'
    : '';
  return (
    <Card className={cn('gap-1 py-4', toneClass)}>
      <CardHeader className="px-4">
        <CardDescription className={cn('text-xs font-medium', textClass)}>{label}</CardDescription>
        <CardTitle className={cn('mt-1 text-2xl tabular-nums', textClass)}>{value}</CardTitle>
      </CardHeader>
      {sub && (
        <CardContent className="px-4">
          <p className={cn('text-[11px]', textClass ? `${textClass} opacity-80` : 'text-muted-foreground')}>{sub}</p>
        </CardContent>
      )}
    </Card>
  );
}

type FilterKey = 'all' | 'high' | 'medium' | 'unreviewed' | 'flagged' | 'tagged' | 'brand_bidding';
type SortKey = 'unpaid' | 'risk' | 'clicks' | 'pageviews' | 'signups' | 'phFts' | 'conversions' | 'suFtsRate' | 'instant' | 'signupToFts' | 'googleSim';

// Colour for SU→FTS rate: red if within 0.5x of Google brand baseline (likely
// brand-bidding fingerprint), amber if 0.5-2x, gray if much lower/higher.
function suFtsTone(rate: number | null | undefined, baseline: number | null | undefined): string {
  if (rate == null) return 'text-muted-foreground';
  if (baseline == null) return 'text-foreground';
  const ratio = rate / baseline;
  if (ratio >= 0.5 && ratio <= 2) return 'text-red-600 font-bold dark:text-red-400';
  if (ratio >= 0.25 && ratio < 0.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-foreground';
}
type SortDir = 'asc' | 'desc';

function SortableTh({ sortKey, sortDir, onSort, k, label, align, title }: {
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void;
  k: SortKey; label: string; align: 'left' | 'right'; title?: string;
}) {
  const active = sortKey === k;
  const indicator = active
    ? (sortDir === 'asc'
        ? <ArrowUp className="ml-1 inline size-3 text-indigo-600 dark:text-indigo-400" />
        : <ArrowDown className="ml-1 inline size-3 text-indigo-600 dark:text-indigo-400" />)
    : <ChevronsUpDown className="text-muted-foreground/50 ml-1 inline size-3" />;
  return (
    <TableHead
      title={title}
      onClick={() => onSort(k)}
      className={cn('cursor-pointer whitespace-nowrap select-none', align === 'right' ? 'text-right' : 'text-left')}
    >
      {label}{indicator}
    </TableHead>
  );
}

const SORTABLE_HEADERS: { key: SortKey; label: string; defaultDir: SortDir; title?: string }[] = [
  { key: 'risk', label: 'Risk', defaultDir: 'desc' },
  { key: 'clicks', label: 'Clicks', defaultDir: 'desc' },
  { key: 'pageviews', label: 'Pageviews', defaultDir: 'desc' },
  { key: 'signups', label: 'Signups', defaultDir: 'desc' },
  { key: 'phFts', label: 'FTS', defaultDir: 'desc' },
  { key: 'conversions', label: 'Conversions', defaultDir: 'desc' },
  { key: 'instant', label: 'Instant %', defaultDir: 'desc' },
  { key: 'signupToFts', label: 'Median Sign-up to FTS', defaultDir: 'asc' },
  { key: 'suFtsRate', label: 'Signup to FTS', defaultDir: 'desc' },
  { key: 'googleSim', label: 'vs Google', defaultDir: 'desc' },
  { key: 'unpaid', label: 'Unpaid', defaultDir: 'desc' },
];

interface TtsPerAffiliate {
  signupToFtsSecMedian: number | null;
  googleSimilarity: number | null | undefined;
  fts: number;
  signups?: number;
  pageviews?: number | null;
  signupToFtsRate?: number | null;
  countries?: { code: string; name: string; count: number }[];
}

interface TtsOverall {
  signupToFtsSecMedian: number | null;
  googleSignupToFtsSecMedian: number | null;
  restSignupToFtsSecMedian: number | null;
  googleFts: number;
  restFts: number;
  googleSignups?: number;
  restSignups?: number;
  googleSuToFtsRate?: number | null;
  restSuToFtsRate?: number | null;
}

const FILTER_LABELS: Record<FilterKey, string> = {
  high: 'High',
  medium: 'Medium',
  unreviewed: 'Unreviewed',
  flagged: 'Flagged',
  tagged: '🏷 Any tag',
  brand_bidding: '🎯 Brand bidding',
  all: 'All',
};

export default function FraudPage() {
  const [data, setData] = useState<FraudListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('high');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<FraudAffiliate | null>(null);
  const [ttsByAffId, setTtsByAffId] = useState<Map<string, TtsPerAffiliate>>(new Map());
  const [ttsOverall, setTtsOverall] = useState<TtsOverall | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('unpaid');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [hideZeroUnpaid, setHideZeroUnpaid] = useState(true);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      const def = SORTABLE_HEADERS.find(h => h.key === key)?.defaultDir ?? 'desc';
      setSortDir(def);
    }
  }

  async function load() {
    setLoading(true);
    try {
      // Fire fraud + TTS in parallel. Fraud lands fast (<1s); TTS waits on PostHog (~3s).
      const fraudP = fetch('/api/fraud').then(r => r.json());
      const ttsP = fetch('/api/affiliates/tts?from=2025-01-01&to=2027-01-01').then(r => r.json()).catch(() => null);
      const json = await fraudP;
      setData(json);
      ttsP.then((tts: { overall?: TtsOverall; affiliates?: { affiliateId?: string; signupToFtsSecMedian: number | null; googleSimilarity?: number | null; fts: number; signups?: number; pageviews?: number | null; signupToFtsRate?: number | null; countries?: { code: string; name: string; count: number }[] }[] }) => {
        if (tts?.overall) setTtsOverall(tts.overall);
        if (!tts?.affiliates) return;
        const m = new Map<string, TtsPerAffiliate>();
        for (const r of tts.affiliates) {
          if (r.affiliateId) m.set(r.affiliateId, {
            signupToFtsSecMedian: r.signupToFtsSecMedian,
            googleSimilarity: r.googleSimilarity,
            fts: r.fts,
            signups: r.signups,
            pageviews: r.pageviews,
            signupToFtsRate: r.signupToFtsRate,
            countries: r.countries,
          });
        }
        setTtsByAffId(m);
      }).catch(() => {});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const rows = data.affiliates.filter((a) => {
      if (hideZeroUnpaid && a.unpaidCommissionCents <= 0) return false;
      if (filter === 'high' && a.risk.band !== 'high') return false;
      if (filter === 'medium' && a.risk.band !== 'medium') return false;
      if (filter === 'unreviewed' && a.reviewStatus !== 'unreviewed') return false;
      if (filter === 'flagged' && a.reviewStatus !== 'flagged') return false;
      if (filter === 'tagged' && a.fraudTags.length === 0) return false;
      if (filter === 'brand_bidding' && !a.fraudTags.includes('brand_bidding')) return false;
      if (search) {
        const q = search.toLowerCase();
        const tokenMatch = a.linkToken?.toLowerCase().includes(q) ?? false;
        if (!a.name.toLowerCase().includes(q) && !(a.email?.toLowerCase().includes(q)) && !tokenMatch) return false;
      }
      return true;
    });

    // Sort
    const sortVal = (a: FraudAffiliate): number => {
      const tts = ttsByAffId.get(a.id);
      switch (sortKey) {
        case 'unpaid':      return a.unpaidCommissionCents;
        case 'risk':        return a.risk.score;
        case 'clicks':      return a.referrals;
        case 'pageviews':   return tts?.pageviews ?? -1;
        case 'signups':     return tts?.signups ?? -1;
        case 'phFts':       return tts?.fts ?? -1;
        case 'conversions': return a.conversions;
        case 'suFtsRate':   return tts?.signupToFtsRate ?? -1;
        case 'instant':     return a.risk.stats.instantConvPct;
        case 'signupToFts': return tts?.signupToFtsSecMedian ?? Number.POSITIVE_INFINITY;
        case 'googleSim':   return tts?.googleSimilarity ?? -1;
      }
    };
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => (sortVal(a) - sortVal(b)) * dir);
  }, [data, filter, search, sortKey, sortDir, hideZeroUnpaid, ttsByAffId]);

  function updateAffiliate(id: string, patch: Partial<FraudAffiliate>) {
    if (!data) return;
    setData({
      ...data,
      affiliates: data.affiliates.map((a) => a.id === id ? { ...a, ...patch } : a),
    });
    if (selected?.id === id) setSelected({ ...selected, ...patch });
  }

  return (
    <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
      {selected && <FraudModal affiliate={selected} tts={ttsByAffId.get(selected.id)} onClose={() => setSelected(null)} onReviewUpdate={updateAffiliate} />}

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href="/"><ArrowLeft className="size-3.5" /> Dashboard</Link>
            </Button>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-2xl font-bold tracking-tight">Brand-Bidding &amp; Fraud Audit</h1>
          </div>
          <p className="text-muted-foreground text-sm">Identify affiliates running brand-keyword ads, intercepting buyer-intent traffic, or otherwise faking referrals.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {/* Summary cards */}
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-5">
            <SummaryCard tone="danger" label="High risk" value={data.summary.highRisk} sub={`${fmt(data.summary.unpaidAtRiskCents)} unpaid`} />
            <SummaryCard tone="caution" label="Medium risk" value={data.summary.mediumRisk} />
            <SummaryCard label="Low risk" value={data.summary.lowRisk} />
            <SummaryCard label="Flagged" value={`🚩 ${data.summary.flagged}`} />
            <SummaryCard label="Cleared" value={`✓ ${data.summary.cleared}`} />
          </div>

          {/* PostHog Google brand-search baselines */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="gap-1 border-red-200 bg-red-50 py-4 dark:border-red-500/30 dark:bg-red-500/10">
              <CardHeader className="px-4">
                <CardDescription className="text-xs font-semibold text-red-700 dark:text-red-300">🎯 Median sign-up to pay time (Google brand search)</CardDescription>
                <CardTitle className={cn('mt-1 text-2xl tabular-nums', ttsTone(ttsOverall?.googleSignupToFtsSecMedian ?? null))}>
                  {ttsOverall ? fmtDuration(ttsOverall.googleSignupToFtsSecMedian) : <Skeleton className="h-7 w-20" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xs text-red-700/70 dark:text-red-300/70">
                  SER_BRAND baseline ({ttsOverall ? ttsOverall.googleFts.toLocaleString() : '—'} FTS / {ttsOverall ? (ttsOverall.googleSignups ?? 0).toLocaleString() : '—'} signups)
                </p>
              </CardContent>
            </Card>
            <Card className="gap-1 border-red-200 bg-red-50 py-4 dark:border-red-500/30 dark:bg-red-500/10">
              <CardHeader className="px-4">
                <CardDescription className="text-xs font-semibold text-red-700 dark:text-red-300">🎯 SU→FTS rate (Google brand search)</CardDescription>
                <CardTitle className="mt-1 text-2xl tabular-nums text-red-700 dark:text-red-300">
                  {ttsOverall?.googleSuToFtsRate != null ? `${(ttsOverall.googleSuToFtsRate * 100).toFixed(2)}%` : <Skeleton className="h-7 w-20" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-xs text-red-700/70 dark:text-red-300/70">Signup → first paid rate for brand intercept. Affiliates matching this are likely brand-bidding.</p>
              </CardContent>
            </Card>
          </div>

          {/* Cross-affiliate / refund / self-referral anomaly summary */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
            <SummaryCard tone="danger" label="Self-referral" value={data.summary.affiliatesWithSelfReferral} sub="Own email = customer" />
            <SummaryCard tone="danger" label="Conv <60s" value={data.summary.affiliatesWithSuperFastConv} sub="Super-fast conversions" />
            <SummaryCard tone="warn" label="Duplicate names" value={data.summary.affiliatesWithDuplicateName} sub="Same name, multiple accounts" />
            <SummaryCard tone="warn" label="Shared customers" value={data.summary.affiliatesWithSharedCustomers} sub="Customer under multiple affs" />
            <SummaryCard tone="caution" label="Burst pattern" value={data.summary.affiliatesWithBurstPattern} sub="≥70% refs in single day" />
            <SummaryCard tone="caution" label="High refund" value={data.summary.affiliatesWithHighRefundRate} sub="≥15% voided commissions" />
          </div>
        </>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <TabsList>
            {(['high', 'medium', 'unreviewed', 'flagged', 'tagged', 'brand_bidding', 'all'] as FilterKey[]).map((f) => (
              <TabsTrigger key={f} value={f}>{FILTER_LABELS[f]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input type="checkbox" checked={hideZeroUnpaid} onChange={(e) => setHideZeroUnpaid(e.target.checked)} className="accent-primary size-3.5 rounded" />
          Hide $0 unpaid
        </label>
        <div className="relative ml-auto">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Search name, email, or via=token…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-72 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card className="p-0">
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        </Card>
      ) : !data || filtered.length === 0 ? (
        <Card className="p-12">
          <p className="text-muted-foreground text-center text-sm">No affiliates match the current filter.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table className="min-w-[1400px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Affiliate</TableHead>
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="risk" label="Risk" align="right" title="0-100 weighted risk score" />
                <TableHead title="Top 3 fraud signals that fired">Top signals</TableHead>
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="clicks" label="Clicks" align="right" title="Total ?via=token clicks (Rewardful all-time)" />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="pageviews" label="Pageviews (PostHog)" align="right" title="Distinct users with $pageview on a ?via=token URL (PostHog, in window)" />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="signups" label="Signups (PostHog)" align="right" title="REAL signup count from PostHog (in window)" />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="phFts" label="FTS (PostHog)" align="right" title="First-time-paid customers matched to this affiliate via customer_email (in window)" />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="conversions" label="Conversions (Rewardful)" align="right" title="Rewardful 'converted' state count — all-time" />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="instant" label="Instant %" align="right" title="% of conversions where click→paid was <5 min" />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="signupToFts" label="Median Sign-up to FTS time" align="right" title="Median sign_up → first paid (PostHog, in window)" />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="suFtsRate" label="Signup to FTS" align="right" title="FTS / Signups (PostHog). Compare to Google brand baseline — affiliates matching it are likely brand-bidding." />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="googleSim" label="vs Google" align="left" title="Similarity to Google brand-search baseline" />
                <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="unpaid" label="Unpaid" align="right" title="Unpaid commission balance" />
                <TableHead title="Manual review state" className="px-4 text-right">Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const tts = ttsByAffId.get(a.id);
                return (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelected(a)}>
                    <TableCell className="px-4 py-3">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-muted-foreground text-xs">{a.email}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {a.linkToken && (
                          <Badge asChild variant="secondary" className="bg-indigo-50 font-mono text-[10px] text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
                            <a
                              href={`https://runable.com/?via=${a.linkToken}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Open affiliate funnel"
                            >
                              ?via={a.linkToken}
                            </a>
                          </Badge>
                        )}
                        {a.fraudTags.map((t) => <FraudTagPill key={t} tag={t} />)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={cn('font-bold tabular-nums', bandClass(a.risk.band))}>{a.risk.score}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {a.risk.signals.slice(0, 3).map(s => (
                          <Tooltip key={s.key}>
                            <TooltipTrigger asChild>
                              <Badge variant="secondary" className="font-mono text-[10px]">{s.label}</Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{s.detail}</TooltipContent>
                          </Tooltip>
                        ))}
                        {a.risk.signals.length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.referrals.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {tts && tts.pageviews != null ? tts.pageviews.toLocaleString() : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {tts && tts.signups != null ? tts.signups.toLocaleString() : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {tts ? tts.fts.toLocaleString() : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{a.conversions.toLocaleString()}</TableCell>
                    <TableCell className={cn('text-right font-medium tabular-nums', a.risk.stats.instantConvPct > 0.4 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                      {a.risk.stats.instantConvPct > 0 ? `${(a.risk.stats.instantConvPct * 100).toFixed(0)}%` : '—'}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', ttsTone(tts?.signupToFtsSecMedian ?? null))}>
                      {tts ? fmtDuration(tts.signupToFtsSecMedian) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', suFtsTone(tts?.signupToFtsRate, ttsOverall?.googleSuToFtsRate))}>
                      {tts && tts.signupToFtsRate != null ? `${(tts.signupToFtsRate * 100).toFixed(1)}%` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {tts && tts.googleSimilarity !== null && tts.googleSimilarity !== undefined ? (
                        <div className="flex items-center gap-2">
                          <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                            <div className={cn('h-full', similarityTone(tts.googleSimilarity))} style={{ width: `${Math.round(tts.googleSimilarity * 100)}%` }} />
                          </div>
                          <span className="text-muted-foreground text-[10px] tabular-nums">{Math.round(tts.googleSimilarity * 100)}%</span>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">{fmt(a.unpaidCommissionCents)}</TableCell>
                    <TableCell className="px-4 text-right">
                      <Badge variant="secondary" className={reviewBadgeClass(a.reviewStatus)}>{a.reviewStatus}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Methodology footnote */}
      <Card className="mt-6 gap-2 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">How risk is scored</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground px-4 text-xs">
          <ul className="list-disc space-y-1 pl-5">
            <li><b>gclid in referral URL</b> — visitor clicked a paid Google Ad before being attributed to the affiliate. Strongest brand-bidding signal.</li>
            <li><b>utm_medium=cpc/ppc/paid</b> — affiliate is driving paid traffic, not the organic content they were approved for.</li>
            <li><b>Google referrer concentration</b> — most/all referrals come from google.com. Real content affiliates have diversified sources.</li>
            <li><b>Instant conversions (&lt;5 min)</b> — visitor clicked the affiliate link and signed up in seconds. They were already buyer-intent.</li>
            <li><b>Abnormal conversion rate</b> — &gt;40% conv. rate is suspicious; content affiliates land at 5-20%.</li>
            <li><b>&ldquo;runable&rdquo; in utm_term/utm_campaign</b> — the affiliate is literally bidding on our brand keyword.</li>
          </ul>
          <p className="mt-2">If signals fire but the data feels wrong, click the affiliate, hit the Google search shortcuts in the modal, and manually verify before flagging.</p>
        </CardContent>
      </Card>
    </div>
  );
}
