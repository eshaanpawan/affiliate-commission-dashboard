// Shared formatting helpers for the dashboard tables.

export function fmtCents(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pct(a: number, b: number): string {
  if (b === 0) return '0%';
  return ((a / b) * 100).toFixed(1) + '%';
}

// Compact human-readable duration: 30s / 12m / 3.2h / 4.1d / 12d
export function fmtDuration(sec: number | null): string {
  if (sec === null || !isFinite(sec)) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) {
    const h = sec / 3600;
    return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
  }
  const d = sec / 86400;
  return d < 10 ? `${d.toFixed(1)}d` : `${Math.round(d)}d`;
}

// Tailwind colour class for a Signup→FTS / Signup→Pay duration.
// Short = suspicious (intercepted intent). Long = healthy nurture.
export function ttsTone(sec: number | null): string {
  if (sec === null) return 'text-gray-400';
  if (sec < 3600) return 'text-red-600 font-bold';        // <1 hour — high suspicion
  if (sec < 86400) return 'text-amber-600 font-semibold'; // <1 day — moderate
  if (sec < 7 * 86400) return 'text-gray-700';            // <1 week — normal
  return 'text-emerald-600';                                // 1+ week — healthy
}

// Tailwind colour class for a Google-similarity bar (0..1).
// Higher = more like brand-search intercept = more suspicious.
export function similarityTone(sim: number | null | undefined): string {
  if (sim === null || sim === undefined) return 'bg-gray-300';
  if (sim >= 0.7) return 'bg-red-500';
  if (sim >= 0.5) return 'bg-amber-500';
  return 'bg-emerald-500';
}
