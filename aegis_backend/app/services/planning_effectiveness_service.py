"""Planning effectiveness (Phase 5): how the plans in a simulation run turned out over a period.

One row is stored per planning method found in the period:
  * 'preloaded_demo'  the seeded demonstration plan (never approved)
  * 'optimizer'       plans made by the Phase 4 scheduler and approved or published
  * 'manual'          any other approved plan

This describes what was planned and recorded. It cannot show that one planning method caused a
better outcome, and with one crew and one mission it should not be read that way.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import timedelta
from typing import Any

from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.services.audit_service import write_audit
from app.utils.timestamps import parse_iso

EVALUATION_METHOD = "descriptive_v1"
COGNITIVE_METRIC = "median_reaction_time_ms"
ON_TIME_MINUTES = 15
COUNTED_VERSION_STATUSES = ("demo_unapproved", "approved", "published")
NOTE = ("Descriptive only. It shows what was planned and recorded for each planning method; it does not show "
        "that a method caused a difference. Rates are empty when nothing was recorded as started or completed.")


def _method(version: sqlite3.Row) -> str:
    if version["status"] == "demo_unapproved":
        return "preloaded_demo"
    return "optimizer" if version["optimization_run_id"] else "manual"


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def evaluate_planning_effectiveness(conn: sqlite3.Connection, *, actor_user_id: str | None,
                                    period_start: str, period_end: str, simulation_run_id: str | None = None,
                                    mission_id: str = "MIS-001", analysis_id: str | None = None,
                                    include_drafts: bool = False) -> dict[str, Any]:
    try:
        start, end = parse_iso(period_start), parse_iso(period_end)
    except ValueError as exc:
        raise ValidationFailed("Dates must look like 2027-03-01") from exc
    if start > end:
        raise ValidationFailed("period_start must not be after period_end")
    start_day, end_day = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    run_id = simulation_run_id or get_settings().default_template_run_id
    if conn.execute("SELECT 1 FROM simulation_runs WHERE simulation_run_id = ?", (run_id,)).fetchone() is None:
        raise NotFound(f"Simulation run {run_id} not found")
    if analysis_id and conn.execute("SELECT 1 FROM research_analyses WHERE analysis_id = ?",
                                    (analysis_id,)).fetchone() is None:
        raise NotFound(f"Analysis {analysis_id} not found")
    crew = [r["astronaut_id"] for r in conn.execute(
        "SELECT astronaut_id FROM astronauts WHERE mission_id = ?", (mission_id,))]
    statuses = COUNTED_VERSION_STATUSES + (("draft",) if include_drafts else ())
    rows = conn.execute(
        f"""SELECT a.*, t.task_date, t.estimated_duration_minutes, v.status AS version_status, v.optimization_run_id
            FROM task_assignments a JOIN mission_tasks t ON t.task_id = a.task_id
            JOIN schedule_versions v ON v.schedule_version_id = a.schedule_version_id
            WHERE a.simulation_run_id = ? AND t.mission_id = ? AND t.task_date >= ? AND t.task_date <= ?
              AND v.status IN ({','.join('?' * len(statuses))})""",
        (run_id, mission_id, start_day, end_day, *statuses)).fetchall()
    groups: dict[str, list[sqlite3.Row]] = {}
    for r in rows:
        groups.setdefault(_method({"status": r["version_status"], "optimization_run_id": r["optimization_run_id"]}),
                          []).append(r)

    evaluations = []
    for method, items in sorted(groups.items()):
        days = sorted({r["task_date"] for r in items})
        marks = ",".join("?" * len(days))
        tasks_total = conn.execute(f"SELECT COUNT(*) FROM mission_tasks WHERE mission_id = ? AND task_date IN ({marks})",
                                   (mission_id, *days)).fetchone()[0]
        # Workload balance: the gap in planned task minutes between the busiest and least busy astronaut, per day.
        gaps = []
        for day in days:
            loads = {a: 0.0 for a in crew}
            for r in items:
                if r["task_date"] == day and r["astronaut_id"]:
                    minutes = (parse_iso(r["planned_end"]) - parse_iso(r["planned_start"])).total_seconds() / 60
                    loads[r["astronaut_id"]] = loads.get(r["astronaut_id"], 0.0) + minutes
            gaps.append(max(loads.values()) - min(loads.values()))
        started = [r for r in items if r["actual_start"]]
        on_time = [r for r in started if abs(parse_iso(r["actual_start"]) - parse_iso(r["planned_start"]))
                   <= timedelta(minutes=ON_TIME_MINUTES)]
        finished = [r for r in items if r["actual_end"] or r["assignment_status"] == "completed"]
        recovery = conn.execute(
            f"""SELECT completion_status FROM scheduled_recovery WHERE mission_id = ?
                AND substr(scheduled_start, 1, 10) IN ({marks})""", (mission_id, *days)).fetchall()
        recovery_recorded = [r for r in recovery if r["completion_status"] not in (None, "", "planned")]
        cognitive = conn.execute(
            f"""SELECT AVG(d.daily_mean) FROM daily_cognitive_results d WHERE d.mission_id = ? AND d.metric_name = ?
                AND d.assessment_date IN ({marks})
                AND COALESCE((SELECT simulation_run_id FROM daily_result_runs x
                              WHERE x.daily_result_id = d.daily_result_id), ?) = ?""",
            (mission_id, COGNITIVE_METRIC, *days, get_settings().default_template_run_id, run_id)).fetchone()[0]
        row = {
            "effectiveness_id": f"EFF-{uuid.uuid4().hex[:12].upper()}", "mission_id": mission_id,
            "evaluation_period_start": start_day, "evaluation_period_end": end_day, "planning_method": method,
            "cognitive_metric_name": COGNITIVE_METRIC,
            "cognitive_metric_value": None if cognitive is None else round(cognitive, 2),
            "workload_balance_metric": round(sum(gaps) / len(gaps), 2),
            "task_completion_rate": _rate(len(finished), len(items)) if (started or finished) else None,
            "schedule_adherence_rate": _rate(len(on_time), len(started)),
            "recovery_adherence_rate": (_rate(sum(r["completion_status"] == "completed" for r in recovery),
                                              len(recovery)) if recovery_recorded else None),
            "evaluation_method": EVALUATION_METHOD, "analysis_id": analysis_id,
        }
        conn.execute(
            """INSERT INTO planning_effectiveness (effectiveness_id, mission_id, evaluation_period_start,
                   evaluation_period_end, planning_method, cognitive_metric_name, cognitive_metric_value,
                   workload_balance_metric, task_completion_rate, schedule_adherence_rate, recovery_adherence_rate,
                   evaluation_method, analysis_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            tuple(row.values()))
        evaluations.append({**row, "days_planned": len(days), "assignments": len(items), "tasks_total": tasks_total,
                            "task_coverage_rate": _rate(len({r["task_id"] for r in items}), tasks_total),
                            "assignments_started": len(started)})
    write_audit(conn, user_id=actor_user_id, action_type="evaluate_planning_effectiveness",
                entity_type="simulation_run", entity_id=run_id, action_result="success",
                change_summary=f"{start_day} to {end_day}: {', '.join(sorted(groups)) or 'no counted plans'}",
                commit=False)
    conn.commit()
    return {"simulation_run_id": run_id, "mission_id": mission_id,
            "period": {"start": start_day, "end": end_day}, "evaluations": evaluations,
            "units": {"workload_balance_metric": "minutes between the busiest and least busy astronaut, daily average "
                                                 "(lower is more even)",
                      "cognitive_metric_value": "ms, crew average on the planned days",
                      "schedule_adherence_rate": f"share of started tasks that began within {ON_TIME_MINUTES} "
                                                 "minutes of plan"},
            "note": NOTE if evaluations else
            "No approved, published or demo plans in this period for this run. Draft plans count only with "
            "include_drafts."}


def list_planning_effectiveness(conn: sqlite3.Connection, mission_id: str | None = None,
                                planning_method: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT * FROM planning_effectiveness WHERE (:m IS NULL OR mission_id = :m)
              AND (:p IS NULL OR planning_method = :p) ORDER BY evaluation_period_start, planning_method, rowid""",
        {"m": mission_id, "p": planning_method}).fetchall()
    return [dict(r) for r in rows]
