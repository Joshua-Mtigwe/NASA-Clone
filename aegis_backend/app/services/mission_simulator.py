"""Mission clock and events (plan section 3, Phase 1).

A simulation run is an isolated copy of the mission timeline: its own clock, speed, status and
scenario events. Every function takes a simulation_run_id and only ever changes that run, so
two runs never affect each other ("independent run state").

Clock model
-----------
simulation_runs.current_mission_time holds the mission time at the moment the run was last
paused or changed. While a run is 'running', simulation_run_clock.anchor_wall_utc holds the
real time it was (re)started, and

    mission time now = current_mission_time + (wall time now - anchor) x speed_multiplier

Pausing, changing speed or jumping folds the elapsed time into current_mission_time first.
All functions accept `now` so tests can control wall time.
"""
from __future__ import annotations

import asyncio
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta
from typing import Any

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.services.audit_service import write_audit
from app.utils.timestamps import parse_iso, to_iso, utcnow

MIN_SPEED = 1
MAX_SPEED = 86_400  # one real second = one mission day

RUNNING, PAUSED, COMPLETED = "running", "paused", "completed"


# --------------------------------------------------------------------------- reading state

def _run_row(conn: sqlite3.Connection, run_id: str) -> sqlite3.Row:
    row = conn.execute(
        """SELECT r.*, m.launch_date, m.planned_end_date, c.anchor_wall_utc
           FROM simulation_runs r
           JOIN missions m ON m.mission_id = r.mission_id
           LEFT JOIN simulation_run_clock c ON c.simulation_run_id = r.simulation_run_id
           WHERE r.simulation_run_id = ?""",
        (run_id,),
    ).fetchone()
    if row is None:
        raise NotFound(f"Simulation run {run_id} not found")
    return row


def _mission_day(launch: datetime, at: datetime) -> int:
    """Day 1 is launch day. Days before launch are 0 or negative."""
    return (at - launch).days + 1


def _state_from_row(row: sqlite3.Row, now: datetime) -> dict[str, Any]:
    launch = parse_iso(row["launch_date"])
    end = parse_iso(row["planned_end_date"])
    current = parse_iso(row["current_mission_time"])
    status = row["status"]
    if status == RUNNING and row["anchor_wall_utc"]:
        elapsed = (now - parse_iso(row["anchor_wall_utc"])).total_seconds()
        current += timedelta(seconds=max(0.0, elapsed) * float(row["speed_multiplier"]))
    if current >= end:
        current, status = end, COMPLETED
    return {
        "simulation_run_id": row["simulation_run_id"],
        "mission_id": row["mission_id"],
        "run_name": row["run_name"],
        "status": status,
        "speed_multiplier": row["speed_multiplier"],
        "start_mission_time": row["start_mission_time"],
        "current_mission_time": to_iso(current),
        "mission_day": _mission_day(launch, current),
        "mission_total_days": (end - launch).days,
        "mission_launch": to_iso(launch),
        "mission_end": to_iso(end),
        "data_mode": row["data_mode"],
        "created_at": row["created_at"],
    }


def get_simulation_state(conn: sqlite3.Connection, run_id: str, now: datetime | None = None) -> dict[str, Any]:
    """Current clock for one run (read-only)."""
    return _state_from_row(_run_row(conn, run_id), now or utcnow())


def list_simulation_runs(
    conn: sqlite3.Connection, mission_id: str | None = None, now: datetime | None = None
) -> list[dict[str, Any]]:
    params: tuple = ()
    where = ""
    if mission_id:
        where, params = "WHERE r.mission_id = ?", (mission_id,)
    rows = conn.execute(
        f"""SELECT r.*, m.launch_date, m.planned_end_date, c.anchor_wall_utc
            FROM simulation_runs r
            JOIN missions m ON m.mission_id = r.mission_id
            LEFT JOIN simulation_run_clock c ON c.simulation_run_id = r.simulation_run_id
            {where} ORDER BY r.created_at, r.simulation_run_id""",
        params,
    ).fetchall()
    now = now or utcnow()
    return [_state_from_row(r, now) for r in rows]


# --------------------------------------------------------------------------- changing state

def _persist(conn: sqlite3.Connection, run_id: str, *, current: str, status: str,
             speed: int | None = None, anchor: datetime | None = None) -> None:
    """Write the folded clock for one run. anchor=None clears the running anchor."""
    if speed is None:
        conn.execute("UPDATE simulation_runs SET current_mission_time = ?, status = ? WHERE simulation_run_id = ?",
                     (current, status, run_id))
    else:
        conn.execute("""UPDATE simulation_runs SET current_mission_time = ?, status = ?, speed_multiplier = ?
                        WHERE simulation_run_id = ?""", (current, status, speed, run_id))
    conn.execute("DELETE FROM simulation_run_clock WHERE simulation_run_id = ?", (run_id,))
    if anchor is not None:
        conn.execute("INSERT INTO simulation_run_clock (simulation_run_id, anchor_wall_utc) VALUES (?, ?)",
                     (run_id, to_iso_precise(anchor)))


