'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Flag, Search, ShieldAlert, UserCheck, UserX } from 'lucide-react';

import { AffiliateModal } from '@/components/AffiliateModal';
import { Pager } from '@/components/Pager';
import { useDashboard, paginate, type Affiliate } from '@/lib/use-dashboard';
import { fmtCents as fmt, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type SortKey = 'referrals' | 'conversions' | 'posthogPageviews' | 'posthogFts' | 'revenueCents' | 'commissionCents';

const PER_PAGE = 25;

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== col) return <ChevronsUpDown className="text-muted-foreground/50 ml-1 inline size-3" />;
  return sortDir === 'desc'
    ? <ArrowDown className="ml-1 inline size-3 text-indigo-600 dark:text-indigo-400" />
    : <ArrowUp className="ml-1 inline size-3 text-indigo-600 dark:text-indigo-400" />;
}

export default function AffiliatesPage() {
  const { data, loading, refresh, period } = useDashboard();
  const [sortKey, setSortKey] = useState<SortKey>('conversions');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedAffiliate, setSelectedAffiliate] = useState<Affiliate | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
    setPage(1);
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const rows = q
      ? data.affiliates.filter(a =>
          a.name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q) ||
          (a.linkToken ?? '').toLowerCase().includes(q) ||
          (a.linkTokens ?? []).some(lt => lt.token.toLowerCase().includes(q)))
      : [...data.affiliates];
    rows.sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortDir === 'desc' ? -diff : diff;
    });
    return rows;
  }, [data, search, sortKey, sortDir]);

  const paged = paginate(filtered, page, PER_PAGE);

  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
        <Skeleton className="mb-8 h-10 w-72" />
        <Skeleton className="mb-4 h-9 w-80" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-destructive text-sm">Failed to load data.</p>
        <Button size="sm" onClick={() => refresh()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
      {selectedAffiliate && (() => {
        const geography = data.affiliateCountries.find((row) => row.affiliate_id === selectedAffiliate.id);
        return (
          <AffiliateModal
            affiliate={selectedAffiliate}
            ftsCountries={(geography?.countries ?? []).map((country) => ({
              code: country.country_code,
              name: country.country_name,
              count: country.conversions,
            }))}
            ftsTotal={selectedAffiliate.posthogFts}
            onClose={() => setSelectedAffiliate(null)}
          />
        );
      })()}

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Affiliates</h1>
          <p className="text-muted-foreground mt-1 text-sm">Rewardful accounts with PostHog traffic for the selected {period === 'all' ? 'all-time' : period} window</p>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Active', value: data.overview.activeAffiliates, icon: UserCheck, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10' },
          { label: 'Suspicious', value: data.overview.suspiciousAffiliates, icon: ShieldAlert, tone: 'text-red-600 bg-red-50 dark:bg-red-500/10' },
          { label: 'Disabled', value: data.overview.disabledAffiliates, icon: UserX, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
          { label: 'Unnamed', value: data.overview.unnamedAffiliates, icon: Search, tone: 'text-muted-foreground bg-muted' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} className="flex-row items-center gap-3 p-4">
            <span className={cn('flex size-9 items-center justify-center rounded-lg', tone)}><Icon className="size-4" /></span>
            <div><p className="text-muted-foreground text-xs">{label}</p><p className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</p></div>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <Input
          placeholder="Search by name, email or link token…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="h-9 max-w-sm text-sm"
        />
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {filtered.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">
            {search ? 'No affiliates match your search.' : 'No affiliates yet.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[1450px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-5">Affiliate</TableHead>
                    <TableHead title="Total referrals — anyone who clicked ?via=token (visitor + lead + paid)" className="cursor-pointer text-right select-none" onClick={() => handleSort('referrals')}>Clicks<SortIcon col="referrals" sortKey={sortKey} sortDir={sortDir} /></TableHead>
                    <TableHead title="Subset of clicks who created a Runable account (Rewardful lead + converted)" className="text-right">Signups</TableHead>
                    <TableHead title="Subset of signups who paid (first-time paid subscription = Rewardful 'converted')" className="cursor-pointer text-right select-none" onClick={() => handleSort('conversions')}>Paid<SortIcon col="conversions" sortKey={sortKey} sortDir={sortDir} /></TableHead>
                    <TableHead title="Paid / Clicks (Rewardful conversion rate)" className="text-right">Click→Pay</TableHead>
                    <TableHead title="PostHog pageviews carrying this affiliate token" className="cursor-pointer text-right select-none" onClick={() => handleSort('posthogPageviews')}>Pageviews<SortIcon col="posthogPageviews" sortKey={sortKey} sortDir={sortDir} /></TableHead>
                    <TableHead title="PostHog signups attributed to this affiliate token" className="text-right">PH signups</TableHead>
                    <TableHead title="PostHog first-time subscription events attributed to this affiliate" className="cursor-pointer text-right select-none" onClick={() => handleSort('posthogFts')}>FTS<SortIcon col="posthogFts" sortKey={sortKey} sortDir={sortDir} /></TableHead>
                    <TableHead title="Share of PostHog signups carrying paid-ad click parameters" className="text-right">Ad share</TableHead>
                    <TableHead className="cursor-pointer text-right select-none" onClick={() => handleSort('revenueCents')}>Revenue<SortIcon col="revenueCents" sortKey={sortKey} sortDir={sortDir} /></TableHead>
                    <TableHead className="cursor-pointer text-right select-none" onClick={() => handleSort('commissionCents')}>Commission<SortIcon col="commissionCents" sortKey={sortKey} sortDir={sortDir} /></TableHead>
                    <TableHead title="Rewardful account status (active / inactive)">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.rows.map((a) => {
                    return (
                      <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelectedAffiliate(a)}>
                        <TableCell className="px-5 py-3">
                          <p className="font-medium">{a.name}</p>
                          <p className="text-muted-foreground text-xs">{a.email}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {(a.linkTokens && a.linkTokens.length > 0
                              ? a.linkTokens
                              : a.linkToken ? [{ token: a.linkToken, count: 0 }] : []
                            ).map((lt, i) => (
                              <Badge
                                key={lt.token}
                                asChild
                                variant="secondary"
                                className={cn(
                                  'font-mono text-[10px]',
                                  i === 0
                                    ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300'
                                    : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300',
                                )}
                              >
                                <a
                                  href={`https://runable.com/?via=${lt.token}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title={i === 0 ? `Primary link · ${lt.count} clicks` : `Secondary link · ${lt.count} clicks · investigate`}
                                >
                                  ?via={lt.token}{lt.count > 0 ? <span className="opacity-60"> · {lt.count}</span> : null}
                                </a>
                              </Badge>
                            ))}
                            {a.fraudTags.map((t) => (
                              <Badge key={t} variant="destructive" className="text-[10px]">
                                <Flag className="size-2.5" /> {t.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{a.referrals}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.signups}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{a.conversions}</TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">{pct(a.conversions, a.referrals)}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.posthogPageviews.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.posthogSignups.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{a.posthogFts.toLocaleString()}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', a.posthogSignups > 0 && a.adDrivenSignups / a.posthogSignups >= 0.8 && 'text-red-600 dark:text-red-400')}>
                          {pct(a.adDrivenSignups, a.posthogSignups)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{fmt(a.revenueCents)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">{fmt(a.commissionCents)}</TableCell>
                        <TableCell>
                          <Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.status}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Pager
              page={paged.page}
              totalPages={paged.totalPages}
              total={paged.total}
              perPage={PER_PAGE}
              onPage={setPage}
              label="affiliates"
            />
          </>
        )}
      </Card>
    </div>
  );
}
