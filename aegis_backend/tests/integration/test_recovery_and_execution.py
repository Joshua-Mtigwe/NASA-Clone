"""Recovery planner (catalogue -> suggestion -> review -> booking -> outcome) and task execution tracking."""
import pytest

from app.core.errors import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services import mission_simulator as sim
from app.services import planning_effectiveness_service as pe
from app.services import recovery_service as rc
from app.services import schedule_service as ss
from app.services import scheduling_optimizer as so
from app.services import task_execution_service as te
from app.services.sleep_activity_service import get_astronaut_schedule
from app.utils.timestamps import parse_iso

LEADER = {"user_id": "USR-006", "role_name": "mission_leader"}
RESEARCHER = {"user_id": "USR-007", "role_name": "medical_researcher"}
OFFICER = {"user_id": "USR-008", "role_name": "medical_officer"}
DEMO = "RUN-DEMO-001"


def crew_user(n):
    return {"user_id": f"USR-00{n}", "role_name": "astronaut"}


def _jump(conn, day, hour):
    sim.jump_to_mission_day(conn, DEMO, day, actor_user_id="USR-006", hour=hour)


@pytest.fixture
def day10(conn):
    """Day 10, 10:00. In the seed AST-004 slept badly and AST-003 has a test below baseline."""
    _jump(conn, 10, 10)
    return conn


def _generate(conn, **kw):
    return rc.generate_recommendations(conn, actor_user_id="USR-008", **kw)


def _recs(result, astronaut_id):
    return next(a for a in result["astronauts"] if a["astronaut_id"] == astronaut_id)


# ------------------------------------------------------------------ catalogue and signals

def test_catalogue_lists_only_approved_by_default(conn):
    assert len(rc.list_activities(conn)) == 6
    conn.execute("UPDATE recovery_activities SET approval_status = 'withdrawn' WHERE recovery_activity_id = 'REC-002'")
    assert "REC-002" not in {a["recovery_activity_id"] for a in rc.list_activities(conn)}
    assert len(rc.list_activities(conn, include_unapproved=True)) == 6


def test_signals_compare_with_own_history_and_never_look_ahead(day10):
    ev = rc.collect_signals(day10, "AST-004", parse_iso("2027-03-10T10:00:00Z"))
    sleep = ev["signals"]["short_sleep"]
    assert sleep["active"] and sleep["z"] <= -1 and sleep["history_days"] == 9
    assert sleep["value"] < sleep["own_average"]
    # before the 08:00 tests nothing from today's tests or self-report is used
    early = rc.collect_signals(day10, "AST-004", parse_iso("2027-03-10T07:00:00Z"))
    assert "cognitive_dip" not in early["signals"] and "high_fatigue" not in early["signals"]


def test_no_signals_on_day_one(conn):
    _jump(conn, 1, 10)
    result = _generate(conn)
    assert all(not a["recommendations"] for a in result["astronauts"])
    assert "Nothing unusual" in result["astronauts"][0]["message"]


def test_rank_uses_only_approved_activities():
    evidence = {"active": ["short_sleep"], "signals": {"short_sleep": {"strength": 0.9}}}
    catalogue = [{"recovery_activity_id": "X1", "activity_name": "Wind down", "activity_category": "sleep",
                  "approval_status": "approved"},
                 {"recovery_activity_id": "X2", "activity_name": "Unapproved nap", "activity_category": "sleep",
                  "approval_status": "pending"},
                 {"recovery_activity_id": "X3", "activity_name": "Run", "activity_category": "exercise",
                  "approval_status": "approved"}]
    ranked = rc.rank_activities(catalogue, evidence)
    assert [r["recovery_activity_id"] for r in ranked] == ["X1"] and ranked[0]["score"] == 0.9
    assert "shorter sleep" in ranked[0]["reason"]


# ------------------------------------------------------------------ recommendations

def test_generate_stores_evidence_and_is_repeatable(day10):
    first = _generate(day10)
    a4 = _recs(first, "AST-004")
    assert a4["active_signals"] == ["high_fatigue", "short_sleep"]
    top = a4["recommendations"][0]
    assert top["activity_name"] == "Sleep preparation" and top["approval_status"] == "pending_review"
    assert top["algorithm_version"] == "rules_v1" and top["mission_day"] == 10 and not top["is_demo"]
    assert top["evidence"]["signals"]["short_sleep"]["active"] and top["simulation_run_id"] == DEMO
    assert _recs(first, "AST-001")["recommendations"] == []

    second = _generate(day10)  # replaces unreviewed suggestions instead of piling up
    strip = lambda r: [(x["recovery_activity_id"], x["recommendation_score"]) for x in r["recommendations"]]
    assert strip(_recs(second, "AST-004")) == strip(a4)
    stored = rc.list_recommendations(day10, ["AST-004"], mission_day=10, include_demo=False)
    assert len(stored) == len(a4["recommendations"])
    assert day10.execute("PRAGMA foreign_key_check").fetchall() == []


