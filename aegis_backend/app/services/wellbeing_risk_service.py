"""Break-glass risk flags for the Reflective Coach (chat and journal).

What an astronaut writes is private. The medical officer is told about it in exactly two cases, and
even then is told the INDICATOR (for example "hopelessness"), never the words:

* immediate:  the writing itself points to immediate danger (thoughts of self-harm, a risk to
              someone's safety, or an urgent physical symptom);
* persistent: the same crisis marker shows up in at least 3 of that astronaut's last 5 writings.

The astronaut is told this up front (PRIVACY_NOTE goes out with every reply) and can see their own
flags, so nothing is disclosed behind their back.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from app.core import permissions
from app.core.errors import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services import auth_service, coach_service
from app.services.audit_service import write_audit
from app.utils.timestamps import to_iso, utcnow

IMMEDIATE_MARKERS = frozenset({"self_harm", "safety_risk"})
URGENT_PHYSICAL = "urgent_physical_symptom"
WINDOW, THRESHOLD = 5, 3  # the same marker in THRESHOLD of the last WINDOW writings

PRIVACY_NOTE = ("What you write here is private: the medical officer cannot read it unless you choose to share "
                "it. One exception protects you: if your writing points to immediate danger, or the same serious "
                "sign keeps coming back, the medical officer is told which sign it was, not your words.")

_MEANINGS = {**coach_service.CRISIS_MARKERS, URGENT_PHYSICAL: "an urgent physical symptom"}


def _recent_markers(conn: sqlite3.Connection, astronaut_id: str) -> list[set[str]]:
    """Crisis markers in the astronaut's last WINDOW writings (chat messages and journal entries), newest
    first. Synthetic demo journal entries are fiction and are never counted."""
    rows = conn.execute(
        """SELECT analysis_json, created_at, seq FROM (
               SELECT m.analysis_json, m.created_at, m.rowid AS seq FROM wellbeing_messages m
               JOIN wellbeing_conversations c ON c.conversation_id = m.conversation_id
               WHERE c.astronaut_id = :a AND m.sender = 'astronaut'
               UNION ALL
               SELECT j.analysis_json, j.created_at, j.rowid AS seq FROM journal_entries j
               WHERE j.astronaut_id = :a AND j.origin = 'astronaut')
           ORDER BY created_at DESC, seq DESC LIMIT :n""", {"a": astronaut_id, "n": WINDOW}).fetchall()
    out = []
    for r in rows:
        analysis = json.loads(r["analysis_json"]) if r["analysis_json"] else {}
        out.append(set(coach_service.labels(analysis, "crisis_markers")))
    return out


def _create(conn: sqlite3.Connection, astronaut_id: str, level: str, indicators: list[dict[str, Any]], source: str,
            mission_time: str | None) -> str:
    flag_id = f"RSK-{uuid.uuid4().hex[:12].upper()}"
    conn.execute(
        """INSERT INTO wellbeing_risk_flags (flag_id, astronaut_id, created_at, mission_time, level, indicators_json,
               source) VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (flag_id, astronaut_id, to_iso(utcnow()), mission_time, level, json.dumps(indicators), source))
    write_audit(conn, user_id=None, action_type="wellbeing_risk_flag", entity_type="wellbeing_risk_flag",
                entity_id=flag_id, action_result="flagged",
                change_summary=f"{level}: {', '.join(i['marker'] for i in indicators)} for {astronaut_id} ({source}); "
                               "indicators only, no text", commit=False)
    return flag_id


