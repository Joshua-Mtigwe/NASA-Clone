"""Data ingestion and integrity (plan section 3, Phase 1).

Imports the 49 seed CSVs into SQLite:
  * validates everything first and writes nothing if any check fails ("refuse invalid references"),
  * is idempotent: a row whose primary key already exists is left untouched, so importing twice
    adds no duplicates and never overwrites runtime changes (e.g. real password hashes),
  * checks each file's SHA-256 against data_lineage.csv, so changed source files are caught,
  * records every attempt in import_runs, with the full report as JSON.

Uses only the standard library (csv + sqlite3). pandas is for analysis in later phases.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.errors import NotFound
from app.database.session import (
    connect,
    foreign_keys,
    init_schema,
    primary_key,
    seed_tables_in_load_order,
    table_columns,
)
from app.utils.timestamps import parse_iso, to_iso, utcnow
from app.utils.units import is_gray, is_sievert

MAX_EXAMPLES = 5

# Columns whose names mark them as timestamps or dates.
TIMESTAMP_COLUMN = re.compile(
    r"(_at|_time|_timestamp|_date|_start|_end|^timestamp_utc|^deadline|^valid_from|^valid_until)$"
)

# (table, start column, end column): end must not be earlier than start.
TIME_ORDER_PAIRS = [
    ("activity_records", "start_time", "end_time"),
    ("assessment_assignments", "scheduled_at", "access_expires_at"),
    ("assessment_sessions", "started_at", "completed_at"),
    ("astronaut_qualifications", "valid_from", "valid_until"),
    ("daily_schedules", "start_time", "end_time"),
    ("missions", "launch_date", "planned_end_date"),
    ("research_analyses", "date_range_start", "date_range_end"),
    ("scheduled_recovery", "scheduled_start", "scheduled_end"),
    ("sleep_records", "sleep_start", "sleep_end"),
    ("task_assignments", "planned_start", "planned_end"),
    ("task_assignments", "actual_start", "actual_end"),
    ("simulation_runs", "start_mission_time", "current_mission_time"),
]


# --------------------------------------------------------------------------- data classes

@dataclass
class Issue:
    severity: str  # "error" blocks the import; "warning" is reported only
    check: str
    table: str | None
    message: str
    examples: list[Any] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "check": self.check,
            "table": self.table,
            "message": self.message,
            "examples": self.examples[:MAX_EXAMPLES],
        }


@dataclass
class CsvTable:
    name: str
    path: Path
    header: list[str]
    rows: list[dict[str, str | None]]  # '' already converted to None


def _err(check: str, table: str | None, message: str, examples: list | None = None) -> Issue:
    return Issue("error", check, table, message, list(examples or []))


def _warn(check: str, table: str | None, message: str, examples: list | None = None) -> Issue:
    return Issue("warning", check, table, message, list(examples or []))


# --------------------------------------------------------------------------- discovery & reading

def discover_csv_files(seed_dir: str | Path, expected_tables: list[str]) -> dict[str, Any]:
    """Match *.csv files in seed_dir to the expected table names.

    Returns {"found": {table: Path}, "missing": [...], "unexpected": [...]}.
    Unexpected files (e.g. duplicates like missions_1.csv) are reported, never imported.
    """
    seed_dir = Path(seed_dir)
    if not seed_dir.is_dir():
        raise NotFound(f"Seed directory not found: {seed_dir}")
    on_disk = {p.stem: p for p in sorted(seed_dir.glob("*.csv"))}
    expected = set(expected_tables)
    return {
        "found": {t: on_disk[t] for t in expected_tables if t in on_disk},
        "missing": sorted(expected - on_disk.keys()),
        "unexpected": sorted(on_disk.keys() - expected),
    }


def read_csv_table(name: str, path: Path) -> CsvTable:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        header = next(reader, [])
        rows = []
        for raw in reader:
            if not any(cell.strip() for cell in raw):
                continue  # skip blank lines
            padded = raw + [""] * (len(header) - len(raw))
            rows.append({c: (v if v != "" else None) for c, v in zip(header, padded)})
    return CsvTable(name, path, header, rows)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------- validators

def validate_csv_schema(conn: sqlite3.Connection, table: CsvTable) -> list[Issue]:
    """Header must match the table's columns; primary key present and unique; numbers parse."""
    issues: list[Issue] = []
    cols = table_columns(conn, table.name)
    db_cols = [c["name"] for c in cols]
    missing = [c for c in db_cols if c not in table.header]
    extra = [c for c in table.header if c not in db_cols]
    if missing or extra:
        issues.append(_err("csv_schema", table.name,
                           f"Header does not match schema. Missing: {missing}; unexpected: {extra}"))
        return issues
    if len(set(table.header)) != len(table.header):
        issues.append(_err("csv_schema", table.name, "Header has duplicate column names"))

    pk = primary_key(conn, table.name)
    blanks = [i + 2 for i, r in enumerate(table.rows) if r[pk] is None]  # +2: header + 1-based
    if blanks:
        issues.append(_err("primary_key", table.name, f"{len(blanks)} rows have no {pk}",
                           [f"line {n}" for n in blanks]))
    seen: set[str] = set()
    dupes = []
    for r in table.rows:
        key = r[pk]
        if key is not None and key in seen:
            dupes.append(key)
        seen.add(key)
    if dupes:
        issues.append(_err("primary_key", table.name, f"{len(dupes)} duplicate {pk} values", dupes))

    for c in cols:
        caster = {"INTEGER": int, "REAL": float}.get(c["type"].upper())
        if caster is None:
            continue
        bad = []
        for r in table.rows:
            v = r[c["name"]]
            if v is None:
                continue
            try:
                caster(v)
            except ValueError:
                bad.append(f"{r[pk]}: {c['name']}={v!r}")
        if bad:
            issues.append(_err("data_type", table.name,
                               f"{len(bad)} values in {c['name']} are not {c['type']}", bad))
    return issues


