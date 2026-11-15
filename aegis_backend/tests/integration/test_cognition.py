"""Phase 3 acceptance: reproducible scoring and context-matched baselines, plus the assessment flow."""
import random

import pytest

from app.core.errors import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services import assessment_service as asv
from app.services import baseline_service as bs
from app.services import cognitive_comparison_service as cc
from app.services import cognitive_scoring as sc
from app.services import mission_simulator as sim
from app.utils.timestamps import parse_iso

LEADER, CREW1 = "USR-006", "USR-001"


# --------------------------------------------------------------------------- scoring

def test_scoring_reproduces_every_stored_result(conn):
    rows = conn.execute("SELECT s.session_id, s.protocol_id, r.metric_value FROM assessment_sessions s "
                        "JOIN assessment_results r USING (session_id)").fetchall()
    assert len(rows) == 2920
    for session_id, protocol_id, stored in rows:
        score = sc.score_session(conn, session_id)
        # Stored PVT medians were computed before trial times were rounded to 0.1 ms.
        tolerance = 0.05 + 1e-9 if protocol_id == "PVT" else 1e-9
        assert abs(score["metric_value"] - stored) <= tolerance, session_id


def test_scoring_is_deterministic(conn):
    assert sc.score_session(conn, "SES-0000001") == sc.score_session(conn, "SES-0000001")


def test_pvt_scorer_rules():
    trials = [{"reaction_time_ms": rt} for rt in [300.0] * 9 + [50.0, 600.0, 310.0, None]]
    score = sc.score_reaction_time_test(trials)
    assert score["scorable"] and score["metric_value"] == 300.0  # false start (50) excluded
    assert score["valid_trials"] == 11  # 9 x 300, 600 and 310; the false start and no-response are out
    assert score["details"] == {"mean_reaction_time_ms": 328.18, "lapses": 1, "false_starts": 1, "no_response": 1}
    assert not sc.score_reaction_time_test([{"reaction_time_ms": 300.0}] * 5)["scorable"]


def test_accuracy_scorer():
    trials = [{"is_correct": 1, "reaction_time_ms": 400.0}] * 15 + [{"is_correct": 0, "reaction_time_ms": 500.0}] * 5
    assert sc.score_n_back_test(trials)["metric_value"] == 75.0


def test_protocol_validation(conn):
    assert sc.validate_scoring_protocol(conn, "PVT")["metric"]["better_direction"] == "lower_is_better"
    assert sc.validate_scoring_protocol(conn, "SURVEY")["metric"]["better_direction"] == "lower_is_better"
    with pytest.raises(ValidationFailed):
        sc.validate_scoring_protocol(conn, "SWITCH")  # in the catalogue, but no scorer or metric yet
    with pytest.raises(NotFound):
        sc.validate_scoring_protocol(conn, "NOPE")


# --------------------------------------------------------------------------- baselines

@pytest.mark.parametrize("protocol_id", ["PVT", "NBACK", "STROOP", "SURVEY"])
@pytest.mark.parametrize("condition", ["morning", "evening"])
def test_baseline_rebuild_matches_seed_v1(conn, protocol_id, condition):
    seeded = dict(conn.execute(
        "SELECT * FROM cognitive_baselines WHERE astronaut_id = 'AST-003' AND protocol_id = ? "
        "AND assessment_condition = ? AND baseline_version = 'v1'", (protocol_id, condition)).fetchone())
    built = bs.build_astronaut_baseline(conn, "AST-003", protocol_id, condition, clip_to_scale=False)
    for key in ("median_value", "mean_value", "standard_deviation", "reference_lower", "reference_upper",
                "sample_size"):
        assert built[key] == seeded[key], key


def test_baseline_is_context_matched(conn):
    morning = bs.find_matching_baseline(conn, "AST-001", "PVT", "morning")
    evening = bs.find_matching_baseline(conn, "AST-001", "PVT", "evening")
    assert morning["assessment_condition"] == "morning" and evening["assessment_condition"] == "evening"
    assert morning["mean_value"] != evening["mean_value"]


def test_insufficient_samples_rejected():
    with pytest.raises(ValidationFailed):
        bs.check_baseline_sample_size(5)


def test_freeze_new_version(conn):
    result = bs.freeze_baseline_version(conn, actor_user_id="USR-008")
    assert result["baseline_version"] == "v2" and len(result["created"]) == 40
    latest = bs.find_matching_baseline(conn, "AST-001", "NBACK", "morning")
    assert latest["baseline_version"] == "v2" and latest["reference_upper"] <= 100
    assert len(bs.get_baselines(conn, "AST-001", "v1")) == 8  # old version kept
    assert bs.freeze_baseline_version(conn, actor_user_id="USR-008")["baseline_version"] == "v3"


