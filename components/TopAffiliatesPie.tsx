'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b',
];

interface Props {
  title: string;
  data: { name: string; value: number }[];
  label: string;
}

export function TopAffiliatesPie({ title, data, label }: Props) {
  const positive = data.filter((d) => d.value > 0);
  const top10 = positive.slice(0, 10);
  const othersTotal = positive.slice(10).reduce((sum, d) => sum + d.value, 0);
  const filtered = othersTotal > 0 ? [...top10, { name: 'Others', value: othersTotal }] : top10;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>
      {filtered.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={filtered}
              cx="50%"
              cy="45%"
              outerRadius={90}
              dataKey="value"
              nameKey="name"
            >
              {filtered.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [`${value} ${label}`, name as string]}
            />
            <Legend
              formatter={(value) => (
                <span style={{ fontSize: 11, color: '#374151' }}>
                  {value.length > 18 ? value.slice(0, 18) + '…' : value}
                </span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
