'use client';

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

interface DayOnDayChartProps {
  title: string;
  data: Record<string, unknown>[];
  bars: { key: string; color: string; label: string }[];
  valuePrefix?: string;
}

export function DayOnDayChart({ title, data, bars, valuePrefix = '' }: DayOnDayChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    day: new Date(d.day as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>
      {data.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
          No data yet — waiting for webhook events
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={formatted} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => `${valuePrefix}${v}`} />
            {bars.length > 1 && <Legend />}
            {bars.map((b) => (
              <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
