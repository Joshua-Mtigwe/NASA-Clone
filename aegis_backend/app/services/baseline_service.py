"""Preflight baselines (plan section 3, Phase 3).

A baseline is one astronaut's normal for one test at one time of day ("context-matched"):
the preflight results for that astronaut x protocol x condition (morning / evening),
summarised as median, mean, sample SD and a reference range of mean +/- 2 SD.

Baselines are versioned and never edited. freeze_baseline_version writes a new version
(v2, v3, ...) alongside the old ones; comparisons use the newest version and record which
baseline_id they used, so every comparison stays traceable.

Rebuilding from the seed data reproduces the seeded v1 values exactly, except that new
versions clip the range to what the scale allows (accuracy 0-100 %, fatigue 1-9); v1 has
accuracy upper bounds above 100 %. Clipping never changes which scores fall inside or
outside, since no score can lie beyond the scale.
(SURVEY morning and evening baselines are identical in the seed because its evening fatigue
scores have the same statistics as the morning ones; they are still computed separately.)
"""
from __future__ import annotations

import re
import sqlite3
import statistics
from typing import Any

from app.core.errors import NotFound, ValidationFailed
from app.services.audit_service import write_audit
from app.services.health_context import require_astronaut
from app.utils.timestamps import to_iso, utcnow

MIN_BASELINE_SAMPLES = 20  # the seed has 28 (one per preflight day)
RANGE_SD = 2.0
SCALE_BOUNDS = {
    "accuracy_percent": (0.0, 100.0),
    "fatigue_score": (1.0, 9.0),
    "median_reaction_time_ms": (0.0, None),
}


def version_number(label: str | None) -> int:
    """'v12' -> 12. Unknown labels sort first."""
    match = re.fullmatch(r"v(\d+)", label or "")
    return int(match.group(1)) if match else 0


def group_assessments_by_condition(conn: sqlite3.Connection, astronaut_id: str,
                                   mission_phase: str = "preflight") -> dict[tuple[str, str], list[dict]]:
    """Valid, completed results grouped by (protocol_id, assessment_condition)."""
    require_astronaut(conn, astronaut_id)
    rows = conn.execute(
        """SELECT s.protocol_id, s.assessment_condition, s.started_at, r.result_id, r.metric_value,
                  r.metric_name, r.metric_unit, r.cognitive_domain
           FROM assessment_sessions s JOIN assessment_results r ON r.session_id = s.session_id
           WHERE s.astronaut_id = ? AND s.mission_phase = ? AND s.session_status = 'completed'
             AND s.quality_status = 'valid'
           ORDER BY s.started_at""", (astronaut_id, mission_phase)).fetchall()
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        groups.setdefault((r["protocol_id"], r["assessment_condition"]), []).append(dict(r))
    return groups


def check_baseline_sample_size(n: int, minimum: int = MIN_BASELINE_SAMPLES) -> None:
    if n < minimum:
        raise ValidationFailed(f"Baseline needs at least {minimum} valid preflight sessions; found {n}")


def _summarise(values: list[float], metric_name: str, clip: bool) -> dict[str, Any]:
    mean = statistics.fmean(values)
    sd = statistics.stdev(values)
    lower, upper = mean - RANGE_SD * sd, mean + RANGE_SD * sd
    if clip and metric_name in SCALE_BOUNDS:
        lo, hi = SCALE_BOUNDS[metric_name]
        lower = max(lower, lo) if lo is not None else lower
        upper = min(upper, hi) if hi is not None else upper
    return {
        "median_value": round(statistics.median(values), 2),
        "mean_value": round(mean, 2),
        "standard_deviation": round(sd, 2),
        "reference_lower": round(lower, 2),
        "reference_upper": round(upper, 2),
        "sample_size": len(values),
    }


def build_astronaut_baseline(conn: sqlite3.Connection, astronaut_id: str, protocol_id: str,
                             condition: str, clip_to_scale: bool = True) -> dict[str, Any]:
    """Compute (not save) one baseline from preflight results."""
    results = group_assessments_by_condition(conn, astronaut_id).get((protocol_id, condition), [])
    check_baseline_sample_size(len(results))
    first = results[0]
    return {
        "astronaut_id": astronaut_id, "protocol_id": protocol_id, "assessment_condition": condition,
        "cognitive_domain": first["cognitive_domain"], "metric_name": first["metric_name"],
        "metric_unit": first["metric_unit"],
        **_summarise([r["metric_value"] for r in results], first["metric_name"], clip_to_scale),
        "source_window": {"first": results[0]["started_at"], "last": results[-1]["started_at"]},
    }


