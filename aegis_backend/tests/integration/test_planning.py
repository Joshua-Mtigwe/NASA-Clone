"""Phase 4 acceptance: unverified safety-critical certification blocked; no overlaps.
Plus: dependencies, deadlines, workload, explanations, versioned approval."""
import pytest

from app.core.errors import Conflict, PermissionDenied, ValidationFailed
from app.services import crew_readiness_service as rd
from app.services import mission_simulator as sim
from app.services import schedule_service as ss
from app.services import scheduling_optimizer as so
from app.services import task_service as ts
from app.utils.timestamps import parse_iso

LEADER = {"user_id": "USR-006", "role_name": "mission_leader"}
OFFICER = {"user_id": "USR-008", "role_name": "medical_officer"}
DAY1_09 = parse_iso("2027-03-01T09:00:00Z")


@pytest.fixture
def run_id(conn):
    return sim.create_simulation_run(conn, mission_id="MIS-001", run_name="plan", actor_user_id="USR-006")[
        "simulation_run_id"]


def _plan(conn, run_id, task_set="SET-001", **kw):
    return so.plan_task_set(conn, task_set_id=task_set, simulation_run_id=run_id, actor_user_id="USR-006",
                            solver="builtin", **kw)


def _assert_hard_rules(conn, problem, assignments):
    """Independent check of every hard constraint on a solver result."""
    tasks = {t["task_id"]: t for t in problem["tasks"]}
    crew = {a["astronaut_id"]: a for a in problem["astronauts"]}
    by_task = {a["task_id"]: a for a in assignments}
    per_astronaut: dict[str, list] = {}
    for a in assignments:
        t = tasks[a["task_id"]]
        assert a["end"] - a["start"] == t["duration"]
        assert a["end"] <= t["deadline"]
        assert len(a["astronaut_ids"]) == t["crew_count"]
        for d in t["depends_on"]:
            assert d in by_task and by_task[d]["end"] <= a["start"]
        for x in a["astronaut_ids"]:
            assert x in problem["eligible"][a["task_id"]]
            per_astronaut.setdefault(x, []).append((a["start"], a["end"]))
    for x, spans in per_astronaut.items():
        ordered = sorted(spans)
        for (s1, e1), (s2, e2) in zip(ordered, ordered[1:]):
            assert s2 >= e1, f"{x}: two tasks overlap"
        for s, e in spans:  # commitments may overlap each other in the seed, but never a task
            for bs, be, label in crew[x]["blocked"]:
                assert e <= bs or s >= be, f"{x}: task overlaps {label}"
        assert sum(e - s for s, e in spans) <= crew[x]["workload_limit"]


# --------------------------------------------------------------------------- tasks

def test_task_sets_and_dependency_order(conn):
    sets = ts.get_available_task_sets(conn, from_day=1, to_day=3)
    assert [s["task_set_id"] for s in sets] == ["SET-001", "SET-002", "SET-003"]
    assert all(s["task_count"] == 7 for s in sets)
    payload = ts.get_task_planning_payload(conn, "SET-001")
    assert payload["dependency_order"] == [f"TSK-001-0{i}" for i in range(1, 8)]


def test_dependency_cycle_is_rejected():
    tasks = [{"task_id": "A", "depends_on": ["B"]}, {"task_id": "B", "depends_on": ["A"]}]
    with pytest.raises(ValidationFailed):
        ts.validate_task_dependencies(tasks)
    with pytest.raises(ValidationFailed):
        ts.validate_task_dependencies([{"task_id": "A", "depends_on": ["Z"]}])


# --------------------------------------------------------------------------- eligibility

def test_demo_qualification_accepted_for_standard_task_with_flag(conn):
    task = ts.get_tasks_for_task_set(conn, "SET-001")[0]  # Systems status check, standard_demo
    result = rd.check_task_eligibility(conn, "AST-001", task, DAY1_09)
    assert result["eligible"] and "qualification_not_verified" in result["flags"]
    assert not rd.check_task_eligibility(conn, "AST-002", task, DAY1_09)["eligible"]  # wrong certification


