"""PyroCast backend API.

Endpoints:
  GET  /api/global-fires        active FIRMS detections
  GET  /api/weather?lat=&lon=   current weather for a coordinate
  POST /api/simulate            run the full spread simulation

Run:  uvicorn app.main:app --reload
"""

import logging
import math

# Trust the OS certificate store so outbound HTTPS works behind a TLS-inspecting
# proxy (whose root CA is in the OS store but not in certifi's bundle). Must run
# before any requests/SSL connections are made.
try:
    import truststore

    truststore.inject_into_ssl()
except Exception:  # noqa: BLE001 - if unavailable, fall back to certifi
    pass

# Load .env BEFORE importing service modules (they read env at import time).
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.services.firms import get_active_fires  # noqa: E402
from app.services.eonet import get_active_fires_eonet  # noqa: E402
from app.services.weather import get_current_weather  # noqa: E402
from app.services.elevation import get_elevation_grid  # noqa: E402
from app.services.terrain import (  # noqa: E402
    FUEL_MULTIPLIER,
    FUEL_TYPE_TO_VEG,
    generate_vegetation_grid,
)
from app.models.ca_engine import simulate_spread  # noqa: E402
from app.models.fire_metrics import (  # noqa: E402
    calculate_flame_length,
    calculate_rate_of_spread,
    calculate_threat_index,
)
from app.models.calibration_apply import (  # noqa: E402
    get_calibration_multiplier,
    get_model_confidence,
    get_prediction_uncertainty,
)
from app.services.event_log import log_simulation_event, read_recent_events  # noqa: E402
from app.services.routing import get_evacuation_route  # noqa: E402
from app.services.summarizer import summarize_incident  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("pyrocast.main")

