"""Recovery Planner dashboard.

Anyone signed in can read the approved activity catalogue. An astronaut sees only their own
recommendations and bookings; staff see the crew's. The medical officer generates, reviews and
books recommendations. A booked recovery is marked done or skipped by its astronaut or the
medical officer.
"""
import sqlite3

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import current_user, require_roles
from app.core import permissions
from app.core.errors import ValidationFailed
from app.database.session import get_db
from app.schemas.recovery import (GenerateRecoveryRequest, RecoveryOutcomeRequest, ReviewRecoveryRequest,
                                  ScheduleRecoveryRequest)
from app.services import auth_service
from app.services import recovery_service as recovery
from app.services.health_context import parse_time_param, resolve_as_of

router = APIRouter(prefix="/recovery", tags=["recovery"])
planner = require_roles(*permissions.RECOVERY_PLAN_ROLES)


def _visible(conn: sqlite3.Connection, user: dict, astronaut_id: str | None) -> list[str]:
    if astronaut_id:
        auth_service.require_astronaut_access(conn, user, astronaut_id)
        return [astronaut_id]
    return auth_service.get_permitted_astronauts(conn, user)


@router.get("/activities")
def activities(include_unapproved: bool = False, user: dict = Depends(current_user),
               conn: sqlite3.Connection = Depends(get_db)):
    """The recovery catalogue. Only approved activities can ever be recommended."""
    if include_unapproved:
        auth_service.require_role(user, *permissions.CREW_WIDE_ROLES)
    return recovery.list_activities(conn, include_unapproved)


@router.get("/signals")
def signals(astronaut_id: str, at: str | None = Query(None, description="ISO-8601 UTC. Default: the run's time"),
            simulation_run_id: str | None = None, user: dict = Depends(current_user),
            conn: sqlite3.Connection = Depends(get_db)):
    """What the rules see for one astronaut: last night's sleep, this morning's fatigue, workload and tests,
    each against that astronaut's own earlier days. Read-only."""
    auth_service.require_astronaut_access(conn, user, astronaut_id)
    return {**recovery.collect_signals(conn, astronaut_id, resolve_as_of(conn, at, simulation_run_id),
                                       simulation_run_id), "note": recovery.NOTE}


@router.get("/recommendations")
def recommendations(astronaut_id: str | None = None, mission_day: int | None = Query(None, ge=1),
                    approval_status: str | None = None, simulation_run_id: str | None = None,
                    include_demo: bool = Query(False, description="Also list the fictional seeded rows"),
                    user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return recovery.list_recommendations(conn, _visible(conn, user, astronaut_id), mission_day=mission_day,
                                         approval_status=approval_status, simulation_run_id=simulation_run_id,
                                         include_demo=include_demo)


@router.post("/recommendations/generate", status_code=status.HTTP_201_CREATED)
def generate(body: GenerateRecoveryRequest | None = None, user: dict = Depends(planner),
             conn: sqlite3.Connection = Depends(get_db)):
    """Suggest activities for today from fixed rules. Replaces today's suggestions nobody has reviewed yet."""
    body = body or GenerateRecoveryRequest()
    return recovery.generate_recommendations(
        conn, actor_user_id=user["user_id"], astronaut_ids=body.astronaut_ids,
        simulation_run_id=body.simulation_run_id, as_of=parse_time_param(body.as_of, "as_of"), limit=body.limit)


@router.get("/recommendations/{recommendation_id}")
def recommendation(recommendation_id: str, user: dict = Depends(current_user),
                   conn: sqlite3.Connection = Depends(get_db)):
    rec = recovery.get_recommendation(conn, recommendation_id)
    auth_service.require_astronaut_access(conn, user, rec["astronaut_id"])
    return rec


@router.post("/recommendations/{recommendation_id}/approve")
def approve(recommendation_id: str, body: ReviewRecoveryRequest | None = None, user: dict = Depends(planner),
            conn: sqlite3.Connection = Depends(get_db)):
    return recovery.review_recommendation(conn, recommendation_id, user, "approve", body.comment if body else "")


@router.post("/recommendations/{recommendation_id}/reject")
def reject(recommendation_id: str, body: ReviewRecoveryRequest | None = None, user: dict = Depends(planner),
           conn: sqlite3.Connection = Depends(get_db)):
    return recovery.review_recommendation(conn, recommendation_id, user, "reject", body.comment if body else "")


@router.post("/recommendations/{recommendation_id}/schedule", status_code=status.HTTP_201_CREATED)
def schedule(recommendation_id: str, body: ScheduleRecoveryRequest, user: dict = Depends(planner),
             conn: sqlite3.Connection = Depends(get_db)):
    """Book an approved recommendation. Refused if it overlaps a task, sleep, exercise or another recovery."""
    start = parse_time_param(body.scheduled_start, "scheduled_start")
    if start is None:
        raise ValidationFailed("scheduled_start is required")
    return recovery.schedule_recommendation(conn, recommendation_id, user, start)


@router.get("/scheduled")
def scheduled(astronaut_id: str | None = None, date: str | None = Query(None, description="YYYY-MM-DD"),
              completion_status: str | None = None, simulation_run_id: str | None = None,
              user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return recovery.list_bookings(conn, _visible(conn, user, astronaut_id), date=date,
                                  completion_status=completion_status, simulation_run_id=simulation_run_id)


@router.post("/scheduled/{scheduled_recovery_id}/complete")
def complete(scheduled_recovery_id: str, body: RecoveryOutcomeRequest | None = None,
             user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    body = body or RecoveryOutcomeRequest()
    return recovery.record_recovery_outcome(conn, scheduled_recovery_id, user, "completed", body.feedback,
                                            parse_time_param(body.at, "at"))


@router.post("/scheduled/{scheduled_recovery_id}/skip")
def skip(scheduled_recovery_id: str, body: RecoveryOutcomeRequest | None = None,
         user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    body = body or RecoveryOutcomeRequest()
    return recovery.record_recovery_outcome(conn, scheduled_recovery_id, user, "skipped", body.feedback,
                                            parse_time_param(body.at, "at"))