def test_unverified_qualification_blocked_for_safety_critical(conn):
    """Plan acceptance: an unverified safety-critical certification is blocked."""
    conn.execute("UPDATE task_requirements SET safety_classification = 'safety_critical' WHERE task_id = 'TSK-001-01'")
    conn.commit()
    task = ts.get_tasks_for_task_set(conn, "SET-001")[0]
    result = rd.check_task_eligibility(conn, "AST-001", task, DAY1_09)
    assert not result["eligible"] and result["qualification_status"] == "unverified_for_safety_critical"
    conn.execute("UPDATE astronaut_qualifications SET authorization_status = 'verified' WHERE astronaut_id = 'AST-001'")
    conn.commit()
    assert rd.check_task_eligibility(conn, "AST-001", task, DAY1_09)["eligible"]


def test_unknown_safety_class_fails_closed(conn):
    conn.execute("UPDATE task_requirements SET safety_classification = 'something_new' WHERE task_id = 'TSK-001-01'")
    conn.commit()
    task = ts.get_tasks_for_task_set(conn, "SET-001")[0]
    assert rd.is_safety_critical(task)
    assert not rd.check_task_eligibility(conn, "AST-001", task, DAY1_09)["eligible"]


def test_readiness_and_restrictions(conn):
    task = ts.get_tasks_for_task_set(conn, "SET-001")[0]
    conn.execute("UPDATE crew_readiness SET operational_eligibility_status = 'not_eligible' "
                 "WHERE readiness_id = 'RDY-AST-001-001'")
    conn.commit()
    assert "Readiness status is not_eligible" in rd.check_task_eligibility(conn, "AST-001", task, DAY1_09)["reasons"]
    conn.execute("UPDATE crew_readiness SET operational_eligibility_status = 'demo_eligible', "
                 "restriction_codes = 'mystery_code' WHERE readiness_id = 'RDY-AST-001-001'")
    conn.commit()
    reasons = rd.check_task_eligibility(conn, "AST-001", task, DAY1_09)["reasons"]
    assert any("Unrecognised restriction" in r for r in reasons)
    assert rd.get_latest_valid_readiness(conn, "AST-001", parse_iso("2027-06-30T09:00:00Z")) is None


def test_task_with_no_eligible_astronaut_is_explained(conn, run_id):
    conn.execute("UPDATE crew_readiness SET operational_eligibility_status = 'not_eligible' "
                 "WHERE readiness_id = 'RDY-AST-001-001'")
    conn.commit()
    result = _plan(conn, run_id)
    first = next(u for u in result["unscheduled"] if u["task_id"] == "TSK-001-01")
    assert first["reasons"][0] == "No eligible astronaut"
    assert any("not_eligible" in r for r in first["reasons"])
    assert result["scheduled"] == []  # everything else depends on task 1
    assert result["schedule_version_id"] is None


# --------------------------------------------------------------------------- solver

def test_day1_plan_obeys_every_hard_rule(conn, run_id):
    """Plan acceptance: no overlaps (plus dependencies, deadlines, workload)."""
    problem = so.build_scheduling_problem(conn, "SET-001", run_id)
    result = so.solve_schedule(problem, "builtin")
    _assert_hard_rules(conn, problem, result["assignments"])
    assert [a["task_id"] for a in result["assignments"]] == ["TSK-001-01", "TSK-001-02", "TSK-001-03", "TSK-001-04"]
    reasons = {u["task_id"]: u["reasons"] for u in result["unscheduled"]}
    assert "protected sleep" in reasons["TSK-001-05"][0]
    assert reasons["TSK-001-06"] == ["Waits for TSK-001-05, which could not be scheduled"]


@pytest.mark.parametrize("day", [1, 17, 45, 62, 90])
def test_hard_rules_hold_across_the_mission(conn, run_id, day):
    problem = so.build_scheduling_problem(conn, f"SET-{day:03d}", run_id)
    result = so.solve_schedule(problem, "builtin")
    assert result["assignments"]
    _assert_hard_rules(conn, problem, result["assignments"])


