"""Phase 5: analysis jobs, statistics, charts, reviewed reports and planning effectiveness."""
import math

import pytest

from app.core.errors import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services import mission_simulator as sim
from app.services import planning_effectiveness_service as pe
from app.services import research_report_service as rr
from app.services import research_service as rs
from app.utils.statistics import correlation, ranks, t_two_sided_p
from app.utils.timestamps import parse_iso

RESEARCHER = "USR-007"
OFFICER = {"user_id": "USR-008", "role_name": "medical_officer"}
DEMO = "RUN-DEMO-001"


@pytest.fixture
def at_mission_end(conn):
    sim.jump_to_mission_day(conn, DEMO, 90, actor_user_id="USR-006", hour=23)
    return conn


def _run(conn, analysis_id="ANL-001", **kw):
    return rs.run_analysis_job(conn, analysis_id, actor_user_id=RESEARCHER, **kw)


def _result(job, name):
    return next(r for r in job["results"] if r["metric_name"] == name)


# ------------------------------------------------------------------ statistics helpers

def test_t_distribution_p_values_match_reference_tables():
    assert t_two_sided_p(2.0, 10) == pytest.approx(0.073388, abs=1e-6)
    assert t_two_sided_p(1.96, 1000) == pytest.approx(0.050273, abs=1e-6)
    assert t_two_sided_p(0.0, 5) == pytest.approx(1.0)
    assert t_two_sided_p(-2.0, 10) == t_two_sided_p(2.0, 10)


def test_correlation_known_values():
    c = correlation([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])
    assert c["r"] == 0.8 and c["slope"] == pytest.approx(0.8) and c["intercept"] == pytest.approx(0.6)
    assert c["p_value"] == pytest.approx(0.104088, abs=1e-6)
    assert (c["ci_lower"], c["ci_upper"]) == (-0.2796, 0.9862)
    assert correlation([1, 2, 3], [5, 5, 5]) is None  # no spread
    assert correlation([1, 2], [1, 2]) is None  # too few
    assert correlation([1, 2, 3, 4], [2, 4, 6, 8])["p_value"] == 0.0


def test_ranks_share_ties():
    assert ranks([10, 20, 20, 5]) == [2.0, 3.5, 3.5, 1.0]


# ------------------------------------------------------------------ dataset

def test_catalogue_lists_variables_and_methods():
    cat = rs.list_variables()
    names = {v["variable"] for v in cat["variables"]}
    assert {"total_sleep_minutes", "accumulated_dose", "median_reaction_time_ms", "fatigue_score",
            "cognitive_workload"} <= names
    assert [m["method"] for m in cat["methods"]] == ["descriptive", "pearson", "spearman", "within_person"]
    # every seeded analysis uses catalogued variables
    assert all(a in names for a in ("total_sleep_minutes", "median_reaction_time_ms"))


def test_sleep_is_paired_with_the_following_day(conn):
    start, end = parse_iso("2027-03-01"), parse_iso("2027-03-04")
    values = rs.daily_values(conn, "total_sleep_minutes", "AST-001", start, end, end, DEMO)
    # SLP-AST-001-001 started on 28 Feb (409.5 min): it is the night before 1 March.
    assert values["2027-03-01"] == 409.5 and values["2027-03-02"] == 458.7
    assert sorted(values) == ["2027-03-01", "2027-03-02", "2027-03-03"]


def test_dataset_never_uses_data_after_as_of(conn):
    analysis = rs.get_analysis(conn, "ANL-001")
    ds = rs.build_dataset(conn, analysis, simulation_run_id=DEMO, as_of=parse_iso("2027-03-10T12:00:00Z"))
    assert max(p["day"] for p in ds["points"]) == "2027-03-10"
    assert len(ds["points"]) == 50  # 5 astronauts x 10 days
    early = rs.build_dataset(conn, analysis, simulation_run_id=DEMO, as_of=parse_iso("2027-03-10T07:00:00Z"))
    assert max(p["day"] for p in early["points"]) == "2027-03-09"  # the 08:00 test has not happened yet


