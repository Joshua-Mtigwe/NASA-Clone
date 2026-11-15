"""Accounts and missions: creating a mission, registering users and astronauts, and passwords.

There is no open sign-up. Roles decide who can read the crew's medical data, so an account is
created by the mission leader, who chooses its role. The new user gets a temporary password
(shown once) and should change it after first login.

* A user with the astronaut role must be given an astronaut profile on a mission.
* A new astronaut starts with medical_clearance_status 'pending_review' and has no readiness
  record or qualifications, so the task scheduler will not assign them anything until those exist.
* Deactivating an account, or changing or resetting its password, signs it out everywhere.

Open demo mode (AEGIS_AUTH_MODE=open, the default): there are no passwords. Creating a user
creates a new demo persona; its password_hash is the placeholder OPEN_DEMO_NO_PASSWORD, which can
never be used to sign in, and no temporary password is generated or returned.
"""
from __future__ import annotations

import re
import secrets
import sqlite3
import uuid
from typing import Any

from app.core import permissions
from app.core.config import is_open_mode
from app.core.errors import AuthenticationFailed, Conflict, NotFound, ValidationFailed
from app.core.security import hash_password, verify_password
from app.services import auth_service
from app.services.audit_service import write_audit
from app.utils.timestamps import parse_iso, to_iso, utcnow

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8
NO_PASSWORD = "OPEN_DEMO_NO_PASSWORD"  # never a valid hash, so it can never be used to sign in

_USER_SQL = """SELECT u.user_id, u.username, u.email, u.role_id, r.role_name, u.account_status, u.created_at,
                      u.last_login_at, a.astronaut_id, a.mission_id, a.specialization, a.crew_role,
                      a.medical_clearance_status
               FROM users u JOIN roles r ON r.role_id = u.role_id
               LEFT JOIN astronauts a ON a.user_id = u.user_id"""


def _check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise ValidationFailed(f"Password must be at least {MIN_PASSWORD} characters")


def _temporary_password() -> str:
    return secrets.token_urlsafe(12)


# --------------------------------------------------------------------------- missions

def create_mission(conn: sqlite3.Connection, actor: dict[str, Any], *, mission_name: str, launch_date: str,
                   planned_end_date: str, mission_type: str = "simulated") -> dict[str, Any]:
    """Register a new mission. It starts empty: crew, tasks and data are added afterwards."""
    auth_service.require_role(actor, *permissions.USER_ADMIN_ROLES)
    name = mission_name.strip()
    if conn.execute("SELECT 1 FROM missions WHERE lower(mission_name) = lower(?)", (name,)).fetchone():
        raise Conflict(f"A mission named '{name}' already exists")
    try:
        launch, end = parse_iso(launch_date), parse_iso(planned_end_date)
    except ValueError as exc:
        raise ValidationFailed("Dates must look like 2028-01-15 or 2028-01-15T00:00:00Z") from exc
    if end <= launch:
        raise ValidationFailed("planned_end_date must be after launch_date")
    mission_id = f"MIS-{uuid.uuid4().hex[:8].upper()}"
    conn.execute(
        """INSERT INTO missions (mission_id, mission_name, mission_type, launch_date, planned_end_date,
               actual_end_date, mission_status) VALUES (?, ?, ?, ?, ?, NULL, 'planned')""",
        (mission_id, name, mission_type.strip() or "simulated", to_iso(launch), to_iso(end)))
    write_audit(conn, user_id=actor["user_id"], action_type="create_mission", entity_type="mission",
                entity_id=mission_id, action_result="success", change_summary=name[:200], commit=False)
    conn.commit()
    return dict(conn.execute("SELECT * FROM missions WHERE mission_id = ?", (mission_id,)).fetchone())


# --------------------------------------------------------------------------- users

