"""Offline sync (plan section 3, Phase 7): queue_sync_event, detect_sync_conflict,
resolve_sync_conflict, replay_pending_events.

How it works
------------
A crew device that loses its link keeps recording what happens: "I started task X at 09:12",
"I finished recovery Y". When the link returns it uploads those ACTIONS (not raw table writes).
Each action names the record and the record's VERSION as the device last saw it.

On replay, for each event in the order the device sent them:
  * version still matches  -> the action is replayed through the normal service
                              (task_execution_service / recovery_service), so every rule applies
                              exactly as if the astronaut had been online.
  * version has changed    -> if the server already shows exactly this result, it is a harmless
                              duplicate; otherwise NOTHING is written and a sync_conflicts row is
                              opened with both versions for a person to resolve.
  * the service refuses    -> 'rejected' with the reason (e.g. a dependency was not finished).
  * database busy          -> 'failed', retried on the next replay.
  * follows a conflict     -> 'blocked' until that conflict is resolved, then checked against the
                              record as it is at that moment.
Conflicts are never resolved by overwriting. Resolving either keeps the server's version, or
re-runs the device's action against the CURRENT record, with all rules checked again.

Versions: a record's version is a short SHA-256 of its sync-relevant fields (record_version).
Devices get versions from GET /sync/pull. Several offline actions on one record can be queued
without knowing the server's hashes: leave base_version empty on a later action and it is based
on the result of this device's previous event for that record.

Resending a batch is safe: (device_id, client_event_id) identifies an event, and a repeat
returns the outcome of the original instead of applying it again.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime
from typing import Any, Callable

from app.core import permissions
from app.core.errors import Conflict, NotFound, PermissionDenied, ServiceError, ValidationFailed
from app.services import auth_service, recovery_service, task_execution_service
from app.services.audit_service import write_audit
from app.utils.timestamps import parse_iso, to_iso, utcnow

MAX_BATCH = 200
MAX_ATTEMPTS = 5

PENDING, APPLIED, DUPLICATE, CONFLICT, REJECTED, FAILED, DISCARDED, BLOCKED = (
    "pending", "applied", "duplicate", "conflict", "rejected", "failed", "discarded", "blocked")
OPEN, KEPT_SERVER, APPLIED_AFTER_REVIEW = "open", "kept_server", "applied_after_review"


# --------------------------------------------------------------------------- what can be synced

def _task_effect_present(record: dict, action: str, at: str | None, payload: dict) -> bool:
    status = record["assignment_status"]
    if action == "start":
        return status in ("in_progress", "completed") and (at is None or record["actual_start"] == at)
    if action == "complete":
        return status == "completed" and (at is None or record["actual_end"] == at)
    return status == "skipped"


def _recovery_effect_present(record: dict, action: str, at: str | None, payload: dict) -> bool:
    if record["completion_status"] != action:
        return False
    return action == "skipped" or at is None or record["completed_at"] == at


def _apply_task(conn, entity_id, user, action, at, payload):
    if action == "start":
        return task_execution_service.start_assignment(conn, entity_id, user, at)
    if action == "complete":
        return task_execution_service.complete_assignment(conn, entity_id, user, at)
    return task_execution_service.skip_assignment(conn, entity_id, user, payload.get("reason", ""), at)


def _apply_recovery(conn, entity_id, user, action, at, payload):
    return recovery_service.record_recovery_outcome(conn, entity_id, user, action, payload.get("feedback", ""), at)


ENTITIES: dict[str, dict[str, Any]] = {
    "task_assignment": {
        "actions": ("start", "complete", "skip"),
        "load": task_execution_service.get_assignment,
        "fields": ("astronaut_id", "assignment_status", "approval_status", "planned_start", "planned_end",
                   "actual_start", "actual_end", "schedule_version_id", "version_status"),
        "effect_present": _task_effect_present,
        "apply": _apply_task,
    },
    "scheduled_recovery": {
        "actions": ("completed", "skipped"),
        "load": recovery_service.get_booking,
        "fields": ("astronaut_id", "completion_status", "completed_at", "astronaut_feedback",
                   "scheduled_start", "scheduled_end"),
        "effect_present": _recovery_effect_present,
        "apply": _apply_recovery,
    },
}


def _entity(entity_type: str) -> dict[str, Any]:
    if entity_type not in ENTITIES:
        raise ValidationFailed(f"entity_type must be one of {sorted(ENTITIES)}")
    return ENTITIES[entity_type]


def record_version(entity_type: str, record: dict[str, Any]) -> str:
    """Short fingerprint of the fields that matter for sync. Any change to them changes it."""
    fields = {f: record.get(f) for f in _entity(entity_type)["fields"]}
    return hashlib.sha256(json.dumps(fields, sort_keys=True, default=str).encode()).hexdigest()[:16]


def load_record(conn: sqlite3.Connection, entity_type: str, entity_id: str) -> dict[str, Any]:
    record = _entity(entity_type)["load"](conn, entity_id)
    return {**record, "sync_version": record_version(entity_type, record)}


def _user(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT u.*, r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id "
                       "WHERE u.user_id = ?", (user_id,)).fetchone()
    if row is None:
        raise NotFound(f"User {user_id} not found")
    return {k: row[k] for k in row.keys() if k != "password_hash"}


def _mission_of(conn: sqlite3.Connection, record: dict[str, Any]) -> str | None:
    row = conn.execute("SELECT mission_id FROM astronauts WHERE astronaut_id = ?",
                       (record.get("astronaut_id"),)).fetchone()
    return row[0] if row else None


# --------------------------------------------------------------------------- queue

def queue_sync_event(conn: sqlite3.Connection, *, device_id: str, user: dict[str, Any],
                     event: dict[str, Any]) -> dict[str, Any]:
    """Store one uploaded event as 'pending'. A repeat of a known (device, client_event_id) returns the original.

    Caller commits.
    """
    client_event_id = str(event.get("client_event_id") or "").strip()
    if not client_event_id or len(client_event_id) > 100:
        raise ValidationFailed("client_event_id is required (max 100 characters)")
    existing = conn.execute("SELECT sync_id FROM sync_event_details WHERE device_id = ? AND client_event_id = ?",
                            (device_id, client_event_id)).fetchone()
    if existing:
        return {**get_sync_event(conn, existing[0]), "resent": True}

    entity_type, entity_id, action = event.get("entity_type"), event.get("entity_id"), event.get("action")
    spec = _entity(entity_type)
    if action not in spec["actions"]:
        raise ValidationFailed(f"action for {entity_type} must be one of {list(spec['actions'])}")
    at = event.get("at")
    if at:
        try:
            at = to_iso(parse_iso(at))
        except ValueError as exc:
            raise ValidationFailed("at must be an ISO-8601 UTC time") from exc
    payload = {k: str(v)[:500] for k, v in (event.get("payload") or {}).items() if k in ("reason", "feedback")}
    try:
        mission_id = _mission_of(conn, spec["load"](conn, entity_id))
    except NotFound:
        mission_id = None  # replay will reject it with the reason

    sync_id = f"SYN-{uuid.uuid4().hex[:12].upper()}"
    sequence = conn.execute("SELECT COALESCE(MAX(sequence), 0) + 1 FROM sync_event_details").fetchone()[0]
    conn.execute(
        """INSERT INTO sync_events (sync_id, device_id, mission_id, entity_type, entity_id, sync_direction,
               sync_status, last_attempt_at, completed_at, error_message)
           VALUES (?, ?, ?, ?, ?, 'device_to_server', 'pending', NULL, NULL, NULL)""",
        (sync_id, device_id, mission_id, entity_type, entity_id))
    conn.execute(
        """INSERT INTO sync_event_details (sync_id, device_id, client_event_id, user_id, action, base_version,
               payload_json, client_recorded_at, received_at, sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (sync_id, device_id, client_event_id, user["user_id"], action, event.get("base_version") or None,
         json.dumps(payload), at, to_iso(utcnow()), sequence))
    return {**get_sync_event(conn, sync_id), "resent": False}