def test_regenerate_keeps_reviewed_recommendations(day10):
    top = _recs(_generate(day10), "AST-004")["recommendations"][0]
    rc.review_recommendation(day10, top["recommendation_id"], OFFICER, "approve", "fine")
    again = _recs(_generate(day10), "AST-004")
    assert top["recovery_activity_id"] not in {r["recovery_activity_id"] for r in again["recommendations"]}
    kept = rc.get_recommendation(day10, top["recommendation_id"])
    assert kept["approval_status"] == "approved" and kept["reviewed_by_user_id"] == "USR-008"
    assert kept["review_comment"] == "fine"


def test_review_rules(day10):
    rec = _recs(_generate(day10), "AST-004")["recommendations"][0]["recommendation_id"]
    with pytest.raises(PermissionDenied):
        rc.review_recommendation(day10, rec, LEADER, "approve")
    with pytest.raises(Conflict, match="fictional"):
        rc.review_recommendation(day10, "RCR-AST-001-001", OFFICER, "approve")
    assert rc.review_recommendation(day10, rec, OFFICER, "reject")["approval_status"] == "rejected"
    with pytest.raises(Conflict):
        rc.review_recommendation(day10, rec, OFFICER, "approve")
    with pytest.raises(NotFound):
        rc.review_recommendation(day10, "RCR-NOPE", OFFICER, "approve")


def test_suggestions_belong_to_their_simulation_run(day10):
    _generate(day10)
    other = sim.create_simulation_run(day10, mission_id="MIS-001", run_name="r", actor_user_id="USR-006")
    assert rc.list_recommendations(day10, ["AST-004"], simulation_run_id=other["simulation_run_id"]) == []
    assert rc.list_recommendations(day10, ["AST-004"], mission_day=10, include_demo=False)


# ------------------------------------------------------------------ booking and outcome

@pytest.fixture
def approved(day10):
    rec = _recs(_generate(day10), "AST-004")["recommendations"][0]
    rc.review_recommendation(day10, rec["recommendation_id"], OFFICER, "approve")
    return rec["recommendation_id"]


def test_booking_refuses_overlaps_and_past_times(day10, approved):
    with pytest.raises(Conflict, match="only an approved"):
        other = _recs(_generate(day10), "AST-004")["recommendations"][0]["recommendation_id"]
        rc.schedule_recommendation(day10, other, OFFICER, parse_iso("2027-03-10T14:00:00Z"))
    with pytest.raises(ValidationFailed, match="past"):
        rc.schedule_recommendation(day10, approved, OFFICER, parse_iso("2027-03-10T09:00:00Z"))
    with pytest.raises(Conflict) as exc:  # 11:00-11:40 is scheduled exercise
        rc.schedule_recommendation(day10, approved, OFFICER, parse_iso("2027-03-10T11:30:00Z"))
    assert any("exercise" in c for c in exc.value.details)
    with pytest.raises(Conflict) as exc:  # the seeded 16:00 recovery and sleep
        rc.schedule_recommendation(day10, approved, OFFICER, parse_iso("2027-03-10T16:00:00Z"))
    assert any("sleep" in c or "recovery" in c for c in exc.value.details)
    with pytest.raises(PermissionDenied):
        rc.schedule_recommendation(day10, approved, LEADER, parse_iso("2027-03-10T14:00:00Z"))


