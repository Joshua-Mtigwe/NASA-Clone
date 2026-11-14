"""Mission and crew reference data."""
import sqlite3

from fastapi import APIRouter, Depends, status

from app.api.deps import current_user
from app.core.errors import NotFound
from app.database.session import get_db
from app.schemas.auth import CreateMissionRequest
from app.services import account_service, auth_service

router = APIRouter(tags=["missions"])


@router.get("/missions")
def list_missions(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return [dict(r) for r in conn.execute("SELECT * FROM missions ORDER BY launch_date")]


@router.post("/missions", status_code=status.HTTP_201_CREATED)
def create_mission(body: CreateMissionRequest, user: dict = Depends(current_user),
                   conn: sqlite3.Connection = Depends(get_db)):
    """Mission leader only. The mission starts empty; register its crew with POST /admin/users."""
    return account_service.create_mission(conn, user, **body.model_dump())


@router.get("/missions/{mission_id}")
def get_mission(mission_id: str, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT * FROM missions WHERE mission_id = ?", (mission_id,)).fetchone()
    if row is None:
        raise NotFound(f"Mission {mission_id} not found")
    return dict(row)


@router.get("/astronauts")
def list_astronauts(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Only the astronauts this user may see (an astronaut sees just themselves)."""
    ids = auth_service.get_permitted_astronauts(conn, user)
    if not ids:
        return []
    marks = ", ".join("?" for _ in ids)
    rows = conn.execute(f"SELECT * FROM astronauts WHERE astronaut_id IN ({marks}) ORDER BY astronaut_id", ids)
    return [dict(r) for r in rows]


@router.get("/astronauts/{astronaut_id}")
def get_astronaut(astronaut_id: str, user: dict = Depends(current_user),
                  conn: sqlite3.Connection = Depends(get_db)):
    auth_service.require_astronaut_access(conn, user, astronaut_id)
    astronaut = dict(conn.execute("SELECT * FROM astronauts WHERE astronaut_id = ?", (astronaut_id,)).fetchone())
    astronaut["qualifications"] = [dict(r) for r in conn.execute(
        "SELECT * FROM astronaut_qualifications WHERE astronaut_id = ? ORDER BY valid_from", (astronaut_id,))]
    return astronaut
