"""Authentication and authorization (plan section 3, Phase 1).

Two modes (AEGIS_AUTH_MODE):
* 'open' (default, for the open-source hackathon submission): no logins, passwords or tokens.
  Each request names a demo persona (get_persona); every role rule still applies to it.
* 'token': the original sign-in described below.

Token mode:
* The seed users carry the placeholder password_hash DEMO_ACCOUNT_NO_PASSWORD. Those accounts
  cannot log in until scripts/set_demo_passwords.py gives them real hashed passwords.
* Login returns an opaque bearer token; only its SHA-256 is stored (auth_sessions), so a
  token can be revoked at any time.
* Every login attempt, success or failure, goes to audit_logs.
"""
from __future__ import annotations

import sqlite3
import uuid
from datetime import timedelta
from typing import Any

from app.core import permissions
from app.core.config import get_settings
from app.core.errors import AuthenticationFailed, NotFound, PermissionDenied
from app.core.security import hash_password, hash_token, new_token, verify_password
from app.services.audit_service import write_audit
from app.utils.timestamps import parse_iso, to_iso, utcnow

USER_COLUMNS = """u.user_id, u.username, u.email, u.role_id, r.role_name, u.account_status,
                  u.created_at, u.last_login_at"""

# Same message for unknown user, wrong password and disabled account: don't reveal which.
LOGIN_FAILED = "Invalid username or password"


def _user_by(conn: sqlite3.Connection, column: str, value: str) -> sqlite3.Row | None:
    return conn.execute(
        f"""SELECT {USER_COLUMNS}, u.password_hash
            FROM users u JOIN roles r ON r.role_id = u.role_id
            WHERE u.{column} = ?""",
        (value,),
    ).fetchone()


def _public(row: sqlite3.Row) -> dict[str, Any]:
    user = {k: row[k] for k in row.keys() if k != "password_hash"}
    return user


def record_login_event(conn: sqlite3.Connection, user_id: str | None, result: str, detail: str = "") -> None:
    """Audit a login attempt; on success also stamp users.last_login_at."""
    if result == "success" and user_id:
        conn.execute("UPDATE users SET last_login_at = ? WHERE user_id = ?", (to_iso(utcnow()), user_id))
    write_audit(conn, user_id=user_id, action_type="login", entity_type="user", entity_id=user_id,
                action_result=result, change_summary=detail)


def authenticate_user(conn: sqlite3.Connection, username: str, password: str) -> dict[str, Any]:
    """Check credentials and open a session. Returns {access_token, token_type, expires_at, user}."""
    row = _user_by(conn, "username", username)
    if row is None:
        record_login_event(conn, None, "denied", f"unknown username {username[:64]!r}")
        raise AuthenticationFailed(LOGIN_FAILED)
    if row["account_status"] != "active":
        record_login_event(conn, row["user_id"], "denied", f"account_status={row['account_status']}")
        raise AuthenticationFailed(LOGIN_FAILED)
    if not verify_password(password, row["password_hash"]):
        # Also covers the seed placeholder DEMO_ACCOUNT_NO_PASSWORD, which never verifies.
        record_login_event(conn, row["user_id"], "denied", "bad password or no password set")
        raise AuthenticationFailed(LOGIN_FAILED)

    token = new_token()
    now = utcnow()
    expires = now + timedelta(hours=get_settings().token_ttl_hours)
    conn.execute(
        """INSERT INTO auth_sessions (session_id, user_id, token_hash, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)""",
        (f"AUTH-{uuid.uuid4().hex[:16].upper()}", row["user_id"], hash_token(token), to_iso(now), to_iso(expires)),
    )
    record_login_event(conn, row["user_id"], "success")
    return {"access_token": token, "token_type": "bearer", "expires_at": to_iso(expires),
            "user": _public(_user_by(conn, "user_id", row["user_id"]))}


def get_current_user(conn: sqlite3.Connection, token: str | None) -> dict[str, Any]:
    """Resolve a bearer token to an active user, or raise AuthenticationFailed."""
    if not token:
        raise AuthenticationFailed("Not signed in")
    session = conn.execute(
        "SELECT user_id, expires_at, revoked_at FROM auth_sessions WHERE token_hash = ?", (hash_token(token),)
    ).fetchone()
    if session is None or session["revoked_at"] is not None:
        raise AuthenticationFailed("Session is not valid")
    if parse_iso(session["expires_at"]) <= utcnow():
        raise AuthenticationFailed("Session has expired")
    row = _user_by(conn, "user_id", session["user_id"])
    if row is None or row["account_status"] != "active":
        raise AuthenticationFailed("Account is not active")
    return _public(row)


