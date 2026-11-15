"""Task catalogue (plan section 3, Phase 4).

Each mission day has one preloaded task set (daily_task_sets) of dated tasks (mission_tasks),
each with reviewed requirements (task_requirements) and finish-to-start dependencies
(task_dependencies). Planning always starts from this payload.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from app.core.errors import NotFound, ValidationFailed

PRIORITY_WEIGHT = {"high": 3, "medium": 2, "low": 1}


def get_available_task_sets(conn: sqlite3.Connection, mission_id: str = "MIS-001", from_day: int | None = None,
                            to_day: int | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT s.*, COUNT(t.task_id) AS task_count, COALESCE(SUM(t.estimated_duration_minutes), 0) AS total_minutes
           FROM daily_task_sets s LEFT JOIN mission_tasks t ON t.task_set_id = s.task_set_id
           WHERE s.mission_id = ? AND (? IS NULL OR s.mission_day >= ?) AND (? IS NULL OR s.mission_day <= ?)
           GROUP BY s.task_set_id ORDER BY s.mission_day""",
        (mission_id, from_day, from_day, to_day, to_day)).fetchall()
    return [dict(r) for r in rows]


def _task_set(conn: sqlite3.Connection, task_set_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM daily_task_sets WHERE task_set_id = ?", (task_set_id,)).fetchone()
    if row is None:
        raise NotFound(f"Task set {task_set_id} not found")
    return row


def get_tasks_for_task_set(conn: sqlite3.Connection, task_set_id: str) -> list[dict[str, Any]]:
    """Tasks with their requirements and the tasks each one depends on."""
    _task_set(conn, task_set_id)
    tasks = []
    for t in conn.execute(
            """SELECT t.*, r.requirement_id, r.required_specialization, r.required_certification,
                      r.cognitive_demand_score, r.physical_demand_score, r.attention_demand_score,
                      r.time_pressure_score, r.safety_classification, r.review_status
               FROM mission_tasks t LEFT JOIN task_requirements r ON r.task_id = t.task_id
               WHERE t.task_set_id = ? ORDER BY t.task_id""", (task_set_id,)):
        task = dict(t)
        task["depends_on"] = [r[0] for r in conn.execute(
            "SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_task_id",
            (task["task_id"],))]
        tasks.append(task)
    return tasks


def validate_task_dependencies(tasks: list[dict[str, Any]]) -> list[str]:
    """Check dependencies stay inside the set and have no cycles. Returns task IDs in dependency order."""
    ids = {t["task_id"] for t in tasks}
    outside = [(t["task_id"], d) for t in tasks for d in t["depends_on"] if d not in ids]
    if outside:
        raise ValidationFailed("Tasks depend on tasks outside this task set", outside)
    remaining = {t["task_id"]: set(t["depends_on"]) for t in tasks}
    order: list[str] = []
    while remaining:
        ready = sorted(t for t, deps in remaining.items() if not deps)
        if not ready:
            raise ValidationFailed("Task dependencies contain a cycle", sorted(remaining))
        for t in ready:
            order.append(t)
            del remaining[t]
        for deps in remaining.values():
            deps.difference_update(ready)
    return order


def get_task_planning_payload(conn: sqlite3.Connection, task_set_id: str) -> dict[str, Any]:
    """Everything the scheduler needs about one day's tasks, in dependency order."""
    task_set = dict(_task_set(conn, task_set_id))
    tasks = get_tasks_for_task_set(conn, task_set_id)
    missing = [t["task_id"] for t in tasks if t["requirement_id"] is None]
    if missing:
        raise ValidationFailed("Tasks without reviewed requirements cannot be planned", missing)
    order = validate_task_dependencies(tasks)
    by_id = {t["task_id"]: t for t in tasks}
    return {"task_set": task_set, "tasks": [by_id[i] for i in order], "dependency_order": order,
            "total_minutes": sum(t["estimated_duration_minutes"] for t in tasks)}
