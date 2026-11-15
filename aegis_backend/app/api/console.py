"""Explicit dashboard adapters; legacy routes and scientific services stay intact."""

import sqlite3
from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool
from pydantic import ValidationError
from fastapi.exceptions import RequestValidationError
from app.api.deps import current_user
from app.core.config import is_open_mode
from app.core.errors import NotFound, ValidationFailed
from app.database.session import get_db
from app.services import auth_service, mission_simulator
from app.utils.timestamps import to_iso, parse_iso

router = APIRouter(prefix="/console", tags=["integrated dashboards"])


def rows(c, sql, args=()):
    return [dict(r) for r in c.execute(sql, args)]


def one(c, table, key, value):
    r = c.execute(f"SELECT * FROM {table} WHERE {key} = ?", (value,)).fetchone()
    if r is None:
        raise NotFound(f"{table} record not found")
    return dict(r)


def now(c):
    return mission_simulator.get_simulation_state(c, "RUN-DEMO-001")[
        "current_mission_time"
    ]


def access(c, u, aid):
    auth_service.require_astronaut_access(c, u, aid)


def staff(u):
    auth_service.require_role(
        u,
        "mission_leader",
        "medical_researcher",
        "medical_officer",
        "mission_control_admin",
    )


def leader(u):
    auth_service.require_role(u, "mission_leader")


def public_user(c, u):
    astronaut = c.execute(
        "SELECT astronaut_id FROM astronauts WHERE user_id=?", (u["user_id"],)
    ).fetchone()
    return {
        **u,
        "role": u["role_name"],
        "astronaut_id": astronaut[0] if astronaut else None,
    }


def page(items, q):
    try:
        limit = min(10000, max(1, int(q.get("limit", 1000))))
        offset = max(0, int(q.get("offset", 0)))
    except ValueError as exc:
        raise ValidationFailed("Invalid pagination") from exc
    return {
        "items": items[offset : offset + limit],
        "total": len(items),
        "limit": limit,
        "offset": offset,
    }


def history(c, table, aid, time_col, q, extra="", args=()):
    cutoff = now(c)
    end = q.get("to", cutoff)
    if len(end) == 10:
        end += "T23:59:59Z"
    end = min(to_iso(parse_iso(end)), cutoff)
    start = to_iso(parse_iso(q["from"])) if q.get("from") else "0001"
    where = f"{time_col} >= ? AND {time_col} <= ?"
    values = [start, end]
    if aid is not None:
        where += " AND astronaut_id = ?"
        values.append(aid)
    return rows(
        c,
        f"SELECT * FROM {table} WHERE {where} {extra} ORDER BY {time_col}",
        (*values, *args),
    )


def mission_state(c):
    run = mission_simulator.get_simulation_state(c, "RUN-DEMO-001")
    mission = one(c, "missions", "mission_id", run["mission_id"])
    return {
        "mission": mission,
        "simulation_run": run,
        "mission_time": run["current_mission_time"],
        "mission_day": run["mission_day"],
        "mission_length_days": run["mission_total_days"],
        "data_mode": run["data_mode"],
        "is_synthetic": run["data_mode"] == "synthetic_demo",
    }


@router.get("/auth/demo-accounts")
def accounts(conn: sqlite3.Connection = Depends(get_db)):
    if not is_open_mode():
        raise NotFound("Demo sessions are disabled in token mode")
    return rows(
        conn,
        """SELECT u.username, r.role_name AS role, r.description AS role_description,
        a.astronaut_id, a.astronaut_code, a.crew_role, a.specialization FROM users u
        JOIN roles r ON r.role_id=u.role_id LEFT JOIN astronauts a ON a.user_id=u.user_id
        WHERE u.account_status='active' """,
    )


@router.post("/auth/demo-session")
async def session(request: Request, conn: sqlite3.Connection = Depends(get_db)):
    if not is_open_mode():
        raise NotFound("Demo sessions are disabled in token mode")
    try:
        body = await request.json()
    except ValueError as exc:
        raise ValidationFailed("Request must contain valid JSON") from exc
    if not isinstance(body, dict) or not isinstance(body.get("username"), str):
        raise ValidationFailed("username is required")
    u = auth_service.get_persona(conn, body["username"])
    return {
        "access_token": "mock-token." + u["user_id"],
        "token_type": "bearer",
        "user": public_user(conn, u),
    }


@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def dashboard(
    path: str,
    request: Request,
    user: dict = Depends(current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    from app.services import (
        console_health,
        console_cognition,
        console_planning,
        console_research,
    )

    q = dict(request.query_params)
    try:
        body = (
            await request.json()
            if request.method in ("POST", "PUT", "PATCH") and await request.body()
            else {}
        )
    except ValueError as exc:
        raise ValidationFailed("Request must contain valid JSON") from exc
    if not isinstance(body, dict):
        raise ValidationFailed("Request body must be an object")
    if path == "auth/me":
        return public_user(conn, user)
    if path == "auth/logout":
        return None
    if path == "missions/current/state":
        return mission_state(conn)
    for service in (
        console_health,
        console_cognition,
        console_planning,
        console_research,
    ):
        try:
            result = await run_in_threadpool(
                service.dispatch, conn, user, request.method, path, q, body
            )
        except ValidationError as exc:
            conn.rollback()
            raise RequestValidationError(exc.errors()) from exc
        except ValueError as exc:
            conn.rollback()
            raise ValidationFailed(str(exc)) from exc
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            raise ValidationFailed(
                "Record violates a required relationship or uniqueness constraint"
            ) from exc
        if result is not NotImplemented:
            return result
    raise NotFound(f"No integrated dashboard endpoint: {request.method} {path}")


from fastapi import WebSocket, WebSocketDisconnect


@router.websocket("/ws")
async def dashboard_updates(websocket: WebSocket):
    import asyncio
    from app.database.session import connect
    from app.core.errors import ServiceError

    conn = connect()
    try:
        token = websocket.query_params.get("token", "")
        if is_open_mode():
            if not token.startswith("mock-token."):
                await websocket.close(code=1008)
                return
            auth_service.get_persona(conn, token[len("mock-token.") :])
        else:
            auth_service.get_current_user(conn, token)
        await websocket.accept()
        while True:
            await websocket.send_json(
                {"type": "mission_state", "payload": mission_state(conn)}
            )
            await asyncio.sleep(5)
    except (WebSocketDisconnect, ServiceError):
        pass
    finally:
        conn.close()
