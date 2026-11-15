"""Preflight Assessment and Mission Mind dashboards (Phase 3).

Taking a test (start, trials, complete) is only for the astronaut it is assigned to.
Viewing results follows the usual rule: astronauts see themselves, staff see the crew.
Generating assignments is for the mission leader or medical officer; freezing a new
baseline version is for the medical officer.
"""
import sqlite3

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import current_user, require_roles
from app.core import permissions
from app.core.errors import ValidationFailed
from app.database.session import get_db
from app.schemas.assessment import (
    CompleteSessionRequest,
    FreezeBaselinesRequest,
    GenerateAssignmentsRequest,
    StartSessionRequest,
    SubmitTrialsRequest,
)
from app.services import assessment_service as assessments
from app.services import auth_service, baseline_service, cognitive_scoring
from app.services import cognitive_comparison_service as comparisons
from app.services.health_context import parse_time_param, resolve_as_of, resolve_range
from app.utils.timestamps import to_iso

router = APIRouter(tags=["assessments"])

RUN = Query(None, description="Simulation run. Default: RUN-DEMO-001.")


def _me(conn: sqlite3.Connection, user: dict) -> str | None:
    return assessments.astronaut_id_for_user(conn, user)


# --------------------------------------------------------------------------- taking tests

@router.get("/assessments/due")
def due(astronaut_id: str | None = Query(None, description="Default: the signed-in astronaut"),
        simulation_run_id: str | None = RUN,
        user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Tests open right now on the run's mission clock (each window lasts 1 hour)."""
    target = astronaut_id or _me(conn, user)
    if target is None:
        raise ValidationFailed("astronaut_id is required for staff accounts")
    auth_service.require_astronaut_access(conn, user, target)
    return assessments.get_due_assessments(conn, target, simulation_run_id)


@router.post("/assessments/assignments/generate", status_code=status.HTTP_201_CREATED)
def generate(body: GenerateAssignmentsRequest,
             user: dict = Depends(require_roles(permissions.MISSION_LEADER, permissions.MEDICAL_OFFICER)),
             conn: sqlite3.Connection = Depends(get_db)):
    """Create in-flight test assignments for a simulation run from the TPL-FLIGHT template."""
    return assessments.generate_assessment_assignments(
        conn, simulation_run_id=body.simulation_run_id, from_day=body.from_day, to_day=body.to_day,
        actor_user_id=user["user_id"], astronaut_ids=body.astronaut_ids)


@router.post("/assessments/sessions", status_code=status.HTTP_201_CREATED)
def start_session(body: StartSessionRequest, user: dict = Depends(current_user),
                  conn: sqlite3.Connection = Depends(get_db)):
    return assessments.start_assessment_session(conn, body.assignment_id, actor_astronaut_id=_me(conn, user),
                                                actor_user_id=user["user_id"])


@router.post("/assessments/sessions/{session_id}/trials")
def submit_trials(session_id: str, body: SubmitTrialsRequest, user: dict = Depends(current_user),
                  conn: sqlite3.Connection = Depends(get_db)):
    return assessments.submit_assessment_trials(conn, session_id, [t.model_dump() for t in body.trials],
                                                actor_astronaut_id=_me(conn, user))


@router.post("/assessments/sessions/{session_id}/complete")
def complete_session(session_id: str, body: CompleteSessionRequest | None = None,
                     user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Score the session; in-flight results also update the day's score and its baseline comparison."""
    survey = body.survey.model_dump() if body and body.survey else None
    return assessments.complete_assessment_session(conn, session_id, actor_astronaut_id=_me(conn, user),
                                                   actor_user_id=user["user_id"], survey=survey)


@router.get("/assessments/sessions/{session_id}")
def get_session(session_id: str, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    session = assessments.get_session(conn, session_id)
    auth_service.require_astronaut_access(conn, user, session["astronaut_id"])
    return session


@router.get("/astronauts/{astronaut_id}/assessments")
def list_assignments(astronaut_id: str, simulation_run_id: str | None = RUN,
                     start: str | None = None, end: str | None = None,
                     status_filter: str | None = Query(None, alias="status",
                                                      description="pending, available, in_progress, completed, expired"),
                     user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    auth_service.require_astronaut_access(conn, user, astronaut_id)
    return assessments.list_assignments(conn, astronaut_id, simulation_run_id, parse_time_param(start, "start"),
                                        parse_time_param(end, "end"), status_filter)


# --------------------------------------------------------------------------- baselines

@router.get("/astronauts/{astronaut_id}/baselines")
def baselines(astronaut_id: str, version: str | None = Query(None, description="e.g. v1. Default: newest"),
              user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    auth_service.require_astronaut_access(conn, user, astronaut_id)
    return baseline_service.get_baselines(conn, astronaut_id, version)


@router.post("/baselines/freeze", status_code=status.HTTP_201_CREATED)
def freeze_baselines(body: FreezeBaselinesRequest | None = None,
                     user: dict = Depends(require_roles(permissions.MEDICAL_OFFICER)),
                     conn: sqlite3.Connection = Depends(get_db)):
    """Rebuild every baseline from preflight data and save it as a new version (old versions are kept)."""
    body = body or FreezeBaselinesRequest()
    return baseline_service.freeze_baseline_version(conn, actor_user_id=user["user_id"],
                                                    astronaut_ids=body.astronaut_ids, clip_to_scale=body.clip_to_scale)


# --------------------------------------------------------------------------- Mission Mind

def _date_window(conn, start, end, at, run, default_days):
    s, e = resolve_range(start, end, resolve_as_of(conn, at, run), default_days)
    return to_iso(s)[:10], to_iso(e)[:10]


@router.get("/astronauts/{astronaut_id}/cognition/daily")
def cognition_daily(astronaut_id: str, protocol_id: str | None = None, start: str | None = None,
                    end: str | None = None, at: str | None = None, simulation_run_id: str | None = RUN,
                    user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    auth_service.require_astronaut_access(conn, user, astronaut_id)
    s, e = _date_window(conn, start, end, at, simulation_run_id, 14)
    return comparisons.get_daily_cognition(conn, astronaut_id, s, e, simulation_run_id, protocol_id)


@router.get("/astronauts/{astronaut_id}/cognition/comparisons")
def cognition_comparisons(astronaut_id: str, protocol_id: str | None = None,
                          only_outside: bool = Query(False, description="Only days outside the baseline range"),
                          start: str | None = None, end: str | None = None, at: str | None = None,
                          simulation_run_id: str | None = RUN,
                          user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    auth_service.require_astronaut_access(conn, user, astronaut_id)
    s, e = _date_window(conn, start, end, at, simulation_run_id, 14)
    return comparisons.get_cognitive_comparisons(conn, astronaut_id, s, e, simulation_run_id, protocol_id,
                                                 only_outside)


@router.get("/astronauts/{astronaut_id}/cognition/trend")
def cognition_trend(astronaut_id: str, protocol_id: str = Query(..., description="PVT, NBACK, STROOP or SURVEY"),
                    days: int = Query(14, ge=3, le=90), at: str | None = None, simulation_run_id: str | None = RUN,
                    user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    auth_service.require_astronaut_access(conn, user, astronaut_id)
    return comparisons.calculate_cognitive_trend(conn, astronaut_id, protocol_id,
                                                 resolve_as_of(conn, at, simulation_run_id), days, simulation_run_id)


@router.get("/metrics/definitions")
def metric_definitions(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Units and which direction is better for every cognitive metric."""
    return cognitive_scoring.list_metric_definitions(conn)
