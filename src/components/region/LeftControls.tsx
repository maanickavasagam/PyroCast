import {
  ChevronLeft,
  ChevronRight,
  Wind,
  Compass,
  Trees,
  Gauge,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import type { FuelType, Weather } from '../../types';
import { FUEL_LABELS } from '../../lib/regions';
import { degToCardinal } from '../../lib/format';
import { IconButton, SimulatedTag } from '../ui/primitives';

interface Props {
  regionName: string;
  regionSub: string;
  collapsed: boolean;
  onToggle: () => void;
  windSpeed: number;
  windDirection: number;
  fuel: FuelType;
  onWindSpeed: (v: number) => void;
  onWindDirection: (v: number) => void;
  onFuel: (v: FuelType) => void;
  onReset: () => void;
  live: Weather | null;
  loading: boolean;
  simulated: boolean;
}

/** Left panel: region header + scenario controls. Collapses to a slim rail. */
export function LeftControls(props: Props) {
  const {
    regionName,
    regionSub,
    collapsed,
    onToggle,
    windSpeed,
    windDirection,
    fuel,
    onWindSpeed,
    onWindDirection,
    onFuel,
    onReset,
    live,
    loading,
    simulated,
  } = props;

  return (
    <div
      className="relative z-10 flex h-full shrink-0 flex-col overflow-hidden border-r border-white/5 bg-base-900/95 transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 44 : 300 }}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-4 pt-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand controls"
            title="Expand controls"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-base-700 hover:text-slate-200"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-slate-500"><SlidersHorizontal className="h-4 w-4" /></span>
          <span className="text-slate-500"><Wind className="h-4 w-4" /></span>
          <span className="text-slate-500"><Trees className="h-4 w-4" /></span>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2 border-b border-white/5 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                Region Forecast
              </div>
              <h2 className="mt-1 truncate text-[15px] font-bold text-white">{regionName}</h2>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">{regionSub}</div>
            </div>
            <IconButton onClick={onToggle} label="Collapse controls">
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Scenario
              </div>
              {simulated ? (
                <SimulatedTag label="synthetic weather" />
              ) : (
                <span className="text-[10px] font-medium uppercase tracking-wide text-teal-400">
                  live
                </span>
              )}
            </div>

            {/* Wind direction */}
            <Control
              icon={<Compass className="h-3.5 w-3.5" />}
              label="Wind Direction"
              value={`${Math.round(windDirection)}° ${degToCardinal(windDirection)}`}
              loading={loading}
            >
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={windDirection}
                onChange={(e) => onWindDirection(Number(e.target.value))}
                className="range-fire"
                aria-label="Wind direction in degrees"
              />
            </Control>

            {/* Wind speed */}
            <Control
              icon={<Wind className="h-3.5 w-3.5" />}
              label="Wind Speed"
              value={`${Math.round(windSpeed)} mph`}
              loading={loading}
            >
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                value={windSpeed}
                onChange={(e) => onWindSpeed(Number(e.target.value))}
                className="range-fire"
                aria-label="Wind speed in miles per hour"
              />
            </Control>

            {/* Fuel type */}
            <div>
              <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-slate-300">
                <Trees className="h-3.5 w-3.5 text-slate-500" />
                Fuel Type
              </div>
              <div className="relative">
                <select
                  value={fuel}
                  onChange={(e) => onFuel(e.target.value as FuelType)}
                  className="w-full appearance-none rounded-lg border border-white/10 bg-base-800 px-3 py-2 pr-9 text-[13px] font-medium text-slate-200 outline-none transition-colors hover:border-white/20 focus:border-fire-500/50"
                >
                  {(Object.keys(FUEL_LABELS) as FuelType[]).map((f) => (
                    <option key={f} value={f}>
                      {FUEL_LABELS[f]}
                    </option>
                  ))}
                </select>
                <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-slate-500" />
              </div>
            </div>

            {/* Live readout */}
            <div className="rounded-xl border border-white/5 bg-base-850/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <Gauge className="h-3.5 w-3.5" />
                Observed Conditions
              </div>
              {loading || !live ? (
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="skeleton h-9 w-full" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                  <Readout label="Temp" value={`${live.temperature}°F`} />
                  <Readout label="Humidity" value={`${live.humidity}%`} />
                  <Readout label="Wind" value={`${live.windSpeed} mph`} />
                  <Readout label="Dir" value={degToCardinal(live.windDirection)} />
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-white/5 p-3">
            <button
              type="button"
              onClick={onReset}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-[12px] font-medium text-slate-300 transition-colors hover:border-white/20 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to observed
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Control({
  icon,
  label,
  value,
  loading,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] font-medium text-slate-300">
          <span className="text-slate-500">{icon}</span>
          {label}
        </div>
        {loading ? (
          <div className="skeleton h-4 w-14" />
        ) : (
          <span className="font-mono text-[12px] font-semibold tabular-nums text-fire-400">
            {value}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-semibold tabular-nums text-slate-200">{value}</span>
    </div>
  );
}
