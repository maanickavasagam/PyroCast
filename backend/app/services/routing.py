"""Real evacuation routing via OSRM (public, key-less routing engine).

Given an ignition point, finds the nearest known town from a small curated
list of real settlements near PyroCast's watch regions, then asks the public
OSRM demo server (router.project-osrm.org) for an actual driving route along
the real road network. OSRM snaps both endpoints to the nearest road, so even
though our ignition point is not literally "on a road", the result is a real,
drivable route — not a fabricated line.

Never raises: on any failure (network, no route found) returns None so the
caller can omit the field entirely rather than show a fabricated route.
"""

import logging
import math

import requests

logger = logging.getLogger("pyrocast.routing")

OSRM_URL = "https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}"

# Curated real towns/cities near PyroCast's watch regions, used as evacuation
# destinations. Not exhaustive — for an ignition point far from all of these,
# the nearest one is still used, so the route may be long; that's disclosed
# via distance_km in the response rather than hidden.
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


def _nearest_safe_town(lat: float, lon: float) -> dict:
    return min(SAFE_TOWNS, key=lambda t: _haversine_km(lat, lon, t["lat"], t["lon"]))


def get_evacuation_route(lat: float, lon: float) -> dict | None:
    """Return a real driving route from (lat, lon) to the nearest known safe
    town, or None if OSRM is unreachable / no route exists.

    Shape: {
      destination_name: str,
      distance_km: float,
      duration_min: float,
      geometry: [[lat, lon], ...],   # decoded route polyline, road-network path
    }
    """
    town = _nearest_safe_town(lat, lon)
    url = OSRM_URL.format(lon1=lon, lat1=lat, lon2=town["lon"], lat2=town["lat"])
    try:
        resp = requests.get(
            url, params={"overview": "full", "geometries": "geojson"}, timeout=15
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            raise ValueError(f"OSRM returned code={data.get('code')}")

        route = data["routes"][0]
        coords = route["geometry"]["coordinates"]  # [[lon, lat], ...]
        geometry = [[c[1], c[0]] for c in coords]  # → [lat, lon] for the frontend

        return {
            "destination_name": town["name"],
            "distance_km": round(route["distance"] / 1000.0, 1),
            "duration_min": round(route["duration"] / 60.0, 1),
            "geometry": geometry,
        }
    except Exception as exc:  # noqa: BLE001 - never crash the simulate response
        logger.error("OSRM routing failed: %s", exc)
        return None
