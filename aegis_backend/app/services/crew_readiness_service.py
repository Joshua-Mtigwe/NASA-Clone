"""Crew readiness and qualification checks (plan section 3, Phase 4).

Who MAY be given a task is decided here, before any optimisation, and it fails closed:

  * Qualification: the astronaut must hold the task's required certification, valid on the
    task date. A 'demo_assumed_not_verified' qualification is accepted for standard tasks
    (and flagged), but NEVER for safety-critical ones, which need a verified qualification.
    Any safety classification not known to be standard counts as safety-critical.
  * Readiness: there must be a readiness record valid at the planned time, with an eligible
    status. 'demo_eligible' (the seed) is accepted for planning and flagged as synthetic.
  * Restrictions: known codes are applied; an unknown code blocks the assignment.

Cognitive results are NOT a gate. They are a soft preference for the optimiser (see
cognitive_flags), because a statistical comparison is not a medical decision.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from app.core.config import get_settings
from app.services.health_context import require_astronaut
from app.utils.timestamps import parse_iso, to_iso

VERIFIED = "verified"
DEMO_UNVERIFIED = "demo_assumed_not_verified"
STANDARD_CLASSIFICATIONS = frozenset({"standard", "standard_demo"})
ELIGIBLE_STATUSES = frozenset({"eligible", "demo_eligible"})
NO_RESTRICTION = frozenset({"", "none"})
HIGH_DEMAND = 4  # demand score from which a task counts as high cognitive / attention / physical demand

# Restriction code -> (description, test that returns True when the task is NOT allowed)
RESTRICTIONS = {
    "no_safety_critical": ("No safety-critical tasks", lambda task: is_safety_critical(task)),
    "light_duty": ("No high physical demand", lambda task: (task.get("physical_demand_score") or 0) >= HIGH_DEMAND),
    "no_high_cognitive": ("No high cognitive demand",
                          lambda task: (task.get("cognitive_demand_score") or 0) >= HIGH_DEMAND),
}


def is_safety_critical(task: dict[str, Any]) -> bool:
    return (task.get("safety_classification") or "") not in STANDARD_CLASSIFICATIONS


def list_qualifications(conn: sqlite3.Connection, astronaut_id: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT q.*, a.specialization, a.crew_role FROM astronaut_qualifications q
           JOIN astronauts a ON a.astronaut_id = q.astronaut_id
           WHERE (? IS NULL OR q.astronaut_id = ?) ORDER BY q.astronaut_id, q.qualification_code""",
        (astronaut_id, astronaut_id)).fetchall()
    return [{**dict(r), "is_verified": r["authorization_status"] == VERIFIED} for r in rows]


def get_latest_valid_readiness(conn: sqlite3.Connection, astronaut_id: str, at: datetime) -> dict[str, Any] | None:
    """Newest readiness record assessed on or before `at`'s date and still valid at `at`."""
    row = conn.execute(
        """SELECT * FROM crew_readiness WHERE astronaut_id = ? AND assessment_date <= ? AND valid_until > ?
           ORDER BY assessment_date DESC LIMIT 1""",
        (astronaut_id, to_iso(at)[:10], to_iso(at))).fetchone()
    return dict(row) if row else None


def get_crew_readiness(conn: sqlite3.Connection, at: datetime, mission_id: str = "MIS-001") -> list[dict[str, Any]]:
    out = []
    for (astronaut_id,) in conn.execute("SELECT astronaut_id FROM astronauts WHERE mission_id = ? ORDER BY astronaut_id",
                                        (mission_id,)):
        readiness = get_latest_valid_readiness(conn, astronaut_id, at)
        out.append({"astronaut_id": astronaut_id, "readiness": readiness,
                    "status": readiness["operational_eligibility_status"] if readiness else "no_valid_readiness"})
    return out


def check_task_qualification(conn: sqlite3.Connection, astronaut_id: str, task: dict[str, Any]) -> dict[str, Any]:
    """Does the astronaut hold the task's certification, valid on the task date?"""
    required = task.get("required_certification")
    safety_critical = is_safety_critical(task)
    if not required:
        return {"qualified": False, "status": "no_requirement",
                "reasons": ["Task has no required certification; it must be reviewed before planning"]}
    task_date = (task.get("task_date") or "")[:10]
    rows = conn.execute(
        "SELECT * FROM astronaut_qualifications WHERE astronaut_id = ? AND qualification_code = ?",
        (astronaut_id, required)).fetchall()
    if not rows:
        return {"qualified": False, "status": "missing", "reasons": [f"Does not hold {required}"]}
    current = [r for r in rows if (r["valid_from"] or "") <= task_date <= (r["valid_until"] or "9999")]
    if not current:
        return {"qualified": False, "status": "expired", "reasons": [f"{required} is not valid on {task_date}"]}
    if any(r["authorization_status"] == VERIFIED for r in current):
        return {"qualified": True, "status": "verified", "reasons": []}
    if any(r["authorization_status"] == DEMO_UNVERIFIED for r in current):
        if safety_critical:
            return {"qualified": False, "status": "unverified_for_safety_critical",
                    "reasons": [f"{required} is demo_assumed_not_verified; safety-critical tasks need a verified "
                                "qualification"]}
        return {"qualified": True, "status": "demo_unverified",
                "reasons": [f"{required} accepted for a standard task but is NOT verified"]}
    statuses = sorted({r["authorization_status"] for r in current})
    return {"qualified": False, "status": "not_authorized", "reasons": [f"{required} has status {statuses}"]}


