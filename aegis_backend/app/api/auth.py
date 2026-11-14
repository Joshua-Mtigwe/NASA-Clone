"""Who am I, and the demo personas.

Open demo mode (default): GET /personas lists who you can act as; send X-AEGIS-User on each request.
Token mode only: /auth/login, /auth/logout, /auth/change-password (404 in open mode, hidden from /docs).
"""
import sqlite3

from fastapi import APIRouter, Depends, status

from app.api.deps import current_user, get_token, token_mode_only
from app.core.config import get_settings, is_open_mode
from app.database.session import get_db
from app.schemas.auth import ChangePasswordRequest, LoginRequest, MeResponse, TokenResponse
from app.services import account_service, auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
personas_router = APIRouter(tags=["personas"])

_TOKEN_ROUTES_VISIBLE = not is_open_mode()  # decided at startup, only affects what /docs shows


@personas_router.get("/personas")
def personas(conn: sqlite3.Connection = Depends(get_db)):
    """Everyone you can act as in open demo mode. No sign-in needed.

    These are demonstration viewpoints, not security: they show how each role sees and does
    different things (an astronaut sees only their own data; only the mission leader approves plans).
    """
    settings = get_settings()
    return {"auth_mode": settings.auth_mode, "header": "X-AEGIS-User",
            "default_persona": settings.default_persona if settings.auth_mode == "open" else None,
            "personas": auth_service.list_personas(conn)}


@router.get("/me", response_model=MeResponse)
def me(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """The persona (open mode) or signed-in user (token mode), and which astronauts they may see."""
    return {"user": user, "permitted_astronaut_ids": auth_service.get_permitted_astronauts(conn, user)}


@router.post("/login", response_model=TokenResponse, include_in_schema=_TOKEN_ROUTES_VISIBLE,
             dependencies=[Depends(token_mode_only)])
def login(body: LoginRequest, conn: sqlite3.Connection = Depends(get_db)):
    """Token mode: exchange username and password for a bearer token."""
    return auth_service.authenticate_user(conn, body.username, body.password)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=_TOKEN_ROUTES_VISIBLE,
             dependencies=[Depends(token_mode_only)])
def logout(token: str | None = Depends(get_token), conn: sqlite3.Connection = Depends(get_db),
           user: dict = Depends(current_user)):
    auth_service.revoke_session(conn, token)


@router.post("/change-password", include_in_schema=_TOKEN_ROUTES_VISIBLE, dependencies=[Depends(token_mode_only)])
def change_password(body: ChangePasswordRequest, user: dict = Depends(current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    """Token mode: change your own password. You are signed out everywhere and must sign in again."""
    return account_service.change_own_password(conn, user, body.current_password, body.new_password)
