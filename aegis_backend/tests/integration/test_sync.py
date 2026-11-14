"""Phase 7 acceptance: conflicts never silently overwrite records.
Plus ordering, idempotent resends, blocked follow-ups, resolution and permissions."""
import pytest

from app.core.errors import Conflict, PermissionDenied, ValidationFailed
from app.services import mission_simulator as sim
from app.services import recovery_service as rc
from app.services import schedule_service as ss
from app.services import scheduling_optimizer as so
from app.services import sync_service as sy
from app.services import task_execution_service as te
from app.utils.timestamps import parse_iso

LEADER = {"user_id": "USR-006", "role_name": "mission_leader", "account_status": "active"}
OFFICER = {"user_id": "USR-008", "role_name": "medical_officer", "account_status": "active"}
DAY = "2027-03-02"


def crew(astronaut_id):
    return {"user_id": f"USR-00{astronaut_id[-1]}", "role_name": "astronaut", "account_status": "active"}


@pytest.fixture
def published(conn):
    """A published plan for day 2 in a new run, with the run's clock at 15:00 that day."""
    run = sim.create_simulation_run(conn, mission_id="MIS-001", run_name="sync", actor_user_id="USR-006")[
        "simulation_run_id"]
    plan = so.plan_task_set(conn, task_set_id="SET-002", simulation_run_id=run, actor_user_id="USR-006",
                            solver="builtin")
    ss.approve_schedule_version(conn, plan["schedule_version_id"], LEADER)
    ss.publish_approved_schedule(conn, plan["schedule_version_id"], LEADER)
    sim.jump_to_mission_day(conn, run, 2, actor_user_id="USR-006", hour=15)
    return {"run": run, "plan": plan}


def _task(conn, published, index=0):
    """(astronaut_id, pulled record) for the index-th scheduled task."""
    item = published["plan"]["scheduled"][index]
    astronaut = item["astronaut_ids"][0]
    pulled = sy.pull_records(conn, astronaut, simulation_run_id=published["run"], date=DAY)["task_assignment"]
    return astronaut, next(t for t in pulled if t["task_id"] == item["task_id"])


def _event(cid, record, action, at, base=True, **payload):
    return {"client_event_id": cid, "entity_type": "task_assignment", "entity_id": record["task_assignment_id"],
            "action": action, "at": at, "base_version": record["sync_version"] if base else None, "payload": payload}


def _outcomes(result):
    return {o["client_event_id"]: o for o in result["outcomes"]}


# --------------------------------------------------------------------------- versions and pull

def test_version_changes_with_the_record(conn, published):
    astronaut, record = _task(conn, published)
    before = record["sync_version"]
    assert sy.load_record(conn, "task_assignment", record["task_assignment_id"])["sync_version"] == before
    te.start_assignment(conn, record["task_assignment_id"], LEADER, parse_iso(f"{DAY}T09:00:00Z"))
    assert sy.load_record(conn, "task_assignment", record["task_assignment_id"])["sync_version"] != before


def test_pull_returns_only_published_tasks_with_versions(conn, published):
    astronaut, _ = _task(conn, published)
    pulled = sy.pull_records(conn, astronaut, simulation_run_id=published["run"], date=DAY)
    assert pulled["task_assignment"] and all(t["version_status"] == "published" for t in pulled["task_assignment"])
    assert all(len(t["sync_version"]) == 16 for t in pulled["task_assignment"])


# --------------------------------------------------------------------------- clean replay

def test_offline_start_then_complete_applies_in_order(conn, published):
    astronaut, record = _task(conn, published)
    result = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut), events=[
        _event("e1", record, "start", f"{DAY}T09:03:00Z"),
        _event("e2", record, "complete", f"{DAY}T09:58:00Z", base=False)])  # builds on e1
    out = _outcomes(result)
    assert out["e1"]["status"] == out["e2"]["status"] == "applied"
    final = te.get_assignment(conn, record["task_assignment_id"])
    assert final["assignment_status"] == "completed"
    assert final["actual_start"] == f"{DAY}T09:03:00Z" and final["actual_end"] == f"{DAY}T09:58:00Z"


