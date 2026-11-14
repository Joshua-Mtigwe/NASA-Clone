"""Medical Research dashboard (Phase 5): analyses, analysis jobs, results and chart data.

An *analysis* is a saved question: does variable X go with variable Y over a date range?
A *job* runs that question against one simulation run and stores its numbers in analysis_results.

Every variable is one value per astronaut per mission day, and days are paired by date.
Jobs only use data from before the run's mission time, so a job never sees the future.

Everything here is exploratory statistics on synthetic demo data. Nothing is a clinical finding.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Any

from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.services import mission_simulator
from app.services.audit_service import write_audit
from app.services.health_changes_service import METRICS as HEALTH_METRICS
from app.utils.statistics import correlation, describe, ranks
from app.utils.timestamps import parse_iso, to_iso, utcnow

METHODS = {
    "descriptive": "Summary of each variable (mean, spread, range). No association is tested.",
    "pearson": "Straight-line association across all astronaut-days pooled together.",
    "spearman": "Rank association across all astronaut-days pooled together (any steady rise or fall).",
    "within_person": "Association within each astronaut: each person's values are centred on their own "
                     "average first, so differences between people cannot create the result.",
}
MIN_PAIRS = 10  # fewer paired days than this and an association is not reported
MIN_PAIRS_PER_ASTRONAUT = 3  # within_person: astronauts with fewer pairs are left out

CAVEAT = ("Exploratory analysis of synthetic demo data. An association is not a cause. Days from the same "
          "astronaut are not independent, so p-values are optimistic, and no correction is made for running "
          "several analyses. Not a clinical finding.")

_COGNITIVE = {  # variable key -> (protocol, label, unit)
    "median_reaction_time_ms": ("PVT", "Reaction time, vigilance test (daily)", "ms"),
    "nback_accuracy_percent": ("NBACK", "Working-memory test accuracy (daily)", "percent"),
    "stroop_accuracy_percent": ("STROOP", "Attention test accuracy (daily)", "percent"),
}
_SLEEP_NOTE = "The night before: sleep that started on the previous calendar day."


def _catalogue() -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for key, (category, label, unit, _sql) in HEALTH_METRICS.items():
        out[key] = {"variable": key, "category": category, "label": label, "unit": unit,
                    "note": _SLEEP_NOTE if category == "sleep" else ""}
    out["accumulated_dose"] = {"variable": "accumulated_dose", "category": "radiation",
                               "label": "Accumulated radiation dose (crew wearable, end of day)", "unit": "mSv",
                               "note": "Rises every day, so it also stands in for time in mission."}
    for key, (_protocol, label, unit) in _COGNITIVE.items():
        out[key] = {"variable": key, "category": "cognition", "label": label, "unit": unit,
                    "note": "From the simulation run's own daily cognitive results."}
    return out


VARIABLES = _catalogue()


def list_variables() -> dict[str, Any]:
    return {"variables": sorted(VARIABLES.values(), key=lambda v: (v["category"], v["variable"])),
            "methods": [{"method": k, "description": v} for k, v in METHODS.items()],
            "caveat": CAVEAT}


# --------------------------------------------------------------------------- the daily dataset

def _day(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def daily_values(conn: sqlite3.Connection, variable: str, astronaut_id: str, start: datetime,
                 end: datetime, as_of: datetime, simulation_run_id: str) -> dict[str, float]:
    """{YYYY-MM-DD: value} for days in [start, end), using only data from before `as_of`."""
    if variable not in VARIABLES:
        raise ValidationFailed(f"Unknown variable '{variable}'", {"allowed": sorted(VARIABLES)})
    cap = min(end, as_of)
    if variable in _COGNITIVE:
        rows = conn.execute(
            """SELECT d.assessment_date AS day, AVG(d.daily_mean) AS value FROM daily_cognitive_results d
               WHERE d.astronaut_id = :a AND d.protocol_id = :p AND d.assessment_date >= :s AND d.assessment_date < :e
                 AND d.assessment_date || 'T08:00:00Z' <= :as_of
                 AND COALESCE((SELECT simulation_run_id FROM daily_result_runs x
                               WHERE x.daily_result_id = d.daily_result_id), :template) = :run
               GROUP BY d.assessment_date""",
            {"a": astronaut_id, "p": _COGNITIVE[variable][0], "s": _day(start), "e": _day(end),
             "as_of": to_iso(as_of), "template": get_settings().default_template_run_id,
             "run": simulation_run_id}).fetchall()
    elif variable == "accumulated_dose":
        rows = conn.execute(
            """SELECT substr(timestamp_utc, 1, 10) AS day, MAX(accumulated_dose) AS value FROM radiation_readings
               WHERE astronaut_id = ? AND accumulated_dose_unit = 'mSv' AND timestamp_utc >= ? AND timestamp_utc < ?
               GROUP BY day""", (astronaut_id, to_iso(start), to_iso(cap))).fetchall()
    elif VARIABLES[variable]["category"] == "sleep":
        # A night is paired with the day that follows it.
        one = timedelta(days=1)
        rows = conn.execute(HEALTH_METRICS[variable][3],
                            (astronaut_id, to_iso(start - one), to_iso(min(end - one, as_of)))).fetchall()
        return {_day(parse_iso(r["day"]) + one): float(r["value"]) for r in rows if r["value"] is not None}
    else:
        rows = conn.execute(HEALTH_METRICS[variable][3], (astronaut_id, to_iso(start), to_iso(cap))).fetchall()
    return {r["day"]: float(r["value"]) for r in rows if r["value"] is not None}


def build_dataset(conn: sqlite3.Connection, analysis: dict[str, Any], *, simulation_run_id: str,
                  as_of: datetime, astronaut_ids: list[str] | None = None) -> dict[str, Any]:
    """Paired (x, y) values per astronaut per day for one analysis."""
    start = parse_iso(analysis["date_range_start"])
    end = parse_iso(analysis["date_range_end"]) + timedelta(days=1)  # the end date is included
    crew = [r["astronaut_id"] for r in conn.execute(
        "SELECT astronaut_id FROM astronauts WHERE mission_id = ? ORDER BY astronaut_id", (analysis["mission_id"],))]
    if astronaut_ids:
        unknown = sorted(set(astronaut_ids) - set(crew))
        if unknown:
            raise ValidationFailed("Astronauts not on this mission", {"unknown": unknown})
        crew = [a for a in crew if a in set(astronaut_ids)]
    x_var, y_var = analysis["independent_variable"], analysis["dependent_variable"]
    points: list[dict[str, Any]] = []
    for astronaut_id in crew:
        xs = daily_values(conn, x_var, astronaut_id, start, end, as_of, simulation_run_id)
        ys = daily_values(conn, y_var, astronaut_id, start, end, as_of, simulation_run_id)
        for day in sorted(set(xs) & set(ys)):
            points.append({"astronaut_id": astronaut_id, "day": day, "x": round(xs[day], 4), "y": round(ys[day], 4)})
    return {"x": VARIABLES[x_var], "y": VARIABLES[y_var], "points": points, "astronauts": crew,
            "window": {"start": _day(start), "end": analysis["date_range_end"], "data_before": to_iso(as_of)}}


# --------------------------------------------------------------------------- statistics

def _strength(r: float) -> str:
    size = abs(r)
    return "negligible" if size < 0.1 else "weak" if size < 0.3 else "moderate" if size < 0.5 else "strong"


def _p_text(p: float | None) -> str:
    return "p not available" if p is None else "p < 0.001" if p < 0.001 else f"p = {p:.3f}"


def _by_astronaut(points: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for p in points:
        groups.setdefault(p["astronaut_id"], []).append(p)
    return groups


def analyse(dataset: dict[str, Any], method: str) -> dict[str, Any]:
    """Pure calculation: result rows plus a summary. Raises ValidationFailed if there is too little data."""
    if method not in METHODS:
        raise ValidationFailed(f"Unknown method '{method}'", {"allowed": list(METHODS)})
    points, x, y = dataset["points"], dataset["x"], dataset["y"]
    groups = _by_astronaut(points)
    if not points:
        raise ValidationFailed(
            f"No days have both {x['variable']} and {y['variable']} before {dataset['window']['data_before']}. "
            "Move the simulation run forward, or pass a later as_of.")
    rows: list[dict[str, Any]] = []
    for var, key in ((x, "x"), (y, "y")):
        d = describe(p[key] for p in points)
        rows.append({"metric_name": var["variable"], "metric_value": d["mean"], "metric_unit": var["unit"],
                     "sample_size": d["n"], "effect_estimate": None, "ci_lower": None, "ci_upper": None,
                     "p_value": None,
                     "interpretation": f"{var['label']}: mean {d['mean']} {var['unit']} (SD {d['sd']}, range "
                                       f"{d['min']} to {d['max']}) over {d['n']} astronaut-days from "
                                       f"{len(groups)} astronauts."})
    per_astronaut = []
    for astronaut_id, pts in sorted(groups.items()):
        c = correlation([p["x"] for p in pts], [p["y"] for p in pts])
        per_astronaut.append({"astronaut_id": astronaut_id, "n": len(pts),
                              "x_mean": describe(p["x"] for p in pts)["mean"],
                              "y_mean": describe(p["y"] for p in pts)["mean"],
                              "r": c["r"] if c else None})
    summary: dict[str, Any] = {"method": method, "pairs": len(points), "astronauts": len(groups),
                               "per_astronaut": per_astronaut, "fit": None, "excluded_astronauts": [],
                               "caveat": CAVEAT}
    if method == "descriptive":
        return {"rows": rows, "summary": summary}

    if len(points) < MIN_PAIRS:
        raise ValidationFailed(f"Only {len(points)} paired days before {dataset['window']['data_before']}; "
                               f"{method} needs at least {MIN_PAIRS}. Move the simulation run forward, "
                               "pass a later as_of, or use the descriptive method.")
    xs, ys = [p["x"] for p in points], [p["y"] for p in points]
    if method == "pearson":
        name, symbol, result = "pearson_r", "r", correlation(xs, ys)
        how = "across all astronaut-days"
    elif method == "spearman":
        name, symbol, result = "spearman_rho", "rho", correlation(ranks(xs), ranks(ys))
        how = "by rank across all astronaut-days"
    else:
        used = {a: pts for a, pts in groups.items() if len(pts) >= MIN_PAIRS_PER_ASTRONAUT}
        summary["excluded_astronauts"] = sorted(set(groups) - set(used))
        cx, cy = [], []
        for pts in used.values():
            mx = sum(p["x"] for p in pts) / len(pts)
            my = sum(p["y"] for p in pts) / len(pts)
            cx += [p["x"] - mx for p in pts]
            cy += [p["y"] - my for p in pts]
        if len(cx) < MIN_PAIRS:
            raise ValidationFailed(f"Only {len(cx)} usable paired days; within_person needs at least {MIN_PAIRS}.")
        # One degree of freedom is spent on each astronaut's own average.
        name, symbol, result = "within_person_r", "r", correlation(cx, cy, df=len(cx) - len(used) - 1)
        how = f"within each of {len(used)} astronauts"
    if result is None:
        raise ValidationFailed(f"{x['variable']} or {y['variable']} does not vary in this window, "
                               "so an association cannot be calculated.")
    r = result["r"]
    p_value = None if result["p_value"] is None else round(result["p_value"], 6)
    slope = None if method == "spearman" else round(result["slope"], 6)
    direction = "higher" if r > 0 else "lower"
    text = (f"{_strength(r).capitalize()} {'positive' if r > 0 else 'negative'} association {how}: higher "
            f"{x['variable']} goes with {direction} {y['variable']} ({symbol} = {r}, 95% CI {result['ci_lower']} "
            f"to {result['ci_upper']}, {_p_text(p_value)}, n = {result['n']}).")
    if _strength(r) == "negligible":
        text = (f"No meaningful association {how} between {x['variable']} and {y['variable']} ({symbol} = {r}, "
                f"95% CI {result['ci_lower']} to {result['ci_upper']}, {_p_text(p_value)}, n = {result['n']}).")
    if slope is not None:
        text += f" Slope: {slope} {y['unit']} per 1 {x['unit']}."
    rows.append({"metric_name": name, "metric_value": r, "metric_unit": "correlation", "sample_size": result["n"],
                 "effect_estimate": slope, "ci_lower": result["ci_lower"], "ci_upper": result["ci_upper"],
                 "p_value": p_value, "interpretation": f"{text} {CAVEAT}"})
    summary["fit"] = {"statistic": name, "value": r, "r_squared": result["r_squared"], "slope": slope,
                      "intercept": None if method != "pearson" else round(result["intercept"], 6),
                      "degrees_of_freedom": result["df"], "strength": _strength(r)}
    return {"rows": rows, "summary": summary}


# --------------------------------------------------------------------------- analyses

def _analysis(conn: sqlite3.Connection, analysis_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM research_analyses WHERE analysis_id = ?", (analysis_id,)).fetchone()
    if row is None:
        raise NotFound(f"Analysis {analysis_id} not found")
    return dict(row)


def list_analyses(conn: sqlite3.Connection, mission_id: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT a.*, (SELECT job_id FROM analysis_jobs j WHERE j.analysis_id = a.analysis_id
                        AND j.status = 'completed' ORDER BY j.completed_at DESC, j.rowid DESC LIMIT 1) AS latest_job_id,
                  (SELECT COUNT(*) FROM analysis_jobs j WHERE j.analysis_id = a.analysis_id) AS job_count
           FROM research_analyses a WHERE (:m IS NULL OR a.mission_id = :m) ORDER BY a.created_at, a.analysis_id""",
        {"m": mission_id}).fetchall()
    return [dict(r) for r in rows]