def validate_foreign_keys(conn: sqlite3.Connection, tables: dict[str, CsvTable]) -> list[Issue]:
    """Every non-empty reference must exist in the parent CSV or already in the database."""
    issues: list[Issue] = []
    key_cache: dict[tuple[str, str], set[str]] = {}

    def parent_keys(parent: str, col: str) -> set[str]:
        if (parent, col) not in key_cache:
            keys = {r[col] for r in tables[parent].rows} if parent in tables else set()
            keys |= {row[0] for row in conn.execute(f'SELECT "{col}" FROM "{parent}"')}
            keys.discard(None)
            key_cache[(parent, col)] = keys
        return key_cache[(parent, col)]

    for name, table in tables.items():
        pk_col = primary_key(conn, name)
        for col, parent, parent_col in foreign_keys(conn, name):
            if col not in table.header:
                continue
            valid = parent_keys(parent, parent_col)
            orphans = [f"{r[pk_col]} -> {r[col]}" for r in table.rows
                       if r[col] is not None and r[col] not in valid]
            if orphans:
                issues.append(_err("foreign_key", name,
                                   f"{len(orphans)} rows reference a missing {parent}.{parent_col} via {col}",
                                   orphans))
    return issues


def validate_measurement_units(tables: dict[str, CsvTable]) -> list[Issue]:
    """Units must match the sensor catalogue and metric registry; Gy and Sv are never mixed."""
    issues: list[Issue] = []
    sensor_unit = {r["sensor_id"]: r["measurement_unit"] for r in tables["sensors"].rows} \
        if "sensors" in tables else {}

    for name, unit_col, id_col in (
        ("sensor_readings", "measurement_unit", "reading_id"),
        ("environment_readings", "measurement_unit", "environment_reading_id"),
        ("radiation_readings", "dose_rate_unit", "radiation_reading_id"),
    ):
        if name not in tables:
            continue
        bad = [f"{r[id_col]}: {r[unit_col]} (sensor {r['sensor_id']} is {sensor_unit.get(r['sensor_id'])})"
               for r in tables[name].rows
               if r["sensor_id"] in sensor_unit and r[unit_col] != sensor_unit[r["sensor_id"]]]
        if bad:
            issues.append(_err("units", name, f"{len(bad)} readings use a unit different from their sensor", bad))

    if "radiation_readings" in tables:
        rows = tables["radiation_readings"].rows
        gray_on_crew = [r["radiation_reading_id"] for r in rows
                        if r["astronaut_id"] is not None and is_gray(r["dose_rate_unit"])]
        if gray_on_crew:
            issues.append(_err("units", "radiation_readings",
                               "Absorbed-dose (Gy) readings are attached to astronauts; crew dose must be in Sv",
                               gray_on_crew))
        crew_not_sv = [r["radiation_reading_id"] for r in rows
                       if r["astronaut_id"] is not None and not is_sievert(r["dose_rate_unit"])]
        if crew_not_sv:
            issues.append(_err("units", "radiation_readings",
                               "Crew radiation readings must use a sievert unit", crew_not_sv))
        acc_bad = [r["radiation_reading_id"] for r in rows
                   if r["accumulated_dose_unit"] is not None and not is_sievert(r["accumulated_dose_unit"])]
        if acc_bad:
            issues.append(_err("units", "radiation_readings",
                               "accumulated_dose_unit must be a sievert unit", acc_bad))
        ref = sum(1 for r in rows if is_gray(r["dose_rate_unit"]))
        if ref:
            issues.append(_warn("units", "radiation_readings",
                                f"{ref} external reference readings are in Gy (absorbed dose, no astronaut). "
                                "Keep them out of crew dose totals."))

    if "organ_dose_estimates" in tables:
        bad = [r["estimate_id"] for r in tables["organ_dose_estimates"].rows if not is_sievert(r["dose_unit"])]
        if bad:
            issues.append(_err("units", "organ_dose_estimates", "dose_unit must be a sievert unit", bad))

    if "metric_definitions" in tables:
        metric_units: dict[str, set[str]] = {}
        for r in tables["metric_definitions"].rows:
            metric_units.setdefault(r["metric_name"], set()).add(r["metric_unit"])
            if "fatigue" in (r["metric_name"] or "") and r["better_direction"] == "higher_is_better":
                issues.append(_warn("metric_direction", "metric_definitions",
                                    f"{r['metric_id']} says {r['metric_name']} is higher_is_better; "
                                    "a higher fatigue score normally means worse. Review before scoring.",
                                    [r["metric_id"]]))
        for name, id_col in (("assessment_results", "result_id"),
                             ("daily_cognitive_results", "daily_result_id"),
                             ("cognitive_baselines", "baseline_id")):
            if name not in tables:
                continue
            undefined, mismatched = [], []
            for r in tables[name].rows:
                units = metric_units.get(r["metric_name"])
                if units is None:
                    undefined.append(f"{r[id_col]}: {r['metric_name']}")
                elif r["metric_unit"] not in units:
                    mismatched.append(f"{r[id_col]}: {r['metric_unit']} (expected {sorted(units)})")
            if mismatched:
                issues.append(_err("units", name, f"{len(mismatched)} metric units disagree with metric_definitions",
                                   mismatched))
            if undefined:
                issues.append(_warn("units", name, f"{len(undefined)} rows use a metric not in metric_definitions",
                                    undefined))
    return issues


