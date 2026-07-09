import type { FirePoint, WatchLocation } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// NASA FIRMS active fire data.
//
// Register for a free MAP_KEY at https://firms.modaps.eosdis.gov/api/map_key/
// and drop it in below (or set VITE_FIRMS_KEY in a .env file). The `DEMO_KEY`
// placeholder will not return live data — the code falls back to a clearly
// labeled synthetic dataset so the UI always renders.
//
// Endpoint shape:
//   https://firms.modaps.eosdis.gov/api/area/csv/{MAP_KEY}/VIIRS_SNPP_NRT/world/1
// (last path segment = number of days back)
// ─────────────────────────────────────────────────────────────────────────────

const FIRMS_KEY = import.meta.env.VITE_FIRMS_KEY ?? 'DEMO_KEY';
const FIRMS_URL = `https://firms.modaps.eosdis.gov/api/area/csv/${FIRMS_KEY}/VIIRS_SNPP_NRT/world/1`;

/** Normalize FIRMS confidence (l/n/h or 0-100) to a 0-100 number. */
function normalizeConfidence(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s === 'l') return 25;
  if (s === 'n') return 60;
  if (s === 'h') return 90;
  const n = Number(s);
  return Number.isFinite(n) ? n : 50;
}

/**
 * Minimal CSV parser tailored to FIRMS output (no quoted-comma fields in the
 * columns we consume), so we avoid pulling in a CSV dependency. Reads the header
 * row to locate columns by name, tolerating column-order changes between
 * FIRMS product versions.
 */
export function parseFirmsCsv(csv: string): FirePoint[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const iLat = idx('latitude');
  const iLon = idx('longitude');
  const iBright = idx('bright_ti4') >= 0 ? idx('bright_ti4') : idx('brightness');
  const iConf = idx('confidence');
  const iDate = idx('acq_date');

  if (iLat < 0 || iLon < 0) return [];

  const out: FirePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const lat = Number(cols[iLat]);
    const lon = Number(cols[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      lat,
      lon,
      brightness: iBright >= 0 ? Number(cols[iBright]) || 330 : 330,
      confidence: iConf >= 0 ? normalizeConfidence(cols[iConf] ?? '') : 50,
      acqDate: iDate >= 0 ? cols[iDate] : '',
    });
  }
  return out;
}

/**
 * Fetch worldwide active fires from FIRMS. Returns { points, simulated }.
 * On any failure (missing key, CORS, rate-limit, network) it resolves to a
 * synthetic dataset clustered around the known watch locations, flagged
 * `simulated: true` so the UI can show a muted "simulated data" tag.
 */
export async function fetchActiveFires(
  seeds: WatchLocation[]
): Promise<{ points: FirePoint[]; simulated: boolean }> {
  if (FIRMS_KEY === 'DEMO_KEY') {
    // No real key configured — skip the network round-trip and simulate.
    return { points: syntheticFires(seeds), simulated: true };
  }
  try {
    const res = await fetch(FIRMS_URL, { headers: { Accept: 'text/csv' } });
    if (!res.ok) throw new Error(`FIRMS HTTP ${res.status}`);
    const csv = await res.text();
    const points = parseFirmsCsv(csv);
    if (points.length === 0) throw new Error('FIRMS returned no rows');
    return { points, simulated: false };
  } catch (err) {
    console.warn('[FIRMS] falling back to simulated fire data:', err);
    return { points: syntheticFires(seeds), simulated: true };
  }
}

/**
 * Deterministic pseudo-random clusters of detections around each `active`
 * watch location — enough visual density to feel real without a live feed.
 */
function syntheticFires(seeds: WatchLocation[]): FirePoint[] {
  const out: FirePoint[] = [];
  let s = 1337; // simple LCG seed for repeatable output
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (const loc of seeds) {
    if (loc.status !== 'active') continue;
    const n = 6 + Math.floor(rand() * 8);
    for (let i = 0; i < n; i++) {
      const spread = 0.12;
      out.push({
        lat: loc.lat + (rand() - 0.5) * spread,
        lon: loc.lon + (rand() - 0.5) * spread,
        brightness: 320 + rand() * 60,
        confidence: 40 + rand() * 55,
        acqDate: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return out;
}
