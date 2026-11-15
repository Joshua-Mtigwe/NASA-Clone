"""SQLite connections and schema setup."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterator

from app.core.config import get_settings

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# Tables the backend owns at runtime. Everything else in schema.sql is one of the 49 seed tables.
RUNTIME_TABLES = frozenset({"import_runs", "auth_sessions", "simulation_run_clock", "daily_result_runs",
                            "analysis_job_details", "analysis_result_jobs", "research_report_details",
                            "recovery_recommendation_details", "ai_explanations", "sync_event_details",
                            "wellbeing_conversations", "wellbeing_messages", "journal_entries",
                            "wellbeing_consent", "wellbeing_risk_flags",
                            "console_practice", "console_task_details", "console_programme_details", "console_assessment_metadata"})


def connect(database_path: str | Path | None = None) -> sqlite3.Connection:
    """Open a connection with foreign keys enforced and rows returned as dict-like objects."""
    path = database_path or get_settings().database_path
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


# Columns added to existing runtime tables after they first shipped. CREATE TABLE IF NOT EXISTS does not
# add columns to a table that already exists, so init_schema adds any that are missing.
_ADDED_COLUMNS = {
    "wellbeing_conversations": {"shared_with_medical_officer": "INTEGER NOT NULL DEFAULT 0", "shared_at": "TEXT"},
    "wellbeing_messages": {"analysis_json": "TEXT"},
}


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    for table, columns in _ADDED_COLUMNS.items():
        have = {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
        for name, ddl in columns.items():
            if have and name not in have:
                conn.execute(f'ALTER TABLE "{table}" ADD COLUMN {name} {ddl}')


def init_schema(conn: sqlite3.Connection) -> None:
    """Create every table and index if missing, and add newer columns to older tables. Safe to repeat."""
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _add_missing_columns(conn)
    conn.execute("PRAGMA foreign_keys = ON")  # executescript can reset connection state
    conn.commit()


def seed_tables_in_load_order(conn: sqlite3.Connection) -> list[str]:
    """The 49 seed tables, parents first (schema.sql creation order)."""
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid"
    ).fetchall()
    return [r["name"] for r in rows if r["name"] not in RUNTIME_TABLES]


def table_columns(conn: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    """PRAGMA table_info rows: name, type, notnull, pk ..."""
    return conn.execute(f'PRAGMA table_info("{table}")').fetchall()


def primary_key(conn: sqlite3.Connection, table: str) -> str:
    pks = [c["name"] for c in table_columns(conn, table) if c["pk"]]
    if len(pks) != 1:
        raise RuntimeError(f"{table} must have exactly one primary-key column, found {pks}")
    return pks[0]


def foreign_keys(conn: sqlite3.Connection, table: str) -> list[tuple[str, str, str]]:
    """(column, parent_table, parent_column) for each foreign key on the table."""
    return [
        (r["from"], r["table"], r["to"])
        for r in conn.execute(f'PRAGMA foreign_key_list("{table}")').fetchall()
    ]


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request, closed afterwards."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
