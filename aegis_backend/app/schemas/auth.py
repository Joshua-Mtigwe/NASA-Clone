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


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    role_name: str = Field(description="astronaut, mission_leader, medical_researcher or medical_officer")
    email: str | None = Field(None, max_length=254)
    password: str | None = Field(None, min_length=8, max_length=256,
                                 description="Leave out to get a temporary password back, shown once")
    mission_id: str | None = Field(None, description="Required for the astronaut role")
    specialization: str | None = Field(None, max_length=100, description="Astronauts only, e.g. Systems")
    crew_role: str | None = Field(None, max_length=100, description="Astronauts only, e.g. Flight Engineer")


class CreateMissionRequest(BaseModel):
    mission_name: str = Field(min_length=3, max_length=200)
    launch_date: str = Field(description="YYYY-MM-DD or ISO-8601 UTC")
    planned_end_date: str
    mission_type: str = Field("simulated", max_length=100)
