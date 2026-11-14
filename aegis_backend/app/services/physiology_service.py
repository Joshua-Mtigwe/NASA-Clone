"""Physiology (plan section 3, Phase 2): vitals for the Astronaut Health dashboard.

Readings are hourly wearable vitals in sensor_readings. Only quality_status = 'valid' rows are
used for values; detect_sensor_quality_issues reports the rest.

"Personal range" means the astronaut's own early-mission reference (first REFERENCE_DAYS days,
mean +/- 2 SD). It is a statistical comparison with themselves, NOT a clinical threshold.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from typing import Any

from app.core.errors import ValidationFailed
from app.services.health_context import (
    MAX_RAW_WINDOW_DAYS,
    mission_launch,
    require_astronaut,
    window_dict,
)
from app.utils.statistics import describe, linear_slope, rolling_mean
from app.utils.timestamps import parse_iso, to_iso

REFERENCE_DAYS = 7
STALE_AFTER = timedelta(hours=2)
NON_CLINICAL_NOTE = ("Compared with this astronaut's own first-week values (mean +/- 2 SD). "
                     "Statistical context only; not a clinical threshold or diagnosis.")

# label, unit, and physical limits outside which a value must be a sensor fault.
# These are sensor plausibility limits, deliberately wide; they are NOT clinical alert levels.
VITALS: dict[str, dict[str, Any]] = {
    "heart_rate": {"label": "Heart rate", "unit": "bpm", "plausible": (20, 250)},
    "hrv_rmssd": {"label": "Heart rate variability (RMSSD)", "unit": "ms", "plausible": (1, 500)},
    "spo2": {"label": "Blood oxygen saturation", "unit": "percent", "plausible": (50, 100)},
    "body_temperature": {"label": "Body temperature", "unit": "degC", "plausible": (30, 43)},
    "respiratory_rate": {"label": "Respiratory rate", "unit": "breaths/min", "plausible": (2, 60)},
}

BODY_REGIONS = {
    "heart": ["heart_rate", "hrv_rmssd"],
    "lungs": ["respiratory_rate", "spo2"],
    "core": ["body_temperature"],
}


def _check_type(measurement_type: str) -> None:
    if measurement_type not in VITALS:
        raise ValidationFailed(f"measurement_type must be one of {sorted(VITALS)}")


# --------------------------------------------------------------------------- current & history

def get_current_vitals(conn: sqlite3.Connection, astronaut_id: str, as_of: datetime) -> dict[str, Any]:
    """Latest valid reading of each vital at or before as_of, with its age."""
    require_astronaut(conn, astronaut_id)
    vitals = []
    for mtype, meta in VITALS.items():
        row = conn.execute(
            """SELECT timestamp_utc, measurement_value, measurement_unit, sensor_id FROM sensor_readings
               WHERE astronaut_id = ? AND measurement_type = ? AND quality_status = 'valid'
                 AND timestamp_utc <= ? ORDER BY timestamp_utc DESC LIMIT 1""",
            (astronaut_id, mtype, to_iso(as_of)),
        ).fetchone()
        if row is None:
            vitals.append({"measurement_type": mtype, "label": meta["label"], "unit": meta["unit"],
                           "value": None, "status": "no_data"})
            continue
        age = as_of - parse_iso(row["timestamp_utc"])
        vitals.append({
            "measurement_type": mtype, "label": meta["label"], "unit": row["measurement_unit"],
            "value": row["measurement_value"], "timestamp_utc": row["timestamp_utc"],
            "sensor_id": row["sensor_id"], "age_minutes": int(age.total_seconds() // 60),
            "status": "stale" if age > STALE_AFTER else "current",
        })
    return {"astronaut_id": astronaut_id, "as_of": to_iso(as_of), "vitals": vitals}


def get_vital_history(conn: sqlite3.Connection, astronaut_id: str, measurement_type: str,
                      start: datetime, end: datetime, resolution: str = "daily") -> dict[str, Any]:
    """Time series of one vital. resolution: 'hourly' (raw readings, max 31 days) or 'daily'."""
    require_astronaut(conn, astronaut_id)
    _check_type(measurement_type)
    params = (astronaut_id, measurement_type, to_iso(start), to_iso(end))
    if resolution == "hourly":
        if end - start > timedelta(days=MAX_RAW_WINDOW_DAYS):
            raise ValidationFailed(f"hourly history is limited to {MAX_RAW_WINDOW_DAYS} days; use resolution=daily")
        rows = conn.execute(
            """SELECT timestamp_utc, measurement_value AS value FROM sensor_readings
               WHERE astronaut_id = ? AND measurement_type = ? AND quality_status = 'valid'
                 AND timestamp_utc BETWEEN ? AND ? ORDER BY timestamp_utc""", params).fetchall()
        points = [dict(r) for r in rows]
    elif resolution == "daily":
        points = _daily_series(conn, astronaut_id, measurement_type, start, end)
    else:
        raise ValidationFailed("resolution must be 'hourly' or 'daily'")
    return {"astronaut_id": astronaut_id, "measurement_type": measurement_type,
            "unit": VITALS[measurement_type]["unit"], "resolution": resolution,
            "window": window_dict(start, end), "points": points}


def _daily_series(conn: sqlite3.Connection, astronaut_id: str, measurement_type: str,
                  start: datetime, end: datetime) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT substr(timestamp_utc, 1, 10) AS day, ROUND(AVG(measurement_value), 3) AS mean,
                  MIN(measurement_value) AS min, MAX(measurement_value) AS max, COUNT(*) AS n
           FROM sensor_readings
           WHERE astronaut_id = ? AND measurement_type = ? AND quality_status = 'valid'
             AND timestamp_utc BETWEEN ? AND ?
           GROUP BY day ORDER BY day""",
        (astronaut_id, measurement_type, to_iso(start), to_iso(end)),
    ).fetchall()
    return [dict(r) for r in rows]