def get_user(conn: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    row = conn.execute(f"{_USER_SQL} WHERE u.user_id = ?", (user_id,)).fetchone()
    if row is None:
        raise NotFound(f"User {user_id} not found")
    return dict(row)


def list_users(conn: sqlite3.Connection, *, role_name: str | None = None, mission_id: str | None = None,
               account_status: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"""{_USER_SQL} WHERE (:r IS NULL OR r.role_name = :r) AND (:m IS NULL OR a.mission_id = :m)
              AND (:s IS NULL OR u.account_status = :s) ORDER BY u.created_at, u.user_id""",
        {"r": role_name, "m": mission_id, "s": account_status}).fetchall()
    return [dict(r) for r in rows]


def create_user(conn: sqlite3.Connection, actor: dict[str, Any], *, username: str, role_name: str,
                email: str | None = None, password: str | None = None, mission_id: str | None = None,
                specialization: str | None = None, crew_role: str | None = None) -> dict[str, Any]:
    """Register an account. Returns the user plus, when no password was supplied, a temporary one (once)."""
    auth_service.require_role(actor, *permissions.USER_ADMIN_ROLES)
    username = username.strip().lower()
    if not USERNAME_RE.match(username):
        raise ValidationFailed("Username must be 3 to 32 characters: lowercase letters, digits, dot, dash or "
                               "underscore, starting with a letter or digit")
    if conn.execute("SELECT 1 FROM users WHERE lower(username) = ?", (username,)).fetchone():
        raise Conflict(f"Username '{username}' is already taken")
    email = (email or "").strip().lower() or None
    if email:
        if not EMAIL_RE.match(email):
            raise ValidationFailed("That does not look like an email address")
        if conn.execute("SELECT 1 FROM users WHERE lower(email) = ?", (email,)).fetchone():
            raise Conflict("That email address is already in use")
    role = conn.execute("SELECT role_id FROM roles WHERE role_name = ?", (role_name,)).fetchone()
    if role is None:
        raise ValidationFailed(f"Unknown role '{role_name}'", {"allowed": list(permissions.ALL_ROLES)})
    is_astronaut = role_name == permissions.ASTRONAUT
    if is_astronaut:
        if not mission_id:
            raise ValidationFailed("An astronaut needs a mission_id")
        if conn.execute("SELECT 1 FROM missions WHERE mission_id = ?", (mission_id,)).fetchone() is None:
            raise NotFound(f"Mission {mission_id} not found")
    elif mission_id or specialization or crew_role:
        raise ValidationFailed("mission_id, specialization and crew_role apply only to the astronaut role")
    if is_open_mode():
        if password:
            raise ValidationFailed("Open demo mode has no passwords; leave password out")
        temporary, stored_hash = None, NO_PASSWORD
    else:
        temporary = None if password else _temporary_password()
        _check_password(password or temporary)
        stored_hash = hash_password(password or temporary)

    user_id, now = f"USR-{uuid.uuid4().hex[:8].upper()}", to_iso(utcnow())
    conn.execute(
        """INSERT INTO users (user_id, username, email, password_hash, role_id, account_status, created_at,
               last_login_at) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL)""",
        (user_id, username, email, stored_hash, role["role_id"], now))
    if is_astronaut:
        astronaut_id = f"AST-{uuid.uuid4().hex[:8].upper()}"
        conn.execute(
            """INSERT INTO astronauts (astronaut_id, user_id, astronaut_code, specialization, mission_id, crew_role,
                   medical_clearance_status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?)""",
            (astronaut_id, user_id, astronaut_id, (specialization or "").strip() or None, mission_id,
             (crew_role or "").strip() or None, now))
    write_audit(conn, user_id=actor["user_id"], action_type="create_user", entity_type="user", entity_id=user_id,
                action_result="success",
                change_summary=f"{username} as {role_name}" + (f" on {mission_id}" if is_astronaut else ""),
                commit=False)
    conn.commit()
    out = get_user(conn, user_id)
    if is_open_mode():
        out["note"] = (f"New demo persona. Act as it with the header X-AEGIS-User: {user_id} "
                       "(open demo mode has no passwords).")
        return out
    out["temporary_password"] = temporary
    out["note"] = ("Give this temporary password to the user now; it is not stored and cannot be shown again. "
                   "They should change it after signing in." if temporary else
                   "The user should change this password after signing in.")
    return out


def set_account_status(conn: sqlite3.Connection, actor: dict[str, Any], user_id: str, active: bool) -> dict[str, Any]:
    auth_service.require_role(actor, *permissions.USER_ADMIN_ROLES)
    user = get_user(conn, user_id)
    if not active and user_id == actor["user_id"]:
        raise Conflict("You cannot deactivate your own account")
    status = "active" if active else "disabled"
    if user["account_status"] == status:
        raise Conflict(f"Account is already {status}")
    conn.execute("UPDATE users SET account_status = ? WHERE user_id = ?", (status, user_id))
    if not active:
        conn.execute("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                     (to_iso(utcnow()), user_id))
    write_audit(conn, user_id=actor["user_id"], action_type="reactivate_user" if active else "deactivate_user",
                entity_type="user", entity_id=user_id, action_result="success", commit=False)
    conn.commit()
    return get_user(conn, user_id)


# --------------------------------------------------------------------------- passwords

def reset_password(conn: sqlite3.Connection, actor: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Give a user a new temporary password (shown once) and sign them out everywhere."""
    auth_service.require_role(actor, *permissions.USER_ADMIN_ROLES)
    user = get_user(conn, user_id)
    temporary = _temporary_password()
    auth_service.set_user_password(conn, user_id, temporary, actor_user_id=actor["user_id"],
                                   summary="password reset by mission leader")
    return {"user_id": user_id, "username": user["username"], "temporary_password": temporary,
            "note": "Give this temporary password to the user now; it cannot be shown again."}


def change_own_password(conn: sqlite3.Connection, user: dict[str, Any], current_password: str,
                        new_password: str) -> dict[str, Any]:
    """Change your own password. Every session, including this one, is signed out afterwards."""
    stored = conn.execute("SELECT password_hash FROM users WHERE user_id = ?", (user["user_id"],)).fetchone()
    if stored is None or not verify_password(current_password, stored["password_hash"]):
        write_audit(conn, user_id=user["user_id"], action_type="change_password", entity_type="user",
                    entity_id=user["user_id"], action_result="denied", change_summary="wrong current password")
        raise AuthenticationFailed("Current password is not correct")
    _check_password(new_password)
    if new_password == current_password:
        raise ValidationFailed("The new password must be different from the current one")
    auth_service.set_user_password(conn, user["user_id"], new_password, actor_user_id=user["user_id"],
                                   summary="password changed by the user")
    return {"status": "password_changed", "note": "You have been signed out. Sign in again with the new password."}