def test_book_then_complete(day10, approved):
    booking = rc.schedule_recommendation(day10, approved, OFFICER, parse_iso("2027-03-10T14:00:00Z"))
    assert booking["completion_status"] == "planned" and booking["scheduled_end"] == "2027-03-10T14:20:00Z"
    assert booking["recommendation_id"] == approved and not booking["is_demo"]
    with pytest.raises(Conflict, match="Already booked"):
        rc.schedule_recommendation(day10, approved, OFFICER, parse_iso("2027-03-10T15:00:00Z"))
    # it is on the astronaut's calendar and blocks the task scheduler
    calendar = get_astronaut_schedule(day10, "AST-004", parse_iso("2027-03-10"))
    assert booking["scheduled_recovery_id"] in {r["scheduled_recovery_id"] for r in calendar["recovery"]}
    blocks = so._blocked_intervals(day10, "AST-004", "2027-03-10", parse_iso("2027-03-10"), 9)
    assert [14 * 60, 14 * 60 + 20, "recovery"] in blocks

    sid = booking["scheduled_recovery_id"]
    with pytest.raises(PermissionDenied):
        rc.record_recovery_outcome(day10, sid, crew_user(1), "completed")  # someone else's
    with pytest.raises(PermissionDenied):
        rc.record_recovery_outcome(day10, sid, LEADER, "completed")
    with pytest.raises(ValidationFailed, match="future"):
        rc.record_recovery_outcome(day10, sid, crew_user(4), "completed", at=parse_iso("2027-03-10T14:20:00Z"))
    _jump(day10, 10, 15)
    done = rc.record_recovery_outcome(day10, sid, crew_user(4), "completed", "Felt calmer",
                                      parse_iso("2027-03-10T14:21:00Z"))
    assert done["completion_status"] == "completed" and done["completed_at"] == "2027-03-10T14:21:00Z"
    assert done["astronaut_feedback"] == "Felt calmer"
    with pytest.raises(Conflict):
        rc.record_recovery_outcome(day10, sid, OFFICER, "skipped")
    audit = day10.execute("SELECT user_id FROM audit_logs WHERE entity_id = ? AND action_type = 'recovery_completed'",
                          (sid,)).fetchone()
    assert audit["user_id"] == "USR-004"


def test_skip_and_demo_bookings(day10, approved):
    sid = rc.schedule_recommendation(day10, approved, OFFICER, parse_iso("2027-03-10T14:00:00Z"))[
        "scheduled_recovery_id"]
    skipped = rc.record_recovery_outcome(day10, sid, OFFICER, "skipped", "Task overran")
    assert skipped["completion_status"] == "skipped" and skipped["completed_at"] is None
    # a skipped slot is free again
    assert rc.find_conflicts(day10, "AST-004", parse_iso("2027-03-10T14:00:00Z"),
                             parse_iso("2027-03-10T14:20:00Z"), DEMO) == []
    with pytest.raises(Conflict, match="fictional"):
        rc.record_recovery_outcome(day10, "SRC-AST-001-010", crew_user(1), "completed")
    mine = rc.list_bookings(day10, ["AST-004"], date="2027-03-10")
    assert {b["completion_status"] for b in mine} == {"planned", "skipped"}


# ------------------------------------------------------------------ task execution

@pytest.fixture
def published(conn):
    """Day 10 planned, approved and published on the demo run; clock at 09:00."""
    plan = so.plan_task_set(conn, task_set_id="SET-010", simulation_run_id=DEMO, actor_user_id="USR-006",
                            solver="builtin")
    vid = plan["schedule_version_id"]
    ss.approve_schedule_version(conn, vid, LEADER)
    version = ss.publish_approved_schedule(conn, vid, LEADER)
    _jump(conn, 10, 9)
    return sorted(version["assignments"], key=lambda a: a["planned_start"])


def _user_for(conn, astronaut_id):
    row = conn.execute("SELECT user_id FROM astronauts WHERE astronaut_id = ?", (astronaut_id,)).fetchone()
    return {"user_id": row["user_id"], "role_name": "astronaut"}


def test_start_and_complete_a_published_task(conn, published):
    first = published[0]
    aid, me = first["task_assignment_id"], _user_for(conn, first["astronaut_id"])
    someone_else = next(crew_user(n) for n in range(1, 6) if crew_user(n)["user_id"] != me["user_id"])
    with pytest.raises(PermissionDenied):
        te.start_assignment(conn, aid, someone_else)
    with pytest.raises(PermissionDenied):
        te.start_assignment(conn, aid, OFFICER)
    with pytest.raises(Conflict, match="start it"):
        te.complete_assignment(conn, aid, me)
    with pytest.raises(ValidationFailed, match="future"):
        te.start_assignment(conn, aid, me, parse_iso("2027-03-10T12:00:00Z"))

    started = te.start_assignment(conn, aid, me)
    assert started["assignment_status"] == "in_progress" and started["actual_start"] == "2027-03-10T09:00:00Z"
    with pytest.raises(Conflict):
        te.start_assignment(conn, aid, me)
    _jump(conn, 10, 11)
    with pytest.raises(ValidationFailed, match="before it started"):
        te.complete_assignment(conn, aid, me, parse_iso("2027-03-10T08:59:00Z"))
    done = te.complete_assignment(conn, aid, me, parse_iso("2027-03-10T09:50:00Z"))
    assert done["assignment_status"] == "completed" and done["actual_end"] == "2027-03-10T09:50:00Z"
    actions = [r[0] for r in conn.execute(
        "SELECT action_type FROM audit_logs WHERE entity_id = ? ORDER BY rowid", (aid,))]
    assert actions == ["task_started", "task_completed"]
    listed = te.list_assignments(conn, [first["astronaut_id"]], simulation_run_id=DEMO, date="2027-03-10",
                                 assignment_status="completed")
    assert [a["task_assignment_id"] for a in listed] == [aid]