def to_iso_precise(dt: datetime) -> str:
    """Anchor keeps microseconds: at 60x speed, a lost second is a lost mission minute."""
    return dt.isoformat().replace("+00:00", "Z")


def _audit(conn: sqlite3.Connection, actor_user_id: str | None, action: str, run_id: str, summary: str) -> None:
    write_audit(conn, user_id=actor_user_id, action_type=action, entity_type="simulation_run",
                entity_id=run_id, action_result="success", change_summary=summary, commit=False)


def create_simulation_run(
    conn: sqlite3.Connection,
    *,
    mission_id: str,
    run_name: str,
    actor_user_id: str | None,
    speed_multiplier: int = 60,
    start_mission_day: int = 1,
    copy_events_from: str | None = "RUN-DEMO-001",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Create a new paused run. Scenario events are copied from a template run so this run
    gets its own event rows; reference events (no run ID) are shared and never copied."""
    now = now or utcnow()
    mission = conn.execute("SELECT launch_date, planned_end_date FROM missions WHERE mission_id = ?",
                           (mission_id,)).fetchone()
    if mission is None:
        raise NotFound(f"Mission {mission_id} not found")
    _check_speed(speed_multiplier)
    launch, end = parse_iso(mission["launch_date"]), parse_iso(mission["planned_end_date"])
    total_days = (end - launch).days
    if not 1 <= start_mission_day <= total_days:
        raise ValidationFailed(f"start_mission_day must be between 1 and {total_days}")
    if not run_name.strip():
        raise ValidationFailed("run_name is required")

    template_events: list[sqlite3.Row] = []
    if copy_events_from:
        template = conn.execute("SELECT mission_id FROM simulation_runs WHERE simulation_run_id = ?",
                                (copy_events_from,)).fetchone()
        if template is None:
            raise NotFound(f"Template run {copy_events_from} not found")
        if template["mission_id"] != mission_id:
            raise ValidationFailed("Template run belongs to a different mission")
        template_events = conn.execute("SELECT * FROM simulation_events WHERE simulation_run_id = ?",
                                       (copy_events_from,)).fetchall()

    run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"
    start_time = to_iso(launch + timedelta(days=start_mission_day - 1))
    try:
        conn.execute(
            """INSERT INTO simulation_runs (simulation_run_id, mission_id, run_name, start_mission_time,
                   current_mission_time, speed_multiplier, status, created_at, data_mode)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synthetic_demo')""",
            (run_id, mission_id, run_name.strip(), start_time, start_time, speed_multiplier, PAUSED, to_iso(now)),
        )
        for ev in template_events:
            data = dict(ev)
            data["event_id"] = f"{run_id}-{ev['event_id']}"
            data["simulation_run_id"] = run_id
            cols = ", ".join(data)
            conn.execute(f"INSERT INTO simulation_events ({cols}) VALUES ({', '.join('?' for _ in data)})",
                         list(data.values()))
        _audit(conn, actor_user_id, "create_simulation_run", run_id,
               f"mission={mission_id}; events copied from {copy_events_from}: {len(template_events)}")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return get_simulation_state(conn, run_id, now)


