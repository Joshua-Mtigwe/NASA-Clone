"""Wellbeing chat.

An astronaut describes how they feel; the reply draws on their own current metrics and suggests
only approved recovery activities. Urgent messages are sent to the medical officer, not the model.
Every message and reply is stored. Only the astronaut and the medical officer can read a conversation.
"""
import sqlite3

from fastapi import APIRouter, Depends, Query

from app.api.deps import current_user
from app.database.session import get_db
from app.schemas.wellbeing import ChatMessageIn, ReviewIn
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
    """Every message and reply. The medical officer also sees the facts each reply used and any check
    problems; their reads are recorded in the audit log."""
    return wellbeing.get_conversation(conn, user, conversation_id)


@router.post("/conversations/{conversation_id}/review")
def review(conversation_id: str, body: ReviewIn, user: dict = Depends(current_user),
           conn: sqlite3.Connection = Depends(get_db)):
    """Medical officer: record the follow-up on a flagged conversation."""
    return wellbeing.review_conversation(conn, user, conversation_id, body.note)
