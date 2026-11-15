"""In-flight cognition vs baseline (plan section 3, Phase 3).

Each in-flight day's score per test (daily_cognitive_results) is compared with the matching
baseline: same astronaut, same test, same time of day (cognitive_comparisons).

Direction matters: for reaction time and fatigue, LOWER is better; for accuracy, HIGHER is
better (metric_definitions.better_direction). `performance_z` is signed so that a positive value
always means "better than this person's baseline", whatever the metric.

A z-score or an "outside range" flag is a statistical comparison with the astronaut's own
preflight data. It is never medical clearance or a fitness-for-duty decision.

Simulation runs: daily results made by a run are linked to it in daily_result_runs. Seeded rows
have no link and belong to the template run (RUN-DEMO-001).
"""
from __future__ import annotations

import sqlite3
import statistics
import uuid
from datetime import datetime, timedelta
from typing import Any

from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.services.baseline_service import find_matching_baseline
from app.services.cognitive_scoring import PROTOCOL_DOMAIN, get_metric_definition
from app.services.health_context import mission_launch, require_astronaut
from app.utils.statistics import linear_slope
from app.utils.timestamps import parse_iso, to_iso, utcnow

NOT_CLEARANCE = ("Comparison with this astronaut's own preflight baseline. Statistical context only; "
                 "not medical clearance or a fitness-for-duty decision.")


def _run(simulation_run_id: str | None) -> str:
    return simulation_run_id or get_settings().default_template_run_id


def _run_filter(alias: str = "d") -> str:
    """SQL fragment selecting daily results of the run bound as :run."""
    return (f"COALESCE((SELECT simulation_run_id FROM daily_result_runs x WHERE x.daily_result_id = "
            f"{alias}.daily_result_id), :template) = :run")


# --------------------------------------------------------------------------- daily aggregation

