"""Cabin environment (plan section 3, Phase 2): CO2, temperature, humidity, pressure.

These are cabin-wide readings (no astronaut). They are shown as trend and status cards.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from typing import Any

from app.core.errors import ValidationFailed
from app.services import mission_simulator
from app.services.health_context import MAX_RAW_WINDOW_DAYS, window_dict
from app.utils.statistics import describe
from app.utils.timestamps import parse_iso, to_iso

STALE_AFTER = timedelta(hours=2)

ENVIRONMENT = {
    "cabin_co2": {"label": "Cabin CO2", "unit": "ppm"},
    "cabin_temperature": {"label": "Cabin temperature", "unit": "degC"},
    "cabin_humidity": {"label": "Cabin humidity", "unit": "percent"},
    "cabin_pressure": {"label": "Cabin pressure", "unit": "kPa"},
}


def _check_type(measurement_type: str) -> None:
    if measurement_type not in ENVIRONMENT:
        raise ValidationFailed(f"measurement_type must be one of {sorted(ENVIRONMENT)}")


def get_current_environment(conn: sqlite3.Connection, as_of: datetime, mission_id: str = "MIS-001") -> dict[str, Any]:
    cards = []
    for mtype, meta in ENVIRONMENT.items():
        row = conn.execute(
            """SELECT timestamp_utc, measurement_value, measurement_unit, location, sensor_id
               FROM environment_readings WHERE mission_id = ? AND measurement_type = ?
                 AND quality_status = 'valid' AND timestamp_utc <= ?
               ORDER BY timestamp_utc DESC LIMIT 1""",
            (mission_id, mtype, to_iso(as_of))).fetchone()
        if row is None:
            cards.append({"measurement_type": mtype, **meta, "value": None, "status": "no_data"})
            continue
        age = as_of - parse_iso(row["timestamp_utc"])
        cards.append({"measurement_type": mtype, "label": meta["label"], "unit": row["measurement_unit"],
                      "value": row["measurement_value"], "timestamp_utc": row["timestamp_utc"],
                      "location": row["location"], "sensor_id": row["sensor_id"],
                      "status": "stale" if age > STALE_AFTER else "current"})
    return {"mission_id": mission_id, "as_of": to_iso(as_of), "readings": cards}


def get_environment_history(conn: sqlite3.Connection, measurement_type: str, start: datetime, end: datetime,
                            resolution: str = "daily", mission_id: str = "MIS-001") -> dict[str, Any]:
    _check_type(measurement_type)
    params = (mission_id, measurement_type, to_iso(start), to_iso(end))
    if resolution == "hourly":
        if end - start > timedelta(days=MAX_RAW_WINDOW_DAYS):
            raise ValidationFailed(f"hourly history is limited to {MAX_RAW_WINDOW_DAYS} days; use resolution=daily")
        points = [dict(r) for r in conn.execute(
            """SELECT timestamp_utc, measurement_value AS value FROM environment_readings
               WHERE mission_id = ? AND measurement_type = ? AND quality_status = 'valid'
                 AND timestamp_utc BETWEEN ? AND ? ORDER BY timestamp_utc""", params)]
    elif resolution == "daily":
        points = [dict(r) for r in conn.execute(
            """SELECT substr(timestamp_utc, 1, 10) AS day, ROUND(AVG(measurement_value), 3) AS mean,
                      MIN(measurement_value) AS min, MAX(measurement_value) AS max, COUNT(*) AS n
               FROM environment_readings
               WHERE mission_id = ? AND measurement_type = ? AND quality_status = 'valid'
                 AND timestamp_utc BETWEEN ? AND ? GROUP BY day ORDER BY day""", params)]
    else:
        raise ValidationFailed("resolution must be 'hourly' or 'daily'")
    return {"measurement_type": measurement_type, "unit": ENVIRONMENT[measurement_type]["unit"],
            "resolution": resolution, "window": window_dict(start, end), "points": points}


def calculate_environment_averages(conn: sqlite3.Connection, start: datetime, end: datetime,
                                   mission_id: str = "MIS-001") -> dict[str, Any]:
    out = []
    for mtype, meta in ENVIRONMENT.items():
        values = [r[0] for r in conn.execute(
            """SELECT measurement_value FROM environment_readings
               WHERE mission_id = ? AND measurement_type = ? AND quality_status = 'valid'
                 AND timestamp_utc BETWEEN ? AND ?""", (mission_id, mtype, to_iso(start), to_iso(end)))]
        out.append({"measurement_type": mtype, **meta, **describe(values)})
    return {"mission_id": mission_id, "window": window_dict(start, end), "averages": out}


def identify_environment_scenario_events(conn: sqlite3.Connection, simulation_run_id: str, start: datetime,
                                         end: datetime) -> dict[str, Any]:
    """Scenario events in the window, each with that day's cabin averages next to the window average.

    Lets a dashboard show, e.g., whether CO2 was higher on 'high workload' days. Descriptive only.
    """
    events = [e for e in mission_simulator.get_simulation_events(conn, simulation_run_id)
              if e["event_timestamp"] and to_iso(start) <= e["event_timestamp"] <= to_iso(end)]
    window_avg = {a["measurement_type"]: a["mean"]
                  for a in calculate_environment_averages(conn, start, end)["averages"]}
    out = []
    for e in events:
        day = e["event_timestamp"][:10]
        day_rows = conn.execute(
            """SELECT measurement_type, ROUND(AVG(measurement_value), 3) AS mean FROM environment_readings
               WHERE substr(timestamp_utc, 1, 10) = ? AND quality_status = 'valid' GROUP BY measurement_type""",
            (day,)).fetchall()
        out.append({
            "event_id": e["event_id"], "mission_day": e["mission_day"], "event_type": e["event_type"],
            "event_title": e["event_title"], "event_timestamp": e["event_timestamp"],
            "day_averages": {r["measurement_type"]: {"day_mean": r["mean"],
                                                     "window_mean": window_avg.get(r["measurement_type"])}
                             for r in day_rows},
        })
    return {"simulation_run_id": simulation_run_id, "window": window_dict(start, end), "events": out}