def test_resending_a_batch_applies_nothing_twice(conn, published):
    astronaut, record = _task(conn, published)
    events = [_event("e1", record, "start", f"{DAY}T09:03:00Z")]
    sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut), events=events)
    again = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut), events=events)
    assert again["outcomes"][0]["resent"] is True and again["outcomes"][0]["status"] == "applied"
    assert conn.execute("SELECT COUNT(*) FROM sync_events").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM audit_logs WHERE action_type = 'task_started'").fetchone()[0] == 1


def test_same_change_already_on_server_is_a_duplicate(conn, published):
    astronaut, record = _task(conn, published)
    te.start_assignment(conn, record["task_assignment_id"], crew(astronaut), parse_iso(f"{DAY}T09:03:00Z"))
    out = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                          events=[_event("e1", record, "start", f"{DAY}T09:03:00Z")])["outcomes"][0]
    assert out["status"] == "duplicate" and out["conflict_id"] is None


# --------------------------------------------------------------------------- conflicts (acceptance)

def test_conflict_never_overwrites(conn, published):
    """Plan acceptance: the server's newer change is kept; the device's action waits for a person."""
    astronaut, record = _task(conn, published)
    te.start_assignment(conn, record["task_assignment_id"], LEADER, parse_iso(f"{DAY}T09:00:00Z"))
    server = te.get_assignment(conn, record["task_assignment_id"])
    out = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                          events=[_event("e1", record, "start", f"{DAY}T09:20:00Z")])["outcomes"][0]
    assert out["status"] == "conflict" and out["conflict_id"]
    assert te.get_assignment(conn, record["task_assignment_id"]) == server  # untouched
    conflict = sy.get_sync_conflict(conn, out["conflict_id"])
    assert conflict["resolution_status"] == "open"
    assert conflict["local_version"]["at"] == f"{DAY}T09:20:00Z"
    assert conflict["remote_version"]["record"]["actual_start"] == f"{DAY}T09:00:00Z"


def test_follow_up_waits_then_applies_after_resolution(conn, published):
    astronaut, record = _task(conn, published)
    te.start_assignment(conn, record["task_assignment_id"], LEADER, parse_iso(f"{DAY}T09:00:00Z"))
    out = _outcomes(sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut), events=[
        _event("e1", record, "start", f"{DAY}T09:20:00Z"),
        _event("e2", record, "complete", f"{DAY}T10:30:00Z", base=False)]))
    assert out["e1"]["status"] == "conflict" and out["e2"]["status"] == "blocked"
    assert te.get_assignment(conn, record["task_assignment_id"])["assignment_status"] == "in_progress"

    resolved = sy.resolve_sync_conflict(conn, out["e1"]["conflict_id"], LEADER, "keep_server",
                                        "Started from the habitat console at 09:00")
    assert resolved["resolution_status"] == "kept_server" and resolved["released_events"] == 1
    assert sy.get_sync_event(conn, out["e1"]["sync_id"])["sync_status"] == "discarded"
    assert sy.get_sync_event(conn, out["e2"]["sync_id"])["sync_status"] == "applied"
    final = te.get_assignment(conn, record["task_assignment_id"])
    assert final["actual_start"] == f"{DAY}T09:00:00Z" and final["actual_end"] == f"{DAY}T10:30:00Z"


def test_reapply_goes_through_the_normal_rules(conn, published):
    astronaut, record = _task(conn, published)
    te.start_assignment(conn, record["task_assignment_id"], LEADER, parse_iso(f"{DAY}T09:00:00Z"))
    cid = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                          events=[_event("e1", record, "start", f"{DAY}T09:20:00Z")])["outcomes"][0]["conflict_id"]
    with pytest.raises(Conflict, match="normal rules"):  # it is already started; starting again is refused
        sy.resolve_sync_conflict(conn, cid, LEADER, "reapply", "try the device time")
    assert sy.get_sync_conflict(conn, cid)["resolution_status"] == "open"


