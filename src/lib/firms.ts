import type { FeedSource, FirePoint, WatchLocation } from '../types';
import { fetchGlobalFires } from './api';

// ─────────────────────────────────────────────────────────────────────────────
// Active-fire feed orchestration.
//
// Provenance priority:
//   1. Backend NASA FIRMS  → primary LIVE feed        (source: 'firms')
//   2. Backend NASA EONET  → live fallback feed       (source: 'eonet')
//      (used automatically when FIRMS is unreachable, e.g. a network that
//       filters *.modaps.eosdis.gov)
//   3. Synthetic dataset   → no live feed available   (source: 'simulated')
//
// The UI treats ONLY 'firms' as the primary live feed; 'eonet' and 'simulated'
// are surfaced with an explicit "primary live feed unavailable" notice so the
// fallback is never mistaken for the live feed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch active fires. Returns the points and the resolved feed source. Never
 * rejects — falls back to a synthetic dataset if the backend is unreachable.
 */
export async function fetchActiveFires(
  seeds: WatchLocation[]
): Promise<{ points: FirePoint[]; source: FeedSource }> {
  try {
    const { points, source } = await fetchGlobalFires();
    return { points, source };
  } catch (err) {
    console.warn('[fires] backend unavailable — using synthetic feed:', err);
    return { points: syntheticFires(seeds), source: 'simulated' };
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
