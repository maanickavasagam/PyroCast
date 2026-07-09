import type { ReactNode } from 'react';
import { Database, Radio, Satellite, TriangleAlert } from 'lucide-react';
import type { FeedSource } from '../../types';

/** Small muted tag shown when a data source is using synthetic fallback. */
export function SimulatedTag({ label = 'simulated data' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-base-700/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
      <Database className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

/** Presentation metadata for each fire-feed provenance. */
export const FEED_META: Record<
  FeedSource,
  { short: string; full: string; live: boolean; unit: string }
> = {
  firms: { short: 'Live · FIRMS', full: 'NASA FIRMS live feed', live: true, unit: 'live detections' },
  eonet: {
    short: 'Fallback · EONET',
    full: 'NASA EONET fallback feed',
    live: false,
    unit: 'wildfire events',
  },
  simulated: {
    short: 'Simulated',
    full: 'Synthetic dataset',
    live: false,
    unit: 'simulated detections',
  },
};

/** Small provenance tag for the fire feed (used in the panel header). */
export function FeedTag({ source }: { source: FeedSource }) {
  const meta = FEED_META[source];
  if (source === 'firms') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-400 ring-1 ring-inset ring-teal-500/30">
        <Satellite className="h-2.5 w-2.5" />
        {meta.short}
      </span>
    );
  }
  const tone =
    source === 'eonet'
      ? 'bg-ember/15 text-ember ring-ember/30'
      : 'bg-base-700/70 text-slate-400 ring-white/5';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tone}`}
    >
      {source === 'eonet' ? <Radio className="h-2.5 w-2.5" /> : <Database className="h-2.5 w-2.5" />}
      {meta.short}
    </span>
  );
}

/**
 * Explicit notice shown whenever the primary live feed (FIRMS) is NOT the source
 * — so an EONET fallback or synthetic dataset is never mistaken for live data.
 */
export function LiveFeedNotice({ source }: { source: FeedSource }) {
  if (source === 'firms') return null;
  const detail =
    source === 'eonet'
      ? 'Showing NASA EONET fallback (curated events), not the primary FIRMS feed.'
      : 'Showing synthetic data. No live feed is currently reachable.';
  return (
    <div className="flex items-start gap-2 rounded-lg border border-ember/25 bg-ember/10 px-3 py-2">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ember" />
      <div className="text-[11px] leading-relaxed text-ember/90">
        <span className="font-semibold">Primary live feed unavailable.</span> {detail}
      </div>
    </div>
  );
}

type BadgeTone = 'fire' | 'amber' | 'teal' | 'neutral' | 'red';

const BADGE_TONES: Record<BadgeTone, string> = {
  fire: 'bg-fire-600/15 text-fire-400 ring-1 ring-inset ring-fire-500/30',
  amber: 'bg-ember/15 text-ember ring-1 ring-inset ring-ember/30',
  teal: 'bg-teal-500/15 text-teal-400 ring-1 ring-inset ring-teal-500/30',
  neutral: 'bg-base-700 text-slate-300 ring-1 ring-inset ring-white/5',
  red: 'bg-red-600/20 text-red-400 ring-1 ring-inset ring-red-500/40',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** A stat card used across the right panel. */
export function StatCard({
  icon,
  label,
  value,
  unit,
  tone = 'neutral',
  loading = false,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: 'fire' | 'teal' | 'amber' | 'neutral';
  loading?: boolean;
}) {
  const accent =
    tone === 'fire'
      ? 'text-fire-400'
      : tone === 'teal'
        ? 'text-teal-400'
        : tone === 'amber'
          ? 'text-ember'
          : 'text-slate-200';
  return (
    <div className="rounded-xl border border-white/5 bg-base-850/80 p-3.5 shadow-sm">
      <div className="flex items-center gap-2 text-slate-400">
        <span className="text-slate-500">{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      {loading ? (
        <div className="skeleton mt-2 h-7 w-20" />
      ) : (
        <div className="mt-1.5 flex items-baseline gap-1">
          <span className={`font-mono text-2xl font-semibold tabular-nums ${accent}`}>
            {value}
          </span>
          {unit && <span className="text-xs font-medium text-slate-500">{unit}</span>}
        </div>
      )}
    </div>
  );
}

/** Thin icon-only button used for panel collapse toggles. */
export function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/5 bg-base-800 text-slate-400 transition-colors hover:bg-base-700 hover:text-slate-200"
    >
      {children}
    </button>
  );
}
