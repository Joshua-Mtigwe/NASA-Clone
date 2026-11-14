"""Schedule versions and approval (plan sections 1 and 3, Phase 4).

    optimiser -> draft --approve--> approved --publish--> published
                 draft --reject--> rejected
    Approving a newer version marks older approved/published versions 'superseded'.

* The optimiser only ever writes DRAFTS: one ai_task_recommendations row (status 'proposed',
  constraint_check_status set by the scheduler, never by an AI model) and one task_assignments
  row per astronaut per task.
* Only the mission leader approves, rejects or publishes. Approval re-checks every hard rule
  at that moment (eligibility, overlaps, dependencies, deadlines, workload), so a draft that
  became unsafe since it was made cannot be approved.
* Publishing writes the tasks into daily_schedules, where the Astronaut Health schedule shows them.
* Seed versions ('demo_unapproved') are fictional and can never be approved.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import timedelta
from typing import Any

from app.core import permissions
from app.core.errors import Conflict, NotFound
from app.services import auth_service
from app.services import crew_readiness_service as readiness
from app.services.audit_service import write_audit
from app.utils.timestamps import parse_iso, to_iso, utcnow

DRAFT, APPROVED, PUBLISHED, REJECTED, SUPERSEDED = "draft", "approved", "published", "rejected", "superseded"


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12].upper()}"


def create_schedule_draft(conn: sqlite3.Connection, problem: dict[str, Any], result: dict[str, Any], *,
                          optimization_run_id: str, actor_user_id: str | None) -> dict[str, Any]:
    """Record a solver result as a new draft version. Caller commits."""
    from app.services.scheduling_optimizer import hhmm

    run_id, set_id = problem["simulation_run_id"], problem["task_set_id"]
    mission_id = conn.execute("SELECT mission_id FROM daily_task_sets WHERE task_set_id = ?", (set_id,)).fetchone()[0]
    number = conn.execute("SELECT COALESCE(MAX(version_number), 0) + 1 FROM schedule_versions "
                          "WHERE simulation_run_id = ? AND task_set_id = ?", (run_id, set_id)).fetchone()[0]
    version_id = _id("SV")
    now = to_iso(utcnow())
    conn.execute(
        """INSERT INTO schedule_versions (schedule_version_id, simulation_run_id, mission_id, task_set_id,
               version_number, status, created_by_user_id, approved_by_user_id, created_at, approved_at,
               optimization_run_id) VALUES (?, ?, ?, ?, ?, 'draft', ?, NULL, ?, NULL, ?)""",
        (version_id, run_id, mission_id, set_id, number, actor_user_id, now, optimization_run_id))
    tasks = {t["task_id"]: t for t in problem["tasks"]}
    crew = {a["astronaut_id"]: a for a in problem["astronauts"]}
    day_start = parse_iso(problem["day_start"])
    for a in result["assignments"]:
        task = tasks[a["task_id"]]
        for astronaut_id in a["astronaut_ids"]:
            flags = problem["eligibility_flags"].get(a["task_id"], {}).get(astronaut_id, [])
            reason = (f"Holds {task['required_certification']}"
                      f"{' (not verified; standard task)' if 'qualification_not_verified' in flags else ''}; "
                      f"readiness {crew[astronaut_id]['readiness_id']}; {hhmm(a['start'])}-{hhmm(a['end'])} "
                      f"after dependencies, outside commitments, within workload limit. "
                      f"Chosen by {result['solver_version']} (objective {problem['objective_version']}).")
            rec_id = _id("REC")
            conn.execute(
                """INSERT INTO ai_task_recommendations (recommendation_id, task_id, astronaut_id, readiness_id,
                       model_version, recommendation_status, recommendation_reason, constraint_check_status,
                       generated_at) VALUES (?, ?, ?, ?, ?, 'proposed', ?, 'passed', ?)""",
                (rec_id, a["task_id"], astronaut_id, crew[astronaut_id]["readiness_id"], result["solver_version"],
                 reason, now))
            conn.execute(
                """INSERT INTO task_assignments (task_assignment_id, task_id, astronaut_id, recommendation_id,
                       assigned_by_user_id, assignment_status, planned_start, planned_end, actual_start, actual_end,
                       approval_status, approved_at, schedule_version_id, simulation_run_id)
                   VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, NULL, NULL, 'pending_approval', NULL, ?, ?)""",
                (_id("TA"), a["task_id"], astronaut_id, rec_id, actor_user_id,
                 to_iso(day_start + timedelta(minutes=a["start"])), to_iso(day_start + timedelta(minutes=a["end"])),
                 version_id, run_id))
    return get_schedule_version(conn, version_id)


def get_schedule_version(conn: sqlite3.Connection, schedule_version_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM schedule_versions WHERE schedule_version_id = ?",
                       (schedule_version_id,)).fetchone()
    if row is None:
        raise NotFound(f"Schedule version {schedule_version_id} not found")
    version = dict(row)
    version["assignments"] = [dict(r) for r in conn.execute(
        """SELECT ta.*, mt.task_title, mt.priority, r.required_certification, rec.recommendation_reason
           FROM task_assignments ta JOIN mission_tasks mt ON mt.task_id = ta.task_id
           LEFT JOIN task_requirements r ON r.task_id = ta.task_id
           LEFT JOIN ai_task_recommendations rec ON rec.recommendation_id = ta.recommendation_id
           WHERE ta.schedule_version_id = ? ORDER BY ta.planned_start, ta.task_id""", (schedule_version_id,))]
    return version


def list_schedule_versions(conn: sqlite3.Connection, simulation_run_id: str | None = None,
                           task_set_id: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT v.*, (SELECT COUNT(*) FROM task_assignments ta WHERE ta.schedule_version_id = v.schedule_version_id)
                  AS assignment_count
           FROM schedule_versions v WHERE (? IS NULL OR simulation_run_id = ?) AND (? IS NULL OR task_set_id = ?)
           ORDER BY created_at, version_number""",
        (simulation_run_id, simulation_run_id, task_set_id, task_set_id)).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------- re-validation

