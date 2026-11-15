"""Sleep and workload (plan section 3, Phase 2). Summaries only; no clinical thresholds invented."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from typing import Any

from app.core.errors import NotFound, ValidationFailed
from app.services.health_context import require_astronaut, window_dict
from app.utils.statistics import describe
from app.utils.timestamps import parse_iso, to_iso


def get_sleep_history(conn: sqlite3.Connection, astronaut_id: str, start: datetime, end: datetime) -> dict[str, Any]:
    """Sleep periods that started within the window."""
    require_astronaut(conn, astronaut_id)
    rows = [dict(r) for r in conn.execute(
        """SELECT sleep_id, sleep_start, sleep_end, total_sleep_minutes, sleep_efficiency_percent,
                  awakenings_count, sleep_quality_score, quality_status, data_source
           FROM sleep_records WHERE astronaut_id = ? AND sleep_start BETWEEN ? AND ?
           ORDER BY sleep_start""", (astronaut_id, to_iso(start), to_iso(end)))]
    return {"astronaut_id": astronaut_id, "window": window_dict(start, end), "records": rows}


def calculate_sleep_consistency(conn: sqlite3.Connection, astronaut_id: str, end: datetime,
                                days: int = 14) -> dict[str, Any]:
    """Average sleep and how much it varies night to night (lower SD = more consistent)."""
    if not 3 <= days <= 90:
        raise ValidationFailed("days must be between 3 and 90")
    start = end - timedelta(days=days)
    records = [r for r in get_sleep_history(conn, astronaut_id, start, end)["records"]
               if r["quality_status"] == "valid"]
    onset_minutes = []
    for r in records:
        t = parse_iso(r["sleep_start"])
        onset_minutes.append(t.hour * 60 + t.minute)
    return {
        "astronaut_id": astronaut_id, "window": window_dict(start, end), "nights": len(records),
        "total_sleep_minutes": describe(r["total_sleep_minutes"] for r in records),
        "sleep_efficiency_percent": describe(r["sleep_efficiency_percent"] for r in records),
        "sleep_quality_score": describe(r["sleep_quality_score"] for r in records),
        "awakenings_count": describe(r["awakenings_count"] for r in records),
        "sleep_onset_minutes_utc": describe(onset_minutes),
        "note": "Consistency = night-to-night standard deviation. Onset is minutes after 00:00 UTC "
                "on the mission clock, not local bedtime.",
    }


def get_activity_history(conn: sqlite3.Connection, astronaut_id: str, start: datetime, end: datetime) -> dict[str, Any]:
    require_astronaut(conn, astronaut_id)
    rows = [dict(r) for r in conn.execute(
        """SELECT activity_id, activity_type, start_time, end_time, duration_minutes, physical_intensity,
                  cognitive_workload, heart_rate_average, perceived_exertion, source_type
           FROM activity_records WHERE astronaut_id = ? AND start_time BETWEEN ? AND ?
           ORDER BY start_time""", (astronaut_id, to_iso(start), to_iso(end)))]
    return {"astronaut_id": astronaut_id, "window": window_dict(start, end), "records": rows}


def calculate_recent_workload(conn: sqlite3.Connection, astronaut_id: str, end: datetime,
                              days: int = 7) -> dict[str, Any]:
    """Recorded activity plus planned (draft) task minutes over the last `days` days."""
    if not 1 <= days <= 90:
        raise ValidationFailed("days must be between 1 and 90")
    start = end - timedelta(days=days)
    activity = get_activity_history(conn, astronaut_id, start, end)["records"]
    tasks = conn.execute(
        """SELECT planned_start, planned_end, approval_status FROM task_assignments
           WHERE astronaut_id = ? AND planned_start BETWEEN ? AND ?""",
        (astronaut_id, to_iso(start), to_iso(end))).fetchall()
    task_minutes = sum((parse_iso(t["planned_end"]) - parse_iso(t["planned_start"])).total_seconds() / 60
                       for t in tasks if t["planned_start"] and t["planned_end"])
    return {
        "astronaut_id": astronaut_id, "window": window_dict(start, end), "days": days,
        "activity_sessions": len(activity),
        "activity_minutes": sum(a["duration_minutes"] or 0 for a in activity),
        "cognitive_workload": describe(a["cognitive_workload"] for a in activity),
        "perceived_exertion": describe(a["perceived_exertion"] for a in activity),
        "activity_heart_rate_average": describe(a["heart_rate_average"] for a in activity),
        "planned_task_count": len(tasks),
        "planned_task_minutes": round(task_minutes, 1),
        "planned_task_note": "Task assignments are draft, demo_unapproved schedule entries.",
    }


def get_astronaut_schedule(conn: sqlite3.Connection, astronaut_id: str, day: datetime) -> dict[str, Any]:
    """One day's calendar: schedule entries (recovery), task assignments and recovery bookings.

    All seeded entries are drafts / demo_unapproved; the approval fields are returned so the
    dashboard can say so.
    """
    require_astronaut(conn, astronaut_id)
    date = to_iso(day)[:10]
    schedule = [dict(r) for r in conn.execute(
        """SELECT schedule_id, activity_type, activity_reference_id, start_time, end_time, schedule_status,
                  approval_status, schedule_version_id, simulation_run_id
           FROM daily_schedules WHERE astronaut_id = ? AND schedule_date = ? ORDER BY start_time""",
        (astronaut_id, date))]
    tasks = [dict(r) for r in conn.execute(
        """SELECT ta.task_assignment_id, ta.task_id, mt.task_title, mt.task_category, mt.priority,
                  ta.planned_start, ta.planned_end, ta.actual_start, ta.actual_end,
                  ta.assignment_status, ta.approval_status,
                  ta.schedule_version_id, sv.status AS version_status
           FROM task_assignments ta JOIN mission_tasks mt ON mt.task_id = ta.task_id
           LEFT JOIN schedule_versions sv ON sv.schedule_version_id = ta.schedule_version_id
           WHERE ta.astronaut_id = ? AND substr(ta.planned_start, 1, 10) = ?
             AND COALESCE(sv.status, '') NOT IN ('rejected', 'superseded')
           ORDER BY ta.planned_start""",
        (astronaut_id, date))]
    recovery = [dict(r) for r in conn.execute(
        """SELECT sr.scheduled_recovery_id, ra.activity_name, sr.scheduled_start, sr.scheduled_end,
                  sr.completion_status, sr.completed_at, sr.astronaut_feedback FROM scheduled_recovery sr
           JOIN recovery_activities ra ON ra.recovery_activity_id = sr.recovery_activity_id
           WHERE sr.astronaut_id = ? AND substr(sr.scheduled_start, 1, 10) = ? ORDER BY sr.scheduled_start""",
        (astronaut_id, date))]
    return {"astronaut_id": astronaut_id, "date": date, "schedule_entries": schedule,
            "task_assignments": tasks, "recovery": recovery}


def get_pre_assessment_sleep_context(conn: sqlite3.Connection, astronaut_id: str,
                                     assessment_time: datetime) -> dict[str, Any]:
    """The last sleep that ended before an assessment, next to the context recorded with the test.

    The two sources are generated separately and can disagree (about 19 minutes on average),
    so both are returned along with the difference.
    """
    require_astronaut(conn, astronaut_id)
    at = to_iso(assessment_time)
    sleep = conn.execute(
        """SELECT sleep_id, sleep_start, sleep_end, total_sleep_minutes, sleep_efficiency_percent,
                  sleep_quality_score FROM sleep_records
           WHERE astronaut_id = ? AND sleep_end <= ? ORDER BY sleep_end DESC LIMIT 1""",
        (astronaut_id, at)).fetchone()
    context = conn.execute(
        """SELECT context_id, timestamp_utc, prior_sleep_hours, fatigue_score, sleepiness_score,
                  perceived_workload, circadian_condition FROM assessment_context
           WHERE astronaut_id = ? AND timestamp_utc <= ? ORDER BY timestamp_utc DESC LIMIT 1""",
        (astronaut_id, at)).fetchone()
    if sleep is None and context is None:
        raise NotFound("No sleep record or assessment context before that time")
    sleep_d, context_d = (dict(sleep) if sleep else None), (dict(context) if context else None)
    diff = None
    if sleep_d and context_d and context_d["prior_sleep_hours"] is not None:
        diff = round(context_d["prior_sleep_hours"] * 60 - sleep_d["total_sleep_minutes"], 1)
    return {"astronaut_id": astronaut_id, "assessment_time": at, "sleep_record": sleep_d,
            "assessment_context": context_d, "context_minus_record_minutes": diff}
