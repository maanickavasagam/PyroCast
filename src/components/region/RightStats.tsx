import {
  ChevronLeft,
  ChevronRight,
  Flame,
  Gauge,
  Ruler,
  Users,
  Route,
  TriangleAlert,
  Activity,
  BarChart3,
} from 'lucide-react';
import type { SpreadStats } from '../../types';
import { fmtAcres, fmtDec, fmtInt, fmtPeople } from '../../lib/format';
import { IconButton, StatCard } from '../ui/primitives';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  stats: SpreadStats | null;
  step: number;
  loading: boolean;
}

const THREAT_STYLES: Record<
  SpreadStats['threatLabel'],
  { text: string; ring: string; bar: string; glow: string }
> = {
  Low: { text: 'text-teal-400', ring: 'ring-teal-500/30', bar: 'bg-teal-500', glow: 'shadow-teal-500/20' },
  Moderate: { text: 'text-ember', ring: 'ring-ember/30', bar: 'bg-ember', glow: 'shadow-ember/20' },
  High: { text: 'text-fire-400', ring: 'ring-fire-500/30', bar: 'bg-fire-500', glow: 'shadow-fire-500/20' },
  Extreme: { text: 'text-red-400', ring: 'ring-red-500/40', bar: 'bg-red-500', glow: 'shadow-red-500/30' },
};

/** Right panel: threat gauge + impact stat cards. Collapses to a slim rail. */
export function RightStats({ collapsed, onToggle, stats, step, loading }: Props) {
  const threat = stats?.threatLabel ?? 'Moderate';
  const ts = THREAT_STYLES[threat];
  const isNow = step === 0;
  const highThreat = stats && (stats.threatLabel === 'High' || stats.threatLabel === 'Extreme');

  return (
    <div
      className="relative z-10 flex h-full shrink-0 flex-col overflow-hidden border-l border-white/5 bg-base-900/95 transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 44 : 312 }}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-4 pt-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand stats"
            title="Expand stats"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-base-700 hover:text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className={ts.text}><Activity className="h-4 w-4" /></span>
          {stats && (
            <span className={`font-mono text-[11px] font-bold ${ts.text}`}>{stats.threatIndex}</span>
          )}
          <span className="text-slate-500"><Flame className="h-4 w-4" /></span>
          <span className="text-slate-500"><Users className="h-4 w-4" /></span>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3.5">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              <BarChart3 className="h-4 w-4" />
              Impact Analysis
              <span className="rounded-full bg-base-700 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                {isNow ? 'Now' : `+${step}h`}
              </span>
            </div>
            <IconButton onClick={onToggle} label="Collapse stats">
              <ChevronRight className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            {/* Threat index gauge */}
            <div className={`rounded-xl border border-white/5 bg-base-850/80 p-4 shadow-lg ${ts.glow}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Threat Index
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${ts.text} ${ts.ring}`}
                >
                  {loading ? '—' : threat}
                </span>
              </div>
              <div className="mt-2 flex items-end gap-1">
                <span className={`font-mono text-4xl font-bold tabular-nums ${ts.text}`}>
                  {loading || !stats ? '—' : stats.threatIndex}
                </span>
                <span className="mb-1 text-sm text-slate-500">/ 100</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-base-700">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ease-out ${ts.bar}`}
                  style={{ width: `${stats?.threatIndex ?? 0}%` }}
                />
              </div>
            </div>

            {/* Warning banner (high / extreme only) */}
            {highThreat && !isNow && (
              <div className="animate-slide-up rounded-xl border border-red-500/30 bg-red-950/40 p-3">
                <div className="flex gap-2.5">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <div>
                    <div className="text-[12px] font-semibold text-red-300">
                      {stats!.threatLabel} fire behavior expected
                    </div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-red-200/70">
                      Rapid wind-driven spread with {fmtInt(stats!.flameLengthFt)} ft flame lengths.
                      Direct attack unsafe — prioritize evacuation of the projected path.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stat cards */}
            <StatCard
              icon={<Flame className="h-3.5 w-3.5" />}
              label="Burn Area"
              value={loading || !stats || isNow ? '0' : fmtAcres(stats.burnAreaAcres)}
              unit="acres"
              tone="fire"
              loading={loading}
            />
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Gauge className="h-3.5 w-3.5" />}
                label="Rate of Spread"
                value={loading || !stats ? '—' : fmtInt(stats.rateOfSpreadChainsHr)}
                unit="ch/h"
                loading={loading}
              />
              <StatCard
                icon={<Ruler className="h-3.5 w-3.5" />}
                label="Flame Length"
                value={loading || !stats ? '—' : fmtDec(stats.flameLengthFt, 1)}
                unit="ft"
                tone="amber"
                loading={loading}
              />
            </div>
            <StatCard
              icon={<Users className="h-3.5 w-3.5" />}
              label="People in Projected Path"
              value={loading || !stats || isNow ? '0' : fmtPeople(stats.peopleInPath)}
              tone="amber"
              loading={loading}
            />

            {/* Roads / infrastructure */}
            <div
              className={`rounded-xl border p-3.5 ${
                stats && stats.roadsAtRisk > 0 && !isNow
                  ? 'border-fire-500/25 bg-fire-950/20'
                  : 'border-white/5 bg-base-850/80'
              }`}
            >
              <div className="flex items-center gap-2 text-slate-400">
                <Route className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-[11px] font-medium uppercase tracking-wide">
                  Roads / Infrastructure
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {loading || !stats || isNow ? (
                  <span className="font-mono text-lg font-semibold text-slate-300">
                    {isNow ? 'Clear' : '—'}
                  </span>
                ) : stats.roadsAtRisk > 0 ? (
                  <>
                    <span className="font-mono text-lg font-semibold tabular-nums text-fire-400">
                      {stats.roadsAtRisk}
                    </span>
                    <span className="text-[12px] text-slate-400">
                      major {stats.roadsAtRisk === 1 ? 'route' : 'routes'} intersect path
                    </span>
                  </>
                ) : (
                  <span className="text-[13px] font-medium text-teal-400">No major routes at risk</span>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 px-4 py-2.5 text-[10px] leading-relaxed text-slate-600">
            Estimates from a client-side spread model. Not an operational forecast.
          </div>
        </>
      )}
    </div>
  );
}
