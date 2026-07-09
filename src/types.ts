// Shared domain types for PyroCast.
// Keeping these central means the data layer (/lib) and the UI never disagree
// on shapes, and a real backend can implement the same contracts later.

export type FuelType = 'chaparral' | 'forest' | 'grassland' | 'urban';

export type LocationStatus = 'active' | 'high-risk';

/** A single active-fire detection (from NASA FIRMS or synthetic fallback). */
export interface FirePoint {
  lat: number;
  lon: number;
  /** Brightness temperature (Kelvin) — proxy for fire intensity. */
  brightness: number;
  /** FIRMS confidence: 'l' | 'n' | 'h' or a 0-100 number, normalized to 0-100. */
  confidence: number;
  acqDate: string;
}

/** Live (or simulated) weather for a location. */
export interface Weather {
  windSpeed: number; // mph
  windDirection: number; // degrees, meteorological (direction wind comes FROM)
  humidity: number; // %
  temperature: number; // °F
}

/** Terrain sample used to estimate slope for the spread model. */
export interface Terrain {
  elevation: number; // meters
  slope: number; // degrees (approximate, uphill toward wind)
}

/**
 * A watch location shown in the World View list. It bundles everything the
 * Region View needs so switching views doesn't require a fresh round of fetches.
 */
export interface WatchLocation {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  status: LocationStatus;
  /** Default fuel type for the terrain around this location. */
  fuel: FuelType;
  /** True when this location's dataset came from the synthetic fallback. */
  simulated?: boolean;
}

/** A single projected burn cell produced by the spread model. */
export interface SpreadPoint {
  lat: number;
  lng: number;
  /** 0-1 normalized burn intensity at this cell. */
  intensity: number;
  /** Which forecast horizon this cell belongs to (3, 6, or 12). */
  timestepHours: number;
}

/** Aggregate statistics derived from a spread projection. */
export interface SpreadStats {
  timestepHours: number;
  burnAreaAcres: number;
  rateOfSpreadChainsHr: number;
  flameLengthFt: number;
  peopleInPath: number;
  roadsAtRisk: number;
  /** 0-100 composite threat index. */
  threatIndex: number;
  threatLabel: 'Low' | 'Moderate' | 'High' | 'Extreme';
}

/** Full output of a spread computation across all horizons. */
export interface SpreadResult {
  points: SpreadPoint[];
  statsByStep: Record<number, SpreadStats>;
}

/** Tracks which data sources are live vs. simulated, for the "simulated" tags. */
export interface DataSourceState {
  fires: boolean; // true = simulated
  weather: boolean;
  terrain: boolean;
}
