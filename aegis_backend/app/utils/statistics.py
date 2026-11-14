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


# --------------------------------------------------------------------------- association (research phase)

def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (modified Lentz)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 301):
        m2 = 2 * m
        for aa in (m * (b - m) * x / ((qam + m2) * (a + m2)),
                   -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))):
            d = 1.0 + aa * d
            d = 1.0 / (d if abs(d) > tiny else tiny)
            c = 1.0 + aa / c
            c = c if abs(c) > tiny else tiny
            delta = d * c
            h *= delta
        if abs(delta - 1.0) < 1e-14:
            break
    return h


def regularized_incomplete_beta(a: float, b: float, x: float) -> float:
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def t_two_sided_p(t: float, df: float) -> float | None:
    """Two-sided p-value of Student's t with df degrees of freedom."""
    if df <= 0 or t is None or math.isnan(t):
        return None
    if math.isinf(t):
        return 0.0
    return regularized_incomplete_beta(df / 2.0, 0.5, df / (df + t * t))


def ranks(values: Sequence[float]) -> list[float]:
    """1-based ranks; ties share their average rank."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2.0 + 1.0
        i = j + 1
    return out


def correlation(xs: Sequence[float], ys: Sequence[float], *, df: int | None = None,
                confidence: float = 0.95) -> dict | None:
    """Pearson r of paired values with slope, intercept, a Fisher-z confidence interval and a t-test p-value.

    `df` overrides the degrees of freedom (default n - 2); the within-person method uses it to
    account for the per-astronaut means it removed. Returns None when r is undefined
    (fewer than 3 pairs, or either variable has no spread).
    """
    n = len(xs)
    if n != len(ys):
        raise ValueError("xs and ys must be the same length")
    if n < 3:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    r = max(-1.0, min(1.0, sxy / math.sqrt(sxx * syy)))
    df = n - 2 if df is None else df
    if df < 1:
        return None
    p = 0.0 if abs(r) >= 1.0 else t_two_sided_p(r * math.sqrt(df / (1.0 - r * r)), df)
    lower = upper = None
    if df > 1 and abs(r) < 1.0:  # Fisher z, standard error 1 / sqrt(df - 1)  (= 1 / sqrt(n - 3) for plain Pearson)
        half = statistics.NormalDist().inv_cdf(0.5 + confidence / 2.0) / math.sqrt(df - 1)
        z = math.atanh(r)
        lower, upper = round(math.tanh(z - half), 4), round(math.tanh(z + half), 4)
    slope = sxy / sxx
    return {"n": n, "df": df, "r": round(r, 4), "r_squared": round(r * r, 4), "p_value": p,
            "ci_lower": lower, "ci_upper": upper, "slope": slope, "intercept": my - slope * mx}
