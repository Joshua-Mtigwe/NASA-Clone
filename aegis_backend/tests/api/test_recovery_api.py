"""HTTP tests: recovery planner and task execution routes, and who may use them."""
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


def jump(client, leader, day, hour):
    r = client.post(f"{API}/simulation/runs/RUN-DEMO-001/jump", json={"mission_day": day, "hour": hour},
                    headers=leader)
    assert r.status_code == 200, r.text


def test_recovery_flow_over_http(client):
    leader, officer, crew4, crew1 = (login(client, u) for u in ("mission_leader", "medical_officer", "crew4", "crew1"))
    jump(client, leader, 10, 10)
    assert len(client.get(f"{API}/recovery/activities", headers=crew1).json()) == 6
    assert client.get(f"{API}/recovery/activities", params={"include_unapproved": True}, headers=crew1).status_code == 403

    seen = client.get(f"{API}/recovery/signals", params={"astronaut_id": "AST-004"}, headers=crew4).json()
    assert "short_sleep" in seen["active"]
    assert client.get(f"{API}/recovery/signals", params={"astronaut_id": "AST-004"}, headers=crew1).status_code == 403

    for who in (leader, crew4):
        assert client.post(f"{API}/recovery/recommendations/generate", headers=who).status_code == 403
    made = client.post(f"{API}/recovery/recommendations/generate", headers=officer)
    assert made.status_code == 201, made.text
    rec = next(a for a in made.json()["astronauts"] if a["astronaut_id"] == "AST-004")["recommendations"][0]
    rid = rec["recommendation_id"]

    # an astronaut sees their own suggestions only
    mine = client.get(f"{API}/recovery/recommendations", headers=crew4).json()
    assert mine and {r["astronaut_id"] for r in mine} == {"AST-004"}
    assert client.get(f"{API}/recovery/recommendations", headers=crew1).json() == []
    assert client.get(f"{API}/recovery/recommendations/{rid}", headers=crew1).status_code == 403
    assert client.get(f"{API}/recovery/recommendations", params={"include_demo": True, "mission_day": 10},
                      headers=crew1).json()[0]["is_demo"] is True

    assert client.post(f"{API}/recovery/recommendations/{rid}/approve", headers=leader).status_code == 403
    approved = client.post(f"{API}/recovery/recommendations/{rid}/approve", json={"comment": "ok"}, headers=officer)
    assert approved.status_code == 200 and approved.json()["approval_status"] == "approved"
    clash = client.post(f"{API}/recovery/recommendations/{rid}/schedule", headers=officer,
                        json={"scheduled_start": "2027-03-10T11:10:00Z"})
    assert clash.status_code == 409 and clash.json()["details"]
    booked = client.post(f"{API}/recovery/recommendations/{rid}/schedule", headers=officer,
                         json={"scheduled_start": "2027-03-10T14:00:00Z"})
    assert booked.status_code == 201, booked.text
    sid = booked.json()["scheduled_recovery_id"]

    assert client.post(f"{API}/recovery/scheduled/{sid}/complete", headers=crew1).status_code == 403
    jump(client, leader, 10, 15)
    done = client.post(f"{API}/recovery/scheduled/{sid}/complete", json={"feedback": "Helped"}, headers=crew4)
    assert done.status_code == 200 and done.json()["completion_status"] == "completed"
    assert client.post(f"{API}/recovery/scheduled/{sid}/skip", headers=officer).status_code == 409
    listed = client.get(f"{API}/recovery/scheduled", params={"completion_status": "completed"}, headers=crew4).json()
    assert [b["scheduled_recovery_id"] for b in listed] == [sid]


def test_task_execution_over_http(client):
    leader, officer = login(client, "mission_leader"), login(client, "medical_officer")
    plan = client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-010", "solver": "builtin"},
                       headers=leader).json()
    vid = plan["schedule_version_id"]
    assert client.post(f"{API}/planning/schedule-versions/{vid}/approve", headers=leader).status_code == 200
    assert client.post(f"{API}/planning/schedule-versions/{vid}/publish", headers=leader).status_code == 200
    jump(client, leader, 10, 9)

    todo = client.get(f"{API}/planning/assignments", params={"date": "2027-03-10", "assignment_status": "scheduled"},
                      headers=leader).json()
    assert todo and all(a["version_status"] == "published" for a in todo)
    first = todo[0]
    aid = first["task_assignment_id"]
    username = f"crew{int(first['astronaut_id'][-1])}"
    me = login(client, username)
    other = login(client, "crew1" if username != "crew1" else "crew2")

    assert client.post(f"{API}/planning/assignments/{aid}/start", headers=other).status_code == 403
    assert client.post(f"{API}/planning/assignments/{aid}/start", headers=officer).status_code == 403
    assert client.post(f"{API}/planning/assignments/{aid}/complete", headers=me).status_code == 409
    started = client.post(f"{API}/planning/assignments/{aid}/start", headers=me)
    assert started.status_code == 200 and started.json()["assignment_status"] == "in_progress"
    assert client.post(f"{API}/planning/assignments/{aid}/start", json={"at": "nonsense"}, headers=me).status_code == 422
    jump(client, leader, 10, 10)
    done = client.post(f"{API}/planning/assignments/{aid}/complete", headers=me)
    assert done.status_code == 200 and done.json()["actual_end"] == "2027-03-10T10:00:00Z"

    # astronauts list only their own; the seed demo plan cannot be recorded
    own = client.get(f"{API}/planning/assignments", params={"date": "2027-03-10"}, headers=me).json()
    assert own and {a["astronaut_id"] for a in own} == {first["astronaut_id"]}
    assert client.get(f"{API}/planning/assignments", params={"astronaut_id": "AST-003"},
                      headers=login(client, "crew4")).status_code == 403
    assert client.post(f"{API}/planning/assignments/TA-010-01/start", headers=leader).status_code == 409
    assert client.post(f"{API}/planning/assignments/{aid}/skip", json={}, headers=leader).status_code == 422
    assert client.get(f"{API}/planning/assignments", headers=login(client, "nobody")).status_code == 401