def aggregate_daily_cognitive_results(conn: sqlite3.Connection, astronaut_id: str, assessment_date: str,
                                      simulation_run_id: str | None = None,
                                      calculated_at: str | None = None) -> list[dict[str, Any]]:
    """Summarise one astronaut's valid in-flight results for one day into daily_cognitive_results.

    Creates or updates one row per protocol for this run. Caller commits.
    Returns the rows with the condition their sessions were taken in.
    """
    require_astronaut(conn, astronaut_id)
    run = _run(simulation_run_id)
    template = get_settings().default_template_run_id
    rows = conn.execute(
        """SELECT s.session_id, s.protocol_id, s.mission_id, s.assessment_condition, r.metric_value,
                  r.metric_name, r.metric_unit, r.cognitive_domain,
                  (SELECT COUNT(*) FROM assessment_trials t WHERE t.session_id = s.session_id) AS trials
           FROM assessment_sessions s
           JOIN assessment_assignments a ON a.assignment_id = s.assignment_id
           JOIN assessment_results r ON r.session_id = s.session_id
           WHERE s.astronaut_id = ? AND s.mission_phase = 'inflight' AND s.session_status = 'completed'
             AND s.quality_status = 'valid' AND substr(s.started_at, 1, 10) = ?
             AND COALESCE(a.simulation_run_id, ?) = ?""",
        (astronaut_id, assessment_date, template, run)).fetchall()
    by_protocol: dict[str, list[sqlite3.Row]] = {}
    for r in rows:
        by_protocol.setdefault(r["protocol_id"], []).append(r)

    launch = mission_launch(conn)
    mission_day = (parse_iso(assessment_date) - launch).days + 1
    stamp = calculated_at or to_iso(utcnow())
    out = []
    for protocol_id, items in sorted(by_protocol.items()):
        values = [i["metric_value"] for i in items]
        first = items[0]
        valid_trials = sum(i["trials"] for i in items) if protocol_id != "SURVEY" else len(items)
        conditions = {i["assessment_condition"] for i in items}
        fields = {
            "daily_mean": round(statistics.fmean(values), 2), "daily_median": round(statistics.median(values), 2),
            "sessions_completed": len(items), "valid_trials": valid_trials, "calculated_at": stamp,
        }
        existing = conn.execute(
            f"""SELECT daily_result_id FROM daily_cognitive_results d
                WHERE astronaut_id = :a AND assessment_date = :day AND protocol_id = :p AND {_run_filter()}""",
            {"a": astronaut_id, "day": assessment_date, "p": protocol_id, "template": template, "run": run}).fetchone()
        if existing:
            daily_id = existing[0]
            conn.execute(
                """UPDATE daily_cognitive_results SET daily_mean = ?, daily_median = ?, sessions_completed = ?,
                       valid_trials = ?, calculated_at = ? WHERE daily_result_id = ?""",
                (*fields.values(), daily_id))
        else:
            daily_id = f"DCR-{uuid.uuid4().hex[:12].upper()}"
            conn.execute(
                """INSERT INTO daily_cognitive_results (daily_result_id, astronaut_id, mission_id, mission_day,
                       assessment_date, protocol_id, cognitive_domain, metric_name, daily_mean, daily_median,
                       metric_unit, sessions_completed, valid_trials, calculated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (daily_id, astronaut_id, first["mission_id"], mission_day, assessment_date, protocol_id,
                 first["cognitive_domain"], first["metric_name"], fields["daily_mean"], fields["daily_median"],
                 first["metric_unit"], fields["sessions_completed"], fields["valid_trials"], stamp))
            conn.execute("INSERT INTO daily_result_runs (daily_result_id, simulation_run_id) VALUES (?, ?)",
                         (daily_id, run))
        row = dict(conn.execute("SELECT * FROM daily_cognitive_results WHERE daily_result_id = ?",
                                (daily_id,)).fetchone())
        row["assessment_condition"] = conditions.pop() if len(conditions) == 1 else "mixed"
        out.append(row)
    return out


# --------------------------------------------------------------------------- comparison

def calculate_standardized_difference(value: float, baseline: dict[str, Any], better_direction: str) -> dict[str, Any]:
    """z vs the baseline, a direction-aware performance_z, and where the value sits in the range."""
    sd = baseline["standard_deviation"]
    z = round((value - baseline["mean_value"]) / sd, 3) if sd else None
    sign = 1 if better_direction == "higher_is_better" else -1
    performance_z = round(sign * z, 3) if z is not None else None
    lower, upper = baseline["reference_lower"], baseline["reference_upper"]
    if lower <= value <= upper:
        position = "within_reference"
        interpretation = "within_usual_range"
    else:
        position = "outside_reference"
        above = value > upper
        better = above == (better_direction == "higher_is_better")
        interpretation = "outside_range_better" if better else "outside_range_worse"
    return {"z_score": z, "performance_z": performance_z, "reference_range_status": position,
            "interpretation": interpretation, "better_direction": better_direction}


def compare_daily_result(conn: sqlite3.Connection, daily_result_id: str, condition: str = "morning",
                         calculated_at: str | None = None) -> dict[str, Any]:
    """Create or update the cognitive_comparisons row for one daily result. Caller commits."""
    daily = conn.execute("SELECT * FROM daily_cognitive_results WHERE daily_result_id = ?",
                         (daily_result_id,)).fetchone()
    if daily is None:
        raise NotFound(f"Daily result {daily_result_id} not found")
    if condition == "mixed":
        raise ValidationFailed("Sessions from different times of day cannot be compared with one baseline")
    baseline = find_matching_baseline(conn, daily["astronaut_id"], daily["protocol_id"], condition)
    value = daily["daily_median"]
    absolute = round(value - baseline["median_value"], 2)
    pct = round(absolute / baseline["median_value"] * 100, 2) if baseline["median_value"] else None
    status = "within_reference" if baseline["reference_lower"] <= value <= baseline["reference_upper"] \
        else "outside_reference"
    stamp = calculated_at or to_iso(utcnow())
    existing = conn.execute("SELECT comparison_id FROM cognitive_comparisons WHERE daily_result_id = ?",
                            (daily_result_id,)).fetchone()
    if existing:
        comparison_id = existing[0]
        conn.execute(
            """UPDATE cognitive_comparisons SET baseline_id = ?, baseline_value = ?, inflight_value = ?,
                   absolute_difference = ?, percentage_difference = ?, reference_range_status = ?, calculated_at = ?
               WHERE comparison_id = ?""",
            (baseline["baseline_id"], baseline["median_value"], value, absolute, pct, status, stamp, comparison_id))
    else:
        comparison_id = f"CMP-{uuid.uuid4().hex[:12].upper()}"
        conn.execute(
            """INSERT INTO cognitive_comparisons (comparison_id, astronaut_id, daily_result_id, baseline_id,
                   comparison_method, baseline_value, inflight_value, absolute_difference, percentage_difference,
                   reference_range_status, calculated_at)
               VALUES (?, ?, ?, ?, 'same_time_of_day', ?, ?, ?, ?, ?, ?)""",
            (comparison_id, daily["astronaut_id"], daily_result_id, baseline["baseline_id"], baseline["median_value"],
             value, absolute, pct, status, stamp))
    return _enrich(conn, dict(conn.execute("SELECT * FROM cognitive_comparisons WHERE comparison_id = ?",
                                           (comparison_id,)).fetchone()))


def _enrich(conn: sqlite3.Connection, comparison: dict[str, Any]) -> dict[str, Any]:
    """Add z, performance_z and a direction-aware interpretation to a stored comparison."""
    baseline = dict(conn.execute("SELECT * FROM cognitive_baselines WHERE baseline_id = ?",
                                 (comparison["baseline_id"],)).fetchone())
    metric = get_metric_definition(conn, baseline["metric_name"], baseline["cognitive_domain"])
    extra = calculate_standardized_difference(comparison["inflight_value"], baseline, metric["better_direction"])
    extra.pop("reference_range_status")  # the stored status is authoritative
    return {**comparison, "protocol_id": baseline["protocol_id"], "metric_name": baseline["metric_name"],
            "metric_unit": baseline["metric_unit"], "baseline_version": baseline["baseline_version"],
            "baseline_mean": baseline["mean_value"], "baseline_sd": baseline["standard_deviation"],
            "reference_range": [baseline["reference_lower"], baseline["reference_upper"]], **extra}


# --------------------------------------------------------------------------- reading

def get_daily_cognition(conn: sqlite3.Connection, astronaut_id: str, start_date: str, end_date: str,
                        simulation_run_id: str | None = None, protocol_id: str | None = None) -> list[dict[str, Any]]:
    require_astronaut(conn, astronaut_id)
    params = {"a": astronaut_id, "s": start_date, "e": end_date, "p": protocol_id,
              "template": get_settings().default_template_run_id, "run": _run(simulation_run_id)}
    rows = conn.execute(
        f"""SELECT d.* FROM daily_cognitive_results d
            WHERE d.astronaut_id = :a AND d.assessment_date BETWEEN :s AND :e
              AND (:p IS NULL OR d.protocol_id = :p) AND {_run_filter()}
            ORDER BY d.assessment_date, d.protocol_id""", params)
    return [dict(r) for r in rows]


def get_cognitive_comparisons(conn: sqlite3.Connection, astronaut_id: str, start_date: str, end_date: str,
                              simulation_run_id: str | None = None, protocol_id: str | None = None,
                              only_outside: bool = False) -> dict[str, Any]:
    require_astronaut(conn, astronaut_id)
    params = {"a": astronaut_id, "s": start_date, "e": end_date, "p": protocol_id,
              "template": get_settings().default_template_run_id, "run": _run(simulation_run_id)}
    rows = conn.execute(
        f"""SELECT c.*, d.assessment_date, d.mission_day FROM cognitive_comparisons c
            JOIN daily_cognitive_results d ON d.daily_result_id = c.daily_result_id
            WHERE d.astronaut_id = :a AND d.assessment_date BETWEEN :s AND :e
              AND (:p IS NULL OR d.protocol_id = :p) AND {_run_filter()}
              {"AND c.reference_range_status = 'outside_reference'" if only_outside else ""}
            ORDER BY d.assessment_date, d.protocol_id""", params)
    comparisons = [_enrich(conn, dict(r)) for r in rows]
    worse = sum(c["interpretation"] == "outside_range_worse" for c in comparisons)
    return {"astronaut_id": astronaut_id, "simulation_run_id": _run(simulation_run_id),
            "window": {"start": start_date, "end": end_date}, "count": len(comparisons),
            "outside_range_worse": worse, "note": NOT_CLEARANCE, "comparisons": comparisons}


def calculate_cognitive_trend(conn: sqlite3.Connection, astronaut_id: str, protocol_id: str, end: datetime,
                              days: int = 14, simulation_run_id: str | None = None) -> dict[str, Any]:
    """Slope of daily scores over the last `days` days, read in the metric's better direction."""
    if protocol_id not in PROTOCOL_DOMAIN:
        raise ValidationFailed(f"protocol_id must be one of {sorted(PROTOCOL_DOMAIN)}")
    if not 3 <= days <= 90:
        raise ValidationFailed("days must be between 3 and 90")
    start = end - timedelta(days=days)
    points = get_daily_cognition(conn, astronaut_id, to_iso(start)[:10], to_iso(end)[:10],
                                 simulation_run_id, protocol_id)
    values = [p["daily_median"] for p in points]
    slope = linear_slope(range(len(values)), values)
    metric = (get_metric_definition(conn, points[0]["metric_name"], points[0]["cognitive_domain"])
              if points else None)
    if slope is None or metric is None:
        trend = "insufficient_data"
    else:
        mean = statistics.fmean(values)
        fitted = slope * (len(values) - 1)
        if mean and abs(fitted) / abs(mean) < 0.01:
            trend = "stable"
        else:
            improving = (slope > 0) == (metric["better_direction"] == "higher_is_better")
            trend = "improving" if improving else "declining"
    return {"astronaut_id": astronaut_id, "protocol_id": protocol_id, "days_with_data": len(values),
            "window": {"start": to_iso(start), "end": to_iso(end)}, "slope_per_day": slope,
            "better_direction": metric["better_direction"] if metric else None, "trend": trend,
            "points": [{"assessment_date": p["assessment_date"], "daily_median": p["daily_median"]} for p in points],
            "note": NOT_CLEARANCE}
