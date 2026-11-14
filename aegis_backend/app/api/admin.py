"""Administration: import status, provenance and audit trail."""
import sqlite3

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_roles
from app.core import permissions
from app.core.config import get_settings
from app.database.session import get_db
from app.core.errors import ValidationFailed
from app.services import audit_service, data_import_service, health_changes_service, physiology_service
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