def calculate_mean_vital(conn: sqlite3.Connection, astronaut_id: str, measurement_type: str,
                         start: datetime, end: datetime) -> dict[str, Any]:
    """Descriptive statistics of the hourly readings in a window."""
    require_astronaut(conn, astronaut_id)
    _check_type(measurement_type)
    values = [r[0] for r in conn.execute(
        """SELECT measurement_value FROM sensor_readings
           WHERE astronaut_id = ? AND measurement_type = ? AND quality_status = 'valid'
             AND timestamp_utc BETWEEN ? AND ?""",
        (astronaut_id, measurement_type, to_iso(start), to_iso(end)))]
    return {"astronaut_id": astronaut_id, "measurement_type": measurement_type,
            "unit": VITALS[measurement_type]["unit"], "window": window_dict(start, end), **describe(values)}


def calculate_rolling_average(conn: sqlite3.Connection, astronaut_id: str, measurement_type: str,
                              start: datetime, end: datetime, window_days: int = 7) -> dict[str, Any]:
    """Daily means plus a trailing rolling mean over window_days."""
    if not 1 <= window_days <= 30:
        raise ValidationFailed("window_days must be between 1 and 30")
    series = get_vital_history(conn, astronaut_id, measurement_type, start, end, "daily")
    rolled = rolling_mean([p["mean"] for p in series["points"]], window_days)
    for point, value in zip(series["points"], rolled):
        point["rolling_mean"] = value
    series["window_days"] = window_days
    return series


def calculate_vital_trend(conn: sqlite3.Connection, astronaut_id: str, measurement_type: str,
                          end: datetime, days: int = 14) -> dict[str, Any]:
    """Least-squares slope of daily means over the last `days` days (units per day)."""
    if not 3 <= days <= 90:
        raise ValidationFailed("days must be between 3 and 90")
    start = end - timedelta(days=days)
    points = get_vital_history(conn, astronaut_id, measurement_type, start, end, "daily")["points"]
    slope = linear_slope(range(len(points)), [p["mean"] for p in points])
    first, last = (points[0]["mean"], points[-1]["mean"]) if points else (None, None)
    return {
        "astronaut_id": astronaut_id, "measurement_type": measurement_type,
        "unit": VITALS[measurement_type]["unit"], "window": window_dict(start, end), "days_with_data": len(points),
        "slope_per_day": slope,
        "change_over_window": round(last - first, 3) if points else None,
        "direction": _direction(slope, points),
    }


def _direction(slope: float | None, points: list[dict]) -> str:
    """'rising'/'falling' if the fitted change over the window exceeds 1% of the mean, else 'stable'."""
    if slope is None or not points:
        return "insufficient_data"
    mean = sum(p["mean"] for p in points) / len(points)
    fitted_change = slope * (len(points) - 1)
    if mean and abs(fitted_change) / abs(mean) < 0.01:
        return "stable"
    return "rising" if slope > 0 else "falling"


# --------------------------------------------------------------------------- data quality

