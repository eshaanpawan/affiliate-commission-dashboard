'use client';

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

interface BarDef { key: string; color: string; label: string; axis?: 'left' | 'right' }

interface DayOnDayChartProps {
  title: string;
  data: Record<string, unknown>[];
  bars: BarDef[];
  valuePrefix?: string;
  secondaryKey?: string; // key to show as line on right Y-axis
}

export function DayOnDayChart({ title, data, bars, valuePrefix = '', secondaryKey }: DayOnDayChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    day: (() => {
      const raw = d.day as string;
      const parsed = raw.includes('T') ? new Date(raw) : new Date(raw + 'T12:00:00');
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    })(),
  }));

  const primaryBars = bars.filter(b => b.axis !== 'right');
  const secondaryBar = bars.find(b => b.axis === 'right') ?? (secondaryKey ? bars.find(b => b.key === secondaryKey) : null);
  const mainBars = secondaryBar ? bars.filter(b => b.key !== secondaryBar.key) : primaryBars;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>
      {data.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
          No data yet — waiting for webhook events
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={formatted} margin={{ top: 0, right: secondaryBar ? 40 : 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
            {secondaryBar && (
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: secondaryBar.color }} />
            )}
            <Tooltip
              formatter={(v, name) => [`${valuePrefix}${v}`, name]}
            />
            <Legend />
            {mainBars.map((b) => (
              <Bar key={b.key} yAxisId="left" dataKey={b.key} name={b.label} fill={b.color} radius={[3, 3, 0, 0]} />
            ))}
            {secondaryBar && (
              <Line
                key={secondaryBar.key}
                yAxisId="right"
                type="monotone"
                dataKey={secondaryBar.key}
                name={secondaryBar.label}
                stroke={secondaryBar.color}
                strokeWidth={2}
                dot={{ r: 3, fill: secondaryBar.color }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
