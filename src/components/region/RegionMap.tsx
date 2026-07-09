import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap, type GeoJSONSource } from 'maplibre-gl';
import type { SpreadPoint, WatchLocation } from '../../types';
import { DARK_STYLE } from '../../lib/mapStyle';

interface Props {
  location: WatchLocation;
  points: SpreadPoint[];
  /** Current scrubber horizon: 0 = Now, else 3 | 6 | 12. */
  step: number;
  windDirection: number;
  /** External signal to call map.resize() after a panel transition. */
  resizeSignal: number;
}

function pointsToGeoJSON(points: SpreadPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { intensity: p.intensity, step: p.timestepHours },
    })),
  };
}

/**
 * Region map: dark basemap + native heatmap layer for the spread projection.
 * Timesteps are pre-computed; scrubbing only flips a GPU filter, so it's
 * instant. A fixed grid of wind arrows overlays the map (pointer-events off) so
 * panning never triggers re-layout of the indicators.
 */
export function RegionMap({ location, points, step, windDirection, resizeSignal }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const readyRef = useRef(false);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [location.lon, location.lat],
      zoom: 10.5,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    // Top-right (offset below the overlay pills via .region-map CSS) so the
    // zoom buttons never collide with the timeline scrubber at the bottom.
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('spread', { type: 'geojson', data: pointsToGeoJSON(points) });

      // Native heatmap — GPU-rendered, no per-frame canvas redraw.
      map.addLayer({
        id: 'spread-heat',
        type: 'heatmap',
        source: 'spread',
        paint: {
          'heatmap-weight': ['*', ['coalesce', ['get', 'intensity'], 0.3], 1.4],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 2.2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 12, 40, 15, 70],
          'heatmap-opacity': 0.82,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.15, 'rgba(120,45,10,0.5)',
            0.35, '#c23608',
            0.55, '#f0480e',
            0.75, '#ff6b35',
            0.9, '#ffb340',
            1, '#ffe9a8',
          ],
        },
      });

      // Ignition point marker.
      map.addSource('ignition', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [location.lon, location.lat] },
              properties: {},
            },
          ],
        },
      });
      map.addLayer({
        id: 'ignition-core',
        type: 'circle',
        source: 'ignition',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#ff6b35',
          'circle-stroke-width': 3,
        },
      });

      readyRef.current = true;
      applyFilter(map, step);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to a new location when the selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [location.lon, location.lat], zoom: 10.5, duration: 900, essential: true });
    const ign = map.getSource('ignition') as GeoJSONSource | undefined;
    ign?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [location.lon, location.lat] },
          properties: {},
        },
      ],
    });
  }, [location.id, location.lat, location.lon]);

  // Update spread data when the projection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('spread') as GeoJSONSource | undefined;
      if (src) src.setData(pointsToGeoJSON(points));
    };
    if (readyRef.current) apply();
    else map.once('load', apply);
  }, [points]);

  // Scrub: flip the timestep filter (instant, GPU).
  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) applyFilter(map, step);
  }, [step]);

  // Resize when a side panel finishes collapsing/expanding.
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.resize();
  }, [resizeSignal]);

  const travelBearing = (windDirection + 180) % 360;

  return (
    <div className="region-map absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      <WindArrowOverlay bearing={travelBearing} />
    </div>
  );
}

function applyFilter(map: MLMap, step: number) {
  if (!map.getLayer('spread-heat')) return;
  // "Now" shows nothing burned yet; otherwise cumulative up to the horizon.
  const filter = step <= 0 ? ['==', ['get', 'step'], -1] : ['<=', ['get', 'step'], step];
  map.setFilter('spread-heat', filter as maplibregl.FilterSpecification);
}

/**
 * Fixed decorative grid of wind arrows; each rotates to the travel bearing via
 * a CSS transform (transform-only → no layout, smooth). Positioned in HTML so
 * arrow glyphs never distort.
 */
function WindArrowOverlay({ bearing }: { bearing: number }) {
  const cols = 6;
  const rows = 4;
  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: ((c + 0.5) / cols) * 100, y: ((r + 0.5) / rows) * 100 });
    }
  }
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {cells.map((cell, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${cell.x}%`,
            top: `${cell.y}%`,
            transform: `translate(-50%, -50%) rotate(${bearing}deg)`,
            transition: 'transform 220ms ease-out',
          }}
        >
          <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
            <path
              d="M8 1 L8 16 M8 1 L4 6 M8 1 L12 6"
              stroke="#7dd3fc"
              strokeOpacity="0.22"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}