def detect_sensor_quality_issues(conn: sqlite3.Connection, start: datetime, end: datetime,
                                 astronaut_id: str | None = None) -> dict[str, Any]:
    """Per astronaut and vital: missing hours, non-valid readings, duplicates and impossible values.

    The window is clipped to the period the sensors actually recorded, so time after the
    data ends is not reported as missing.
    """
    if end - start > timedelta(days=MAX_RAW_WINDOW_DAYS):
        raise ValidationFailed(f"quality checks are limited to {MAX_RAW_WINDOW_DAYS} days at a time")
    span = conn.execute("SELECT MIN(timestamp_utc), MAX(timestamp_utc) FROM sensor_readings").fetchone()
    if span[0] is None:
        return {"window": window_dict(start, end), "checked": [], "issue_count": 0}
    lo, hi = max(start, parse_iso(span[0])), min(end, parse_iso(span[1]))
    astronauts = [astronaut_id] if astronaut_id else [
        r[0] for r in conn.execute("SELECT astronaut_id FROM astronauts ORDER BY astronaut_id")]
    if astronaut_id:
        require_astronaut(conn, astronaut_id)

    expected_hours = []
    t = lo.replace(minute=0, second=0, microsecond=0)
    if t < lo:
        t += timedelta(hours=1)
    while t <= hi:
        expected_hours.append(to_iso(t))
        t += timedelta(hours=1)

    checked, issue_count = [], 0
    for ast in astronauts:
        for mtype, meta in VITALS.items():
            rows = conn.execute(
                """SELECT timestamp_utc, measurement_value, quality_status FROM sensor_readings
                   WHERE astronaut_id = ? AND measurement_type = ? AND timestamp_utc BETWEEN ? AND ?""",
                (ast, mtype, to_iso(lo), to_iso(hi))).fetchall()
            seen: dict[str, int] = {}
            for r in rows:
                seen[r["timestamp_utc"]] = seen.get(r["timestamp_utc"], 0) + 1
            low, high = meta["plausible"]
            missing = [h for h in expected_hours if h not in seen]
            not_valid = [r["timestamp_utc"] for r in rows if r["quality_status"] != "valid"]
            implausible = [f"{r['timestamp_utc']}={r['measurement_value']}" for r in rows
                           if r["measurement_value"] is None or not low <= r["measurement_value"] <= high]
            duplicates = [ts for ts, n in seen.items() if n > 1]
            issues = {"missing_hours": missing, "not_valid": not_valid,
                      "implausible_values": implausible, "duplicate_timestamps": duplicates}
            count = sum(len(v) for v in issues.values())
            issue_count += count
            checked.append({
                "astronaut_id": ast, "measurement_type": mtype, "readings": len(rows),
                "expected_hours": len(expected_hours), "issue_count": count,
                "issues": {k: {"count": len(v), "examples": v[:5]} for k, v in issues.items()},
            })
    return {"window": window_dict(lo, hi), "plausibility_note": "Plausibility limits detect sensor faults, "
            "not clinical conditions.", "issue_count": issue_count, "checked": checked}


# --------------------------------------------------------------------------- body map

def personal_reference(conn: sqlite3.Connection, astronaut_id: str, measurement_type: str,
                       days: int = REFERENCE_DAYS) -> dict[str, Any]:
    """Hourly-value statistics for the astronaut's first `days` mission days, with a mean +/- 2 SD range."""
    launch = mission_launch(conn)
    end = launch + timedelta(days=days) - timedelta(seconds=1)
    values = [r[0] for r in conn.execute(
        """SELECT measurement_value FROM sensor_readings
           WHERE astronaut_id = ? AND measurement_type = ? AND quality_status = 'valid'
             AND timestamp_utc BETWEEN ? AND ?""",
        (astronaut_id, measurement_type, to_iso(launch), to_iso(end)))]
    stats = describe(values)
    if stats["sd"] is not None:
        stats["range_lower"] = round(stats["mean"] - 2 * stats["sd"], 3)
        stats["range_upper"] = round(stats["mean"] + 2 * stats["sd"], 3)
    else:
        stats["range_lower"] = stats["range_upper"] = None
    stats["window"] = window_dict(launch, end)
    return stats


def prepare_body_map_metrics(conn: sqlite3.Connection, astronaut_id: str, as_of: datetime) -> dict[str, Any]:
    """Current vitals grouped by body region, each placed against the astronaut's personal range."""
    current = {v["measurement_type"]: v for v in get_current_vitals(conn, astronaut_id, as_of)["vitals"]}
    launch = mission_launch(conn)
    in_reference = as_of < launch + timedelta(days=REFERENCE_DAYS)
    regions = []
    for region, types in BODY_REGIONS.items():
        metrics = []
        for mtype in types:
            v = current[mtype]
            ref = personal_reference(conn, astronaut_id, mtype)
            if v["value"] is None:
                position = "no_data"
            elif in_reference or ref["range_lower"] is None:
                position = "reference_period"
            elif v["value"] > ref["range_upper"]:
                position = "above_personal_range"
            elif v["value"] < ref["range_lower"]:
                position = "below_personal_range"
            else:
                position = "within_personal_range"
            metrics.append({**v, "personal_range": [ref["range_lower"], ref["range_upper"]],
                            "personal_mean": ref["mean"], "position": position})
        regions.append({"region": region, "metrics": metrics})

    dose = conn.execute(
        """SELECT estimated_dose, dose_unit, timestamp_utc, organ_name, uncertainty FROM organ_dose_estimates
           WHERE astronaut_id = ? AND timestamp_utc <= ? ORDER BY timestamp_utc DESC LIMIT 1""",
        (astronaut_id, to_iso(as_of))).fetchone()
    regions.append({"region": "whole_body", "metrics": [
        {"measurement_type": "estimated_cumulative_dose", "label": "Estimated cumulative dose (illustrative)",
         "value": dose["estimated_dose"] if dose else None, "unit": dose["dose_unit"] if dose else "mSv",
         "timestamp_utc": dose["timestamp_utc"] if dose else None,
         "uncertainty": dose["uncertainty"] if dose else None,
         "position": "illustrative_model" if dose else "no_data"}]})
    return {"astronaut_id": astronaut_id, "as_of": to_iso(as_of), "note": NON_CLINICAL_NOTE, "regions": regions}
