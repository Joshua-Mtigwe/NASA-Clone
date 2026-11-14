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
                            "recovery_recommendation_details", "ai_explanations"})


def connect(database_path: str | Path | None = None) -> sqlite3.Connection:
    """Open a connection with foreign keys enforced and rows returned as dict-like objects."""
    path = database_path or get_settings().database_path
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Create every table and index if missing. Safe to run repeatedly."""
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
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