def test_exercise_block_is_respected(conn, run_id):
    problem = so.build_scheduling_problem(conn, "SET-001", run_id)
    plant = next(a for a in so.solve_schedule(problem, "builtin")["assignments"] if a["task_id"] == "TSK-001-02")
    assert plant["start"] == 11 * 60 + 40  # 90-minute task cannot fit 09:45-11:00, so after exercise ends 11:40


def test_earlier_workday_fits_more(conn, run_id):
    nine = so.solve_schedule(so.build_scheduling_problem(conn, "SET-001", run_id), "builtin")
    six = so.solve_schedule(so.build_scheduling_problem(conn, "SET-001", run_id, workday_start_hour=6), "builtin")
    assert len(six["assignments"]) > len(nine["assignments"])


def test_full_coverage_is_infeasible_not_relaxed(conn, run_id):
    result = _plan(conn, run_id, require_full_coverage=True)
    assert result["status"] == "infeasible" and result["scheduled"] == [] and result["schedule_version_id"] is None
    run = so.get_optimization_run(conn, result["optimization_run_id"])
    assert run["status"] == "infeasible" and run["unscheduled"]


def test_workload_limit_is_hard(conn, run_id):
    conn.execute("UPDATE crew_readiness SET workload_limit_minutes = 30 WHERE readiness_id = 'RDY-AST-001-001'")
    conn.commit()
    result = _plan(conn, run_id)
    assert result["scheduled"] == []
    assert any("workload limit of 30" in r for r in result["unscheduled"][0]["reasons"])


def test_cognitive_flag_is_a_soft_preference(conn, run_id):
    """With two qualified astronauts, a demanding task goes to the one without a worse-than-usual result."""
    conn.execute("INSERT INTO astronaut_qualifications VALUES ('QUAL-T1', 'AST-002', 'SIM_CERT_FLIGHT', "
                 "'demo_assumed_not_verified', '2027-02-01', '2027-06-30', NULL, 'test')")
    conn.commit()
    problem = so.build_scheduling_problem(conn, "SET-001", run_id, workday_start_hour=6)
    problem["astronauts"] = [{**a, "cognitive_flags": ["PVT"]} if a["astronaut_id"] == "AST-003" else a
                             for a in problem["astronauts"]]
    problem["penalties"]["TSK-001-04"] = {"AST-003": 1, "AST-002": 0}  # Navigation review, cognitive demand 5
    nav = next(a for a in so.solve_schedule(problem, "builtin")["assignments"] if a["task_id"] == "TSK-001-04")
    assert nav["astronaut_ids"] == ["AST-002"]


def test_problem_hash_is_reproducible(conn, run_id):
    a = so.build_scheduling_problem(conn, "SET-010", run_id)
    b = so.build_scheduling_problem(conn, "SET-010", run_id)
    assert a["input_hash"] == b["input_hash"]
    assert so.solve_schedule(a, "builtin")["assignments"] == so.solve_schedule(b, "builtin")["assignments"]


def test_cp_sat_matches_builtin(conn, run_id):
    pytest.importorskip("ortools")
    for day in (1, 30, 77):
        problem = so.build_scheduling_problem(conn, f"SET-{day:03d}", run_id)
        cp = so.solve_schedule(problem, "cp-sat")
        builtin = so.solve_schedule(problem, "builtin")
        _assert_hard_rules(conn, problem, cp["assignments"])
        assert cp["score"]["objective"] == builtin["score"]["objective"]


def test_cp_sat_refused_when_not_installed(conn, run_id):
    if so.ortools_available():
        pytest.skip("OR-Tools is installed")
    with pytest.raises(ValidationFailed):
        so.solve_schedule(so.build_scheduling_problem(conn, "SET-001", run_id), "cp-sat")


# --------------------------------------------------------------------------- versions and approval

def test_draft_records(conn, run_id):
    result = _plan(conn, run_id)
    version = ss.get_schedule_version(conn, result["schedule_version_id"])
    assert version["status"] == "draft" and version["version_number"] == 1
    assert len(version["assignments"]) == len(result["scheduled"])
    a = version["assignments"][0]
    assert a["approval_status"] == "pending_approval" and a["simulation_run_id"] == run_id
    rec = conn.execute("SELECT * FROM ai_task_recommendations WHERE recommendation_id = ?",
                       (a["recommendation_id"],)).fetchone()
    assert rec["recommendation_status"] == "proposed" and rec["constraint_check_status"] == "passed"
    assert "not verified" in rec["recommendation_reason"]


