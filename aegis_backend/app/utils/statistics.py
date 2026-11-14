"""Small, dependency-free statistics helpers used by the health services.

These are descriptive only. Nothing here encodes a clinical threshold.
"""
from __future__ import annotations

import math
import statistics
from typing import Iterable, Sequence


def describe(values: Iterable[float | None]) -> dict:
    """n, mean, sd (sample), min, max and median of the non-null values."""
    xs = [float(v) for v in values if v is not None]
    if not xs:
        return {"n": 0, "mean": None, "sd": None, "min": None, "max": None, "median": None}
    return {
        "n": len(xs),
        "mean": round(statistics.fmean(xs), 4),
        "sd": round(statistics.stdev(xs), 4) if len(xs) > 1 else None,
        "min": round(min(xs), 4),
        "max": round(max(xs), 4),
        "median": round(statistics.median(xs), 4),
    }


def rolling_mean(values: Sequence[float | None], window: int) -> list[float | None]:
    """Trailing rolling mean. Positions with fewer than `window` non-null values give None."""
    if window < 1:
        raise ValueError("window must be at least 1")
    out: list[float | None] = []
    for i in range(len(values)):
        chunk = [v for v in values[max(0, i - window + 1): i + 1] if v is not None]
        out.append(round(statistics.fmean(chunk), 4) if len(chunk) == window else None)
    return out


def linear_slope(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    """Least-squares slope of y on x. None if fewer than 3 points or x has no spread."""
    pairs = [(float(x), float(y)) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    mx = statistics.fmean(p[0] for p in pairs)
    my = statistics.fmean(p[1] for p in pairs)
    sxx = sum((x - mx) ** 2 for x, _ in pairs)
    if sxx == 0:
        return None
    return round(sum((x - mx) * (y - my) for x, y in pairs) / sxx, 6)


def percent_change(reference: float | None, current: float | None) -> float | None:
    if reference in (None, 0) or current is None:
        return None
    return round((current - reference) / abs(reference) * 100, 2)


def standardized_change(reference_mean: float | None, reference_sd: float | None,
                        current: float | None) -> float | None:
    """(current - reference mean) / reference SD. None when the SD is missing or zero."""
    if reference_mean is None or current is None or not reference_sd or math.isclose(reference_sd, 0):
        return None
    return round((current - reference_mean) / reference_sd, 3)
