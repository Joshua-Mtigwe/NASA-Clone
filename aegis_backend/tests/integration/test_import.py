"""Phase 1 acceptance: import twice with no duplicates; valid foreign keys; invalid data refused."""
import csv
import shutil

from app.database.session import connect, seed_tables_in_load_order
from app.services.data_import_service import (
    get_import_report,
    get_import_status,
    seed_demo_database,
    validate_seed_directory,
)
from tests.conftest import SEED_DIR


def _counts(conn):
    return {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in seed_tables_in_load_order(conn)}


def _edit_csv(path, row_index, column, value):
    with path.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
        header = list(rows[0].keys())
    rows[row_index][column] = value
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)


def _seed_copy(tmp_path):
    target = tmp_path / "seed"
    shutil.copytree(SEED_DIR, target)
    return target


def test_all_49_tables_loaded_with_lineage_counts(conn):
    status = get_import_status(conn)
    assert len(status["tables"]) == 49
    assert all(t["matches_lineage"] for t in status["tables"]), [t for t in status["tables"] if not t["matches_lineage"]]
    assert status["foreign_key_violations"] == 0
    counts = _counts(conn)
    assert counts["assessment_trials"] == 43800
    assert counts["sensor_readings"] == 54000
    assert counts["radiation_readings"] == 526  # 450 crew + 76 NASA Mars rover reference
    assert counts["simulation_events"] == 97  # 78 scenario + 19 NASA DONKI reference


def test_second_import_adds_nothing(conn):
    before = _counts(conn)
    report = seed_demo_database(conn, SEED_DIR)
    assert report["status"] == "succeeded"
    assert report["rows_inserted"] == 0
    assert report["rows_already_present"] == sum(before.values())
    assert _counts(conn) == before


def test_reimport_does_not_overwrite_runtime_changes(conn, with_passwords):
    hashed = conn.execute("SELECT password_hash FROM users WHERE username = 'crew1'").fetchone()[0]
    seed_demo_database(conn, SEED_DIR)
    assert conn.execute("SELECT password_hash FROM users WHERE username = 'crew1'").fetchone()[0] == hashed


def test_nasa_reference_rows_have_no_astronaut(conn):
    rows = conn.execute("SELECT astronaut_id, dose_rate_unit FROM radiation_readings WHERE dose_rate_unit = 'uGy/h'"
                        ).fetchall()
    assert len(rows) == 76
    assert all(r["astronaut_id"] is None for r in rows)


def test_import_report_is_stored(conn):
    report = get_import_report(conn)
    assert report["status"] == "succeeded"
    assert report["error_count"] == 0


def test_orphan_reference_is_refused_and_nothing_written(tmp_path):
    seed = _seed_copy(tmp_path)
    _edit_csv(seed / "task_dependencies.csv", 0, "depends_on_task_id", "TSK-DOES-NOT-EXIST")
    conn = connect(tmp_path / "fresh.db")
    try:
        report = seed_demo_database(conn, seed)
        assert report["status"] == "refused"
        checks = {i["check"] for i in report["issues"] if i["severity"] == "error"}
        assert "foreign_key" in checks
        assert "provenance" in checks  # the edit also changed the file's checksum
        assert sum(_counts(conn).values()) == 0
    finally:
        conn.close()


def test_gray_unit_on_astronaut_is_refused(tmp_path):
    seed = _seed_copy(tmp_path)
    with (seed / "radiation_readings.csv").open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    nasa_index = next(i for i, r in enumerate(rows) if r["dose_rate_unit"] == "uGy/h")
    _edit_csv(seed / "radiation_readings.csv", nasa_index, "astronaut_id", "AST-001")
    report = validate_seed_directory(seed)
    messages = [i["message"] for i in report["issues"] if i["severity"] == "error" and i["check"] == "units"]
    assert any("Gy" in m for m in messages)


def test_missing_file_is_refused(tmp_path):
    seed = _seed_copy(tmp_path)
    (seed / "sensors.csv").unlink()
    report = validate_seed_directory(seed)
    assert report["files"]["missing"] == ["sensors"]
    assert report["error_count"] > 0


def test_duplicate_upload_files_are_ignored_with_warning(tmp_path):
    seed = _seed_copy(tmp_path)
    shutil.copyfile(seed / "missions.csv", seed / "missions_1.csv")
    report = validate_seed_directory(seed)
    assert report["error_count"] == 0
    assert report["files"]["unexpected"] == ["missions_1"]


def test_fatigue_direction_is_flagged(tmp_path):
    report = validate_seed_directory(SEED_DIR)
    assert any(i["check"] == "metric_direction" for i in report["issues"])