def test_approve_publish_and_supersede(conn, run_id):
    first = ss.approve_schedule_version(conn, _plan(conn, run_id)["schedule_version_id"], LEADER)
    assert first["status"] == "approved"
    published = ss.publish_approved_schedule(conn, first["schedule_version_id"], LEADER)
    assert published["status"] == "published"
    calendar = conn.execute("SELECT COUNT(*) FROM daily_schedules WHERE schedule_version_id = ? "
                            "AND activity_type = 'task'", (first["schedule_version_id"],)).fetchone()[0]
    assert calendar == len(first["assignments"])

    second = _plan(conn, run_id, workday_start_hour=6)
    assert ss.get_schedule_version(conn, second["schedule_version_id"])["version_number"] == 2
    ss.approve_schedule_version(conn, second["schedule_version_id"], LEADER)
    assert ss.get_schedule_version(conn, first["schedule_version_id"])["status"] == "superseded"
    status = conn.execute("SELECT DISTINCT schedule_status FROM daily_schedules WHERE schedule_version_id = ?",
                          (first["schedule_version_id"],)).fetchall()
    assert [r[0] for r in status] == ["superseded"]


def test_only_mission_leader_approves(conn, run_id):
    version_id = _plan(conn, run_id)["schedule_version_id"]
    with pytest.raises(PermissionDenied):
        ss.approve_schedule_version(conn, version_id, OFFICER)


def test_approval_rechecks_safety(conn, run_id):
    version_id = _plan(conn, run_id)["schedule_version_id"]
    # After the draft was made, AST-001 is marked not eligible.
    conn.execute("UPDATE crew_readiness SET operational_eligibility_status = 'not_eligible' "
                 "WHERE readiness_id = 'RDY-AST-001-001'")
    conn.commit()
    with pytest.raises(Conflict) as err:
        ss.approve_schedule_version(conn, version_id, LEADER)
    assert any("no longer eligible" in p for p in err.value.details)
    assert ss.get_schedule_version(conn, version_id)["status"] == "draft"
    denied = conn.execute("SELECT action_result FROM audit_logs WHERE action_type = 'approve_schedule_version'"
                          ).fetchone()[0]
    assert denied == "denied"


def test_approval_catches_tampered_overlap(conn, run_id):
    version = ss.get_schedule_version(conn, _plan(conn, run_id)["schedule_version_id"])
    a = version["assignments"][0]
    conn.execute("UPDATE task_assignments SET planned_start = '2027-03-01T11:00:00Z', "
                 "planned_end = '2027-03-01T11:45:00Z' WHERE task_assignment_id = ?", (a["task_assignment_id"],))
    conn.commit()
    problems = ss.validate_schedule_version(conn, ss.get_schedule_version(conn, version["schedule_version_id"]))
    assert any("overlaps scheduled_exercise" in p for p in problems)


def test_state_transitions(conn, run_id):
    version_id = _plan(conn, run_id)["schedule_version_id"]
    with pytest.raises(Conflict):
        ss.publish_approved_schedule(conn, version_id, LEADER)  # not approved yet
    ss.reject_schedule_version(conn, version_id, LEADER, "testing")
    with pytest.raises(Conflict):
        ss.approve_schedule_version(conn, version_id, LEADER)  # rejected is final
    with pytest.raises(Conflict):
        ss.approve_schedule_version(conn, "SV-DEMO-001", LEADER)  # seed demo schedule


def test_astronaut_schedule_hides_rejected_versions(conn, run_id):
    from app.services.sleep_activity_service import get_astronaut_schedule

    version_id = _plan(conn, run_id)["schedule_version_id"]
    day = parse_iso("2027-03-01")
    before = len(get_astronaut_schedule(conn, "AST-001", day)["task_assignments"])
    ss.reject_schedule_version(conn, version_id, LEADER)
    after = len(get_astronaut_schedule(conn, "AST-001", day)["task_assignments"])
    assert after < before
