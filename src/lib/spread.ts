import type {
  FuelType,
  SpreadPoint,
  SpreadResult,
  SpreadStats,
  Terrain,
  Weather,
} from '../types';
import { densityForRegion } from './regions';

// ─────────────────────────────────────────────────────────────────────────────
// PyroCast client-side spread model
//
// A deliberately lightweight, fully explainable wildfire spread estimator that
// runs in the browser in a few milliseconds. It is NOT a research-grade model —
// it is "directionally correct": fire runs downwind and uphill, faster in dry,
// windy, light-but-flammable fuels.
//
// Pipeline:
//   1. Rate of spread (ROS) from a Rothermel-inspired product of fuel, wind,
//      dryness and slope factors.                              [computeRos]
//   2. An anisotropic (elliptical) front that is elongated downwind and pushed
//      further along the uphill vector — this is the "probabilistic grid
//      expansion": we sample a grid and admit each cell that falls inside the
//      front, with a small stochastic boundary jitter so the perimeter looks
//      organic rather than a perfect ellipse (a simplified cellular-automaton
//      front).                                                  [computeSpread]
//   3. Derived stats — burn area, ROS, Byram flame length, people in path,
//      roads at risk, threat index.                            [computeStats]
//
// Units are kept explicit in variable names to avoid conversion bugs.
// ─────────────────────────────────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;
const FT_PER_CHAIN = 66;
const M_PER_FT = 0.3048;
const SQM_PER_ACRE = 4046.86;
const ACRES_PER_SQMI = 640;

const TIMESTEPS = [3, 6, 12] as const;

/** Per-fuel-type physical parameters. */
interface FuelParams {
  /** Still-air reference rate of spread, chains/hour. */
  baseRosChains: number;
  /** Oven-dry fuel load available to the flaming front, lb/ft². */
  fuelLoadLbFt2: number;
  /** How elongated the front gets per unit wind (downwind bias). */
  windElong: number;
  /** Relative fuel hazard (0-1) feeding the threat index. */
  hazard: number;
}

const FUEL: Record<FuelType, FuelParams> = {
  grassland: { baseRosChains: 36, fuelLoadLbFt2: 0.05, windElong: 0.9, hazard: 0.8 },
  chaparral: { baseRosChains: 20, fuelLoadLbFt2: 0.35, windElong: 0.8, hazard: 1.0 },
  forest: { baseRosChains: 11, fuelLoadLbFt2: 0.7, windElong: 0.6, hazard: 0.75 },
  urban: { baseRosChains: 8, fuelLoadLbFt2: 0.25, windElong: 0.5, hazard: 0.6 },
};

/** Heat content of wildland fuel, Btu/lb (standard ~8000). */
const HEAT_CONTENT_BTU_LB = 8000;

export interface SpreadInput {
  lat: number;
  lng: number;
  weather: Weather;
  terrain: Terrain;
  fuel: FuelType;
  region: string;
}

/**
 * Rate of spread in chains/hour. Rothermel-inspired multiplicative form:
 *   ROS = base · windFactor · drynessFactor · slopeFactor
 * Each factor is dimensionless and ≥ ~0.5 so ROS stays positive.
 */
function computeRos(fuel: FuelParams, w: Weather, t: Terrain): number {
  // Wind: linear acceleration with speed. ~2.8× at 30 mph.
  const windFactor = 1 + w.windSpeed * 0.06;
  // Dryness: drier air → faster. Reference RH 40%; floor at 0.5×.
  const drynessFactor = Math.max(0.5, 1 + (40 - w.humidity) / 50);
  // Slope: fire runs uphill. ~1.8× at 25° (loosely Rothermel φ_slope).
  const slopeFactor = 1 + t.slope / 30;
  return fuel.baseRosChains * windFactor * drynessFactor * slopeFactor;
}

