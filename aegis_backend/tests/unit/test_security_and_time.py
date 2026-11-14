from datetime import timezone

import pytest

from app.core.security import hash_password, hash_token, is_real_password_hash, verify_password
from app.utils.timestamps import parse_iso, to_iso
from app.utils.units import is_gray, is_sievert


def test_password_round_trip():
    stored = hash_password("correct horse", iterations=1000)
    assert stored.startswith("pbkdf2_sha256$1000$")
    assert verify_password("correct horse", stored)
    assert not verify_password("wrong horse", stored)


def test_same_password_gets_different_salt():
    assert hash_password("same-password", iterations=1000) != hash_password("same-password", iterations=1000)


def test_seed_placeholder_never_verifies():
    assert not is_real_password_hash("DEMO_ACCOUNT_NO_PASSWORD")
    assert not verify_password("DEMO_ACCOUNT_NO_PASSWORD", "DEMO_ACCOUNT_NO_PASSWORD")
    assert not verify_password("anything", None)


def test_short_password_rejected():
    with pytest.raises(ValueError):
        hash_password("short")


def test_token_hash_is_stable_and_not_the_token():
    assert hash_token("abc") == hash_token("abc")
    assert hash_token("abc") != "abc"


def test_parse_iso_formats():
    assert parse_iso("2027-03-01T08:00:00Z").tzinfo == timezone.utc
    assert parse_iso("2027-03-01").hour == 0
    assert to_iso(parse_iso("2027-03-01T08:00:00+00:00")) == "2027-03-01T08:00:00Z"
    with pytest.raises(ValueError):
        parse_iso("2027-03-01T08:00:00")  # no timezone
    with pytest.raises(ValueError):
        parse_iso("not a date")


def test_radiation_unit_families_do_not_overlap():
    assert is_sievert("uSv/h") and not is_gray("uSv/h")
    assert is_gray("uGy/h") and not is_sievert("uGy/h")
