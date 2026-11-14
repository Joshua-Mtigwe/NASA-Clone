from pydantic import BaseModel, Field


class CreateAnalysisRequest(BaseModel):
    research_question: str = Field(min_length=3, max_length=500)
    independent_variable: str = Field(description="See GET /research/variables")
    dependent_variable: str
    analysis_method: str = Field("within_person", description="descriptive, pearson, spearman or within_person")
    date_range_start: str | None = Field(None, description="YYYY-MM-DD. Default: first mission day")
    date_range_end: str | None = Field(None, description="YYYY-MM-DD, included. Default: last mission day")
    mission_id: str = "MIS-001"
    analysis_type: str | None = Field(None, max_length=100)


class RunAnalysisRequest(BaseModel):
    simulation_run_id: str = "RUN-DEMO-001"
    method: str | None = Field(None, description="Override the analysis's own method for this job")
    as_of: str | None = Field(None, description="Use only data before this ISO-8601 UTC time. "
                                                "Default: the run's current mission time")
    astronaut_ids: list[str] | None = Field(None, description="Default: the whole crew")


class CreateReportRequest(BaseModel):
    job_id: str | None = Field(None, description="A completed analysis job")
    analysis_id: str | None = Field(None, description="Or an analysis; its latest completed job is used")
    title: str | None = Field(None, max_length=200)


class ReviewReportRequest(BaseModel):
    decision: str = Field(description="'approve' or 'reject'")
    comment: str = Field("", max_length=500)


class EvaluatePlanningRequest(BaseModel):
    period_start: str = Field(description="YYYY-MM-DD")
    period_end: str = Field(description="YYYY-MM-DD, included")
    simulation_run_id: str = "RUN-DEMO-001"
    mission_id: str = "MIS-001"
    analysis_id: str | None = None
    include_drafts: bool = Field(False, description="Also count draft plans that nobody has approved")
