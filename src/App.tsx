import { useEffect, useMemo, useState } from 'react';
import type { FeedSource, FirePoint, WatchLocation } from './types';
import { fetchActiveFires } from './lib/firms';
import type { FireFeedPreference } from './lib/api';
import { WATCH_LOCATIONS } from './lib/regions';
import { clusterFiresToLocations } from './lib/clusters';
import { WorldView } from './components/world/WorldView';
import { RegionView } from './components/region/RegionView';

export default function App() {
  const [fires, setFires] = useState<FirePoint[]>([]);
  const [feedSource, setFeedSource] = useState<FeedSource>('simulated');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WatchLocation | null>(null);
  // User's explicit feed choice from the World View toggle; 'auto' = backend's
  // FIRMS→EONET fallback (the previous, only behavior).
  const [feedPreference, setFeedPreference] = useState<FireFeedPreference>('auto');

  // Load active-fire detections whenever the user's feed preference changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchActiveFires(WATCH_LOCATIONS, feedPreference).then(({ points, source }) => {
      if (cancelled) return;
      setFires(points);
      setFeedSource(source);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [feedPreference]);

  // Live/EONET feeds: replace the static watch-location list with clusters
  // computed from the actual live fire feed, so the panel shows real current
  // hotspots instead of always the same 10 fixed cities. Synthetic fallback
  // keeps the static list, since the synthetic fires are generated FROM it.
  const locations = useMemo(() => {
    if (feedSource === 'simulated') return WATCH_LOCATIONS;
    const clustered = clusterFiresToLocations(fires);
    return clustered.length > 0 ? clustered : WATCH_LOCATIONS;
  }, [fires, feedSource]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-base-950">
      {selected ? (
        <RegionView
          key={selected.id}
          location={selected}
          onBack={() => setSelected(null)}
        />
      ) : (
        <WorldView
          fires={fires}
          locations={locations}
          loading={loading}
          feedSource={feedSource}
          feedPreference={feedPreference}
          onFeedPreferenceChange={setFeedPreference}
          onSelect={setSelected}
        />
      )}
    </div>
  );
}
