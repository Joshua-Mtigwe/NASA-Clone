"""Shared FastAPI dependencies: database connection, the acting user, role checks.

Who is asking depends on AEGIS_AUTH_MODE:
* open (default): the persona in the X-AEGIS-User header (a user_id like USR-006 or a username like
  crew1), or the default persona (the mission leader) when the header is missing. No passwords.
* token: the user behind the Authorization: Bearer <token> header, as issued by POST /auth/login.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Callable

from fastapi import Depends
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import is_open_mode
from app.core.errors import NotFound
from app.database.session import get_db
from app.services import auth_service

PERSONA_HEADER = "X-AEGIS-User"

bearer_scheme = HTTPBearer(auto_error=False, description="Token mode only")
persona_scheme = APIKeyHeader(name=PERSONA_HEADER, auto_error=False,
                              description="Open demo mode: act as this persona, e.g. USR-006 or crew1 "
                                          "(GET /api/v1/personas lists them). Empty = mission leader.")


def get_token(creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> str | None:
    return creds.credentials if creds else None


def current_user(
    token: str | None = Depends(get_token),
    persona: str | None = Depends(persona_scheme),
    conn: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    if is_open_mode():
        return auth_service.get_persona(conn, persona)
    return auth_service.get_current_user(conn, token)


def require_roles(*roles: str) -> Callable[..., dict[str, Any]]:
    """Use as: user = Depends(require_roles(permissions.MISSION_LEADER))."""

    def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        return auth_service.require_role(user, *roles)

    return dependency


def token_mode_only() -> None:
    """For login and password routes: they do not exist in open demo mode."""
    if is_open_mode():
        raise NotFound("Not available in open demo mode: there are no logins or passwords. "
                       "Choose a persona with the X-AEGIS-User header instead.")