/**
 * Byram's flame length. Classic form: L = 0.45 · I^0.46
 *   L — flame length, feet
 *   I — fireline intensity, Btu · ft⁻¹ · s⁻¹
 * Fireline intensity I = h · w · R  (heat content · fuel load · ROS)
 * Source: Byram, G.M. (1959), "Combustion of forest fuels".
 */
function byramFlameLengthFt(fuel: FuelParams, rosChainsHr: number): number {
  const rosFtPerSec = (rosChainsHr * FT_PER_CHAIN) / 3600;
  const firelineIntensity = HEAT_CONTENT_BTU_LB * fuel.fuelLoadLbFt2 * rosFtPerSec;
  return 0.45 * Math.pow(firelineIntensity, 0.46);
}

/** Composite 0-100 threat index from wind, dryness, fuel hazard and slope. */
function computeThreat(
  fuel: FuelParams,
  w: Weather,
  t: Terrain
): { index: number; label: SpreadStats['threatLabel'] } {
  const windPts = Math.min(35, (w.windSpeed / 60) * 35);
  const dryPts = Math.min(30, ((100 - w.humidity) / 100) * 30);
  const fuelPts = fuel.hazard * 20;
  const slopePts = Math.min(15, (t.slope / 40) * 15);
  const index = Math.round(Math.min(100, windPts + dryPts + fuelPts + slopePts));
  const label: SpreadStats['threatLabel'] =
    index < 30 ? 'Low' : index < 55 ? 'Moderate' : index < 78 ? 'High' : 'Extreme';
  return { index, label };
}

/** Simple hashed value-noise in [-1, 1] for organic boundary jitter. */
function noise2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return 2 * (h - Math.floor(h)) - 1;
}

/**
 * Simplified/mocked road-intersection check. Returns a count of major road
 * segments the projected burn area would cross. Deterministic per location so
 * the number is stable across recomputes. Structured so real OSM/Overpass road
 * geometry can be dropped in later (replace the body, keep the signature).
 */
function estimateRoadsAtRisk(
  lat: number,
  lng: number,
  burnAcres: number
): number {
  if (burnAcres < 40) return 0;
  const seed = Math.abs(Math.sin(lat * 51.3 + lng * 17.9) * 1000);
  const density = (seed - Math.floor(seed)) * 3; // 0-3 roads per ~1000 acres
  return Math.round((burnAcres / 1000) * (0.5 + density));
}

/**
 * Compute the full spread projection (all three horizons) plus per-step stats.
 * Called on every control change, so it must stay cheap — a single grid sweep.
 */
