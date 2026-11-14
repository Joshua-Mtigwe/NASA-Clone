"""Registering missions, users and astronauts; passwords; who may do it."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

API = "/api/v1"
PW = "test-password-123"


@pytest.fixture
def client(db_path, with_passwords, token_mode):
    """These tests cover sign-in itself, so they run in token mode."""
    with TestClient(app) as c:
        yield c


def login(client, username, password=PW, expect=200):
    r = client.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == expect, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"} if expect == 200 else None


def test_new_mission_and_new_astronaut_can_sign_in(client):
    leader = login(client, "mission_leader")
    mission = client.post(f"{API}/missions", headers=leader, json={
        "mission_name": "AEGIS Lunar Gateway", "launch_date": "2028-01-10", "planned_end_date": "2028-04-10"})
    assert mission.status_code == 201, mission.text
    mid = mission.json()["mission_id"]
    assert mission.json()["mission_status"] == "planned" and mission.json()["launch_date"] == "2028-01-10T00:00:00Z"
    assert mid in {m["mission_id"] for m in client.get(f"{API}/missions", headers=leader).json()}

    made = client.post(f"{API}/admin/users", headers=leader, json={
        "username": "Nova.Reyes", "role_name": "astronaut", "email": "nova@example.invalid",
        "mission_id": mid, "specialization": "Geology", "crew_role": "Mission Specialist"})
    assert made.status_code == 201, made.text
    new = made.json()
    assert new["username"] == "nova.reyes" and new["mission_id"] == mid
    assert new["medical_clearance_status"] == "pending_review" and "password_hash" not in new
    temp = new["temporary_password"]
    assert temp and len(temp) >= 12

    # the new astronaut signs in and sees only themselves
    me = login(client, "nova.reyes", temp)
    seen = client.get(f"{API}/auth/me", headers=me).json()
    assert seen["user"]["role_name"] == "astronaut" and seen["permitted_astronaut_ids"] == [new["astronaut_id"]]
    assert [a["astronaut_id"] for a in client.get(f"{API}/astronauts", headers=me).json()] == [new["astronaut_id"]]
    assert client.get(f"{API}/astronauts/AST-001", headers=me).status_code == 403
    assert client.get(f"{API}/admin/users", headers=me).status_code == 403

    # they change the temporary password; old sessions and the old password stop working
    assert client.post(f"{API}/auth/change-password", headers=me,
                       json={"current_password": "wrong-one", "new_password": "a-brand-new-pass"}).status_code == 401
    assert client.post(f"{API}/auth/change-password", headers=me,
                       json={"current_password": temp, "new_password": temp}).status_code == 422
    changed = client.post(f"{API}/auth/change-password", headers=me,
                          json={"current_password": temp, "new_password": "a-brand-new-pass"})
    assert changed.status_code == 200, changed.text
    assert client.get(f"{API}/auth/me", headers=me).status_code == 401
    login(client, "nova.reyes", temp, expect=401)
    login(client, "nova.reyes", "a-brand-new-pass")

    listed = client.get(f"{API}/admin/users", params={"mission_id": mid}, headers=leader).json()
    assert [u["username"] for u in listed] == ["nova.reyes"]
    # the scheduler leaves an uncleared astronaut with no readiness record alone
    assert client.get(f"{API}/admin/users/{new['user_id']}", headers=leader).json()["astronaut_id"]


def test_staff_account_with_chosen_password(client):
    leader = login(client, "mission_leader")
    made = client.post(f"{API}/admin/users", headers=leader, json={
        "username": "dr_okafor", "role_name": "medical_officer", "password": "chosen-password-1"})
    assert made.status_code == 201 and made.json()["temporary_password"] is None
    assert made.json()["astronaut_id"] is None
    officer = login(client, "dr_okafor", "chosen-password-1")
    assert client.get(f"{API}/admin/users", headers=officer).status_code == 200  # may read
    assert client.post(f"{API}/admin/users", headers=officer, json={
        "username": "sneaky", "role_name": "mission_leader"}).status_code == 403  # may not create


def test_registration_is_refused_when_wrong(client):
    leader = login(client, "mission_leader")

    def create(**body):
        return client.post(f"{API}/admin/users", headers=leader, json=body).status_code

    assert create(username="crew1", role_name="astronaut", mission_id="MIS-001") == 409  # taken
    assert create(username="CREW1", role_name="astronaut", mission_id="MIS-001") == 409  # case-insensitive
    assert create(username="has space", role_name="medical_researcher") == 422
    assert create(username="newbie", role_name="captain") == 422
    assert create(username="newbie", role_name="astronaut") == 422  # no mission
    assert create(username="newbie", role_name="astronaut", mission_id="MIS-NOPE") == 404
    assert create(username="newbie", role_name="medical_researcher", mission_id="MIS-001") == 422
    assert create(username="newbie", role_name="medical_researcher", email="not-an-email") == 422
    assert create(username="newbie", role_name="medical_researcher", email="crew1@example.invalid") == 409
    assert create(username="newbie", role_name="medical_researcher", password="short") == 422
    assert client.post(f"{API}/admin/users", json={"username": "newbie", "role_name": "astronaut"}).status_code == 401
    # nothing half-created
    assert "newbie" not in {u["username"] for u in client.get(f"{API}/admin/users", headers=leader).json()}

    def mission(**body):
        return client.post(f"{API}/missions", headers=leader, json=body).status_code

    assert mission(mission_name="Backwards", launch_date="2028-04-10", planned_end_date="2028-01-10") == 422
    assert mission(mission_name="Bad date", launch_date="soon", planned_end_date="2028-01-10") == 422
    assert mission(mission_name="aegis 90-day deep space demo", launch_date="2028-01-10",
                   planned_end_date="2028-04-10") == 409
    for who in ("crew1", "researcher", "medical_officer"):
        r = client.post(f"{API}/missions", headers=login(client, who), json={
            "mission_name": "Not allowed", "launch_date": "2028-01-10", "planned_end_date": "2028-04-10"})
        assert r.status_code == 403


def test_deactivate_reactivate_and_reset(client):
    leader, crew2 = login(client, "mission_leader"), login(client, "crew2")
    assert client.post(f"{API}/admin/users/USR-002/deactivate", headers=crew2).status_code == 403
    assert client.post(f"{API}/admin/users/USR-006/deactivate", headers=leader).status_code == 409  # yourself
    off = client.post(f"{API}/admin/users/USR-002/deactivate", headers=leader)
    assert off.status_code == 200 and off.json()["account_status"] == "disabled"
    assert client.get(f"{API}/auth/me", headers=crew2).status_code == 401  # signed out at once
    login(client, "crew2", expect=401)
    assert client.post(f"{API}/admin/users/USR-002/deactivate", headers=leader).status_code == 409
    assert client.post(f"{API}/admin/users/USR-002/reactivate", headers=leader).json()["account_status"] == "active"
    crew2 = login(client, "crew2")

    reset = client.post(f"{API}/admin/users/USR-002/reset-password", headers=leader)
    assert reset.status_code == 200
    assert client.get(f"{API}/auth/me", headers=crew2).status_code == 401
    login(client, "crew2", expect=401)
    login(client, "crew2", reset.json()["temporary_password"])
    assert client.post(f"{API}/admin/users/USR-NOPE/reset-password", headers=leader).status_code == 404

    audit = client.get(f"{API}/admin/audit-logs", params={"entity_type": "user", "limit": 200}, headers=leader).json()
    kinds = {a["action_type"] for a in audit if a["entity_id"] == "USR-002"}
    assert {"deactivate_user", "reactivate_user", "set_password"} <= kinds
    reset_row = next(a for a in audit if a["action_type"] == "set_password" and a["entity_id"] == "USR-002"
                     and a["user_id"] == "USR-006")
    assert "reset" in reset_row["change_summary"]
