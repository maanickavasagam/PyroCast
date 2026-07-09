import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap, type GeoJSONSource } from 'maplibre-gl';
import type { FirePoint, WatchLocation } from '../../types';
import { DARK_STYLE } from '../../lib/mapStyle';

interface Props {
  fires: FirePoint[];
  locations: WatchLocation[];
  selectedId: string | null;
  onSelect: (loc: WatchLocation) => void;
}

/** Build the DOM element for a watch-location marker. */
function makeMarkerEl(loc: WatchLocation, selected: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `pyro-marker${loc.status === 'high-risk' ? ' risk' : ''}${
    selected ? ' active-sel' : ''
  }`;
  if (loc.status === 'active') {
    el.innerHTML =
      '<span class="ring"></span><span class="ring delay"></span><span class="core"></span>';
  } else {
    el.innerHTML = '<span class="core"></span>';
  }
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${loc.name} — ${loc.status}`);
  return el;
}

function firesToGeoJSON(fires: FirePoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fires.map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: { brightness: f.brightness, confidence: f.confidence },
    })),
  };
}

/**
 * Full-screen world map. Raw FIRMS detections render as a GPU circle layer
 * (scales to thousands of points); the curated watch locations render as
 * animated DOM markers on top so they stay clickable and can pulse.
 */
export function WorldMap({ fires, locations, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [-40, 30],
      zoom: 1.6,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('firms', {
        type: 'geojson',
        data: firesToGeoJSON(fires),
      });
      map.addLayer({
        id: 'firms-glow',
        type: 'circle',
        source: 'firms',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 10],
          'circle-color': '#ff6b35',
          'circle-blur': 1,
          'circle-opacity': 0.45,
        },
      });
      map.addLayer({
        id: 'firms-core',
        type: 'circle',
        source: 'firms',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.1, 6, 3],
          'circle-color': '#ffd18a',
          'circle-opacity': 0.9,
        },
      });
      readyRef.current = true;
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update FIRMS source when fires change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('firms') as GeoJSONSource | undefined;
      if (src) src.setData(firesToGeoJSON(fires));
    };
    if (readyRef.current) apply();
    else map.once('load', apply);
  }, [fires]);

  // (Re)build watch-location markers when the set or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const build = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = locations.map((loc) => {
        const el = makeMarkerEl(loc, loc.id === selectedId);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectRef.current(loc);
        });
        return new maplibregl.Marker({ element: el })
          .setLngLat([loc.lon, loc.lat])
          .addTo(map);
      });
    };
    if (readyRef.current) build();
    else map.once('load', build);
  }, [locations, selectedId]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
