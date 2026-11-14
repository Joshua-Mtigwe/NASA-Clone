"""Recovery Planner (Phase 4, second half): catalogue, recommendations, review, booking and completion.

    generate -> pending_review --approve--> approved --schedule--> booked (planned)
                pending_review --reject--> rejected
    booked: planned --complete--> completed      planned --skip--> skipped

* Recommendations come from fixed rules (RULES_VERSION), not an AI model. Each one compares the
  astronaut's last night and this morning with their own earlier days and keeps the evidence.
* Only activities the medical officer approved in the catalogue can be recommended.
* The medical officer approves, rejects and books. The astronaut (or the medical officer) records
  whether a booked recovery was done.
* Seeded recommendations and bookings are fictional demo rows and cannot be approved or completed.

A recommendation is a suggestion from a statistical comparison. It is not a diagnosis or treatment.
"""
from __future__ import annotations

import json
import sqlite3
import statistics
import uuid
from datetime import datetime, timedelta
from typing import Any

from app.core import permissions
from app.core.config import get_settings
from app.core.errors import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services import auth_service, mission_simulator
from app.services import cognitive_comparison_service as comparisons
from app.services.audit_service import write_audit
from app.services.health_context import mission_launch, require_astronaut
from app.utils.timestamps import parse_iso, to_iso

RULES_VERSION = "rules_v1"
DEMO_VERSION = "demo_rules_v1"
MIN_HISTORY = 5  # earlier values needed before "unusual for this astronaut" means anything
SIGNAL_Z = 1.0  # a value counts once it is 1 SD away from the astronaut's own earlier average
MIN_SCORE = 0.2
PENDING, APPROVED, REJECTED = "pending_review", "approved", "rejected"
PLANNED, COMPLETED, SKIPPED = "planned", "completed", "skipped"

NOTE = ("Suggested by fixed rules from a comparison with this astronaut's own earlier days. "
        "A suggestion for the medical officer to review; not a diagnosis or treatment.")

# How much each signal counts towards each kind of activity. Activity-specific rows win over category rows.
_CATEGORY_WEIGHTS = {
    "sleep": {"short_sleep": 1.0, "high_fatigue": 0.4},
    "rest": {"high_fatigue": 0.8, "cognitive_dip": 0.7, "high_workload": 0.4},
    "relaxation": {"high_workload": 0.8, "high_fatigue": 0.3},
    "mobility": {"high_fatigue": 0.3, "short_sleep": 0.2},
    # 'exercise' is already on every day's calendar, so the rules never add more of it.
}
_ACTIVITY_WEIGHTS = {"REC-005": {"cognitive_dip": 0.8, "high_workload": 0.4}}  # mindfulness: attention
_SIGNAL_TEXT = {"short_sleep": "shorter sleep than usual last night", "high_fatigue": "higher fatigue than usual",
                "high_workload": "higher perceived workload than usual",
                "cognitive_dip": "a test result below the personal baseline range"}


def _run(simulation_run_id: str | None) -> str:
    return simulation_run_id or get_settings().default_template_run_id


def _mission_now(conn: sqlite3.Connection, run_id: str) -> datetime:
    return parse_iso(mission_simulator.get_simulation_state(conn, run_id)["current_mission_time"])


# --------------------------------------------------------------------------- catalogue

def list_activities(conn: sqlite3.Connection, include_unapproved: bool = False) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM recovery_activities WHERE (? OR approval_status = 'approved') "
                        "ORDER BY recovery_activity_id", (include_unapproved,)).fetchall()
    return [dict(r) for r in rows]


def get_activity(conn: sqlite3.Connection, recovery_activity_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM recovery_activities WHERE recovery_activity_id = ?",
                       (recovery_activity_id,)).fetchone()
    if row is None:
        raise NotFound(f"Recovery activity {recovery_activity_id} not found")
    return dict(row)


# --------------------------------------------------------------------------- evidence

def _unusual(value: float | None, history: list[float], higher_is_signal: bool) -> dict[str, Any] | None:
    """Compare one value with the astronaut's own earlier values. None if there is too little history."""
    if value is None or len(history) < MIN_HISTORY:
        return None
    mean, sd = statistics.fmean(history), statistics.stdev(history)
    if sd == 0:
        return None
    z = (value - mean) / sd
    hit = z >= SIGNAL_Z if higher_is_signal else z <= -SIGNAL_Z
    return {"value": round(value, 2), "own_average": round(mean, 2), "own_sd": round(sd, 2), "z": round(z, 2),
            "history_days": len(history), "active": hit, "strength": round(min(1.0, abs(z) / 3.0), 3) if hit else 0.0}


