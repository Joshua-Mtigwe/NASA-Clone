"""AI explanations (Phase 6). Gemma runs on this machine and only puts existing decisions into words.

Every route answers even when the model is off: `source` is "gemma" when a checked AI text is
shown and "rules" (or "template" for reports) when the rule-based text is shown instead.
"""
import sqlite3

from fastapi import APIRouter, Depends, status

from app.api.deps import current_user
from app.database.session import get_db
from app.schemas.research import CreateReportRequest
from app.services import ai_service

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/recovery-recommendations/{recommendation_id}/explain")
def explain_recovery(recommendation_id: str, user: dict = Depends(current_user),
                     conn: sqlite3.Connection = Depends(get_db)):
    """Medical officer. Ask the model to explain a recovery suggestion from its stored evidence."""
    return ai_service.explain_recovery(conn, recommendation_id, user)


@router.post("/task-assignments/{task_assignment_id}/explain")
def explain_task(task_assignment_id: str, user: dict = Depends(current_user),
                 conn: sqlite3.Connection = Depends(get_db)):
    """Mission leader. Ask the model to explain a task assignment made by the scheduler."""
    return ai_service.explain_task(conn, task_assignment_id, user)


@router.get("/explanations/{entity_type}/{entity_id}")
def explanation(entity_type: str, entity_id: str, user: dict = Depends(current_user),
                conn: sqlite3.Connection = Depends(get_db)):
    """Read the explanation to show (no model call). entity_type: recovery_recommendation or task_assignment.
    The astronaut concerned and staff may read it."""
    return ai_service.get_explanation(conn, entity_type, entity_id, user)


@router.post("/reports", status_code=status.HTTP_201_CREATED)
def draft_report(body: CreateReportRequest, user: dict = Depends(current_user),
                 conn: sqlite3.Connection = Depends(get_db)):
    """Researcher. Draft a research report with the model; the fixed template is used if the model
    is unavailable or its text fails the checks. The report is a draft for the medical officer."""
    return ai_service.draft_report(conn, user, job_id=body.job_id, analysis_id=body.analysis_id, title=body.title)
