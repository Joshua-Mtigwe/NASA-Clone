"""Crew health changes: how each astronaut's health data has moved compared with their own normal.

For every metric (vitals, sleep, activity, radiation dose rate, self-reported fatigue) it compares
  * a REFERENCE window: the astronaut's first `reference_days` mission days, with
  * a RECENT window: the `recent_days` days up to the chosen mission time,
using daily values. It reports the change, the percent change, and the change measured in
reference standard deviations (z). Changes of 2 SD or more are marked 'notable'.

This is a statistical comparison of each person with themselves, for staff awareness.
It is NOT a clinical threshold, a diagnosis, or a fitness-for-duty decision.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from typing import Any

from app.core.errors import ValidationFailed
from app.services.audit_service import write_audit
from app.services.health_context import mission_launch, require_astronaut, window_dict
from app.utils.statistics import describe, linear_slope, percent_change, standardized_change
from app.utils.timestamps import to_iso

NOTABLE_Z = 2.0
MILD_Z = 1.0
MIN_DAYS = 3

DISCLAIMER = ("Each astronaut is compared with their own first mission week. 'notable' means the recent "
              "average moved 2 or more reference standard deviations. Statistical context for staff, "
              "not a clinical threshold or diagnosis.")

_VITAL_SQL = """SELECT substr(timestamp_utc, 1, 10) AS day, AVG(measurement_value) AS value FROM sensor_readings
                WHERE astronaut_id = ? AND measurement_type = '{t}' AND quality_status = 'valid'
                  AND timestamp_utc >= ? AND timestamp_utc < ? GROUP BY day ORDER BY day"""
_SLEEP_SQL = """SELECT substr(sleep_start, 1, 10) AS day, {c} AS value FROM sleep_records
                WHERE astronaut_id = ? AND quality_status = 'valid' AND sleep_start >= ? AND sleep_start < ?
                ORDER BY sleep_start"""
_ACTIVITY_SQL = """SELECT substr(start_time, 1, 10) AS day, AVG({c}) AS value FROM activity_records
                   WHERE astronaut_id = ? AND start_time >= ? AND start_time < ? GROUP BY day ORDER BY day"""
_CONTEXT_SQL = """SELECT substr(timestamp_utc, 1, 10) AS day, AVG({c}) AS value FROM assessment_context
                  WHERE astronaut_id = ? AND timestamp_utc >= ? AND timestamp_utc < ? GROUP BY day ORDER BY day"""

# metric key -> (category, label, unit, SQL returning day/value rows for astronaut, start, end)
METRICS: dict[str, tuple[str, str, str, str]] = {
    "heart_rate": ("vitals", "Heart rate (daily mean)", "bpm", _VITAL_SQL.format(t="heart_rate")),
    "hrv_rmssd": ("vitals", "Heart rate variability (daily mean)", "ms", _VITAL_SQL.format(t="hrv_rmssd")),
    "spo2": ("vitals", "Blood oxygen saturation (daily mean)", "percent", _VITAL_SQL.format(t="spo2")),
    "body_temperature": ("vitals", "Body temperature (daily mean)", "degC", _VITAL_SQL.format(t="body_temperature")),
    "respiratory_rate": ("vitals", "Respiratory rate (daily mean)", "breaths/min",
                         _VITAL_SQL.format(t="respiratory_rate")),
    "total_sleep_minutes": ("sleep", "Total sleep", "minutes", _SLEEP_SQL.format(c="total_sleep_minutes")),
    "sleep_efficiency_percent": ("sleep", "Sleep efficiency", "percent",
                                 _SLEEP_SQL.format(c="sleep_efficiency_percent")),
    "sleep_quality_score": ("sleep", "Sleep quality score", "score", _SLEEP_SQL.format(c="sleep_quality_score")),
    "awakenings_count": ("sleep", "Awakenings per night", "count", _SLEEP_SQL.format(c="awakenings_count")),
    "exercise_heart_rate": ("activity", "Exercise heart rate", "bpm", _ACTIVITY_SQL.format(c="heart_rate_average")),
    "cognitive_workload": ("activity", "Cognitive workload during activity", "score",
                           _ACTIVITY_SQL.format(c="cognitive_workload")),
    "perceived_exertion": ("activity", "Perceived exertion", "score", _ACTIVITY_SQL.format(c="perceived_exertion")),
    "radiation_dose_rate": ("radiation", "Radiation dose rate (crew wearable)", "uSv/h",
                            """SELECT substr(timestamp_utc, 1, 10) AS day, AVG(dose_rate) AS value
                               FROM radiation_readings WHERE astronaut_id = ? AND timestamp_utc >= ?
                                 AND timestamp_utc < ? GROUP BY day ORDER BY day"""),
    "fatigue_score": ("self_report", "Self-reported fatigue", "1-9", _CONTEXT_SQL.format(c="fatigue_score")),
    "sleepiness_score": ("self_report", "Self-reported sleepiness", "score", _CONTEXT_SQL.format(c="sleepiness_score")),
    "perceived_workload": ("self_report", "Self-reported workload", "score",
                           _CONTEXT_SQL.format(c="perceived_workload")),
}
CATEGORIES = sorted({m[0] for m in METRICS.values()})


def _series(conn: sqlite3.Connection, sql: str, astronaut_id: str, start: datetime, end: datetime) -> list[dict]:
    return [{"day": r["day"], "value": r["value"]} for r in conn.execute(sql, (astronaut_id, to_iso(start), to_iso(end)))
            if r["value"] is not None]


def _classify(z: float | None, ref_n: int, recent_n: int) -> tuple[str, str]:
    """(change_level, direction)."""
    if ref_n < MIN_DAYS or recent_n < MIN_DAYS:
        return "insufficient_data", "unknown"
    if z is None:
        return "no_variation_in_reference", "unknown"
    direction = "increase" if z > 0 else "decrease" if z < 0 else "no_change"
    if abs(z) >= NOTABLE_Z:
        return "notable", direction
    if abs(z) >= MILD_Z:
        return "mild", direction
    return "within_usual_variation", direction


def _windows(conn: sqlite3.Connection, as_of: datetime, reference_days: int, recent_days: int):
    if not 3 <= reference_days <= 30:
        raise ValidationFailed("reference_days must be between 3 and 30")
    if not 3 <= recent_days <= 30:
        raise ValidationFailed("recent_days must be between 3 and 30")
    launch = mission_launch(conn)
    ref = (launch, launch + timedelta(days=reference_days))
    # Recent window ends at the start of the as_of day, so a partly recorded day doesn't skew it.
    day_start = as_of.replace(hour=0, minute=0, second=0, microsecond=0)
    recent = (day_start - timedelta(days=recent_days), day_start)
    return ref, recent


def calculate_health_changes(conn: sqlite3.Connection, astronaut_id: str, as_of: datetime,
                             reference_days: int = 7, recent_days: int = 7,
                             categories: list[str] | None = None) -> dict[str, Any]:
    """Every metric for one astronaut: reference vs recent, change, percent, z, trend."""
    require_astronaut(conn, astronaut_id)
    if categories:
        unknown = set(categories) - set(CATEGORIES)
        if unknown:
            raise ValidationFailed(f"Unknown categories {sorted(unknown)}; choose from {CATEGORIES}")
    (ref_start, ref_end), (rec_start, rec_end) = _windows(conn, as_of, reference_days, recent_days)
    too_early = rec_start < ref_end

    metrics = []
    for key, (category, label, unit, sql) in METRICS.items():
        if categories and category not in categories:
            continue
        ref = describe(p["value"] for p in _series(conn, sql, astronaut_id, ref_start, ref_end))
        recent_points = _series(conn, sql, astronaut_id, rec_start, rec_end)
        rec = describe(p["value"] for p in recent_points)
        if too_early:
            level, direction, z = "reference_period", "unknown", None
        else:
            z = standardized_change(ref["mean"], ref["sd"], rec["mean"])
            level, direction = _classify(z, ref["n"], rec["n"])
        change = round(rec["mean"] - ref["mean"], 4) if None not in (rec["mean"], ref["mean"]) else None
        metrics.append({
            "metric": key, "category": category, "label": label, "unit": unit,
            "reference_mean": ref["mean"], "reference_sd": ref["sd"], "reference_days": ref["n"],
            "recent_mean": rec["mean"], "recent_days": rec["n"],
            "change": change, "percent_change": percent_change(ref["mean"], rec["mean"]),
            "z_change": z, "change_level": level, "direction": direction,
            "recent_trend_per_day": linear_slope(range(len(recent_points)), [p["value"] for p in recent_points]),
        })

    notable = [m["metric"] for m in metrics if m["change_level"] == "notable"]
    mild = [m["metric"] for m in metrics if m["change_level"] == "mild"]
    return {
        "astronaut_id": astronaut_id, "as_of": to_iso(as_of),
        "reference_window": window_dict(ref_start, ref_end), "recent_window": window_dict(rec_start, rec_end),
        "status": "reference_period" if too_early else "compared",
        "notable_count": len(notable), "mild_count": len(mild),
        "notable_metrics": notable, "mild_metrics": mild,
        "metrics": metrics, "disclaimer": DISCLAIMER,
    }


def get_crew_health_changes(conn: sqlite3.Connection, as_of: datetime, *, actor_user_id: str | None,
                            reference_days: int = 7, recent_days: int = 7,
                            categories: list[str] | None = None, only_changes: bool = False) -> dict[str, Any]:
    """The admin view: every astronaut's changes, most notable first. Access is audited."""
    ids = [r[0] for r in conn.execute("SELECT astronaut_id FROM astronauts ORDER BY astronaut_id")]
    crew = []
    for astronaut_id in ids:
        result = calculate_health_changes(conn, astronaut_id, as_of, reference_days, recent_days, categories)
        if only_changes:
            result["metrics"] = [m for m in result["metrics"] if m["change_level"] in ("notable", "mild")]
        crew.append(result)
    crew.sort(key=lambda r: (-r["notable_count"], -r["mild_count"], r["astronaut_id"]))
    write_audit(conn, user_id=actor_user_id, action_type="view_crew_health_changes", entity_type="crew_health",
                entity_id=None, action_result="success",
                change_summary=f"as_of={to_iso(as_of)} reference_days={reference_days} recent_days={recent_days}")
    return {
        "as_of": to_iso(as_of),
        "summary": [{"astronaut_id": r["astronaut_id"], "notable_count": r["notable_count"],
                     "mild_count": r["mild_count"], "notable_metrics": r["notable_metrics"]} for r in crew],
        "crew": crew, "disclaimer": DISCLAIMER,
    }
