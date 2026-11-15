"""Phase 7 HTTP tests: a device going offline and back online, and the admin conflict queue."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

API = "/api/v1"
DAY = "2027-03-02"


@pytest.fixture
def client(db_path):
    with TestClient(app) as c:
        yield c


def login(client, username):
    """Open demo mode: act as this persona. No password or token."""
    return {"X-AEGIS-User": username}


@pytest.fixture
def setup(client):
    """Published day-2 plan in a new run; clock at 15:00. Returns run, first task and its astronaut login."""
    leader = login(client, "mission_leader")
    run = client.post(f"{API}/simulation/runs", json={"run_name": "sync api"}, headers=leader).json()[
        "simulation_run_id"]
    plan = client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-002", "simulation_run_id": run,
                                                          "solver": "builtin"}, headers=leader).json()
    vid = plan["schedule_version_id"]
    client.post(f"{API}/planning/schedule-versions/{vid}/approve", headers=leader)
    client.post(f"{API}/planning/schedule-versions/{vid}/publish", headers=leader)
    client.post(f"{API}/simulation/runs/{run}/jump", json={"mission_day": 2, "hour": 15}, headers=leader)
    astronaut = plan["scheduled"][0]["astronaut_ids"][0]
    crew = login(client, f"crew{astronaut[-1]}")
    pulled = client.get(f"{API}/sync/pull?simulation_run_id={run}&date={DAY}", headers=crew).json()
    task = next(t for t in pulled["task_assignment"] if t["task_id"] == plan["scheduled"][0]["task_id"])
    return {"run": run, "leader": leader, "crew": crew, "task": task}


def _batch(task, *events):
    return {"device_id": "tablet-1", "events": [
        {"client_event_id": cid, "entity_type": "task_assignment", "entity_id": task["task_assignment_id"],
         "action": action, "at": at, "base_version": base} for cid, action, at, base in events]}


def test_offline_round_trip(client, setup):
    task, crew = setup["task"], setup["crew"]
    body = _batch(task, ("e1", "start", f"{DAY}T09:05:00Z", task["sync_version"]),
                  ("e2", "complete", f"{DAY}T10:10:00Z", None))
    r = client.post(f"{API}/sync/events", json=body, headers=crew)
    assert r.status_code == 200, r.text
    assert [o["status"] for o in r.json()["outcomes"]] == ["applied", "applied"]
    mine = client.get(f"{API}/sync/events", headers=crew).json()
    assert {e["client_event_id"] for e in mine} == {"e1", "e2"}


def test_conflict_queue_and_resolution(client, setup):
    task, crew, leader = setup["task"], setup["crew"], setup["leader"]
    client.post(f"{API}/planning/assignments/{task['task_assignment_id']}/start",
                json={"at": f"{DAY}T09:00:00Z"}, headers=leader)
    out = client.post(f"{API}/sync/events", json=_batch(task, ("e1", "start", f"{DAY}T09:30:00Z",
                                                              task["sync_version"])), headers=crew).json()
    assert out["outcomes"][0]["status"] == "conflict"

    status = client.get(f"{API}/admin/sync-status", headers=leader).json()
    assert status["open_conflicts"] == 1
    queue = client.get(f"{API}/admin/sync-conflicts", headers=leader).json()
    assert len(queue) == 1 and queue[0]["current"]["actual_start"] == f"{DAY}T09:00:00Z"
    cid = queue[0]["conflict_id"]
    assert client.post(f"{API}/admin/sync-conflicts/{cid}/resolve", json={"resolution": "keep_server", "notes": ""},
                       headers=leader).status_code == 422
    done = client.post(f"{API}/admin/sync-conflicts/{cid}/resolve",
                       json={"resolution": "keep_server", "notes": "Console time is right"}, headers=leader)
    assert done.status_code == 200 and done.json()["resolution_status"] == "kept_server"
    assert client.get(f"{API}/admin/sync-conflicts", headers=leader).json() == []


@pytest.mark.parametrize("username", ["crew1", "researcher"])
def test_admin_sync_routes_are_staff_only(client, username):
    headers = login(client, username)
    for path in ("admin/sync-status", "admin/sync-conflicts", "admin/sync-events"):
        assert client.get(f"{API}/{path}", headers=headers).status_code == 403, path
    assert client.post(f"{API}/admin/sync/replay", headers=headers).status_code == 403


def test_bad_uploads(client, setup):
    crew = setup["crew"]
    assert client.post(f"{API}/sync/events", json={"device_id": "t", "events": []}, headers=crew).status_code == 422
    bad = _batch(setup["task"], ("e1", "start", None, None))
    bad["events"][0]["entity_type"] = "users"
    assert client.post(f"{API}/sync/events", json=bad, headers=crew).status_code == 422
    # an astronaut cannot pull another astronaut's records
    assert client.get(f"{API}/sync/pull?astronaut_id=AST-005&simulation_run_id={setup['run']}",
                      headers=login(client, "crew1")).status_code == 403
