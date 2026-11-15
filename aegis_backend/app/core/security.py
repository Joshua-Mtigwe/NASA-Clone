"""Password hashing and session tokens, standard library only.

Passwords: PBKDF2-HMAC-SHA256 with a per-user random salt. The stored string carries
its own iteration count, so raising AEGIS_PBKDF2_ITERATIONS later does not break old hashes.
Tokens: random 256-bit bearer tokens; only their SHA-256 is stored in auth_sessions.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

from app.core.config import get_settings

HASH_SCHEME = "pbkdf2_sha256"


def hash_password(password: str, iterations: int | None = None) -> str:
    if not password or len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    iterations = iterations or get_settings().pbkdf2_iterations
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "$".join(
        [HASH_SCHEME, str(iterations), base64.b64encode(salt).decode(), base64.b64encode(digest).decode()]
    )


def is_real_password_hash(stored: str | None) -> bool:
    """False for the seed placeholder (DEMO_ACCOUNT_NO_PASSWORD) or anything malformed."""
    return bool(stored) and stored.startswith(HASH_SCHEME + "$") and stored.count("$") == 3


def verify_password(password: str, stored: str | None) -> bool:
    if not is_real_password_hash(stored):
        return False
    _, iterations, salt_b64, digest_b64 = stored.split("$")
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), base64.b64decode(salt_b64), int(iterations)
    )
    return hmac.compare_digest(digest, base64.b64decode(digest_b64))


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
