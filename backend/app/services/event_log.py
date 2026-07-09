"""Persistent, timestamped environmental/simulation event log.

Appends one JSON object per line (JSONL) to a log file — simple, dependency-free,
and greppable/replayable. Every /api/simulate call logs its inputs and outputs
with a UTC ISO-8601 timestamp, so runs are auditable after the fact and the log
file itself is a growing dataset (e.g. for a future calibration retrain).

Never raises: a logging failure must not break the simulation response.
"""

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("pyrocast.event_log")

LOG_PATH = Path(__file__).resolve().parent.parent / "logs" / "simulation_events.jsonl"
_write_lock = threading.Lock()


def log_simulation_event(inputs: dict[str, Any], outputs: dict[str, Any]) -> None:
    """Append one timestamped JSONL record: {timestamp, inputs, outputs}."""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "inputs": inputs,
        "outputs": outputs,
    }
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _write_lock:
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, default=str) + "\n")
    except Exception as exc:  # noqa: BLE001 - logging must never break the request
        logger.error("Failed to write simulation event log: %s", exc)


def read_recent_events(limit: int = 50) -> list[dict[str, Any]]:
    """Return the most recent `limit` logged events (newest last), or [] if
    the log doesn't exist yet or fails to read."""
    if not LOG_PATH.exists():
        return []
    try:
        with open(LOG_PATH, encoding="utf-8") as f:
            lines = f.readlines()[-limit:]
        return [json.loads(line) for line in lines if line.strip()]
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to read simulation event log: %s", exc)
        return []
