import { Flame } from 'lucide-react';

/** PyroCast wordmark + flame glyph. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-fire-500 to-fire-700 shadow-lg shadow-fire-700/30">
        <Flame className="h-[18px] w-[18px] text-white" strokeWidth={2.25} />
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-bold tracking-tight text-white">
            Pyro<span className="text-fire-500">Cast</span>
          </div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
            Wildfire Intelligence
          </div>
        </div>
      )}
    </div>
  );
}
