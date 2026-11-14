import sqlite3

from fastapi import APIRouter, Depends, status

from app.api.deps import current_user, get_token
from app.database.session import get_db
from app.schemas.auth import ChangePasswordRequest, LoginRequest, MeResponse, TokenResponse
from app.services import account_service, auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, conn: sqlite3.Connection = Depends(get_db)):
    """Exchange username and password for a bearer token."""
    return auth_service.authenticate_user(conn, body.username, body.password)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(token: str | None = Depends(get_token), conn: sqlite3.Connection = Depends(get_db),
           user: dict = Depends(current_user)):
    auth_service.revoke_session(conn, token)


@router.get("/me", response_model=MeResponse)
def me(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return {"user": user, "permitted_astronaut_ids": auth_service.get_permitted_astronauts(conn, user)}


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, user: dict = Depends(current_user),
                    conn: sqlite3.Connection = Depends(get_db)):
    """Change your own password. You are signed out everywhere and must sign in again."""
    return account_service.change_own_password(conn, user, body.current_password, body.new_password)