def start_simulation(conn: sqlite3.Connection, run_id: str, *, actor_user_id: str | None,
                     now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    state = get_simulation_state(conn, run_id, now)
    if state["status"] == COMPLETED:
        raise Conflict("Run has reached the end of the mission; jump to an earlier day first")
    if state["status"] == RUNNING:
        return state
    _persist(conn, run_id, current=state["current_mission_time"], status=RUNNING, anchor=now)
    _audit(conn, actor_user_id, "start_simulation", run_id, f"at {state['current_mission_time']}")
    conn.commit()
    return get_simulation_state(conn, run_id, now)


def pause_simulation(conn: sqlite3.Connection, run_id: str, *, actor_user_id: str | None,
                     now: datetime | None = None) -> dict[str, Any]:
    now = now or utcnow()
    state = get_simulation_state(conn, run_id, now)
    status = COMPLETED if state["status"] == COMPLETED else PAUSED
    _persist(conn, run_id, current=state["current_mission_time"], status=status)
    _audit(conn, actor_user_id, "pause_simulation", run_id, f"at {state['current_mission_time']}")
    conn.commit()
    return get_simulation_state(conn, run_id, now)


def _check_speed(speed: int) -> None:
    if not isinstance(speed, int) or isinstance(speed, bool) or not MIN_SPEED <= speed <= MAX_SPEED:
        raise ValidationFailed(f"speed_multiplier must be a whole number from {MIN_SPEED} to {MAX_SPEED}")


def set_simulation_speed(conn: sqlite3.Connection, run_id: str, speed_multiplier: int, *,
                         actor_user_id: str | None, now: datetime | None = None) -> dict[str, Any]:
    _check_speed(speed_multiplier)
    now = now or utcnow()
    state = get_simulation_state(conn, run_id, now)
    running = state["status"] == RUNNING
    _persist(conn, run_id, current=state["current_mission_time"], status=state["status"],
             speed=speed_multiplier, anchor=now if running else None)
    _audit(conn, actor_user_id, "set_simulation_speed", run_id,
           f"{state['speed_multiplier']} -> {speed_multiplier}")
    conn.commit()
    return get_simulation_state(conn, run_id, now)


def jump_to_mission_day(conn: sqlite3.Connection, run_id: str, mission_day: int, *,
                        actor_user_id: str | None, now: datetime | None = None) -> dict[str, Any]:
    """Move the clock to 00:00 UTC of the given mission day (1 = launch day)."""
    now = now or utcnow()
    state = get_simulation_state(conn, run_id, now)
    if not 1 <= mission_day <= state["mission_total_days"]:
        raise ValidationFailed(f"mission_day must be between 1 and {state['mission_total_days']}")
    target = to_iso(parse_iso(state["mission_launch"]) + timedelta(days=mission_day - 1))
    running = state["status"] == RUNNING
    status = RUNNING if running else PAUSED  # jumping back out of 'completed' leaves the run paused
    _persist(conn, run_id, current=target, status=status, anchor=now if running else None)
    _audit(conn, actor_user_id, "jump_to_mission_day", run_id,
           f"day {state['mission_day']} -> {mission_day}")
    conn.commit()
    return get_simulation_state(conn, run_id, now)


# --------------------------------------------------------------------------- events

def get_simulation_events(
    conn: sqlite3.Connection,
    run_id: str,
    *,
    up_to_current: bool = False,
    include_reference: bool = False,
    from_day: int | None = None,
    to_day: int | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Scenario events for one run, oldest first.

    up_to_current: only events at or before the run's current mission time.
    include_reference: also return shared reference records with no run (e.g. NASA DONKI 2024),
    which are context only and have no mission day.
    """
    state = get_simulation_state(conn, run_id, now)
    clauses, params = ["simulation_run_id = ?"], [run_id]
    if up_to_current:
        clauses.append("event_timestamp <= ?")
        params.append(state["current_mission_time"])
    if from_day is not None:
        clauses.append("mission_day >= ?")
        params.append(from_day)
    if to_day is not None:
        clauses.append("mission_day <= ?")
        params.append(to_day)
    sql = f"SELECT * FROM simulation_events WHERE ({' AND '.join(clauses)})"
    if include_reference:
        sql += " OR simulation_run_id IS NULL"
    rows = conn.execute(sql + " ORDER BY event_timestamp, event_id", params).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------------------- live updates

class SimulationBroadcaster:
    """In-process publish/subscribe for live clock updates (used by the WebSocket route).

    publish() is safe to call from any thread, including FastAPI's sync-route thread pool.
    Single-process only; with several server workers you would need Redis or similar.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}

    def subscribe(self, run_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        with self._lock:
            self._subscribers.setdefault(run_id, set()).add((asyncio.get_running_loop(), queue))
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        with self._lock:
            subs = self._subscribers.get(run_id, set())
            for item in [s for s in subs if s[1] is queue]:
                subs.discard(item)

    def publish(self, run_id: str, message: dict[str, Any]) -> int:
        with self._lock:
            targets = list(self._subscribers.get(run_id, ()))
        for loop, queue in targets:
            loop.call_soon_threadsafe(_offer, queue, message)
        return len(targets)


def _offer(queue: asyncio.Queue, message: dict[str, Any]) -> None:
    if queue.full():  # slow client: drop the oldest update rather than block
        queue.get_nowait()
    queue.put_nowait(message)


broadcaster = SimulationBroadcaster()


def broadcast_simulation_update(run_id: str, state: dict[str, Any], event: str = "state") -> int:
    """Send a run's new state to every live subscriber of that run. Returns subscriber count."""
    return broadcaster.publish(run_id, {"event": event, "simulation_run_id": run_id, "state": state})