# --------------------------------------------------------------------------- comparisons

def test_reaggregating_a_seeded_day_changes_nothing(conn):
    before = [dict(r) for r in conn.execute(
        "SELECT daily_mean, daily_median, sessions_completed, valid_trials FROM daily_cognitive_results "
        "WHERE astronaut_id = 'AST-004' AND assessment_date = '2027-04-02' ORDER BY protocol_id")]
    rows = cc.aggregate_daily_cognitive_results(conn, "AST-004", "2027-04-02")
    after = [{k: r[k] for k in before[0]} for r in rows]
    assert after == before


def test_stored_comparison_status_matches_baseline(conn):
    for c in cc.get_cognitive_comparisons(conn, "AST-002", "2027-03-01", "2027-05-29")["comparisons"]:
        lo, hi = c["reference_range"]
        assert (c["reference_range_status"] == "within_reference") == (lo <= c["inflight_value"] <= hi)


@pytest.mark.parametrize("value,direction,expected", [
    (330, "lower_is_better", "outside_range_worse"),   # slow reaction time
    (250, "lower_is_better", "outside_range_better"),
    (300, "lower_is_better", "within_usual_range"),
    (50, "higher_is_better", "outside_range_worse"),   # low accuracy
])
def test_direction_aware_interpretation(value, direction, expected):
    baseline = {"mean_value": 300.0, "standard_deviation": 10.0, "reference_lower": 280.0, "reference_upper": 320.0}
    if direction == "higher_is_better":
        baseline = {"mean_value": 90.0, "standard_deviation": 5.0, "reference_lower": 80.0, "reference_upper": 100.0}
    result = cc.calculate_standardized_difference(value, baseline, direction)
    assert result["interpretation"] == expected
    if expected != "within_usual_range":  # positive performance_z always means "better", whatever the metric
        assert (result["performance_z"] > 0) == (expected == "outside_range_better")


def test_trend_reads_direction(conn):
    trend = cc.calculate_cognitive_trend(conn, "AST-002", "SURVEY", parse_iso("2027-04-15T09:00:00Z"), 30)
    assert trend["better_direction"] == "lower_is_better"
    assert trend["trend"] in ("improving", "declining", "stable")


# --------------------------------------------------------------------------- full flow in a new run

@pytest.fixture
def day3(conn):
    """A new run with day-3 assignments and the clock at 08:00 on day 3 (the window is open)."""
    run = sim.create_simulation_run(conn, mission_id="MIS-001", run_name="flow", actor_user_id=LEADER)
    run_id = run["simulation_run_id"]
    created = asv.generate_assessment_assignments(conn, simulation_run_id=run_id, from_day=3, to_day=3,
                                                  actor_user_id=LEADER)
    assert created["created"] == 20  # 5 astronauts x 4 tests
    sim.jump_to_mission_day(conn, run_id, 3, actor_user_id=LEADER, hour=8)
    return run_id


def _pvt_trials(n=20, seed=1):
    rng = random.Random(seed)
    return [{"trial_number": i, "stimulus_type": "visual_signal", "stimulus_value": "target",
             "expected_response": "click", "actual_response": "click",
             "reaction_time_ms": round(rng.uniform(260, 320), 1)} for i in range(1, n + 1)]


def _due(conn, run_id, protocol, astronaut="AST-001"):
    return next(a for a in asv.get_due_assessments(conn, astronaut, run_id)["due"] if a["protocol_id"] == protocol)


def test_generation_is_idempotent_and_uses_flight_template(conn, day3):
    again = asv.generate_assessment_assignments(conn, simulation_run_id=day3, from_day=3, to_day=3,
                                                actor_user_id=LEADER)
    assert again == {**again, "created": 0, "already_existed": 20}
    rows = conn.execute("SELECT DISTINCT schedule_template_id, assignment_source, assigned_by_user_id "
                        "FROM assessment_assignments WHERE simulation_run_id = ?", (day3,)).fetchall()
    assert [tuple(r) for r in rows] == [("TPL-FLIGHT", "system_template", None)]


def test_window_follows_the_clock(conn, day3):
    assignment = _due(conn, day3, "PVT")
    assert assignment["effective_status"] == "available"
    sim.jump_to_mission_day(conn, day3, 3, actor_user_id=LEADER, hour=10)
    assert asv.get_due_assessments(conn, "AST-001", day3)["due"] == []
    with pytest.raises(Conflict):
        asv.start_assessment_session(conn, assignment["assignment_id"], actor_astronaut_id="AST-001",
                                     actor_user_id=CREW1)


