"""Phase 2 acceptance: stable historical data and consistent units, plus the crew health-changes view."""
from datetime import timedelta

import pytest

from app.core.errors import ValidationFailed
from app.services import environment_service as env
from app.services import health_changes_service as changes
from app.services import mission_simulator as sim
from app.services import physiology_service as phys
from app.services import radiation_service as rad
from app.services import sleep_activity_service as sleep
from app.services.health_context import resolve_as_of, resolve_range
from app.utils.timestamps import parse_iso

AT = parse_iso("2027-04-15T09:30:00Z")  # mission day 46
EARLY = parse_iso("2027-03-04T12:00:00Z")  # inside the first week


# --------------------------------------------------------------------------- "now"

def test_now_follows_the_simulation_clock(conn):
    assert resolve_as_of(conn) == parse_iso("2027-03-01T00:00:00Z")  # RUN-DEMO-001 starts at launch
    sim.jump_to_mission_day(conn, "RUN-DEMO-001", 46, actor_user_id="USR-006")
    assert resolve_as_of(conn) == parse_iso("2027-04-15T00:00:00Z")
    assert resolve_as_of(conn, at="2027-05-01T08:00:00Z") == parse_iso("2027-05-01T08:00:00Z")


def test_bad_time_parameters(conn):
    with pytest.raises(ValidationFailed):
        resolve_as_of(conn, at="yesterday")
    with pytest.raises(ValidationFailed):
        resolve_range("2027-04-10T00:00:00Z", "2027-04-01T00:00:00Z", AT, 7)


# --------------------------------------------------------------------------- vitals

def test_current_vitals(conn):
    result = phys.get_current_vitals(conn, "AST-002", AT)
    by_type = {v["measurement_type"]: v for v in result["vitals"]}
    assert set(by_type) == set(phys.VITALS)
    assert all(v["status"] == "current" and v["timestamp_utc"] == "2027-04-15T09:00:00Z" for v in by_type.values())
    assert by_type["spo2"]["unit"] == "percent"


def test_no_vitals_before_data_starts(conn):
    result = phys.get_current_vitals(conn, "AST-001", parse_iso("2027-02-15T00:00:00Z"))
    assert all(v["status"] == "no_data" for v in result["vitals"])


def test_history_is_stable_and_complete(conn):
    start, end = parse_iso("2027-04-01T00:00:00Z"), parse_iso("2027-04-07T23:59:59Z")
    daily = phys.get_vital_history(conn, "AST-001", "heart_rate", start, end, "daily")
    assert [p["day"] for p in daily["points"]] == [f"2027-04-0{d}" for d in range(1, 8)]
    assert all(p["n"] == 24 for p in daily["points"])
    hourly = phys.get_vital_history(conn, "AST-001", "heart_rate", start, end, "hourly")
    assert len(hourly["points"]) == 7 * 24
    assert phys.get_vital_history(conn, "AST-001", "heart_rate", start, end, "daily") == daily  # repeatable


def test_history_limits(conn):
    with pytest.raises(ValidationFailed):
        phys.get_vital_history(conn, "AST-001", "heart_rate", AT - timedelta(days=40), AT, "hourly")
    with pytest.raises(ValidationFailed):
        phys.get_vital_history(conn, "AST-001", "blood_pressure", AT - timedelta(days=1), AT)


def test_stats_rolling_and_trend(conn):
    stats = phys.calculate_mean_vital(conn, "AST-001", "spo2", AT - timedelta(days=7), AT)
    assert stats["n"] == 7 * 24 and 90 < stats["mean"] <= 100
    rolled = phys.calculate_rolling_average(conn, "AST-001", "spo2", AT - timedelta(days=20), AT, 7)
    values = [p["rolling_mean"] for p in rolled["points"]]
    assert values[:6] == [None] * 6 and values[6] is not None
    trend = phys.calculate_vital_trend(conn, "AST-002", "heart_rate", AT, 14)
    assert trend["direction"] in ("rising", "falling", "stable") and trend["slope_per_day"] is not None


def test_quality_check_clean_then_detects_problems(conn):
    start, end = parse_iso("2027-04-01T00:00:00Z"), parse_iso("2027-04-02T23:00:00Z")
    assert phys.detect_sensor_quality_issues(conn, start, end)["issue_count"] == 0
    conn.execute("DELETE FROM sensor_readings WHERE astronaut_id = 'AST-003' AND measurement_type = 'spo2' "
                 "AND timestamp_utc = '2027-04-01T05:00:00Z'")
    conn.execute("UPDATE sensor_readings SET measurement_value = 140 WHERE astronaut_id = 'AST-003' "
                 "AND measurement_type = 'spo2' AND timestamp_utc = '2027-04-01T06:00:00Z'")
    conn.commit()
    report = phys.detect_sensor_quality_issues(conn, start, end, "AST-003")
    spo2 = next(c for c in report["checked"] if c["measurement_type"] == "spo2")
    assert spo2["issues"]["missing_hours"]["examples"] == ["2027-04-01T05:00:00Z"]
    assert spo2["issues"]["implausible_values"]["count"] == 1


def test_body_map(conn):
    result = phys.prepare_body_map_metrics(conn, "AST-002", AT)
    regions = {r["region"]: r["metrics"] for r in result["regions"]}
    assert set(regions) == {"heart", "lungs", "core", "whole_body"}
    assert all(m["position"] in ("within_personal_range", "above_personal_range", "below_personal_range")
               for r in ("heart", "lungs", "core") for m in regions[r])
    assert regions["whole_body"][0]["position"] == "illustrative_model"
    early = phys.prepare_body_map_metrics(conn, "AST-002", EARLY)
    assert all(m["position"] == "reference_period" for r in early["regions"][:3] for m in r["metrics"])


