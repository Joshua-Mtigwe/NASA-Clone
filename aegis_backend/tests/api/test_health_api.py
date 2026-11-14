"""Phase 2 HTTP tests: health routes, access rules, and the admin crew-health view."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

API = "/api/v1"
AT = "at=2027-04-15T09:30:00Z"


@pytest.fixture
def client(db_path, with_passwords):
    with TestClient(app) as c:
        yield c


def login(client, username):
    r = client.post(f"{API}/auth/login", json={"username": username, "password": "test-password-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_astronaut_sees_own_health_only(client):
    crew1 = login(client, "crew1")
    r = client.get(f"{API}/astronauts/AST-001/health/summary?{AT}", headers=crew1)
    assert r.status_code == 200
    body = r.json()
    assert len(body["vitals"]) == 5 and body["radiation"]["dose_rate_unit"] == "uSv/h"
    assert client.get(f"{API}/astronauts/AST-002/health/summary?{AT}", headers=crew1).status_code == 403


@pytest.mark.parametrize("path", [
    "vitals/current", "vitals/history?measurement_type=heart_rate", "vitals/stats?measurement_type=spo2",
    "vitals/rolling?measurement_type=hrv_rmssd", "vitals/trend?measurement_type=heart_rate", "body-map",
    "radiation", "radiation/organ-doses", "sleep", "activity", "schedule", "health/changes",
    "sleep/pre-assessment?assessment_time=2027-04-15T08:00:00Z",
])
def test_every_health_route_answers(client, path):
    sep = "&" if "?" in path else "?"
    r = client.get(f"{API}/astronauts/AST-003/{path}{sep}{AT}", headers=login(client, "medical_officer"))
    assert r.status_code == 200, r.text


def test_bad_inputs_are_422(client):
    headers = login(client, "medical_officer")
    assert client.get(f"{API}/astronauts/AST-001/vitals/history?measurement_type=mood&{AT}",
                      headers=headers).status_code == 422
    assert client.get(f"{API}/astronauts/AST-001/vitals/current?at=not-a-time", headers=headers).status_code == 422
    assert client.get(f"{API}/astronauts/AST-001/health/changes?category=mood&{AT}", headers=headers).status_code == 422
    assert client.get(f"{API}/astronauts/AST-999/vitals/current?{AT}", headers=headers).status_code == 404


def test_environment_routes(client):
    headers = login(client, "crew1")
    for path in ("environment/current", "environment/history?measurement_type=cabin_co2",
                 "environment/averages", "environment/events"):
        sep = "&" if "?" in path else "?"
        assert client.get(f"{API}/{path}{sep}{AT}", headers=headers).status_code == 200, path


def test_research_radiation_series_access(client):
    assert client.get(f"{API}/research/radiation-series?{AT}", headers=login(client, "crew1")).status_code == 403
    r = client.get(f"{API}/research/radiation-series?include_reference=true&{AT}", headers=login(client, "researcher"))
    assert r.status_code == 200 and r.json()["nasa_reference"]["dose_rate_unit"] == "uGy/h"


@pytest.mark.parametrize("username,allowed", [
    ("mission_leader", True), ("medical_officer", True), ("researcher", False), ("crew1", False)])
def test_crew_health_changes_access(client, username, allowed):
    r = client.get(f"{API}/admin/crew-health/changes?{AT}", headers=login(client, username))
    assert r.status_code == (200 if allowed else 403)
    if allowed:
        body = r.json()
        assert len(body["crew"]) == 5 and body["summary"][0]["astronaut_id"] == "AST-002"


def test_crew_health_view_is_audited(client):
    officer = login(client, "medical_officer")
    client.get(f"{API}/admin/crew-health/changes?only_changes=true&category=vitals&{AT}", headers=officer)
    logs = client.get(f"{API}/admin/audit-logs?entity_type=crew_health", headers=officer).json()
    assert logs and logs[0]["action_type"] == "view_crew_health_changes" and logs[0]["user_id"] == "USR-008"


def test_sensor_quality_route(client):
    r = client.get(f"{API}/admin/sensor-quality?{AT}", headers=login(client, "mission_leader"))
    assert r.status_code == 200 and r.json()["issue_count"] == 0
    assert client.get(f"{API}/admin/sensor-quality?{AT}", headers=login(client, "crew1")).status_code == 403


def test_dashboard_follows_simulation_clock(client):
    leader = login(client, "mission_leader")
    client.post(f"{API}/simulation/runs/RUN-DEMO-001/jump", json={"mission_day": 46}, headers=leader)
    body = client.get(f"{API}/astronauts/AST-001/health/summary", headers=leader).json()
    assert body["as_of"] == "2027-04-15T00:00:00Z"
    assert body["changes"]["status"] == "compared"
