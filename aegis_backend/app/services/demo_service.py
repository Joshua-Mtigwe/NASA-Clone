"""Reset the open demo to its starting data.

With no logins, anyone visiting a hosted demo can change its data (start simulations, approve plans,
take tests). reset_demo_database puts everything back: every table is emptied and the 49 seed CSVs
are imported again, exactly as `python scripts/import_csvs.py --reset` would, but without
restarting the server.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from app.core import permissions
from app.core.config import get_settings
from app.core.errors import NotFound
from app.services import auth_service
from app.services.audit_service import write_audit
from app.services.data_import_service import seed_demo_database


def reset_demo_database(conn: sqlite3.Connection, user: dict[str, Any]) -> dict[str, Any]:
    auth_service.require_role(user, permissions.MISSION_LEADER)
    settings = get_settings()
    if settings.auth_mode != "open" or not settings.allow_demo_reset:
        raise NotFound("Demo reset is only available in open demo mode with AEGIS_ALLOW_DEMO_RESET=true")

    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        for table in tables:
            conn.execute(f'DELETE FROM "{table}"')
        conn.commit()
    finally:
        conn.execute("PRAGMA foreign_keys = ON")
    report = seed_demo_database(conn, settings.seed_dir)
    if report["status"] == "succeeded":
        write_audit(conn, user_id=user["user_id"], action_type="reset_demo", entity_type="database",
                    entity_id=None, action_result="success",
                    change_summary=f"{report['rows_inserted']} seed rows restored")
    return {"status": report["status"], "rows_restored": report["rows_inserted"],
            "import_run_id": report["import_run_id"], "error_count": report["error_count"]}