def evaluate(conn: sqlite3.Connection, astronaut_id: str, analysis: dict[str, Any], *, source: str,
             mission_time: str | None, urgent_physical: bool = False) -> dict[str, Any]:
    """Apply the break-glass checks to a writing that has ALREADY been stored with its analysis.

    Returns {"level": "immediate" | "persistent" | None, "flag_ids": [...]}. Caller commits.
    """
    markers = set(coach_service.labels(analysis, "crisis_markers"))
    flag_ids: list[str] = []
    immediate = sorted(markers & IMMEDIATE_MARKERS) + ([URGENT_PHYSICAL] if urgent_physical else [])
    if immediate:
        flag_ids.append(_create(conn, astronaut_id, "immediate",
                                [{"marker": m, "meaning": _MEANINGS[m]} for m in immediate], source, mission_time))
    history = _recent_markers(conn, astronaut_id)
    for marker in sorted(markers):
        count = sum(marker in writing for writing in history)
        if count < THRESHOLD:
            continue
        already_open = any(marker in {i["marker"] for i in json.loads(r["indicators_json"])} for r in conn.execute(
            "SELECT indicators_json FROM wellbeing_risk_flags WHERE astronaut_id = ? AND level = 'persistent' "
            "AND acknowledged_at IS NULL", (astronaut_id,)))
        if not already_open:
            flag_ids.append(_create(conn, astronaut_id, "persistent", [
                {"marker": marker, "meaning": _MEANINGS[marker], "count": count, "of_last": len(history)}],
                source, mission_time))
    level = "immediate" if immediate else "persistent" if flag_ids else None
    return {"level": level, "flag_ids": flag_ids}


def _flag(row: sqlite3.Row) -> dict[str, Any]:
    flag = dict(row)
    flag["indicators"] = json.loads(flag.pop("indicators_json"))
    flag["open"] = flag["acknowledged_at"] is None
    return flag


def list_flags(conn: sqlite3.Connection, user: dict[str, Any], *, astronaut_id: str | None = None,
               open_only: bool = False) -> dict[str, Any]:
    """The medical officer sees everyone's flags; an astronaut sees their own, so they know what was shared."""
    if user.get("role_name") in permissions.WELLBEING_REVIEW_ROLES:
        target = astronaut_id
    else:
        auth_service.require_role(user, *permissions.WELLBEING_CHAT_ROLES)
        mine = auth_service.get_permitted_astronauts(conn, user)
        if not mine or (astronaut_id and astronaut_id not in mine):
            raise PermissionDenied("You can only see your own flags")
        target = mine[0]
    rows = conn.execute(
        """SELECT * FROM wellbeing_risk_flags WHERE (:a IS NULL OR astronaut_id = :a)
              AND (:open = 0 OR acknowledged_at IS NULL)
           ORDER BY (acknowledged_at IS NULL) DESC, (level = 'immediate') DESC, created_at DESC, rowid DESC""",
        {"a": target, "open": int(open_only)}).fetchall()
    flags = [_flag(r) for r in rows]
    return {"open_count": sum(f["open"] for f in flags), "flags": flags,
            "note": "Flags carry the indicator only. The writing itself stays private unless the astronaut shares it."}


def acknowledge(conn: sqlite3.Connection, user: dict[str, Any], flag_id: str, note: str) -> dict[str, Any]:
    """The medical officer records the follow-up on a flag."""
    auth_service.require_role(user, *permissions.WELLBEING_REVIEW_ROLES)
    if not (note or "").strip():
        raise ValidationFailed("Write a short note on the follow-up")
    row = conn.execute("SELECT * FROM wellbeing_risk_flags WHERE flag_id = ?", (flag_id,)).fetchone()
    if row is None:
        raise NotFound(f"Risk flag {flag_id} not found")
    if row["acknowledged_at"]:
        raise Conflict("This flag has already been acknowledged")
    conn.execute("UPDATE wellbeing_risk_flags SET acknowledged_by_user_id = ?, acknowledged_at = ?, "
                 "acknowledgement_note = ? WHERE flag_id = ?",
                 (user["user_id"], to_iso(utcnow()), note.strip()[:500], flag_id))
    write_audit(conn, user_id=user["user_id"], action_type="acknowledge_risk_flag",
                entity_type="wellbeing_risk_flag", entity_id=flag_id, action_result="success",
                change_summary=note.strip()[:200], commit=False)
    conn.commit()
    return _flag(conn.execute("SELECT * FROM wellbeing_risk_flags WHERE flag_id = ?", (flag_id,)).fetchone())