def collect_signals(conn: sqlite3.Connection, astronaut_id: str, as_of: datetime,
                    simulation_run_id: str | None = None) -> dict[str, Any]:
    """What the rules look at for one astronaut at one mission time. Only data from before `as_of`."""
    require_astronaut(conn, astronaut_id)
    now, day = to_iso(as_of), to_iso(as_of)[:10]
    signals: dict[str, Any] = {}

    sleeps = conn.execute(
        "SELECT sleep_end, total_sleep_minutes FROM sleep_records WHERE astronaut_id = ? AND quality_status = 'valid' "
        "AND sleep_end <= ? ORDER BY sleep_end", (astronaut_id, now)).fetchall()
    if sleeps and as_of - parse_iso(sleeps[-1]["sleep_end"]) <= timedelta(hours=24):
        s = _unusual(sleeps[-1]["total_sleep_minutes"], [r["total_sleep_minutes"] for r in sleeps[:-1]], False)
        if s:
            signals["short_sleep"] = {**s, "measure": "total_sleep_minutes", "unit": "minutes"}

    context = conn.execute(
        "SELECT * FROM assessment_context WHERE astronaut_id = ? AND substr(timestamp_utc, 1, 10) = ? "
        "AND timestamp_utc <= ? ORDER BY timestamp_utc DESC LIMIT 1", (astronaut_id, day, now)).fetchone()
    if context is not None:
        earlier = conn.execute(
            "SELECT fatigue_score, perceived_workload FROM assessment_context WHERE astronaut_id = ? "
            "AND circadian_condition = ? AND timestamp_utc < ?",
            (astronaut_id, context["circadian_condition"], context["timestamp_utc"])).fetchall()
        for name, column, unit in (("high_fatigue", "fatigue_score", "1-9"),
                                   ("high_workload", "perceived_workload", "score")):
            s = _unusual(context[column], [r[column] for r in earlier if r[column] is not None], True)
            if s:
                signals[name] = {**s, "measure": column, "unit": unit}

    if now >= f"{day}T08:00:00Z":  # the morning tests have happened
        result = comparisons.get_cognitive_comparisons(conn, astronaut_id, day, day, simulation_run_id)
        worse = [c for c in result["comparisons"] if c["interpretation"] == "outside_range_worse"]
        if result["comparisons"]:
            signals["cognitive_dip"] = {
                "active": bool(worse), "strength": round(min(1.0, 0.5 + 0.25 * (len(worse) - 1)), 3) if worse else 0.0,
                "tests_compared": len(result["comparisons"]),
                "below_baseline": [{"protocol_id": c["protocol_id"], "metric_name": c["metric_name"],
                                    "value": c["inflight_value"], "baseline": c["baseline_value"],
                                    "percentage_difference": c["percentage_difference"]} for c in worse]}
    return {"astronaut_id": astronaut_id, "as_of": now, "simulation_run_id": _run(simulation_run_id),
            "signals": signals, "active": sorted(k for k, v in signals.items() if v["active"])}


def rank_activities(activities: list[dict[str, Any]], evidence: dict[str, Any]) -> list[dict[str, Any]]:
    """Score every approved catalogue activity against the active signals. Pure function."""
    ranked = []
    for activity in activities:
        if activity["approval_status"] != "approved":
            continue
        weights = _ACTIVITY_WEIGHTS.get(activity["recovery_activity_id"]) or _CATEGORY_WEIGHTS.get(
            activity["activity_category"], {})
        used = {name: weights[name] * evidence["signals"][name]["strength"]
                for name in evidence["active"] if name in weights}
        score = round(min(1.0, sum(used.values())), 3)
        if score >= MIN_SCORE:
            because = ", ".join(_SIGNAL_TEXT[n] for n in sorted(used, key=used.get, reverse=True))
            ranked.append({"recovery_activity_id": activity["recovery_activity_id"],
                           "activity_name": activity["activity_name"], "score": score,
                           "signals_used": sorted(used), "reason": f"{activity['activity_name']}: {because}."})
    return sorted(ranked, key=lambda r: (-r["score"], r["recovery_activity_id"]))


