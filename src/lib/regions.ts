import type { FuelType, WatchLocation } from '../types';

/**
 * Seed watch locations. In production these would be derived from clustering
 * live FIRMS detections; here they give the World View a stable, curated set of
 * fire-prone regions with sensible default fuel types. Any location can still be
 * augmented with a *live* fire detection when FIRMS returns one nearby.
 */
export const WATCH_LOCATIONS: WatchLocation[] = [
  { id: 'socal-angeles', name: 'Angeles National Forest', region: 'Southern California', lat: 34.3, lon: -118.1, status: 'active', fuel: 'chaparral' },
  { id: 'norcal-shasta', name: 'Shasta-Trinity', region: 'Northern California', lat: 40.7, lon: -122.3, status: 'active', fuel: 'forest' },
  { id: 'socal-malibu', name: 'Malibu / Santa Monica Mtns', region: 'Southern California', lat: 34.03, lon: -118.75, status: 'high-risk', fuel: 'chaparral' },
  { id: 'colorado-boulder', name: 'Boulder Foothills', region: 'Colorado Front Range', lat: 40.0, lon: -105.35, status: 'high-risk', fuel: 'forest' },
  { id: 'oregon-cascades', name: 'Willamette Cascades', region: 'Oregon Cascades', lat: 44.1, lon: -122.1, status: 'active', fuel: 'forest' },
  { id: 'arizona-tonto', name: 'Tonto Basin', region: 'Central Arizona', lat: 33.8, lon: -111.3, status: 'high-risk', fuel: 'grassland' },
  { id: 'texas-hillcountry', name: 'Texas Hill Country', region: 'Central Texas', lat: 30.3, lon: -98.9, status: 'high-risk', fuel: 'grassland' },
  { id: 'greece-attica', name: 'Attica Peninsula', region: 'Greece — Attica', lat: 38.1, lon: 23.9, status: 'active', fuel: 'chaparral' },
  { id: 'australia-blue', name: 'Blue Mountains', region: 'NSW Australia', lat: -33.7, lon: 150.3, status: 'active', fuel: 'forest' },
  { id: 'portugal-central', name: 'Serra da Estrela', region: 'Central Portugal', lat: 40.3, lon: -7.6, status: 'high-risk', fuel: 'forest' },
];

/**
 * Regional population density estimates (people per square mile).
 * NOTE: These are coarse approximations used only for the "people in path"
 * impact estimate — a real deployment would query a gridded population raster
 * (e.g. WorldPop / GHSL) for the projected polygon.
 */
export const REGION_POP_DENSITY: Record<string, number> = {
  'Southern California': 1350,
  'Northern California': 190,
  'Colorado Front Range': 420,
  'Oregon Cascades': 55,
  'Central Arizona': 90,
  'Central Texas': 240,
  'Greece — Attica': 2600,
  'NSW Australia': 210,
  'Central Portugal': 175,
};

/** Fallback density when a region isn't in the table. */
export const DEFAULT_POP_DENSITY = 200;

export function densityForRegion(region: string): number {
  return REGION_POP_DENSITY[region] ?? DEFAULT_POP_DENSITY;
}

export const FUEL_LABELS: Record<FuelType, string> = {
  chaparral: 'Chaparral / Brush',
  forest: 'Coniferous Forest',
  grassland: 'Grassland',
  urban: 'Urban Interface',
};
