"""Shared helpers for the Phase 2 health services: what "now" means, time windows, astronaut checks.

"Now" for health data is mission time, not wall-clock time. By default it is the current
mission time of a simulation run (RUN-DEMO-001 unless another run is named), so moving the
simulation clock moves every dashboard. An explicit `at` timestamp overrides it.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.services import mission_simulator
from app.utils.timestamps import parse_iso, to_iso

MAX_RAW_WINDOW_DAYS = 31  # hourly rows: 31 days x 24 h = 744 points per series


def parse_time_param(value: str | None, name: str) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        return parse_iso(value)
    except ValueError as exc:
        raise ValidationFailed(f"{name} must be an ISO-8601 UTC time, e.g. 2027-03-15T08:00:00Z") from exc


def resolve_as_of(conn: sqlite3.Connection, at: str | None = None,
                  simulation_run_id: str | None = None) -> datetime:
    """The mission time a health view describes."""
    explicit = parse_time_param(at, "at")
    if explicit is not None:
        return explicit
    run_id = simulation_run_id or get_settings().default_template_run_id
    return parse_iso(mission_simulator.get_simulation_state(conn, run_id)["current_mission_time"])


def resolve_range(start: str | None, end: str | None, as_of: datetime,
                  default_days: int) -> tuple[datetime, datetime]:
    """[start, end] window. Defaults to the `default_days` before as_of."""
    end_dt = parse_time_param(end, "end") or as_of
    start_dt = parse_time_param(start, "start") or end_dt - timedelta(days=default_days)
    if start_dt > end_dt:
        raise ValidationFailed("start must not be after end")
    return start_dt, end_dt


def mission_launch(conn: sqlite3.Connection, mission_id: str = "MIS-001") -> datetime:
    row = conn.execute("SELECT launch_date FROM missions WHERE mission_id = ?", (mission_id,)).fetchone()
    if row is None:
        raise NotFound(f"Mission {mission_id} not found")
    return parse_iso(row["launch_date"])


def require_astronaut(conn: sqlite3.Connection, astronaut_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM astronauts WHERE astronaut_id = ?", (astronaut_id,)).fetchone()
    if row is None:
        raise NotFound(f"Astronaut {astronaut_id} not found")
    return row


def window_dict(start: datetime, end: datetime) -> dict:
    return {"start": to_iso(start), "end": to_iso(end)}