def get_analysis(conn: sqlite3.Connection, analysis_id: str) -> dict[str, Any]:
    analysis = _analysis(conn, analysis_id)
    analysis["independent"] = VARIABLES.get(analysis["independent_variable"])
    analysis["dependent"] = VARIABLES.get(analysis["dependent_variable"])
    analysis["jobs"] = list_jobs(conn, analysis_id=analysis_id)
    return analysis


def create_analysis(conn: sqlite3.Connection, *, actor_user_id: str, research_question: str,
                    independent_variable: str, dependent_variable: str, analysis_method: str = "within_person",
                    date_range_start: str | None = None, date_range_end: str | None = None,
                    mission_id: str = "MIS-001", analysis_type: str | None = None) -> dict[str, Any]:
    for variable in (independent_variable, dependent_variable):
        if variable not in VARIABLES:
            raise ValidationFailed(f"Unknown variable '{variable}'", {"allowed": sorted(VARIABLES)})
    if independent_variable == dependent_variable:
        raise ValidationFailed("The two variables must be different")
    if analysis_method not in METHODS:
        raise ValidationFailed(f"Unknown method '{analysis_method}'", {"allowed": list(METHODS)})
    mission = conn.execute("SELECT * FROM missions WHERE mission_id = ?", (mission_id,)).fetchone()
    if mission is None:
        raise NotFound(f"Mission {mission_id} not found")
    try:
        start = parse_iso(date_range_start) if date_range_start else None
        end = parse_iso(date_range_end) if date_range_end else None
    except ValueError as exc:
        raise ValidationFailed("Dates must look like 2027-03-01") from exc
    if start is None or end is None:
        bounds = conn.execute("SELECT MIN(task_date), MAX(task_date) FROM daily_task_sets WHERE mission_id = ?",
                              (mission_id,)).fetchone()
        if bounds[0] is None:
            raise ValidationFailed("date_range_start and date_range_end are required for this mission")
        start, end = start or parse_iso(bounds[0]), end or parse_iso(bounds[1])
    if start > end:
        raise ValidationFailed("date_range_start must not be after date_range_end")
    analysis_id = f"ANL-{uuid.uuid4().hex[:10].upper()}"
    conn.execute(
        """INSERT INTO research_analyses (analysis_id, researcher_user_id, mission_id, analysis_type,
               research_question, independent_variable, dependent_variable, analysis_method, date_range_start,
               date_range_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (analysis_id, actor_user_id, mission_id, analysis_type or f"{independent_variable}_vs_{dependent_variable}",
         research_question.strip(), independent_variable, dependent_variable, analysis_method, _day(start),
         _day(end), to_iso(utcnow())))
    write_audit(conn, user_id=actor_user_id, action_type="create_analysis", entity_type="research_analysis",
                entity_id=analysis_id, action_result="success",
                change_summary=f"{independent_variable} vs {dependent_variable} ({analysis_method})", commit=False)
    conn.commit()
    return get_analysis(conn, analysis_id)


# --------------------------------------------------------------------------- jobs

def _job_row(conn: sqlite3.Connection, job_id: str) -> dict[str, Any]:
    row = conn.execute(
        """SELECT j.*, d.parameters_json, d.summary_json FROM analysis_jobs j
           LEFT JOIN analysis_job_details d ON d.job_id = j.job_id WHERE j.job_id = ?""", (job_id,)).fetchone()
    if row is None:
        raise NotFound(f"Analysis job {job_id} not found")
    job = dict(row)
    job["parameters"] = json.loads(job.pop("parameters_json") or "{}")
    job["summary"] = json.loads(job.pop("summary_json") or "null")
    return job


def job_results(conn: sqlite3.Connection, job_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT r.* FROM analysis_results r JOIN analysis_result_jobs x
           ON x.analysis_result_id = r.analysis_result_id WHERE x.job_id = ? ORDER BY r.analysis_result_id""",
        (job_id,)).fetchall()
    return [dict(r) for r in rows]


