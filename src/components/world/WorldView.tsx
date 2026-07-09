import { useState } from 'react';
import { Radio } from 'lucide-react';
import type { FirePoint, WatchLocation } from '../../types';
import { WorldMap } from './WorldMap';
import { LocationPanel } from './LocationPanel';
import { Badge } from '../ui/primitives';

interface Props {
  fires: FirePoint[];
  locations: WatchLocation[];
  loading: boolean;
  simulated: boolean;
  onSelect: (loc: WatchLocation) => void;
}

/** Default view: full-screen world map + collapsible watch-location panel. */
export function WorldView({ fires, locations, loading, simulated, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const activeCount = locations.filter((l) => l.status === 'active').length;

  return (
    <div className="absolute inset-0 animate-fade-in">
      <WorldMap fires={fires} locations={locations} selectedId={null} onSelect={onSelect} />

      <LocationPanel
        locations={locations}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onSelect={onSelect}
        selectedId={null}
        loading={loading}
        simulated={simulated}
      />

      {/* Live status pill, top-right */}
      <div className="pointer-events-none absolute right-4 top-4 z-10 flex items-center gap-2">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/5 bg-base-900/80 px-3.5 py-2 backdrop-blur-xl">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fire-500 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-fire-500" />
          </span>
          <span className="text-[12px] font-medium text-slate-300">
            {loading ? 'Syncing detections…' : `${fires.length.toLocaleString()} active detections`}
          </span>
          <Badge tone="fire">
            <Radio className="h-3 w-3" />
            {activeCount} fronts
          </Badge>
        </div>
      </div>

      {/* Legend, bottom-left */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex flex-col gap-1.5 rounded-lg border border-white/5 bg-base-900/80 px-3.5 py-3 text-[11px] backdrop-blur-xl"
        style={{ marginLeft: collapsed ? 60 : 352, transition: 'margin-left 200ms ease-out' }}
      >
        <div className="mb-0.5 font-semibold uppercase tracking-wide text-slate-500">Legend</div>
        <LegendRow color="#ff6b35" label="Active fire front" pulse />
        <LegendRow color="#ffb340" label="High-risk zone (no fire yet)" />
        <LegendRow color="#ffd18a" label="FIRMS thermal detection" />
      </div>
    </div>
  );
}

function LegendRow({ color, label, pulse }: { color: string; label: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-slate-300">
      <span
        className={`h-2.5 w-2.5 rounded-full ${pulse ? 'ring-2 ring-fire-500/30' : ''}`}
        style={{ background: color }}
      />
      {label}
    </div>
  );
}
