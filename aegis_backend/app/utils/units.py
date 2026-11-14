"""Unit families. Radiation is the one that matters for safety: Gy (absorbed dose)
and Sv (dose equivalent) must never be mixed or compared directly.
"""

SIEVERT_UNITS = frozenset({"Sv", "mSv", "uSv", "Sv/h", "mSv/h", "uSv/h", "mSv/d", "uSv/d"})
GRAY_UNITS = frozenset({"Gy", "mGy", "uGy", "Gy/h", "mGy/h", "uGy/h", "mGy/d", "uGy/d"})


def is_sievert(unit: str | None) -> bool:
    return unit in SIEVERT_UNITS


def is_gray(unit: str | None) -> bool:
    return unit in GRAY_UNITS