def get_job(conn: sqlite3.Connection, job_id: str) -> dict[str, Any]:
    job = _job_row(conn, job_id)
    job["results"] = job_results(conn, job_id)
    return job


def list_jobs(conn: sqlite3.Connection, *, analysis_id: str | None = None, simulation_run_id: str | None = None,
              status: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT * FROM analysis_jobs WHERE (:a IS NULL OR analysis_id = :a)
              AND (:r IS NULL OR simulation_run_id = :r) AND (:s IS NULL OR status = :s)
           ORDER BY submitted_at DESC, rowid DESC""",
        {"a": analysis_id, "r": simulation_run_id, "s": status}).fetchall()
    return [dict(r) for r in rows]


def latest_job_id(conn: sqlite3.Connection, analysis_id: str, simulation_run_id: str | None = None) -> str:
    _analysis(conn, analysis_id)
    row = conn.execute(
        """SELECT job_id FROM analysis_jobs WHERE analysis_id = :a AND status = 'completed'
              AND (:r IS NULL OR simulation_run_id = :r) ORDER BY completed_at DESC, rowid DESC LIMIT 1""",
        {"a": analysis_id, "r": simulation_run_id}).fetchone()
    if row is None:
        raise NotFound(f"Analysis {analysis_id} has no completed job yet. Run it first.")
    return row["job_id"]


def run_analysis_job(conn: sqlite3.Connection, analysis_id: str, *, actor_user_id: str,
                     simulation_run_id: str | None = None, method: str | None = None,
                     as_of: datetime | None = None, astronaut_ids: list[str] | None = None) -> dict[str, Any]:
    """Run an analysis now and store its results. Returns the finished job.

    A job that cannot be calculated (for example, too little data yet) is kept with status 'failed'
    and a plain-English error_message; nothing is written to analysis_results for it.
    """
    analysis = _analysis(conn, analysis_id)
    run_id = simulation_run_id or get_settings().default_template_run_id
    mission_now = parse_iso(mission_simulator.get_simulation_state(conn, run_id)["current_mission_time"])
    method = method or analysis["analysis_method"]
    if method not in METHODS:
        raise ValidationFailed(f"Unknown method '{method}'", {"allowed": list(METHODS)})
    for variable in (analysis["independent_variable"], analysis["dependent_variable"]):
        if variable not in VARIABLES:
            raise ValidationFailed(f"Analysis {analysis_id} uses unknown variable '{variable}'",
                                   {"allowed": sorted(VARIABLES)})
    cutoff = as_of or mission_now
    parameters = {"method": method, "as_of": to_iso(cutoff), "as_of_source": "request" if as_of else "run_clock",
                  "astronaut_ids": sorted(astronaut_ids) if astronaut_ids else None}
    job_id = f"JOB-{uuid.uuid4().hex[:12].upper()}"
    now = to_iso(utcnow())
    conn.execute(
        """INSERT INTO analysis_jobs (job_id, analysis_id, simulation_run_id, requested_by_user_id, method, status,
               submitted_at, started_at, completed_at, error_message) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, NULL, NULL)""",
        (job_id, analysis_id, run_id, actor_user_id, method, now, now))
    conn.execute("INSERT INTO analysis_job_details (job_id, parameters_json, summary_json) VALUES (?, ?, NULL)",
                 (job_id, json.dumps(parameters, sort_keys=True)))
    try:
        dataset = build_dataset(conn, analysis, simulation_run_id=run_id, as_of=cutoff, astronaut_ids=astronaut_ids)
        outcome = analyse(dataset, method)
    except ValidationFailed as exc:
        conn.execute("UPDATE analysis_jobs SET status = 'failed', completed_at = ?, error_message = ? WHERE job_id = ?",
                     (to_iso(utcnow()), exc.message, job_id))
        write_audit(conn, user_id=actor_user_id, action_type="run_analysis_job", entity_type="analysis_job",
                    entity_id=job_id, action_result="failed", change_summary=exc.message[:200], commit=False)
        conn.commit()
        return get_job(conn, job_id)

    done = to_iso(utcnow())
    for i, row in enumerate(outcome["rows"], start=1):
        result_id = f"ARS-{job_id[4:]}-{i:02d}"
        conn.execute(
            """INSERT INTO analysis_results (analysis_result_id, analysis_id, metric_name, metric_value, metric_unit,
                   sample_size, effect_estimate, confidence_interval_lower, confidence_interval_upper, p_value,
                   interpretation, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (result_id, analysis_id, row["metric_name"], row["metric_value"], row["metric_unit"], row["sample_size"],
             row["effect_estimate"], row["ci_lower"], row["ci_upper"], row["p_value"], row["interpretation"], done))
        conn.execute("INSERT INTO analysis_result_jobs (analysis_result_id, job_id) VALUES (?, ?)", (result_id, job_id))
    summary = {**outcome["summary"], "window": dataset["window"]}
    conn.execute("UPDATE analysis_job_details SET summary_json = ? WHERE job_id = ?",
                 (json.dumps(summary, sort_keys=True), job_id))
    conn.execute("UPDATE analysis_jobs SET status = 'completed', completed_at = ? WHERE job_id = ?", (done, job_id))
    write_audit(conn, user_id=actor_user_id, action_type="run_analysis_job", entity_type="analysis_job",
                entity_id=job_id, action_result="success",
                change_summary=f"{analysis_id} {method} on {run_id}, {summary['pairs']} paired days", commit=False)
    conn.commit()
    return get_job(conn, job_id)


