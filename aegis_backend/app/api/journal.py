"""Mission journal with the Reflective Coach.

An astronaut writes private entries and gets a short reflection, a question to think about and a
prompt for next time. Entries are private unless the astronaut shares one with the medical officer.
The coach is a guided-journaling tool, not a therapist or a doctor.
"""
import sqlite3

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import current_user
from app.database.session import get_db
from app.schemas.wellbeing import ConsentIn, DemoEntriesIn, JournalEntryIn, ShareIn
from app.services import journal_service as journal

router = APIRouter(prefix="/journal", tags=["journal"])


@router.post("/entries", status_code=status.HTTP_201_CREATED)
def write(body: JournalEntryIn, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Astronaut: save an entry and get the coach's reflection.

    entry.reflection_source: 'gemma' (model, checked), 'rules' (model off or its text failed a check) or
    'escalation' (urgent: please contact the medical officer)."""
    return journal.write_entry(conn, user, body.text, simulation_run_id=body.simulation_run_id)


@router.get("/entries")
def entries(astronaut_id: str | None = None, from_day: int | None = Query(None, ge=1),
            to_day: int | None = Query(None, ge=1), user: dict = Depends(current_user),
            conn: sqlite3.Connection = Depends(get_db)):
    """Your own entries (astronaut), or only the entries astronauts have shared (medical officer)."""
    return journal.list_entries(conn, user, astronaut_id=astronaut_id, from_day=from_day, to_day=to_day)


@router.get("/entries/{entry_id}")
def entry(entry_id: str, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return journal.get_entry(conn, user, entry_id)


@router.post("/entries/{entry_id}/share")
def share(entry_id: str, body: ShareIn | None = None, user: dict = Depends(current_user),
          conn: sqlite3.Connection = Depends(get_db)):
    """Astronaut: let the medical officer read this entry, or make it private again."""
    return journal.share_entry(conn, user, entry_id, body.shared if body else True)


@router.get("/trends")
def trends(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Astronaut: what you have written about, by mission week, compared with your own earlier entries."""
    return journal.get_trends(conn, user)


@router.get("/consent")
def consent(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return journal.get_consent(conn, user)


@router.put("/consent")
def set_consent(body: ConsentIn, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Astronaut: allow or stop your journal THEMES (never text) being counted in crew-level research."""
    return journal.set_consent(conn, user, body.research_consent)


@router.get("/research-summary")
def research_summary(from_day: int | None = Query(None, ge=1), to_day: int | None = Query(None, ge=1),
                     include_synthetic: bool = Query(False, description="Also count fictional demo entries"),
                     user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    """Researcher or medical officer: crew-level theme counts from consenting astronauts. Never text,
    never per person, and nothing at all below the minimum number of consenting crew."""
    return journal.research_summary(conn, user, from_day=from_day, to_day=to_day,
                                    include_synthetic=include_synthetic)


@router.post("/demo-entries", status_code=status.HTTP_201_CREATED)
def demo_entries(body: DemoEntriesIn | None = None, user: dict = Depends(current_user),
                 conn: sqlite3.Connection = Depends(get_db)):
    """Astronaut: fill your own journal with fictional, labelled entries so the trend screens have data."""
    body = body or DemoEntriesIn()
    return journal.seed_demo_entries(conn, user, simulation_run_id=body.simulation_run_id, days=body.days)
