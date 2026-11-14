"""Simulation runs and events. Anyone signed in can read; only the mission leader controls runs."""
import sqlite3

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import current_user, require_roles
from app.core import permissions
from app.database.session import get_db
from app.schemas.simulation import CreateRunRequest, JumpRequest, SimulationEvent, SimulationState, SpeedRequest
from app.services import mission_simulator as sim

router = APIRouter(prefix="/simulation", tags=["simulation"])
controller = require_roles(*permissions.SIMULATION_CONTROL_ROLES)


def _announce(state: dict, event: str) -> dict:
    sim.broadcast_simulation_update(state["simulation_run_id"], state, event)
    return state


@router.get("/runs", response_model=list[SimulationState])
def list_runs(mission_id: str | None = None, user: dict = Depends(current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    return sim.list_simulation_runs(conn, mission_id)


@router.post("/runs", response_model=SimulationState, status_code=status.HTTP_201_CREATED)
def create_run(body: CreateRunRequest, user: dict = Depends(controller), conn: sqlite3.Connection = Depends(get_db)):
    """Create an isolated run (paused) with its own copy of the scenario events."""
    return sim.create_simulation_run(conn, actor_user_id=user["user_id"], **body.model_dump())


@router.get("/runs/{run_id}", response_model=SimulationState)
def get_run(run_id: str, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return sim.get_simulation_state(conn, run_id)


@router.post("/runs/{run_id}/start", response_model=SimulationState)
def start_run(run_id: str, user: dict = Depends(controller), conn: sqlite3.Connection = Depends(get_db)):
    return _announce(sim.start_simulation(conn, run_id, actor_user_id=user["user_id"]), "started")


@router.post("/runs/{run_id}/pause", response_model=SimulationState)
def pause_run(run_id: str, user: dict = Depends(controller), conn: sqlite3.Connection = Depends(get_db)):
    return _announce(sim.pause_simulation(conn, run_id, actor_user_id=user["user_id"]), "paused")


@router.put("/runs/{run_id}/speed", response_model=SimulationState)
def set_speed(run_id: str, body: SpeedRequest, user: dict = Depends(controller),
              conn: sqlite3.Connection = Depends(get_db)):
    state = sim.set_simulation_speed(conn, run_id, body.speed_multiplier, actor_user_id=user["user_id"])
    return _announce(state, "speed_changed")


@router.post("/runs/{run_id}/jump", response_model=SimulationState)
def jump(run_id: str, body: JumpRequest, user: dict = Depends(controller),
         conn: sqlite3.Connection = Depends(get_db)):
    state = sim.jump_to_mission_day(conn, run_id, body.mission_day, actor_user_id=user["user_id"])
    return _announce(state, "jumped")


@router.get("/events", response_model=list[SimulationEvent])
def list_events(
    simulation_run_id: str = Query("RUN-DEMO-001"),
    up_to_current: bool = Query(False, description="Only events up to the run's current mission time"),
    include_reference: bool = Query(False, description="Add shared NASA reference events (no mission day)"),
    from_day: int | None = Query(None, ge=1),
    to_day: int | None = Query(None, ge=1),
    user: dict = Depends(current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    return sim.get_simulation_events(conn, simulation_run_id, up_to_current=up_to_current,
                                     include_reference=include_reference, from_day=from_day, to_day=to_day)