def get_sync_event(conn: sqlite3.Connection, sync_id: str) -> dict[str, Any]:
    row = conn.execute(
        """SELECT e.*, d.client_event_id, d.user_id, d.action, d.base_version, d.payload_json, d.client_recorded_at,
                  d.received_at, d.sequence, d.attempts, d.result_version,
                  (SELECT conflict_id FROM sync_conflicts c WHERE c.sync_id = e.sync_id) AS conflict_id
           FROM sync_events e JOIN sync_event_details d ON d.sync_id = e.sync_id WHERE e.sync_id = ?""",
        (sync_id,)).fetchone()
    if row is None:
        raise NotFound(f"Sync event {sync_id} not found")
    event = dict(row)
    event["payload"] = json.loads(event.pop("payload_json") or "{}")
    return event


# --------------------------------------------------------------------------- detect

def _effective_base(conn: sqlite3.Connection, event: dict[str, Any]) -> tuple[str | None, str | None, str]:
    """(base version, problem, status for the problem). An empty base means 'the result of my previous
    event on this record'. If that event is waiting for a person (conflict / blocked), this one waits too."""
    if event["base_version"]:
        return event["base_version"], None, ""
    previous = conn.execute(
        """SELECT d.result_version, e.sync_status, d.client_event_id FROM sync_event_details d
           JOIN sync_events e ON e.sync_id = d.sync_id
           WHERE d.device_id = ? AND e.entity_type = ? AND e.entity_id = ? AND d.sequence < ?
           ORDER BY d.sequence DESC LIMIT 1""",
        (event["device_id"], event["entity_type"], event["entity_id"], event["sequence"])).fetchone()
    if previous is None:
        return None, "base_version is required for the first event on a record", REJECTED
    if previous["sync_status"] in (CONFLICT, BLOCKED):
        return None, (f"Waits for event {previous['client_event_id']} ({previous['sync_status']}) to be resolved; "
                      "it will then be checked against the record as it is at that time"), BLOCKED
    # After a conflict is resolved, the previous event's result_version is the record as it stood then.
    if previous["sync_status"] in (APPLIED, DUPLICATE, DISCARDED) and previous["result_version"]:
        return previous["result_version"], None, ""
    return None, (f"It follows event {previous['client_event_id']}, which is '{previous['sync_status']}', "
                  "so it cannot be applied on its own"), REJECTED