app = FastAPI(title="PyroCast API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simulation grid configuration. 25x25 gives the CA room to keep growing across
# all four timesteps before reaching the grid edge.
RESOLUTION = 25
CELL_SIZE_M = 100.0
TIMESTEPS = 4
HOURS_PER_STEP = 3
M_PER_DEG_LAT = 111_320.0


def _calibration_region(lat: float, lon: float) -> str:
    """Crude lat/lon → training-region mapping for the calibration model.
    Unknown areas fall back to 'california' (the model's default encoding)."""
    if 32 <= lat <= 42 and -125 <= lon <= -114:
        return "california"
    if -39 <= lat <= -28 and 144 <= lon <= 154:
        return "southeast_aus"
    if 35 <= lat <= 45 and -5 <= lon <= 30:
        return "mediterranean"
    if -15 <= lat <= 5 and -70 <= lon <= -44:
        return "amazon"
    if 50 <= lat <= 70 and 80 <= lon <= 140:
        return "siberia"
    return "california"


class SimulateRequest(BaseModel):
    lat: float
    lon: float
    wind_direction: float
    wind_speed: float
    fuel_type: str = "chaparral"
    humidity: float | None = None


class SummarizeRequest(BaseModel):
    """Body is the JSON already returned by /api/simulate, plus a display name."""
    simulation: dict
    location_name: str = "the affected area"


@app.get("/")
def root():
    return {"service": "PyroCast API", "status": "ok"}


# Small in-memory cache for the global fire feed, keyed per source so FIRMS and
# EONET can each be fetched and cached independently — this is what lets the
# frontend toggle between them instantly instead of only ever seeing whichever
# one the automatic fallback picked. Active-fire data changes on the order of
# hours, and the upstream sources (esp. EONET) can be slow/flaky, so caching
# keeps repeated requests instant and rides over transient blips.
import time  # noqa: E402

_FIRES_CACHE: dict[str, dict] = {
    "firms": {"at": 0.0, "payload": None},
    "eonet": {"at": 0.0, "payload": None},
}
_FIRES_TTL_S = 180


def _cached_or_fetch(key: str, fetch_fn, days: int) -> tuple[list, bool]:
    """Return (fires, from_cache) for one specific source, using its own
    cache slot. Falls back to a stale cache entry if the fresh fetch is empty."""
    now = time.time()
    slot = _FIRES_CACHE[key]
    if slot["payload"] is not None and (now - slot["at"]) < _FIRES_TTL_S:
        return slot["payload"], True

    fires = fetch_fn(days) if key == "firms" else fetch_fn()
    if fires:
        slot.update(at=now, payload=fires)
        return fires, False

    # Nothing live this time — serve a stale cache if we have one.
    if slot["payload"] is not None:
        return slot["payload"], True
    return [], False


@app.get("/api/global-fires")
def global_fires(days: int = 1, source: str = "auto"):
    """Active fires.

    `source` selects the feed explicitly:
      - "firms" — NASA FIRMS raw thermal detections only
      - "eonet" — NASA EONET curated open wildfire events only
      - "auto"  — (default) prefer FIRMS, fall back to EONET if unreachable
    Explicit "firms"/"eonet" never falls back to the other — an empty result
    is returned as-is (with source reflecting what was actually returned) so
    the frontend can show its own "unavailable" state rather than silently
    switching feeds under the user.
    """
    source = source.lower().strip()

    if source == "firms":
        fires, _ = _cached_or_fetch("firms", get_active_fires, days)
        return {"count": len(fires), "source": "firms" if fires else "none", "fires": fires}

    if source == "eonet":
        fires, _ = _cached_or_fetch("eonet", get_active_fires_eonet, days)
        return {"count": len(fires), "source": "eonet" if fires else "none", "fires": fires}

    # auto: prefer FIRMS, fall back to EONET.
    fires, _ = _cached_or_fetch("firms", get_active_fires, days)
    if fires:
        return {"count": len(fires), "source": "firms", "fires": fires}

    fires, _ = _cached_or_fetch("eonet", get_active_fires_eonet, days)
    return {"count": len(fires), "source": "eonet" if fires else "none", "fires": fires}


@app.get("/api/weather")
def weather(lat: float, lon: float):
    return get_current_weather(lat, lon)


@app.get("/api/logs")
def logs(limit: int = 40):
    """Recent timestamped environmental/simulation log entries (newest last).

    Reads the persistent JSONL event log written on every /api/simulate call —
    lets the frontend surface the 'log environmental data with timestamps'
    requirement instead of it living only in a server-side file.
    """
    events = read_recent_events(limit=limit)
    return {"count": len(events), "events": events}


@app.post("/api/simulate")
def simulate(req: SimulateRequest):
    # 1. Resolve humidity — use live weather when the caller didn't supply it.
    data_source = "simulated"
    if req.humidity is not None:
        humidity = req.humidity
    else:
        wx = get_current_weather(req.lat, req.lon)
        humidity = wx["humidity_pct"]
        data_source = "simulated" if wx["fallback"] else "live"

    # 2. Bounding box sized so grid spacing ≈ CELL_SIZE_M.
    total_m = RESOLUTION * CELL_SIZE_M
    half_lat = (total_m / 2.0) / M_PER_DEG_LAT
    half_lon = (total_m / 2.0) / (M_PER_DEG_LAT * max(0.1, math.cos(math.radians(req.lat))))
    lat_min, lat_max = req.lat - half_lat, req.lat + half_lat
    lon_min, lon_max = req.lon - half_lon, req.lon + half_lon

    # 3. Terrain: elevation grid (live/fallback) + synthetic vegetation/fuel.
    elevation_grid = get_elevation_grid(lat_min, lat_max, lon_min, lon_max, RESOLUTION)
    dominant = FUEL_TYPE_TO_VEG.get(req.fuel_type.strip().lower())
    veg_grid, fuel_grid = generate_vegetation_grid(RESOLUTION, RESOLUTION, dominant=dominant)

    # 4. Run the CA spread from the grid center, scaled by the ML calibration
    #    multiplier (1.0 if the model is unavailable — never blocks the sim).
    #    Elevation/slope come from the SAME grid already fetched above — real
    #    values, not neutral defaults, for any model trained with them.
    ignition_r, ignition_c = RESOLUTION // 2, RESOLUTION // 2
    ignition_elevation = float(elevation_grid[ignition_r, ignition_c])
    grid_slope_proxy = max(0.0, min(1.0, float(elevation_grid.std()) / 200.0))
    calibration = get_calibration_multiplier(
        wind_speed=req.wind_speed,
        humidity=humidity,
        fuel_type=req.fuel_type.strip().lower(),
        region=_calibration_region(req.lat, req.lon),
        lat=req.lat,
        lon=req.lon,
        elevation=ignition_elevation,
        slope_proxy=grid_slope_proxy,
    )
    ignition = (ignition_r, ignition_c)
    result = simulate_spread(
        elevation_grid=elevation_grid,
        vegetation_grid=veg_grid,
        fuel_grid=fuel_grid,
        ignition_point=ignition,
        wind_speed=req.wind_speed,
        wind_direction=req.wind_direction,
        humidity=humidity,
        timesteps=TIMESTEPS,
        hours_per_step=HOURS_PER_STEP,
        cell_size_m=CELL_SIZE_M,
        calibration=calibration,
    )

    # 4b. Per-prediction confidence band: re-run the SAME CA engine (same
    # elevation/fuel grids, same random seed) at the calibration model's
    # MAE-bounded low/high multipliers. This gives a real computed burn-area
    # range grounded in the model's reported error, rather than a guessed or
    # linearly-scaled number.
    uncertainty = get_prediction_uncertainty(calibration)
    burn_area_low = burn_area_high = None
    if uncertainty is not None:
        result_low = simulate_spread(
            elevation_grid=elevation_grid,
            vegetation_grid=veg_grid,
            fuel_grid=fuel_grid,
            ignition_point=ignition,
            wind_speed=req.wind_speed,
            wind_direction=req.wind_direction,
            humidity=humidity,
            timesteps=TIMESTEPS,
            hours_per_step=HOURS_PER_STEP,
            cell_size_m=CELL_SIZE_M,
            calibration=uncertainty["multiplier_low"],
        )
        result_high = simulate_spread(
            elevation_grid=elevation_grid,
            vegetation_grid=veg_grid,
            fuel_grid=fuel_grid,
            ignition_point=ignition,
            wind_speed=req.wind_speed,
            wind_direction=req.wind_direction,
            humidity=humidity,
            timesteps=TIMESTEPS,
            hours_per_step=HOURS_PER_STEP,
            cell_size_m=CELL_SIZE_M,
            calibration=uncertainty["multiplier_high"],
        )
        burn_area_low = result_low["burned_acres"]
        burn_area_high = result_high["burned_acres"]

    # 5. Metrics. Representative fuel load = dominant type's multiplier, or the
    #    mean of burnable cells if the dominant is non-burnable/unknown.
    if dominant is not None and FUEL_MULTIPLIER.get(dominant, 0) > 0:
        fuel_load = FUEL_MULTIPLIER[dominant]
    else:
        burnable = fuel_grid[fuel_grid > 0]
        fuel_load = float(burnable.mean()) if burnable.size else 0.8

    flame_length_ft = calculate_flame_length(fuel_load, req.wind_speed, humidity)
    rate_of_spread = calculate_rate_of_spread(
        result["burned_counts"], CELL_SIZE_M, HOURS_PER_STEP
    )
    threat_index = calculate_threat_index(req.wind_speed, humidity, fuel_load)

    # 5b. Real evacuation route (OSRM), None if unreachable — never fabricated.
    evacuation_route = get_evacuation_route(req.lat, req.lon, wind_direction=req.wind_direction)

    # 6. Convert grid snapshots to lat/lng heatmap frames.
    rows, cols = RESOLUTION, RESOLUTION
    heatmap_frames = []
    for t, snapshot in enumerate(result["snapshots"]):
        points = []
        for r in range(rows):
            lat = lat_min + (r / (rows - 1)) * (lat_max - lat_min)
            for c in range(cols):
                cell = snapshot[r, c]
                if cell < 1:
                    continue
                lng = lon_min + (c / (cols - 1)) * (lon_max - lon_min)
                intensity = 1.0 if cell == 1 else 0.55  # active front vs burned
                points.append({"lat": round(lat, 6), "lng": round(lng, 6), "intensity": intensity})
        heatmap_frames.append({"timestep": t, "points": points})

    response = {
        "threat_index": threat_index,
        "burn_area_acres": result["burned_acres"],
        "rate_of_spread_ch_per_h": rate_of_spread,
        "flame_length_ft": flame_length_ft,
        "heatmap_frames": heatmap_frames,
        "data_source": data_source,
        # Additive fields — existing consumers are unaffected.
        "model_confidence": get_model_confidence(),
        "calibration_multiplier": round(calibration, 4),
        # Per-prediction uncertainty band (None if the calibration model or its
        # MAE is unavailable — never a fabricated placeholder).
        "burn_area_acres_low": burn_area_low,
        "burn_area_acres_high": burn_area_high,
        # None if OSRM is unreachable — the frontend must handle absence, not
        # a fabricated fallback route.
        "evacuation_route": evacuation_route,
    }

    log_simulation_event(
        inputs={
            "lat": req.lat,
            "lon": req.lon,
            "wind_direction": req.wind_direction,
            "wind_speed": req.wind_speed,
            "fuel_type": req.fuel_type,
            "humidity": humidity,
        },
        outputs={
            "threat_index": threat_index,
            "burn_area_acres": result["burned_acres"],
            "rate_of_spread_ch_per_h": rate_of_spread,
            "flame_length_ft": flame_length_ft,
            "data_source": data_source,
            "model_confidence": response["model_confidence"],
            "calibration_multiplier": response["calibration_multiplier"],
        },
    )

    return response


@app.post("/api/summarize")
def summarize(req: SummarizeRequest):
    """Generate a short AI incident brief from a completed /api/simulate result.

    Kept as a separate, optional endpoint (rather than folded into /api/simulate)
    since it depends on a third-party LLM and is slower — the frontend can call
    it lazily after the map/stats are already showing.
    """
    summary = summarize_incident(req.simulation, req.location_name)
    return {"summary": summary}
