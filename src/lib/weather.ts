import type { Weather } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// OpenWeatherMap current conditions.
//
// Get a free API key at https://home.openweathermap.org/api_keys and set it as
// VITE_OWM_KEY in a .env file (or replace the DEMO_KEY placeholder below).
// On any failure the code returns a plausible, clearly-flagged synthetic reading
// derived deterministically from the coordinates so the UI never shows an empty
// state.
// ─────────────────────────────────────────────────────────────────────────────

const OWM_KEY = import.meta.env.VITE_OWM_KEY ?? 'DEMO_KEY';

const msToMph = (ms: number) => ms * 2.23694;
const kToF = (k: number) => (k - 273.15) * (9 / 5) + 32;

/** Fetch live weather for a coordinate. Returns { weather, simulated }. */
export async function fetchWeather(
  lat: number,
  lon: number
): Promise<{ weather: Weather; simulated: boolean }> {
  if (OWM_KEY === 'DEMO_KEY') {
    return { weather: syntheticWeather(lat, lon), simulated: true };
  }
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OWM HTTP ${res.status}`);
    const data = await res.json();
    const weather: Weather = {
      windSpeed: Math.round(msToMph(data.wind?.speed ?? 0)),
      windDirection: Math.round(data.wind?.deg ?? 0),
      humidity: Math.round(data.main?.humidity ?? 30),
      temperature: Math.round(kToF(data.main?.temp ?? 295)),
    };
    return { weather, simulated: false };
  } catch (err) {
    console.warn('[OWM] falling back to simulated weather:', err);
    return { weather: syntheticWeather(lat, lon), simulated: true };
  }
}

/**
 * Deterministic synthetic weather: fire-season-plausible conditions (gusty,
 * dry) that vary smoothly with location so different regions read differently.
 */
export function syntheticWeather(lat: number, lon: number): Weather {
  const h = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453);
  const frac = h - Math.floor(h);
  return {
    windSpeed: Math.round(8 + frac * 26), // 8-34 mph
    // Normalize into [0, 360) — JS % keeps the dividend's sign for negative lon.
    windDirection: Math.round((((frac * 360 + lon * 3) % 360) + 360) % 360),
    humidity: Math.round(12 + frac * 28), // 12-40% — dry
    temperature: Math.round(78 + frac * 22), // 78-100 °F
  };
}