def validate_schedule_version(conn: sqlite3.Connection, version: dict[str, Any]) -> list[str]:
    """Every hard rule, re-checked now. Returns problems (empty = safe to approve)."""
    from app.services.scheduling_optimizer import _blocked_intervals
    from app.services.task_service import get_tasks_for_task_set

    problems: list[str] = []
    assignments = version["assignments"]
    if not assignments:
        return ["Version has no assignments"]
    tasks = {t["task_id"]: t for t in get_tasks_for_task_set(conn, version["task_set_id"])}
    day = next(iter(tasks.values()))["task_date"]
    day_start = parse_iso(day)
    by_task: dict[str, list] = {}
    by_astronaut: dict[str, list] = {}
    for a in assignments:
        by_task.setdefault(a["task_id"], []).append(a)
        by_astronaut.setdefault(a["astronaut_id"], []).append(a)

    for a in assignments:
        task = tasks[a["task_id"]]
        start, end = parse_iso(a["planned_start"]), parse_iso(a["planned_end"])
        eligibility = readiness.check_task_eligibility(conn, a["astronaut_id"], task, start)
        if not eligibility["eligible"]:
            problems.append(f"{a['astronaut_id']} is no longer eligible for {a['task_id']}: "
                            f"{'; '.join(eligibility['reasons'])}")
        if task["deadline"] and end > parse_iso(task["deadline"]):
            problems.append(f"{a['task_id']} ends after its deadline")
        for dep in task["depends_on"]:
            if dep not in by_task:
                problems.append(f"{a['task_id']} depends on {dep}, which is not in this schedule")
            elif any(parse_iso(d["planned_end"]) > start for d in by_task[dep]):
                problems.append(f"{a['task_id']} starts before {dep} finishes")
    for task_id, rows in by_task.items():
        if len(rows) != (tasks[task_id]["required_crew_count"] or 1):
            problems.append(f"{task_id} needs {tasks[task_id]['required_crew_count']} crew, has {len(rows)}")

    for astronaut_id, rows in by_astronaut.items():
        spans = sorted((parse_iso(r["planned_start"]), parse_iso(r["planned_end"]), r["task_id"]) for r in rows)
        for (s1, e1, t1), (s2, e2, t2) in zip(spans, spans[1:]):
            if s2 < e1:
                problems.append(f"{astronaut_id}: {t1} and {t2} overlap")
        blocked = _blocked_intervals(conn, astronaut_id, day, day_start, 0)
        for s, e, task_id in spans:
            sm, em = int((s - day_start).total_seconds() // 60), int((e - day_start).total_seconds() // 60)
            for bs, be, label in blocked:
                if sm < be and em > bs:
                    problems.append(f"{astronaut_id}: {task_id} overlaps {label}")
        limit = readiness.get_latest_valid_readiness(conn, astronaut_id, spans[0][0])
        minutes = sum((e - s).total_seconds() / 60 for s, e, _ in spans)
        if limit and minutes > (limit["workload_limit_minutes"] or 0):
            problems.append(f"{astronaut_id}: {minutes:.0f} min planned exceeds limit {limit['workload_limit_minutes']}")
    return problems


# --------------------------------------------------------------------------- transitions

def _load(conn: sqlite3.Connection, schedule_version_id: str, expected: str) -> dict[str, Any]:
    version = get_schedule_version(conn, schedule_version_id)
    if version["status"] == "demo_unapproved":
        raise Conflict("Seed demo schedules are fictional and cannot be approved or published")
    if version["status"] != expected:
        raise Conflict(f"Version is {version['status']}, expected {expected}")
    return version


def supersede_schedule(conn: sqlite3.Connection, simulation_run_id: str, task_set_id: str,
                       keep_version_id: str) -> list[str]:
    """Mark other approved/published versions for the same run and day as superseded. Caller commits."""
    older = [r[0] for r in conn.execute(
        """SELECT schedule_version_id FROM schedule_versions WHERE simulation_run_id = ? AND task_set_id = ?
           AND status IN ('approved', 'published') AND schedule_version_id != ?""",
        (simulation_run_id, task_set_id, keep_version_id))]
    for vid in older:
        conn.execute("UPDATE schedule_versions SET status = 'superseded' WHERE schedule_version_id = ?", (vid,))
        conn.execute("UPDATE task_assignments SET approval_status = 'superseded', assignment_status = 'superseded' "
                     "WHERE schedule_version_id = ?", (vid,))
        conn.execute("UPDATE daily_schedules SET schedule_status = 'superseded' WHERE schedule_version_id = ?", (vid,))
    return older


def approve_schedule_version(conn: sqlite3.Connection, schedule_version_id: str, user: dict[str, Any]) -> dict[str, Any]:
    auth_service.require_role(user, permissions.MISSION_LEADER)
    version = _load(conn, schedule_version_id, DRAFT)
    problems = validate_schedule_version(conn, version)
    if problems:
        write_audit(conn, user_id=user["user_id"], action_type="approve_schedule_version",
                    entity_type="schedule_version", entity_id=schedule_version_id, action_result="denied",
                    change_summary="; ".join(problems)[:500])
        raise Conflict("Schedule failed safety re-check and cannot be approved", problems)
    now = to_iso(utcnow())
    try:
        older = supersede_schedule(conn, version["simulation_run_id"], version["task_set_id"], schedule_version_id)
        conn.execute("UPDATE schedule_versions SET status = 'approved', approved_by_user_id = ?, approved_at = ? "
                     "WHERE schedule_version_id = ?", (user["user_id"], now, schedule_version_id))
        conn.execute("UPDATE task_assignments SET approval_status = 'approved', approved_at = ?, "
                     "assignment_status = 'approved' WHERE schedule_version_id = ?", (now, schedule_version_id))
        conn.execute("""UPDATE ai_task_recommendations SET recommendation_status = 'accepted' WHERE recommendation_id IN
                        (SELECT recommendation_id FROM task_assignments WHERE schedule_version_id = ?)""",
                     (schedule_version_id,))
        write_audit(conn, user_id=user["user_id"], action_type="approve_schedule_version",
                    entity_type="schedule_version", entity_id=schedule_version_id, action_result="success",
                    change_summary=f"{len(version['assignments'])} assignments; superseded {older or 'none'}",
                    commit=False)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return get_schedule_version(conn, schedule_version_id)


def reject_schedule_version(conn: sqlite3.Connection, schedule_version_id: str, user: dict[str, Any],
                            reason: str = "") -> dict[str, Any]:
    auth_service.require_role(user, permissions.MISSION_LEADER)
    _load(conn, schedule_version_id, DRAFT)
    conn.execute("UPDATE schedule_versions SET status = 'rejected' WHERE schedule_version_id = ?",
                 (schedule_version_id,))
    conn.execute("UPDATE task_assignments SET approval_status = 'rejected', assignment_status = 'rejected' "
                 "WHERE schedule_version_id = ?", (schedule_version_id,))
    conn.execute("""UPDATE ai_task_recommendations SET recommendation_status = 'rejected' WHERE recommendation_id IN
                    (SELECT recommendation_id FROM task_assignments WHERE schedule_version_id = ?)""",
                 (schedule_version_id,))
    write_audit(conn, user_id=user["user_id"], action_type="reject_schedule_version", entity_type="schedule_version",
                entity_id=schedule_version_id, action_result="success", change_summary=reason[:500], commit=False)
    conn.commit()
    return get_schedule_version(conn, schedule_version_id)


def publish_approved_schedule(conn: sqlite3.Connection, schedule_version_id: str, user: dict[str, Any]) -> dict[str, Any]:
    """Put an approved version on the crew calendar (daily_schedules)."""
    auth_service.require_role(user, permissions.MISSION_LEADER)
    version = _load(conn, schedule_version_id, APPROVED)
    try:
        for a in version["assignments"]:
            mission_id = conn.execute("SELECT mission_id FROM astronauts WHERE astronaut_id = ?",
                                      (a["astronaut_id"],)).fetchone()[0]
            conn.execute(
                """INSERT INTO daily_schedules (schedule_id, astronaut_id, mission_id, schedule_date, activity_type,
                       activity_reference_id, start_time, end_time, schedule_status, approved_by_user_id,
                       schedule_version_id, simulation_run_id, approval_status)
                   VALUES (?, ?, ?, ?, 'task', ?, ?, ?, 'published', ?, ?, ?, 'approved')""",
                (_id("SCH"), a["astronaut_id"], mission_id, a["planned_start"][:10], a["task_assignment_id"],
                 a["planned_start"], a["planned_end"], version["approved_by_user_id"], schedule_version_id,
                 version["simulation_run_id"]))
        conn.execute("UPDATE task_assignments SET assignment_status = 'scheduled' WHERE schedule_version_id = ?",
                     (schedule_version_id,))
        conn.execute("UPDATE schedule_versions SET status = 'published' WHERE schedule_version_id = ?",
                     (schedule_version_id,))
        write_audit(conn, user_id=user["user_id"], action_type="publish_schedule_version",
                    entity_type="schedule_version", entity_id=schedule_version_id, action_result="success",
                    change_summary=f"{len(version['assignments'])} tasks published", commit=False)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return get_schedule_version(conn, schedule_version_id)
