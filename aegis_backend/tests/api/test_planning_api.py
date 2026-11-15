"""Phase 4 HTTP tests: planning routes and who may use them."""
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


def test_plan_approve_publish_over_http(client):
    leader = login(client, "mission_leader")
    r = client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-002", "solver": "builtin"}, headers=leader)
    assert r.status_code == 201, r.text
    plan = r.json()
    assert plan["status"] in ("complete", "partial") and plan["scheduled"]
    assert all(u["reasons"] for u in plan["unscheduled"])
    vid = plan["schedule_version_id"]

    check = client.get(f"{API}/planning/schedule-versions/{vid}/check", headers=leader).json()
    assert check["ok"] is True
    assert client.post(f"{API}/planning/schedule-versions/{vid}/approve", headers=leader).json()["status"] == "approved"
    assert client.post(f"{API}/planning/schedule-versions/{vid}/publish", headers=leader).json()["status"] == "published"

    run = client.get(f"{API}/planning/optimization-runs/{plan['optimization_run_id']}", headers=leader).json()
    assert run["schedule_version"]["schedule_version_id"] == vid


def test_published_tasks_show_on_astronaut_schedule(client):
    leader = login(client, "mission_leader")
    plan = client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-002", "solver": "builtin"},
                       headers=leader).json()
    vid = plan["schedule_version_id"]
    client.post(f"{API}/planning/schedule-versions/{vid}/approve", headers=leader)
    client.post(f"{API}/planning/schedule-versions/{vid}/publish", headers=leader)
    astronaut = plan["scheduled"][0]["astronaut_ids"][0]
    username = f"crew{astronaut[-1]}"
    day = client.get(f"{API}/astronauts/{astronaut}/schedule?date=2027-03-02", headers=login(client, username)).json()
    assert any(e["activity_type"] == "task" for e in day["schedule_entries"])


@pytest.mark.parametrize("username", ["crew1", "medical_officer", "researcher"])
def test_only_mission_leader_optimizes_and_approves(client, username):
    headers = login(client, username)
    assert client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-001"}, headers=headers).status_code == 403
    vid = client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-001", "solver": "builtin"},
                      headers=login(client, "mission_leader")).json()["schedule_version_id"]
    assert client.post(f"{API}/planning/schedule-versions/{vid}/approve", headers=headers).status_code == 403


def test_staff_views_and_crew_limits(client):
    crew, officer = login(client, "crew1"), login(client, "medical_officer")
    assert len(client.get(f"{API}/planning/task-sets?from_day=1&to_day=5", headers=crew).json()) == 5
    assert client.get(f"{API}/planning/task-sets/SET-001", headers=crew).status_code == 200
    for path in ("planning/crew-readiness", "planning/qualifications", "planning/task-sets/SET-001/eligibility",
                 "planning/schedule-versions"):
        assert client.get(f"{API}/{path}", headers=crew).status_code == 403, path
        assert client.get(f"{API}/{path}", headers=officer).status_code == 200, path
    quals = client.get(f"{API}/planning/qualifications", headers=officer).json()
    assert len(quals) == 5 and not any(q["is_verified"] for q in quals)


def test_bad_requests(client):
    leader = login(client, "mission_leader")
    assert client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-999"}, headers=leader).status_code == 404
    assert client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-001", "solver": "magic"},
                       headers=leader).status_code == 422
    assert client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-001", "workday_start_hour": 30},
                       headers=leader).status_code == 422
    assert client.post(f"{API}/planning/schedule-versions/SV-DEMO-001/approve", headers=leader).status_code == 409


def test_infeasible_full_coverage(client):
    r = client.post(f"{API}/planning/optimize",
                    json={"task_set_id": "SET-001", "require_full_coverage": True, "solver": "builtin"},
                    headers=login(client, "mission_leader"))
    body = r.json()
    assert r.status_code == 201 and body["status"] == "infeasible" and body["schedule_version_id"] is None