def test_reapply_succeeds_when_still_valid(conn, published):
    """The device's 'skip' (with a reason) conflicts only because its copy was out of date; after a
    person checks it, reapplying succeeds because skipping is still allowed by the normal rules."""
    astronaut, record = _task(conn, published, index=1)
    stale = dict(record, sync_version="0000000000000000")  # the device held an older copy of this record
    cid = sy.upload_batch(conn, device_id="tab-2", user=crew(astronaut),
                          events=[_event("s1", stale, "skip", f"{DAY}T12:00:00Z", reason="unwell")])["outcomes"][0][
        "conflict_id"]
    resolved = sy.resolve_sync_conflict(conn, cid, LEADER, "reapply", "Confirmed with the crew member")
    assert resolved["resolution_status"] == "applied_after_review"
    assert te.get_assignment(conn, record["task_assignment_id"])["assignment_status"] == "skipped"


def test_resolution_refused_if_record_changed_again(conn, published):
    astronaut, record = _task(conn, published)
    te.start_assignment(conn, record["task_assignment_id"], LEADER, parse_iso(f"{DAY}T09:00:00Z"))
    cid = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                          events=[_event("e1", record, "start", f"{DAY}T09:20:00Z")])["outcomes"][0]["conflict_id"]
    te.complete_assignment(conn, record["task_assignment_id"], LEADER, parse_iso(f"{DAY}T10:00:00Z"))
    with pytest.raises(Conflict, match="changed again"):
        sy.resolve_sync_conflict(conn, cid, LEADER, "keep_server", "ok")
    refreshed = sy.get_sync_conflict(conn, cid)
    assert refreshed["remote_version"]["record"]["assignment_status"] == "completed"  # now shows the latest
    assert sy.resolve_sync_conflict(conn, cid, LEADER, "keep_server", "seen latest")["resolution_status"] == \
        "kept_server"


def test_resolution_rules(conn, published):
    astronaut, record = _task(conn, published)
    te.start_assignment(conn, record["task_assignment_id"], LEADER, parse_iso(f"{DAY}T09:00:00Z"))
    cid = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                          events=[_event("e1", record, "start", f"{DAY}T09:20:00Z")])["outcomes"][0]["conflict_id"]
    with pytest.raises(PermissionDenied):
        sy.resolve_sync_conflict(conn, cid, crew(astronaut), "keep_server", "mine")
    with pytest.raises(ValidationFailed):
        sy.resolve_sync_conflict(conn, cid, LEADER, "keep_server", " ")
    sy.resolve_sync_conflict(conn, cid, LEADER, "keep_server", "ok")
    with pytest.raises(Conflict, match="already"):
        sy.resolve_sync_conflict(conn, cid, LEADER, "keep_server", "again")


# --------------------------------------------------------------------------- rejections and permissions

def test_rule_violations_are_rejected_not_applied(conn, published):
    astronaut, record = _task(conn, published, index=1)  # depends on task 1, which is not done
    out = sy.upload_batch(conn, device_id="tab-2", user=crew(astronaut),
                          events=[_event("e1", record, "start", f"{DAY}T12:00:00Z")])["outcomes"][0]
    assert out["status"] == "rejected" and "depends on" in out["error"]
    assert te.get_assignment(conn, record["task_assignment_id"])["assignment_status"] == "scheduled"


def test_someone_elses_task_is_rejected(conn, published):
    astronaut, record = _task(conn, published)
    other = "AST-001" if astronaut != "AST-001" else "AST-002"
    out = sy.upload_batch(conn, device_id="tab-x", user=crew(other),
                          events=[_event("e1", record, "start", f"{DAY}T09:00:00Z")])["outcomes"][0]
    assert out["status"] == "rejected" and "assigned astronaut" in out["error"]


def test_first_event_needs_a_base_version(conn, published):
    astronaut, record = _task(conn, published)
    out = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                          events=[_event("e1", record, "start", f"{DAY}T09:00:00Z", base=False)])["outcomes"][0]
    assert out["status"] == "rejected" and "base_version is required" in out["error"]


