from pydantic import BaseModel, Field

from app.services.mission_simulator import MAX_SPEED, MIN_SPEED


class CreateRunRequest(BaseModel):
    mission_id: str = "MIS-001"
    run_name: str = Field(min_length=1, max_length=120)
    speed_multiplier: int = Field(60, ge=MIN_SPEED, le=MAX_SPEED)
    start_mission_day: int = Field(1, ge=1)
    copy_events_from: str | None = Field(
        "RUN-DEMO-001", description="Run whose scenario events are copied into the new run; null for none."
    )


class SpeedRequest(BaseModel):
    speed_multiplier: int = Field(ge=MIN_SPEED, le=MAX_SPEED)


class JumpRequest(BaseModel):
    mission_day: int = Field(ge=1)
    hour: int = Field(0, ge=0, le=23, description="Hour of the day (UTC), e.g. 8 for the morning tests")


class SimulationState(BaseModel):
    simulation_run_id: str
    mission_id: str
    run_name: str
    status: str
    speed_multiplier: int
    start_mission_time: str
    current_mission_time: str
    mission_day: int
    mission_total_days: int
    mission_launch: str
    mission_end: str
    data_mode: str | None = None
    created_at: str | None = None


class SimulationEvent(BaseModel):
    event_id: str
    simulation_run_id: str | None = None
    mission_id: str | None = None
    mission_day: int | None = None
    event_timestamp: str | None = None
    event_type: str | None = None
    event_title: str | None = None
    description: str | None = None
    severity: str | None = None
    source_type: str | None = None
