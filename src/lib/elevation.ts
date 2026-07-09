import type { Terrain } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Open-Elevation — free, key-less elevation lookups.
//   https://api.open-elevation.com/api/v1/lookup?locations=lat,lon|lat,lon
//
// We sample the ignition point plus a small ring of neighbors to approximate the
// local slope (rise/run) feeding the spread model. Open-Elevation is frequently
// rate-limited / CORS-restricted, so a synthetic fallback is expected and fine.
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://api.open-elevation.com/api/v1/lookup';

/** Meters per degree latitude (constant); longitude scaled by cos(lat). */
const M_PER_DEG_LAT = 111_320;

/** Fetch elevation + approximate slope for a coordinate. */
export async function fetchTerrain(
  lat: number,
  lon: number
): Promise<{ terrain: Terrain; simulated: boolean }> {
  try {
    const d = 0.01; // ~1.1 km sample offset
    const pts = [
      [lat, lon],
      [lat + d, lon],
      [lat - d, lon],
      [lat, lon + d],
      [lat, lon - d],
    ];
    const locations = pts.map(([a, b]) => `${a},${b}`).join('|');
    const res = await fetch(`${ENDPOINT}?locations=${locations}`);
    if (!res.ok) throw new Error(`Open-Elevation HTTP ${res.status}`);
    const data = await res.json();
    const els: number[] = data.results?.map((r: { elevation: number }) => r.elevation) ?? [];
    if (els.length < 5) throw new Error('Open-Elevation returned too few points');

    const center = els[0];
    // Max gradient magnitude across the N-S and E-W sample pairs.
    const runLat = 2 * d * M_PER_DEG_LAT;
    const runLon = 2 * d * M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    const gradNS = Math.abs(els[1] - els[2]) / runLat;
    const gradEW = Math.abs(els[3] - els[4]) / runLon;
    const grad = Math.max(gradNS, gradEW);
    const slope = (Math.atan(grad) * 180) / Math.PI;

    return { terrain: { elevation: center, slope }, simulated: false };
  } catch (err) {
    console.warn('[Open-Elevation] falling back to simulated terrain:', err);
    return { terrain: syntheticTerrain(lat, lon), simulated: true };
  }
}

/** Deterministic synthetic terrain — moderate foothill slope by default. */
export function syntheticTerrain(lat: number, lon: number): Terrain {
  const h = Math.abs(Math.sin(lat * 45.164 + lon * 91.11) * 12345.678);
  const frac = h - Math.floor(h);
  return {
    elevation: Math.round(300 + frac * 1800),
    slope: Math.round((6 + frac * 22) * 10) / 10, // 6-28°
  };
}
