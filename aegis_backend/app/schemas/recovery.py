from pydantic import BaseModel, Field


class GenerateRecoveryRequest(BaseModel):
    simulation_run_id: str = "RUN-DEMO-001"
    astronaut_ids: list[str] | None = Field(None, description="Default: the whole crew")
    as_of: str | None = Field(None, description="ISO-8601 UTC. Default: the run's current mission time")
    limit: int = Field(2, ge=1, le=5, description="Most suggestions per astronaut")


class ReviewRecoveryRequest(BaseModel):
    comment: str = Field("", max_length=500)


class ScheduleRecoveryRequest(BaseModel):
    scheduled_start: str = Field(description="ISO-8601 UTC mission time, e.g. 2027-04-15T15:00:00Z")


class RecoveryOutcomeRequest(BaseModel):
    feedback: str = Field("", max_length=500, description="How it went, in the astronaut's words")
    at: str | None = Field(None, description="ISO-8601 UTC mission time, not in the future. "
                                             "Default: the run's current mission time")
