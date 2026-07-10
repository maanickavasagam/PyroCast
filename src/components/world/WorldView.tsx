import { useState } from 'react';
import { Radio } from 'lucide-react';
import type { FeedSource, FirePoint, WatchLocation } from '../../types';
import type { FireFeedPreference } from '../../lib/api';
import { WorldMap } from './WorldMap';
import { LocationPanel } from './LocationPanel';
import { DataLogPanel } from './DataLogPanel';
import { Badge, FEED_META, FeedTag, LiveFeedNotice } from '../ui/primitives';

interface Props {
  fires: FirePoint[];
  locations: WatchLocation[];
  loading: boolean;
  feedSource: FeedSource;
  feedPreference: FireFeedPreference;
  onFeedPreferenceChange: (pref: FireFeedPreference) => void;
  onSelect: (loc: WatchLocation) => void;
}

const FEED_OPTIONS: { value: FireFeedPreference; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'firms', label: 'FIRMS' },
  { value: 'eonet', label: 'EONET' },
];

/** Default view: full-screen world map + collapsible watch-location panel. */
export function WorldView({
  fires,
  locations,
  loading,
  feedSource,
  feedPreference,
  onFeedPreferenceChange,
  onSelect,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const activeCount = locations.filter((l) => l.status === 'active').length;
  const meta = FEED_META[feedSource];
  const isLive = meta.live;

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
        feedSource={feedSource}
      />

      {/* Feed status, top-right — provenance-aware. Only FIRMS reads as LIVE. */}
      <div className="pointer-events-none absolute right-4 top-4 z-10 flex max-w-[calc(100%-1rem)] flex-col items-end gap-2">
        {/* Manual feed toggle — lets the user pin FIRMS or EONET explicitly
            instead of only the automatic FIRMS→EONET fallback. */}
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/5 bg-base-900/80 p-1 backdrop-blur-xl">
          {FEED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onFeedPreferenceChange(opt.value)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                feedPreference === opt.value
                  ? 'bg-fire-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-white/5 bg-base-900/80 px-3.5 py-2 backdrop-blur-xl">
          <span className="relative flex h-2 w-2">
            {isLive && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-70" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isLive ? 'bg-teal-500' : feedSource === 'eonet' ? 'bg-ember' : 'bg-slate-500'
              }`}
            />
          </span>
          <span className="text-[12px] font-medium text-slate-300">
            {loading
              ? 'Syncing feed…'
              : `${fires.length.toLocaleString()} ${meta.unit}`}
          </span>
          {!loading && <FeedTag source={feedSource} />}
          <Badge tone="fire">
            <Radio className="h-3 w-3" />
            {activeCount} fronts
          </Badge>
        </div>

        {/* Compact "not the primary live feed" pill when applicable. */}
        {!loading && !isLive && (
          <div className="pointer-events-auto">
            <LiveFeedNotice source={feedSource} />
          </div>
        )}
      </div>

      {/* Legend, bottom-left */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex flex-col gap-1.5 rounded-lg border border-white/5 bg-base-900/80 px-3.5 py-3 text-[11px] backdrop-blur-xl"
        style={{ marginLeft: collapsed ? 60 : 352, transition: 'margin-left 200ms ease-out' }}
      >
        <div className="mb-0.5 font-semibold uppercase tracking-wide text-slate-500">Legend</div>
        <LegendRow color="#ff4432" label="Active fire front" pulse />
        <LegendRow color="#ffb340" label="High-risk zone (no fire yet)" />
        <LegendRow
          color="#ffe9a8"
          label={
            feedSource === 'firms'
              ? 'FIRMS thermal detection'
              : feedSource === 'eonet'
                ? 'EONET wildfire event'
                : 'Simulated detection'
          }
        />
      </div>

      {/* Timestamped environmental data log (bottom-right) */}
      <DataLogPanel />
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
