# PyroCast

Real-time wildfire **spread prediction & impact** dashboard. Live public data,
a client-side cellular-automata-style spread model, and a MapLibre dark map —
no backend required.

```bash
npm install
npm run dev
```

Open the printed local URL (default http://localhost:5173).

## Data sources

All data is fetched directly in the browser and isolated in `src/lib/` behind
clean function signatures, so a backend can be swapped in later without touching
UI components. Every source degrades gracefully to a clearly-labeled synthetic
dataset (a muted "simulated data" tag appears) if a key is missing or a request
fails.

| Source | File | Live key |
| --- | --- | --- |
| NASA FIRMS active fires (VIIRS) | `src/lib/firms.ts` | `VITE_FIRMS_KEY` |
| OpenWeatherMap current conditions | `src/lib/weather.ts` | `VITE_OWM_KEY` |
| Open-Elevation terrain / slope | `src/lib/elevation.ts` | none |

To use live data, copy `.env.example` to `.env` and add free keys:

- FIRMS map key: https://firms.modaps.eosdis.gov/api/map_key/
- OpenWeatherMap key: https://home.openweathermap.org/api_keys

## Spread model

`src/lib/spread.ts` implements a lightweight, fully-documented estimator:

- **Rate of spread** — a Rothermel-inspired product of fuel, wind, dryness and
  slope factors.
- **Front geometry** — an anisotropic (elliptical) front elongated downwind and
  pushed uphill, sampled on a grid with stochastic boundary jitter (a simplified
  cellular-automaton front) at +3h / +6h / +12h.
- **Byram flame length** — `L = 0.45 · I^0.46` with fireline intensity from
  fuel load × heat content × ROS.
- **Impact** — burn area (acres), people in path (from regional population
  density), and a mocked road-intersection check structured for real OSM data.

It is intentionally *not* research-grade — it is directionally correct and
explainable.

## Views

- **World View** — dark world map, FIRMS detections + pulsing fire fronts and
  amber high-risk markers, collapsible watch-location panel.
- **Region View** — three-zone layout: scenario controls (wind / fuel, live-
  seeded, adjustable), a heatmap map with a forecast timeline scrubber, and an
  impact panel. Both side panels collapse independently to slim rails.
