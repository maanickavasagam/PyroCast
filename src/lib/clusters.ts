import type { FirePoint, FuelType, WatchLocation } from '../types';
import { WATCH_LOCATIONS } from './regions';

// ─────────────────────────────────────────────────────────────────────────────
// Live watch-location clustering.
//
// Turns the raw live fire feed (thousands of unlabeled points) into a small
// set of NAMED, clickable watch locations — the same role WATCH_LOCATIONS used
// to play alone. No geocoding API: clusters are grid-bucketed then merged by
// proximity, and named by nearest-known-place lookup against the existing
// static list (repurposed as a reference table, not the display list). A
// cluster far from every reference point gets a plain coordinate label instead
// of a fabricated place name.
// ─────────────────────────────────────────────────────────────────────────────

const GRID_DEG = 0.75; // initial coarse bucket size (~80km at the equator)
const MERGE_RADIUS_KM = 180; // merge nearby buckets into one cluster
const MAX_CLUSTERS = 14;
const NAMED_REFERENCE_RADIUS_KM = 600; // beyond this, don't borrow a static name

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface RawCluster {
  lat: number;
  lon: number;
  count: number;
  maxBrightness: number;
}

/** Coarse grid bucketing: group points into cells, each becomes a candidate cluster. */
function bucketize(points: FirePoint[]): RawCluster[] {
  const buckets = new Map<string, { sumLat: number; sumLon: number; count: number; maxBrightness: number }>();
  for (const p of points) {
    const key = `${Math.round(p.lat / GRID_DEG)},${Math.round(p.lon / GRID_DEG)}`;
    const b = buckets.get(key);
    if (b) {
      b.sumLat += p.lat;
      b.sumLon += p.lon;
      b.count += 1;
      b.maxBrightness = Math.max(b.maxBrightness, p.brightness);
    } else {
      buckets.set(key, { sumLat: p.lat, sumLon: p.lon, count: 1, maxBrightness: p.brightness });
    }
  }
  return [...buckets.values()].map((b) => ({
    lat: b.sumLat / b.count,
    lon: b.sumLon / b.count,
    count: b.count,
    maxBrightness: b.maxBrightness,
  }));
}

/** Greedily merge nearby buckets (by centroid distance) into fewer, larger clusters. */
function mergeNearby(buckets: RawCluster[]): RawCluster[] {
  const remaining = [...buckets].sort((a, b) => b.count - a.count);
  const merged: RawCluster[] = [];

  while (remaining.length) {
    const seed = remaining.shift()!;
    let sumLat = seed.lat * seed.count;
    let sumLon = seed.lon * seed.count;
    let count = seed.count;
    let maxBrightness = seed.maxBrightness;

    for (let i = remaining.length - 1; i >= 0; i--) {
      const cand = remaining[i];
      if (haversineKm(seed.lat, seed.lon, cand.lat, cand.lon) <= MERGE_RADIUS_KM) {
        sumLat += cand.lat * cand.count;
        sumLon += cand.lon * cand.count;
        count += cand.count;
        maxBrightness = Math.max(maxBrightness, cand.maxBrightness);
        remaining.splice(i, 1);
      }
    }

    merged.push({ lat: sumLat / count, lon: sumLon / count, count, maxBrightness });
  }

  return merged;
}

function nearestReference(lat: number, lon: number): { loc: WatchLocation; km: number } {
  let best = WATCH_LOCATIONS[0];
  let bestKm = Infinity;
  for (const loc of WATCH_LOCATIONS) {
    const km = haversineKm(lat, lon, loc.lat, loc.lon);
    if (km < bestKm) {
      bestKm = km;
      best = loc;
    }
  }
  return { loc: best, km: bestKm };
}

function coordLabel(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/** Rough fuel guess for clusters with no nearby reference point. */
function guessFuel(lat: number): FuelType {
  const abs = Math.abs(lat);
  if (abs > 55) return 'forest'; // boreal
  if (abs > 35) return 'chaparral'; // temperate/mediterranean band
  return 'grassland'; // tropical/subtropical
}

/**
 * Cluster a live fire feed into a small set of named, clickable watch
 * locations. Falls back to an empty array if there are no points — caller
 * should keep the static list in that case.
 */
export function clusterFiresToLocations(points: FirePoint[]): WatchLocation[] {
  if (points.length === 0) return [];

  const buckets = bucketize(points);
  const merged = mergeNearby(buckets)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CLUSTERS);

  return merged.map((c, i) => {
    const { loc: ref, km } = nearestReference(c.lat, c.lon);
    const named = km <= NAMED_REFERENCE_RADIUS_KM;
    return {
      id: `live-cluster-${i}-${c.lat.toFixed(2)}-${c.lon.toFixed(2)}`,
      name: named ? ref.name : `Fire Cluster — ${coordLabel(c.lat, c.lon)}`,
      region: named ? ref.region : coordLabel(c.lat, c.lon),
      lat: c.lat,
      lon: c.lon,
      status: 'active',
      fuel: named ? ref.fuel : guessFuel(c.lat),
    };
  });
}
