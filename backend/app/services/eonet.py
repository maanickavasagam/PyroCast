"""NASA EONET active-wildfire fallback.

EONET (Earth Observatory Natural Event Tracker) is a free, key-less REST API of
curated open natural events. We use its wildfire category as a fallback for
FIRMS: same access pattern (HTTPS GET → JSON), different host
(eonet.gsfc.nasa.gov), so it stays reachable on networks that filter the
FIRMS `*.modaps.eosdis.gov` domain.

Output is normalized to the SAME dict shape as `firms.get_active_fires` so the
`/api/global-fires` route and any consumer can treat the two sources
interchangeably (EONET simply has no brightness/confidence, so those are None).
Never raises: on any failure it logs and returns an empty list.
"""

import logging

import requests

logger = logging.getLogger("pyrocast.eonet")

EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"


def get_active_fires_eonet(limit: int = 300, status: str = "open"):
    """Return a list of {lat, lon, brightness, confidence, acq_date, title} dicts.

    Uses the most recent geometry point of each open wildfire event as its
    current location. On any failure, logs and returns []."""
    try:
        resp = requests.get(
            EONET_URL,
            params={"category": "wildfires", "status": status, "limit": limit},
            timeout=12,
        )
        resp.raise_for_status()
        events = resp.json().get("events", [])

        fires = []
        for ev in events:
            geometry = ev.get("geometry") or []
            if not geometry:
                continue
            latest = geometry[-1]  # most recent track point
            coords = latest.get("coordinates")
            # Wildfire geometries are points [lon, lat]; skip anything else.
            if not (isinstance(coords, list) and len(coords) == 2):
                continue
            lon, lat = coords[0], coords[1]
            try:
                lat = float(lat)
                lon = float(lon)
            except (TypeError, ValueError):
                continue
            date = (latest.get("date") or "")[:10]
            fires.append(
                {
                    "lat": lat,
                    "lon": lon,
                    "brightness": None,  # EONET does not report brightness
                    "confidence": None,  # nor confidence
                    "acq_date": date,
                    "title": ev.get("title", ""),
                }
            )
        logger.info("EONET fallback: parsed %d open wildfire events.", len(fires))
        return fires
    except Exception as exc:  # noqa: BLE001 - never crash
        logger.error("EONET request failed: %s", exc)
        return []