def validate_timestamps(tables: dict[str, CsvTable]) -> list[Issue]:
    """Timestamps must parse as ISO-8601 UTC, and ends must not precede starts."""
    issues: list[Issue] = []
    for name, table in tables.items():
        id_col = table.header[0]
        for col in table.header:
            # is_* columns are 0/1 flags (e.g. is_false_start), not times.
            if col.endswith("_id") or col.startswith("is_") or not TIMESTAMP_COLUMN.search(col):
                continue
            bad = []
            for r in table.rows:
                v = r[col]
                if v is None:
                    continue
                try:
                    parse_iso(v)
                except ValueError:
                    bad.append(f"{r[id_col]}: {col}={v!r}")
            if bad:
                issues.append(_err("timestamps", name, f"{len(bad)} unparseable values in {col}", bad))
    for name, start, end in TIME_ORDER_PAIRS:
        if name not in tables:
            continue
        id_col = tables[name].header[0]
        backwards = []
        for r in tables[name].rows:
            if r.get(start) and r.get(end):
                try:
                    if parse_iso(r[end]) < parse_iso(r[start]):
                        backwards.append(f"{r[id_col]}: {start}={r[start]} > {end}={r[end]}")
                except ValueError:
                    pass  # already reported above
        if backwards:
            issues.append(_err("timestamps", name, f"{len(backwards)} rows end before they start", backwards))
    return issues


