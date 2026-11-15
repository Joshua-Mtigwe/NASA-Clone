from pydantic import BaseModel, Field


class GenerateAssignmentsRequest(BaseModel):
    simulation_run_id: str
    from_day: int = Field(ge=1)
    to_day: int = Field(ge=1)
    astronaut_ids: list[str] | None = None


class StartSessionRequest(BaseModel):
    assignment_id: str


class TrialIn(BaseModel):
    trial_number: int = Field(ge=1, le=200)
    stimulus_type: str = Field(min_length=1, max_length=50)
    stimulus_value: str = Field(min_length=1, max_length=50)
    expected_response: str = Field(min_length=1, max_length=50)
    actual_response: str | None = Field(None, max_length=50, description="null = no response")
    reaction_time_ms: float | None = Field(None, ge=0, le=10_000)
    trial_timestamp: str | None = Field(None, description="ISO-8601 UTC; default: session start + 5 s per trial")


class SubmitTrialsRequest(BaseModel):
    trials: list[TrialIn] = Field(min_length=1, max_length=200)


class SurveyAnswers(BaseModel):
    fatigue_score: float = Field(ge=1, le=9, description="1 = not tired at all, 9 = extremely tired")
    sleepiness_score: float = Field(ge=1, le=9)
    perceived_workload: float = Field(ge=0, le=10)


class CompleteSessionRequest(BaseModel):
    survey: SurveyAnswers | None = Field(None, description="Required for SURVEY sessions only")


class FreezeBaselinesRequest(BaseModel):
    astronaut_ids: list[str] | None = Field(None, description="Default: the whole crew")
    clip_to_scale: bool = True
