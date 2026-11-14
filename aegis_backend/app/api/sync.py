"""Offline sync (Phase 7).

Devices: GET /sync/pull before going offline, POST /sync/events when the link is back.
Staff (mission leader, medical officer): /admin/sync-status, /admin/sync-conflicts, /admin/sync-events,
and resolving conflicts. Nothing a device sends ever silently overwrites a changed record.
"""
import sqlite3

from fastapi import APIRouter, Depends, Query

from app.api.deps import current_user, require_roles
from app.core import permissions
from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.database.session import get_db
from app.schemas.sync import ResolveConflictIn, SyncBatchIn
from app.services import auth_service, sync_service
from app.services.assessment_service import astronaut_id_for_user

router = APIRouter(tags=["sync"])
sync_admin = require_roles(*permissions.SYNC_ADMIN_ROLES)


@router.get("/sync/pull")
def pull(astronaut_id: str | None = Query(None, description="Default: the signed-in astronaut"),
         simulation_run_id: str | None = None, date: str | None = Query(None, description="YYYY-MM-DD"),
         user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """The records a device should cache before going offline, each with its sync_version."""
    target = astronaut_id or astronaut_id_for_user(conn, user)
    if target is None:
        raise ValidationFailed("astronaut_id is required for staff accounts")
    auth_service.require_astronaut_access(conn, user, target)
    return sync_service.pull_records(conn, target, simulation_run_id=simulation_run_id
                                     or get_settings().default_template_run_id, date=date)


@router.post("/sync/events")
def upload(body: SyncBatchIn, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Upload a device's offline actions. Each is replayed with your own permissions, in order.

    Outcome per event: applied, duplicate (already on the server), conflict (record changed; a person
    decides), rejected (a rule refused it; see error), or failed (temporary; retried later).
    """
    return sync_service.upload_batch(conn, device_id=body.device_id, user=user,
                                     events=[e.model_dump() for e in body.events])


@router.get("/sync/events")
def my_events(device_id: str | None = None, status: str | None = None, limit: int = Query(100, ge=1, le=1000),
              user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Your own uploaded events and what happened to them."""
    return sync_service.list_sync_events(conn, device_id=device_id, status=status, user_id=user["user_id"],
                                         limit=limit)


@router.get("/admin/sync-status")
def sync_status(user: dict = Depends(sync_admin), conn: sqlite3.Connection = Depends(get_db)):
    """Events by status, open conflicts, the oldest waiting event, and every device's last sync."""
    return sync_service.get_sync_status(conn)


@router.get("/admin/sync-events")
def sync_events(device_id: str | None = None, status: str | None = None, limit: int = Query(200, ge=1, le=1000),
                user: dict = Depends(sync_admin), conn: sqlite3.Connection = Depends(get_db)):
    return sync_service.list_sync_events(conn, device_id=device_id, status=status, limit=limit)


@router.get("/admin/sync-conflicts")
def sync_conflicts(status: str | None = Query("open", description="open, kept_server, applied_after_review; "
                                                                  "empty for all"),
                   entity_type: str | None = None, user: dict = Depends(sync_admin),
                   conn: sqlite3.Connection = Depends(get_db)):
    """The offline conflict queue: the device's action, the server's version then, and the record now."""
    return sync_service.list_sync_conflicts(conn, status or None, entity_type)


@router.get("/admin/sync-conflicts/{conflict_id}")
def sync_conflict(conflict_id: str, user: dict = Depends(sync_admin), conn: sqlite3.Connection = Depends(get_db)):
    return sync_service.get_sync_conflict(conn, conflict_id)


@router.post("/admin/sync-conflicts/{conflict_id}/resolve")
def resolve(conflict_id: str, body: ResolveConflictIn, user: dict = Depends(sync_admin),
            conn: sqlite3.Connection = Depends(get_db)):
    """keep_server: discard the device's action. reapply: re-run it on the current record (all rules apply)."""
    return sync_service.resolve_sync_conflict(conn, conflict_id, user, body.resolution, body.notes)


@router.post("/admin/sync/replay")
def replay(device_id: str | None = None, user: dict = Depends(sync_admin), conn: sqlite3.Connection = Depends(get_db)):
    """Retry events still waiting (pending, or failed because the database was busy)."""
    return sync_service.replay_pending_events(conn, device_id)
