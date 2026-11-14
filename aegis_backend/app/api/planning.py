"""Mission Planning dashboard (Phase 4).

Viewing tasks is open to anyone signed in. Readiness, eligibility and schedule versions are
for staff. Running the optimiser and approving / rejecting / publishing schedules is for the
mission leader only.
"""
import sqlite3

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import current_user, require_roles
from app.core import permissions
from app.database.session import get_db
from app.schemas.planning import OptimizeRequest, RecordTimeRequest, RejectRequest, SkipTaskRequest
from app.services import crew_readiness_service as readiness
from app.services import auth_service, schedule_service, scheduling_optimizer, task_execution_service, task_service
from app.services.health_context import parse_time_param, resolve_as_of

router = APIRouter(prefix="/planning", tags=["planning"])
staff = require_roles(*permissions.CREW_WIDE_ROLES)
leader = require_roles(permissions.MISSION_LEADER)


@router.get("/task-sets")
def task_sets(from_day: int | None = Query(None, ge=1), to_day: int | None = Query(None, ge=1),
              mission_id: str = "MIS-001", user: dict = Depends(current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    return task_service.get_available_task_sets(conn, mission_id, from_day, to_day)


@router.get("/task-sets/{task_set_id}")
def task_set(task_set_id: str, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """The day's tasks in dependency order, with requirements (dependencies are checked for cycles)."""
    return task_service.get_task_planning_payload(conn, task_set_id)


@router.get("/task-sets/{task_set_id}/eligibility")
def eligibility(task_set_id: str, workday_start_hour: int = Query(9, ge=0, le=23),
                simulation_run_id: str = "RUN-DEMO-001",
                user: dict = Depends(staff), conn: sqlite3.Connection = Depends(get_db)):
    """Who may do each task, and why not, before any optimisation."""
    payload = task_service.get_task_planning_payload(conn, task_set_id)
    at = readiness.readiness_time_for(payload["task_set"]["task_date"], workday_start_hour)
    return readiness.build_crew_planning_matrix(conn, payload["tasks"], at, payload["task_set"]["mission_id"],
                                                simulation_run_id)


@router.get("/crew-readiness")
def crew_readiness(at: str | None = Query(None, description="ISO-8601 UTC. Default: the run's mission time"),
                   simulation_run_id: str | None = None,
                   user: dict = Depends(staff), conn: sqlite3.Connection = Depends(get_db)):
    when = parse_time_param(at, "at") or resolve_as_of(conn, None, simulation_run_id)
    return readiness.get_crew_readiness(conn, when)


@router.get("/qualifications")
def qualifications(astronaut_id: str | None = None, user: dict = Depends(staff),
                   conn: sqlite3.Connection = Depends(get_db)):
    """Approved and demo qualifications. Demo ones (not verified) never count for safety-critical tasks."""
    return readiness.list_qualifications(conn, astronaut_id)


@router.post("/optimize", status_code=status.HTTP_201_CREATED)
def optimize(body: OptimizeRequest, user: dict = Depends(leader), conn: sqlite3.Connection = Depends(get_db)):
    """Plan one day. Creates an optimisation run and, if anything fits, a DRAFT schedule version."""
    return scheduling_optimizer.plan_task_set(
        conn, task_set_id=body.task_set_id, simulation_run_id=body.simulation_run_id, actor_user_id=user["user_id"],
        workday_start_hour=body.workday_start_hour, require_full_coverage=body.require_full_coverage,
        solver=body.solver)


@router.get("/optimization-runs/{optimization_run_id}")
def optimization_run(optimization_run_id: str, user: dict = Depends(staff),
                     conn: sqlite3.Connection = Depends(get_db)):
    """Solver, status, objective and the reasons for anything left unscheduled."""
    return scheduling_optimizer.get_optimization_run(conn, optimization_run_id)


@router.get("/jobs/{optimization_run_id}")
def planning_job(optimization_run_id: str, user: dict = Depends(staff), conn: sqlite3.Connection = Depends(get_db)):
    """Same as /optimization-runs/{id}. Planning runs synchronously, so a job is finished when returned."""
    return scheduling_optimizer.get_optimization_run(conn, optimization_run_id)


@router.get("/schedule-versions")
def schedule_versions(simulation_run_id: str | None = None, task_set_id: str | None = None,
                      user: dict = Depends(staff), conn: sqlite3.Connection = Depends(get_db)):
    return schedule_service.list_schedule_versions(conn, simulation_run_id, task_set_id)


@router.get("/schedule-versions/{schedule_version_id}")
def schedule_version(schedule_version_id: str, user: dict = Depends(staff),
                     conn: sqlite3.Connection = Depends(get_db)):
    return schedule_service.get_schedule_version(conn, schedule_version_id)


@router.get("/schedule-versions/{schedule_version_id}/check")
def check_version(schedule_version_id: str, user: dict = Depends(staff), conn: sqlite3.Connection = Depends(get_db)):
    """Run the approval safety re-check without approving."""
    problems = schedule_service.validate_schedule_version(
        conn, schedule_service.get_schedule_version(conn, schedule_version_id))
    return {"schedule_version_id": schedule_version_id, "ok": not problems, "problems": problems}


@router.post("/schedule-versions/{schedule_version_id}/approve")
def approve(schedule_version_id: str, user: dict = Depends(leader), conn: sqlite3.Connection = Depends(get_db)):
    """Approve a draft after a full safety re-check; supersedes older approved versions for that day."""
    return schedule_service.approve_schedule_version(conn, schedule_version_id, user)


@router.post("/schedules/{schedule_version_id}/approve", include_in_schema=False)
def approve_alias(schedule_version_id: str, user: dict = Depends(leader), conn: sqlite3.Connection = Depends(get_db)):
    """Route name used in the plan's dashboard table."""
    return schedule_service.approve_schedule_version(conn, schedule_version_id, user)


@router.post("/schedule-versions/{schedule_version_id}/reject")
def reject(schedule_version_id: str, body: RejectRequest | None = None, user: dict = Depends(leader),
           conn: sqlite3.Connection = Depends(get_db)):
    return schedule_service.reject_schedule_version(conn, schedule_version_id, user, body.reason if body else "")


@router.post("/schedule-versions/{schedule_version_id}/publish")
def publish(schedule_version_id: str, user: dict = Depends(leader), conn: sqlite3.Connection = Depends(get_db)):
    """Put an approved version on the crew calendar."""
    return schedule_service.publish_approved_schedule(conn, schedule_version_id, user)


# --------------------------------------------------------------------------- what actually happened

@router.get("/assignments")
def assignments(astronaut_id: str | None = None, date: str | None = Query(None, description="YYYY-MM-DD"),
                assignment_status: str | None = None, simulation_run_id: str = "RUN-DEMO-001",
                user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Tasks on the crew calendar with their planned and actual times. Astronauts see only their own."""
    if astronaut_id:
        auth_service.require_astronaut_access(conn, user, astronaut_id)
        visible = [astronaut_id]
    else:
        visible = auth_service.get_permitted_astronauts(conn, user)
    return task_execution_service.list_assignments(conn, visible, simulation_run_id=simulation_run_id, date=date,
                                                   assignment_status=assignment_status)


@router.post("/assignments/{task_assignment_id}/start")
def start_task(task_assignment_id: str, body: RecordTimeRequest | None = None, user: dict = Depends(current_user),
               conn: sqlite3.Connection = Depends(get_db)):
    """The assigned astronaut (or the mission leader) starts a published task. Dependencies must be done."""
    return task_execution_service.start_assignment(conn, task_assignment_id, user,
                                                   parse_time_param(body.at if body else None, "at"))


@router.post("/assignments/{task_assignment_id}/complete")
def complete_task(task_assignment_id: str, body: RecordTimeRequest | None = None, user: dict = Depends(current_user),
                  conn: sqlite3.Connection = Depends(get_db)):
    return task_execution_service.complete_assignment(conn, task_assignment_id, user,
                                                      parse_time_param(body.at if body else None, "at"))


@router.post("/assignments/{task_assignment_id}/skip")
def skip_task(task_assignment_id: str, body: SkipTaskRequest, user: dict = Depends(current_user),
              conn: sqlite3.Connection = Depends(get_db)):
    return task_execution_service.skip_assignment(conn, task_assignment_id, user, body.reason,
                                                  parse_time_param(body.at, "at"))
