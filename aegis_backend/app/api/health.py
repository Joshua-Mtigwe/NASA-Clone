"""Astronaut Health dashboard (Phase 2).

Every route checks that the signed-in user may see this astronaut: an astronaut sees only
themselves; mission leader, researcher and medical officer see the whole crew.

Time: by default "now" is the current mission time of RUN-DEMO-001 (move that run's clock to
move the dashboard). Pass ?simulation_run_id=... to follow another run, or ?at=2027-04-15T09:00:00Z.
"""
import sqlite3
from datetime import timedelta

from fastapi import APIRouter, Depends, Query

from app.api.deps import current_user
from app.core.errors import ValidationFailed
from app.database.session import get_db
from app.services import auth_service, health_changes_service
from app.services import physiology_service as physiology
from app.services import radiation_service as radiation
from app.services import sleep_activity_service as sleep_activity
from app.services.health_context import parse_time_param, resolve_as_of, resolve_range
from app.utils.timestamps import to_iso

router = APIRouter(prefix="/astronauts/{astronaut_id}", tags=["astronaut health"])

AT = Query(None, description="Mission time to view, ISO-8601 UTC. Default: the simulation run's current time.")
RUN = Query(None, description="Simulation run whose clock defines 'now'. Default: RUN-DEMO-001.")
START = Query(None, description="Window start, ISO-8601 UTC")
END = Query(None, description="Window end, ISO-8601 UTC. Default: 'now'.")
VITAL = Query(..., description="heart_rate, hrv_rmssd, spo2, body_temperature or respiratory_rate")


def _access(conn: sqlite3.Connection, user: dict, astronaut_id: str) -> None:
    auth_service.require_astronaut_access(conn, user, astronaut_id)


