import type { Weather } from '../types';

/**
 * Derive whether a location is "high-risk, no fire yet" purely from weather.
 * Heuristic: high wind + low humidity (dry-season fire-weather signature).
 * Returns a 0-100 pre-ignition risk score and a boolean flag.
 */
export function preIgnitionRisk(w: Weather): { score: number; flagged: boolean } {
  const windPts = Math.min(50, (w.windSpeed / 45) * 50);
  const dryPts = Math.min(50, ((50 - w.humidity) / 50) * 50);
  const score = Math.round(Math.max(0, windPts + dryPts));
  return { score, flagged: score >= 55 };
}