def detect_sync_conflict(event: dict[str, Any], record: dict[str, Any], base_version: str) -> str:
    """'clean' (versions match), 'duplicate' (already reflected) or 'conflict' (record changed underneath)."""
    if record["sync_version"] == base_version:
        return "clean"
    effect = ENTITIES[event["entity_type"]]["effect_present"]
    if effect(record, event["action"], event["client_recorded_at"], event["payload"]):
        return "duplicate"
    return "conflict"


def _open_conflict(conn: sqlite3.Connection, event: dict[str, Any], record: dict[str, Any], base: str) -> str:
    conflict_id = f"SCF-{uuid.uuid4().hex[:12].upper()}"
    fields = ENTITIES[event["entity_type"]]["fields"]
    local = {"device_id": event["device_id"], "client_event_id": event["client_event_id"],
             "user_id": event["user_id"], "action": event["action"], "at": event["client_recorded_at"],
             "payload": event["payload"], "base_version": base}
    remote = {"version": record["sync_version"], "record": {f: record.get(f) for f in fields}}
    conn.execute(
        """INSERT INTO sync_conflicts (conflict_id, sync_id, entity_type, entity_id, local_version, remote_version,
               resolution_status, resolved_by_user_id, resolved_at, resolution_notes)
           VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL)""",
        (conflict_id, event["sync_id"], event["entity_type"], event["entity_id"], json.dumps(local),
         json.dumps(remote)))
    return conflict_id


# --------------------------------------------------------------------------- replay

def _set_status(conn: sqlite3.Connection, sync_id: str, status: str, error: str | None = None,
                result_version: str | None = None) -> None:
    now = to_iso(utcnow())
    done = now if status in (APPLIED, DUPLICATE, REJECTED, DISCARDED) else None
    conn.execute("UPDATE sync_events SET sync_status = ?, last_attempt_at = ?, completed_at = ?, error_message = ? "
                 "WHERE sync_id = ?", (status, now, done, error, sync_id))
    conn.execute("UPDATE sync_event_details SET attempts = attempts + 1, result_version = COALESCE(?, result_version) "
                 "WHERE sync_id = ?", (result_version, sync_id))