def test_device_belongs_to_one_account(conn, published):
    astronaut, record = _task(conn, published)
    sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                    events=[_event("e1", record, "start", f"{DAY}T09:00:00Z")])
    other = "AST-001" if astronaut != "AST-001" else "AST-002"
    with pytest.raises(PermissionDenied):
        sy.upload_batch(conn, device_id="tab-1", user=crew(other),
                        events=[_event("e9", record, "complete", f"{DAY}T10:00:00Z")])


def test_bad_events_are_refused_up_front(conn, published):
    astronaut, record = _task(conn, published)
    with pytest.raises(ValidationFailed):
        sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                        events=[_event("e1", record, "teleport", f"{DAY}T09:00:00Z")])
    with pytest.raises(ValidationFailed):
        sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                        events=[{**_event("e1", record, "start", None), "entity_type": "users"}])
    assert conn.execute("SELECT COUNT(*) FROM sync_events").fetchone()[0] == 0  # whole batch refused


def test_database_busy_is_retried(conn, published, monkeypatch):
    import sqlite3

    astronaut, record = _task(conn, published)
    real = sy.ENTITIES["task_assignment"]["apply"]
    calls = {"n": 0}

    def flaky(*args):
        calls["n"] += 1
        if calls["n"] == 1:
            raise sqlite3.OperationalError("database is locked")
        return real(*args)

    monkeypatch.setitem(sy.ENTITIES["task_assignment"], "apply", flaky)
    out = sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                          events=[_event("e1", record, "start", f"{DAY}T09:00:00Z")])["outcomes"][0]
    assert out["status"] == "failed"
    again = sy.replay_pending_events(conn)
    assert again["counts"] == {"applied": 1}


# --------------------------------------------------------------------------- recovery and status

def test_recovery_outcome_syncs(conn):
    sim.jump_to_mission_day(conn, "RUN-DEMO-001", 10, actor_user_id="USR-006", hour=10)
    gen = rc.generate_recommendations(conn, actor_user_id="USR-008")
    rec = next(a for a in gen["astronauts"] if a["astronaut_id"] == "AST-004")["recommendations"][0]
    rc.review_recommendation(conn, rec["recommendation_id"], OFFICER, "approve", "ok")
    booking = rc.schedule_recommendation(conn, rec["recommendation_id"], OFFICER, parse_iso("2027-03-10T14:00:00Z"))
    sim.jump_to_mission_day(conn, "RUN-DEMO-001", 10, actor_user_id="USR-006", hour=15)
    pulled = sy.pull_records(conn, "AST-004", simulation_run_id="RUN-DEMO-001", date="2027-03-10")
    mine = next(b for b in pulled["scheduled_recovery"] if b["scheduled_recovery_id"] == booking["scheduled_recovery_id"])
    out = sy.upload_batch(conn, device_id="tab-4", user=crew("AST-004"), events=[{
        "client_event_id": "r1", "entity_type": "scheduled_recovery", "entity_id": mine["scheduled_recovery_id"],
        "action": "completed", "at": "2027-03-10T14:20:00Z", "base_version": mine["sync_version"],
        "payload": {"feedback": "helped"}}])["outcomes"][0]
    assert out["status"] == "applied"
    done = rc.get_booking(conn, mine["scheduled_recovery_id"])
    assert done["completion_status"] == "completed" and done["astronaut_feedback"] == "helped"


def test_sync_status_summary(conn, published):
    astronaut, record = _task(conn, published)
    te.start_assignment(conn, record["task_assignment_id"], LEADER, parse_iso(f"{DAY}T09:00:00Z"))
    sy.upload_batch(conn, device_id="tab-1", user=crew(astronaut),
                    events=[_event("e1", record, "start", f"{DAY}T09:20:00Z")])
    status = sy.get_sync_status(conn)
    assert status["open_conflicts"] == 1 and status["events_by_status"] == {"conflict": 1}
    assert status["devices"][0]["device_id"] == "tab-1" and status["devices"][0]["in_conflict"] == 1
    assert [c["entity_id"] for c in sy.list_sync_conflicts(conn)] == [record["task_assignment_id"]]
