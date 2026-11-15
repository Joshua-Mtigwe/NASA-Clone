"""Shared fixtures. The 49 CSVs are imported once per test session into a template database,
which each test then copies, so tests are isolated and fast."""
import shutil
from pathlib import Path

import pytest

from app.database.session import connect
from app.services.auth_service import set_user_password
from app.services.data_import_service import seed_demo_database

SEED_DIR = Path(__file__).resolve().parents[1] / "data" / "seed"
TEST_PASSWORD = "test-password-123"


@pytest.fixture(scope="session")
def seeded_template(tmp_path_factory):
    path = tmp_path_factory.mktemp("template") / "template.db"
    conn = connect(path)
    try:
        report = seed_demo_database(conn, SEED_DIR)
        assert report["status"] == "succeeded", report["issues"]
    finally:
        conn.close()
    return path


@pytest.fixture
def db_path(seeded_template, tmp_path, monkeypatch):
    path = tmp_path / "aegis.db"
    shutil.copyfile(seeded_template, path)
    monkeypatch.setenv("AEGIS_DATABASE_PATH", str(path))
    monkeypatch.setenv("AEGIS_SEED_DIR", str(SEED_DIR))
    monkeypatch.setenv("AEGIS_PBKDF2_ITERATIONS", "1000")  # fast hashing in tests only
    monkeypatch.setenv("AEGIS_AUTH_MODE", "open")  # the default; token-mode tests use the token_mode fixture
    yield path
    # Each fixture copies a large dataset. Remove the completed copy promptly.
    for database in tmp_path.glob("aegis.db*"):
        database.unlink(missing_ok=True)


@pytest.fixture
def token_mode(db_path, monkeypatch):
    """Run a test with the original username/password sign-in (AEGIS_AUTH_MODE=token)."""
    monkeypatch.setenv("AEGIS_AUTH_MODE", "token")
    return "token"


@pytest.fixture
def conn(db_path):
    c = connect(db_path)
    yield c
    c.close()


@pytest.fixture
def with_passwords(conn):
    """Give every demo user the same known test password."""
    for (user_id,) in conn.execute("SELECT user_id FROM users").fetchall():
        set_user_password(conn, user_id, TEST_PASSWORD)
    return TEST_PASSWORD
