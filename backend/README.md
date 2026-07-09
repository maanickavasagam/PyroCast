# PyroCast Backend

FastAPI wildfire spread-prediction API. Client-side-free: it fetches live public
data (NASA FIRMS, OpenWeatherMap, Open-Elevation) and runs a cellular-automaton
spread model with numpy. Every external call degrades gracefully to a fallback,
so the API never crashes when a key is missing or a service is down.

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS/Linux
pip install -r requirements.txt

cp .env.example .env               # then add your keys (optional)
uvicorn app.main:app --reload
```

Server runs at http://127.0.0.1:8000 (interactive docs at `/docs`).

Without keys the API still works fully on synthetic/fallback data — responses
carry `"data_source": "simulated"`.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/global-fires?days=1` | Active fires; FIRMS with automatic NASA EONET fallback |
| GET | `/api/weather?lat=&lon=` | Current weather (fallback dict if no key) |
| POST | `/api/simulate` | Full spread simulation (see below) |

### GET /api/global-fires

Prefers NASA FIRMS (raw VIIRS thermal detections). If FIRMS is unreachable —
e.g. on a network that filters the `*.modaps.eosdis.gov` domain — it falls back
to **NASA EONET** (`eonet.gsfc.nasa.gov`), a key-less API of curated open
wildfire events, normalized to the same fire-dict shape. The response `source`
field is `"firms"`, `"eonet"`, or `"none"`:

```json
{
  "count": 500,
  "source": "eonet",
  "fires": [
    {"lat": 43.83, "lon": -111.96, "brightness": null, "confidence": null,
     "acq_date": "2026-07-06", "title": "Wildfire Maze, Madison, Idaho"}
  ]
}
```

EONET does not report brightness/confidence (returned as `null`) and adds a
`title` naming the event.

### POST /api/simulate

Request body:

```json
{
  "lat": 38.5,
  "lon": -122.4,
  "wind_direction": 270,
  "wind_speed": 20,
  "fuel_type": "chaparral",
  "humidity": 25
}
```

`humidity` is optional — omit it to pull the live value from OpenWeatherMap.
`fuel_type` is one of: `chaparral` / `brush`, `forest` / `coniferous`,
`grassland` / `grass`, `urban` / `water`.

Response:

```json
{
  "threat_index": {"label": "High", "score": 62.8},
  "burn_area_acres": [64.25, 190.27, 407.72, 731.43],
  "rate_of_spread_ch_per_h": 4.02,
  "flame_length_ft": 8.5,
  "heatmap_frames": [
    {"timestep": 0, "points": [{"lat": 38.48, "lng": -122.39, "intensity": 1.0}]}
  ],
  "data_source": "live"
}
```

## Model overview

- `services/firms.py` — FIRMS CSV → list of detections (`csv` module, no deps).
- `services/eonet.py` — NASA EONET open-wildfire events, key-less FIRMS fallback.
- `services/weather.py` — OpenWeatherMap current conditions, m/s → mph.
- `services/elevation.py` — Open-Elevation batched grid lookup → numpy array.
- `services/terrain.py` — synthetic vegetation + fuel-load grid via randomized
  flood-fill.
- `models/ca_engine.py` — 8-neighbor cellular automaton; spread probability from
  wind alignment, uphill slope, fuel load, humidity dampening.
- `models/fire_metrics.py` — Byram flame length, rate of spread (chains/hr),
  weighted threat index.

> Note: live API calls require outbound HTTPS with a valid certificate store. On
> networks behind a TLS-inspecting proxy the external calls fall back to
> synthetic data (logged clearly); the model output is unaffected.
