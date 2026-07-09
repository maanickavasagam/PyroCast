import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import type { FirePoint, WatchLocation } from '../../types';
import { DARK_STYLE } from '../../lib/mapStyle';

interface Props {
  fires: FirePoint[];
  locations: WatchLocation[];
  selectedId: string | null;
  onSelect: (loc: WatchLocation) => void;
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

function locationsToGeoJSON(locations: WatchLocation[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: locations.map((loc) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
      properties: { id: loc.id, status: loc.status },
    })),
  };
}

/**
 * Animated "pulsing fire" icon rendered onto a small canvas each frame and
 * uploaded as a style image — MapLibre's canonical pulsing-dot pattern. Because
 * the symbol is part of the GPU-rendered scene (like the FIRMS circle layers),
 * it can NEVER drift from the basemap the way DOM markers can when their
 * event-driven position sync stalls (the old Marker-based approach could leave
 * a marker stranded at a stale screen position after zooming/panning).
 */
function makePulsingFireImage(map: MLMap, size = 56) {
  return {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),
    context: null as CanvasRenderingContext2D | null,

    onAdd() {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      this.context = canvas.getContext('2d', { willReadFrequently: true });
    },

    render() {
      const ctx = this.context;
      if (!ctx) return false;
      const duration = 2400;
      const t = (performance.now() % duration) / duration;

      const r = (size / 2) * 0.28;
      const outer = (size / 2) * 0.92;
      const pulseR = r + (outer - r) * t;

      ctx.clearRect(0, 0, size, size);
      // Expanding, fading ring.
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, pulseR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 68, 50, ${0.45 * (1 - t)})`;
      ctx.fill();
      // Solid core with glow.
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4432';
      ctx.shadowColor = 'rgba(255, 68, 50, 0.9)';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      this.data = new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer as ArrayBuffer);
      map.triggerRepaint(); // keep the animation running
      return true;
    },
  };
}

/**
 * Full-screen world map. ALL point visuals — raw FIRMS detections and the
 * curated watch locations — render as GPU layers so they stay pixel-locked to
 * the basemap at every zoom level. Interaction uses map hit-testing instead of
 * per-marker DOM listeners.
 */
export function WorldMap({ fires, locations, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const locationsRef = useRef(locations);
  locationsRef.current = locations;
  // Latest fires, readable from the load handler (fires often arrive first).
  const firesRef = useRef(fires);
  firesRef.current = fires;

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
    // Debug handle for inspecting projection/layer alignment in devtools.
    (window as unknown as Record<string, unknown>).__pyroWorldMap = map;

    map.on('load', () => {
      // ── FIRMS detections ────────────────────────────────────────────────
      map.addSource('firms', { type: 'geojson', data: firesToGeoJSON([]) });
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
          'circle-color': '#ffe9a8',
          'circle-opacity': 0.9,
        },
      });

      // ── Watch locations (GPU, not DOM markers) ──────────────────────────
      map.addImage('pulsing-fire', makePulsingFireImage(map), { pixelRatio: 2 });
      map.addSource('watch', { type: 'geojson', data: locationsToGeoJSON(locationsRef.current) });

      // High-risk: static amber dot + soft halo.
      map.addLayer({
        id: 'watch-risk-halo',
        type: 'circle',
        source: 'watch',
        filter: ['==', ['get', 'status'], 'high-risk'],
        paint: {
          'circle-radius': 9,
          'circle-color': '#ffb340',
          'circle-blur': 1,
          'circle-opacity': 0.35,
        },
      });
      map.addLayer({
        id: 'watch-risk',
        type: 'circle',
        source: 'watch',
        filter: ['==', ['get', 'status'], 'high-risk'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffb340',
          'circle-stroke-color': 'rgba(255, 179, 64, 0.35)',
          'circle-stroke-width': 2,
        },
      });

      // Active fronts: animated pulsing symbol.
      map.addLayer({
        id: 'watch-active',
        type: 'symbol',
        source: 'watch',
        filter: ['==', ['get', 'status'], 'active'],
        layout: {
          'icon-image': 'pulsing-fire',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      // Hit-testing interaction (replaces per-marker DOM listeners).
      const pick = (e: MapMouseEvent) => {
        const feats = map.queryRenderedFeatures(e.point, {
          layers: ['watch-active', 'watch-risk', 'watch-risk-halo'],
        });
        const id = feats[0]?.properties?.id;
        if (!id) return;
        const loc = locationsRef.current.find((l) => l.id === id);
        if (loc) onSelectRef.current(loc);
      };
      map.on('click', 'watch-active', pick);
      map.on('click', 'watch-risk', pick);
      map.on('click', 'watch-risk-halo', pick);
      for (const layer of ['watch-active', 'watch-risk']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }

      readyRef.current = true;
      // Apply any data that arrived while the style was loading.
      (map.getSource('firms') as GeoJSONSource).setData(firesToGeoJSON(firesRef.current));
    });

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update FIRMS source when fires change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('firms') as GeoJSONSource | undefined;
    if (src) src.setData(firesToGeoJSON(fires));
  }, [fires]);

  // Update watch-location source when the set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource('watch') as GeoJSONSource | undefined;
    if (src) src.setData(locationsToGeoJSON(locations));
  }, [locations, selectedId]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