def validate_source_provenance(tables: dict[str, CsvTable]) -> list[Issue]:
    """data_lineage must list every file with the right row count and checksum, and cite known sources."""
    issues: list[Issue] = []
    if "data_lineage" not in tables or "data_sources" not in tables:
        return [_err("provenance", "data_lineage", "data_lineage.csv and data_sources.csv are both required")]
    lineage = {r["csv_filename"]: r for r in tables["data_lineage"].rows}
    known_sources = {r["source_id"] for r in tables["data_sources"].rows}

    for name, table in tables.items():
        filename = f"{name}.csv"
        entry = lineage.get(filename)
        if entry is None:
            issues.append(_err("provenance", name, f"{filename} has no data_lineage entry"))
            continue
        try:
            expected_rows = int(entry["row_count"])
        except (TypeError, ValueError):
            expected_rows = None
        if expected_rows != len(table.rows):
            issues.append(_err("provenance", name,
                               f"data_lineage says {entry['row_count']} rows, file has {len(table.rows)}"))
        if name != "data_lineage":  # a file cannot contain its own checksum
            checksum = (entry["source_file_checksum"] or "").lower()
            if checksum and checksum != sha256_file(table.path):
                issues.append(_err("provenance", name,
                                   "File checksum differs from data_lineage: the source file was changed"))
            elif not checksum:
                issues.append(_warn("provenance", name, "data_lineage has no checksum for this file"))
        cited = [s for s in re.split(r"[;|]", entry["source_ids"] or "") if s.strip()]
        unknown = [s for s in cited if s.strip() not in known_sources]
        if unknown:
            issues.append(_err("provenance", name, "data_lineage cites unknown source IDs", unknown))
        if not cited:
            issues.append(_warn("provenance", name, "data_lineage cites no source"))

    stale = sorted(f for f in lineage if f[:-4] not in tables)
    if stale:
        issues.append(_warn("provenance", "data_lineage", "Lineage lists files that were not provided", stale))
    return issues


# --------------------------------------------------------------------------- orchestration

def _load_and_validate(conn: sqlite3.Connection, seed_dir: Path) -> tuple[dict[str, CsvTable], dict, list[Issue]]:
    expected = seed_tables_in_load_order(conn)
    files = discover_csv_files(seed_dir, expected)
    issues: list[Issue] = []
    for t in files["missing"]:
        issues.append(_err("discovery", t, f"{t}.csv is missing from {seed_dir}"))
    if files["unexpected"]:
        issues.append(_warn("discovery", None, "Files not in the schema were ignored", files["unexpected"]))

    tables = {t: read_csv_table(t, p) for t, p in files["found"].items()}
    schema_ok: dict[str, CsvTable] = {}
    for t, table in tables.items():
        found = validate_csv_schema(conn, table)
        issues += found
        if not any(i.severity == "error" and i.check == "csv_schema" for i in found):
            schema_ok[t] = table

    # The remaining checks need correct headers, so they only see tables that passed the schema check.
    issues += validate_foreign_keys(conn, schema_ok)
    issues += validate_measurement_units(schema_ok)
    issues += validate_timestamps(schema_ok)
    issues += validate_source_provenance(schema_ok)
    file_summary = {
        "found": len(files["found"]),
        "missing": files["missing"],
        "unexpected": files["unexpected"],
    }
    return tables, file_summary, issues


def validate_seed_directory(seed_dir: str | Path) -> dict[str, Any]:
    """Run every check without touching any real database (uses an in-memory copy of the schema)."""
    conn = connect(":memory:")
    try:
        init_schema(conn)
        tables, files, issues = _load_and_validate(conn, Path(seed_dir))
    finally:
        conn.close()
    return {
        "seed_dir": str(seed_dir),
        "files": files,
        "tables": {t: {"csv_rows": len(tbl.rows)} for t, tbl in tables.items()},
        "error_count": sum(i.severity == "error" for i in issues),
        "warning_count": sum(i.severity == "warning" for i in issues),
        "issues": [i.as_dict() for i in issues],
    }


def _typed(value: str | None, sql_type: str) -> Any:
    if value is None:
        return None
    t = sql_type.upper()
    if t == "INTEGER":
        return int(value)
    if t == "REAL":
        return float(value)
    return value


def _insert_table(conn: sqlite3.Connection, table: CsvTable) -> int:
    """Insert rows whose primary key is new. Returns how many were inserted."""
    cols = table_columns(conn, table.name)
    names = [c["name"] for c in cols]
    types = [c["type"] for c in cols]
    pk = primary_key(conn, table.name)
    placeholders = ", ".join("?" for _ in names)
    col_list = ", ".join(f'"{n}"' for n in names)
    sql = (f'INSERT INTO "{table.name}" ({col_list}) VALUES ({placeholders}) '
           f'ON CONFLICT("{pk}") DO NOTHING')
    before = conn.total_changes
    conn.executemany(sql, ([_typed(r[n], t) for n, t in zip(names, types)] for r in table.rows))
    return conn.total_changes - before


