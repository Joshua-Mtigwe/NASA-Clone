"""Administration: import status, provenance and audit trail."""
import sqlite3

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import require_roles, token_mode_only
from app.core import permissions
from app.core.config import get_settings, is_open_mode
from app.database.session import get_db
from app.core.errors import ValidationFailed
from app.schemas.auth import CreateUserRequest
from app.services import account_service, ai_service, audit_service, data_import_service, health_changes_service, physiology_service
from app.services.health_context import resolve_as_of, resolve_range

router = APIRouter(prefix="/admin", tags=["admin"])
admin_reader = require_roles(*permissions.ADMIN_READ_ROLES)
health_admin = require_roles(*permissions.HEALTH_ADMIN_ROLES)


@router.get("/crew-health/changes")
def crew_health_changes(
    reference_days: int = Query(7, ge=3, le=30, description="Days from launch used as each astronaut's normal"),
    recent_days: int = Query(7, ge=3, le=30, description="Days up to 'now' compared against it"),
    category: list[str] | None = Query(None, description="vitals, sleep, activity, radiation, self_report"),
    only_changes: bool = Query(False, description="Return only metrics marked notable or mild"),
    at: str | None = Query(None, description="Mission time, ISO-8601 UTC. Default: simulation run's current time"),
    simulation_run_id: str | None = None,
    user: dict = Depends(health_admin),
    conn: sqlite3.Connection = Depends(get_db),
):
    """Every astronaut's health changes vs their own first mission week, most changed first.

    Each view is recorded in audit_logs (who looked at crew health, and for which time).
    """
    if category and not set(category) <= set(health_changes_service.CATEGORIES):
        raise ValidationFailed(f"category must be from {health_changes_service.CATEGORIES}")
    return health_changes_service.get_crew_health_changes(
        conn, resolve_as_of(conn, at, simulation_run_id), actor_user_id=user["user_id"],
        reference_days=reference_days, recent_days=recent_days, categories=category, only_changes=only_changes)


@router.get("/sensor-quality")
def sensor_quality(
    astronaut_id: str | None = None,
    start: str | None = None,
    end: str | None = None,
    at: str | None = None,
    simulation_run_id: str | None = None,
    user: dict = Depends(health_admin),
    conn: sqlite3.Connection = Depends(get_db),
):
    """Missing hours, non-valid readings, duplicates and impossible values (max 31 days, default 7)."""
    s, e = resolve_range(start, end, resolve_as_of(conn, at, simulation_run_id), default_days=7)
    return physiology_service.detect_sensor_quality_issues(conn, s, e, astronaut_id)


@router.get("/import-status")
def import_status(user: dict = Depends(admin_reader), conn: sqlite3.Connection = Depends(get_db)):
    """Row counts per table vs data_lineage, recent imports and foreign-key violations."""
    return data_import_service.get_import_status(conn)


@router.get("/import-runs/latest")
def latest_import_report(user: dict = Depends(admin_reader), conn: sqlite3.Connection = Depends(get_db)):
    return data_import_service.get_import_report(conn)


@router.get("/import-runs/{import_run_id}")
def import_report(import_run_id: str, user: dict = Depends(admin_reader),
                  conn: sqlite3.Connection = Depends(get_db)):
    return data_import_service.get_import_report(conn, import_run_id)


@router.post("/import")
def run_import(user: dict = Depends(require_roles(permissions.MISSION_LEADER)),
               conn: sqlite3.Connection = Depends(get_db)):
    """Re-run the seed import. Idempotent: existing rows are never changed."""
    return data_import_service.seed_demo_database(conn, get_settings().seed_dir)


@router.get("/data-sources")
def data_sources(user: dict = Depends(admin_reader), conn: sqlite3.Connection = Depends(get_db)):
    return [dict(r) for r in conn.execute("SELECT * FROM data_sources ORDER BY source_id")]


@router.get("/data-lineage")
def data_lineage(user: dict = Depends(admin_reader), conn: sqlite3.Connection = Depends(get_db)):
    return [dict(r) for r in conn.execute("SELECT * FROM data_lineage ORDER BY csv_filename")]


@router.get("/audit-logs")
def audit_logs(
    user_id: str | None = None,
    entity_type: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    user: dict = Depends(admin_reader),
    conn: sqlite3.Connection = Depends(get_db),
):
    return audit_service.list_audit_logs(conn, user_id=user_id, entity_type=entity_type, limit=limit)


# --------------------------------------------------------------------------- accounts

user_admin = require_roles(*permissions.USER_ADMIN_ROLES)


@router.get("/users")
def users(role_name: str | None = None, mission_id: str | None = None, account_status: str | None = None,
          user: dict = Depends(admin_reader), conn: sqlite3.Connection = Depends(get_db)):
    """Accounts with their role and, for astronauts, their mission and crew role. Never returns passwords."""
    return account_service.list_users(conn, role_name=role_name, mission_id=mission_id,
                                      account_status=account_status)


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(body: CreateUserRequest, user: dict = Depends(user_admin),
                conn: sqlite3.Connection = Depends(get_db)):
    """Register an account (open mode: a new persona, never with a password). For role 'astronaut',
    also give mission_id to create their astronaut profile. Token mode: if no password is sent, a
    temporary one is returned once."""
    return account_service.create_user(conn, user, **body.model_dump())


@router.get("/users/{user_id}")
def get_user(user_id: str, user: dict = Depends(admin_reader), conn: sqlite3.Connection = Depends(get_db)):
    return account_service.get_user(conn, user_id)


@router.post("/users/{user_id}/deactivate")
def deactivate_user(user_id: str, user: dict = Depends(user_admin), conn: sqlite3.Connection = Depends(get_db)):
    """Block sign-in and end the account's sessions. Its records are kept."""
    return account_service.set_account_status(conn, user, user_id, active=False)


@router.post("/users/{user_id}/reactivate")
def reactivate_user(user_id: str, user: dict = Depends(user_admin), conn: sqlite3.Connection = Depends(get_db)):
    return account_service.set_account_status(conn, user, user_id, active=True)


@router.post("/users/{user_id}/reset-password", include_in_schema=not is_open_mode(),
             dependencies=[Depends(token_mode_only)])
def reset_password(user_id: str, user: dict = Depends(user_admin), conn: sqlite3.Connection = Depends(get_db)):
    """Token mode: returns a new temporary password once and signs the user out everywhere."""
    return account_service.reset_password(conn, user, user_id)


# --------------------------------------------------------------------------- AI (Phase 6)

@router.get("/ai-inferences")
def ai_inferences(purpose: str | None = None, status: str | None = None, simulation_run_id: str | None = None,
                  limit: int = Query(100, ge=1, le=1000), user: dict = Depends(admin_reader),
                  conn: sqlite3.Connection = Depends(get_db)):
    """Every call made to the AI model: purpose, model, prompt version, hashes, timing and outcome
    (succeeded, failed or rejected_by_check). Prompts and answers are stored as hashes only."""
    return ai_service.list_inferences(conn, purpose=purpose, status=status, simulation_run_id=simulation_run_id,
                                      limit=limit)


@router.get("/model-status")
def model_status(user: dict = Depends(admin_reader), conn: sqlite3.Connection = Depends(get_db)):
    """Is the local model server running and is the configured Gemma model installed?"""
    return ai_service.model_status(conn)
