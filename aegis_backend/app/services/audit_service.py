"""Writes to audit_logs: who did what, to which record, and whether it was allowed."""
from __future__ import annotations

import sqlite3
import uuid

from app.utils.timestamps import to_iso, utcnow


def write_audit(
    conn: sqlite3.Connection,
    *,
    user_id: str | None,
    action_type: str,
    entity_type: str,
    entity_id: str | None,
    action_result: str,
    change_summary: str = "",
    commit: bool = True,
) -> str:
    """Append one audit row. action_result is e.g. 'success', 'denied', 'failed'."""
    audit_id = f"AUD-{uuid.uuid4().hex[:16].upper()}"
    conn.execute(
        """INSERT INTO audit_logs (audit_id, user_id, action_type, entity_type, entity_id,
                                   action_timestamp, action_result, change_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (audit_id, user_id, action_type, entity_type, entity_id, to_iso(utcnow()), action_result, change_summary),
    )
    if commit:
        conn.commit()
    return audit_id


def list_audit_logs(
    conn: sqlite3.Connection, *, user_id: str | None = None, entity_type: str | None = None, limit: int = 100
) -> list[dict]:
    clauses, params = [], []
    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    if entity_type:
        clauses.append("entity_type = ?")
        params.append(entity_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 1000)))
    rows = conn.execute(
        f"SELECT * FROM audit_logs {where} ORDER BY action_timestamp DESC, rowid DESC LIMIT ?", params
    ).fetchall()
    return [dict(r) for r in rows]
