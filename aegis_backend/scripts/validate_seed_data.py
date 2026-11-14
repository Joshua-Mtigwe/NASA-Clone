"""Check the seed CSVs without writing to any database.

    python scripts/validate_seed_data.py
    python scripts/validate_seed_data.py --seed-dir path/to/csvs --json report.json

Checks: all 49 files present, headers match schema, primary keys unique, numbers parse,
foreign keys resolve, units match sensors/metrics (Gy vs Sv), timestamps parse and are ordered,
and data_lineage row counts, checksums and source IDs.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.services.data_import_service import validate_seed_directory  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seed-dir", default=str(get_settings().seed_dir))
    parser.add_argument("--json", help="also write the full report to this file")
    args = parser.parse_args()

    report = validate_seed_directory(args.seed_dir)
    print(f"Files found: {report['files']['found']}   missing: {report['files']['missing'] or 'none'}")
    if report["files"]["unexpected"]:
        print(f"Ignored (not in schema): {report['files']['unexpected']}")
    for issue in report["issues"]:
        print(f"[{issue['severity']}] {issue['check']} {issue['table'] or ''}: {issue['message']}")
        for example in issue["examples"]:
            print(f"    e.g. {example}")
    print(f"\n{report['error_count']} errors, {report['warning_count']} warnings")
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Report written to {args.json}")
    return 0 if report["error_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
