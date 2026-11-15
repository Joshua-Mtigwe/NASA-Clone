"""Medical Research dashboard (Phase 5).

Staff (mission leader, researcher, medical officer) may read everything here. Only the researcher
defines analyses, runs jobs, drafts reports and evaluates planning. Only the medical officer reviews
reports. Astronauts have no access: the results describe the whole crew.
"""
import sqlite3

from fastapi import APIRouter, Depends, status

from app.api.deps import require_roles
from app.core import permissions
from app.database.session import get_db
from app.schemas.research import (CreateAnalysisRequest, CreateReportRequest, EvaluatePlanningRequest,
                                  ReviewReportRequest, RunAnalysisRequest)
from app.services import planning_effectiveness_service as effectiveness
from app.services import research_report_service as reports
from app.services import research_service as research
from app.services.health_context import parse_time_param

router = APIRouter(prefix="/research", tags=["research"])
reader = require_roles(*permissions.RESEARCH_READ_ROLES)
researcher = require_roles(*permissions.RESEARCH_RUN_ROLES)
reviewer = require_roles(*permissions.REPORT_REVIEW_ROLES)


@router.get("/variables")
def variables(user: dict = Depends(reader)):
    """The variables an analysis can use (one value per astronaut per day) and the available methods."""
    return research.list_variables()


@router.get("/analyses")
def analyses(mission_id: str | None = None, user: dict = Depends(reader), conn: sqlite3.Connection = Depends(get_db)):
    return research.list_analyses(conn, mission_id)


@router.post("/analyses", status_code=status.HTTP_201_CREATED)
def create_analysis(body: CreateAnalysisRequest, user: dict = Depends(researcher),
                    conn: sqlite3.Connection = Depends(get_db)):
    """Save a research question. Running it is a separate step."""
    return research.create_analysis(conn, actor_user_id=user["user_id"], **body.model_dump())


@router.get("/analyses/{analysis_id}")
def analysis(analysis_id: str, user: dict = Depends(reader), conn: sqlite3.Connection = Depends(get_db)):
    return research.get_analysis(conn, analysis_id)


@router.post("/analyses/{analysis_id}/run", status_code=status.HTTP_201_CREATED)
def run_analysis(analysis_id: str, body: RunAnalysisRequest | None = None, user: dict = Depends(researcher),
                 conn: sqlite3.Connection = Depends(get_db)):
    """Run the analysis now. The job is finished when returned: 'completed' with results, or 'failed'
    with an error_message (for example, too little data before the run's mission time)."""
    body = body or RunAnalysisRequest()
    return research.run_analysis_job(
        conn, analysis_id, actor_user_id=user["user_id"], simulation_run_id=body.simulation_run_id,
        method=body.method, as_of=parse_time_param(body.as_of, "as_of"), astronaut_ids=body.astronaut_ids)


@router.get("/analyses/{analysis_id}/results")
def latest_results(analysis_id: str, simulation_run_id: str | None = None, user: dict = Depends(reader),
                   conn: sqlite3.Connection = Depends(get_db)):
    """The latest completed job for this analysis, with its results."""
    return research.get_job(conn, research.latest_job_id(conn, analysis_id, simulation_run_id))


@router.get("/analyses/{analysis_id}/chart")
def latest_chart(analysis_id: str, simulation_run_id: str | None = None, user: dict = Depends(reader),
                 conn: sqlite3.Connection = Depends(get_db)):
    return research.get_chart(conn, research.latest_job_id(conn, analysis_id, simulation_run_id))


@router.get("/jobs")
def jobs(analysis_id: str | None = None, simulation_run_id: str | None = None, status: str | None = None,
         user: dict = Depends(reader), conn: sqlite3.Connection = Depends(get_db)):
    return research.list_jobs(conn, analysis_id=analysis_id, simulation_run_id=simulation_run_id, status=status)


@router.get("/jobs/{job_id}")
def job(job_id: str, user: dict = Depends(reader), conn: sqlite3.Connection = Depends(get_db)):
    """Status, settings, per-astronaut summary and result rows of one job."""
    return research.get_job(conn, job_id)


@router.get("/jobs/{job_id}/chart")
def job_chart(job_id: str, user: dict = Depends(reader), conn: sqlite3.Connection = Depends(get_db)):
    """Scatter points (one per astronaut per day) and fitted lines, ready to plot."""
    return research.get_chart(conn, job_id)


@router.get("/reports")
def list_reports(analysis_id: str | None = None, status: str | None = None, simulation_run_id: str | None = None,
                 user: dict = Depends(reader), conn: sqlite3.Connection = Depends(get_db)):
    return reports.list_reports(conn, analysis_id=analysis_id, status=status, simulation_run_id=simulation_run_id)


@router.post("/reports", status_code=status.HTTP_201_CREATED)
def create_report(body: CreateReportRequest, user: dict = Depends(researcher),
                  conn: sqlite3.Connection = Depends(get_db)):
    """Draft a report from a completed job. Written by a fixed template, not an AI model."""
    return reports.create_report(conn, actor_user_id=user["user_id"], job_id=body.job_id,
                                 analysis_id=body.analysis_id, title=body.title)


@router.get("/reports/{report_id}")
def report(report_id: str, user: dict = Depends(reader), conn: sqlite3.Connection = Depends(get_db)):
    return reports.get_report(conn, report_id)


@router.post("/reports/{report_id}/review")
def review_report(report_id: str, body: ReviewReportRequest, user: dict = Depends(reviewer),
                  conn: sqlite3.Connection = Depends(get_db)):
    """Approve or reject a draft. Approval first re-checks that the results have not changed."""
    return reports.review_report(conn, report_id, user, body.decision, body.comment)


@router.get("/planning-effectiveness")
def planning_effectiveness(mission_id: str | None = None, planning_method: str | None = None,
                           user: dict = Depends(reader), conn: sqlite3.Connection = Depends(get_db)):
    return effectiveness.list_planning_effectiveness(conn, mission_id, planning_method)


@router.post("/planning-effectiveness/evaluate", status_code=status.HTTP_201_CREATED)
def evaluate_planning(body: EvaluatePlanningRequest, user: dict = Depends(researcher),
                      conn: sqlite3.Connection = Depends(get_db)):
    """Summarise a run's plans over a period, one stored row per planning method."""
    return effectiveness.evaluate_planning_effectiveness(conn, actor_user_id=user["user_id"], **body.model_dump())
