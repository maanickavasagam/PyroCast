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


class SimulateRequest(BaseModel):
    lat: float
    lon: float
    wind_direction: float
    wind_speed: float
    fuel_type: str = "chaparral"
    humidity: float | None = None


@app.get("/")
def root():
    return {"service": "PyroCast API", "status": "ok"}


# Small in-memory cache for the global fire feed. Active-fire data changes on
# the order of hours, and the upstream sources (esp. EONET) can be slow/flaky,
# so caching keeps repeated page loads instant and rides over transient blips by
# serving the last good result.
import time  # noqa: E402

_FIRES_CACHE: dict = {"at": 0.0, "payload": None}
_FIRES_TTL_S = 180


@app.get("/api/global-fires")
def global_fires(days: int = 1):
    # Serve a fresh cached result if we have one.
    now = time.time()
    if _FIRES_CACHE["payload"] and (now - _FIRES_CACHE["at"]) < _FIRES_TTL_S:
        return _FIRES_CACHE["payload"]

    # Prefer FIRMS (raw thermal detections); fall back to NASA EONET (curated
    # open wildfire events) when FIRMS is unreachable — e.g. on networks that
    # filter the *.modaps.eosdis.gov domain. `source` tells the caller which
    # dataset the response came from.
    fires = get_active_fires(days=days)
    source = "firms"
    if not fires:
        fires = get_active_fires_eonet()
        source = "eonet" if fires else "none"

    if fires:
        payload = {"count": len(fires), "source": source, "fires": fires}
        _FIRES_CACHE.update(at=now, payload=payload)
        return payload

    # Nothing live this time — serve a stale cache if we have one rather than
    # forcing the client to synthetic.
    if _FIRES_CACHE["payload"]:
        return _FIRES_CACHE["payload"]
    return {"count": 0, "source": "none", "fires": []}


@app.get("/api/weather")
def weather(lat: float, lon: float):
    return get_current_weather(lat, lon)


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

    # 4. Run the CA spread from the grid center.
    ignition = (RESOLUTION // 2, RESOLUTION // 2)
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
    )

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

    return {
        "threat_index": threat_index,
        "burn_area_acres": result["burned_acres"],
        "rate_of_spread_ch_per_h": rate_of_spread,
        "flame_length_ft": flame_length_ft,
        "heatmap_frames": heatmap_frames,
        "data_source": data_source,
    }
