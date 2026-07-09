import { useEffect, useState } from 'react';
import type { FeedSource, FirePoint, WatchLocation } from './types';
import { fetchActiveFires } from './lib/firms';
import { WATCH_LOCATIONS } from './lib/regions';
import { WorldView } from './components/world/WorldView';
import { RegionView } from './components/region/RegionView';

export default function App() {
  const [fires, setFires] = useState<FirePoint[]>([]);
  const [feedSource, setFeedSource] = useState<FeedSource>('simulated');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WatchLocation | null>(null);

  // Load active-fire detections once, up front.
  useEffect(() => {
    let cancelled = false;
    fetchActiveFires(WATCH_LOCATIONS).then(({ points, source }) => {
      if (cancelled) return;
      setFires(points);
      setFeedSource(source);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
          locations={WATCH_LOCATIONS}
          loading={loading}
          feedSource={feedSource}
          onSelect={setSelected}
        />
      )}
    </div>
  );
}
