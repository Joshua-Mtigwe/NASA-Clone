"""Phase 6: Gemma puts the backend's decisions into words.

The rules and the scheduler decide; the model only explains. For each request this service

    1. builds a small packet of finished facts (never raw tables),
    2. asks the local model to write a few sentences from that packet,
    3. checks the answer: every number, astronaut and activity in it must come from the packet,
       and it must not sound like a diagnosis or a promise,
    4. logs the call in ai_inference_logs (hashes, model, timing, outcome),
    5. keeps the text only if it passed; otherwise the rule-based text is returned instead.

The rule-based reason is never overwritten, the model never changes who is assigned or what is
recommended, and it never approves anything. If the model is switched off, slow or wrong, every
screen still works with the rule-based text.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
import uuid
from typing import Any

from app.core import permissions
from app.core.errors import Conflict, ValidationFailed
from app.services import auth_service, gemma_client, mission_simulator
from app.services import crew_readiness_service as readiness
from app.services import recovery_service, research_report_service, research_service, task_execution_service
from app.services.audit_service import write_audit
from app.utils.timestamps import parse_iso, to_iso, utcnow

PROMPT_VERSIONS = {"recovery_explanation": "recovery_v2", "task_explanation": "task_v1",
                   "research_report": "report_v1"}
MAX_CHARS = {"recovery_explanation": 700, "task_explanation": 900, "research_report": 3000}
MAX_TOKENS = {"recovery_explanation": 220, "task_explanation": 280, "research_report": 800}
RECOVERY, TASK = "recovery_recommendation", "task_assignment"

SYSTEM_PROMPT = (
    "You write short, plain-English explanations for a spaceflight crew planning tool. "
    "You are given facts as JSON. Follow every rule:\n"
    "1. Use only facts and numbers that appear in the JSON. Never calculate or estimate a new number.\n"
    "2. Never name an astronaut or an activity that is not in the JSON.\n"
    "3. The decision is already made. Explain it; do not change it or suggest a different one.\n"
    "4. Do not diagnose, do not say anyone is unfit, and do not promise that anything will help.\n"
    "5. Compare a person only with their own usual values, as the JSON does.\n"
    "6. Plain text only: no headings, no bullet points, no markdown.")

_TASKS = {
    "recovery_explanation": "Explain to the astronaut, in 2 or 3 friendly sentences, why this recovery activity "
                            "is suggested today. Speak to them as 'you' and do not open with a greeting or "
                            "their name. Mention only the measurements listed as unusual.",
    "task_explanation": "Explain to the mission leader, in 2 to 4 sentences, the facts that support giving this "
                        "task to the assigned astronaut today. If another allowed astronaut has a result below "
                        "their own usual today, you may say so.",
    "research_report": "Write a short report of this analysis for a medical officer: one paragraph on what was "
                       "asked and how, one on what was found, one on how each astronaut compares. "
                       "Do not add a limitations section; one is added automatically.",
}

# Wording that would turn a statistical comparison into a medical claim.
_BANNED = ("diagnos", "unfit", "cure", "guarantee", "will fix", "will improve", "will restore", "disease",
           "disorder", "impaired", "medical clearance", "prescri")
_NUMBER = re.compile(r"(?<![A-Za-z])-?\d+(?:\.\d+)?")
_ASTRONAUT = re.compile(r"\bAST-[A-Z0-9-]+\b")


# --------------------------------------------------------------------------- checking the answer

def _packet_numbers(packet: Any) -> set[float]:
    """Every number in the packet, including ones written inside its text values."""
    found: set[float] = set()

    def walk(value: Any) -> None:
        if isinstance(value, bool) or value is None:
            return
        if isinstance(value, (int, float)):
            found.add(abs(float(value)))
        elif isinstance(value, str):
            found.update(abs(float(m)) for m in _NUMBER.findall(value))
        elif isinstance(value, dict):
            for k, v in value.items():
                walk(k)
                walk(v)
        elif isinstance(value, (list, tuple)):
            for v in value:
                walk(v)

    walk(packet)
    return found


def check_answer(text: str, packet: dict[str, Any], purpose: str, *, allowed_astronauts: set[str],
                 other_names: set[str] = frozenset()) -> list[str]:
    """Why an answer must be thrown away. Empty list = it may be shown."""
    problems: list[str] = []
    if len(text) > MAX_CHARS[purpose]:
        problems.append(f"too long ({len(text)} characters)")
    lowered = text.lower()
    problems += [f"medical or promising wording: '{word}'" for word in _BANNED if word in lowered]
    for astronaut in sorted(set(_ASTRONAUT.findall(text)) - allowed_astronauts):
        problems.append(f"names {astronaut}, who is not in the facts")
    problems += [f"names '{name}', which is not in the facts" for name in sorted(other_names)
                 if name.lower() in lowered]
    allowed = _packet_numbers(packet)
    for raw in _NUMBER.findall(_ASTRONAUT.sub(" ", text)):
        value = abs(float(raw))
        decimals = len(raw.split(".")[1]) if "." in raw else 0
        if not any(abs(round(a, decimals) - value) < 1e-9 for a in allowed):
            problems.append(f"number {raw} is not in the facts")
    return problems


# --------------------------------------------------------------------------- one logged model call

def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def run_inference(conn: sqlite3.Connection, *, purpose: str, packet: dict[str, Any],
                  simulation_run_id: str | None, allowed_astronauts: set[str],
                  other_names: set[str] = frozenset()) -> dict[str, Any]:
    """Ask the model, check the answer, log the call. Never raises for a model problem.

    Returns {status, text (only when status is 'succeeded'), inference_id, model_id, error_code, problems}.
    """
    client = gemma_client.get_client()
    packet_json = json.dumps(packet, sort_keys=True, ensure_ascii=False)
    prompt = f"{_TASKS[purpose]}\n\nFacts (JSON):\n{packet_json}"
    started = time.monotonic()
    text, status, error_code, problems = None, "succeeded", None, []
    try:
        text = client.generate(SYSTEM_PROMPT, prompt, MAX_TOKENS[purpose]).strip()
        problems = check_answer(text, packet, purpose, allowed_astronauts=allowed_astronauts,
                                other_names=other_names)
        if problems:
            status, error_code = "rejected_by_check", "output_check_failed"
    except gemma_client.ModelUnavailable as exc:
        status, error_code, problems = "failed", exc.code, [exc.message]
    inference_id = f"INF-{uuid.uuid4().hex[:12].upper()}"
    conn.execute(
        """INSERT INTO ai_inference_logs (inference_id, simulation_run_id, purpose, model_id, model_version,
               prompt_template_version, input_hash, output_hash, status, latency_ms, created_at, error_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (inference_id, simulation_run_id, purpose, client.model, client.model.partition(":")[2] or None,
         PROMPT_VERSIONS[purpose], _hash(SYSTEM_PROMPT + prompt), _hash(text) if text else None, status,
         int((time.monotonic() - started) * 1000), to_iso(utcnow()), error_code))
    conn.commit()
    return {"status": status, "text": text if status == "succeeded" else None, "inference_id": inference_id,
            "model_id": client.model, "error_code": error_code, "problems": problems}


