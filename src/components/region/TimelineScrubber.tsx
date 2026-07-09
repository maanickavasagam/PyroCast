import { Clock } from 'lucide-react';

interface Props {
  step: number;
  onChange: (step: number) => void;
}

const STOPS = [
  { value: 0, label: 'Now' },
  { value: 3, label: '+3h' },
  { value: 6, label: '+6h' },
  { value: 12, label: '+12h' },
];

/**
 * Timeline scrubber below the map. All horizons are pre-computed, so switching
 * only flips a GPU filter — instant, no recompute. Uses a snapped range input
 * plus labeled stops for keyboard + click access.
 */
export function TimelineScrubber({ step, onChange }: Props) {
  const idx = STOPS.findIndex((s) => s.value === step);
  const pct = (Math.max(0, idx) / (STOPS.length - 1)) * 100;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-white/5 bg-base-900/85 px-5 py-3.5 backdrop-blur-xl">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        <Clock className="h-3.5 w-3.5" />
        Forecast Timeline
        <span className="ml-auto font-mono text-fire-400">
          {step === 0 ? 'Now' : `+${step}h`}
        </span>
      </div>

      <div className="relative">
        {/* Track */}
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-base-700" />
        <div
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-fire-600 to-fire-400 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
        {/* Stops */}
        <div className="relative flex justify-between">
          {STOPS.map((s) => {
            const activeStop = s.value === step;
            const passed = STOPS.findIndex((x) => x.value === s.value) <= idx;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onChange(s.value)}
                className="group flex flex-col items-center gap-2"
                aria-label={`Show forecast at ${s.label}`}
                aria-pressed={activeStop}
              >
                <span
                  className={`h-3.5 w-3.5 rounded-full border-2 transition-all ${
                    activeStop
                      ? 'scale-125 border-fire-400 bg-fire-500 shadow-[0_0_10px_2px_rgba(255,107,53,0.6)]'
                      : passed
                        ? 'border-fire-500 bg-fire-600'
                        : 'border-base-600 bg-base-800 group-hover:border-slate-500'
                  }`}
                />
                <span
                  className={`text-[11px] font-semibold tabular-nums transition-colors ${
                    activeStop ? 'text-fire-400' : 'text-slate-500 group-hover:text-slate-300'
                  }`}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