# --------------------------------------------------------------------------- charts

def get_chart(conn: sqlite3.Connection, job_id: str) -> dict[str, Any]:
    """Scatter points and a fitted line for a completed job, rebuilt from the job's own settings."""
    job = _job_row(conn, job_id)
    if job["status"] != "completed":
        raise ValidationFailed(f"Job {job_id} is '{job['status']}', so it has no chart",
                               {"error_message": job["error_message"]})
    analysis = _analysis(conn, job["analysis_id"])
    params = job["parameters"]
    dataset = build_dataset(conn, analysis, simulation_run_id=job["simulation_run_id"],
                            as_of=parse_iso(params["as_of"]), astronaut_ids=params.get("astronaut_ids"))
    points = dataset["points"]
    fit = (job["summary"] or {}).get("fit")
    lines: list[dict[str, Any]] = []
    if fit and fit.get("slope") is not None and points:
        def segment(pts: list[dict], intercept: float, label: str) -> dict[str, Any]:
            lo, hi = min(p["x"] for p in pts), max(p["x"] for p in pts)
            return {"label": label, "from": {"x": lo, "y": round(intercept + fit["slope"] * lo, 4)},
                    "to": {"x": hi, "y": round(intercept + fit["slope"] * hi, 4)}}
        if job["method"] == "pearson":
            lines.append(segment(points, fit["intercept"], "all astronauts"))
        else:  # within_person: one shared slope, each astronaut's own level
            for astronaut_id, pts in sorted(_by_astronaut(points).items()):
                if astronaut_id in (job["summary"].get("excluded_astronauts") or []):
                    continue
                mx = sum(p["x"] for p in pts) / len(pts)
                my = sum(p["y"] for p in pts) / len(pts)
                lines.append(segment(pts, my - fit["slope"] * mx, astronaut_id))
    return {"job_id": job_id, "analysis_id": analysis["analysis_id"], "chart_type": "scatter",
            "title": f"{dataset['x']['label']} vs {dataset['y']['label']}",
            "x_axis": dataset["x"], "y_axis": dataset["y"], "window": dataset["window"],
            "method": job["method"], "fit": fit, "points": points, "lines": lines,
            "series": [{"astronaut_id": a, "points": pts} for a, pts in sorted(_by_astronaut(points).items())],
            "caveat": CAVEAT}