def _replay_one(conn: sqlite3.Connection, event: dict[str, Any]) -> dict[str, Any]:
    spec = ENTITIES[event["entity_type"]]
    try:
        record = load_record(conn, event["entity_type"], event["entity_id"])
    except NotFound as exc:
        _set_status(conn, event["sync_id"], REJECTED, exc.message)
        conn.commit()
        return {"status": REJECTED, "error": exc.message}
    base, problem, problem_status = _effective_base(conn, event)
    if problem:
        _set_status(conn, event["sync_id"], problem_status, problem)
        conn.commit()
        return {"status": problem_status, "error": problem}

    verdict = detect_sync_conflict(event, record, base)
    if verdict == "duplicate":
        _set_status(conn, event["sync_id"], DUPLICATE, "Already reflected on the server",
                    result_version=record["sync_version"])
        conn.commit()
        return {"status": DUPLICATE, "version": record["sync_version"]}
    if verdict == "conflict":
        conflict_id = _open_conflict(conn, event, record, base)
        _set_status(conn, event["sync_id"], CONFLICT, "Record changed since the device last saw it")
        write_audit(conn, user_id=event["user_id"], action_type="sync_conflict", entity_type=event["entity_type"],
                    entity_id=event["entity_id"], action_result="conflict",
                    change_summary=f"{conflict_id}: device {event['device_id']} wanted '{event['action']}'",
                    commit=False)
        conn.commit()
        return {"status": CONFLICT, "conflict_id": conflict_id}

    try:
        user = _user(conn, event["user_id"])
        if user["account_status"] != "active":
            raise PermissionDenied("The account that recorded this event is no longer active")
        at = parse_iso(event["client_recorded_at"]) if event["client_recorded_at"] else None
        spec["apply"](conn, event["entity_id"], user, event["action"], at, event["payload"])
    except ServiceError as exc:
        conn.rollback()
        _set_status(conn, event["sync_id"], REJECTED, exc.message)
        conn.commit()
        return {"status": REJECTED, "error": exc.message}
    except sqlite3.OperationalError as exc:  # e.g. database locked: try again next time
        conn.rollback()
        attempts = event["attempts"] + 1
        status = FAILED if attempts < MAX_ATTEMPTS else REJECTED
        _set_status(conn, event["sync_id"], status, f"database error: {exc}")
        conn.commit()
        return {"status": status, "error": str(exc)}
    version = load_record(conn, event["entity_type"], event["entity_id"])["sync_version"]
    _set_status(conn, event["sync_id"], APPLIED, result_version=version)
    conn.commit()
    return {"status": APPLIED, "version": version}


def replay_pending_events(conn: sqlite3.Connection, device_id: str | None = None, limit: int = 500) -> dict[str, Any]:
    """Process pending (and retryable failed) events, per device in the order they were recorded."""
    ids = [r[0] for r in conn.execute(
        """SELECT e.sync_id FROM sync_events e JOIN sync_event_details d ON d.sync_id = e.sync_id
           WHERE e.sync_status IN ('pending', 'failed') AND (? IS NULL OR d.device_id = ?)
           ORDER BY d.device_id, d.sequence LIMIT ?""", (device_id, device_id, limit))]
    results = []
    for sync_id in ids:
        event = get_sync_event(conn, sync_id)
        results.append({"sync_id": sync_id, "client_event_id": event["client_event_id"], **_replay_one(conn, event)})
    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"processed": len(results), "counts": counts, "results": results}


def upload_batch(conn: sqlite3.Connection, *, device_id: str, user: dict[str, Any],
                 events: list[dict[str, Any]]) -> dict[str, Any]:
    """Queue a device's offline events, then replay that device's queue. Returns one outcome per event."""
    device_id = (device_id or "").strip()
    if not device_id or len(device_id) > 100:
        raise ValidationFailed("device_id is required (max 100 characters)")
    if not 1 <= len(events) <= MAX_BATCH:
        raise ValidationFailed(f"Send between 1 and {MAX_BATCH} events")
    other = conn.execute("SELECT DISTINCT user_id FROM sync_event_details WHERE device_id = ? AND user_id != ?",
                         (device_id, user["user_id"])).fetchone()
    if other:
        raise PermissionDenied("This device ID is registered to another account")
    queued = []
    try:
        for e in events:
            queued.append(queue_sync_event(conn, device_id=device_id, user=user, event=e))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    replay_pending_events(conn, device_id)
    outcomes = []
    for q in queued:
        e = get_sync_event(conn, q["sync_id"])
        outcomes.append({"client_event_id": e["client_event_id"], "sync_id": e["sync_id"], "status": e["sync_status"],
                         "error": e["error_message"], "conflict_id": e["conflict_id"], "resent": q["resent"],
                         "version": e["result_version"]})
    return {"device_id": device_id, "outcomes": outcomes}


