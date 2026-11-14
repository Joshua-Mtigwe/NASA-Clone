from pydantic import BaseModel, Field


class OptimizeRequest(BaseModel):
    task_set_id: str = Field(description="One mission day's task set, e.g. SET-001")
    simulation_run_id: str = "RUN-DEMO-001"
    workday_start_hour: int = Field(9, ge=0, le=23, description="No tasks before this hour (UTC mission time)")
    require_full_coverage: bool = Field(False, description="If true, fail as 'infeasible' unless every task fits")
    solver: str = Field("auto", description="'auto' (CP-SAT if installed), 'cp-sat' or 'builtin'")


class RejectRequest(BaseModel):
    reason: str = Field("", max_length=500)
