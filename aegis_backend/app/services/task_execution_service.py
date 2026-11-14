"""Recording what actually happened to a published task assignment.

    scheduled --start--> in_progress --complete--> completed
    scheduled --skip--> skipped          in_progress --skip--> skipped

* Only assignments from a PUBLISHED schedule can be started. Seed demo plans, drafts and
  superseded plans cannot.
* The assigned astronaut records their own work; the mission leader can record for anyone.
* A task cannot start until every task it depends on is completed in the same plan.
* Times are mission time: the simulation run's clock, or an earlier time passed as `at`.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from app.core import permissions
from app.core.errors import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services import auth_service, mission_simulator
from app.services.audit_service import write_audit
from app.utils.timestamps import parse_iso, to_iso

SCHEDULED, IN_PROGRESS, COMPLETED, SKIPPED = "scheduled", "in_progress", "completed", "skipped"

_SQL = """SELECT a.*, t.task_title, t.task_category, t.priority, t.task_set_id, v.status AS version_status
          FROM task_assignments a JOIN mission_tasks t ON t.task_id = a.task_id
          LEFT JOIN schedule_versions v ON v.schedule_version_id = a.schedule_version_id"""


def get_assignment(conn: sqlite3.Connection, task_assignment_id: str) -> dict[str, Any]:
    row = conn.execute(f"{_SQL} WHERE a.task_assignment_id = ?", (task_assignment_id,)).fetchone()
    if row is None:
        raise NotFound(f"Task assignment {task_assignment_id} not found")
    return dict(row)


def list_assignments(conn: sqlite3.Connection, astronaut_ids: list[str], *, simulation_run_id: str,
                     date: str | None = None, assignment_status: str | None = None) -> list[dict[str, Any]]:
    """Assignments on the crew calendar (published plans) plus the seed demo plan."""
    if not astronaut_ids:
        return []
    marks = ",".join("?" * len(astronaut_ids))
    rows = conn.execute(
        f"""{_SQL} WHERE a.astronaut_id IN ({marks}) AND a.simulation_run_id = ?
              AND v.status IN ('published', 'demo_unapproved')
              AND (? IS NULL OR substr(a.planned_start, 1, 10) = ?) AND (? IS NULL OR a.assignment_status = ?)
            ORDER BY a.planned_start, a.astronaut_id""",
        (*astronaut_ids, simulation_run_id, date, date, assignment_status, assignment_status)).fetchall()
    return [dict(r) for r in rows]


def _prepare(conn: sqlite3.Connection, task_assignment_id: str, user: dict[str, Any], action: str,
             at: datetime | None) -> tuple[dict[str, Any], datetime]:
    a = get_assignment(conn, task_assignment_id)
    own = user.get("role_name") == permissions.ASTRONAUT \
        and a["astronaut_id"] in auth_service.get_permitted_astronauts(conn, user)
    if not own and user.get("role_name") != permissions.MISSION_LEADER:
        raise PermissionDenied("Only the assigned astronaut, or the mission leader, can record this")
    if a["version_status"] != "published":
        why = ("Seed demo plans are fictional" if a["version_status"] == "demo_unapproved"
               else f"Its schedule version is '{a['version_status']}'")
        raise Conflict(f"{why}; only tasks from a published schedule can be recorded")
    now = parse_iso(mission_simulator.get_simulation_state(conn, a["simulation_run_id"])["current_mission_time"])
    when = at or now
    if when > now:
        raise ValidationFailed("That time is in the future for this simulation run")
    if to_iso(when)[:10] != a["planned_start"][:10]:
        raise ValidationFailed(f"This task is planned for {a['planned_start'][:10]}; it cannot be recorded on "
                               f"{to_iso(when)[:10]}")
    return a, when


def _finish(conn: sqlite3.Connection, a: dict[str, Any], user: dict[str, Any], action: str, summary: str) -> dict:
    write_audit(conn, user_id=user["user_id"], action_type=f"task_{action}", entity_type="task_assignment",
                entity_id=a["task_assignment_id"], action_result="success", change_summary=summary[:500],
                commit=False)
    conn.commit()
    return get_assignment(conn, a["task_assignment_id"])


def start_assignment(conn: sqlite3.Connection, task_assignment_id: str, user: dict[str, Any],
                     at: datetime | None = None) -> dict[str, Any]:
    a, when = _prepare(conn, task_assignment_id, user, "start", at)
    if a["assignment_status"] != SCHEDULED:
        raise Conflict(f"Assignment is '{a['assignment_status']}', so it cannot be started")
    waiting = [r["task_title"] for r in conn.execute(
        """SELECT t.task_title FROM task_dependencies d JOIN mission_tasks t ON t.task_id = d.depends_on_task_id
           WHERE d.task_id = ? AND NOT EXISTS (
               SELECT 1 FROM task_assignments x WHERE x.task_id = d.depends_on_task_id
               AND x.schedule_version_id = ? AND x.assignment_status = 'completed')""",
        (a["task_id"], a["schedule_version_id"]))]
    if waiting:
        raise Conflict("This task depends on tasks that are not completed yet", waiting)
    conn.execute("UPDATE task_assignments SET assignment_status = ?, actual_start = ? WHERE task_assignment_id = ?",
                 (IN_PROGRESS, to_iso(when), task_assignment_id))
    late = round((when - parse_iso(a["planned_start"])).total_seconds() / 60)
    return _finish(conn, a, user, "started", f"started {late:+d} min against plan")


def complete_assignment(conn: sqlite3.Connection, task_assignment_id: str, user: dict[str, Any],
                        at: datetime | None = None) -> dict[str, Any]:
    a, when = _prepare(conn, task_assignment_id, user, "complete", at)
    if a["assignment_status"] != IN_PROGRESS:
        raise Conflict(f"Assignment is '{a['assignment_status']}'; start it before completing it")
    if when < parse_iso(a["actual_start"]):
        raise ValidationFailed("A task cannot end before it started")
    conn.execute("UPDATE task_assignments SET assignment_status = ?, actual_end = ? WHERE task_assignment_id = ?",
                 (COMPLETED, to_iso(when), task_assignment_id))
    minutes = round((when - parse_iso(a["actual_start"])).total_seconds() / 60)
    return _finish(conn, a, user, "completed", f"took {minutes} min")


def skip_assignment(conn: sqlite3.Connection, task_assignment_id: str, user: dict[str, Any],
                    reason: str = "", at: datetime | None = None) -> dict[str, Any]:
    a, _when = _prepare(conn, task_assignment_id, user, "skip", at)
    if a["assignment_status"] not in (SCHEDULED, IN_PROGRESS):
        raise Conflict(f"Assignment is '{a['assignment_status']}', so it cannot be skipped")
    if not reason.strip():
        raise ValidationFailed("Give a reason for skipping a task")
    conn.execute("UPDATE task_assignments SET assignment_status = ? WHERE task_assignment_id = ?",
                 (SKIPPED, task_assignment_id))
    return _finish(conn, a, user, "skipped", reason.strip())
