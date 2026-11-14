"""Create the database and import the 49 seed CSVs.

    python scripts/import_csvs.py            # import into aegis.db (safe to repeat)
    python scripts/import_csvs.py --reset    # delete aegis.db first and start clean

Exit code 0 on success, 1 if the import was refused or failed.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.database.session import connect  # noqa: E402
from app.services.data_import_service import seed_demo_database  # noqa: E402


def main() -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seed-dir", default=str(settings.seed_dir))
    parser.add_argument("--db", default=str(settings.database_path))
    parser.add_argument("--reset", action="store_true", help="delete the database file before importing")
    args = parser.parse_args()

    db = Path(args.db)
    if args.reset and db.exists():
        db.unlink()
        print(f"Deleted {db}")

    conn = connect(db)
    try:
        report = seed_demo_database(conn, args.seed_dir)
    finally:
        conn.close()

    print(f"Import {report['import_run_id']}: {report['status'].upper()}")
    print(f"  rows inserted: {report['rows_inserted']:,}   already present: {report['rows_already_present']:,}")
    print(f"  errors: {report['error_count']}   warnings: {report['warning_count']}")
    for issue in report["issues"]:
        print(f"  [{issue['severity']}] {issue['check']} {issue['table'] or ''}: {issue['message']}")
        for example in issue["examples"]:
            print(f"      e.g. {example}")
    print(f"Database: {db.resolve()}")
    return 0 if report["status"] == "succeeded" else 1


if __name__ == "__main__":
    raise SystemExit(main())
