import { useEffect, useRef, useState } from 'react';
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchLogs, type LogEntry } from '../../lib/api';

/**
 * Bottom-right collapsible "Environmental Data Log" — surfaces the backend's
 * persistent timestamped JSONL log (written on every /api/simulate call) so the
 * "log environmental data with timestamps" requirement is visible in the UI,
 * not just a server-side file. Polls every 5s while expanded.
 */
export function DataLogPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const rows = await fetchLogs(40);
      if (!cancelled) setEntries(rows);
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open]);

  // Keep the newest entry in view.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, open]);

  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-10 w-[380px] max-w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-white/5 bg-base-900/90 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
          <Terminal className="h-3.5 w-3.5 text-teal-400" />
          Environmental Data Log
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal-500" />
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-500" />
        ) : (
          <ChevronUp className="h-4 w-4 text-slate-500" />
        )}
      </button>

      {open && (
        <div
          ref={scrollRef}
          className="max-h-[220px] overflow-y-auto border-t border-white/5 px-3 py-2 font-mono text-[10px] leading-relaxed"
        >
          {entries.length === 0 ? (
            <div className="py-3 text-center text-slate-600">
              No simulation events logged yet. Run a region forecast to generate entries.
            </div>
          ) : (
            entries.map((e, i) => <LogRow key={`${e.timestamp}-${i}`} entry={e} />)
          )}
        </div>
      )}
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const ts = new Date(entry.timestamp);
  const time = Number.isNaN(ts.getTime())
    ? entry.timestamp
    : ts.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  const { inputs, outputs } = entry;
  const threat = outputs.threat_index?.label;
  const threatColor =
    threat === 'Extreme'
      ? 'text-red-400'
      : threat === 'High'
        ? 'text-fire-400'
        : threat === 'Moderate'
          ? 'text-ember'
          : 'text-teal-400';

  return (
    <div className="border-b border-white/[0.03] py-1 last:border-0">
      <span className="text-slate-500">{time}</span>{' '}
      <span className="text-slate-400">
        {inputs.lat.toFixed(2)},{inputs.lon.toFixed(2)}
      </span>{' '}
      <span className="text-slate-500">
        wind {Math.round(inputs.wind_speed)}mph @ {Math.round(inputs.wind_direction)}° · hum{' '}
        {Math.round(inputs.humidity)}% · {inputs.fuel_type}
      </span>
      {threat && (
        <>
          {' → '}
          <span className={`font-semibold ${threatColor}`}>{threat}</span>
        </>
      )}
      {outputs.data_source && (
        <span className={outputs.data_source === 'live' ? ' text-teal-500' : ' text-slate-600'}>
          {' '}
          [{outputs.data_source}]
        </span>
      )}
    </div>
  );
}
