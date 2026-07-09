"""AI incident-brief summarizer via Google Gemini.

Takes a completed /api/simulate result and produces a short, plain-English
incident brief for a wildfire commander — the kind of 3-4 sentence readout
you'd want at the top of a dashboard before diving into the numbers.

Uses the free-tier Gemini API directly over HTTPS (no SDK dependency beyond
`requests`, which the rest of this backend already uses). Never raises: on any
failure (missing key, network, quota) returns None so the caller can omit the
field entirely rather than show a fabricated summary.
"""

import logging
import os

import requests

logger = logging.getLogger("pyrocast.summarizer")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)


def _build_prompt(sim: dict, location_name: str) -> str:
    threat = sim.get("threat_index", {})
    burn = sim.get("burn_area_acres", [])
    route = sim.get("evacuation_route")

    lines = [
        "You are a wildfire incident analyst. Write a concise 3-4 sentence "
        "incident brief for a fire commander based on this simulation output. "
        "Plain English, no markdown, no bullet points, no headers — just prose. "
        "Lead with the threat level and what it means operationally.",
        "",
        f"Location: {location_name}",
        f"Threat level: {threat.get('label', 'unknown')} (score {threat.get('score', '?')}/100)",
        f"Projected burn area by +12h: {burn[-1] if burn else 'unknown'} acres",
        f"Rate of spread: {sim.get('rate_of_spread_ch_per_h', '?')} chains/hour",
        f"Flame length: {sim.get('flame_length_ft', '?')} ft",
        f"Data source: {sim.get('data_source', 'unknown')}",
    ]
    if route:
        lines.append(
            f"Nearest evacuation route: {route['distance_km']} km to "
            f"{route['destination_name']} (~{route['duration_min']} min drive)"
        )
    return "\n".join(lines)


def summarize_incident(sim: dict, location_name: str = "the affected area") -> str | None:
    """Return a short AI-generated incident brief, or None if unavailable.

    `sim` is the dict returned by /api/simulate (before the JSON response is
    sent back to the client) — this is called with that same dict."""
    if not GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY not set — skipping incident summary.")
        return None

    prompt = _build_prompt(sim, location_name)
    try:
        # NOTE: external calls on this network can take 40-80s+ (observed
        # consistently across FIRMS/OSRM/Open Topo Data too) — a short timeout
        # here would misfire before Gemini actually responds.
        resp = requests.post(
            GEMINI_URL,
            params={"key": GEMINI_API_KEY},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=100,
        )
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise ValueError("Gemini returned no candidates")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            raise ValueError("Gemini returned empty text")
        return text
    except Exception as exc:  # noqa: BLE001 - never crash the simulate response
        logger.error("Gemini summarization failed: %s", exc)
        return None
