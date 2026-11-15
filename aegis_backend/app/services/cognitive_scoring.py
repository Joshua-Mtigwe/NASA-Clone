"""Cognitive scoring (plan section 3, Phase 3).

Turns a session's trials into one score, using the protocol catalogue (assessment_protocols)
and the metric registry (metric_definitions):

  PVT    -> median_reaction_time_ms   (vigilance,         lower is better)
  NBACK  -> accuracy_percent          (working_memory,    higher is better)
  STROOP -> accuracy_percent          (attention,         higher is better)
  SURVEY -> fatigue_score             (subjective_fatigue, lower is better; no trials,
                                       the score is the self-report on the session's context)

Scoring is deterministic: the same stored trials always give the same score. Scores are rounded
to 2 decimals, as in the seed. Correctness is always recomputed on the server
(actual_response == expected_response); a client's own is_correct is never trusted.

PVT lapse (>= 500 ms) and false start (< 100 ms) use the standard PVT research conventions.
They describe the test, not the person's health.
"""
from __future__ import annotations

import sqlite3
import statistics
from typing import Any, Iterable

from app.core.errors import NotFound, ValidationFailed

SCORING_VERSION = "v1"
PVT_LAPSE_MS = 500.0
PVT_FALSE_START_MS = 100.0
MIN_SCORABLE_TRIALS = 10

# Which cognitive domain each protocol measures (selects the matching metric_definitions row).
PROTOCOL_DOMAIN = {
    "PVT": "vigilance",
    "NBACK": "working_memory",
    "STROOP": "attention",
    "SURVEY": "subjective_fatigue",
}
TRIAL_PROTOCOLS = frozenset({"PVT", "NBACK", "STROOP"})


# Prototype definitions already implemented by the frontend battery. These are
# opt-in for the integrated console; legacy callers keep the original registry.
EXTENDED_DOMAIN = {'SWITCH':'cognitive_flexibility','SYMBOL':'processing_speed',
                   'ROTATION':'spatial_reasoning','REASONING':'reasoning'}


def score_symbol_test(trials):
    # Port of existing mock scoring: correct responses / summed response minutes.
    if len(trials) < MIN_SCORABLE_TRIALS:
        return {'scorable':False,'reason':f'only {len(trials)} trials (need {MIN_SCORABLE_TRIALS})'}
    elapsed = sum(max(t['reaction_time_ms'] or 0, 0) for t in trials) / 60000
    if elapsed <= 0:
        return {'scorable':False,'reason':'No response duration available'}
    return {'scorable':True,'metric_value':round(sum(t['is_correct'] for t in trials)/elapsed,2),
            'valid_trials':len(trials),'details':{'definition':'existing frontend response-time rate; prototype, not clinically validated'}}


# --------------------------------------------------------------------------- registry

def get_metric_definition(conn: sqlite3.Connection, metric_name: str, cognitive_domain: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM metric_definitions WHERE metric_name = ? AND cognitive_domain = ?",
        (metric_name, cognitive_domain)).fetchone()
    if row is None:
        raise NotFound(f"No metric definition for {metric_name} / {cognitive_domain}")
    return dict(row)


