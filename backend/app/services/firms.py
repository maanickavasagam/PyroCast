"""NASA FIRMS active-fire data.

Fetches worldwide VIIRS (SNPP) active-fire detections and parses the CSV into
plain dicts. Never raises: on any failure it logs and returns an empty list so
callers can treat "no data" and "failed" the same way.
"""

import csv
import io
import logging
import os

import requests

logger = logging.getLogger("pyrocast.firms")

FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY", "")
# NOTE: use the .nasa.gov hostname — it has a public DNS record everywhere,
# whereas the older firms.modaps.eosdis.gov alias fails to resolve on some
# networks (verified: same API, same key, .nasa.gov returns HTTP 200).
FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/world/{days}"


def _normalize_confidence(raw: str):
    """FIRMS confidence is 'l'/'n'/'h' for VIIRS or a 0-100 number. Return the
    raw string for categorical values, or an int when numeric."""
    s = (raw or "").strip().lower()
    if s in ("l", "n", "h"):
        return s
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return s


def _fetch_window(days: int):
    """Single FIRMS request for the last `days` days. Returns a list (possibly
    empty) of parsed fire dicts, or raises on a hard request/parse failure."""
    url = FIRMS_URL.format(key=FIRMS_MAP_KEY, days=days)
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    text = resp.text

    # FIRMS occasionally returns an error string instead of CSV.
    if not text or "," not in text.splitlines()[0]:
        raise ValueError(f"unexpected payload: {text[:200]!r}")

    reader = csv.DictReader(io.StringIO(text))
    fires = []
    for row in reader:
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, ValueError, TypeError):
            continue
        # VIIRS brightness column is bright_ti4; MODIS uses brightness.
        brightness = row.get("bright_ti4") or row.get("brightness") or ""
        try:
            brightness = float(brightness)
        except (ValueError, TypeError):
            brightness = None
        fires.append(
            {
                "lat": lat,
                "lon": lon,
                "brightness": brightness,
                "confidence": _normalize_confidence(row.get("confidence", "")),
                "acq_date": row.get("acq_date", ""),
            }
        )
    return fires


def get_active_fires(days: int = 1):
    """Return a list of {lat, lon, brightness, confidence, acq_date} dicts.

    NASA's most-recent ~24h window ("days=1") is occasionally empty simply
    because that day's satellite passes haven't finished processing yet on
    NASA's side (observed: VIIRS_SNPP/NOAA20 AND MODIS all return 0 rows for
    days=1 while days=3 returns 100k+ rows at the same moment) — this is a
    genuine upstream publishing lag, not a request failure. So if the
    requested window comes back empty, we retry once with a 3-day window
    before giving up, rather than immediately falling back to EONET/synthetic.

    On missing key or any request/parse failure, log and return []."""
    if not FIRMS_MAP_KEY:
        logger.warning("FIRMS_MAP_KEY not set - returning no active fires.")
        return []

    try:
        fires = _fetch_window(days)
        if not fires and days < 3:
            logger.info(
                "FIRMS returned 0 rows for days=%d (likely today's data not yet "
                "published) — retrying with a 3-day window.", days,
            )
            fires = _fetch_window(3)
        logger.info("FIRMS: parsed %d active-fire detections.", len(fires))
        return fires
    except Exception as exc:  # noqa: BLE001 - never crash on data fetch
        # Mask the map key if it appears in the exception's URL.
        msg = str(exc).replace(FIRMS_MAP_KEY, "***") if FIRMS_MAP_KEY else str(exc)
        logger.error("FIRMS request failed: %s", msg)
        return []
