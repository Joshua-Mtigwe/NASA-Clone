"""Application settings, read from environment variables (or a .env file you load yourself).

Kept dependency-free on purpose: the services layer only needs the standard library.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    """Minimal .env reader: KEY=VALUE lines, # comments. Real env vars win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    database_path: Path
    seed_dir: Path
    token_ttl_hours: int
    pbkdf2_iterations: int
    default_template_run_id: str
    cors_origins: tuple[str, ...]
    gemma_url: str
    gemma_model: str
    gemma_timeout_seconds: float
    gemma_allow_remote: bool


def get_settings() -> Settings:
    """Read settings fresh each call so tests can change env vars."""
    db = os.environ.get("AEGIS_DATABASE_PATH", str(PROJECT_ROOT / "aegis.db"))
    seed = os.environ.get("AEGIS_SEED_DIR", str(PROJECT_ROOT / "data" / "seed"))
    origins = os.environ.get("AEGIS_CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")
    return Settings(
        database_path=Path(db),
        seed_dir=Path(seed),
        token_ttl_hours=int(os.environ.get("AEGIS_TOKEN_TTL_HOURS", "12")),
        pbkdf2_iterations=int(os.environ.get("AEGIS_PBKDF2_ITERATIONS", "600000")),
        default_template_run_id=os.environ.get("AEGIS_TEMPLATE_RUN_ID", "RUN-DEMO-001"),
        cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        gemma_url=os.environ.get("AEGIS_GEMMA_URL", "http://127.0.0.1:11434").rstrip("/"),
        gemma_model=os.environ.get("AEGIS_GEMMA_MODEL", "gemma3:4b"),
        gemma_timeout_seconds=float(os.environ.get("AEGIS_GEMMA_TIMEOUT_SECONDS", "120")),
        gemma_allow_remote=os.environ.get("AEGIS_GEMMA_ALLOW_REMOTE", "false").strip().lower() in ("1", "true", "yes"),
    )
