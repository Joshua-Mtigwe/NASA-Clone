"""Phase 3 HTTP tests: taking a test end to end, baselines, Mission Mind views, access rules."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

API = "/api/v1"


@pytest.fixture
def client(db_path):
    with TestClient(app) as c:
        yield c


def login(client, username):
    """Open demo mode: act as this persona. No password or token."""
    return {"X-AEGIS-User": username}


@pytest.fixture
def run_day5(client):
    """New run, day-5 assignments generated, clock at 08:00 on day 5."""
    leader = login(client, "mission_leader")
    run_id = client.post(f"{API}/simulation/runs", json={"run_name": "api flow"}, headers=leader).json()[
        "simulation_run_id"]
    r = client.post(f"{API}/assessments/assignments/generate",
                    json={"simulation_run_id": run_id, "from_day": 5, "to_day": 5}, headers=leader)
    assert r.status_code == 201 and r.json()["created"] == 20
    client.post(f"{API}/simulation/runs/{run_id}/jump", json={"mission_day": 5, "hour": 8}, headers=leader)
    return run_id


def test_take_a_stroop_test_end_to_end(client, run_day5):
    crew = login(client, "crew2")
    due = client.get(f"{API}/assessments/due?simulation_run_id={run_day5}", headers=crew).json()["due"]
    assert {a["protocol_id"] for a in due} == {"PVT", "NBACK", "STROOP", "SURVEY"}
    assignment = next(a for a in due if a["protocol_id"] == "STROOP")

    session = client.post(f"{API}/assessments/sessions", json={"assignment_id": assignment["assignment_id"]},
                          headers=crew)
    assert session.status_code == 201
    sid = session.json()["session_id"]
    trials = [{"trial_number": i, "stimulus_type": "cognitive_target", "stimulus_value": f"stimulus_{i % 3}",
               "expected_response": f"key_{i % 3}", "actual_response": f"key_{i % 3}" if i <= 18 else "other",
               "reaction_time_ms": 450.0} for i in range(1, 21)]
    assert client.post(f"{API}/assessments/sessions/{sid}/trials", json={"trials": trials},
                       headers=crew).json()["total_trials"] == 20
    done = client.post(f"{API}/assessments/sessions/{sid}/complete", json={}, headers=crew)
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["session"]["result"]["metric_value"] == 90.0  # 18 of 20 correct
    assert body["comparison"]["better_direction"] == "higher_is_better"

    daily = client.get(f"{API}/astronauts/AST-002/cognition/daily?simulation_run_id={run_day5}"
                       f"&start=2027-03-05T00:00:00Z&end=2027-03-05T23:59:59Z", headers=crew).json()
    assert [d["protocol_id"] for d in daily] == ["STROOP"]


def test_survey_needs_answers(client, run_day5):
    crew = login(client, "crew2")
    due = client.get(f"{API}/assessments/due?simulation_run_id={run_day5}", headers=crew).json()["due"]
    survey = next(a for a in due if a["protocol_id"] == "SURVEY")
    sid = client.post(f"{API}/assessments/sessions", json={"assignment_id": survey["assignment_id"]},
                      headers=crew).json()["session_id"]
    assert client.post(f"{API}/assessments/sessions/{sid}/complete", json={}, headers=crew).status_code == 422
    bad = {"survey": {"fatigue_score": 12, "sleepiness_score": 3, "perceived_workload": 3}}
    assert client.post(f"{API}/assessments/sessions/{sid}/complete", json=bad, headers=crew).status_code == 422
    ok = {"survey": {"fatigue_score": 3, "sleepiness_score": 3, "perceived_workload": 3}}
    assert client.post(f"{API}/assessments/sessions/{sid}/complete", json=ok, headers=crew).status_code == 200


def test_staff_cannot_take_tests_and_crew_cannot_generate(client, run_day5):
    officer = login(client, "medical_officer")
    due = client.get(f"{API}/assessments/due?astronaut_id=AST-001&simulation_run_id={run_day5}",
                     headers=officer).json()["due"]
    assert due  # staff can see what is due
    r = client.post(f"{API}/assessments/sessions", json={"assignment_id": due[0]["assignment_id"]}, headers=officer)
    assert r.status_code == 403
    r = client.post(f"{API}/assessments/assignments/generate",
                    json={"simulation_run_id": run_day5, "from_day": 6, "to_day": 6}, headers=login(client, "crew1"))
    assert r.status_code == 403


def test_crew_cannot_see_others_due_tests(client, run_day5):
    r = client.get(f"{API}/assessments/due?astronaut_id=AST-003&simulation_run_id={run_day5}",
                   headers=login(client, "crew1"))
    assert r.status_code == 403


def test_assignment_list_shows_expired_after_window(client, run_day5):
    leader = login(client, "mission_leader")
    client.post(f"{API}/simulation/runs/{run_day5}/jump", json={"mission_day": 5, "hour": 12}, headers=leader)
    body = client.get(f"{API}/astronauts/AST-001/assessments?simulation_run_id={run_day5}", headers=leader).json()
    assert body["counts"] == {"expired": 4}


def test_baselines_and_freeze(client):
    crew = login(client, "crew1")
    rows = client.get(f"{API}/astronauts/AST-001/baselines", headers=crew).json()
    assert len(rows) == 8 and {r["baseline_version"] for r in rows} == {"v1"}
    assert client.post(f"{API}/baselines/freeze", headers=login(client, "mission_leader")).status_code == 403
    r = client.post(f"{API}/baselines/freeze", json={}, headers=login(client, "medical_officer"))
    assert r.status_code == 201 and r.json()["baseline_version"] == "v2"
    assert {b["baseline_version"] for b in client.get(f"{API}/astronauts/AST-001/baselines",
                                                       headers=crew).json()} == {"v2"}


def test_mission_mind_views(client):
    officer = login(client, "medical_officer")
    at = "at=2027-04-15T09:30:00Z"
    comparisons = client.get(f"{API}/astronauts/AST-002/cognition/comparisons?only_outside=true&{at}",
                             headers=officer).json()
    assert comparisons["count"] > 0 and "not medical clearance" in comparisons["note"]
    assert all(c["reference_range_status"] == "outside_reference" for c in comparisons["comparisons"])
    trend = client.get(f"{API}/astronauts/AST-002/cognition/trend?protocol_id=PVT&{at}", headers=officer)
    assert trend.status_code == 200 and trend.json()["better_direction"] == "lower_is_better"
    definitions = client.get(f"{API}/metrics/definitions", headers=officer).json()
    assert {d["metric_name"]: d["better_direction"] for d in definitions}["fatigue_score"] == "lower_is_better"


def test_jump_with_hour(client):
    leader = login(client, "mission_leader")
    r = client.post(f"{API}/simulation/runs/RUN-DEMO-001/jump", json={"mission_day": 2, "hour": 8}, headers=leader)
    assert r.json()["current_mission_time"] == "2027-03-02T08:00:00Z"
    assert client.post(f"{API}/simulation/runs/RUN-DEMO-001/jump", json={"mission_day": 2, "hour": 24},
                       headers=leader).status_code == 422