def get_baselines(conn: sqlite3.Connection, astronaut_id: str, version: str | None = None) -> list[dict[str, Any]]:
    """The newest baseline per protocol and condition, or every baseline of one version."""
    require_astronaut(conn, astronaut_id)
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM cognitive_baselines WHERE astronaut_id = ? ORDER BY protocol_id, assessment_condition",
        (astronaut_id,))]
    if version:
        selected = [r for r in rows if r["baseline_version"] == version]
        if not selected:
            raise NotFound(f"No baselines with version {version} for {astronaut_id}")
        return selected
    latest: dict[tuple[str, str], dict] = {}
    for r in rows:
        key = (r["protocol_id"], r["assessment_condition"])
        if key not in latest or version_number(r["baseline_version"]) > version_number(latest[key]["baseline_version"]):
            latest[key] = r
    return list(latest.values())


def find_matching_baseline(conn: sqlite3.Connection, astronaut_id: str, protocol_id: str,
                           condition: str) -> dict[str, Any]:
    """Newest baseline for the same astronaut, protocol and time of day."""
    rows = [dict(r) for r in conn.execute(
        """SELECT * FROM cognitive_baselines
           WHERE astronaut_id = ? AND protocol_id = ? AND assessment_condition = ?""",
        (astronaut_id, protocol_id, condition))]
    if not rows:
        raise NotFound(f"No {condition} {protocol_id} baseline for {astronaut_id}")
    return max(rows, key=lambda r: version_number(r["baseline_version"]))


def freeze_baseline_version(conn: sqlite3.Connection, *, actor_user_id: str | None,
                            astronaut_ids: list[str] | None = None, clip_to_scale: bool = True) -> dict[str, Any]:
    """Compute baselines from current preflight data and save them as a new version.

    Groups with too few sessions are skipped and listed. Nothing is saved if no group qualifies.
    """
    ids = astronaut_ids or [r[0] for r in conn.execute("SELECT astronaut_id FROM astronauts ORDER BY astronaut_id")]
    for astronaut_id in ids:
        require_astronaut(conn, astronaut_id)
    existing = [r[0] for r in conn.execute("SELECT DISTINCT baseline_version FROM cognitive_baselines")]
    version = f"v{max([version_number(v) for v in existing] + [0]) + 1}"
    calculated_at = to_iso(utcnow())

    created, skipped = [], []
    for astronaut_id in ids:
        for (protocol_id, condition), results in sorted(group_assessments_by_condition(conn, astronaut_id).items()):
            try:
                check_baseline_sample_size(len(results))
            except ValidationFailed as exc:
                skipped.append({"astronaut_id": astronaut_id, "protocol_id": protocol_id,
                                "assessment_condition": condition, "reason": exc.message})
                continue
            b = build_astronaut_baseline(conn, astronaut_id, protocol_id, condition, clip_to_scale)
            baseline_id = f"BASE-{astronaut_id}-{condition}-{protocol_id}-{version}"
            conn.execute(
                """INSERT INTO cognitive_baselines (baseline_id, astronaut_id, protocol_id, assessment_condition,
                       cognitive_domain, metric_name, metric_unit, median_value, mean_value, standard_deviation,
                       reference_lower, reference_upper, sample_size, baseline_version, calculated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (baseline_id, astronaut_id, protocol_id, condition, b["cognitive_domain"], b["metric_name"],
                 b["metric_unit"], b["median_value"], b["mean_value"], b["standard_deviation"],
                 b["reference_lower"], b["reference_upper"], b["sample_size"], version, calculated_at))
            created.append(baseline_id)
    if not created:
        conn.rollback()
        raise ValidationFailed("No baseline group has enough preflight sessions", skipped)
    write_audit(conn, user_id=actor_user_id, action_type="freeze_baseline_version", entity_type="cognitive_baseline",
                entity_id=version, action_result="success",
                change_summary=f"{len(created)} baselines for {len(ids)} astronauts; {len(skipped)} skipped",
                commit=False)
    conn.commit()
    return {"baseline_version": version, "calculated_at": calculated_at, "created": created, "skipped": skipped}