def test_radiation_variables_only_use_crew_sievert_data(conn):
    start, end = parse_iso("2027-03-01"), parse_iso("2027-05-30")
    dose = rs.daily_values(conn, "accumulated_dose", "AST-001", start, end, end, DEMO)
    assert len(dose) == 90
    ordered = [dose[d] for d in sorted(dose)]
    assert ordered == sorted(ordered)  # accumulates


def test_other_run_has_no_cognitive_data_until_it_produces_some(conn):
    run = sim.create_simulation_run(conn, mission_id="MIS-001", run_name="r", actor_user_id="USR-006")
    job = _run(conn, simulation_run_id=run["simulation_run_id"], as_of=parse_iso("2027-05-29T23:00:00Z"))
    assert job["status"] == "failed" and "No days have both" in job["error_message"]


# ------------------------------------------------------------------ jobs

def test_job_fails_cleanly_before_any_data_exists(conn):
    job = _run(conn)  # the demo run starts at day 1, 00:00
    assert job["status"] == "failed" and job["completed_at"]
    assert "Move the simulation run forward" in job["error_message"]
    assert job["results"] == []
    assert conn.execute("SELECT COUNT(*) FROM analysis_results").fetchone()[0] == 0


def test_too_few_pairs_fails_for_association_but_not_descriptive(conn):
    as_of = parse_iso("2027-03-01T12:00:00Z")  # one day x 5 astronauts
    assert "needs at least 10" in _run(conn, method="pearson", as_of=as_of)["error_message"]
    job = _run(conn, method="descriptive", as_of=as_of)
    assert job["status"] == "completed" and [r["sample_size"] for r in job["results"]] == [5, 5]


def test_descriptive_job_matches_direct_calculation(at_mission_end):
    job = _run(at_mission_end, method="descriptive")
    assert job["status"] == "completed" and job["parameters"]["as_of_source"] == "run_clock"
    sleep = _result(job, "total_sleep_minutes")
    rows = at_mission_end.execute(
        "SELECT total_sleep_minutes v FROM sleep_records WHERE sleep_start >= '2027-02-28' AND sleep_start < '2027-05-29'"
    ).fetchall()
    assert sleep["sample_size"] == len(rows) == 450
    assert sleep["metric_value"] == pytest.approx(sum(r["v"] for r in rows) / 450, abs=1e-3)
    assert sleep["p_value"] is None and sleep["metric_unit"] == "minutes"


def test_within_person_removes_differences_between_astronauts(at_mission_end):
    """In the seed, pooled sleep vs reaction time is positive, yet within every astronaut it is negative."""
    pooled = _result(_run(at_mission_end, method="pearson"), "pearson_r")
    job = _run(at_mission_end, method="within_person")
    within = _result(job, "within_person_r")
    assert pooled["metric_value"] > 0.2 and within["metric_value"] < -0.2
    assert all(a["r"] < 0 for a in job["summary"]["per_astronaut"])
    assert job["summary"]["fit"]["degrees_of_freedom"] == 450 - 5 - 1
    assert within["confidence_interval_lower"] < within["metric_value"] < within["confidence_interval_upper"]
    assert "not a cause" in within["interpretation"]


