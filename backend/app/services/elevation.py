"""Open Topo Data terrain sampling.

Uses the free public Open Topo Data API (https://www.opentopodata.org/), which is
more reliable than Open-Elevation. The public server allows up to 100 locations
per request and ~1 request/second, so instead of querying all
`resolution x resolution` points we fetch a coarse grid (<=100 points, one
request) and bilinearly upsample it to the requested resolution. Slope over a
few-km box is captured fine at the coarse spacing.

On any failure, returns a flat zero grid (logged clearly) so the CA engine just
sees no slope.
"""

import logging
import os

import numpy as np
import requests

logger = logging.getLogger("pyrocast.elevation")

# srtm30m: 30 m SRTM, global coverage -60..60 lat (covers virtually all wildfire
# regions). Override with OPENTOPODATA_DATASET if desired.
DATASET = os.getenv("OPENTOPODATA_DATASET", "srtm30m")
OPENTOPO_URL = f"https://api.opentopodata.org/v1/{DATASET}"

# Public server hard limit is 100 locations/request; keep the sampled grid at or
# below 10x10 = 100 so one request covers it.
MAX_SAMPLE_RES = 10


def _resize_bilinear(arr: np.ndarray, out_rows: int, out_cols: int) -> np.ndarray:
    """Separable bilinear resize of a 2D array (no scipy dependency)."""
    in_rows, in_cols = arr.shape
    if (in_rows, in_cols) == (out_rows, out_cols):
        return arr
    # Interpolate along columns first, then rows.
    col_src = np.linspace(0, in_cols - 1, in_cols)
    col_dst = np.linspace(0, in_cols - 1, out_cols)
    tmp = np.vstack([np.interp(col_dst, col_src, arr[r, :]) for r in range(in_rows)])
    row_src = np.linspace(0, in_rows - 1, in_rows)
    row_dst = np.linspace(0, in_rows - 1, out_rows)
    out = np.column_stack([np.interp(row_dst, row_src, tmp[:, c]) for c in range(out_cols)])
    return out


def get_elevation_grid(lat_min, lat_max, lon_min, lon_max, resolution: int = 15):
    """Return a (resolution x resolution) numpy array of elevations in meters.

    Row 0 = lat_min (south), last row = lat_max (north);
    col 0 = lon_min (west), last col = lon_max (east).
    On any failure, returns a flat zero grid of the requested shape."""
    sample_res = min(resolution, MAX_SAMPLE_RES)
    lats = np.linspace(lat_min, lat_max, sample_res)
    lons = np.linspace(lon_min, lon_max, sample_res)

    # Row-major list of "lat,lon" strings for the coarse sample grid.
    loc_str = "|".join(f"{la:.6f},{lo:.6f}" for la in lats for lo in lons)

    try:
        resp = requests.get(OPENTOPO_URL, params={"locations": loc_str}, timeout=25)
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") != "OK":
            raise ValueError(f"Open Topo Data status={payload.get('status')}: {payload.get('error')}")
        results = payload.get("results", [])
        if len(results) != sample_res * sample_res:
            raise ValueError("Open Topo Data returned mismatched result count")

        elevations = [
            float(r["elevation"]) if r.get("elevation") is not None else 0.0 for r in results
        ]
        coarse = np.array(elevations, dtype=float).reshape(sample_res, sample_res)
        grid = _resize_bilinear(coarse, resolution, resolution)
        logger.info(
            "Elevation grid %dx%d from Open Topo Data (%s): min=%.0f max=%.0f m.",
            resolution,
            resolution,
            DATASET,
            grid.min(),
            grid.max(),
        )
        return grid
    except Exception as exc:  # noqa: BLE001 - never crash
        logger.error("Open Topo Data failed: %s - using flat zero grid.", exc)
        return np.zeros((resolution, resolution), dtype=float)
