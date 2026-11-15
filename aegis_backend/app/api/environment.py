"""Cabin environment and radiation research series (Phase 2). Cabin data is crew-wide, not personal."""
import sqlite3

from fastapi import APIRouter, Depends, Query

from app.api.deps import current_user, require_roles
from app.core import permissions
from app.database.session import get_db
from app.services import environment_service as environment
from app.services import radiation_service as radiation
from app.services.health_context import resolve_as_of, resolve_range

router = APIRouter(tags=["environment"])

AT = Query(None, description="Mission time, ISO-8601 UTC. Default: the simulation run's current time.")
RUN = Query(None, description="Simulation run whose clock defines 'now'. Default: RUN-DEMO-001.")


@router.get("/environment/current")
def environment_current(at: str | None = AT, simulation_run_id: str | None = RUN,
                        user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return environment.get_current_environment(conn, resolve_as_of(conn, at, simulation_run_id))


@router.get("/environment/history")
def environment_history(measurement_type: str = Query(..., description="cabin_co2, cabin_temperature, "
                                                                      "cabin_humidity or cabin_pressure"),
                        resolution: str = Query("daily"), start: str | None = None, end: str | None = None,
                        at: str | None = AT, simulation_run_id: str | None = RUN,
                        user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    s, e = resolve_range(start, end, resolve_as_of(conn, at, simulation_run_id),
                         default_days=7 if resolution == "hourly" else 30)
    return environment.get_environment_history(conn, measurement_type, s, e, resolution)


@router.get("/environment/averages")
def environment_averages(start: str | None = None, end: str | None = None, at: str | None = AT,
                         simulation_run_id: str | None = RUN,
                         user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    s, e = resolve_range(start, end, resolve_as_of(conn, at, simulation_run_id), default_days=7)
    return environment.calculate_environment_averages(conn, s, e)


@router.get("/environment/events")
def environment_events(simulation_run_id: str = Query("RUN-DEMO-001"), start: str | None = None,
                       end: str | None = None, at: str | None = AT,
                       user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    s, e = resolve_range(start, end, resolve_as_of(conn, at, simulation_run_id), default_days=30)
    return environment.identify_environment_scenario_events(conn, simulation_run_id, s, e)


@router.get("/research/radiation-series")
def radiation_series(astronaut_id: str | None = None,
                     include_reference: bool = Query(False, description="Add NASA Mars RAD readings (uGy/h), "
                                                                        "returned in a separate block"),
                     start: str | None = None, end: str | None = None, at: str | None = AT,
                     simulation_run_id: str | None = RUN,
                     user: dict = Depends(require_roles(*permissions.CREW_WIDE_ROLES)),
                     conn: sqlite3.Connection = Depends(get_db)):
    s, e = resolve_range(start, end, resolve_as_of(conn, at, simulation_run_id), default_days=90)
    return radiation.prepare_radiation_research_series(conn, s, e, astronaut_id, include_reference)
