"""Phase 1 acceptance: independent run state."""
from datetime import timedelta

import pytest

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.services import mission_simulator as sim
from app.utils.timestamps import parse_iso

T0 = parse_iso("2026-11-14T10:00:00Z")  # wall clock used by these tests
LEADER = "USR-006"


def _new_run(conn, name="Test run", **kw):
    return sim.create_simulation_run(conn, mission_id="MIS-001", run_name=name, actor_user_id=LEADER, now=T0, **kw)


def test_seeded_run_state(conn):
    state = sim.get_simulation_state(conn, "RUN-DEMO-001", T0)
    assert state["status"] == "paused"
    assert state["mission_day"] == 1
    assert state["mission_total_days"] == 90
    assert state["speed_multiplier"] == 60


def test_running_clock_advances_at_speed(conn):
    run = _new_run(conn)
    sim.start_simulation(conn, run["simulation_run_id"], actor_user_id=LEADER, now=T0)
    later = sim.get_simulation_state(conn, run["simulation_run_id"], T0 + timedelta(seconds=60))
    assert later["current_mission_time"] == "2027-03-01T01:00:00Z"  # 60 s x 60 = 1 mission hour


def test_pause_freezes_the_clock(conn):
    run_id = _new_run(conn)["simulation_run_id"]
    sim.start_simulation(conn, run_id, actor_user_id=LEADER, now=T0)
    sim.pause_simulation(conn, run_id, actor_user_id=LEADER, now=T0 + timedelta(seconds=120))
    much_later = sim.get_simulation_state(conn, run_id, T0 + timedelta(hours=5))
    assert much_later["status"] == "paused"
    assert much_later["current_mission_time"] == "2027-03-01T02:00:00Z"


def test_runs_are_independent(conn):
    a = _new_run(conn, "A")["simulation_run_id"]
    b = _new_run(conn, "B")["simulation_run_id"]
    demo_before = sim.get_simulation_state(conn, "RUN-DEMO-001", T0)

    sim.start_simulation(conn, a, actor_user_id=LEADER, now=T0)
    sim.set_simulation_speed(conn, a, 3600, actor_user_id=LEADER, now=T0)
    sim.jump_to_mission_day(conn, b, 45, actor_user_id=LEADER, now=T0)

    later = T0 + timedelta(seconds=10)
    state_a = sim.get_simulation_state(conn, a, later)
    state_b = sim.get_simulation_state(conn, b, later)
    assert state_a["status"] == "running" and state_a["current_mission_time"] == "2027-03-01T10:00:00Z"
    assert state_b["status"] == "paused" and state_b["mission_day"] == 45 and state_b["speed_multiplier"] == 60
    assert sim.get_simulation_state(conn, "RUN-DEMO-001", later) == demo_before


def test_new_run_gets_its_own_copy_of_events(conn):
    run_id = _new_run(conn)["simulation_run_id"]
    own = sim.get_simulation_events(conn, run_id)
    demo = sim.get_simulation_events(conn, "RUN-DEMO-001")
    assert len(own) == len(demo) == 78
    assert {e["simulation_run_id"] for e in own} == {run_id}
    assert not {e["event_id"] for e in own} & {e["event_id"] for e in demo}


def test_reference_events_only_on_request(conn):
    base = sim.get_simulation_events(conn, "RUN-DEMO-001")
    with_ref = sim.get_simulation_events(conn, "RUN-DEMO-001", include_reference=True)
    assert len(with_ref) - len(base) == 19  # NASA DONKI 2024 records
    assert all(e["simulation_run_id"] is None for e in with_ref if e not in base)


def test_events_up_to_current_time(conn):
    run_id = _new_run(conn)["simulation_run_id"]
    assert sim.get_simulation_events(conn, run_id, up_to_current=True, now=T0) == []
    sim.jump_to_mission_day(conn, run_id, 30, actor_user_id=LEADER, now=T0)
    seen = sim.get_simulation_events(conn, run_id, up_to_current=True, now=T0)
    assert seen and all(e["mission_day"] < 30 for e in seen)


def test_run_completes_at_mission_end(conn):
    run_id = _new_run(conn, speed_multiplier=86_400)["simulation_run_id"]
    sim.jump_to_mission_day(conn, run_id, 89, actor_user_id=LEADER, now=T0)
    sim.start_simulation(conn, run_id, actor_user_id=LEADER, now=T0)
    end_state = sim.get_simulation_state(conn, run_id, T0 + timedelta(seconds=10))
    assert end_state["status"] == "completed"
    assert end_state["current_mission_time"] == end_state["mission_end"]
    with pytest.raises(Conflict):
        sim.start_simulation(conn, run_id, actor_user_id=LEADER, now=T0 + timedelta(seconds=10))
    reopened = sim.jump_to_mission_day(conn, run_id, 10, actor_user_id=LEADER, now=T0 + timedelta(seconds=10))
    assert reopened["status"] == "paused" and reopened["mission_day"] == 10


def test_invalid_inputs(conn):
    run_id = _new_run(conn)["simulation_run_id"]
    with pytest.raises(ValidationFailed):
        sim.set_simulation_speed(conn, run_id, 0, actor_user_id=LEADER)
    with pytest.raises(ValidationFailed):
        sim.jump_to_mission_day(conn, run_id, 91, actor_user_id=LEADER)
    with pytest.raises(NotFound):
        sim.get_simulation_state(conn, "RUN-NOPE")
    with pytest.raises(NotFound):
        sim.create_simulation_run(conn, mission_id="MIS-999", run_name="x", actor_user_id=LEADER)


def test_control_actions_are_audited(conn):
    run_id = _new_run(conn)["simulation_run_id"]
    sim.start_simulation(conn, run_id, actor_user_id=LEADER, now=T0)
    actions = [r[0] for r in conn.execute(
        "SELECT action_type FROM audit_logs WHERE entity_id = ? ORDER BY rowid", (run_id,))]
    assert actions == ["create_simulation_run", "start_simulation"]