# --------------------------------------------------------------------------- recommendations

_REC_SQL = """SELECT r.*, a.activity_name, a.activity_category, a.recommended_duration_minutes, a.intensity,
                     COALESCE(d.simulation_run_id, :template) AS simulation_run_id, d.evidence_json,
                     d.reviewed_by_user_id, d.reviewed_at, d.review_comment,
                     (SELECT scheduled_recovery_id FROM scheduled_recovery s JOIN daily_schedules ds
                      ON ds.schedule_id = s.schedule_id WHERE ds.activity_reference_id = r.recommendation_id
                      LIMIT 1) AS scheduled_recovery_id
              FROM recovery_recommendations r
              JOIN recovery_activities a ON a.recovery_activity_id = r.recovery_activity_id
              LEFT JOIN recovery_recommendation_details d ON d.recommendation_id = r.recommendation_id"""


def _rec(row: sqlite3.Row) -> dict[str, Any]:
    rec = dict(row)
    rec["evidence"] = json.loads(rec.pop("evidence_json") or "null")
    rec["is_demo"] = rec["algorithm_version"] == DEMO_VERSION
    return rec


def get_recommendation(conn: sqlite3.Connection, recommendation_id: str) -> dict[str, Any]:
    row = conn.execute(f"{_REC_SQL} WHERE r.recommendation_id = :id",
                       {"id": recommendation_id, "template": get_settings().default_template_run_id}).fetchone()
    if row is None:
        raise NotFound(f"Recovery recommendation {recommendation_id} not found")
    return _rec(row)


def list_recommendations(conn: sqlite3.Connection, astronaut_ids: list[str], *, mission_day: int | None = None,
                         approval_status: str | None = None, simulation_run_id: str | None = None,
                         include_demo: bool = True) -> list[dict[str, Any]]:
    if not astronaut_ids:
        return []
    marks = ",".join(f":a{i}" for i in range(len(astronaut_ids)))
    params = {"template": get_settings().default_template_run_id, "day": mission_day, "status": approval_status,
              "run": _run(simulation_run_id), "demo": include_demo, "demo_version": DEMO_VERSION,
              **{f"a{i}": a for i, a in enumerate(astronaut_ids)}}
    rows = conn.execute(
        f"""{_REC_SQL} WHERE r.astronaut_id IN ({marks}) AND (:day IS NULL OR r.mission_day = :day)
              AND (:status IS NULL OR r.approval_status = :status)
              AND COALESCE(d.simulation_run_id, :template) = :run
              AND (:demo OR r.algorithm_version != :demo_version)
            ORDER BY r.mission_day, r.astronaut_id, r.recommendation_score DESC, r.recommendation_id""",
        params).fetchall()
    return [_rec(r) for r in rows]