export function computeSpread(input: SpreadInput): SpreadResult {
  const { lat, lng, weather, terrain, fuel, region } = input;
  const fp = FUEL[fuel];

  const rosChainsHr = computeRos(fp, weather, terrain);
  const rosMPerHr = rosChainsHr * FT_PER_CHAIN * M_PER_FT;

  // Direction of travel: wind blows FROM windDirection, so fire heads the
  // opposite way. Bearing → local (east, north) unit vector.
  const travelBearing = (weather.windDirection + 180) % 360;
  const wRad = travelBearing * DEG2RAD;
  const windUnit = { x: Math.sin(wRad), y: Math.cos(wRad) };
  const windPerp = { x: -windUnit.y, y: windUnit.x };

  // Pseudo-aspect: we only know slope magnitude, not its true facing, so derive
  // a stable uphill bearing from the coordinates (documented approximation).
  const aspectBearing = (Math.abs(Math.sin(lat * 3.1 + lng * 2.7)) * 360) % 360;
  const aRad = aspectBearing * DEG2RAD;
  const uphillUnit = { x: Math.sin(aRad), y: Math.cos(aRad) };

  // Wind elongation grows the downwind axis and shrinks the backing (upwind)
  // axis. crossRatio keeps flanks narrower than the head.
  const windStrength = Math.min(1, weather.windSpeed / 45);
  const headScale = 1 + fp.windElong * windStrength * 1.6; // downwind
  const backScale = Math.max(0.25, 1 - windStrength * 0.55); // upwind
  const flankScale = Math.max(0.35, 1 - windStrength * 0.4); // crosswind
  const slopeBoost = terrain.slope / 45; // extra reach along uphill

  const points: SpreadPoint[] = [];
  const statsByStep: Record<number, SpreadStats> = {};

  // Grid extent sized to the largest (12h) head so the front always fits.
  const maxHead = rosMPerHr * 12 * headScale * (1 + slopeBoost);
  const extent = maxHead * 1.15;
  const GRID = 96; // 96×96 sweep — dense enough for a smooth heatmap, cheap.
  const cell = (extent * 2) / GRID;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(lat * DEG2RAD);

  const { index: threatIndex, label: threatLabel } = computeThreat(fp, weather, terrain);

  // Precompute per-step semi-axes (meters).
  const axesByStep = TIMESTEPS.map((t) => ({
    t,
    head: rosMPerHr * t * headScale,
    back: rosMPerHr * t * backScale,
    flank: rosMPerHr * t * flankScale,
  }));

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      // Cell center offset from ignition, in meters (east, north).
      const ex = (gx - GRID / 2 + 0.5) * cell;
      const ny = (gy - GRID / 2 + 0.5) * cell;

      const forward = ex * windUnit.x + ny * windUnit.y; // + downwind
      const lateral = ex * windPerp.x + ny * windPerp.y;
      const uphillProj = Math.max(0, ex * uphillUnit.x + ny * uphillUnit.y);

      // Organic jitter: expand/contract the local front by ±12%.
      const jitter = 1 + 0.12 * noise2(gx * 0.35, gy * 0.35);

      // Find the earliest timestep whose front contains this cell.
      let hitStep = -1;
      let bestNd = Infinity;
      for (const ax of axesByStep) {
        // Uphill lengthens the effective reach in the forward-ish direction.
        const uphillGain = 1 + slopeBoost * (uphillProj / (ax.head + 1e-6));
        const along = forward >= 0 ? ax.head * uphillGain : ax.back;
        const nd =
          Math.sqrt(
            (forward / (along * jitter)) ** 2 + (lateral / (ax.flank * jitter)) ** 2
          );
        if (nd <= 1) {
          hitStep = ax.t;
          bestNd = nd;
          break;
        }
      }
      if (hitStep < 0) continue;

      // Intensity: hottest at the core, hotter downwind, scaled by fuel hazard.
      const core = 1 - Math.min(1, bestNd);
      const downwindHeat = forward > 0 ? 0.15 : 0;
      const intensity = Math.max(
        0.05,
        Math.min(1, (0.55 * core + downwindHeat + 0.3) * (0.7 + fp.hazard * 0.3))
      );

      points.push({
        lat: lat + ny / M_PER_DEG_LAT,
        lng: lng + ex / mPerDegLon,
        intensity,
        timestepHours: hitStep,
      });
    }
  }

  // Per-step aggregate stats. Burn area uses the asymmetric-ellipse area of the
  // front: A = π · ((head + back)/2) · flank, converted m² → acres.
  const flameLengthFt = byramFlameLengthFt(fp, rosChainsHr);
  const density = densityForRegion(region);
  for (const ax of axesByStep) {
    const areaSqM = Math.PI * ((ax.head + ax.back) / 2) * ax.flank * (1 + slopeBoost * 0.5);
    const burnAreaAcres = areaSqM / SQM_PER_ACRE;
    const peopleInPath = (burnAreaAcres / ACRES_PER_SQMI) * density;
    statsByStep[ax.t] = {
      timestepHours: ax.t,
      burnAreaAcres,
      rateOfSpreadChainsHr: rosChainsHr,
      flameLengthFt,
      peopleInPath,
      roadsAtRisk: estimateRoadsAtRisk(lat, lng, burnAreaAcres),
      threatIndex,
      threatLabel,
    };
  }

  return { points, statsByStep };
}
