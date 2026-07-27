'use client';

import * as React from 'react';
import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { useDashboard, paginate } from '@/lib/use-dashboard';
import { useDashboardRange } from '@/components/DashboardRangeProvider';
import { ChartRangeTabs } from '@/components/RangeTabs';
import type { DashboardRange } from '@/lib/dashboard-range';
import { Pager } from '@/components/Pager';
import { SectionCard } from '@/components/SectionCard';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const COUNTRY_CHART_CONFIG = {
  conversions: { label: 'Conversions', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const GEO_TOOLTIP_TEXT = "Country is PostHog-enriched attribution stored against the Rewardful conversion. The conversion customer is matched to a PostHog user and the country comes from that user's first client-side pageview geo. Unmatched conversions remain unattributed instead of being guessed.";

const PER_PAGE = 15;

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="How country is determined" className="text-muted-foreground hover:text-foreground ml-2 inline-flex cursor-help">
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="mb-1 font-semibold">How country is determined</p>
        <p className="leading-relaxed">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function CountryOverviewCard() {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const { data, loading } = useDashboard(rangeOverride);
  const rows = data?.countriesByConversions ?? [];

  return (
    <Card className="mb-8 gap-0 overflow-hidden py-0">
      <CardHeader className="[.border-b]:pb-0 gap-1 border-b py-4">
        <CardTitle className="flex items-center text-sm">Conversions by Country<InfoTooltip text={GEO_TOOLTIP_TEXT} /></CardTitle>
        <CardDescription className="text-xs">Top conversion markets in this chart&apos;s reporting window</CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} />
          <Tabs value={view} onValueChange={(value) => setView(value as 'chart' | 'table')}>
            <TabsList className="h-8"><TabsTrigger value="chart" className="h-7 text-xs">Chart</TabsTrigger><TabsTrigger value="table" className="h-7 text-xs">Table</TabsTrigger></TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="p-5">
        {loading ? <Skeleton className="h-[280px] w-full" /> : rows.length === 0 ? (
          <div className="text-muted-foreground flex h-[280px] items-center justify-center text-sm">No attributed country data in this window.</div>
        ) : view === 'chart' ? (
          <ChartContainer config={COUNTRY_CHART_CONFIG} className="h-[280px] w-full">
            <BarChart data={rows.slice(0, 10)} margin={{ top: 4, right: 12, left: -18, bottom: 56 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="country_name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} width={44} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="country_name" />} />
              <Bar dataKey="conversions" fill="var(--color-conversions)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Country</TableHead><TableHead className="text-right">Conversions</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((row) => <TableRow key={row.country_code}><TableCell>{row.country_name}</TableCell><TableCell className="text-right font-semibold tabular-nums">{row.conversions}</TableCell></TableRow>)}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AffiliateCountryBreakdown({ affiliateId }: { affiliateId: string }) {
  const { range: globalRange } = useDashboardRange();
  const [rangeOverride, setRangeOverride] = useState<DashboardRange | null>(null);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const { data, loading } = useDashboard(rangeOverride);
  const affiliate = data?.affiliateCountries.find((row) => row.affiliate_id === affiliateId);
  const countries = affiliate?.countries ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChartRangeTabs value={rangeOverride} globalRange={globalRange} onChange={setRangeOverride} />
        <Tabs value={view} onValueChange={(value) => setView(value as 'chart' | 'table')}>
          <TabsList><TabsTrigger value="chart">Chart</TabsTrigger><TabsTrigger value="table">Table</TabsTrigger></TabsList>
        </Tabs>
      </div>
      {loading ? <Skeleton className="mt-4 h-[240px] w-full" /> : countries.length === 0 ? (
        <div className="text-muted-foreground flex h-[180px] items-center justify-center text-sm">No country-attributed conversions in this window.</div>
      ) : view === 'chart' ? (
        <ChartContainer config={COUNTRY_CHART_CONFIG} className="mt-4 h-[240px] w-full">
          <BarChart data={countries} margin={{ top: 4, right: 12, left: -18, bottom: 56 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="country_name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} width={44} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="country_name" />} />
            <Bar dataKey="conversions" fill="var(--color-conversions)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      ) : (
        <Table className="mt-4">
          <TableHeader><TableRow><TableHead>Country</TableHead><TableHead className="text-right">Conversions</TableHead></TableRow></TableHeader>
          <TableBody>{countries.map((country) => <TableRow key={country.country_code}><TableCell>{country.country_name}</TableCell><TableCell className="text-right font-semibold tabular-nums">{country.conversions}</TableCell></TableRow>)}</TableBody>
        </Table>
      )}
    </div>
  );
}

export default function CountriesPage() {
  const { data, loading, refresh } = useDashboard();

  const [affiliateCountriesExpanded, setAffiliateCountriesExpanded] = useState(true);
  const [expandedAffiliateCountries, setExpandedAffiliateCountries] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
        <Skeleton className="mb-8 h-10 w-72" />
        <div className="flex flex-col gap-8">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive text-sm">Failed to load data.</p>
        <Button size="sm" onClick={() => refresh()}>Retry</Button>
      </div>
    );
  }

  const paged = paginate(data.affiliateCountries, page, PER_PAGE);

  return (
    <div className="mx-auto w-full max-w-[112rem] px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Countries</h1>
          <p className="text-muted-foreground mt-1 text-sm">Conversion geography — overall and per affiliate</p>
        </div>
      </div>

      <CountryOverviewCard />

      {/* Affiliate x Country breakdown */}
      {data.affiliateCountries.length > 0 && (
        <SectionCard
          className="mb-8"
          title={<>Conversions by Affiliate &amp; Country<InfoTooltip text={GEO_TOOLTIP_TEXT} /></>}
          description="Click an affiliate row to expand their country breakdown"
          open={affiliateCountriesExpanded}
          onOpenChange={setAffiliateCountriesExpanded}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">Affiliate</TableHead>
                <TableHead className="px-5 text-right">Conversions with Country</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((a) => {
                const isExpanded = expandedAffiliateCountries.has(a.affiliate_id);
                return (
                  <React.Fragment key={a.affiliate_id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpandedAffiliateCountries(prev => {
                        const next = new Set(prev);
                        if (next.has(a.affiliate_id)) next.delete(a.affiliate_id);
                        else next.add(a.affiliate_id);
                        return next;
                      })}
                    >
                      <TableCell className="px-5 py-3">
                        <p className="font-medium">{a.name}</p>
                        <p className="text-muted-foreground text-xs">{a.email}</p>
                      </TableCell>
                      <TableCell className="px-5 py-3 text-right">
                        <span className="font-semibold tabular-nums">{a.total}</span>
                        <ChevronDown className={cn('text-muted-foreground ml-2 inline size-3.5 transition-transform', isExpanded && 'rotate-180')} />
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableCell colSpan={2} className="px-5 py-4">
                          <AffiliateCountryBreakdown affiliateId={a.affiliate_id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
          <Pager
            page={paged.page}
            totalPages={paged.totalPages}
            total={paged.total}
            perPage={PER_PAGE}
            onPage={setPage}
            label="affiliates"
          />
        </SectionCard>
      )}
    </div>
  );
}