# --------------------------------------------------------------------------- radiation units

def test_crew_radiation_is_sievert_only(conn):
    current = rad.get_current_radiation(conn, "AST-001", AT)["latest"]
    assert current["dose_rate_unit"] == "uSv/h" and current["timestamp_utc"] <= "2027-04-15T09:30:00Z"
    exposure = rad.calculate_cumulative_exposure(conn, "AST-001", parse_iso("2027-04-01T00:00:00Z"), AT)
    assert exposure["accumulated_dose_unit"] == "mSv"
    assert exposure["received_in_window"] > 0
    assert all(p["dose_rate_unit"] == "uSv/h" for p in exposure["series"])


def test_reference_radiation_kept_separate(conn):
    series = rad.prepare_radiation_research_series(conn, parse_iso("2027-03-01"), AT, include_reference=True)
    assert series["crew"]["dose_rate_unit"] == "uSv/h"
    assert len(series["nasa_reference"]["rows"]) == 76
    assert {r["dose_rate_unit"] for r in series["nasa_reference"]["rows"]} == {"uGy/h"}
    assert "nasa_reference" not in rad.prepare_radiation_research_series(conn, parse_iso("2027-03-01"), AT)


def test_mixed_units_are_rejected():
    with pytest.raises(ValidationFailed):
        rad.validate_radiation_units([{"radiation_reading_id": "x", "dose_rate_unit": "uGy/h"}], "sievert")


def test_organ_doses_are_labelled_illustrative(conn):
    result = rad.get_organ_dose_estimates(conn, "AST-001", parse_iso("2027-03-01"), AT)
    assert "not clinically validated" in result["note"]
    assert {e["dose_unit"] for e in result["estimates"]} == {"mSv"}


# --------------------------------------------------------------------------- environment

def test_environment(conn):
    current = env.get_current_environment(conn, AT)
    assert {c["measurement_type"] for c in current["readings"]} == set(env.ENVIRONMENT)
    history = env.get_environment_history(conn, "cabin_co2", AT - timedelta(days=3), AT, "daily")
    assert history["unit"] == "ppm" and len(history["points"]) >= 3
    averages = env.calculate_environment_averages(conn, AT - timedelta(days=7), AT)
    assert all(a["n"] > 0 for a in averages["averages"])
    events = env.identify_environment_scenario_events(conn, "RUN-DEMO-001", parse_iso("2027-04-01"), AT)
    assert events["events"] and "cabin_co2" in events["events"][0]["day_averages"]


# --------------------------------------------------------------------------- sleep, activity, schedule

def test_sleep_and_workload(conn):
    consistency = sleep.calculate_sleep_consistency(conn, "AST-002", AT, 14)
    assert consistency["nights"] == 14 and consistency["total_sleep_minutes"]["sd"] is not None
    workload = sleep.calculate_recent_workload(conn, "AST-002", AT, 7)
    assert workload["activity_sessions"] == 7 and workload["activity_minutes"] == 280
    context = sleep.get_pre_assessment_sleep_context(conn, "AST-002", parse_iso("2027-04-15T08:00:00Z"))
    assert context["sleep_record"] and context["assessment_context"]
    assert context["context_minus_record_minutes"] is not None


def test_schedule(conn):
    day = sleep.get_astronaut_schedule(conn, "AST-001", parse_iso("2027-03-01"))
    assert len(day["schedule_entries"]) == 1
    assert day["schedule_entries"][0]["approval_status"] == "demo_unapproved"
    assert day["recovery"] and day["task_assignments"] is not None


# --------------------------------------------------------------------------- health changes (admin view)

def test_changes_for_one_astronaut(conn):
    result = changes.calculate_health_changes(conn, "AST-002", AT)
    assert result["status"] == "compared"
    assert len(result["metrics"]) == len(changes.METRICS)
    hr = next(m for m in result["metrics"] if m["metric"] == "heart_rate")
    assert hr["reference_days"] == 7 and hr["recent_days"] == 7
    assert hr["change"] == pytest.approx(hr["recent_mean"] - hr["reference_mean"], abs=1e-3)
    assert "heart_rate" in result["notable_metrics"]  # AST-002's synthetic data drifts by mid-April


def test_changes_during_reference_week(conn):
    result = changes.calculate_health_changes(conn, "AST-001", EARLY)
    assert result["status"] == "reference_period"
    assert {m["change_level"] for m in result["metrics"]} == {"reference_period"}


def test_change_categories_filter(conn):
    result = changes.calculate_health_changes(conn, "AST-001", AT, categories=["sleep"])
    assert {m["category"] for m in result["metrics"]} == {"sleep"}
    with pytest.raises(ValidationFailed):
        changes.calculate_health_changes(conn, "AST-001", AT, categories=["mood"])


def test_crew_view_sorted_and_audited(conn):
    crew = changes.get_crew_health_changes(conn, AT, actor_user_id="USR-008")
    assert len(crew["crew"]) == 5
    counts = [s["notable_count"] for s in crew["summary"]]
    assert counts == sorted(counts, reverse=True)
    assert crew["summary"][0]["astronaut_id"] == "AST-002"
    audit = conn.execute("SELECT user_id FROM audit_logs WHERE action_type = 'view_crew_health_changes'").fetchall()
    assert [r[0] for r in audit] == ["USR-008"]


def test_crew_view_only_changes(conn):
    crew = changes.get_crew_health_changes(conn, AT, actor_user_id="USR-008", only_changes=True)
    levels = {m["change_level"] for r in crew["crew"] for m in r["metrics"]}
    assert levels <= {"notable", "mild"}