def generate_recommendations(conn: sqlite3.Connection, *, actor_user_id: str | None,
                             astronaut_ids: list[str] | None = None, simulation_run_id: str | None = None,
                             as_of: datetime | None = None, limit: int = 2) -> dict[str, Any]:
    """Suggest up to `limit` activities per astronaut for the mission day of `as_of` (default: the run's clock).

    Running it again for the same day replaces that day's suggestions that nobody has reviewed yet.
    An astronaut with no unusual signal gets no suggestion, and the result says so.
    """
    run_id = _run(simulation_run_id)
    when = as_of or _mission_now(conn, run_id)
    mission_id = conn.execute("SELECT mission_id FROM simulation_runs WHERE simulation_run_id = ?",
                              (run_id,)).fetchone()["mission_id"]
    crew = [r["astronaut_id"] for r in conn.execute(
        "SELECT astronaut_id FROM astronauts WHERE mission_id = ? ORDER BY astronaut_id", (mission_id,))]
    if astronaut_ids:
        unknown = sorted(set(astronaut_ids) - set(crew))
        if unknown:
            raise ValidationFailed("Astronauts not on this run's mission", {"unknown": unknown})
        crew = [a for a in crew if a in set(astronaut_ids)]
    mission_day = (when - mission_launch(conn, mission_id)).days + 1
    if mission_day < 1:
        raise ValidationFailed("That time is before launch")
    catalogue = list_activities(conn)
    out = []
    for astronaut_id in crew:
        evidence = collect_signals(conn, astronaut_id, when, run_id)
        existing = list_recommendations(conn, [astronaut_id], mission_day=mission_day, simulation_run_id=run_id,
                                        include_demo=False)
        for old in existing:
            if old["approval_status"] == PENDING:
                conn.execute("DELETE FROM recovery_recommendations WHERE recommendation_id = ?",
                             (old["recommendation_id"],))
        kept = {r["recovery_activity_id"] for r in existing if r["approval_status"] != PENDING}
        created = []
        for pick in [r for r in rank_activities(catalogue, evidence)
                     if r["recovery_activity_id"] not in kept][:max(0, limit)]:
            rec_id = f"RCR-{uuid.uuid4().hex[:12].upper()}"
            conn.execute(
                """INSERT INTO recovery_recommendations (recommendation_id, astronaut_id, recovery_activity_id,
                       mission_day, recommendation_score, reason, algorithm_version, constraint_status,
                       approval_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'passed', ?, ?)""",
                (rec_id, astronaut_id, pick["recovery_activity_id"], mission_day, pick["score"], pick["reason"],
                 RULES_VERSION, PENDING, to_iso(when)))
            conn.execute(
                "INSERT INTO recovery_recommendation_details (recommendation_id, simulation_run_id, evidence_json) "
                "VALUES (?, ?, ?)", (rec_id, run_id, json.dumps(evidence, sort_keys=True)))
            created.append(rec_id)
        out.append({"astronaut_id": astronaut_id, "active_signals": evidence["active"],
                    "signals": evidence["signals"], "created": created,
                    "message": None if created else (
                        "Nothing unusual compared with this astronaut's own earlier days, so nothing is suggested."
                        if not evidence["active"] else "Already reviewed for today; nothing new to suggest.")})
    write_audit(conn, user_id=actor_user_id, action_type="generate_recovery_recommendations",
                entity_type="simulation_run", entity_id=run_id, action_result="success",
                change_summary=f"day {mission_day}: {sum(len(o['created']) for o in out)} suggestions "
                               f"for {len(crew)} astronauts", commit=False)
    conn.commit()
    for o in out:
        o["recommendations"] = [get_recommendation(conn, r) for r in o.pop("created")]
    return {"simulation_run_id": run_id, "mission_day": mission_day, "as_of": to_iso(when),
            "algorithm_version": RULES_VERSION, "note": NOTE, "astronauts": out}


def review_recommendation(conn: sqlite3.Connection, recommendation_id: str, user: dict[str, Any], decision: str,
                          comment: str = "") -> dict[str, Any]:
    auth_service.require_role(user, *permissions.RECOVERY_PLAN_ROLES)
    if decision not in ("approve", "reject"):
        raise ValidationFailed("decision must be 'approve' or 'reject'")
    rec = get_recommendation(conn, recommendation_id)
    if rec["is_demo"]:
        raise Conflict("Seed demo recommendations are fictional and cannot be reviewed. Generate new ones.")
    if rec["approval_status"] != PENDING:
        raise Conflict(f"Recommendation is already '{rec['approval_status']}'")
    if decision == "approve" and get_activity(conn, rec["recovery_activity_id"])["approval_status"] != "approved":
        raise Conflict("This activity is no longer approved in the catalogue")
    conn.execute("UPDATE recovery_recommendations SET approval_status = ? WHERE recommendation_id = ?",
                 (APPROVED if decision == "approve" else REJECTED, recommendation_id))
    conn.execute("UPDATE recovery_recommendation_details SET reviewed_by_user_id = ?, reviewed_at = ?, "
                 "review_comment = ? WHERE recommendation_id = ?",
                 (user["user_id"], to_iso(_mission_now(conn, rec["simulation_run_id"])), comment.strip()[:500],
                  recommendation_id))
    write_audit(conn, user_id=user["user_id"], action_type=f"{decision}_recovery_recommendation",
                entity_type="recovery_recommendation", entity_id=recommendation_id, action_result="success",
                change_summary=comment.strip()[:500], commit=False)
    conn.commit()
    return get_recommendation(conn, recommendation_id)


# --------------------------------------------------------------------------- booking