def seed_demo_database(conn: sqlite3.Connection, seed_dir: str | Path) -> dict[str, Any]:
    """Validate and import the seed CSVs. Writes nothing if any validation error is found.

    Safe to run any number of times: existing primary keys are skipped, never overwritten.
    Returns the import report (also stored in import_runs).
    """
    seed_dir = Path(seed_dir)
    init_schema(conn)
    run_id = f"IMP-{uuid.uuid4().hex[:12].upper()}"
    started = to_iso(utcnow())
    conn.execute(
        "INSERT INTO import_runs (import_run_id, started_at, seed_dir, status) VALUES (?, ?, ?, 'running')",
        (run_id, started, str(seed_dir)),
    )
    conn.commit()

    report: dict[str, Any] = {"import_run_id": run_id, "seed_dir": str(seed_dir), "started_at": started}
    inserted_total = present_total = 0
    try:
        tables, files, issues = _load_and_validate(conn, seed_dir)
        report["files"] = files
        errors = [i for i in issues if i.severity == "error"]
        table_report: dict[str, dict[str, int]] = {}

        if errors:
            status = "refused"
        else:
            try:
                for name in seed_tables_in_load_order(conn):
                    table = tables[name]
                    inserted = _insert_table(conn, table)
                    table_report[name] = {
                        "csv_rows": len(table.rows),
                        "inserted": inserted,
                        "already_present": len(table.rows) - inserted,
                    }
                    inserted_total += inserted
                    present_total += len(table.rows) - inserted
                violations = conn.execute("PRAGMA foreign_key_check").fetchall()
                if violations:
                    raise sqlite3.IntegrityError(f"{len(violations)} foreign-key violations after import")
                conn.commit()
                status = "succeeded"
            except sqlite3.DatabaseError as exc:
                conn.rollback()
                issues.append(_err("database", None, f"Import rolled back: {exc}"))
                table_report, inserted_total, present_total = {}, 0, 0
                status = "failed"

        report.update({
            "status": status,
            "tables": table_report,
            "rows_inserted": inserted_total,
            "rows_already_present": present_total,
            "error_count": sum(i.severity == "error" for i in issues),
            "warning_count": sum(i.severity == "warning" for i in issues),
            "issues": [i.as_dict() for i in issues],
        })
    except Exception as exc:  # unexpected failure: record it, then re-raise
        conn.rollback()
        report.update({"status": "failed", "error_count": 1, "warning_count": 0,
                       "rows_inserted": 0, "rows_already_present": 0,
                       "issues": [_err("internal", None, repr(exc)).as_dict()]})
        _finish_import_run(conn, report)
        raise
    _finish_import_run(conn, report)
    return report


def _finish_import_run(conn: sqlite3.Connection, report: dict[str, Any]) -> None:
    report["finished_at"] = to_iso(utcnow())
    conn.execute(
        """UPDATE import_runs SET finished_at = ?, status = ?, rows_inserted = ?, rows_already_present = ?,
               error_count = ?, warning_count = ?, report_json = ? WHERE import_run_id = ?""",
        (report["finished_at"], report["status"], report["rows_inserted"], report["rows_already_present"],
         report["error_count"], report["warning_count"], json.dumps(report), report["import_run_id"]),
    )
    conn.commit()


def get_import_report(conn: sqlite3.Connection, import_run_id: str | None = None) -> dict[str, Any]:
    """The stored report for one import run, or the most recent one."""
    if import_run_id:
        row = conn.execute("SELECT report_json FROM import_runs WHERE import_run_id = ?",
                           (import_run_id,)).fetchone()
    else:
        row = conn.execute("SELECT report_json FROM import_runs ORDER BY started_at DESC, rowid DESC LIMIT 1"
                           ).fetchone()
    if row is None:
        raise NotFound("No import has been run yet" if not import_run_id else f"Import run {import_run_id} not found")
    return json.loads(row["report_json"])


def get_import_status(conn: sqlite3.Connection) -> dict[str, Any]:
    """Current row count of each seed table compared with data_lineage, plus the latest import."""
    lineage = {r["csv_filename"]: r["row_count"] for r in conn.execute(
        "SELECT csv_filename, row_count FROM data_lineage")}
    tables = []
    for name in seed_tables_in_load_order(conn):
        count = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
        expected = lineage.get(f"{name}.csv")
        tables.append({
            "table": name,
            "rows": count,
            "lineage_rows": expected,
            # Runtime tables (audit_logs etc.) grow after import, so more rows than lineage is fine.
            "matches_lineage": expected is not None and count >= int(expected),
        })
    runs = [dict(r) for r in conn.execute(
        """SELECT import_run_id, started_at, finished_at, status, rows_inserted, rows_already_present,
                  error_count, warning_count FROM import_runs ORDER BY started_at DESC, rowid DESC LIMIT 10""")]
    fk_violations = len(conn.execute("PRAGMA foreign_key_check").fetchall())
    return {"tables": tables, "recent_imports": runs, "foreign_key_violations": fk_violations}
