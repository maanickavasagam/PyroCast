"""Calibration multiplier inference for PyroCast.

Provides a single clean function that loads the trained calibration model and
returns a spread-rate multiplier for given conditions. This is the ONLY
function another file needs to import.

Usage:
    from app.models.calibration_apply import get_calibration_multiplier

    mult = get_calibration_multiplier(
        wind_speed=15.0,
        humidity=25.0,
        fuel_type="chaparral",
        region="california",
    )
    # mult ≈ 0.8 – 2.0 (spread multiplier; 1.0 = no adjustment)

The function is safe to call even if the model file is missing — it returns
1.0 (no adjustment) and logs a warning.
"""

import logging
import math
from pathlib import Path
from typing import Optional

logger = logging.getLogger("pyrocast.calibration")

MODEL_PATH = Path(__file__).resolve().parent / "calibration_model.pkl"

# Lazy-loaded singleton: the model artifact is loaded once on first call and
# reused for all subsequent calls.
_cached_artifact: Optional[dict] = None


def _load_model() -> Optional[dict]:
    """Load the model artifact from disk (once)."""
    global _cached_artifact
    if _cached_artifact is not None:
        return _cached_artifact
    if not MODEL_PATH.exists():
        logger.warning("Calibration model not found at %s — returning default multiplier.", MODEL_PATH)
        return None
    try:
        import joblib
        _cached_artifact = joblib.load(MODEL_PATH)
        logger.info("Calibration model loaded from %s", MODEL_PATH)
        return _cached_artifact
    except Exception as exc:
        logger.error("Failed to load calibration model: %s", exc)
        return None


def get_calibration_multiplier(
    wind_speed: float,
    humidity: float,
    fuel_type: str,
    region: str,
    *,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    month: Optional[int] = None,
) -> float:
    """Return a spread-rate multiplier (float, typically 0.5 – 2.5).

    Parameters
    ----------
    wind_speed : float
        Wind speed in mph.
    humidity : float
        Relative humidity (0-100 %).
    fuel_type : str
        One of 'chaparral', 'forest', 'grassland', 'urban'.
    region : str
        One of 'california', 'southeast_aus', 'mediterranean', 'amazon', 'siberia'.
        Unknown regions default to 'california' encoding.
    lat, lon : float, optional
        Coordinates — if omitted, region center is used.
    month : int, optional
        Month (1-12) — if omitted, current month is used.

    Returns
    -------
    float
        Multiplier for the CA engine's base ignition probability.
        Returns 1.0 (no adjustment) if the model is unavailable.
    """
    artifact = _load_model()
    if artifact is None:
        return 1.0

    model = artifact["model"]
    fuel_encode_map = artifact.get("fuel_encode_map", {})
    region_encode_map = artifact.get("region_encode_map", {})

    # Resolve defaults for optional parameters.
    if month is None:
        from datetime import date
        month = date.today().month

    _REGION_CENTERS = {
        "california": (37.5, -119.5),
        "southeast_aus": (-33.5, 149.0),
        "mediterranean": (40.0, 12.5),
        "amazon": (-5.0, -57.0),
        "siberia": (60.0, 110.0),
    }
    if lat is None or lon is None:
        center = _REGION_CENTERS.get(region, (37.5, -119.5))
        lat = lat if lat is not None else center[0]
        lon = lon if lon is not None else center[1]

    _FUEL_LOAD = {"chaparral": 1.4, "forest": 1.0, "grassland": 0.8, "urban": 0.0}

    fuel_key = fuel_type.strip().lower()
    month_rad = 2.0 * math.pi * month / 12.0

    # Assemble feature vector in the same order as training.
    # [lat, lon, brightness, confidence, month_sin, month_cos,
    #  fuel_encoded, fuel_load, region_encoded, wind_proxy, humidity_proxy]
    #
    # We don't have brightness/confidence at prediction time — use the median
    # training values (330 / 60) as neutral stand-ins. The model's primary
    # signal at inference time comes from wind, humidity, fuel, region, and
    # seasonality.
    features = [
        lat,
        lon,
        330.0,  # neutral brightness
        60,     # neutral confidence
        math.sin(month_rad),
        math.cos(month_rad),
        fuel_encode_map.get(fuel_key, 0),
        _FUEL_LOAD.get(fuel_key, 0.8),
        region_encode_map.get(region, 0),
        wind_speed,
        humidity,
    ]

    try:
        import numpy as np
        X = np.array([features], dtype=np.float64)
        prediction = float(model.predict(X)[0])
        # Clamp to a sane range.
        return max(0.3, min(3.0, prediction))
    except Exception as exc:
        logger.error("Calibration prediction failed: %s — returning 1.0", exc)
        return 1.0


def get_model_confidence() -> Optional[float]:
    """Return the trained model's cross-validated R² (or None if unavailable).

    Exposed so /api/simulate can report calibration confidence to the UI."""
    artifact = _load_model()
    if artifact is None:
        return None
    r2 = artifact.get("r2")
    return round(float(r2), 4) if r2 is not None else None


# ── Quick self-test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    test_cases = [
        {"wind_speed": 5.0,  "humidity": 80.0, "fuel_type": "grassland",  "region": "california"},
        {"wind_speed": 12.0, "humidity": 30.0, "fuel_type": "chaparral",  "region": "california"},
        {"wind_speed": 25.0, "humidity": 15.0, "fuel_type": "chaparral",  "region": "mediterranean"},
        {"wind_speed": 8.0,  "humidity": 50.0, "fuel_type": "forest",     "region": "amazon"},
        {"wind_speed": 30.0, "humidity": 10.0, "fuel_type": "forest",     "region": "siberia"},
        {"wind_speed": 20.0, "humidity": 20.0, "fuel_type": "grassland",  "region": "southeast_aus"},
    ]

    print("\n" + "=" * 70)
    print("  PyroCast Calibration — Inference Self-Test")
    print("=" * 70)
    print(f"  {'Wind':>5}  {'Hum':>4}  {'Fuel':<12} {'Region':<16} {'Multiplier':>10}")
    print("-" * 70)
    for tc in test_cases:
        m = get_calibration_multiplier(**tc)
        print(f"  {tc['wind_speed']:5.0f}  {tc['humidity']:4.0f}  {tc['fuel_type']:<12} {tc['region']:<16} {m:10.4f}")
    print("=" * 70 + "\n")