def test_task_waits_for_its_dependencies(conn, published):
    if len(published) < 2:
        pytest.skip("plan has a single task")
    second = published[1]
    with pytest.raises(Conflict, match="depends on"):
        te.start_assignment(conn, second["task_assignment_id"], LEADER)
    te.start_assignment(conn, published[0]["task_assignment_id"], LEADER)
    _jump(conn, 10, 12)
    te.complete_assignment(conn, published[0]["task_assignment_id"], LEADER, parse_iso("2027-03-10T09:45:00Z"))
    assert te.start_assignment(conn, second["task_assignment_id"], LEADER)["assignment_status"] == "in_progress"


def test_skip_needs_a_reason_and_demo_plans_cannot_be_recorded(conn, published):
    aid = published[0]["task_assignment_id"]
    with pytest.raises(ValidationFailed):
        te.skip_assignment(conn, aid, LEADER, "  ")
    assert te.skip_assignment(conn, aid, LEADER, "Equipment fault")["assignment_status"] == "skipped"
    with pytest.raises(Conflict):
        te.start_assignment(conn, aid, LEADER)
    with pytest.raises(Conflict, match="fictional"):
        te.start_assignment(conn, "TA-010-01", LEADER)
    with pytest.raises(NotFound):
        te.start_assignment(conn, "TA-NOPE", LEADER)


def test_task_cannot_be_recorded_on_another_day(conn, published):
    _jump(conn, 11, 9)
    with pytest.raises(ValidationFailed, match="planned for 2027-03-10"):
        te.start_assignment(conn, published[0]["task_assignment_id"], LEADER)


def test_started_plan_cannot_be_replaced(conn, published):
    te.start_assignment(conn, published[0]["task_assignment_id"], LEADER)
    newer = so.plan_task_set(conn, task_set_id="SET-010", simulation_run_id=DEMO, actor_user_id="USR-006",
                             solver="builtin", workday_start_hour=10)
    with pytest.raises(Conflict, match="already started"):
        ss.approve_schedule_version(conn, newer["schedule_version_id"], LEADER)


def test_recorded_work_feeds_planning_effectiveness(conn, published):
    te.start_assignment(conn, published[0]["task_assignment_id"], LEADER)
    _jump(conn, 10, 15)
    te.complete_assignment(conn, published[0]["task_assignment_id"], LEADER, parse_iso("2027-03-10T09:45:00Z"))
    rec = _recs(_generate(conn), "AST-004")["recommendations"][0]["recommendation_id"]
    rc.review_recommendation(conn, rec, OFFICER, "approve")
    sid = rc.schedule_recommendation(conn, rec, OFFICER, parse_iso("2027-03-10T15:30:00Z"))["scheduled_recovery_id"]
    _jump(conn, 10, 16)
    rc.record_recovery_outcome(conn, sid, crew_user(4), "completed")
    rows = pe.evaluate_planning_effectiveness(conn, actor_user_id="USR-007", period_start="2027-03-10",
                                              period_end="2027-03-10")["evaluations"]
    optimizer = next(r for r in rows if r["planning_method"] == "optimizer")
    assert optimizer["task_completion_rate"] == round(1 / len(published), 4)
    assert optimizer["schedule_adherence_rate"] == 1.0
    assert optimizer["recovery_adherence_rate"] == 1.0  # the seed's fictional bookings are not counted here
    demo = next(r for r in rows if r["planning_method"] == "preloaded_demo")
    assert demo["recovery_adherence_rate"] is None and demo["task_completion_rate"] is None
