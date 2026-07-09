import { ChevronLeft, ChevronRight, Flame, TriangleAlert, MapPin, ArrowRight } from 'lucide-react';
import type { FeedSource, WatchLocation } from '../../types';
import { Badge, FeedTag, IconButton } from '../ui/primitives';
import { Brand } from '../ui/Brand';

interface Props {
  locations: WatchLocation[];
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (loc: WatchLocation) => void;
  selectedId: string | null;
  loading: boolean;
  feedSource: FeedSource;
}

function LocationRow({
  loc,
  selected,
  onSelect,
}: {
  loc: WatchLocation;
  selected: boolean;
  onSelect: (l: WatchLocation) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(loc)}
      className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-fire-500/40 bg-fire-600/10'
          : 'border-transparent bg-base-850/60 hover:border-white/10 hover:bg-base-800'
      }`}
    >
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          loc.status === 'active'
            ? 'bg-fire-600/15 text-fire-400'
            : 'bg-ember/15 text-ember'
        }`}
      >
        {loc.status === 'active' ? (
          <Flame className="h-3.5 w-3.5" />
        ) : (
          <TriangleAlert className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-100">
          {loc.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{loc.region}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 transition-colors group-hover:text-fire-400" />
    </button>
  );
}

/**
 * Left overlay panel on the World View. Collapses to a slim icon rail via the
 * chevron toggle. Width transition only (no unmount) so nothing reflows.
 */
export function LocationPanel({
  locations,
  collapsed,
  onToggle,
  onSelect,
  selectedId,
  loading,
  feedSource,
}: Props) {
  const active = locations.filter((l) => l.status === 'active');
  const risk = locations.filter((l) => l.status === 'high-risk');

  return (
    <div
      className="pointer-events-auto absolute left-0 top-0 z-10 flex h-full flex-col overflow-hidden border-r border-white/5 bg-base-900/85 backdrop-blur-xl transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 52 : 340 }}
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-3">
        {!collapsed ? (
          <>
            <Brand />
            <IconButton onClick={onToggle} label="Collapse panel">
              <ChevronLeft className="h-4 w-4" />
            </IconButton>
          </>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand panel"
            title="Expand panel"
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-base-700 hover:text-slate-200"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Collapsed rail: status icons only */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 pt-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-fire-600/15 text-fire-400">
            <Flame className="h-4 w-4" />
          </span>
          <span className="text-[10px] font-semibold text-slate-400">{active.length}</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ember/15 text-ember">
            <TriangleAlert className="h-4 w-4" />
          </span>
          <span className="text-[10px] font-semibold text-slate-400">{risk.length}</span>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-4 pt-3.5">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <MapPin className="h-3.5 w-3.5" />
              Watch Locations
            </div>
            {!loading && <FeedTag source={feedSource} />}
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-3">
            {loading ? (
              <div className="space-y-2 px-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-14 w-full" />
                ))}
              </div>
            ) : (
              <>
                <Group
                  title="Active Fires"
                  tone="fire"
                  count={active.length}
                  items={active}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
                <Group
                  title="High-Risk Zones"
                  tone="amber"
                  count={risk.length}
                  items={risk}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              </>
            )}
          </div>

          <div className="border-t border-white/5 px-4 py-2.5 text-[10px] leading-relaxed text-slate-600">
            Select a location to open its spread forecast and impact model.
          </div>
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  tone,
  count,
  items,
  selectedId,
  onSelect,
}: {
  title: string;
  tone: 'fire' | 'amber';
  count: number;
  items: WatchLocation[];
  selectedId: string | null;
  onSelect: (l: WatchLocation) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold text-slate-300">{title}</span>
        <Badge tone={tone}>{count}</Badge>
      </div>
      <div className="space-y-1.5">
        {items.map((loc) => (
          <LocationRow
            key={loc.id}
            loc={loc}
            selected={loc.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