def _save(conn: sqlite3.Connection, entity_type: str, entity_id: str, result: dict[str, Any],
          user_id: str | None) -> None:
    conn.execute(
        """INSERT INTO ai_explanations (explanation_id, entity_type, entity_id, explanation_text, model_id,
               inference_id, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (f"EXP-{uuid.uuid4().hex[:12].upper()}", entity_type, entity_id, result["text"], result["model_id"],
         result["inference_id"], user_id, to_iso(utcnow())))
    write_audit(conn, user_id=user_id, action_type="ai_explanation", entity_type=entity_type, entity_id=entity_id,
                action_result="success", change_summary=f"{result['model_id']} {result['inference_id']}",
                commit=False)
    conn.commit()


def _stored(conn: sqlite3.Connection, entity_type: str, entity_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM ai_explanations WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, rowid DESC "
        "LIMIT 1", (entity_type, entity_id)).fetchone()
    return dict(row) if row else None


def _answer(entity_type: str, entity_id: str, rule_text: str, *, result: dict[str, Any] | None = None,
            stored: dict[str, Any] | None = None) -> dict[str, Any]:
    """What a screen shows: the model's text if there is a checked one, else the rule-based text."""
    if result and result["status"] == "succeeded":
        source, text, model = "gemma", result["text"], result["model_id"]
    elif stored:
        source, text, model = "gemma", stored["explanation_text"], stored["model_id"]
    else:
        source, text, model = "rules", rule_text, None
    out = {"entity_type": entity_type, "entity_id": entity_id, "source": source, "text": text,
           "model_id": model, "rule_based_text": rule_text}
    if result:
        out["inference"] = {k: result[k] for k in ("inference_id", "status", "error_code", "problems")}
        if result["status"] != "succeeded":
            out["note"] = ("The AI model was not used for this answer, so the rule-based text is shown."
                           if not stored else "The AI model's new answer was not used; an earlier checked one is shown.")
    return out


# --------------------------------------------------------------------------- job 1: recovery

def recovery_packet(conn: sqlite3.Connection, recommendation_id: str) -> tuple[dict, dict]:
    rec = recovery_service.get_recommendation(conn, recommendation_id)
    if rec["is_demo"] or not rec["evidence"]:
        raise Conflict("Seed demo recommendations have no evidence behind them, so there is nothing to explain. "
                       "Generate recommendations first.")
    activity = recovery_service.get_activity(conn, rec["recovery_activity_id"])
    unusual = {}
    # Only the signals the rules used for THIS activity, so the explanation matches the decision.
    for name in recovery_service.signals_behind(activity, rec["evidence"]):
        s = rec["evidence"]["signals"][name]
        if name == "cognitive_dip":
            unusual["tests_below_personal_baseline"] = s["below_baseline"]
        else:
            unusual[s["measure"]] = {
                "unit": s["unit"], "when": "last night" if name == "short_sleep" else "this morning",
                "value": s["value"], "own_usual": s["own_average"],
                "difference_from_usual": round(s["value"] - s["own_average"], 1),
                "compared_with_usual": "higher" if s["value"] > s["own_average"] else "lower"}
    packet = {"astronaut_id": rec["astronaut_id"], "mission_day": rec["mission_day"],
              "suggested_activity": {"name": activity["activity_name"], "category": activity["activity_category"],
                                     "duration_minutes": activity["recommended_duration_minutes"],
                                     "what_it_is": activity["description"]},
              "unusual_for_this_astronaut_today": unusual, "status": rec["approval_status"]}
    return rec, packet


def explain_recovery(conn: sqlite3.Connection, recommendation_id: str, user: dict[str, Any]) -> dict[str, Any]:
    auth_service.require_role(user, *permissions.AI_RECOVERY_EXPLAIN_ROLES)
    rec, packet = recovery_packet(conn, recommendation_id)
    others = {a["activity_name"] for a in recovery_service.list_activities(conn, include_unapproved=True)
              if a["recovery_activity_id"] != rec["recovery_activity_id"]}
    result = run_inference(conn, purpose="recovery_explanation", packet=packet,
                           simulation_run_id=rec["simulation_run_id"],
                           allowed_astronauts={rec["astronaut_id"]}, other_names=others)
    if result["status"] == "succeeded":
        _save(conn, RECOVERY, recommendation_id, result, user["user_id"])
    return _answer(RECOVERY, recommendation_id, rec["reason"], result=result,
                   stored=_stored(conn, RECOVERY, recommendation_id))


# --------------------------------------------------------------------------- job 2: task assignment

def _today(conn: sqlite3.Connection, astronaut_id: str, at, run_id: str) -> dict[str, Any]:
    evidence = recovery_service.collect_signals(conn, astronaut_id, at, run_id)
    out: dict[str, Any] = {}
    for name, s in evidence["signals"].items():
        if name == "cognitive_dip":
            out["tests_compared_with_baseline"] = s["tests_compared"]
            out["tests_below_personal_baseline"] = s["below_baseline"]
        else:
            out[s["measure"]] = {"unit": s["unit"], "today": s["value"], "own_usual": s["own_average"],
                                 "unusual_for_them": s["active"]}
    return out


def task_packet(conn: sqlite3.Connection, task_assignment_id: str) -> tuple[dict, dict, str]:
    a = task_execution_service.get_assignment(conn, task_assignment_id)
    if a["version_status"] == "demo_unapproved":
        raise Conflict("The seed demo plan assigned tasks by simple rotation, not by crew state, so there is no "
                       "real reasoning to explain. Make a plan with the optimiser first.")
    task = dict(conn.execute(
        """SELECT t.*, r.required_certification, r.cognitive_demand_score, r.physical_demand_score,
                  r.attention_demand_score, r.time_pressure_score, r.safety_classification
           FROM mission_tasks t LEFT JOIN task_requirements r ON r.task_id = t.task_id WHERE t.task_id = ?""",
        (a["task_id"],)).fetchone())
    run_id = a["simulation_run_id"]
    now = parse_iso(mission_simulator.get_simulation_state(conn, run_id)["current_mission_time"])
    at = min(now, parse_iso(a["planned_start"]))  # what was known by the time the task starts
    crew = [r[0] for r in conn.execute("SELECT astronaut_id FROM astronauts WHERE mission_id = ? "
                                       "ORDER BY astronaut_id", (task["mission_id"],))]
    check_at = readiness.readiness_time_for(task["task_date"], 9)
    checks = {x: readiness.check_task_eligibility(conn, x, task, check_at) for x in crew}
    allowed = sorted({x for x, c in checks.items() if c["eligible"]} | {a["astronaut_id"]})
    rule_text = conn.execute("SELECT recommendation_reason FROM ai_task_recommendations WHERE recommendation_id = ?",
                             (a["recommendation_id"],)).fetchone()
    rule_text = rule_text[0] if rule_text else "Assigned by the scheduler within every hard rule."
    packet = {
        "task": {"title": task["task_title"], "category": task["task_category"], "priority": task["priority"],
                 "duration_minutes": task["estimated_duration_minutes"],
                 "demand_scores_1_to_5": {"thinking": task["cognitive_demand_score"],
                                          "attention": task["attention_demand_score"],
                                          "time_pressure": task["time_pressure_score"],
                                          "physical": task["physical_demand_score"]},
                 "needs_certification": task["required_certification"],
                 "safety_class": task["safety_classification"]},
        "assigned_to": a["astronaut_id"],
        "planned_time": f"{a['planned_start'][11:16]} to {a['planned_end'][11:16]}",
        "astronauts_allowed_by_the_rules": allowed,
        "not_allowed_and_why": {x: c["reasons"] for x, c in checks.items() if x not in allowed},
        "crew_state_as_of": to_iso(at),
        "crew_state": {x: _today(conn, x, at, run_id) for x in allowed},
        "scheduler_note": "The scheduler also balances workload and avoids overlaps; "
                          "crew state is one input, not the only one.",
    }
    return a, packet, rule_text


def explain_task(conn: sqlite3.Connection, task_assignment_id: str, user: dict[str, Any]) -> dict[str, Any]:
    auth_service.require_role(user, *permissions.AI_TASK_EXPLAIN_ROLES)
    a, packet, rule_text = task_packet(conn, task_assignment_id)
    result = run_inference(conn, purpose="task_explanation", packet=packet,
                           simulation_run_id=a["simulation_run_id"],
                           allowed_astronauts=set(packet["astronauts_allowed_by_the_rules"])
                           | set(packet["not_allowed_and_why"]))
    if result["status"] == "succeeded":
        _save(conn, TASK, task_assignment_id, result, user["user_id"])
    return _answer(TASK, task_assignment_id, rule_text, result=result, stored=_stored(conn, TASK, task_assignment_id))


# --------------------------------------------------------------------------- reading explanations

def get_explanation(conn: sqlite3.Connection, entity_type: str, entity_id: str, user: dict[str, Any]) -> dict[str, Any]:
    """The checked AI text if one exists, else the rule-based text. Makes no model call."""
    if entity_type == RECOVERY:
        rec = recovery_service.get_recommendation(conn, entity_id)
        astronaut_id, rule_text = rec["astronaut_id"], rec["reason"]
    elif entity_type == TASK:
        a = task_execution_service.get_assignment(conn, entity_id)
        row = conn.execute("SELECT recommendation_reason FROM ai_task_recommendations WHERE recommendation_id = ?",
                           (a["recommendation_id"],)).fetchone()
        astronaut_id, rule_text = a["astronaut_id"], (row[0] if row else "")
    else:
        raise ValidationFailed(f"entity_type must be '{RECOVERY}' or '{TASK}'")
    auth_service.require_astronaut_access(conn, user, astronaut_id)
    return _answer(entity_type, entity_id, rule_text, stored=_stored(conn, entity_type, entity_id))


# --------------------------------------------------------------------------- job 3: research report

def report_packet(conn: sqlite3.Connection, job_id: str) -> tuple[dict, dict, dict]:
    job = research_service.get_job(conn, job_id)
    if job["status"] != "completed":
        raise ValidationFailed(f"Job {job_id} is '{job['status']}'; only a completed job can be reported",
                               {"error_message": job["error_message"]})
    analysis = dict(conn.execute("SELECT * FROM research_analyses WHERE analysis_id = ?",
                                 (job["analysis_id"],)).fetchone())
    summary = job["summary"]
    packet = {
        "question": analysis["research_question"],
        "independent_variable": research_service.VARIABLES[analysis["independent_variable"]],
        "dependent_variable": research_service.VARIABLES[analysis["dependent_variable"]],
        "method": {"name": job["method"], "meaning": research_service.METHODS[job["method"]]},
        "data_window": summary["window"], "paired_astronaut_days": summary["pairs"],
        "astronauts_included": summary["astronauts"],
        "results": [{"measure": r["metric_name"], "value": r["metric_value"], "unit": r["metric_unit"],
                     "sample_size": r["sample_size"], "slope": r["effect_estimate"],
                     "confidence_interval_95": [r["confidence_interval_lower"], r["confidence_interval_upper"]],
                     "p_value": r["p_value"], "plain_reading": r["interpretation"].replace(research_service.CAVEAT, "")
                     .strip()} for r in job["results"]],
        "per_astronaut": summary["per_astronaut"], "data_kind": "synthetic demo data",
    }
    return job, analysis, packet


def draft_report(conn: sqlite3.Connection, user: dict[str, Any], *, job_id: str | None = None,
                 analysis_id: str | None = None, title: str | None = None) -> dict[str, Any]:
    """Draft a research report with the model. If the model is unavailable or its text fails the checks,
    the fixed template writes the report instead. Either way the result is a DRAFT for the medical officer."""
    auth_service.require_role(user, *permissions.AI_REPORT_ROLES)
    if not job_id:
        if not analysis_id:
            raise ValidationFailed("Give a job_id or an analysis_id")
        job_id = research_service.latest_job_id(conn, analysis_id)
    job, analysis, packet = report_packet(conn, job_id)
    if analysis_id and analysis_id != job["analysis_id"]:
        raise ValidationFailed(f"Job {job_id} belongs to analysis {job['analysis_id']}, not {analysis_id}")
    crew = {a["astronaut_id"] for a in packet["per_astronaut"]}
    result = run_inference(conn, purpose="research_report", packet=packet,
                           simulation_run_id=job["simulation_run_id"], allowed_astronauts=crew)
    text = model_id = None
    if result["status"] == "succeeded":
        model_id = result["model_id"]
        text = (f"{result['text']}\n\nLimits: {research_service.CAVEAT}\n"
                f"Written by the AI model {model_id} from the stored results and checked against them "
                f"automatically (inference {result['inference_id']}). Draft until reviewed.")
    report = research_report_service.create_report(conn, actor_user_id=user["user_id"], job_id=job_id, title=title,
                                                   report_text=text, model_id=model_id)
    report["source"] = "gemma" if model_id else "template"
    report["inference"] = {k: result[k] for k in ("inference_id", "status", "error_code", "problems")}
    if not model_id:
        report["note"] = "The AI model was not used, so the fixed template wrote this report."
    return report


# --------------------------------------------------------------------------- admin

def list_inferences(conn: sqlite3.Connection, *, purpose: str | None = None, status: str | None = None,
                    simulation_run_id: str | None = None, limit: int = 100) -> dict[str, Any]:
    rows = conn.execute(
        """SELECT * FROM ai_inference_logs WHERE (:p IS NULL OR purpose = :p) AND (:s IS NULL OR status = :s)
              AND (:r IS NULL OR simulation_run_id = :r) ORDER BY created_at DESC, rowid DESC LIMIT :n""",
        {"p": purpose, "s": status, "r": simulation_run_id, "n": max(1, min(limit, 1000))}).fetchall()
    counts = {r["status"]: r["n"] for r in conn.execute(
        "SELECT status, COUNT(*) AS n FROM ai_inference_logs GROUP BY status")}
    return {"counts_by_status": counts, "inferences": [dict(r) for r in rows]}


def model_status(conn: sqlite3.Connection) -> dict[str, Any]:
    status = gemma_client.get_client().status()
    last = conn.execute("SELECT status, created_at, error_code FROM ai_inference_logs "
                        "ORDER BY created_at DESC, rowid DESC LIMIT 1").fetchone()
    status["ready"] = bool(status["reachable"] and status["model_installed"])
    status["last_inference"] = dict(last) if last else None
    status["prompt_versions"] = PROMPT_VERSIONS
    if not status["reachable"]:
        status["how_to_fix"] = "Start Ollama on this machine (it listens on port 11434), then try again."
    elif not status["model_installed"]:
        status["how_to_fix"] = f"While online, run once:  ollama pull {status['model']}"
    else:
        status["how_to_fix"] = None
    status["without_the_model"] = "Every screen still works: the rule-based text is shown instead."
    return status
