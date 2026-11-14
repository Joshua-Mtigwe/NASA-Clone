from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class UserOut(BaseModel):
    user_id: str
    username: str
    email: str | None = None
    role_id: str
    role_name: str
    account_status: str
    created_at: str | None = None
    last_login_at: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str
    user: UserOut


class MeResponse(BaseModel):
    user: UserOut
    permitted_astronaut_ids: list[str]