def find_conflicts(conn: sqlite3.Connection, astronaut_id: str, start: datetime, end: datetime,
                   simulation_run_id: str) -> list[str]:
    """Other commitments of this astronaut that overlap [start, end)."""
    s, e = to_iso(start), to_iso(end)
    found = []
    for r in conn.execute(
            """SELECT t.task_title, a.planned_start, a.planned_end FROM task_assignments a
               JOIN mission_tasks t ON t.task_id = a.task_id
               WHERE a.astronaut_id = ? AND a.simulation_run_id = ? AND a.planned_start < ? AND a.planned_end > ?
                 AND a.assignment_status IN ('approved', 'scheduled', 'in_progress', 'completed')""",
            (astronaut_id, simulation_run_id, e, s)):
        found.append(f"task '{r[0]}' {r[1][11:16]}-{r[2][11:16]}")
    for r in conn.execute(
            """SELECT ra.activity_name, s.scheduled_start, s.scheduled_end FROM scheduled_recovery s
               JOIN recovery_activities ra ON ra.recovery_activity_id = s.recovery_activity_id
               WHERE s.astronaut_id = ? AND s.scheduled_start < ? AND s.scheduled_end > ?
                 AND s.completion_status != 'skipped'""", (astronaut_id, e, s)):
        found.append(f"recovery '{r[0]}' {r[1][11:16]}-{r[2][11:16]}")
    for r in conn.execute("SELECT sleep_start, sleep_end FROM sleep_records WHERE astronaut_id = ? "
                          "AND sleep_start < ? AND sleep_end > ?", (astronaut_id, e, s)):
        found.append(f"protected sleep {r[0][11:16]}-{r[1][11:16]}")
    for r in conn.execute("SELECT activity_type, start_time, end_time FROM activity_records WHERE astronaut_id = ? "
                          "AND start_time < ? AND end_time > ?", (astronaut_id, e, s)):
        found.append(f"{r[0] or 'activity'} {r[1][11:16]}-{r[2][11:16]}")
    return found


_BOOKING_SQL = """SELECT s.*, ra.activity_name, ra.activity_category, ra.instructions, ds.simulation_run_id,
                         ds.activity_reference_id AS recommendation_id, ds.approval_status AS schedule_approval_status
                  FROM scheduled_recovery s
                  JOIN recovery_activities ra ON ra.recovery_activity_id = s.recovery_activity_id
                  LEFT JOIN daily_schedules ds ON ds.schedule_id = s.schedule_id"""


def get_booking(conn: sqlite3.Connection, scheduled_recovery_id: str) -> dict[str, Any]:
    row = conn.execute(f"{_BOOKING_SQL} WHERE s.scheduled_recovery_id = ?", (scheduled_recovery_id,)).fetchone()
    if row is None:
        raise NotFound(f"Scheduled recovery {scheduled_recovery_id} not found")
    booking = dict(row)
    booking["is_demo"] = booking["schedule_approval_status"] == "demo_unapproved"
    return booking


def list_bookings(conn: sqlite3.Connection, astronaut_ids: list[str], *, date: str | None = None,
                  completion_status: str | None = None, simulation_run_id: str | None = None) -> list[dict[str, Any]]:
    if not astronaut_ids:
        return []
    marks = ",".join("?" * len(astronaut_ids))
    rows = conn.execute(
        f"""{_BOOKING_SQL} WHERE s.astronaut_id IN ({marks})
              AND (? IS NULL OR substr(s.scheduled_start, 1, 10) = ?) AND (? IS NULL OR s.completion_status = ?)
              AND COALESCE(ds.simulation_run_id, ?) = ?
            ORDER BY s.scheduled_start, s.astronaut_id""",
        (*astronaut_ids, date, date, completion_status, completion_status,
         get_settings().default_template_run_id, _run(simulation_run_id))).fetchall()
    out = [dict(r) for r in rows]
    for b in out:
        b["is_demo"] = b["schedule_approval_status"] == "demo_unapproved"
    return out


