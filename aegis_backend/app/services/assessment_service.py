"""Assessment scheduling and sessions (plan section 3, Phase 3).

Lifecycle of one test:

  generate_assessment_assignments   templates -> assignments (system_template, no human "assigner")
  get_due_assessments               what an astronaut can take now (window: scheduled_at .. +1 h)
  start_assessment_session          opens a session, attaches the slot's context record
  submit_assessment_trials          stores raw trials; correctness is computed here, not by the client
  complete_assessment_session       scores, saves the result, and for in-flight tests updates the
                                    day's result and its comparison with the baseline

Time is mission time from the assignment's simulation run, so the simulation clock decides
whether a window is open. Every function takes an optional `as_of` for tests and jobs.

An assignment's access_status is stored as pending / in_progress / completed. 'available' and
'expired' are worked out from the clock when read, so nothing has to run on a timer.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Any

from app.core.config import get_settings
from app.core.errors import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services import cognitive_comparison_service as comparisons
from app.services import cognitive_scoring as scoring
from app.services import mission_simulator
from app.services.audit_service import write_audit
from app.services.health_context import mission_launch, require_astronaut
from app.utils.timestamps import parse_iso, to_iso, utcnow

ACCESS_WINDOW = timedelta(hours=1)
MAX_GENERATE_DAYS = 31
MAX_TRIALS_PER_SESSION = 200
DEFAULT_TRIAL_SPACING = timedelta(seconds=5)
TRIAL_TIME_GRACE = timedelta(minutes=5)


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12].upper()}"


def _run_of(assignment: sqlite3.Row | dict) -> str:
    return assignment["simulation_run_id"] or get_settings().default_template_run_id


def _clock(conn: sqlite3.Connection, run_id: str, as_of: datetime | None) -> datetime:
    if as_of is not None:
        return as_of
    return parse_iso(mission_simulator.get_simulation_state(conn, run_id)["current_mission_time"])


def astronaut_id_for_user(conn: sqlite3.Connection, user: dict[str, Any]) -> str | None:
    row = conn.execute("SELECT astronaut_id FROM astronauts WHERE user_id = ?", (user["user_id"],)).fetchone()
    return row[0] if row else None


# --------------------------------------------------------------------------- assignments

def generate_assessment_assignments(conn: sqlite3.Connection, *, simulation_run_id: str, from_day: int, to_day: int,
                                    actor_user_id: str | None, astronaut_ids: list[str] | None = None
                                    ) -> dict[str, Any]:
    """Create in-flight assignments for a run from the in-flight template(s).

    Idempotent: a slot (run, astronaut, protocol, time) that already has an assignment is skipped.
    assigned_by_user_id stays empty because the system, not a person, assigns tests; the
    person who triggered generation is recorded in audit_logs.
    """
    state = mission_simulator.get_simulation_state(conn, simulation_run_id)
    if not 1 <= from_day <= to_day <= state["mission_total_days"]:
        raise ValidationFailed(f"Days must satisfy 1 <= from_day <= to_day <= {state['mission_total_days']}")
    if to_day - from_day + 1 > MAX_GENERATE_DAYS:
        raise ValidationFailed(f"Generate at most {MAX_GENERATE_DAYS} days at a time")
    templates = conn.execute(
        "SELECT * FROM assessment_schedule_templates WHERE mission_phase = 'inflight' ORDER BY template_id").fetchall()
    if not templates:
        raise NotFound("No in-flight assessment template")
    crew = astronaut_ids or [r[0] for r in conn.execute(
        "SELECT astronaut_id FROM astronauts WHERE mission_id = ? ORDER BY astronaut_id", (state["mission_id"],))]
    for a in crew:
        require_astronaut(conn, a)

    launch = mission_launch(conn, state["mission_id"])
    created = skipped = 0
    for day in range(from_day, to_day + 1):
        for tpl in templates:
            if tpl["recurrence"] != "daily":
                continue
            scheduled = launch + timedelta(days=day - 1, hours=int(tpl["local_hour"]))
            for astronaut_id in crew:
                for protocol_id in tpl["protocol_ids"].split("|"):
                    exists = conn.execute(
                        """SELECT 1 FROM assessment_assignments WHERE simulation_run_id = ? AND astronaut_id = ?
                           AND protocol_id = ? AND scheduled_at = ?""",
                        (simulation_run_id, astronaut_id, protocol_id, to_iso(scheduled))).fetchone()
                    if exists:
                        skipped += 1
                        continue
                    conn.execute(
                        """INSERT INTO assessment_assignments (assignment_id, astronaut_id, protocol_id,
                               assigned_by_user_id, scheduled_at, assessment_condition, access_status,
                               access_expires_at, assignment_source, schedule_template_id, simulation_run_id)
                           VALUES (?, ?, ?, NULL, ?, ?, 'pending', ?, 'system_template', ?, ?)""",
                        (_id("ASG"), astronaut_id, protocol_id, to_iso(scheduled), tpl["assessment_condition"],
                         to_iso(scheduled + ACCESS_WINDOW), tpl["template_id"], simulation_run_id))
                    created += 1
    write_audit(conn, user_id=actor_user_id, action_type="generate_assessment_assignments",
                entity_type="simulation_run", entity_id=simulation_run_id, action_result="success",
                change_summary=f"days {from_day}-{to_day}: {created} created, {skipped} already existed", commit=False)
    conn.commit()
    return {"simulation_run_id": simulation_run_id, "from_day": from_day, "to_day": to_day,
            "created": created, "already_existed": skipped}


def effective_status(assignment: sqlite3.Row | dict, as_of: datetime) -> str:
    """pending (not open yet) / available / in_progress / completed / expired."""
    stored = assignment["access_status"]
    if stored in ("completed", "in_progress", "expired"):
        return stored
    if as_of < parse_iso(assignment["scheduled_at"]):
        return "pending"
    if as_of < parse_iso(assignment["access_expires_at"]):
        return "available"
    return "expired"


def validate_assessment_window(assignment: sqlite3.Row | dict, as_of: datetime) -> None:
    status = effective_status(assignment, as_of)
    if status == "pending":
        raise Conflict(f"This test opens at {assignment['scheduled_at']} (mission time is {to_iso(as_of)})")
    if status == "expired":
        raise Conflict(f"This test's window closed at {assignment['access_expires_at']}")
    if status != "available":
        raise Conflict(f"This test is already {status}")


def list_assignments(conn: sqlite3.Connection, astronaut_id: str, simulation_run_id: str | None = None,
                     start: datetime | None = None, end: datetime | None = None, status: str | None = None,
                     as_of: datetime | None = None) -> dict[str, Any]:
    """Assignments for one astronaut in one run, with their effective status at as_of."""
    require_astronaut(conn, astronaut_id)
    run = simulation_run_id or get_settings().default_template_run_id
    now = _clock(conn, run, as_of)
    template = get_settings().default_template_run_id
    rows = conn.execute(
        """SELECT * FROM assessment_assignments
           WHERE astronaut_id = ? AND COALESCE(simulation_run_id, ?) = ? AND scheduled_at BETWEEN ? AND ?
           ORDER BY scheduled_at, protocol_id""",
        (astronaut_id, template, run, to_iso(start) if start else "0000", to_iso(end) if end else "9999")).fetchall()
    items = [{**dict(r), "effective_status": effective_status(r, now)} for r in rows]
    if status:
        items = [i for i in items if i["effective_status"] == status]
    counts: dict[str, int] = {}
    for i in items:
        counts[i["effective_status"]] = counts.get(i["effective_status"], 0) + 1
    return {"astronaut_id": astronaut_id, "simulation_run_id": run, "as_of": to_iso(now), "counts": counts,
            "assignments": items}


def get_due_assessments(conn: sqlite3.Connection, astronaut_id: str, simulation_run_id: str | None = None,
                        as_of: datetime | None = None) -> dict[str, Any]:
    """Tests the astronaut can take right now, plus any started but not finished."""
    run = simulation_run_id or get_settings().default_template_run_id
    now = _clock(conn, run, as_of)
    window = list_assignments(conn, astronaut_id, run, now - ACCESS_WINDOW, now, as_of=now)
    due = [a for a in window["assignments"] if a["effective_status"] in ("available", "in_progress")]
    for a in due:
        session = conn.execute("SELECT session_id FROM assessment_sessions WHERE assignment_id = ?",
                               (a["assignment_id"],)).fetchone()
        a["session_id"] = session[0] if session else None
    return {"astronaut_id": astronaut_id, "simulation_run_id": run, "as_of": to_iso(now), "due": due}


# --------------------------------------------------------------------------- sessions

def _assignment(conn: sqlite3.Connection, assignment_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM assessment_assignments WHERE assignment_id = ?", (assignment_id,)).fetchone()
    if row is None:
        raise NotFound(f"Assignment {assignment_id} not found")
    return row


def _session(conn: sqlite3.Connection, session_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM assessment_sessions WHERE session_id = ?", (session_id,)).fetchone()
    if row is None:
        raise NotFound(f"Session {session_id} not found")
    return row


def _require_owner(astronaut_id: str, actor_astronaut_id: str | None) -> None:
    if actor_astronaut_id != astronaut_id:
        raise PermissionDenied("Only the assigned astronaut can take this test")


def _context_for_slot(conn: sqlite3.Connection, assignment: sqlite3.Row, mission_id: str,
                      as_of: datetime) -> str:
    """One context record per astronaut per time slot, shared by that slot's tests (as in the seed)."""
    existing = conn.execute(
        "SELECT context_id FROM assessment_context WHERE astronaut_id = ? AND timestamp_utc = ?",
        (assignment["astronaut_id"], assignment["scheduled_at"])).fetchone()
    if existing:
        return existing[0]
    sleep = conn.execute(
        """SELECT total_sleep_minutes, sleep_end FROM sleep_records
           WHERE astronaut_id = ? AND sleep_end <= ? ORDER BY sleep_end DESC LIMIT 1""",
        (assignment["astronaut_id"], to_iso(as_of))).fetchone()
    awake = int((as_of - parse_iso(sleep["sleep_end"])).total_seconds() // 60) if sleep else None
    context_id = _id("CTX")
    conn.execute(
        """INSERT INTO assessment_context (context_id, astronaut_id, mission_id, timestamp_utc, circadian_condition,
               preceding_activity, prior_sleep_hours, fatigue_score, sleepiness_score, perceived_workload,
               time_since_waking_minutes, source_type)
           VALUES (?, ?, ?, ?, ?, 'routine', ?, NULL, NULL, NULL, ?, 'app_session')""",
        (context_id, assignment["astronaut_id"], mission_id, assignment["scheduled_at"],
         assignment["assessment_condition"], round(sleep["total_sleep_minutes"] / 60, 2) if sleep else None, awake))
    return context_id


def start_assessment_session(conn: sqlite3.Connection, assignment_id: str, *, actor_astronaut_id: str | None,
                             actor_user_id: str | None, as_of: datetime | None = None, extended: bool = False) -> dict[str, Any]:
    assignment = _assignment(conn, assignment_id)
    _require_owner(assignment["astronaut_id"], actor_astronaut_id)
    scoring.validate_scoring_protocol(conn, assignment["protocol_id"], extended=extended)
    now = _clock(conn, _run_of(assignment), as_of)
    if conn.execute("SELECT 1 FROM assessment_sessions WHERE assignment_id = ?", (assignment_id,)).fetchone():
        raise Conflict("This assignment already has a session")
    validate_assessment_window(assignment, now)

    astronaut = require_astronaut(conn, assignment["astronaut_id"])
    template = conn.execute("SELECT mission_phase FROM assessment_schedule_templates WHERE template_id = ?",
                            (assignment["schedule_template_id"],)).fetchone()
    phase = template["mission_phase"] if template else "inflight"
    activity = conn.execute(
        """SELECT end_time FROM activity_records WHERE astronaut_id = ? AND end_time <= ?
           ORDER BY end_time DESC LIMIT 1""", (assignment["astronaut_id"], to_iso(now))).fetchone()
    try:
        context_id = _context_for_slot(conn, assignment, astronaut["mission_id"], now)
        context = conn.execute("SELECT time_since_waking_minutes FROM assessment_context WHERE context_id = ?",
                               (context_id,)).fetchone()
        session_id = _id("SES")
        conn.execute(
            """INSERT INTO assessment_sessions (session_id, assignment_id, astronaut_id, protocol_id, mission_id,
                   mission_phase, assessment_condition, started_at, completed_at, session_status, quality_status,
                   time_since_waking_minutes, time_since_activity_minutes, context_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'in_progress', 'pending', ?, ?, ?)""",
            (session_id, assignment_id, assignment["astronaut_id"], assignment["protocol_id"], astronaut["mission_id"],
             phase, assignment["assessment_condition"], to_iso(now), context["time_since_waking_minutes"],
             int((now - parse_iso(activity["end_time"])).total_seconds() // 60) if activity else None, context_id))
        conn.execute("UPDATE assessment_assignments SET access_status = 'in_progress' WHERE assignment_id = ?",
                     (assignment_id,))
        write_audit(conn, user_id=actor_user_id, action_type="start_assessment_session",
                    entity_type="assessment_session", entity_id=session_id, action_result="success",
                    change_summary=f"{assignment['protocol_id']} for {assignment['astronaut_id']}", commit=False)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return get_session(conn, session_id)


def submit_assessment_trials(conn: sqlite3.Connection, session_id: str, trials: list[dict[str, Any]], *,
                             actor_astronaut_id: str | None, extended: bool = False) -> dict[str, Any]:
    """Store raw trials. Trial numbers must be new; is_correct / lapse / false start are computed here."""
    session = _session(conn, session_id)
    _require_owner(session["astronaut_id"], actor_astronaut_id)
    if session["session_status"] != "in_progress":
        raise Conflict(f"Session is {session['session_status']}")
    if session["protocol_id"] not in (scoring.TRIAL_PROTOCOLS | frozenset(scoring.EXTENDED_DOMAIN) if extended else scoring.TRIAL_PROTOCOLS):
        raise ValidationFailed(f"{session['protocol_id']} has no trials; complete it with survey answers")
    if not trials:
        raise ValidationFailed("No trials submitted")
    stored = {r[0] for r in conn.execute("SELECT trial_number FROM assessment_trials WHERE session_id = ?",
                                         (session_id,))}
    if len(stored) + len(trials) > MAX_TRIALS_PER_SESSION:
        raise ValidationFailed(f"A session can hold at most {MAX_TRIALS_PER_SESSION} trials")
    numbers = [t["trial_number"] for t in trials]
    clash = sorted((set(numbers) & stored) | {n for n in numbers if numbers.count(n) > 1})
    if clash:
        raise Conflict("Trial numbers already used", clash)

    protocol = conn.execute("SELECT duration_seconds FROM assessment_protocols WHERE protocol_id = ?",
                            (session["protocol_id"],)).fetchone()
    started = parse_iso(session["started_at"])
    latest = started + timedelta(seconds=protocol["duration_seconds"]) + TRIAL_TIME_GRACE
    is_pvt = session["protocol_id"] == "PVT"
    rows = []
    for t in trials:
        n = t["trial_number"]
        if not 1 <= n <= MAX_TRIALS_PER_SESSION:
            raise ValidationFailed(f"trial_number must be 1..{MAX_TRIALS_PER_SESSION}", [n])
        rt = t.get("reaction_time_ms")
        if rt is not None and not 0 <= rt <= 10_000:
            raise ValidationFailed("reaction_time_ms must be between 0 and 10000", [n])
        when = parse_iso(t["trial_timestamp"]) if t.get("trial_timestamp") else started + DEFAULT_TRIAL_SPACING * (n - 1)
        if not started <= when <= latest:
            raise ValidationFailed("trial_timestamp is outside the session", [n])
        actual = t.get("actual_response")
        correct = int(actual is not None and actual == t["expected_response"])
        rows.append((
            _id("TRL"), session_id, n, t["stimulus_type"], t["stimulus_value"], t["expected_response"], actual,
            rt, correct,
            int(is_pvt and rt is not None and rt >= scoring.PVT_LAPSE_MS),
            int(is_pvt and rt is not None and rt < scoring.PVT_FALSE_START_MS),
            to_iso(when)))
    conn.executemany(
        """INSERT INTO assessment_trials (trial_id, session_id, trial_number, stimulus_type, stimulus_value,
               expected_response, actual_response, reaction_time_ms, is_correct, is_lapse, is_false_start,
               trial_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM assessment_trials WHERE session_id = ?", (session_id,)).fetchone()[0]
    return {"session_id": session_id, "stored": len(rows), "total_trials": total}


def complete_assessment_session(conn: sqlite3.Connection, session_id: str, *, actor_astronaut_id: str | None,
                                actor_user_id: str | None, survey: dict[str, float] | None = None,
                                as_of: datetime | None = None, extended: bool = False) -> dict[str, Any]:
    """Score and close a session. In-flight results also update the day's result and its comparison."""
    session = _session(conn, session_id)
    _require_owner(session["astronaut_id"], actor_astronaut_id)
    if session["session_status"] != "in_progress":
        raise Conflict(f"Session is {session['session_status']}")
    assignment = _assignment(conn, session["assignment_id"])
    now = max(_clock(conn, _run_of(assignment), as_of), parse_iso(session["started_at"]))

    if session["protocol_id"] == "SURVEY":
        if not survey:
            raise ValidationFailed("SURVEY needs answers: fatigue_score, sleepiness_score, perceived_workload")
        conn.execute(
            """UPDATE assessment_context SET fatigue_score = ?, sleepiness_score = ?, perceived_workload = ?
               WHERE context_id = ?""",
            (survey["fatigue_score"], survey["sleepiness_score"], survey["perceived_workload"], session["context_id"]))
    elif survey:
        raise ValidationFailed("Only SURVEY sessions take survey answers")

    try:
        score = scoring.score_session(conn, session_id, extended=extended)
        result = None
        if score["scorable"]:
            result = scoring.save_assessment_results(conn, score, _id("RES"), to_iso(now))
        conn.execute(
            """UPDATE assessment_sessions SET session_status = 'completed', completed_at = ?, quality_status = ?
               WHERE session_id = ?""", (to_iso(now), "valid" if result else "invalid", session_id))
        conn.execute("UPDATE assessment_assignments SET access_status = 'completed' WHERE assignment_id = ?",
                     (session["assignment_id"],))

        daily = comparison = None
        comparison_note = None
        if result and session["mission_phase"] == "inflight":
            day_rows = comparisons.aggregate_daily_cognitive_results(
                conn, session["astronaut_id"], session["started_at"][:10], _run_of(assignment), to_iso(now))
            daily = next((d for d in day_rows if d["protocol_id"] == session["protocol_id"]), None)
            if daily:
                try:
                    comparison = comparisons.compare_daily_result(conn, daily["daily_result_id"],
                                                                  daily["assessment_condition"], to_iso(now))
                except (NotFound, ValidationFailed) as exc:
                    comparison_note = exc.message
        write_audit(conn, user_id=actor_user_id, action_type="complete_assessment_session",
                    entity_type="assessment_session", entity_id=session_id, action_result="success",
                    change_summary=f"{session['protocol_id']} scored: {score.get('metric_value', score.get('reason'))}",
                    commit=False)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"session": get_session(conn, session_id), "score": score, "daily_result": daily,
            "comparison": comparison, "comparison_note": comparison_note}


def get_session(conn: sqlite3.Connection, session_id: str) -> dict[str, Any]:
    session = dict(_session(conn, session_id))
    session["trials"] = [dict(r) for r in conn.execute(
        "SELECT * FROM assessment_trials WHERE session_id = ? ORDER BY trial_number", (session_id,))]
    result = conn.execute("SELECT * FROM assessment_results WHERE session_id = ?", (session_id,)).fetchone()
    session["result"] = dict(result) if result else None
    return session
