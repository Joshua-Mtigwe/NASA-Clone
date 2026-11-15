"""Live simulation clock over WebSocket.

Open demo mode (default):  ws://host/api/v1/ws/simulation/{run_id}            (optionally ?as_user=crew1)
Token mode:               ws://host/api/v1/ws/simulation/{run_id}?token=<access_token>
(browsers cannot set headers on WebSockets, so the persona or token goes in the query).
You receive the current state at once, an update after every start/pause/speed/jump,
and a 'tick' every few seconds while the run is running.
"""
import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core.config import is_open_mode
from app.core.errors import ServiceError
from app.database.session import connect
from app.services import auth_service
from app.services import mission_simulator as sim

router = APIRouter(tags=["websocket"])
TICK_SECONDS = 5.0


def _read_state(run_id: str) -> dict:
    conn = connect()
    try:
        return sim.get_simulation_state(conn, run_id)
    finally:
        conn.close()


@router.websocket("/ws/simulation/{run_id}")
async def simulation_updates(websocket: WebSocket, run_id: str, token: str | None = None,
                             as_user: str | None = None):
    conn = connect()
    try:
        if is_open_mode():  # open demo mode: optional ?as_user=<persona>, no token
            auth_service.get_persona(conn, as_user)
        else:
            auth_service.get_current_user(conn, token)
        state = sim.get_simulation_state(conn, run_id)
    except ServiceError as exc:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason=exc.message[:120])
        return
    finally:
        conn.close()

    await websocket.accept()
    queue = sim.broadcaster.subscribe(run_id)
    try:
        await websocket.send_json({"event": "state", "simulation_run_id": run_id, "state": state})
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=TICK_SECONDS)
            except asyncio.TimeoutError:
                state = await asyncio.to_thread(_read_state, run_id)
                if state["status"] != sim.RUNNING:
                    continue
                message = {"event": "tick", "simulation_run_id": run_id, "state": state}
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        sim.broadcaster.unsubscribe(run_id, queue)
