'use client';

import { useEffect, useState } from 'react';
import { MetricCard } from '@/components/MetricCard';
import { DayOnDayChart } from '@/components/DayOnDayChart';
import { TopAffiliatesPie } from '@/components/TopAffiliatesPie';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

interface Affiliate {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
  referrals: number;
  conversions: number;
  referralsToday: number;
  conversionsToday: number;
  revenueCents: number;
  commissionCents: number;
}

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
  affiliates: Affiliate[];
  recentActivity: { event_type: string; received_at: string; event_id: string }[];
  monthly: {
    month: string;
    referrals: number;
    conversions: number;
    revenueCents: number;
    commissionCents: number;
  }[];
  topByReferrals: { name: string; value: number }[];
  topByConversions: { name: string; value: number }[];
  weeklyLeaderboard: { rank: number; name: string; email: string; conversionsThisWeek: number; referralsThisWeek: number }[];
}

interface AffiliateDetail {
  dailyReferrals: { day: string; total: number; converted: number }[];
  dailyRevenue: { day: string; usd: number }[];
  dailyCommissions: { day: string; usd: number }[];
}

function fmt(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(a: number, b: number) {
  if (b === 0) return '0%';
  return ((a / b) * 100).toFixed(1) + '%';
}

type SortKey = 'referrals' | 'conversions' | 'revenueCents' | 'commissionCents';

function AffiliateModal({ affiliate, onClose }: { affiliate: Affiliate; onClose: () => void }) {
  const [detail, setDetail] = useState<AffiliateDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/affiliates/${affiliate.id}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [affiliate.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{affiliate.name}</h2>
            <p className="text-sm text-gray-400">{affiliate.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl font-light leading-none mt-0.5">✕</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-0.5">Referrals</p>
            <p className="text-xl font-bold text-gray-900">{affiliate.referrals}</p>
            <p className="text-xs text-indigo-500 mt-0.5">{affiliate.referralsToday} today</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-0.5">Conversions</p>
            <p className="text-xl font-bold text-gray-900">{affiliate.conversions}</p>
            <p className="text-xs text-green-500 mt-0.5">{affiliate.conversionsToday} today</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-0.5">Revenue</p>
            <p className="text-xl font-bold text-gray-900">{fmt(affiliate.revenueCents)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{pct(affiliate.conversions, affiliate.referrals)} conv. rate</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-0.5">Commission</p>
            <p className="text-xl font-bold text-amber-600">{fmt(affiliate.commissionCents)}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${affiliate.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{affiliate.status}</span>
            </p>
          </div>
        </div>
        {loading ? (
          <div className="h-40 flex items-center justify-center text-gray-400 text-sm">Loading growth data...</div>
        ) : !detail ? (
          <div className="h-40 flex items-center justify-center text-gray-400 text-sm">No data available.</div>
        ) : (
          <div className="space-y-4">
            <DayOnDayChart
              title="Referrals & Conversions (last 30 days)"
              data={detail.dailyReferrals}
              bars={[
                { key: 'total', color: '#94a3b8', label: 'Referrals', axis: 'left' },
                { key: 'converted', color: '#22c55e', label: 'Conversions', axis: 'right' },
              ]}
            />
            <div className="grid grid-cols-2 gap-4">
              <DayOnDayChart title="Revenue (last 30 days)" data={detail.dailyRevenue} bars={[{ key: 'usd', color: '#6366f1', label: 'Revenue' }]} valuePrefix="$" />
              <DayOnDayChart title="Commissions (last 30 days)" data={detail.dailyCommissions} bars={[{ key: 'usd', color: '#f59e0b', label: 'Commissions' }]} valuePrefix="$" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('conversions');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedAffiliate, setSelectedAffiliate] = useState<Affiliate | null>(null);

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

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      setLastSynced(new Date());
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    sync();
    const dashInterval = setInterval(load, 30000);
    const syncInterval = setInterval(sync, 3 * 60 * 1000);
    return () => { clearInterval(dashInterval); clearInterval(syncInterval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading dashboard...</p></div>;
  }
  if (!data) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-red-400">Failed to load data.</p></div>;
  }

  const { overview, charts, recentActivity } = data;

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const affiliates = [...data.affiliates].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey];
    return sortDir === 'desc' ? -diff : diff;
  });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-1 text-gray-300">↕</span>;
    return <span className="ml-1 text-indigo-500">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {selectedAffiliate && <AffiliateModal affiliate={selectedAffiliate} onClose={() => setSelectedAffiliate(null)} />}
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Affiliate Commission Dashboard</h1>
            <p className="text-sm text-gray-400 mt-1">Powered by Rewardful</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()} · auto-refreshes every 30s` : ''}</p>
            <p className="text-xs mt-0.5">
              {syncing ? <span className="text-indigo-400 animate-pulse">Syncing with Rewardful...</span>
                : lastSynced ? <span className="text-green-500">Last synced {lastSynced.toLocaleTimeString()} · syncs every 3 min</span>
                : null}
            </p>
            <button onClick={sync} disabled={syncing} className="text-xs text-indigo-500 hover:text-indigo-700 mt-0.5 disabled:opacity-40">
              {syncing ? 'Syncing...' : 'Sync now'}
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
          <DayOnDayChart title="New Affiliates (last 30 days)" data={charts.dailyAffiliates} bars={[{ key: 'count', color: '#6366f1', label: 'New affiliates' }]} />
          <DayOnDayChart
            title="Referrals & Conversions per Day (last 30 days)"
            data={charts.dailyReferrals}
            bars={[
              { key: 'total', color: '#94a3b8', label: 'Referrals', axis: 'left' },
              { key: 'converted', color: '#22c55e', label: 'Conversions', axis: 'right' },
            ]}
          />
          <DayOnDayChart title="Revenue per Day (last 30 days)" data={charts.dailyRevenue} bars={[{ key: 'usd', color: '#6366f1', label: 'Revenue' }]} valuePrefix="$" />
          <DayOnDayChart title="Commissions per Day (last 30 days)" data={charts.dailyCommissions} bars={[{ key: 'usd', color: '#f59e0b', label: 'Commissions' }]} valuePrefix="$" />
        </div>

        {/* Month-on-Month */}
        {data.monthly.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Month-on-Month</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-sm font-semibold text-gray-700 mb-4">Conversions per Month</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.monthly.map(m => ({ month: new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), conversions: m.conversions, referrals: m.referrals }))} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="conversions" name="Conversions" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="referrals" name="Referrals" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <p className="text-sm font-semibold text-gray-700 mb-4">Revenue vs Commissions per Month</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.monthly.map(m => ({ month: new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), revenue: m.revenueCents / 100, commissions: m.commissionCents / 100 }))} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} />
                    <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
                    <Legend />
                    <Bar dataKey="revenue" name="Revenue" fill="#6366f1" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="commissions" name="Commissions" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                      <th className="text-left px-5 py-3 font-medium">Month</th>
                      <th className="text-right px-4 py-3 font-medium">Referrals</th>
                      <th className="text-right px-4 py-3 font-medium">Conversions</th>
                      <th className="text-right px-4 py-3 font-medium">Conv. Rate</th>
                      <th className="text-right px-4 py-3 font-medium">Revenue</th>
                      <th className="text-right px-4 py-3 font-medium">Commissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monthly.map((m) => (
                      <tr key={m.month} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{new Date(m.month + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{m.referrals.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-medium text-green-600">{m.conversions.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{pct(m.conversions, m.referrals)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(m.revenueCents)}</td>
                        <td className="px-4 py-3 text-right text-amber-600">{fmt(m.commissionCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Pie charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <TopAffiliatesPie title="Top Affiliates by Referrals" data={data.topByReferrals} label="referrals" />
          <TopAffiliatesPie title="Top Affiliates by Conversions" data={data.topByConversions} label="conversions" />
        </div>

        {/* Weekly leaderboard */}
        <div className="bg-white rounded-xl border border-gray-200 mb-8 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Weekly Leaderboard</h2>
              <p className="text-xs text-gray-400 mt-0.5">Top affiliates by conversions this week (Mon–Sun)</p>
            </div>
            <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-medium">This Week</span>
          </div>
          {data.weeklyLeaderboard.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No conversions this week yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium">Rank</th>
                  <th className="text-left px-4 py-3 font-medium">Affiliate</th>
                  <th className="text-right px-4 py-3 font-medium text-green-600">Conversions This Week</th>
                  <th className="text-right px-5 py-3 font-medium text-indigo-600">Referrals This Week</th>
                </tr>
              </thead>
              <tbody>
                {data.weeklyLeaderboard.map((a) => (
                  <tr key={a.email} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                        a.rank === 1 ? 'bg-yellow-100 text-yellow-700' :
                        a.rank === 2 ? 'bg-gray-100 text-gray-600' :
                        a.rank === 3 ? 'bg-orange-100 text-orange-600' : 'bg-gray-50 text-gray-400'
                      }`}>{a.rank}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{a.name}</p>
                      <p className="text-xs text-gray-400">{a.email}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-green-600 text-base">{a.conversionsThisWeek}</td>
                    <td className="px-5 py-3 text-right font-semibold text-indigo-600">{a.referralsThisWeek}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Affiliates table */}
        <div className="bg-white rounded-xl border border-gray-200 mb-8 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Affiliates</h2>
            <p className="text-xs text-gray-400 mt-0.5">Click any row to see growth details</p>
          </div>
          {affiliates.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No affiliates yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-medium">Affiliate</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-800" onClick={() => handleSort('referrals')}>Referrals<SortIcon col="referrals" /></th>
                    <th className="text-right px-4 py-3 font-medium text-indigo-600">Referrals Today</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-800" onClick={() => handleSort('conversions')}>Conversions<SortIcon col="conversions" /></th>
                    <th className="text-right px-4 py-3 font-medium text-green-600">Conversions Today</th>
                    <th className="text-right px-4 py-3 font-medium">Conv. Rate</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-800" onClick={() => handleSort('revenueCents')}>Revenue<SortIcon col="revenueCents" /></th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-800" onClick={() => handleSort('commissionCents')}>Commission<SortIcon col="commissionCents" /></th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {affiliates.map((a) => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-indigo-50 transition-colors cursor-pointer" onClick={() => setSelectedAffiliate(a)}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900">{a.name}</p>
                        <p className="text-xs text-gray-400">{a.email}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{a.referrals}</td>
                      <td className="px-4 py-3 text-right font-semibold text-indigo-600">{a.referralsToday}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{a.conversions}</td>
                      <td className="px-4 py-3 text-right font-semibold text-green-600">{a.conversionsToday}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{pct(a.conversions, a.referrals)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(a.revenueCents)}</td>
                      <td className="px-4 py-3 text-right text-amber-600 font-medium">{fmt(a.commissionCents)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${a.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{a.status}</span>
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
            <div className="p-8 text-center text-gray-400 text-sm">No events received yet.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentActivity.map((e, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-indigo-50 text-indigo-600">{e.event_type}</span>
                    <span className="text-xs text-gray-400 font-mono">{e.event_id}</span>
                  </div>
                  <span className="text-xs text-gray-400">{new Date(e.received_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
