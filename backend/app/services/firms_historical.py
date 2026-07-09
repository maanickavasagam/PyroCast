"""NASA FIRMS historical fire data for ML calibration training.

Fetches archive / near-real-time VIIRS fire detections for specific regions
and date ranges. Reuses the same FIRMS_MAP_KEY auth pattern as firms.py.

The FIRMS archive endpoint supports area queries by bounding box and date
range (up to 10 days per request). We chunk the requested period into 10-day
windows and concatenate the results.

Used by train_calibration.py to build the feature matrix — NOT imported by
main.py or any request-handling code.
"""

import csv
import io
import logging
import os
from dataclasses import dataclass
from datetime import date, timedelta
from typing import List, Optional

import requests

logger = logging.getLogger("pyrocast.firms_historical")

FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY", "")

# FIRMS area CSV endpoint for archive data.
# Format: /api/area/csv/{key}/{source}/{bbox}/{days_or_daterange}
FIRMS_AREA_URL = (
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/{bbox}/{date_range}"
)

# ── Predefined wildfire-prone regions ────────────────────────────────────────

@dataclass
class Region:
    name: str
    bbox: str  # "west,south,east,north" — FIRMS expects this order
    lat_center: float
    lon_center: float


REGIONS: List[Region] = [
    Region("california",     "-124.5,32.5,-114.1,42.0",   37.5, -119.5),
    Region("southeast_aus",  "144.0,-39.0,154.0,-28.0",  -33.5,  149.0),
    Region("mediterranean",  "-5.0,35.0,30.0,45.0",       40.0,   12.5),
    Region("amazon",         "-70.0,-15.0,-44.0,  5.0",   -5.0,  -57.0),
    Region("siberia",        " 80.0,50.0,140.0,70.0",     60.0,  110.0),
]


def _parse_firms_csv(text: str, region_name: str) -> list[dict]:
    """Parse a FIRMS CSV response into a list of structured records."""
    if not text or "," not in text.splitlines()[0]:
        return []
    reader = csv.DictReader(io.StringIO(text))
    records = []
    for row in reader:
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, ValueError, TypeError):
            continue

        brightness_raw = row.get("bright_ti4") or row.get("brightness") or ""
        try:
            brightness = float(brightness_raw)
        except (ValueError, TypeError):
            brightness = None

        conf_raw = (row.get("confidence") or "").strip().lower()
        if conf_raw == "l":
            confidence = 25
        elif conf_raw == "n":
            confidence = 60
        elif conf_raw == "h":
            confidence = 90
        else:
            try:
                confidence = int(float(conf_raw))
            except (ValueError, TypeError):
                confidence = 50

        acq_date = row.get("acq_date", "")
        frp_raw = row.get("frp") or ""
        try:
            frp = float(frp_raw)
        except (ValueError, TypeError):
            frp = None

        records.append({
            "lat": lat,
            "lon": lon,
            "brightness": brightness,
            "confidence": confidence,
            "acq_date": acq_date,
            "frp": frp,  # fire radiative power — strong proxy for intensity
            "region": region_name,
        })
    return records


def fetch_historical_fires(
    region: Region,
    start_date: date,
    end_date: date,
    timeout: int = 30,
) -> list[dict]:
    """Fetch FIRMS archive detections for a bounding-box region over a date range.

    The FIRMS API allows up to 10 days per request, so we chunk the range
    accordingly. Returns a flat list of detection dicts.
    """
    if not FIRMS_MAP_KEY:
        logger.warning("FIRMS_MAP_KEY not set — cannot fetch historical data.")
        return []

    all_records: list[dict] = []
    chunk_start = start_date

    while chunk_start <= end_date:
        chunk_end = min(chunk_start + timedelta(days=9), end_date)
        date_range = f"{chunk_start.isoformat()}/{chunk_end.isoformat()}"
        url = FIRMS_AREA_URL.format(
            key=FIRMS_MAP_KEY,
            bbox=region.bbox.replace(" ", ""),
            date_range=date_range,
        )
        try:
            resp = requests.get(url, timeout=timeout)
            resp.raise_for_status()
            records = _parse_firms_csv(resp.text, region.name)
            all_records.extend(records)
            logger.info(
                "FIRMS historical: %s %s → %d detections",
                region.name, date_range, len(records),
            )
        except Exception as exc:
            safe = str(exc).replace(FIRMS_MAP_KEY, "***") if FIRMS_MAP_KEY else str(exc)
            logger.error("FIRMS historical fetch failed (%s %s): %s", region.name, date_range, safe)

        chunk_start = chunk_end + timedelta(days=1)

    return all_records


def fetch_all_regions(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    regions: Optional[List[Region]] = None,
) -> list[dict]:
    """Convenience wrapper: fetch historical data for multiple regions.

    Defaults to the past 30 days and all 5 predefined wildfire-prone regions.
    """
    if end_date is None:
        end_date = date.today() - timedelta(days=1)
    if start_date is None:
        start_date = end_date - timedelta(days=29)
    if regions is None:
        regions = REGIONS

    all_records: list[dict] = []
    for reg in regions:
        records = fetch_historical_fires(reg, start_date, end_date)
        all_records.extend(records)
        logger.info("Region %s: %d total detections", reg.name, len(records))

    logger.info("All regions: %d total detections fetched", len(all_records))
    return all_records
