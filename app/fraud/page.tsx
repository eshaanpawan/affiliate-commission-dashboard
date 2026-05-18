'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { fmtDuration, ttsTone, similarityTone } from '@/lib/format';

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
  const cls = tag === 'verified_legit'
    ? 'bg-emerald-50 text-emerald-700'
    : 'bg-red-50 text-red-700';
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {opt?.emoji ?? '🚩'} {opt?.label ?? tag.replace(/_/g, ' ')}
    </span>
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

function bandColor(band: string) {
  return band === 'high' ? 'bg-red-100 text-red-700 border-red-200'
    : band === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

function reviewBadgeColor(status: string) {
  return status === 'flagged' ? 'bg-red-100 text-red-700'
    : status === 'cleared' ? 'bg-emerald-100 text-emerald-700'
    : status === 'paused' ? 'bg-gray-200 text-gray-700'
    : 'bg-gray-100 text-gray-500';
}

function severityDot(sev: string) {
  return sev === 'high' ? 'bg-red-500' : sev === 'medium' ? 'bg-amber-500' : 'bg-gray-300';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 p-6 overflow-y-auto max-h-[92vh]" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-bold text-gray-900">{affiliate.name}</h2>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${bandColor(affiliate.risk.band)}`}>
                Risk {affiliate.risk.score} · {affiliate.risk.band.toUpperCase()}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${reviewBadgeColor(affiliate.reviewStatus)}`}>
                {affiliate.reviewStatus}
              </span>
            </div>
            <p className="text-sm text-gray-400">{affiliate.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {/* Quick action investigation links */}
        <div className="flex flex-wrap gap-2 mb-5">
          <a href={googleBrandCheckUrl(affiliate.name)} target="_blank" rel="noreferrer"
             className="text-xs px-2.5 py-1.5 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium">
            🔍 Google "runable {affiliate.name}"
          </a>
          <a href={googleSiteSearchUrl(affiliate.name)} target="_blank" rel="noreferrer"
             className="text-xs px-2.5 py-1.5 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium">
            🔍 Find affiliate page
          </a>
          {affiliate.email && (
            <a href={`https://www.google.com/search?q=${encodeURIComponent(affiliate.email.split('@')[0])}`}
               target="_blank" rel="noreferrer"
               className="text-xs px-2.5 py-1.5 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium">
              🔍 Search by handle
            </a>
          )}
          {detail?.linkTokens.slice(0, 2).map((token) => (
            <a key={token} href={`https://runable.com/?via=${token}`} target="_blank" rel="noreferrer"
               className="text-xs px-2.5 py-1.5 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 font-mono">
              ↗ ?via={token}
            </a>
          ))}
          {detail?.linkTokens[0] && (
            <a href={`https://www.google.com/search?q=${encodeURIComponent(`"via=${detail.linkTokens[0]}"`)}`}
               target="_blank" rel="noreferrer"
               className="text-xs px-2.5 py-1.5 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 font-medium">
              🔍 Where they post links
            </a>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-5">
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

        <div className="grid grid-cols-2 gap-3 mb-5">
          <Stat label="Unpaid (at risk)" value={fmt(affiliate.unpaidCommissionCents)}
                tone={affiliate.risk.band === 'high' ? 'danger' : undefined} />
          <Stat label="Already paid" value={fmt(affiliate.paidCommissionCents)} />
        </div>

        {/* Other affiliates with the same first+last name (multi-account ring indicator) */}
        {affiliate.duplicateNames && affiliate.duplicateNames.length > 0 && (
          <div className="mb-5">
            <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">
              ⚠️ Other affiliates with the same name ({affiliate.duplicateNames.length})
            </h3>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-1.5">
              {affiliate.duplicateNames.map((d) => (
                <div key={d.id} className="text-sm flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{d.name}</span>
                  {d.email && <span className="text-xs text-gray-500 font-mono">&lt;{d.email}&gt;</span>}
                  <span className="text-[10px] font-mono text-gray-400">{d.id.slice(0, 8)}…</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">Same first+last name across multiple accounts. Could be a multi-account ring or a coincidence — verify by checking funnel pages, signup IPs, and payout details.</p>
          </div>
        )}

        {/* Country breakdown of FTS customers (from PostHog $pageview geo) */}
        {tts?.countries && tts.countries.length > 0 && (
          <div className="mb-5">
            <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">Where this affiliate's paid customers come from</h3>
            <div className="flex flex-wrap gap-2">
              {tts.countries.slice(0, 12).map((c) => (
                <div key={c.code} className="inline-flex items-center gap-1.5 bg-gray-50 rounded-md px-2 py-1 text-xs">
                  <span className="font-medium text-gray-900">{c.name}</span>
                  <span className="text-gray-500">·</span>
                  <span className="font-mono text-indigo-600">{c.count}</span>
                </div>
              ))}
              {tts.countries.length > 12 && (
                <span className="text-xs text-gray-400 self-center">+{tts.countries.length - 12} more</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">From PostHog $geoip_country on the customer's latest pageview. Shows {tts.countries.reduce((s, c) => s + c.count, 0)} of {tts.fts} matched FTS (rest had no geo data).</p>
          </div>
        )}

        {/* Signals */}
        {affiliate.risk.signals.length === 0 ? (
          <div className="text-sm text-gray-500 mb-5 p-3 bg-emerald-50 rounded-lg">
            ✓ No fraud signals fired for this affiliate.
          </div>
        ) : (
          <div className="mb-5">
            <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">Why this affiliate is flagged</h3>
            <div className="space-y-2">
              {affiliate.risk.signals.map((s) => (
                <div key={s.key} className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg">
                  <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${severityDot(s.severity)}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{s.label}</p>
                      <span className="text-xs font-medium text-gray-500">{s.value}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top traffic sources */}
        {loading ? (
          <div className="h-20 flex items-center justify-center text-gray-400 text-sm">Loading detail...</div>
        ) : detail && (
          <>
            {(detail.topReferrers.length > 0 || detail.topLandings.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                {detail.topReferrers.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs font-semibold uppercase text-gray-500 mb-2">Top referrers</p>
                    <ul className="text-sm space-y-1">
                      {detail.topReferrers.map((r) => (
                        <li key={r.host} className="flex justify-between">
                          <span className={r.host.includes('google') ? 'text-red-700 font-mono' : 'text-gray-700 font-mono'}>{r.host}</span>
                          <span className="text-gray-500">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {detail.topLandings.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs font-semibold uppercase text-gray-500 mb-2">Top landing pages</p>
                    <ul className="text-sm space-y-1">
                      {detail.topLandings.map((r) => (
                        <li key={r.path} className="flex justify-between gap-2">
                          <span className="text-gray-700 font-mono truncate" title={r.path}>{r.path}</span>
                          <span className="text-gray-500">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Recent referrals table */}
            {detail.referrals.length > 0 && (
              <div className="mb-5">
                <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">Recent referrals ({detail.referrals.length})</h3>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-2 py-2 font-medium text-gray-500">Created</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-500">Status</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-500">TTC</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-500">Source</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-500">Customer</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-500">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.referrals.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100">
                          <td className="px-2 py-2 text-gray-600 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</td>
                          <td className="px-2 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${r.status === 'converted' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                          </td>
                          <td className="px-2 py-2 text-gray-600">{r.ttcSeconds !== null && r.ttcSeconds < 300 ? <span className="text-red-600 font-semibold">{formatTtc(r.ttcSeconds)}</span> : formatTtc(r.ttcSeconds)}</td>
                          <td className="px-2 py-2 text-gray-700 font-mono truncate max-w-[180px]" title={r.referrer ?? ''}>
                            {r.utmSource ? `${r.utmSource}/${r.utmMedium ?? '?'}` : (r.referrer ? new URL(r.referrer).hostname.replace(/^www\./, '') : 'direct')}
                          </td>
                          <td className="px-2 py-2 text-gray-600 truncate max-w-[160px]" title={r.customerEmail ?? ''}>{r.customerEmail ?? '—'}</td>
                          <td className="px-2 py-2">
                            {r.flags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {r.flags.map(f => (
                                  <span key={f} className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[10px] font-mono">{f}</span>
                                ))}
                              </div>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Review controls */}
        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">Tag fraud type</h3>
          <p className="text-xs text-gray-400 mb-2">Click to toggle. Tags save automatically.</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {FRAUD_TAG_OPTIONS.map((opt) => {
              const active = tags.includes(opt.key);
              const isPositive = opt.key === 'verified_legit';
              const activeCls = isPositive
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-red-600 text-white border-red-600';
              const inactiveCls = 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50';
              return (
                <button
                  key={opt.key}
                  disabled={saving}
                  onClick={() => toggleTag(opt.key)}
                  className={`text-xs px-2.5 py-1 rounded-md border font-medium transition-colors disabled:opacity-50 ${active ? activeCls : inactiveCls}`}
                >
                  {opt.emoji} {opt.label}
                </button>
              );
            })}
          </div>

          <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">Manual review</h3>
          <div className="mb-3">
            <label className="text-xs text-gray-500 mb-1 block">Known affiliate URL (their site/channel/funnel)</label>
            <input type="text" value={knownUrl} onChange={(e) => setKnownUrl(e.target.value)}
                   placeholder="https://..."
                   className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-indigo-400" />
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-500 mb-1 block">Review notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                      placeholder="What did you find when you checked them?"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-indigo-400" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={saving} onClick={() => setStatus('flagged')} className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">🚩 Flag as fraud</button>
            <button disabled={saving} onClick={() => setStatus('paused')} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50">⏸ Pause</button>
            <button disabled={saving} onClick={() => setStatus('cleared')} className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">✓ Cleared</button>
            <button disabled={saving} onClick={() => setStatus('unreviewed')} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">Reset</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className={`rounded-lg p-3 ${tone === 'danger' ? 'bg-red-50' : 'bg-gray-50'}`}>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className={`text-lg font-bold ${tone === 'danger' ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

type FilterKey = 'all' | 'high' | 'medium' | 'unreviewed' | 'flagged' | 'tagged' | 'brand_bidding';
type SortKey = 'unpaid' | 'risk' | 'clicks' | 'signups' | 'convRate' | 'suFtsRate' | 'instant' | 'signupToFts' | 'googleSim';

// Colour for SU→FTS rate: red if within 0.5x of Google brand baseline (likely
// brand-bidding fingerprint), amber if 0.5-2x, gray if much lower/higher.
function suFtsTone(rate: number | null | undefined, baseline: number | null | undefined): string {
  if (rate == null) return 'text-gray-400';
  if (baseline == null) return 'text-gray-700';
  const ratio = rate / baseline;
  if (ratio >= 0.5 && ratio <= 2) return 'text-red-600 font-bold';
  if (ratio >= 0.25 && ratio < 0.5) return 'text-amber-600';
  return 'text-gray-700';
}
type SortDir = 'asc' | 'desc';

function SortableTh({ sortKey, sortDir, onSort, k, label, align, title }: {
  sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void;
  k: SortKey; label: string; align: 'left' | 'right'; title?: string;
}) {
  const active = sortKey === k;
  const indicator = active
    ? <span className="ml-1 text-indigo-500">{sortDir === 'asc' ? '↑' : '↓'}</span>
    : <span className="ml-1 text-gray-300">↕</span>;
  return (
    <th title={title} onClick={() => onSort(k)} className={`px-3 py-3 font-medium cursor-pointer select-none hover:text-gray-800 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {label}{indicator}
    </th>
  );
}

const SORTABLE_HEADERS: { key: SortKey; label: string; defaultDir: SortDir; title?: string }[] = [
  { key: 'risk', label: 'Risk', defaultDir: 'desc' },
  { key: 'clicks', label: 'Clicks', defaultDir: 'desc' },
  { key: 'convRate', label: 'Click→Pay', defaultDir: 'desc' },
  { key: 'instant', label: 'Instant %', defaultDir: 'desc' },
  { key: 'signupToFts', label: 'Median sign-up to pay', defaultDir: 'asc' },
  { key: 'googleSim', label: 'vs Google', defaultDir: 'desc' },
  { key: 'unpaid', label: 'Unpaid', defaultDir: 'desc' },
];

interface TtsPerAffiliate {
  signupToFtsSecMedian: number | null;
  googleSimilarity: number | null | undefined;
  fts: number;
  signups?: number;
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
      const ttsP = fetch('/api/affiliates/tts?from=2026-04-01&to=2026-06-01').then(r => r.json()).catch(() => null);
      const json = await fraudP;
      setData(json);
      ttsP.then((tts: { overall?: TtsOverall; affiliates?: { affiliateId?: string; signupToFtsSecMedian: number | null; googleSimilarity?: number | null; fts: number; signups?: number; signupToFtsRate?: number | null; countries?: { code: string; name: string; count: number }[] }[] }) => {
        if (tts?.overall) setTtsOverall(tts.overall);
        if (!tts?.affiliates) return;
        const m = new Map<string, TtsPerAffiliate>();
        for (const r of tts.affiliates) {
          if (r.affiliateId) m.set(r.affiliateId, {
            signupToFtsSecMedian: r.signupToFtsSecMedian,
            googleSimilarity: r.googleSimilarity,
            fts: r.fts,
            signups: r.signups,
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
        case 'unpaid':     return a.unpaidCommissionCents;
        case 'risk':       return a.risk.score;
        case 'clicks':     return a.referrals;
        case 'signups':    return tts?.signups ?? -1;
        case 'convRate':   return a.risk.stats.convRate;
        case 'suFtsRate':  return tts?.signupToFtsRate ?? -1;
        case 'instant':    return a.risk.stats.instantConvPct;
        case 'signupToFts': return tts?.signupToFtsSecMedian ?? Number.POSITIVE_INFINITY;
        case 'googleSim':  return tts?.googleSimilarity ?? -1;
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
    <div className="min-h-screen bg-gray-50">
      {selected && <FraudModal affiliate={selected} tts={ttsByAffId.get(selected.id)} onClose={() => setSelected(null)} onReviewUpdate={updateAffiliate} />}

      <div className="max-w-[112rem] mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/" className="text-sm text-indigo-500 hover:text-indigo-700">← Dashboard</Link>
              <span className="text-gray-300">/</span>
              <h1 className="text-2xl font-bold text-gray-900">Brand-Bidding & Fraud Audit</h1>
            </div>
            <p className="text-sm text-gray-400">Identify affiliates running brand-keyword ads, intercepting buyer-intent traffic, or otherwise faking referrals.</p>
          </div>
          <button onClick={load} disabled={loading} className="text-xs text-indigo-500 hover:text-indigo-700 disabled:opacity-40">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {/* Summary cards */}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-xs font-medium text-red-700">High risk</p>
                <p className="text-2xl font-bold text-red-700 mt-1">{data.summary.highRisk}</p>
                <p className="text-xs text-red-600/70 mt-0.5">{fmt(data.summary.unpaidAtRiskCents)} unpaid</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-medium text-amber-700">Medium risk</p>
                <p className="text-2xl font-bold text-amber-700 mt-1">{data.summary.mediumRisk}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-medium text-gray-500">Low risk</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{data.summary.lowRisk}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-medium text-gray-500">Flagged</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">🚩 {data.summary.flagged}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-medium text-gray-500">Cleared</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">✓ {data.summary.cleared}</p>
              </div>
            </div>
            {/* PostHog Google brand-search baselines (April-May 2026 window) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-red-700">🎯 Median sign-up to pay time (Google brand search)</p>
                <p className={`text-2xl font-bold mt-1 ${ttsTone(ttsOverall?.googleSignupToFtsSecMedian ?? null)}`}>
                  {ttsOverall ? fmtDuration(ttsOverall.googleSignupToFtsSecMedian) : <span className="text-gray-400 animate-pulse">…</span>}
                </p>
                <p className="text-xs text-red-600/70 mt-0.5">SER_BRAND baseline ({ttsOverall ? ttsOverall.googleFts.toLocaleString() : '—'} FTS / {ttsOverall ? (ttsOverall.googleSignups ?? 0).toLocaleString() : '—'} signups)</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-red-700">🎯 SU→FTS rate (Google brand search)</p>
                <p className="text-2xl font-bold mt-1 text-red-700">
                  {ttsOverall?.googleSuToFtsRate != null ? `${(ttsOverall.googleSuToFtsRate * 100).toFixed(2)}%` : <span className="text-gray-400 animate-pulse">…</span>}
                </p>
                <p className="text-xs text-red-600/70 mt-0.5">Signup → first paid rate for brand intercept. Affiliates matching this are likely brand-bidding.</p>
              </div>
            </div>

            {/* Cross-affiliate / refund / self-referral anomaly summary */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-red-700">Self-referral</p>
                <p className="text-xl font-bold text-red-700 mt-1">{data.summary.affiliatesWithSelfReferral}</p>
                <p className="text-[11px] text-red-600/70 mt-0.5">Own email = customer</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-red-700">Conv &lt;60s</p>
                <p className="text-xl font-bold text-red-700 mt-1">{data.summary.affiliatesWithSuperFastConv}</p>
                <p className="text-[11px] text-red-600/70 mt-0.5">Super-fast conversions</p>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-orange-700">Duplicate names</p>
                <p className="text-xl font-bold text-orange-700 mt-1">{data.summary.affiliatesWithDuplicateName}</p>
                <p className="text-[11px] text-orange-600/70 mt-0.5">Same name, multiple accounts</p>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-orange-700">Shared customers</p>
                <p className="text-xl font-bold text-orange-700 mt-1">{data.summary.affiliatesWithSharedCustomers}</p>
                <p className="text-[11px] text-orange-600/70 mt-0.5">Customer under multiple affs</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-700">Burst pattern</p>
                <p className="text-xl font-bold text-amber-700 mt-1">{data.summary.affiliatesWithBurstPattern}</p>
                <p className="text-[11px] text-amber-600/70 mt-0.5">≥70% refs in single day</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-700">High refund</p>
                <p className="text-xl font-bold text-amber-700 mt-1">{data.summary.affiliatesWithHighRefundRate}</p>
                <p className="text-[11px] text-amber-600/70 mt-0.5">≥15% voided commissions</p>
              </div>
            </div>
          </>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center mb-4">
          {(['high', 'medium', 'unreviewed', 'flagged', 'tagged', 'brand_bidding', 'all'] as FilterKey[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium ${filter === f ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              {f === 'all' ? 'All' : f === 'brand_bidding' ? '🎯 Brand bidding' : f === 'tagged' ? '🏷 Any tag' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <label className="flex items-center gap-1.5 ml-2 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" checked={hideZeroUnpaid} onChange={(e) => setHideZeroUnpaid(e.target.checked)} className="rounded" />
            Hide $0 unpaid
          </label>
          <input type="text" placeholder="Search name, email, or via=token…" value={search} onChange={(e) => setSearch(e.target.value)}
                 className="ml-auto px-3 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-indigo-400 w-64" />
        </div>

        {/* Table */}
        {loading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400 text-sm">Loading affiliates…</div>
        ) : !data || filtered.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400 text-sm">No affiliates match the current filter.</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="min-w-[1400px] w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left px-4 py-3 font-medium">Affiliate</th>
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="risk" label="Risk" align="right" title="0-100 weighted risk score" />
                  <th title="Top 3 fraud signals that fired" className="text-left px-3 py-3 font-medium">Top signals</th>
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="clicks" label="Clicks" align="right" title="Total referrals (?via=token clicks)" />
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="signups" label="Signups" align="right" title="REAL signup count from PostHog (people who created a Runable account via this affiliate's link)" />
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="convRate" label="Click→Pay" align="right" title="Paid / Clicks. >40% is suspicious." />
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="suFtsRate" label="SU→FTS" align="right" title="Paid / Signups. Compare to Google brand baseline — affiliates matching it are likely brand-bidding (intercepting buyer-intent traffic)." />
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="instant" label="Instant %" align="right" title="% of conversions in <5 min" />
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="signupToFts" label="Median sign-up to pay" align="right" title="Median sign_up → first paid (PostHog)" />
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="googleSim" label="vs Google" align="left" title="Similarity to Google brand-search baseline" />
                  <SortableTh sortKey={sortKey} sortDir={sortDir} onSort={handleSort} k="unpaid" label="Unpaid" align="right" title="Unpaid commission balance" />
                  <th title="Manual review state" className="text-right px-4 py-3 font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const tts = ttsByAffId.get(a.id);
                  return (
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-indigo-50 transition-colors cursor-pointer" onClick={() => setSelected(a)}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{a.name}</p>
                      <p className="text-xs text-gray-400">{a.email}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {a.linkToken && (
                          <a
                            href={`https://runable.com/?via=${a.linkToken}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                            title="Open affiliate funnel"
                          >
                            ?via={a.linkToken}
                          </a>
                        )}
                        {a.fraudTags.length > 0 && a.fraudTags.map((t) => <FraudTagPill key={t} tag={t} />)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${bandColor(a.risk.band)}`}>{a.risk.score}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {a.risk.signals.slice(0, 3).map(s => (
                          <span key={s.key} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 text-gray-700"
                                title={s.detail}>
                            {s.label}
                          </span>
                        ))}
                        {a.risk.signals.length === 0 && <span className="text-xs text-gray-300">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">{a.referrals}</td>
                    <td className="px-3 py-3 text-right font-medium text-gray-700">
                      {tts && tts.signups != null ? tts.signups.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`px-3 py-3 text-right font-medium ${a.risk.stats.convRate > 0.4 ? 'text-red-600' : 'text-gray-700'}`}>
                      {(a.risk.stats.convRate * 100).toFixed(0)}%
                    </td>
                    <td className={`px-3 py-3 text-right font-medium ${suFtsTone(tts?.signupToFtsRate, ttsOverall?.googleSuToFtsRate)}`}>
                      {tts && tts.signupToFtsRate != null ? `${(tts.signupToFtsRate * 100).toFixed(1)}%` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`px-3 py-3 text-right font-medium ${a.risk.stats.instantConvPct > 0.4 ? 'text-red-600' : 'text-gray-400'}`}>
                      {a.risk.stats.instantConvPct > 0 ? `${(a.risk.stats.instantConvPct * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className={`px-3 py-3 text-right ${ttsTone(tts?.signupToFtsSecMedian ?? null)}`}>
                      {tts ? fmtDuration(tts.signupToFtsSecMedian) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {tts && tts.googleSimilarity !== null && tts.googleSimilarity !== undefined ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div className={`h-full ${similarityTone(tts.googleSimilarity)}`} style={{ width: `${Math.round(tts.googleSimilarity * 100)}%` }} />
                          </div>
                          <span className="text-gray-500 tabular-nums text-[10px]">{Math.round(tts.googleSimilarity * 100)}%</span>
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-amber-600">{fmt(a.unpaidCommissionCents)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${reviewBadgeColor(a.reviewStatus)}`}>{a.reviewStatus}</span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Methodology footnote */}
        <div className="mt-6 text-xs text-gray-500 bg-white border border-gray-200 rounded-xl p-4">
          <p className="font-medium text-gray-700 mb-1">How risk is scored</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><b>gclid in referral URL</b> — visitor clicked a paid Google Ad before being attributed to the affiliate. Strongest brand-bidding signal.</li>
            <li><b>utm_medium=cpc/ppc/paid</b> — affiliate is driving paid traffic, not the organic content they were approved for.</li>
            <li><b>Google referrer concentration</b> — most/all referrals come from google.com. Real content affiliates have diversified sources.</li>
            <li><b>Instant conversions (&lt;5 min)</b> — visitor clicked the affiliate link and signed up in seconds. They were already buyer-intent.</li>
            <li><b>Abnormal conversion rate</b> — &gt;40% conv. rate is suspicious; content affiliates land at 5-20%.</li>
            <li><b>"runable" in utm_term/utm_campaign</b> — the affiliate is literally bidding on our brand keyword.</li>
          </ul>
          <p className="mt-2 text-gray-500">If signals fire but the data feels wrong, click the affiliate, hit the Google search shortcuts in the modal, and manually verify before flagging.</p>
        </div>
      </div>
    </div>
  );
}
