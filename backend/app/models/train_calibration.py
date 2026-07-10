"""ML calibration model for PyroCast spread-rate prediction.

Feature-engineers NASA FIRMS historical fire data into training samples and
fits a HistGradientBoostingRegressor predicting a spread-rate multiplier.

The model captures how real-world fire behavior (proxied by FIRMS brightness
and FRP) varies with seasonal weather proxies, fuel type, and regional
conditions — producing a calibration multiplier that the CA engine can
optionally apply to its base ignition probability.

Run standalone:
    cd backend
    python -m app.models.train_calibration

Outputs:
    app/models/calibration_model.pkl   (joblib-serialized model + metadata)
    R² and MAE printed to stdout
"""

import logging
import math
import os
import sys
from datetime import date, timedelta
from pathlib import Path

# Windows consoles default stdout to cp1252, which can't encode arrows/superscripts
# etc. and crashes a print AFTER the (expensive) training/fetch work is done.
# Force UTF-8 so no future print statement here can lose a training run.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

# Trust the OS certificate store so outbound HTTPS (FIRMS, Open Topo Data)
# works behind a TLS-inspecting proxy. This script is run standalone
# (`python -m app.models.train_calibration`), not through main.py, so it needs
# its own injection rather than relying on main.py's.
try:
    import truststore

    truststore.inject_into_ssl()
except Exception:  # noqa: BLE001 - if unavailable, fall back to certifi
    pass

import numpy as np

logger = logging.getLogger("pyrocast.train_calibration")

# ── Resolve project paths ────────────────────────────────────────────────────
# When run as `python -m app.models.train_calibration` from the backend/ dir,
# the project root is already on sys.path. But we ensure it just in case.
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

MODEL_PATH = Path(__file__).resolve().parent / "calibration_model.pkl"


# ── Seasonal weather proxy ───────────────────────────────────────────────────
# We don't have weather at the time of each historic detection, so we derive
# rough proxies from latitude + month. This is intentionally coarse — the
# model's value is in capturing regional/seasonal patterns, not in replicating
# exact weather.

def _seasonal_proxy(lat: float, month: int) -> dict:
    """Return rough wind-speed and humidity proxies from lat & month."""
    # Southern hemisphere: fire season ≈ Oct-Mar; Northern: Jun-Oct.
    southern = lat < 0
    if southern:
        fire_month_dist = min(abs(month - 1), abs(month - 12))  # peak Jan
    else:
        fire_month_dist = abs(month - 8)  # peak Aug
    seasonality = max(0.0, 1.0 - fire_month_dist / 5.0)  # 0..1

    # Wind: higher in fire season, modulated by absolute latitude.
    wind_proxy = 8.0 + seasonality * 18.0 + abs(lat) / 90.0 * 5.0

    # Humidity: lower in fire season.
    humidity_proxy = 60.0 - seasonality * 40.0 + abs(lat) / 90.0 * 10.0
    humidity_proxy = max(10.0, min(95.0, humidity_proxy))

    return {"wind_speed": round(wind_proxy, 1), "humidity": round(humidity_proxy, 1)}


# ── Fuel type inference from region ──────────────────────────────────────────
_REGION_FUEL = {
    "california": "chaparral",
    "southeast_aus": "grassland",
    "mediterranean": "chaparral",
    "amazon": "forest",
    "siberia": "forest",
}

_FUEL_ENCODE = {
    "chaparral": 0,
    "forest": 1,
    "grassland": 2,
    "urban": 3,
}

# Fuel load multiplier matching the CA engine's terrain.py
_FUEL_LOAD = {
    "chaparral": 1.4,
    "forest": 1.0,
    "grassland": 0.8,
    "urban": 0.0,
}


# ── Feature engineering ──────────────────────────────────────────────────────

