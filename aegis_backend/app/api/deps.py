"""Shared FastAPI dependencies: database connection, signed-in user, role checks."""
from __future__ import annotations

import sqlite3
from typing import Any, Callable

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database.session import get_db
from app.services import auth_service

bearer_scheme = HTTPBearer(auto_error=False)


def get_token(creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme)) -> str | None:
    return creds.credentials if creds else None


def current_user(
    token: str | None = Depends(get_token), conn: sqlite3.Connection = Depends(get_db)
) -> dict[str, Any]:
    return auth_service.get_current_user(conn, token)


def require_roles(*roles: str) -> Callable[..., dict[str, Any]]:
    """Use as: user = Depends(require_roles(permissions.MISSION_LEADER))."""

    def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        return auth_service.require_role(user, *roles)

    return dependency
