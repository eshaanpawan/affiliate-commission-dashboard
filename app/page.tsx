'use client';

import { useEffect, useState } from 'react';
import { MetricCard } from '@/components/MetricCard';
import { DayOnDayChart } from '@/components/DayOnDayChart';

interface DashboardData {
  overview: {
    totalAffiliates: number;
    activeAffiliates: number;
    totalReferrals: number;
    convertedReferrals: number;
    totalRevenueCents: number;
    totalCommissionCents: number;
    paidCommissionCents: number;
    pendingPayoutCents: number;
  };
  charts: {
    dailyAffiliates: { day: string; count: number }[];
    dailyReferrals: { day: string; total: number; converted: number }[];
    dailyRevenue: { day: string; usd: number }[];
    dailyCommissions: { day: string; usd: number }[];
  };
  affiliates: {
    id: string;
    name: string;
    email: string;
    status: string;
    createdAt: string;
    referrals: number;
    conversions: number;
    revenueCents: number;
    commissionCents: number;
  }[];
  recentActivity: { event_type: string; received_at: string; event_id: string }[];
}

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(a: number, b: number) {
  if (b === 0) return '0%';
  return ((a / b) * 100).toFixed(1) + '%';
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/dashboard');
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading dashboard...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-400">Failed to load data.</p>
      </div>
    );
  }

  const { overview, charts, affiliates, recentActivity } = data;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Affiliate Commission Dashboard</h1>
            <p className="text-sm text-gray-400 mt-1">Powered by Rewardful</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ''}
            </p>
            <button
              onClick={load}
              className="mt-1 text-xs text-blue-500 hover:text-blue-700 font-medium"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Top metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard label="Total Affiliates" value={overview.totalAffiliates} sub={`${overview.activeAffiliates} active`} />
          <MetricCard label="Total Referrals" value={overview.totalReferrals} sub={`${overview.convertedReferrals} converted (${pct(overview.convertedReferrals, overview.totalReferrals)})`} />
          <MetricCard label="Total Revenue" value={fmt(overview.totalRevenueCents)} />
          <MetricCard label="Commissions Owed" value={fmt(overview.totalCommissionCents)} sub={`${fmt(overview.paidCommissionCents)} paid`} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard label="Conversion Rate" value={pct(overview.convertedReferrals, overview.totalReferrals)} />
          <MetricCard label="Unpaid Commissions" value={fmt(overview.totalCommissionCents - overview.paidCommissionCents)} />
          <MetricCard label="Pending Payouts" value={fmt(overview.pendingPayoutCents)} />
          <MetricCard label="Avg Revenue / Affiliate" value={overview.totalAffiliates > 0 ? fmt(overview.totalRevenueCents / overview.totalAffiliates) : '$0.00'} />
        </div>

        {/* Day-on-day charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <DayOnDayChart
            title="New Affiliates (last 30 days)"
            data={charts.dailyAffiliates}
            bars={[{ key: 'count', color: '#6366f1', label: 'New affiliates' }]}
          />
          <DayOnDayChart
            title="Referrals & Conversions (last 30 days)"
            data={charts.dailyReferrals}
            bars={[
              { key: 'total', color: '#94a3b8', label: 'Referrals' },
              { key: 'converted', color: '#22c55e', label: 'Converted' },
            ]}
          />
          <DayOnDayChart
            title="Revenue per Day (last 30 days)"
            data={charts.dailyRevenue}
            bars={[{ key: 'usd', color: '#3b82f6', label: 'Revenue' }]}
            valuePrefix="$"
          />
          <DayOnDayChart
            title="Commissions per Day (last 30 days)"
            data={charts.dailyCommissions}
            bars={[{ key: 'usd', color: '#f59e0b', label: 'Commissions' }]}
            valuePrefix="$"
          />
        </div>

        {/* Affiliates table */}
        <div className="bg-white rounded-xl border border-gray-200 mb-8 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Affiliates</h2>
          </div>
          {affiliates.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              No affiliates yet — they&apos;ll appear here after the first webhook event.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium">Affiliate</th>
                    <th className="text-right px-4 py-3 font-medium">Referrals</th>
                    <th className="text-right px-4 py-3 font-medium">Conversions</th>
                    <th className="text-right px-4 py-3 font-medium">Conv. Rate</th>
                    <th className="text-right px-4 py-3 font-medium">Revenue</th>
                    <th className="text-right px-4 py-3 font-medium">Commission</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {affiliates.map((a) => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900">{a.name}</p>
                        <p className="text-xs text-gray-400">{a.email}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{a.referrals}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{a.conversions}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{pct(a.conversions, a.referrals)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(a.revenueCents)}</td>
                      <td className="px-4 py-3 text-right text-amber-600 font-medium">{fmt(a.commissionCents)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          a.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {a.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Recent Webhook Events</h2>
          </div>
          {recentActivity.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              No events received yet. Add the webhook URL to Rewardful to start receiving events.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentActivity.map((e, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-indigo-50 text-indigo-600">
                      {e.event_type}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">{e.event_id}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(e.received_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
