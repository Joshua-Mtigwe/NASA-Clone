"""Open demo mode (the default for the open-source submission): no logins, passwords or tokens.

Each request names a persona in X-AEGIS-User; every role rule still applies to that persona.
"""
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


def as_(persona):
    return {"X-AEGIS-User": persona}


def test_personas_are_public_and_list_every_role(client):
    body = client.get(f"{API}/personas").json()
    assert body["auth_mode"] == "open" and body["header"] == "X-AEGIS-User"
    assert body["default_persona"] == "USR-006"
    roles = {p["role_name"] for p in body["personas"]}
    assert roles == {"astronaut", "mission_leader", "medical_researcher", "medical_officer"}
    crew1 = next(p for p in body["personas"] if p["username"] == "crew1")
    assert crew1["astronaut_id"] == "AST-001" and crew1["label"].startswith("Astronaut AST-001")


def test_no_header_means_the_mission_leader(client):
    me = client.get(f"{API}/auth/me").json()
    assert me["user"]["user_id"] == "USR-006" and me["user"]["role_name"] == "mission_leader"
    assert len(me["permitted_astronaut_ids"]) == 5


@pytest.mark.parametrize("persona", ["crew2", "USR-002"])
def test_persona_by_username_or_id(client, persona):
    me = client.get(f"{API}/auth/me", headers=as_(persona)).json()
    assert me["user"]["user_id"] == "USR-002" and me["permitted_astronaut_ids"] == ["AST-002"]


def test_role_rules_still_apply_to_personas(client):
    crew = as_("crew1")
    assert [a["astronaut_id"] for a in client.get(f"{API}/astronauts", headers=crew).json()] == ["AST-001"]
    assert client.get(f"{API}/astronauts/AST-002", headers=crew).status_code == 403
    assert client.get(f"{API}/admin/import-status", headers=crew).status_code == 403
    assert client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-001"}, headers=crew).status_code == 403
    assert client.get(f"{API}/admin/import-status", headers=as_("medical_officer")).status_code == 200


def test_unknown_or_deactivated_persona_is_refused(client):
    assert client.get(f"{API}/auth/me", headers=as_("nobody")).status_code == 401
    client.post(f"{API}/admin/users/USR-005/deactivate")  # as the default mission leader
    assert client.get(f"{API}/auth/me", headers=as_("crew5")).status_code == 401
    assert "crew5" not in {p["username"] for p in client.get(f"{API}/personas").json()["personas"]}


@pytest.mark.parametrize("method,path,body", [
    ("post", "/auth/login", {"username": "crew1", "password": "x" * 10}),
    ("post", "/auth/logout", None),
    ("post", "/auth/change-password", {"current_password": "x" * 10, "new_password": "y" * 10}),
    ("post", "/admin/users/USR-001/reset-password", None),
])
def test_login_and_password_routes_do_not_exist(client, method, path, body):
    r = getattr(client, method)(f"{API}{path}", json=body)
    assert r.status_code == 404 and "open demo mode" in r.json()["message"]


def test_login_routes_hidden_from_docs(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert f"{API}/auth/login" not in paths and f"{API}/admin/users/{{user_id}}/reset-password" not in paths
    assert f"{API}/personas" in paths and f"{API}/demo/reset" in paths


def test_new_user_is_a_persona_without_password(client, conn):
    r = client.post(f"{API}/admin/users", json={"username": "guest.scientist", "role_name": "medical_researcher"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert "temporary_password" not in body and "X-AEGIS-User" in body["note"]
    stored = conn.execute("SELECT password_hash FROM users WHERE user_id = ?", (body["user_id"],)).fetchone()[0]
    assert stored == "OPEN_DEMO_NO_PASSWORD"
    assert client.get(f"{API}/auth/me", headers=as_("guest.scientist")).json()["user"]["role_name"] == \
        "medical_researcher"
    refused = client.post(f"{API}/admin/users", json={"username": "x.y.z", "role_name": "medical_researcher",
                                                      "password": "secret-password"})
    assert refused.status_code == 422


def test_audit_log_records_the_persona(client):
    client.post(f"{API}/simulation/runs", json={"run_name": "audit check"})
    logs = client.get(f"{API}/admin/audit-logs?entity_type=simulation_run").json()
    assert logs[0]["user_id"] == "USR-006"


def test_websocket_without_token(client):
    with client.websocket_connect(f"{API}/ws/simulation/RUN-DEMO-001") as ws:
        assert ws.receive_json()["event"] == "state"
    with client.websocket_connect(f"{API}/ws/simulation/RUN-DEMO-001?as_user=crew1") as ws:
        assert ws.receive_json()["state"]["simulation_run_id"] == "RUN-DEMO-001"


def test_websocket_rejects_unknown_persona(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"{API}/ws/simulation/RUN-DEMO-001?as_user=nobody") as ws:
            ws.receive_json()


def test_demo_reset_restores_seed_data(client, conn):
    run = client.post(f"{API}/simulation/runs", json={"run_name": "visitor run"}).json()["simulation_run_id"]
    assert client.post(f"{API}/demo/reset", headers=as_("crew1")).status_code == 403
    r = client.post(f"{API}/demo/reset")
    assert r.status_code == 200 and r.json()["status"] == "succeeded" and r.json()["rows_restored"] > 100_000
    assert client.get(f"{API}/simulation/runs/{run}").status_code == 404
    assert len(client.get(f"{API}/simulation/runs").json()) == 1  # only the seeded RUN-DEMO-001
    assert client.get(f"{API}/admin/import-status").json()["foreign_key_violations"] == 0


def test_demo_reset_can_be_switched_off(client, monkeypatch):
    monkeypatch.setenv("AEGIS_ALLOW_DEMO_RESET", "false")
    assert client.post(f"{API}/demo/reset").status_code == 404


def test_token_mode_still_available(client, monkeypatch, with_passwords):
    monkeypatch.setenv("AEGIS_AUTH_MODE", "token")
    assert client.get(f"{API}/auth/me").status_code == 401  # no persona fallback in token mode
    token = client.post(f"{API}/auth/login", json={"username": "crew1", "password": with_passwords}).json()[
        "access_token"]
    me = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["user"]["username"] == "crew1"
    assert client.post(f"{API}/demo/reset", headers={"Authorization": f"Bearer {token}"}).status_code == 403
