import pytest

from app.core import permissions
from app.core.errors import AuthenticationFailed, NotFound, PermissionDenied
from app.services import auth_service


def test_seed_users_cannot_log_in_before_setup(conn):
    with pytest.raises(AuthenticationFailed):
        auth_service.authenticate_user(conn, "crew1", "DEMO_ACCOUNT_NO_PASSWORD")


def test_login_and_resolve_token(conn, with_passwords):
    session = auth_service.authenticate_user(conn, "crew1", with_passwords)
    assert session["user"]["role_name"] == permissions.ASTRONAUT
    assert "password_hash" not in session["user"]
    user = auth_service.get_current_user(conn, session["access_token"])
    assert user["user_id"] == "USR-001"
    assert user["last_login_at"] is not None


def test_token_is_not_stored_in_plain_text(conn, with_passwords):
    token = auth_service.authenticate_user(conn, "crew1", with_passwords)["access_token"]
    stored = [r[0] for r in conn.execute("SELECT token_hash FROM auth_sessions")]
    assert token not in stored


def test_wrong_password_and_unknown_user_look_the_same(conn, with_passwords):
    with pytest.raises(AuthenticationFailed) as wrong:
        auth_service.authenticate_user(conn, "crew1", "nope-nope-nope")
    with pytest.raises(AuthenticationFailed) as unknown:
        auth_service.authenticate_user(conn, "nobody", "nope-nope-nope")
    assert wrong.value.message == unknown.value.message


def test_login_attempts_are_audited(conn, with_passwords):
    auth_service.authenticate_user(conn, "crew1", with_passwords)
    with pytest.raises(AuthenticationFailed):
        auth_service.authenticate_user(conn, "crew1", "bad-password")
    results = [r[0] for r in conn.execute(
        "SELECT action_result FROM audit_logs WHERE action_type = 'login' AND user_id = 'USR-001'")]
    assert "success" in results and "denied" in results


def test_revoked_token_stops_working(conn, with_passwords):
    token = auth_service.authenticate_user(conn, "crew1", with_passwords)["access_token"]
    assert auth_service.revoke_session(conn, token) is True
    with pytest.raises(AuthenticationFailed):
        auth_service.get_current_user(conn, token)
    assert auth_service.revoke_session(conn, token) is False


def test_disabled_account_cannot_use_existing_token(conn, with_passwords):
    token = auth_service.authenticate_user(conn, "crew2", with_passwords)["access_token"]
    conn.execute("UPDATE users SET account_status = 'disabled' WHERE username = 'crew2'")
    conn.commit()
    with pytest.raises(AuthenticationFailed):
        auth_service.get_current_user(conn, token)


def test_require_role(conn, with_passwords):
    crew = auth_service.authenticate_user(conn, "crew1", with_passwords)["user"]
    leader = auth_service.authenticate_user(conn, "mission_leader", with_passwords)["user"]
    assert auth_service.require_role(leader, permissions.MISSION_LEADER)
    with pytest.raises(PermissionDenied):
        auth_service.require_role(crew, permissions.MISSION_LEADER)


def test_astronaut_sees_only_self(conn, with_passwords):
    crew3 = auth_service.authenticate_user(conn, "crew3", with_passwords)["user"]
    assert auth_service.get_permitted_astronauts(conn, crew3) == ["AST-003"]
    with pytest.raises(PermissionDenied):
        auth_service.require_astronaut_access(conn, crew3, "AST-001")
    with pytest.raises(NotFound):
        auth_service.require_astronaut_access(conn, crew3, "AST-999")


@pytest.mark.parametrize("username", ["mission_leader", "researcher", "medical_officer"])
def test_staff_see_whole_crew(conn, with_passwords, username):
    user = auth_service.authenticate_user(conn, username, with_passwords)["user"]
    assert auth_service.get_permitted_astronauts(conn, user) == [f"AST-00{i}" for i in range(1, 6)]
