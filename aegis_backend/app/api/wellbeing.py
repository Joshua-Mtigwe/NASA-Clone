"""Wellbeing chat.

An astronaut describes how they feel; the Reflective Coach reflects it back, draws on their own current
metrics, suggests only approved recovery activities and points them to their crew and the medical officer.
Messages are private to the astronaut unless they share a conversation. Immediate danger, or a serious
sign that keeps coming back, raises a risk flag for the medical officer with the indicator only.
"""
import sqlite3

from fastapi import APIRouter, Depends, Query

from app.api.deps import current_user
from app.database.session import get_db
from app.schemas.wellbeing import AcknowledgeIn, ChatMessageIn, ReviewIn, ShareIn
from app.services import wellbeing_risk_service as risk
from app.services import wellbeing_service as wellbeing

router = APIRouter(prefix="/wellbeing", tags=["wellbeing chat"])


@router.post("/chat")
def chat(body: ChatMessageIn, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Send a message (astronauts only). Returns your stored message, the stored reply and a safety note.

    reply.source: 'gemma' (model, checked), 'rules' (model off or its answer failed a check) or
    'escalation' (urgent: please contact the medical officer; the conversation is flagged).
    """
    return wellbeing.send_message(conn, user, body.message, conversation_id=body.conversation_id,
                                  simulation_run_id=body.simulation_run_id)


@router.get("/conversations")
def conversations(astronaut_id: str | None = None,
                  flagged: bool | None = Query(None, description="Medical officer: only flagged (or unflagged)"),
                  user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Your conversations (astronaut), or everyone's (medical officer). Flagged ones first."""
    return wellbeing.list_conversations(conn, user, astronaut_id=astronaut_id, flagged=flagged)


@router.get("/conversations/{conversation_id}")
def conversation(conversation_id: str, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """The astronaut sees every message and reply. The medical officer sees the messages only if the
    astronaut has shared the conversation (each such read is audited); otherwise `private` is true and
    `messages` is empty."""
    return wellbeing.get_conversation(conn, user, conversation_id)


@router.post("/conversations/{conversation_id}/share")
def share(conversation_id: str, body: ShareIn | None = None, user: dict = Depends(current_user),
          conn: sqlite3.Connection = Depends(get_db)):
    """Astronaut: let the medical officer read this conversation, or make it private again."""
    return wellbeing.share_conversation(conn, user, conversation_id, body.shared if body else True)


@router.post("/conversations/{conversation_id}/review")
def review(conversation_id: str, body: ReviewIn, user: dict = Depends(current_user),
           conn: sqlite3.Connection = Depends(get_db)):
    """Medical officer: record the follow-up on a flagged conversation."""
    return wellbeing.review_conversation(conn, user, conversation_id, body.note)


@router.get("/risk-flags")
def risk_flags(astronaut_id: str | None = None, open_only: bool = Query(False, description="Only unacknowledged"),
               user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Break-glass flags from the chat and the journal: the indicator only, never the text.
    The medical officer sees everyone's; an astronaut sees their own, so they know what was shared."""
    return risk.list_flags(conn, user, astronaut_id=astronaut_id, open_only=open_only)


@router.post("/risk-flags/{flag_id}/acknowledge")
def acknowledge(flag_id: str, body: AcknowledgeIn, user: dict = Depends(current_user),
                conn: sqlite3.Connection = Depends(get_db)):
    """Medical officer: record the follow-up on a flag."""
    return risk.acknowledge(conn, user, flag_id, body.note)