def get_persona(conn: sqlite3.Connection, persona: str | None) -> dict[str, Any]:
    """Open demo mode: the user a request acts as, by user_id (USR-006) or username (mission_leader).

    There are no passwords or tokens in this mode. A persona is a VIEWPOINT for demonstrating the
    role rules, not a security control: anyone can choose any persona. Without one, the configured
    default (the mission leader) is used.
    """
    value = (persona or "").strip() or get_settings().default_persona
    row = _user_by(conn, "user_id", value) or conn.execute(
        f"""SELECT {USER_COLUMNS}, u.password_hash FROM users u JOIN roles r ON r.role_id = u.role_id
            WHERE lower(u.username) = lower(?)""", (value,)).fetchone()
    if row is None:
        raise AuthenticationFailed(f"Unknown persona '{value[:64]}'. GET /api/v1/personas lists them.")
    if row["account_status"] != "active":
        raise AuthenticationFailed(f"Persona '{value[:64]}' is deactivated")
    return _public(row)


def list_personas(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Every active user as a demo persona, with a readable label."""
    rows = conn.execute(
        f"""SELECT {USER_COLUMNS}, a.astronaut_id, a.specialization, a.crew_role, a.mission_id
            FROM users u JOIN roles r ON r.role_id = u.role_id
            LEFT JOIN astronauts a ON a.user_id = u.user_id
            WHERE u.account_status = 'active' ORDER BY r.role_id, u.user_id""").fetchall()
    out = []
    for r in rows:
        if r["role_name"] == permissions.ASTRONAUT:
            detail = ", ".join(x for x in (r["crew_role"], r["specialization"]) if x)
            label = f"Astronaut {r['astronaut_id']}" + (f" ({detail})" if detail else "")
        else:
            label = r["role_name"].replace("_", " ").capitalize()
        out.append({"user_id": r["user_id"], "username": r["username"], "role_name": r["role_name"],
                    "astronaut_id": r["astronaut_id"], "mission_id": r["mission_id"], "label": label})
    return out


def require_role(user: dict[str, Any], *allowed_roles: str) -> dict[str, Any]:
    """Raise PermissionDenied unless the user's role is one of allowed_roles."""
    if user.get("role_name") not in allowed_roles:
        raise PermissionDenied(f"Requires role: {', '.join(allowed_roles)}")
    return user


def get_permitted_astronauts(conn: sqlite3.Connection, user: dict[str, Any]) -> list[str]:
    """Astronaut IDs whose health and cognitive data this user may read.

    Astronauts see only themselves; mission leader, researcher and medical officer see the crew.
    """
    if user.get("role_name") in permissions.CREW_WIDE_ROLES:
        rows = conn.execute("SELECT astronaut_id FROM astronauts ORDER BY astronaut_id").fetchall()
    elif user.get("role_name") == permissions.ASTRONAUT:
        rows = conn.execute("SELECT astronaut_id FROM astronauts WHERE user_id = ?", (user["user_id"],)).fetchall()
    else:
        rows = []
    return [r["astronaut_id"] for r in rows]


def require_astronaut_access(conn: sqlite3.Connection, user: dict[str, Any], astronaut_id: str) -> None:
    if conn.execute("SELECT 1 FROM astronauts WHERE astronaut_id = ?", (astronaut_id,)).fetchone() is None:
        raise NotFound(f"Astronaut {astronaut_id} not found")
    if astronaut_id not in get_permitted_astronauts(conn, user):
        raise PermissionDenied("You may not view this astronaut's data")


def revoke_session(conn: sqlite3.Connection, token: str) -> bool:
    """Log out: mark the session revoked. Returns False if it was already invalid."""
    cur = conn.execute(
        "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        (to_iso(utcnow()), hash_token(token)),
    )
    conn.commit()
    return cur.rowcount > 0


def set_user_password(conn: sqlite3.Connection, user_id: str, password: str, *,
                      actor_user_id: str | None = None, summary: str = "password set by setup script") -> None:
    """Store a hashed password and revoke the user's existing sessions."""
    cur = conn.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", (hash_password(password), user_id))
    if cur.rowcount == 0:
        raise NotFound(f"User {user_id} not found")
    conn.execute("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                 (to_iso(utcnow()), user_id))
    write_audit(conn, user_id=actor_user_id, action_type="set_password", entity_type="user", entity_id=user_id,
                action_result="success", change_summary=summary, commit=False)
    conn.commit()
