"""Open demo helpers."""
import sqlite3

from fastapi import APIRouter, Depends

from app.api.deps import require_roles
from app.core import permissions
from app.database.session import get_db
from app.services import demo_service

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/reset")
def reset_demo(user: dict = Depends(require_roles(permissions.MISSION_LEADER)),
               conn: sqlite3.Connection = Depends(get_db)):
    """Put all data back to the 49 seed CSVs (open demo mode only, as the mission leader persona).

    Everything visitors changed is removed: simulation runs, plans, tests taken, reports, sync events.
    Takes a few seconds.
    """
    return demo_service.reset_demo_database(conn, user)
