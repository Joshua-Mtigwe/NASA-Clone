"""HTTP-level tests. Needs fastapi and httpx installed (pip install -r requirements.txt)."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx2")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

API = "/api/v1"


@pytest.fixture
def client(db_path, with_passwords):
    with TestClient(app) as c:
        yield c


def login(client, username, password="test-password-123"):
    r = client.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_login_failure_is_401(client):
    r = client.post(f"{API}/auth/login", json={"username": "crew1", "password": "wrong-password"})
    assert r.status_code == 401
    assert r.json()["error"] == "authentication_failed"


def test_requests_without_token_are_401(client):
    assert client.get(f"{API}/missions").status_code == 401


def test_me_and_logout(client):
    headers = login(client, "crew2")
    me = client.get(f"{API}/auth/me", headers=headers).json()
    assert me["user"]["username"] == "crew2"
    assert me["permitted_astronaut_ids"] == ["AST-002"]
    assert client.post(f"{API}/auth/logout", headers=headers).status_code == 204
    assert client.get(f"{API}/auth/me", headers=headers).status_code == 401


def test_astronaut_list_is_filtered(client):
    crew = client.get(f"{API}/astronauts", headers=login(client, "crew1")).json()
    assert [a["astronaut_id"] for a in crew] == ["AST-001"]
    assert client.get(f"{API}/astronauts/AST-002", headers=login(client, "crew1")).status_code == 403
    staff = client.get(f"{API}/astronauts", headers=login(client, "medical_officer")).json()
    assert len(staff) == 5


def test_only_mission_leader_controls_simulation(client):
    body = {"run_name": "API run"}
    assert client.post(f"{API}/simulation/runs", json=body, headers=login(client, "crew1")).status_code == 403
    r = client.post(f"{API}/simulation/runs", json=body, headers=login(client, "mission_leader"))
    assert r.status_code == 201
    run_id = r.json()["simulation_run_id"]
    leader = login(client, "mission_leader")
    assert client.post(f"{API}/simulation/runs/{run_id}/start", headers=leader).json()["status"] == "running"
    assert client.put(f"{API}/simulation/runs/{run_id}/speed", json={"speed_multiplier": 120},
                      headers=leader).json()["speed_multiplier"] == 120
    assert client.post(f"{API}/simulation/runs/{run_id}/jump", json={"mission_day": 20},
                       headers=leader).json()["mission_day"] == 20
    assert client.post(f"{API}/simulation/runs/{run_id}/pause", headers=leader).json()["status"] == "paused"


def test_validation_errors(client):
    leader = login(client, "mission_leader")
    assert client.put(f"{API}/simulation/runs/RUN-DEMO-001/speed", json={"speed_multiplier": 0},
                      headers=leader).status_code == 422
    assert client.post(f"{API}/simulation/runs/RUN-DEMO-001/jump", json={"mission_day": 500},
                       headers=leader).status_code == 422
    assert client.get(f"{API}/simulation/runs/RUN-NOPE", headers=leader).status_code == 404


def test_events_endpoint(client):
    headers = login(client, "crew1")
    events = client.get(f"{API}/simulation/events", headers=headers).json()
    assert len(events) == 78
    with_ref = client.get(f"{API}/simulation/events?include_reference=true", headers=headers).json()
    assert len(with_ref) == 97


def test_admin_routes(client):
    assert client.get(f"{API}/admin/import-status", headers=login(client, "crew1")).status_code == 403
    status = client.get(f"{API}/admin/import-status", headers=login(client, "mission_leader")).json()
    assert status["foreign_key_violations"] == 0 and len(status["tables"]) == 49
    sources = client.get(f"{API}/admin/data-sources", headers=login(client, "medical_officer")).json()
    assert len(sources) == 17
    reimport = client.post(f"{API}/admin/import", headers=login(client, "mission_leader")).json()
    assert reimport["status"] == "succeeded" and reimport["rows_inserted"] == 0


def test_websocket_sends_state_and_updates(client):
    token = client.post(f"{API}/auth/login", json={"username": "mission_leader", "password": "test-password-123"}
                        ).json()["access_token"]
    with client.websocket_connect(f"{API}/ws/simulation/RUN-DEMO-001?token={token}") as ws:
        first = ws.receive_json()
        assert first["event"] == "state" and first["state"]["simulation_run_id"] == "RUN-DEMO-001"
        client.post(f"{API}/simulation/runs/RUN-DEMO-001/start", headers={"Authorization": f"Bearer {token}"})
        update = ws.receive_json()
        assert update["event"] == "started" and update["state"]["status"] == "running"


def test_websocket_rejects_bad_token(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"{API}/ws/simulation/RUN-DEMO-001?token=bad") as ws:
            ws.receive_json()
