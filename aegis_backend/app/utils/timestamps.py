"""ISO-8601 UTC helpers. The database stores timestamps as text like 2027-03-01T08:00:00Z."""
from __future__ import annotations

from datetime import date, datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso(value: str) -> datetime:
    """Parse '2027-03-01T08:00:00Z', '2027-03-01T08:00:00+00:00' or a bare date '2027-03-01'.

    Always returns an aware UTC datetime. Raises ValueError on anything else.
    """
    text = value.strip()
    if len(text) == 10:
        d = date.fromisoformat(text)
        return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        raise ValueError(f"Timestamp has no timezone: {value!r}")
    return dt.astimezone(timezone.utc)


def to_iso(dt: datetime) -> str:
    """Format as 2027-03-01T08:00:00Z (whole seconds), matching the seed CSVs."""
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
