"""OpenWeatherMap current-conditions lookup.

Returns wind/humidity/temperature normalized to the units the spread model and
UI expect. Never raises: on failure it returns a plausible hardcoded fallback
and reports (via the "fallback" flag) that live data was unavailable.
"""

import logging
import os

import requests

logger = logging.getLogger("pyrocast.weather")

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
OWM_URL = "https://api.openweathermap.org/data/2.5/weather"

MS_TO_MPH = 2.23694

# Fire-season-plausible fallback (warm, dry, breezy).
_FALLBACK = {
    "wind_speed_mph": 12.0,
    "wind_direction_deg": 0.0,
    "humidity_pct": 30.0,
    "temp_c": 28.0,
    "fallback": True,
}


def get_current_weather(lat: float, lon: float):
    """Return {wind_speed_mph, wind_direction_deg, humidity_pct, temp_c, fallback}.

    `fallback` is True when the hardcoded default was used (drives data_source)."""
    if not OPENWEATHER_API_KEY:
        logger.warning("OPENWEATHER_API_KEY not set - using fallback weather.")
        return dict(_FALLBACK)

    try:
        resp = requests.get(
            OWM_URL,
            params={
                "lat": lat,
                "lon": lon,
                "appid": OPENWEATHER_API_KEY,
                "units": "metric",  # temp in C, wind in m/s
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        wind = data.get("wind", {})
        main = data.get("main", {})
        return {
            "wind_speed_mph": round(float(wind.get("speed", 0.0)) * MS_TO_MPH, 1),
            "wind_direction_deg": float(wind.get("deg", 0.0)),
            "humidity_pct": float(main.get("humidity", 30.0)),
            "temp_c": float(main.get("temp", 20.0)),
            "fallback": False,
        }
    except Exception as exc:  # noqa: BLE001 - never crash
        logger.error("OpenWeatherMap request failed: %s - using fallback.", exc)
        return dict(_FALLBACK)