def check_task_eligibility(conn: sqlite3.Connection, astronaut_id: str, task: dict[str, Any],
                           at: datetime) -> dict[str, Any]:
    """Qualification + readiness + restrictions. eligible=False comes with every reason found."""
    require_astronaut(conn, astronaut_id)
    reasons: list[str] = []
    flags: list[str] = []
    qualification = check_task_qualification(conn, astronaut_id, task)
    if qualification["qualified"]:
        if qualification["status"] == "demo_unverified":
            flags.append("qualification_not_verified")
    else:
        reasons += qualification["reasons"]

    readiness = get_latest_valid_readiness(conn, astronaut_id, at)
    workload_limit = None
    if readiness is None:
        reasons.append(f"No readiness record valid at {to_iso(at)}")
    else:
        status = readiness["operational_eligibility_status"]
        if status not in ELIGIBLE_STATUSES:
            reasons.append(f"Readiness status is {status}")
        elif status == "demo_eligible":
            flags.append("readiness_is_synthetic_demo")
        workload_limit = readiness["workload_limit_minutes"]
        if not workload_limit or workload_limit <= 0:
            reasons.append("Readiness gives no workload allowance")
        codes = [c.strip() for c in (readiness["restriction_codes"] or "").replace("|", ";").split(";")]
        for code in [c for c in codes if c not in NO_RESTRICTION]:
            if code not in RESTRICTIONS:
                reasons.append(f"Unrecognised restriction '{code}' (blocked until reviewed)")
            elif RESTRICTIONS[code][1](task):
                reasons.append(f"Restriction '{code}': {RESTRICTIONS[code][0]}")
    return {
        "astronaut_id": astronaut_id, "task_id": task["task_id"], "eligible": not reasons,
        "reasons": reasons, "flags": flags, "qualification_status": qualification["status"],
        "safety_critical": is_safety_critical(task),
        "readiness_id": readiness["readiness_id"] if readiness else None, "workload_limit_minutes": workload_limit,
    }


def cognitive_flags(conn: sqlite3.Connection, astronaut_id: str, date: str,
                    simulation_run_id: str | None = None) -> list[str]:
    """Tests that came out 'outside_range_worse' for this astronaut on this date (soft planning input)."""
    from app.services.cognitive_comparison_service import get_cognitive_comparisons  # avoid import cycle

    result = get_cognitive_comparisons(conn, astronaut_id, date, date, simulation_run_id
                                       or get_settings().default_template_run_id)
    return sorted({c["protocol_id"] for c in result["comparisons"] if c["interpretation"] == "outside_range_worse"})


def build_crew_planning_matrix(conn: sqlite3.Connection, tasks: list[dict[str, Any]], at: datetime,
                               mission_id: str = "MIS-001", simulation_run_id: str | None = None) -> dict[str, Any]:
    """Eligibility of every astronaut for every task, plus readiness and cognitive flags per astronaut."""
    astronauts = [r[0] for r in conn.execute(
        "SELECT astronaut_id FROM astronauts WHERE mission_id = ? ORDER BY astronaut_id", (mission_id,))]
    date = to_iso(at)[:10]
    crew = {}
    for a in astronauts:
        readiness = get_latest_valid_readiness(conn, a, at)
        crew[a] = {"readiness_id": readiness["readiness_id"] if readiness else None,
                   "workload_limit_minutes": readiness["workload_limit_minutes"] if readiness else None,
                   "readiness_status": readiness["operational_eligibility_status"] if readiness else None,
                   "cognitive_flags": cognitive_flags(conn, a, date, simulation_run_id)}
    matrix = {t["task_id"]: {a: check_task_eligibility(conn, a, t, at) for a in astronauts} for t in tasks}
    no_one = [t for t, row in matrix.items() if not any(e["eligible"] for e in row.values())]
    return {"at": to_iso(at), "astronauts": crew, "matrix": matrix, "tasks_with_no_eligible_astronaut": no_one}


def readiness_time_for(task_date: str, workday_start_hour: int) -> datetime:
    return parse_iso(f"{task_date[:10]}T{workday_start_hour:02d}:00:00Z")