def test_full_pvt_flow(conn, day3):
    assignment = _due(conn, day3, "PVT")
    session = asv.start_assessment_session(conn, assignment["assignment_id"], actor_astronaut_id="AST-001",
                                           actor_user_id=CREW1)
    assert session["session_status"] == "in_progress" and session["started_at"] == "2027-03-03T08:00:00Z"
    asv.submit_assessment_trials(conn, session["session_id"], _pvt_trials(), actor_astronaut_id="AST-001")
    done = asv.complete_assessment_session(conn, session["session_id"], actor_astronaut_id="AST-001",
                                           actor_user_id=CREW1)
    assert done["session"]["quality_status"] == "valid"
    assert done["session"]["result"]["metric_value"] == sc.score_session(conn, session["session_id"])["metric_value"]
    assert done["comparison"]["baseline_id"].startswith("BASE-AST-001-morning-PVT")
    assert done["comparison"]["interpretation"] in ("within_usual_range", "outside_range_better",
                                                    "outside_range_worse")
    # The new run's day result is separate from the demo run's.
    assert len(cc.get_daily_cognition(conn, "AST-001", "2027-03-03", "2027-03-03", day3)) == 1
    assert len(cc.get_daily_cognition(conn, "AST-001", "2027-03-03", "2027-03-03")) == 4


def test_survey_flow_uses_fatigue_direction(conn, day3):
    assignment = _due(conn, day3, "SURVEY")
    session = asv.start_assessment_session(conn, assignment["assignment_id"], actor_astronaut_id="AST-001",
                                           actor_user_id=CREW1)
    with pytest.raises(ValidationFailed):
        asv.complete_assessment_session(conn, session["session_id"], actor_astronaut_id="AST-001",
                                        actor_user_id=CREW1)
    done = asv.complete_assessment_session(
        conn, session["session_id"], actor_astronaut_id="AST-001", actor_user_id=CREW1,
        survey={"fatigue_score": 7.0, "sleepiness_score": 6.0, "perceived_workload": 5.0})
    assert done["score"]["metric_value"] == 7.0
    assert done["comparison"]["interpretation"] == "outside_range_worse"  # high fatigue is worse
    assert done["comparison"]["performance_z"] < 0


def test_trials_are_validated_and_correctness_recomputed(conn, day3):
    assignment = _due(conn, day3, "NBACK")
    session = asv.start_assessment_session(conn, assignment["assignment_id"], actor_astronaut_id="AST-001",
                                           actor_user_id=CREW1)
    sid = session["session_id"]
    trial = {"trial_number": 1, "stimulus_type": "cognitive_target", "stimulus_value": "stimulus_0",
             "expected_response": "key_0", "actual_response": "key_1", "reaction_time_ms": 500.0, "is_correct": 1}
    asv.submit_assessment_trials(conn, sid, [trial], actor_astronaut_id="AST-001")
    stored = asv.get_session(conn, sid)["trials"][0]
    assert stored["is_correct"] == 0  # client's is_correct ignored
    with pytest.raises(Conflict):
        asv.submit_assessment_trials(conn, sid, [trial], actor_astronaut_id="AST-001")  # number reused
    with pytest.raises(PermissionDenied):
        asv.submit_assessment_trials(conn, sid, [{**trial, "trial_number": 2}], actor_astronaut_id="AST-002")


def test_too_few_trials_marks_session_invalid(conn, day3):
    assignment = _due(conn, day3, "PVT")
    session = asv.start_assessment_session(conn, assignment["assignment_id"], actor_astronaut_id="AST-001",
                                           actor_user_id=CREW1)
    asv.submit_assessment_trials(conn, session["session_id"], _pvt_trials(5), actor_astronaut_id="AST-001")
    done = asv.complete_assessment_session(conn, session["session_id"], actor_astronaut_id="AST-001",
                                           actor_user_id=CREW1)
    assert done["session"]["quality_status"] == "invalid" and done["session"]["result"] is None
    assert done["daily_result"] is None


def test_only_the_assigned_astronaut_can_start(conn, day3):
    assignment = _due(conn, day3, "PVT")
    with pytest.raises(PermissionDenied):
        asv.start_assessment_session(conn, assignment["assignment_id"], actor_astronaut_id="AST-002",
                                     actor_user_id="USR-002")
    asv.start_assessment_session(conn, assignment["assignment_id"], actor_astronaut_id="AST-001",
                                 actor_user_id=CREW1)
    with pytest.raises(Conflict):
        asv.start_assessment_session(conn, assignment["assignment_id"], actor_astronaut_id="AST-001",
                                     actor_user_id=CREW1)


def test_seeded_demo_run_has_nothing_due(conn):
    sim.jump_to_mission_day(conn, "RUN-DEMO-001", 10, actor_user_id=LEADER, hour=8)
    assert asv.get_due_assessments(conn, "AST-001")["due"] == []  # all seeded tests are completed