def test_pearson_matches_independent_calculation(at_mission_end):
    job = _run(at_mission_end, "ANL-003", method="pearson")
    points = rs.get_chart(at_mission_end, job["job_id"])["points"]
    xs, ys = [p["x"] for p in points], [p["y"] for p in points]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    r = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(
        sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    assert _result(job, "pearson_r")["metric_value"] == pytest.approx(r, abs=1e-4)


def test_spearman_has_no_slope(at_mission_end):
    rho = _result(_run(at_mission_end, method="spearman"), "spearman_rho")
    assert rho["effect_estimate"] is None and -1 <= rho["metric_value"] <= 1


def test_same_job_twice_gives_same_numbers(at_mission_end):
    a, b = _run(at_mission_end, method="within_person"), _run(at_mission_end, method="within_person")
    strip = lambda job: [{k: v for k, v in r.items() if k not in ("analysis_result_id", "calculated_at")}
                         for r in job["results"]]
    assert a["job_id"] != b["job_id"] and strip(a) == strip(b)
    assert rs.latest_job_id(at_mission_end, "ANL-001") == b["job_id"]
    assert len(rs.list_jobs(at_mission_end, analysis_id="ANL-001")) == 2


def test_astronaut_filter_and_unknown_astronaut(at_mission_end):
    job = _run(at_mission_end, method="pearson", astronaut_ids=["AST-002"])
    assert job["summary"]["pairs"] == 90 and job["summary"]["astronauts"] == 1
    failed = _run(at_mission_end, astronaut_ids=["AST-999"])
    assert failed["status"] == "failed" and "not on this mission" in failed["error_message"]


def test_jobs_are_audited(at_mission_end):
    job = _run(at_mission_end, method="descriptive")
    row = at_mission_end.execute("SELECT * FROM audit_logs WHERE entity_id = ?", (job["job_id"],)).fetchone()
    assert row["action_type"] == "run_analysis_job" and row["user_id"] == RESEARCHER


def test_unknown_analysis_and_method(conn):
    with pytest.raises(NotFound):
        _run(conn, "ANL-NOPE")
    with pytest.raises(ValidationFailed):
        _run(conn, method="magic")


# ------------------------------------------------------------------ analyses

def test_create_analysis_validates_and_defaults_to_mission_dates(conn):
    a = rs.create_analysis(conn, actor_user_id=RESEARCHER, research_question="Does HRV track fatigue?",
                           independent_variable="hrv_rmssd", dependent_variable="fatigue_score")
    assert a["analysis_method"] == "within_person"
    assert (a["date_range_start"], a["date_range_end"]) == ("2027-03-01", "2027-05-29")
    assert a["analysis_id"] in {x["analysis_id"] for x in rs.list_analyses(conn)}
    for bad in ({"independent_variable": "nope"}, {"dependent_variable": "hrv_rmssd"}, {"analysis_method": "x"},
                {"date_range_start": "2027-05-01", "date_range_end": "2027-04-01"}):
        with pytest.raises(ValidationFailed):
            rs.create_analysis(conn, actor_user_id=RESEARCHER, **{
                "research_question": "q?", "independent_variable": "hrv_rmssd",
                "dependent_variable": "fatigue_score", **bad})


# ------------------------------------------------------------------ charts

def test_chart_points_and_lines(at_mission_end):
    job = _run(at_mission_end, method="within_person")
    chart = rs.get_chart(at_mission_end, job["job_id"])
    assert len(chart["points"]) == 450 and len(chart["series"]) == 5 and len(chart["lines"]) == 5
    assert chart["x_axis"]["unit"] == "minutes" and chart["y_axis"]["unit"] == "ms"
    pooled = rs.get_chart(at_mission_end, _run(at_mission_end, method="pearson")["job_id"])
    assert [line["label"] for line in pooled["lines"]] == ["all astronauts"]
    assert rs.get_chart(at_mission_end, _run(at_mission_end, method="descriptive")["job_id"])["lines"] == []


def test_failed_job_has_no_chart(conn):
    with pytest.raises(ValidationFailed):
        rs.get_chart(conn, _run(conn)["job_id"])


# ------------------------------------------------------------------ reports

def test_report_draft_review_flow(at_mission_end):
    job = _run(at_mission_end, method="within_person")
    report = rr.create_report(at_mission_end, actor_user_id=RESEARCHER, job_id=job["job_id"])
    assert report["status"] == "draft" and report["model_id"] is None
    assert report["data_classification"] == "synthetic_demo" and len(report["evidence_hash"]) == 64
    assert "no AI model" in report["report_text"] and "AST-005" in report["report_text"]
    approved = rr.review_report(at_mission_end, report["report_id"], OFFICER, "approve", "Checked.")
    assert approved["status"] == "approved" and approved["reviewed_by_user_id"] == "USR-008"
    assert approved["review_comment"] == "Checked." and approved["reviewed_at"]
    with pytest.raises(Conflict):
        rr.review_report(at_mission_end, report["report_id"], OFFICER, "reject")


def test_report_cannot_be_approved_after_results_change(at_mission_end):
    job = _run(at_mission_end, method="pearson")
    report = rr.create_report(at_mission_end, actor_user_id=RESEARCHER, job_id=job["job_id"])
    at_mission_end.execute("UPDATE analysis_results SET metric_value = 0.99 WHERE analysis_result_id = ?",
                           (job["results"][-1]["analysis_result_id"],))
    at_mission_end.commit()
    with pytest.raises(Conflict, match="changed"):
        rr.review_report(at_mission_end, report["report_id"], OFFICER, "approve")
    assert rr.get_report(at_mission_end, report["report_id"])["status"] == "draft"
    denied = at_mission_end.execute("SELECT COUNT(*) FROM audit_logs WHERE entity_id = ? AND action_result = 'denied'",
                                    (report["report_id"],)).fetchone()[0]
    assert denied == 1
    assert rr.review_report(at_mission_end, report["report_id"], OFFICER, "reject")["status"] == "rejected"


def test_author_cannot_review_own_report(at_mission_end):
    job = _run(at_mission_end, method="descriptive")
    report = rr.create_report(at_mission_end, actor_user_id=RESEARCHER, job_id=job["job_id"])
    with pytest.raises(PermissionDenied):
        rr.review_report(at_mission_end, report["report_id"], {"user_id": RESEARCHER}, "approve")


def test_report_needs_a_completed_job(conn):
    with pytest.raises(ValidationFailed):
        rr.create_report(conn, actor_user_id=RESEARCHER, job_id=_run(conn)["job_id"])
    with pytest.raises(NotFound):
        rr.create_report(conn, actor_user_id=RESEARCHER, analysis_id="ANL-002")  # nothing run yet


# ------------------------------------------------------------------ planning effectiveness

def test_planning_effectiveness_for_seed_plan(conn):
    out = pe.evaluate_planning_effectiveness(conn, actor_user_id=RESEARCHER, period_start="2027-03-01",
                                             period_end="2027-03-07", analysis_id="ANL-001")
    (row,) = out["evaluations"]
    assert row["planning_method"] == "preloaded_demo" and row["days_planned"] == 7
    assert row["assignments"] == 49 and row["task_coverage_rate"] == 1.0
    assert row["workload_balance_metric"] >= 0 and row["cognitive_metric_value"] > 0
    # nothing has been recorded as started or completed, so rates are empty rather than zero
    assert row["task_completion_rate"] is None and row["schedule_adherence_rate"] is None
    assert row["recovery_adherence_rate"] is None
    stored = pe.list_planning_effectiveness(conn, "MIS-001")
    assert [s["effectiveness_id"] for s in stored] == [row["effectiveness_id"]]
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_planning_effectiveness_uses_recorded_actuals(conn):
    conn.execute("""UPDATE task_assignments SET actual_start = planned_start, actual_end = planned_end
                    WHERE task_assignment_id IN ('TA-001-01', 'TA-001-02')""")
    conn.execute("UPDATE task_assignments SET actual_start = '2027-03-01T13:00:00Z' WHERE task_assignment_id = 'TA-001-03'")
    conn.execute("UPDATE scheduled_recovery SET completion_status = 'completed' WHERE scheduled_recovery_id = 'SRC-AST-001-001'")
    conn.commit()
    (row,) = pe.evaluate_planning_effectiveness(conn, actor_user_id=RESEARCHER, period_start="2027-03-01",
                                                period_end="2027-03-01")["evaluations"]
    assert row["task_completion_rate"] == round(2 / 7, 4)
    assert row["schedule_adherence_rate"] == round(2 / 3, 4)
    assert row["recovery_adherence_rate"] == 0.2


def test_planning_effectiveness_ignores_other_runs_and_bad_input(conn):
    run = sim.create_simulation_run(conn, mission_id="MIS-001", run_name="r", actor_user_id="USR-006")
    out = pe.evaluate_planning_effectiveness(conn, actor_user_id=RESEARCHER, period_start="2027-03-01",
                                             period_end="2027-03-07", simulation_run_id=run["simulation_run_id"])
    assert out["evaluations"] == [] and "No approved" in out["note"]
    with pytest.raises(ValidationFailed):
        pe.evaluate_planning_effectiveness(conn, actor_user_id=RESEARCHER, period_start="2027-03-09",
                                           period_end="2027-03-07")
    with pytest.raises(NotFound):
        pe.evaluate_planning_effectiveness(conn, actor_user_id=RESEARCHER, period_start="2027-03-01",
                                           period_end="2027-03-07", simulation_run_id="RUN-NOPE")