def _month_from_acq_date(acq_date: str) -> int:
    """Extract month from 'YYYY-MM-DD' string. Defaults to 7 on failure."""
    try:
        return int(acq_date.split("-")[1])
    except (IndexError, ValueError, TypeError):
        return 7


def _region_encode(region_name: str) -> int:
    _MAP = {"california": 0, "southeast_aus": 1, "mediterranean": 2, "amazon": 3, "siberia": 4}
    return _MAP.get(region_name, 0)


def build_features(
    records: list[dict],
    elevations: dict[tuple[float, float], float] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Build (X, y) from FIRMS detection records.

    Features (per record):
        0  lat
        1  lon
        2  brightness
        3  confidence
        4  month_sin   — sin(2π·month/12) for cyclical encoding
        5  month_cos   — cos(2π·month/12)
        6  fuel_encoded — int label for fuel type
        7  fuel_load   — numeric multiplier
        8  region_encoded — int label for region
        9  wind_proxy  — seasonal wind estimate
       10  humidity_proxy — seasonal humidity estimate
       11  elevation    — REAL elevation in meters (Open Topo Data), or the
                           batch's mean elevation if this point's lookup failed
       12  slope_proxy  — this point's elevation deviation from its region's
                           mean elevation, /1000 and clamped to [0, 1]. This is
                           NOT a true terrain gradient (that needs neighbor
                           sampling, which isn't affordable per-record at this
                           volume) — it's a real-data-derived ruggedness proxy:
                           points far from their region's typical elevation
                           (ridgelines, canyons) score higher than flat plains.

    Target:
        A "spread multiplier" derived from brightness + FRP relative to a
        baseline. This represents how much faster/slower a fire at that
        location/time burns compared to the CA engine's default.
    """
    X_list: list[list[float]] = []
    y_list: list[float] = []

    # Compute baseline brightness for normalization.
    brightnesses = [r["brightness"] for r in records if r.get("brightness") is not None]
    base_brightness = float(np.median(brightnesses)) if brightnesses else 330.0

    # Per-region mean elevation, for the slope proxy and as a fallback when a
    # specific point's elevation lookup failed.
    elevations = elevations or {}
    region_elevs: dict[str, list[float]] = {}
    for rec in records:
        key = (round(rec["lat"], 3), round(rec["lon"], 3))
        elev = elevations.get(key)
        if elev is not None:
            region_elevs.setdefault(rec.get("region", "california"), []).append(elev)
    region_mean_elev = {
        region: float(np.mean(vals)) for region, vals in region_elevs.items() if vals
    }
    overall_mean_elev = float(np.mean([e for vals in region_elevs.values() for e in vals])) if region_elevs else 500.0

    for rec in records:
        brightness = rec.get("brightness")
        if brightness is None or brightness < 200:
            continue  # skip non-thermal / garbage

        month = _month_from_acq_date(rec.get("acq_date", ""))
        region = rec.get("region", "california")
        fuel_type = _REGION_FUEL.get(region, "chaparral")
        proxy = _seasonal_proxy(rec["lat"], month)

        month_rad = 2.0 * math.pi * month / 12.0

        key = (round(rec["lat"], 3), round(rec["lon"], 3))
        region_mean = region_mean_elev.get(region, overall_mean_elev)
        elevation = elevations.get(key, region_mean)
        slope_proxy = max(0.0, min(1.0, abs(elevation - region_mean) / 1000.0))

        features = [
            rec["lat"],
            rec["lon"],
            brightness,
            rec.get("confidence", 50),
            math.sin(month_rad),
            math.cos(month_rad),
            _FUEL_ENCODE.get(fuel_type, 0),
            _FUEL_LOAD.get(fuel_type, 0.8),
            _region_encode(region),
            proxy["wind_speed"],
            proxy["humidity"],
            elevation,
            slope_proxy,
        ]
        X_list.append(features)

        # Target: spread multiplier. Fires brighter than baseline → multiplier > 1.
        # FRP, when available, adds a secondary signal.
        brightness_ratio = brightness / base_brightness
        frp = rec.get("frp")
        if frp is not None and frp > 0:
            # Normalize FRP: ~50 MW is median for moderate detections
            frp_factor = 1.0 + (frp - 50.0) / 200.0
            frp_factor = max(0.3, min(3.0, frp_factor))
        else:
            frp_factor = 1.0

        multiplier = 0.5 * brightness_ratio + 0.5 * frp_factor
        multiplier = max(0.3, min(3.0, multiplier))
        y_list.append(multiplier)

    return np.array(X_list, dtype=np.float64), np.array(y_list, dtype=np.float64)


# ── Synthetic training data (offline fallback) ───────────────────────────────
# If FIRMS is unreachable or the key is missing, we generate plausible
# synthetic records so the model can still be trained and demonstrated.

def _generate_synthetic_records(n: int = 5000, seed: int = 42) -> list[dict]:
    """Generate synthetic FIRMS-like records covering all 5 regions."""
    rng = np.random.default_rng(seed)
    from app.services.firms_historical import REGIONS

    records: list[dict] = []
    per_region = n // len(REGIONS)

    for region in REGIONS:
        fuel_type = _REGION_FUEL.get(region.name, "chaparral")
        fuel_load = _FUEL_LOAD.get(fuel_type, 0.8)

        for _ in range(per_region):
            # Random month, biased toward fire season
            if region.lat_center < 0:  # southern hemisphere
                month = int(rng.choice([10, 11, 12, 1, 2, 3], p=[0.1, 0.2, 0.25, 0.25, 0.15, 0.05]))
            else:
                month = int(rng.choice([5, 6, 7, 8, 9, 10], p=[0.05, 0.15, 0.25, 0.25, 0.2, 0.1]))

            lat = region.lat_center + rng.normal(0, 3.0)
            lon = region.lon_center + rng.normal(0, 3.0)

            proxy = _seasonal_proxy(lat, month)

            # Simulate brightness from conditions (higher wind + lower humidity → brighter)
            base = 310.0 + fuel_load * 30.0
            wind_effect = proxy["wind_speed"] / 25.0 * 20.0
            humidity_effect = (100.0 - proxy["humidity"]) / 100.0 * 25.0
            noise = rng.normal(0, 15)
            brightness = max(280.0, base + wind_effect + humidity_effect + noise)

            # FRP correlated with brightness
            frp = max(1.0, (brightness - 300.0) * 0.8 + rng.normal(10, 15))

            confidence = int(rng.choice([25, 60, 90], p=[0.15, 0.50, 0.35]))

            records.append({
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "brightness": round(brightness, 1),
                "confidence": confidence,
                "acq_date": f"2025-{month:02d}-{rng.integers(1, 29):02d}",
                "frp": round(frp, 1),
                "region": region.name,
            })

    logger.info("Generated %d synthetic training records", len(records))
    return records


# ── Training ─────────────────────────────────────────────────────────────────

def train_model(records: list[dict] | None = None, use_live: bool = True):
    """Train the calibration model and save to MODEL_PATH.

    If `records` is None:
      - Tries to fetch live FIRMS data when `use_live=True`
      - Falls back to synthetic data if FIRMS is unavailable
    """
    import joblib
    from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
    from sklearn.model_selection import cross_val_score

    # ── 1. Get training data ─────────────────────────────────────────────
    used_live = False
    if records is None:
        if use_live:
            try:
                # Load .env for the FIRMS key
                from dotenv import load_dotenv
                load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

                from app.services.firms_historical import fetch_all_regions
                end = date.today() - timedelta(days=1)
                start = end - timedelta(days=29)
                records = fetch_all_regions(start_date=start, end_date=end)
                if records:
                    used_live = True
            except Exception as exc:
                logger.warning("Live FIRMS fetch failed (%s) — using synthetic data.", exc)
                records = None

        if not records:
            logger.info("Using synthetic training data.")
            records = _generate_synthetic_records()

    # ── 2. Real elevation lookup (only worth the network cost for real FIRMS
    #    detections — synthetic records have no real place to look up). ─────
    elevations: dict[tuple[float, float], float] = {}
    if used_live:
        from app.services.elevation import get_elevations_for_points

        points = [(r["lat"], r["lon"]) for r in records]
        elevations = get_elevations_for_points(points)

    # ── 3. Feature engineering ───────────────────────────────────────────
    X, y = build_features(records, elevations=elevations)
    if len(X) < 50:
        logger.error("Too few usable records (%d) — need at least 50. Aborting.", len(X))
        return None

    logger.info("Training set: %d samples, %d features (live_data=%s)", X.shape[0], X.shape[1], used_live)

    # ── 4. Train + cross-validate BOTH model types, keep the better one ──
    candidates = {
        "HistGradientBoostingRegressor": HistGradientBoostingRegressor(
            max_iter=200, max_depth=6, learning_rate=0.05, min_samples_leaf=20, random_state=42,
        ),
        "RandomForestRegressor": RandomForestRegressor(
            n_estimators=300, max_depth=10, min_samples_leaf=10, random_state=42, n_jobs=-1,
        ),
    }

    results = {}
    for name, candidate in candidates.items():
        r2_scores = cross_val_score(candidate, X, y, cv=5, scoring="r2")
        mae_scores = cross_val_score(candidate, X, y, cv=5, scoring="neg_mean_absolute_error")
        results[name] = {
            "r2": float(np.mean(r2_scores)),
            "r2_folds": r2_scores,
            "mae": float(-np.mean(mae_scores)),
            "mae_folds": -mae_scores,
        }

    best_name = max(results, key=lambda n: results[n]["r2"])
    model = candidates[best_name]
    model.fit(X, y)  # final fit on all data for the saved artifact

    r2_mean = results[best_name]["r2"]
    mae_mean = results[best_name]["mae"]

    print("\n" + "=" * 60)
    print("  PyroCast ML Calibration — Training Results")
    print("=" * 60)
    print(f"  Samples:          {X.shape[0]:,}")
    print(f"  Features:         {X.shape[1]}")
    print(f"  Training data:    {'LIVE FIRMS' if used_live else 'synthetic'}")
    print("-" * 60)
    for name, r in results.items():
        marker = "  <- selected" if name == best_name else ""
        print(f"  {name}{marker}")
        print(f"    R² (5-fold CV):  {r['r2']:.4f}  (per fold: {', '.join(f'{s:.3f}' for s in r['r2_folds'])})")
        print(f"    MAE (5-fold CV): {r['mae']:.4f}  (per fold: {', '.join(f'{s:.3f}' for s in r['mae_folds'])})")
    print("=" * 60)

    # ── 5. Save ──────────────────────────────────────────────────────────
    feature_names = [
        "lat", "lon", "brightness", "confidence",
        "month_sin", "month_cos", "fuel_encoded", "fuel_load",
        "region_encoded", "wind_proxy", "humidity_proxy",
        "elevation", "slope_proxy",
    ]
    artifact = {
        "model": model,
        "model_name": best_name,
        "feature_names": feature_names,
        "fuel_encode_map": _FUEL_ENCODE,
        "region_encode_map": {"california": 0, "southeast_aus": 1, "mediterranean": 2, "amazon": 3, "siberia": 4},
        "r2": r2_mean,
        "mae": mae_mean,
        "n_samples": int(X.shape[0]),
        "used_live_data": used_live,
    }
    joblib.dump(artifact, MODEL_PATH)
    print(f"\n  Model saved -> {MODEL_PATH}  ({best_name})")
    print(f"  Artifact keys: {list(artifact.keys())}\n")

    return artifact


# ── CLI entry point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    train_model()