def list_metric_definitions(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT * FROM metric_definitions ORDER BY metric_id")]


def validate_metric_direction(definition: dict[str, Any]) -> str:
    direction = definition.get("better_direction")
    if direction not in ("higher_is_better", "lower_is_better"):
        raise ValidationFailed(f"Metric {definition.get('metric_id')} has no valid better_direction: {direction!r}")
    return direction


def validate_scoring_protocol(conn: sqlite3.Connection, protocol_id: str, *, extended: bool = False) -> dict[str, Any]:
    """Check a protocol can be scored: active, supported, and with a metric definition.

    Returns {"protocol": ..., "metric": ...}. SWITCH exists in the catalogue but has no scorer
    or metric definition yet, so it is refused rather than scored wrongly.
    """
    protocol = conn.execute("SELECT * FROM assessment_protocols WHERE protocol_id = ?", (protocol_id,)).fetchone()
    if protocol is None:
        raise NotFound(f"Protocol {protocol_id} not found")
    if str(protocol["is_active"]).lower() not in ("true", "1"):
        raise ValidationFailed(f"Protocol {protocol_id} is not active")
    domains = {**PROTOCOL_DOMAIN, **EXTENDED_DOMAIN} if extended else PROTOCOL_DOMAIN
    if protocol_id not in domains:
        raise ValidationFailed(f"Protocol {protocol_id} has no scoring implementation in {SCORING_VERSION}")
    metric = get_metric_definition(conn, protocol["scoring_method"], domains[protocol_id])
    validate_metric_direction(metric)
    return {"protocol": dict(protocol), "metric": metric}


# --------------------------------------------------------------------------- per-test scorers

def _rt(trials: Iterable[dict]) -> list[float]:
    return [float(t["reaction_time_ms"]) for t in trials if t.get("reaction_time_ms") is not None]


def score_reaction_time_test(trials: list[dict]) -> dict[str, Any]:
    """PVT: median reaction time of responses that are not false starts."""
    responses = _rt(trials)
    valid = [rt for rt in responses if rt >= PVT_FALSE_START_MS]
    if len(valid) < MIN_SCORABLE_TRIALS:
        return {"scorable": False, "reason": f"only {len(valid)} valid responses (need {MIN_SCORABLE_TRIALS})"}
    return {
        "scorable": True,
        "metric_value": round(statistics.median(valid), 2),
        "valid_trials": len(valid),
        "details": {
            "mean_reaction_time_ms": round(statistics.fmean(valid), 2),
            "lapses": sum(rt >= PVT_LAPSE_MS for rt in responses),
            "false_starts": sum(rt < PVT_FALSE_START_MS for rt in responses),
            "no_response": len(trials) - len(responses),
        },
    }


def _accuracy(trials: list[dict]) -> dict[str, Any]:
    if len(trials) < MIN_SCORABLE_TRIALS:
        return {"scorable": False, "reason": f"only {len(trials)} trials (need {MIN_SCORABLE_TRIALS})"}
    correct = [t for t in trials if t["is_correct"]]
    correct_rt = _rt(correct)
    return {
        "scorable": True,
        "metric_value": round(100.0 * len(correct) / len(trials), 2),
        "valid_trials": len(trials),
        "details": {
            "correct": len(correct),
            "incorrect": len(trials) - len(correct),
            "mean_correct_reaction_time_ms": round(statistics.fmean(correct_rt), 2) if correct_rt else None,
        },
    }


def score_n_back_test(trials: list[dict]) -> dict[str, Any]:
    """NBACK: percent of trials answered correctly."""
    return _accuracy(trials)


def score_stroop_test(trials: list[dict]) -> dict[str, Any]:
    """STROOP: percent of trials answered correctly."""
    return _accuracy(trials)


def score_survey(context: dict[str, Any] | None) -> dict[str, Any]:
    """SURVEY: the fatigue score recorded on the session's context (1-9)."""
    value = (context or {}).get("fatigue_score")
    if value is None:
        return {"scorable": False, "reason": "no fatigue_score recorded for this session"}
    return {"scorable": True, "metric_value": round(float(value), 2), "valid_trials": 1, "details": {}}


SCORERS = {"PVT": score_reaction_time_test, "NBACK": score_n_back_test, "STROOP": score_stroop_test}


def score_session(conn: sqlite3.Connection, session_id: str, *, extended: bool = False) -> dict[str, Any]:
    """Score one session from what is stored (trials or context). Writes nothing."""
    session = conn.execute("SELECT * FROM assessment_sessions WHERE session_id = ?", (session_id,)).fetchone()
    if session is None:
        raise NotFound(f"Session {session_id} not found")
    spec = validate_scoring_protocol(conn, session["protocol_id"], extended=extended)
    if session["protocol_id"] == "SURVEY":
        context = conn.execute("SELECT * FROM assessment_context WHERE context_id = ?",
                               (session["context_id"],)).fetchone()
        score = score_survey(dict(context) if context else None)
    else:
        trials = [dict(r) for r in conn.execute(
            "SELECT * FROM assessment_trials WHERE session_id = ? ORDER BY trial_number", (session_id,))]
        if extended and session['protocol_id'] in EXTENDED_DOMAIN:
            score = score_symbol_test(trials) if session['protocol_id'] == 'SYMBOL' else _accuracy(trials)
        else:
            score = SCORERS[session["protocol_id"]](trials)
    metric = spec["metric"]
    return {
        "session_id": session_id, "protocol_id": session["protocol_id"],
        "metric_name": metric["metric_name"], "cognitive_domain": metric["cognitive_domain"],
        "metric_unit": metric["metric_unit"], "better_direction": metric["better_direction"],
        "scoring_version": SCORING_VERSION, **score,
    }


def save_assessment_results(conn: sqlite3.Connection, score: dict[str, Any], result_id: str,
                            calculated_at: str) -> dict[str, Any]:
    """Insert one assessment_results row from a score. Caller commits."""
    if not score.get("scorable"):
        raise ValidationFailed(f"Session cannot be scored: {score.get('reason')}")
    conn.execute(
        """INSERT INTO assessment_results (result_id, session_id, cognitive_domain, metric_name, metric_value,
                                          metric_unit, scoring_version, calculated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (result_id, score["session_id"], score["cognitive_domain"], score["metric_name"], score["metric_value"],
         score["metric_unit"], score["scoring_version"], calculated_at))
    return dict(conn.execute("SELECT * FROM assessment_results WHERE result_id = ?", (result_id,)).fetchone())