# --------------------------------------------------------------------------- resolve

def get_sync_conflict(conn: sqlite3.Connection, conflict_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM sync_conflicts WHERE conflict_id = ?", (conflict_id,)).fetchone()
    if row is None:
        raise NotFound(f"Sync conflict {conflict_id} not found")
    conflict = dict(row)
    conflict["local_version"] = json.loads(conflict["local_version"] or "{}")
    conflict["remote_version"] = json.loads(conflict["remote_version"] or "{}")
    try:
        conflict["current"] = load_record(conn, conflict["entity_type"], conflict["entity_id"])
    except NotFound:
        conflict["current"] = None
    return conflict


def list_sync_conflicts(conn: sqlite3.Connection, status: str | None = OPEN,
                        entity_type: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT c.conflict_id FROM sync_conflicts c LEFT JOIN sync_event_details d ON d.sync_id = c.sync_id
           WHERE (? IS NULL OR c.resolution_status = ?) AND (? IS NULL OR c.entity_type = ?)
           ORDER BY d.sequence""", (status, status, entity_type, entity_type)).fetchall()
    return [get_sync_conflict(conn, r[0]) for r in rows]


def resolve_sync_conflict(conn: sqlite3.Connection, conflict_id: str, user: dict[str, Any], resolution: str,
                          notes: str) -> dict[str, Any]:
    """'keep_server' discards the device's action; 'reapply' re-runs it on the CURRENT record with every
    rule checked again. Refuses if the record changed again since the conflict was opened."""
    auth_service.require_role(user, *permissions.SYNC_ADMIN_ROLES)
    if resolution not in ("keep_server", "reapply"):
        raise ValidationFailed("resolution must be 'keep_server' or 'reapply'")
    if not (notes or "").strip():
        raise ValidationFailed("Explain the decision in notes")
    conflict = get_sync_conflict(conn, conflict_id)
    if conflict["resolution_status"] != OPEN:
        raise Conflict(f"Conflict is already {conflict['resolution_status']}")
    current = conflict["current"]
    seen = conflict["remote_version"].get("version")
    if current is not None and current["sync_version"] != seen:
        fields = ENTITIES[conflict["entity_type"]]["fields"]
        conn.execute("UPDATE sync_conflicts SET remote_version = ? WHERE conflict_id = ?",
                     (json.dumps({"version": current["sync_version"], "record": {f: current.get(f) for f in fields}}),
                      conflict_id))
        conn.commit()
        raise Conflict("The record changed again after this conflict was opened. The conflict now shows the "
                       "latest version; review it and resolve again.")

    local, now = conflict["local_version"], to_iso(utcnow())
    if resolution == "reapply":
        at = parse_iso(local["at"]) if local.get("at") else None
        try:
            ENTITIES[conflict["entity_type"]]["apply"](conn, conflict["entity_id"], user, local["action"], at,
                                                        local.get("payload") or {})
        except ServiceError as exc:
            conn.rollback()
            raise Conflict(f"Re-applying was refused by the normal rules: {exc.message}", exc.details) from exc
        status, event_status = APPLIED_AFTER_REVIEW, APPLIED
    else:
        status, event_status = KEPT_SERVER, DISCARDED
    conn.execute("""UPDATE sync_conflicts SET resolution_status = ?, resolved_by_user_id = ?, resolved_at = ?,
                    resolution_notes = ? WHERE conflict_id = ?""",
                 (status, user["user_id"], now, notes.strip()[:500], conflict_id))
    version = load_record(conn, conflict["entity_type"], conflict["entity_id"])["sync_version"] if current else None
    _set_status(conn, conflict["sync_id"], event_status,
                None if event_status == APPLIED else "Discarded after review", result_version=version)
    write_audit(conn, user_id=user["user_id"], action_type="resolve_sync_conflict", entity_type=conflict["entity_type"],
                entity_id=conflict["entity_id"], action_result=status,
                change_summary=f"{conflict_id}: {notes.strip()[:200]}", commit=False)
    # Events from the same device that were waiting on this one go back in the queue and are
    # checked against the record as it is now.
    event = get_sync_event(conn, conflict["sync_id"])
    waiting = conn.execute(
        """UPDATE sync_events SET sync_status = 'pending', error_message = NULL WHERE sync_id IN (
               SELECT e.sync_id FROM sync_events e JOIN sync_event_details d ON d.sync_id = e.sync_id
               WHERE d.device_id = ? AND e.entity_type = ? AND e.entity_id = ? AND d.sequence > ?
                 AND e.sync_status = 'blocked')""",
        (event["device_id"], event["entity_type"], event["entity_id"], event["sequence"])).rowcount
    conn.commit()
    resolved = get_sync_conflict(conn, conflict_id)
    resolved["released_events"] = waiting
    resolved["replay"] = replay_pending_events(conn, event["device_id"]) if waiting else None
    return resolved


# --------------------------------------------------------------------------- status and pull

def get_sync_status(conn: sqlite3.Connection) -> dict[str, Any]:
    counts = {r[0]: r[1] for r in conn.execute("SELECT sync_status, COUNT(*) FROM sync_events GROUP BY sync_status")}
    conflicts = {r[0]: r[1] for r in conn.execute(
        "SELECT resolution_status, COUNT(*) FROM sync_conflicts GROUP BY resolution_status")}
    devices = [dict(r) for r in conn.execute(
        """SELECT d.device_id, d.user_id, COUNT(*) AS events, MAX(d.received_at) AS last_received_at,
                  SUM(e.sync_status IN ('pending', 'failed')) AS waiting,
                  SUM(e.sync_status = 'conflict') AS in_conflict,
                  SUM(e.sync_status = 'rejected') AS rejected,
                  MAX(CASE WHEN e.sync_status IN ('applied', 'duplicate') THEN e.completed_at END) AS last_applied_at
           FROM sync_event_details d JOIN sync_events e ON e.sync_id = d.sync_id
           GROUP BY d.device_id ORDER BY d.device_id""")]
    oldest = conn.execute(
        """SELECT MIN(d.received_at) FROM sync_events e JOIN sync_event_details d ON d.sync_id = e.sync_id
           WHERE e.sync_status IN ('pending', 'failed')""").fetchone()[0]
    return {"events_by_status": counts, "open_conflicts": conflicts.get(OPEN, 0), "conflicts_by_status": conflicts,
            "oldest_waiting_received_at": oldest, "devices": devices}


def list_sync_events(conn: sqlite3.Connection, *, device_id: str | None = None, status: str | None = None,
                     user_id: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT e.sync_id FROM sync_events e JOIN sync_event_details d ON d.sync_id = e.sync_id
           WHERE (? IS NULL OR d.device_id = ?) AND (? IS NULL OR e.sync_status = ?) AND (? IS NULL OR d.user_id = ?)
           ORDER BY d.sequence DESC LIMIT ?""",
        (device_id, device_id, status, status, user_id, user_id, max(1, min(limit, 1000)))).fetchall()
    return [get_sync_event(conn, r[0]) for r in rows]


def pull_records(conn: sqlite3.Connection, astronaut_id: str, *, simulation_run_id: str,
                 date: str | None = None) -> dict[str, Any]:
    """What a device should cache before going offline: its tasks and recovery bookings, with versions."""
    tasks = task_execution_service.list_assignments(conn, [astronaut_id], simulation_run_id=simulation_run_id,
                                                    date=date)
    bookings = recovery_service.list_bookings(conn, [astronaut_id], date=date, simulation_run_id=simulation_run_id)
    return {
        "astronaut_id": astronaut_id, "simulation_run_id": simulation_run_id, "date": date,
        "pulled_at": to_iso(utcnow()),
        "task_assignment": [{**t, "sync_version": record_version("task_assignment", t)} for t in tasks],
        "scheduled_recovery": [{**b, "sync_version": record_version("scheduled_recovery", b)} for b in bookings],
    }