def schedule_recommendation(conn: sqlite3.Connection, recommendation_id: str, user: dict[str, Any],
                            scheduled_start: datetime) -> dict[str, Any]:
    """Book an approved recommendation on the astronaut's calendar. Refuses any overlap."""
    auth_service.require_role(user, *permissions.RECOVERY_PLAN_ROLES)
    rec = get_recommendation(conn, recommendation_id)
    if rec["approval_status"] != APPROVED:
        raise Conflict(f"Recommendation is '{rec['approval_status']}'; only an approved one can be booked")
    if rec["scheduled_recovery_id"]:
        raise Conflict(f"Already booked as {rec['scheduled_recovery_id']}")
    run_id = rec["simulation_run_id"]
    if scheduled_start < _mission_now(conn, run_id):
        raise ValidationFailed("scheduled_start is in the past for this simulation run")
    end = scheduled_start + timedelta(minutes=rec["recommended_duration_minutes"])
    clashes = find_conflicts(conn, rec["astronaut_id"], scheduled_start, end, run_id)
    if clashes:
        raise Conflict("That time overlaps other commitments", clashes)
    mission_id = require_astronaut(conn, rec["astronaut_id"])["mission_id"]
    schedule_id, booking_id = f"SCH-{uuid.uuid4().hex[:12].upper()}", f"SRC-{uuid.uuid4().hex[:12].upper()}"
    conn.execute(
        """INSERT INTO daily_schedules (schedule_id, astronaut_id, mission_id, schedule_date, activity_type,
               activity_reference_id, start_time, end_time, schedule_status, approved_by_user_id,
               schedule_version_id, simulation_run_id, approval_status)
           VALUES (?, ?, ?, ?, 'recovery', ?, ?, ?, 'published', ?, NULL, ?, 'approved')""",
        (schedule_id, rec["astronaut_id"], mission_id, to_iso(scheduled_start)[:10], recommendation_id,
         to_iso(scheduled_start), to_iso(end), user["user_id"], run_id))
    conn.execute(
        """INSERT INTO scheduled_recovery (scheduled_recovery_id, astronaut_id, mission_id, recovery_activity_id,
               schedule_id, scheduled_start, scheduled_end, completion_status, completed_at, astronaut_feedback)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)""",
        (booking_id, rec["astronaut_id"], mission_id, rec["recovery_activity_id"], schedule_id,
         to_iso(scheduled_start), to_iso(end), PLANNED))
    write_audit(conn, user_id=user["user_id"], action_type="schedule_recovery", entity_type="scheduled_recovery",
                entity_id=booking_id, action_result="success",
                change_summary=f"{rec['activity_name']} for {rec['astronaut_id']} at {to_iso(scheduled_start)}",
                commit=False)
    conn.commit()
    return get_booking(conn, booking_id)


def record_recovery_outcome(conn: sqlite3.Connection, scheduled_recovery_id: str, user: dict[str, Any],
                            outcome: str, feedback: str = "", at: datetime | None = None) -> dict[str, Any]:
    """Mark a booked recovery completed or skipped. By the astronaut it belongs to, or the medical officer."""
    if outcome not in (COMPLETED, SKIPPED):
        raise ValidationFailed("outcome must be 'completed' or 'skipped'")
    booking = get_booking(conn, scheduled_recovery_id)
    own = booking["astronaut_id"] in auth_service.get_permitted_astronauts(conn, user) \
        and user.get("role_name") == permissions.ASTRONAUT
    if not own and user.get("role_name") not in permissions.RECOVERY_PLAN_ROLES:
        raise PermissionDenied("Only the astronaut it is booked for, or the medical officer, can record this")
    if booking["is_demo"]:
        raise Conflict("Seed demo recovery bookings are fictional and cannot be recorded as done")
    if booking["completion_status"] != PLANNED:
        raise Conflict(f"Already recorded as '{booking['completion_status']}'")
    now = _mission_now(conn, _run(booking["simulation_run_id"]))
    when = at or now
    if when > now:
        raise ValidationFailed("That time is in the future for this simulation run")
    if outcome == COMPLETED and when < parse_iso(booking["scheduled_start"]) - timedelta(hours=12):
        raise ValidationFailed("That is more than 12 hours before the booked time")
    conn.execute("UPDATE scheduled_recovery SET completion_status = ?, completed_at = ?, astronaut_feedback = ? "
                 "WHERE scheduled_recovery_id = ?",
                 (outcome, to_iso(when) if outcome == COMPLETED else None, feedback.strip()[:500] or None,
                  scheduled_recovery_id))
    conn.execute("UPDATE daily_schedules SET schedule_status = ? WHERE schedule_id = ?",
                 (outcome, booking["schedule_id"]))
    write_audit(conn, user_id=user["user_id"], action_type=f"recovery_{outcome}", entity_type="scheduled_recovery",
                entity_id=scheduled_recovery_id, action_result="success", change_summary=feedback.strip()[:200],
                commit=False)
    conn.commit()
    return get_booking(conn, scheduled_recovery_id)
