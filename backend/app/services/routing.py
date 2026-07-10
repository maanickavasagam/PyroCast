"""Real evacuation routing via OSRM (public, key-less routing engine).

Two strategies, in order:
  1. If a curated real safe town is within MAX_REASONABLE_DISTANCE_KM, route
     there (nice named destinations for the US/Europe/Australia demo regions).
  2. Otherwise — which is the common case for live global fire clusters in
     Africa, Siberia, the Amazon, etc. — compute an evacuation point ~25 km
     UPWIND of the fire (the direction the wind is coming from, i.e. away from
     where the fire is spreading), reverse-geocode a place name for it via the
     key-less OSM Nominatim service, and route there. This works ANYWHERE on
     Earth and is physically sensible (evacuate away from the fire's path).

Either way OSRM snaps the endpoints to the real road network, so the result is
a genuine drivable route, not a fabricated straight line.

Never raises: on any failure returns None so the caller can omit the field
entirely rather than show a fabricated route.
"""

import logging
import math

import requests

logger = logging.getLogger("pyrocast.routing")

OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
# Nominatim's usage policy requires an identifying User-Agent.
NOMINATIM_HEADERS = {"User-Agent": "PyroCast/1.0 (wildfire dashboard)"}

# Prefer a named curated town only if it's within this distance; otherwise fall
# back to the global upwind strategy.
MAX_REASONABLE_DISTANCE_KM = 400.0
# How far upwind to place the evacuation target when using the global strategy.
UPWIND_EVAC_KM = 25.0

# Curated real towns near PyroCast's original demo regions — used only when one
# happens to be close to the fire; global clusters use the upwind strategy.
SAFE_TOWNS = [
    {"name": "Pasadena, CA", "lat": 34.1478, "lon": -118.1445},
    {"name": "Redding, CA", "lat": 40.5865, "lon": -122.3917},
    {"name": "Agoura Hills, CA", "lat": 34.1367, "lon": -118.7595},
    {"name": "Boulder, CO", "lat": 40.0150, "lon": -105.2705},
    {"name": "Blue River, OR", "lat": 44.1698, "lon": -122.3334},
    {"name": "Payson, AZ", "lat": 34.2311, "lon": -111.3245},
    {"name": "Fredericksburg, TX", "lat": 30.2752, "lon": -98.8719},
    {"name": "Nea Makri, Greece", "lat": 38.0897, "lon": 23.9847},
    {"name": "Katoomba, NSW", "lat": -33.7137, "lon": 150.3119},
    {"name": "Seia, Portugal", "lat": 40.4167, "lon": -7.7000},
]


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _nearest_safe_town(lat: float, lon: float) -> tuple[dict, float]:
    town = min(SAFE_TOWNS, key=lambda t: _haversine_km(lat, lon, t["lat"], t["lon"]))
    return town, _haversine_km(lat, lon, town["lat"], town["lon"])


def _destination_point(lat: float, lon: float, bearing_deg: float, distance_km: float) -> tuple[float, float]:
    """Forward geodesic: point `distance_km` from (lat, lon) along `bearing_deg`."""
    r = 6371.0
    br = math.radians(bearing_deg)
    p1 = math.radians(lat)
    l1 = math.radians(lon)
    dr = distance_km / r
    p2 = math.asin(math.sin(p1) * math.cos(dr) + math.cos(p1) * math.sin(dr) * math.cos(br))
    l2 = l1 + math.atan2(
        math.sin(br) * math.sin(dr) * math.cos(p1),
        math.cos(dr) - math.sin(p1) * math.sin(p2),
    )
    return math.degrees(p2), math.degrees(l2)


def _cardinal(bearing_deg: float) -> str:
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return dirs[round((bearing_deg % 360) / 45) % 8]


def _reverse_geocode_name(lat: float, lon: float) -> str | None:
    """Return a human place name for a coordinate via OSM Nominatim, or None."""
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lon, "format": "json", "zoom": 12},
            headers=NOMINATIM_HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        addr = resp.json().get("address", {})
        # Prefer the most specific populated-place field available.
        for key in ("city", "town", "village", "hamlet", "municipality", "county", "state"):
            if addr.get(key):
                region = addr.get("country")
                return f"{addr[key]}, {region}" if region else addr[key]
        return resp.json().get("display_name", "").split(",")[0] or None
    except Exception as exc:  # noqa: BLE001
        logger.info("Reverse geocode failed (%s) — using generic destination name.", exc)
        return None


def _osrm_route(lat1: float, lon1: float, lat2: float, lon2: float, name: str) -> dict | None:
    """Ask OSRM for a driving route and shape it for the frontend, or None."""
    url = OSRM_URL.format(lon1=lon1, lat1=lat1, lon2=lon2, lat2=lat2)
    try:
        resp = requests.get(url, params={"overview": "full", "geometries": "geojson"}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            raise ValueError(f"OSRM returned code={data.get('code')}")
        route = data["routes"][0]
        coords = route["geometry"]["coordinates"]  # [[lon, lat], ...]
        geometry = [[c[1], c[0]] for c in coords]  # → [lat, lon] for the frontend
        return {
            "destination_name": name,
            "distance_km": round(route["distance"] / 1000.0, 1),
            "duration_min": round(route["duration"] / 60.0, 1),
            "geometry": geometry,
        }
    except Exception as exc:  # noqa: BLE001 - never crash the simulate response
        logger.error("OSRM routing failed: %s", exc)
        return None


def get_evacuation_route(lat: float, lon: float, wind_direction: float | None = None) -> dict | None:
    """Return a real driving evacuation route from (lat, lon), or None on failure.

    Uses a nearby curated town if one is within MAX_REASONABLE_DISTANCE_KM;
    otherwise routes ~UPWIND_EVAC_KM upwind of the fire (works globally).

    Shape: {destination_name, distance_km, duration_min, geometry:[[lat,lon],...]}
    """
    town, straight_line_km = _nearest_safe_town(lat, lon)

    # Strategy 1: a real named town is genuinely nearby.
    if straight_line_km <= MAX_REASONABLE_DISTANCE_KM:
        return _osrm_route(lat, lon, town["lat"], town["lon"], town["name"])

    # Strategy 2: global upwind evacuation point. Wind blows FROM wind_direction,
    # so upwind (away from the fire's spread) IS the wind_direction bearing.
    bearing = wind_direction if wind_direction is not None else 0.0
    dest_lat, dest_lon = _destination_point(lat, lon, bearing, UPWIND_EVAC_KM)
    name = _reverse_geocode_name(dest_lat, dest_lon)
    if not name:
        name = f"Safe zone (~{UPWIND_EVAC_KM:.0f} km {_cardinal(bearing)}, upwind)"
    logger.info("Global upwind evacuation route → %s", name)
    return _osrm_route(lat, lon, dest_lat, dest_lon, name)