@router.get("/health/summary")
def health_summary(astronaut_id: str, at: str | None = AT, simulation_run_id: str | None = RUN,
                   user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """One call for the dashboard header: current vitals, radiation, last sleep, recent workload, changes."""
    _access(conn, user, astronaut_id)
    as_of = resolve_as_of(conn, at, simulation_run_id)
    last_sleep = sleep_activity.get_sleep_history(conn, astronaut_id, as_of - timedelta(days=2), as_of)["records"]
    changes = health_changes_service.calculate_health_changes(conn, astronaut_id, as_of)
    return {
        "astronaut_id": astronaut_id,
        "as_of": to_iso(as_of),
        "vitals": physiology.get_current_vitals(conn, astronaut_id, as_of)["vitals"],
        "radiation": radiation.get_current_radiation(conn, astronaut_id, as_of)["latest"],
        "last_sleep": last_sleep[-1] if last_sleep else None,
        "recent_workload": sleep_activity.calculate_recent_workload(conn, astronaut_id, as_of, 7),
        "changes": {k: changes[k] for k in ("status", "notable_metrics", "mild_metrics", "disclaimer")},
    }


@router.get("/vitals/current")
def vitals_current(astronaut_id: str, at: str | None = AT, simulation_run_id: str | None = RUN,
                   user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    return physiology.get_current_vitals(conn, astronaut_id, resolve_as_of(conn, at, simulation_run_id))


@router.get("/vitals/history")
def vitals_history(astronaut_id: str, measurement_type: str = VITAL,
                   resolution: str = Query("daily", description="'hourly' (max 31 days) or 'daily'"),
                   start: str | None = START, end: str | None = END, at: str | None = AT,
                   simulation_run_id: str | None = RUN,
                   user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    as_of = resolve_as_of(conn, at, simulation_run_id)
    s, e = resolve_range(start, end, as_of, default_days=7 if resolution == "hourly" else 30)
    return physiology.get_vital_history(conn, astronaut_id, measurement_type, s, e, resolution)


@router.get("/vitals/stats")
def vitals_stats(astronaut_id: str, measurement_type: str = VITAL, start: str | None = START,
                 end: str | None = END, at: str | None = AT, simulation_run_id: str | None = RUN,
                 user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    s, e = resolve_range(start, end, resolve_as_of(conn, at, simulation_run_id), default_days=7)
    return physiology.calculate_mean_vital(conn, astronaut_id, measurement_type, s, e)


@router.get("/vitals/rolling")
def vitals_rolling(astronaut_id: str, measurement_type: str = VITAL, window_days: int = Query(7, ge=1, le=30),
                   start: str | None = START, end: str | None = END, at: str | None = AT,
                   simulation_run_id: str | None = RUN,
                   user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    s, e = resolve_range(start, end, resolve_as_of(conn, at, simulation_run_id), default_days=30)
    return physiology.calculate_rolling_average(conn, astronaut_id, measurement_type, s, e, window_days)


@router.get("/vitals/trend")
def vitals_trend(astronaut_id: str, measurement_type: str = VITAL, days: int = Query(14, ge=3, le=90),
                 at: str | None = AT, simulation_run_id: str | None = RUN,
                 user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    return physiology.calculate_vital_trend(conn, astronaut_id, measurement_type,
                                            resolve_as_of(conn, at, simulation_run_id), days)


@router.get("/body-map")
def body_map(astronaut_id: str, at: str | None = AT, simulation_run_id: str | None = RUN,
             user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    return physiology.prepare_body_map_metrics(conn, astronaut_id, resolve_as_of(conn, at, simulation_run_id))


@router.get("/radiation")
def radiation_view(astronaut_id: str, start: str | None = START, end: str | None = END, at: str | None = AT,
                   simulation_run_id: str | None = RUN,
                   user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Latest reading plus cumulative exposure over the window (default: whole mission so far)."""
    _access(conn, user, astronaut_id)
    as_of = resolve_as_of(conn, at, simulation_run_id)
    s, e = resolve_range(start, end, as_of, default_days=90)
    return {"current": radiation.get_current_radiation(conn, astronaut_id, as_of),
            "cumulative": radiation.calculate_cumulative_exposure(conn, astronaut_id, s, e)}


@router.get("/radiation/organ-doses")
def organ_doses(astronaut_id: str, start: str | None = START, end: str | None = END, at: str | None = AT,
                simulation_run_id: str | None = RUN,
                user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    s, e = resolve_range(start, end, resolve_as_of(conn, at, simulation_run_id), default_days=90)
    return radiation.get_organ_dose_estimates(conn, astronaut_id, s, e)


@router.get("/sleep")
def sleep_view(astronaut_id: str, days: int = Query(14, ge=3, le=90), at: str | None = AT,
               simulation_run_id: str | None = RUN,
               user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    as_of = resolve_as_of(conn, at, simulation_run_id)
    return {"history": sleep_activity.get_sleep_history(conn, astronaut_id, as_of - timedelta(days=days), as_of),
            "consistency": sleep_activity.calculate_sleep_consistency(conn, astronaut_id, as_of, days)}


@router.get("/sleep/pre-assessment")
def sleep_before_assessment(astronaut_id: str, assessment_time: str = Query(..., description="ISO-8601 UTC"),
                            user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    return sleep_activity.get_pre_assessment_sleep_context(
        conn, astronaut_id, parse_time_param(assessment_time, "assessment_time"))


@router.get("/activity")
def activity_view(astronaut_id: str, days: int = Query(7, ge=1, le=90), at: str | None = AT,
                  simulation_run_id: str | None = RUN,
                  user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    as_of = resolve_as_of(conn, at, simulation_run_id)
    return {"history": sleep_activity.get_activity_history(conn, astronaut_id, as_of - timedelta(days=days), as_of),
            "workload": sleep_activity.calculate_recent_workload(conn, astronaut_id, as_of, days)}


@router.get("/schedule")
def schedule_view(astronaut_id: str, date: str | None = Query(None, description="YYYY-MM-DD. Default: 'now'."),
                  at: str | None = AT, simulation_run_id: str | None = RUN,
                  user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _access(conn, user, astronaut_id)
    day = parse_time_param(date, "date") if date else resolve_as_of(conn, at, simulation_run_id)
    return sleep_activity.get_astronaut_schedule(conn, astronaut_id, day)


@router.get("/health/changes")
def health_changes(astronaut_id: str, reference_days: int = Query(7, ge=3, le=30),
                   recent_days: int = Query(7, ge=3, le=30),
                   category: list[str] | None = Query(None, description="vitals, sleep, activity, radiation, self_report"),
                   at: str | None = AT, simulation_run_id: str | None = RUN,
                   user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """How this astronaut's metrics changed vs their own first mission week."""
    _access(conn, user, astronaut_id)
    if category and not set(category) <= set(health_changes_service.CATEGORIES):
        raise ValidationFailed(f"category must be from {health_changes_service.CATEGORIES}")
    return health_changes_service.calculate_health_changes(
        conn, astronaut_id, resolve_as_of(conn, at, simulation_run_id), reference_days, recent_days, category)
