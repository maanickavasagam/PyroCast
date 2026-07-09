import type { EvacuationRoute, FirePoint, FuelType, SpreadPoint, SpreadStats, Weather } from '../types';
import { deriveImpact } from './spread';

// ─────────────────────────────────────────────────────────────────────────────
// PyroCast backend client.
//
// The backend (FastAPI) owns the keyed/live data sources. Point the frontend at
// it via VITE_API_BASE (defaults to http://localhost:8000). All backend calls
// live here so the rest of the app depends on clean typed functions, not URLs.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:8081').replace(/\/$/, '');

/** Backend-reported provenance for the fire feed. */
export type BackendFireSource = 'firms' | 'eonet' | 'none';

interface BackendFire {
  lat: number;
  lon: number;
  brightness: number | null;
  confidence: number | string | null;
  acq_date: string;
  title?: string;
}

/** Map the backend's confidence (number | 'l'|'n'|'h' | null) to a 0-100 number. */
function normConfidence(c: number | string | null): number {
  if (typeof c === 'number') return c;
  if (typeof c === 'string') {
    const s = c.trim().toLowerCase();
    if (s === 'l') return 25;
    if (s === 'n') return 60;
    if (s === 'h') return 90;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return 50; // EONET / unknown → nominal
}

export interface GlobalFiresResult {
  points: FirePoint[];
  source: 'firms' | 'eonet';
}

/**
 * Fetch active fires from the backend. Resolves with the points and which
 * source they came from ('firms' primary, 'eonet' fallback). Throws if the
 * backend is unreachable or has no data, so the caller can drop to synthetic.
 */
export async function fetchGlobalFires(signal?: AbortSignal): Promise<GlobalFiresResult> {
  // Guard against a slow/hung backend so the World View falls back promptly.
  const res = await fetch(`${API_BASE}/api/global-fires`, {
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`backend /api/global-fires ${res.status}`);
  const data = await res.json();

  if (data.source === 'none' || !Array.isArray(data.fires) || data.fires.length === 0) {
    throw new Error('backend returned no fire data');
  }

  const points: FirePoint[] = (data.fires as BackendFire[]).map((f) => ({
    lat: f.lat,
    lon: f.lon,
    brightness: typeof f.brightness === 'number' ? f.brightness : 330,
    confidence: normConfidence(f.confidence),
    acqDate: f.acq_date ?? '',
  }));

  return { points, source: data.source === 'firms' ? 'firms' : 'eonet' };
}

// ── Weather ──────────────────────────────────────────────────────────────────

const cToF = (c: number) => c * (9 / 5) + 32;

/**
 * Fetch current weather from the backend, normalized to the frontend `Weather`
 * shape (temperature in °F to match the rest of the UI). Throws on failure so
 * the caller can fall back to a synthetic reading.
 */
export async function fetchWeatherFromBackend(
  lat: number,
  lon: number,
  signal?: AbortSignal
): Promise<Weather> {
  const res = await fetch(`${API_BASE}/api/weather?lat=${lat}&lon=${lon}`, { signal });
  if (!res.ok) throw new Error(`backend /api/weather ${res.status}`);
  const d = await res.json();
  return {
    windSpeed: Math.round(d.wind_speed_mph ?? 0),
    windDirection: Math.round(d.wind_direction_deg ?? 0),
    humidity: Math.round(d.humidity_pct ?? 30),
    temperature: Math.round(cToF(d.temp_c ?? 20)),
  };
}

// ── Simulation ───────────────────────────────────────────────────────────────

interface BackendSimResponse {
  threat_index: { label: SpreadStats['threatLabel']; score: number };
  burn_area_acres: number[];
  burn_area_acres_low?: number[] | null;
  burn_area_acres_high?: number[] | null;
  rate_of_spread_ch_per_h: number;
  flame_length_ft: number;
  heatmap_frames: { timestep: number; points: { lat: number; lng: number; intensity: number }[] }[];
  data_source: 'live' | 'simulated';
  model_confidence?: number | null;
  evacuation_route?: {
    destination_name: string;
    distance_km: number;
    duration_min: number;
    geometry: [number, number][];
  } | null;
}

export interface SimulationResult {
  points: SpreadPoint[];
  statsByStep: Record<number, SpreadStats>;
  dataSource: 'live' | 'simulated';
  evacuationRoute?: EvacuationRoute;
  /** Raw backend /api/simulate response, kept so it can be forwarded to /api/summarize
   * without re-running the simulation. */
  raw: unknown;
}

export interface SimulateParams {
  lat: number;
  lon: number;
  windDirection: number;
  windSpeed: number;
  fuel: FuelType;
  region: string;
}

// The UI exposes three horizons; the backend returns four (3/6/9/12h). We map
// the UI horizons onto the matching backend frames (dropping +9h, which the
// scrubber has no stop for) so the existing components stay unchanged.
const UI_HORIZONS = [3, 6, 12] as const;
const backendIndexFor = (hours: number, frameCount: number): number => {
  if (hours === 3) return 0;
  if (hours === 6) return 1;
  return Math.min(3, frameCount - 1); // +12h → last frame
};

/**
 * Run the spread simulation on the backend and map the response into the
 * frontend's SpreadPoint/SpreadStats shapes. Humidity is intentionally omitted
 * so the backend performs its own live-weather lookup and can report
 * data_source: "live". Throws on network failure so the caller can fall back to
 * the in-browser model.
 */
export async function fetchSimulation(
  p: SimulateParams,
  signal?: AbortSignal
): Promise<SimulationResult> {
  const res = await fetch(`${API_BASE}/api/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      lat: p.lat,
      lon: p.lon,
      wind_direction: p.windDirection,
      wind_speed: p.windSpeed,
      fuel_type: p.fuel,
    }),
  });
  if (!res.ok) throw new Error(`backend /api/simulate ${res.status}`);
  const d: BackendSimResponse = await res.json();

  const frames = [...(d.heatmap_frames ?? [])].sort((a, b) => a.timestep - b.timestep);
  const acres = d.burn_area_acres ?? [];
  const acresLow = d.burn_area_acres_low ?? null;
  const acresHigh = d.burn_area_acres_high ?? null;

  // Points: assign each cell the earliest UI horizon it appears in (dedupe by
  // coordinate) so the map's cumulative "<= step" filter works as before.
  const seen = new Set<string>();
  const points: SpreadPoint[] = [];
  for (const hours of UI_HORIZONS) {
    const frame = frames[backendIndexFor(hours, frames.length)];
    if (!frame) continue;
    for (const pt of frame.points) {
      const key = `${pt.lat.toFixed(4)},${pt.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({
        lat: pt.lat,
        lng: pt.lng,
        intensity: typeof pt.intensity === 'number' ? pt.intensity : 0.5,
        timestepHours: hours,
      });
    }
  }

  // Per-horizon stats. Burn area comes from the backend; flame length / ROS /
  // threat are single values; people & roads are derived client-side.
  const statsByStep: Record<number, SpreadStats> = {};
  for (const hours of UI_HORIZONS) {
    const idx = backendIndexFor(hours, acres.length);
    const burn = acres[idx] ?? acres[acres.length - 1] ?? 0;
    const impact = deriveImpact(burn, p.lat, p.lon, p.region);
    statsByStep[hours] = {
      timestepHours: hours,
      burnAreaAcres: burn,
      burnAreaAcresLow: acresLow?.[idx] ?? undefined,
      burnAreaAcresHigh: acresHigh?.[idx] ?? undefined,
      rateOfSpreadChainsHr: d.rate_of_spread_ch_per_h,
      flameLengthFt: d.flame_length_ft,
      peopleInPath: impact.peopleInPath,
      roadsAtRisk: impact.roadsAtRisk,
      threatIndex: d.threat_index.score,
      threatLabel: d.threat_index.label,
      modelConfidence: d.model_confidence ?? undefined,
    };
  }

  const evacuationRoute: EvacuationRoute | undefined = d.evacuation_route
    ? {
        destinationName: d.evacuation_route.destination_name,
        distanceKm: d.evacuation_route.distance_km,
        durationMin: d.evacuation_route.duration_min,
        geometry: d.evacuation_route.geometry,
      }
    : undefined;

  return {
    points,
    statsByStep,
    dataSource: d.data_source === 'live' ? 'live' : 'simulated',
    evacuationRoute,
    raw: d,
  };
}

// ── AI incident summary ──────────────────────────────────────────────────────

/**
 * Ask the backend for a short AI-generated incident brief from a completed
 * simulation. `rawSimulation` should be the `raw` field from a SimulationResult
 * (the untouched backend /api/simulate response). Slow (external LLM call on
 * this network can take 30-90s) — call it lazily, not on every slider tick.
 * Throws on failure so the caller can show an inline error rather than a
 * fabricated summary.
 */
export async function fetchSummary(
  rawSimulation: unknown,
  locationName: string,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ simulation: rawSimulation, location_name: locationName }),
  });
  if (!res.ok) throw new Error(`backend /api/summarize ${res.status}`);
  const d = await res.json();
  if (!d.summary) throw new Error('backend returned no summary');
  return d.summary as string;
}
