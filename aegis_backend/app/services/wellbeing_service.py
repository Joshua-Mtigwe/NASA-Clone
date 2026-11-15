"""Wellbeing chat with the AEGIS Reflective Coach: an astronaut says how they feel; the reply reflects it
back, draws on their own current metrics, and points them to their crew and the medical officer.

The coach is a guided-reflection tool, not a therapist or a doctor.

What happens to each message
----------------------------
1. The message is stored (wellbeing_messages), in a conversation that belongs to that astronaut.
2. URGENT messages (chest pain, trouble breathing, fainting, thoughts of self-harm...) are caught by
   keywords and NEVER sent to the model. A fixed reply tells them to contact the medical officer now.
3. Otherwise the coach ANALYSES the message first (coach_service): labels from fixed lists, each backed
   by a quote that code checks is really in the text. The analysis is stored with the message.
4. BREAK-GLASS checks (wellbeing_risk_service): immediate danger, or the same crisis marker in 3 of the
   last 5 writings, raises a risk flag for the medical officer. The flag carries the indicator only.
5. A fact packet is built from the astronaut's own data at the current mission time, compared with THEIR
   OWN usual values, plus the checked summary of what they wrote and one reframing question chosen by code.
6. Gemma writes the reply (ai_service, purpose 'wellbeing_chat'). It is checked: no new numbers, no
   illness names, no medication, no "therapy" framing, only approved activities. If the model is off or
   its answer fails a check, a rule-based reply is used. Code then makes sure the reply points to the
   crew and to the medical officer.
7. The reply is stored with the facts it was based on.

Privacy: the TEXT of a conversation is private to the astronaut. The medical officer sees that a
conversation exists, and any risk flags, but reads the messages only if the astronaut shares the
conversation (every such read is audited). The astronaut is told this with every reply (PRIVACY_NOTE).
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Any

from app.core import permissions
from app.core.config import get_settings
from app.core.errors import NotFound, PermissionDenied, ServiceError, ValidationFailed
from app.services import ai_service, auth_service, coach_service, health_changes_service, physiology_service
from app.services import radiation_service, recovery_service, sleep_activity_service, wellbeing_risk_service
from app.services.audit_service import write_audit
from app.services.health_context import resolve_as_of
from app.utils.timestamps import to_iso, utcnow

MAX_MESSAGE_CHARS = 1000
HISTORY_MESSAGES = 6  # earlier messages given to the model for context

SAFETY_NOTE = ("This is a guided-reflection tool, not medical advice and not a substitute for your crew. "
               "If you feel worse or unsure, contact the medical officer.")
PRIVACY_NOTE = wellbeing_risk_service.PRIVACY_NOTE

# Messages that must reach a person, not a model. Matched case-insensitively.
_URGENT_PHYSICAL = [re.compile(p, re.IGNORECASE) for p in (
    r"chest (?:pain|pressure|tightness)", r"can'?t breathe", r"cannot breathe", r"(?:trouble|difficulty) breathing",
    r"short(?:ness)? of breath", r"faint(?:ed|ing)?\b", r"pass(?:ed|ing) out", r"black(?:ed|ing) out",
    r"unconscious", r"seizure", r"convuls", r"cough(?:ing)? (?:up )?blood", r"vomit(?:ing)? blood",
    r"(?:severe|worst) headache", r"can'?t (?:see|feel my|move my)", r"numb(?:ness)? (?:in|on) (?:my )?(?:face|arm|leg)",
    r"slurred speech", r"heavy bleeding")]
_URGENT_SELF_HARM = [re.compile(p, re.IGNORECASE) for p in (
    r"suicid", r"kill (?:my ?self|me)", r"end (?:my|it all|my life)", r"self[- ]?harm", r"hurt(?:ing)? my ?self",
    r"don'?t want to (?:live|be alive|wake up)", r"no reason to live", r"better off dead")]

ESCALATION_PHYSICAL = (
    "Thank you for telling me. What you describe needs a person, not this assistant: please contact the "
    "medical officer now, or alert a crew member near you straight away. The medical officer has been "
    "alerted that you reported an urgent physical symptom; they are told the reason, not your words.")
ESCALATION_SELF_HARM = (
    "Thank you for telling me, and I'm glad you said it. You don't have to handle this alone: please talk to "
    "the medical officer now, or reach out to a crew member you trust straight away. The medical officer has "
    "been alerted that you may need support; they are told the reason, not your words, unless you choose to "
    "share them. If you are a real person outside this simulation and "
    "you are in danger or thinking about ending your life, please contact your local emergency number or a "
    "crisis line now.")


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12].upper()}"


def urgent_kind(text: str) -> str | None:
    """'self_harm', 'physical' or None."""
    if any(p.search(text) for p in _URGENT_SELF_HARM):
        return "self_harm"
    if any(p.search(text) for p in _URGENT_PHYSICAL):
        return "physical"
    return None


def _astronaut_for(conn: sqlite3.Connection, user: dict[str, Any]) -> str:
    auth_service.require_role(user, *permissions.WELLBEING_CHAT_ROLES)
    row = conn.execute("SELECT astronaut_id FROM astronauts WHERE user_id = ?", (user["user_id"],)).fetchone()
    if row is None:
        raise PermissionDenied("This account has no astronaut profile")
    return row[0]


# --------------------------------------------------------------------------- the facts

_VITAL_WORDS = {"heart_rate": "heart rate", "hrv_rmssd": "heart rate variability", "spo2": "blood oxygen",
                "body_temperature": "body temperature", "respiratory_rate": "breathing rate"}
_POSITION_WORDS = {"above_personal_range": "above your usual range", "below_personal_range": "below your usual range",
                   "within_personal_range": "within your usual range"}


def _section(build) -> Any:
    """A missing piece of data must not stop the chat: leave that part out."""
    try:
        return build()
    except (ServiceError, KeyError, TypeError, ValueError, ZeroDivisionError):
        return None


def build_facts(conn: sqlite3.Connection, astronaut_id: str, as_of: datetime, simulation_run_id: str) -> dict[str, Any]:
    """The astronaut's current picture, each part compared with their own usual values."""
    facts: dict[str, Any] = {"mission_time": to_iso(as_of)}

    measures = _section(lambda: ai_service._today(conn, astronaut_id, as_of, simulation_run_id))
    if measures:
        facts["measurements"] = measures

    def vitals():
        body = physiology_service.prepare_body_map_metrics(conn, astronaut_id, as_of)
        out = []
        for region in body["regions"]:
            for m in region["metrics"]:
                if m.get("position") in _POSITION_WORDS and m.get("value") is not None:
                    out.append({"what": _VITAL_WORDS.get(m["measurement_type"], m["measurement_type"]),
                                "value": m["value"], "unit": m.get("unit"),
                                "compared_with_your_usual_range": _POSITION_WORDS[m["position"]]})
        return out
    facts["vitals_now"] = _section(vitals) or []

    def radiation():
        latest = radiation_service.get_current_radiation(conn, astronaut_id, as_of)["latest"]
        if not latest:
            return None
        return {"what": "radiation dose rate from your wearable", "value": latest["dose_rate"],
                "unit": latest["dose_rate_unit"], "accumulated_dose": latest["accumulated_dose"],
                "accumulated_unit": latest["accumulated_dose_unit"],
                "note": "Routine reading; the medical officer tracks mission dose."}
    if (rad := _section(radiation)) is not None:
        facts["radiation"] = rad

    def changes():
        result = health_changes_service.calculate_health_changes(conn, astronaut_id, as_of)
        if result["status"] != "compared":
            return None
        return [{"what": m["label"], "direction": m["direction"]} for m in result["metrics"]
                if m["change_level"] == "notable"]
    if (week := _section(changes)) is not None:
        facts["notable_changes_this_week_vs_your_first_week"] = week

    def schedule():
        day = sleep_activity_service.get_astronaut_schedule(conn, astronaut_id, as_of)
        tasks = [t for t in day["task_assignments"] if t.get("version_status") in ("published", "approved")]
        upcoming = [t for t in tasks if t["planned_start"] >= to_iso(as_of)]
        return {"tasks_today": len(tasks),
                "next_task": ({"title": upcoming[0]["task_title"], "starts": upcoming[0]["planned_start"][11:16]}
                              if upcoming else None)}
    if (plan := _section(schedule)) is not None:
        facts["today_schedule"] = plan

    activities = recovery_service.list_activities(conn)
    facts["approved_activities"] = [{"name": a["activity_name"], "category": a["activity_category"],
                                     "duration_minutes": a["recommended_duration_minutes"]} for a in activities]

    def ranked():
        evidence = recovery_service.collect_signals(conn, astronaut_id, as_of, simulation_run_id)
        return [r["activity_name"] for r in recovery_service.rank_activities(activities, evidence)][:2]
    facts["rules_suggest"] = _section(ranked) or []
    return facts


def model_facts(facts: dict[str, Any], text: str) -> dict[str, Any]:
    """What the model sees: only what is unusual, with values; everything normal is one phrase.
    Topic guidance (medication, radiation, diagnosis) goes into the instructions, not the facts."""
    unusual, normal = [], []
    for m in (facts.get("measurements") or {}).values():
        if not isinstance(m, dict):
            continue
        if m.get("unusual_for_them"):
            unusual.append({"what": m["what"], "today": m["today"], "unit": m["unit"], "own_usual": m["own_usual"],
                            "compared_with_usual": m["compared_with_usual"]})
        else:
            normal.append(m["what"])
    below = (facts.get("measurements") or {}).get("tests_below_personal_baseline") or []
    if below:
        unusual.append({"what": "cognitive tests below your own usual this morning",
                        "tests": [t["protocol_id"] for t in below]})
    for v in facts.get("vitals_now") or []:
        if v["compared_with_your_usual_range"] == "within your usual range":
            normal.append(v["what"])
        else:
            unusual.append(v)
    # Normal measurements are summed up in one phrase: given their names, a small model invents values.
    packet = {"unusual_today": unusual,
              "everything_else": "within your own usual range" if normal else None,
              "approved_activities": facts.get("approved_activities") or [],
              "rules_suggest": facts.get("rules_suggest") or []}
    for key in ("notable_changes_this_week_vs_your_first_week", "today_schedule"):
        if facts.get(key):
            packet[key] = facts[key]
    # Radiation readings are routine; shown only when the person asks about radiation, otherwise a small
    # model brings them up in replies about unrelated feelings.
    if facts.get("radiation") and any("radiation" in note for note in ai_service.chat_guidance(text)):
        packet["radiation"] = facts["radiation"]
    return packet


NOTHING_UNUSUAL = ("Nothing is unusual in their measurements today. Do not mention any measurement and do not "
                   "give any number except an activity's duration; simply say their measurements today are within "
                   "their own usual range.")


def _instructions(text: str, seen: dict[str, Any]) -> list[str]:
    """Request-specific instructions for the model: topic guidance, plus the 'nothing unusual' case,
    where a small model otherwise fills the gap with made-up 'typical' values."""
    notes = ai_service.chat_guidance(text)
    if not seen["unusual_today"]:
        notes.append(NOTHING_UNUSUAL)
    return notes


_SCORE_UNITS = {"1-9", "score"}  # read as plain numbers: "5.81", not "5.81 1-9"


def rule_based_reply(facts: dict[str, Any], reframe_question: str | None = None) -> str:
    """The reply used when the model is off or its answer failed a check. Built only from the facts."""
    unusual = []
    for m in (facts.get("measurements") or {}).values():
        if isinstance(m, dict) and m.get("unusual_for_them"):
            unit = "" if m["unit"] in _SCORE_UNITS else f" {m['unit']}"
            unusual.append(f"your {m['what']} was {m['today']}{unit}, {m['compared_with_usual']} than your "
                           f"usual {m['own_usual']}")
    for v in facts.get("vitals_now") or []:
        if v["compared_with_your_usual_range"] != "within your usual range":
            unusual.append(f"your {v['what']} is {v['compared_with_your_usual_range']}")
    parts = ["Thank you for telling me how you feel."]
    if unusual:
        parts.append("Compared with your own usual values, " + "; ".join(unusual[:3]) + ".")
    else:
        parts.append("Your measurements today are within your own usual range.")
    suggestion = (facts.get("rules_suggest") or [None])[0]
    if suggestion:
        minutes = next((a["duration_minutes"] for a in facts["approved_activities"] if a["name"] == suggestion), None)
        article = "An" if str(minutes).startswith(("8", "11", "18")) else "A"
        parts.append(f"{article} {minutes}-minute {suggestion} could be a good fit right now." if minutes
                     else f"{suggestion} could be a good fit right now.")
    if reframe_question:
        parts.append(f"One question to sit with: {reframe_question}")
    parts.append("If you feel worse or unsure, please talk to the medical officer.")
    return " ".join(parts)


# --------------------------------------------------------------------------- conversations

def _conversation(conn: sqlite3.Connection, conversation_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM wellbeing_conversations WHERE conversation_id = ?", (conversation_id,)).fetchone()
    if row is None:
        raise NotFound(f"Conversation {conversation_id} not found")
    return dict(row)


def _store_message(conn: sqlite3.Connection, conversation_id: str, sender: str, text: str, mission_time: str,
                   **extra: Any) -> dict[str, Any]:
    message_id = _id("MSG")
    conn.execute(
        """INSERT INTO wellbeing_messages (message_id, conversation_id, sender, text, created_at, mission_time,
               source, inference_id, facts_json, check_problems_json, analysis_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (message_id, conversation_id, sender, text, to_iso(utcnow()), mission_time, extra.get("source"),
         extra.get("inference_id"), json.dumps(extra["facts"]) if extra.get("facts") is not None else None,
         json.dumps(extra["problems"]) if extra.get("problems") else None,
         json.dumps(extra["analysis"]) if extra.get("analysis") is not None else None))
    return _message(conn.execute("SELECT * FROM wellbeing_messages WHERE message_id = ?", (message_id,)).fetchone())


def _message(row: sqlite3.Row) -> dict[str, Any]:
    m = dict(row)
    m["facts"] = json.loads(m.pop("facts_json")) if m.get("facts_json") else None
    m["check_problems"] = json.loads(m.pop("check_problems_json")) if m.get("check_problems_json") else []
    analysis = json.loads(m.pop("analysis_json")) if m.get("analysis_json") else None
    # The astronaut's own message carries the coach's checked summary (plain words, no crisis labels).
    m["coach_summary"] = coach_service.coach_brief(analysis) if analysis else None
    return m


def send_message(conn: sqlite3.Connection, user: dict[str, Any], text: str, *, conversation_id: str | None = None,
                 simulation_run_id: str | None = None, as_of: datetime | None = None) -> dict[str, Any]:
    """Store the astronaut's message, reply to it, store the reply. Returns both."""
    astronaut_id = _astronaut_for(conn, user)
    text = (text or "").strip()
    if not text:
        raise ValidationFailed("Write how you feel")
    if len(text) > MAX_MESSAGE_CHARS:
        raise ValidationFailed(f"Keep it under {MAX_MESSAGE_CHARS} characters")
    run_id = simulation_run_id or get_settings().default_template_run_id
    now = as_of or resolve_as_of(conn, None, run_id)
    mission_time = to_iso(now)

    if conversation_id:
        conversation = _conversation(conn, conversation_id)
        if conversation["astronaut_id"] != astronaut_id:
            raise PermissionDenied("This conversation belongs to someone else")
        run_id = conversation["simulation_run_id"] or run_id
    else:
        conversation_id = _id("CHT")
        conn.execute(
            """INSERT INTO wellbeing_conversations (conversation_id, astronaut_id, user_id, simulation_run_id,
                   started_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?)""",
            (conversation_id, astronaut_id, user["user_id"], run_id, to_iso(utcnow()), to_iso(utcnow())))
    history = [{"from": r["sender"], "text": r["text"]} for r in conn.execute(
        "SELECT sender, text FROM wellbeing_messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC "
        "LIMIT ?", (conversation_id, HISTORY_MESSAGES))][::-1]
    kind = urgent_kind(text)
    if kind:  # caught by keywords: the model is not used at all, not even to analyse
        analysis = {**coach_service.keyword_analysis(text), "source": "keywords"}
    else:
        analysis = coach_service.analyse(conn, text, simulation_run_id=run_id, purpose="chat_analysis")
    mine = _store_message(conn, conversation_id, "astronaut", text, mission_time, analysis=analysis)
    risk = wellbeing_risk_service.evaluate(conn, astronaut_id, analysis, source="chat", mission_time=mission_time,
                                           urgent_physical=kind == "physical")
    conn.commit()

    if risk["level"] == "immediate":
        self_harm = kind == "self_harm" or "self_harm" in coach_service.labels(analysis, "crisis_markers")
        reason = "self_harm" if self_harm else "physical" if kind == "physical" else "safety_risk"
        reply_text = ESCALATION_PHYSICAL if reason == "physical" else ESCALATION_SELF_HARM
        reply = _store_message(conn, conversation_id, "assistant", reply_text, mission_time, source="escalation")
        conn.execute("UPDATE wellbeing_conversations SET flagged = 1, flag_reason = ?, reviewed_by_user_id = NULL, "
                     "reviewed_at = NULL, review_note = NULL WHERE conversation_id = ?",
                     (f"urgent: {reason}", conversation_id))
        write_audit(conn, user_id=user["user_id"], action_type="wellbeing_escalation",
                    entity_type="wellbeing_conversation", entity_id=conversation_id, action_result="flagged",
                    change_summary=f"urgent message ({reason}) from {astronaut_id}; no model-written reply",
                    commit=False)
    else:
        facts = build_facts(conn, astronaut_id, now, run_id)
        seen = model_facts(facts, text)
        # A question about medication, radiation or "what is wrong with me" gets a direct answer, not a
        # reframing question ("Should I take...?" is a question, not a 'should' statement).
        question = None if ai_service.chat_guidance(text) else coach_service.reframe_question(analysis)
        packet = {**seen, "coach_brief": coach_service.coach_brief(analysis), "reframe_question": question,
                  "astronaut_says": text, "recent_conversation": history}
        unapproved = {a["activity_name"] for a in recovery_service.list_activities(conn, include_unapproved=True)
                      if a["approval_status"] != "approved"}
        result = ai_service.run_inference(conn, purpose="wellbeing_chat", packet=packet, simulation_run_id=run_id,
                                          allowed_astronauts={astronaut_id}, other_names=unapproved,
                                          extra_instructions=_instructions(text, seen))
        if result["status"] == "succeeded":
            reply_text, source = result["text"], "gemma"
        else:
            reply_text, source = rule_based_reply(facts, question), "rules"
        # Deterministic last step: every reply points to the crew and to the medical officer.
        reply_text = coach_service.finish_reply(reply_text, analysis)
        reply = _store_message(conn, conversation_id, "assistant", reply_text, mission_time, source=source,
                               inference_id=result["inference_id"], facts={"all": facts, "shown_to_model": seen},
                               problems=result["problems"])
    conn.execute("UPDATE wellbeing_conversations SET last_message_at = ? WHERE conversation_id = ?",
                 (to_iso(utcnow()), conversation_id))
    conn.commit()
    conversation = _conversation(conn, conversation_id)
    return {"conversation_id": conversation_id, "flagged": bool(conversation["flagged"]),
            "message": mine, "reply": reply, "medical_officer_alerted": risk["level"],
            "safety_note": SAFETY_NOTE, "privacy_note": PRIVACY_NOTE}


def list_conversations(conn: sqlite3.Connection, user: dict[str, Any], *, astronaut_id: str | None = None,
                       flagged: bool | None = None) -> list[dict[str, Any]]:
    """An astronaut gets their own; the medical officer gets everyone's (optionally filtered)."""
    if user.get("role_name") in permissions.WELLBEING_REVIEW_ROLES:
        target = astronaut_id
    else:
        target = _astronaut_for(conn, user)
        if astronaut_id and astronaut_id != target:
            raise PermissionDenied("You can only see your own conversations")
    rows = conn.execute(
        """SELECT c.*, (SELECT COUNT(*) FROM wellbeing_messages m WHERE m.conversation_id = c.conversation_id)
                  AS message_count,
                  (SELECT text FROM wellbeing_messages m WHERE m.conversation_id = c.conversation_id
                   ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_message
           FROM wellbeing_conversations c
           WHERE (? IS NULL OR c.astronaut_id = ?) AND (? IS NULL OR c.flagged = ?)
           ORDER BY c.flagged DESC, c.last_message_at DESC""",
        (target, target, None if flagged is None else int(flagged), None if flagged is None else int(flagged)))
    out = []
    for r in rows:
        c = {**dict(r), "flagged": bool(r["flagged"]), "shared_with_medical_officer": bool(r["shared_with_medical_officer"])}
        if user.get("role_name") in permissions.WELLBEING_REVIEW_ROLES and not c["shared_with_medical_officer"]:
            c["last_message"] = None  # private unless the astronaut shares the conversation
        out.append(c)
    return out


def get_conversation(conn: sqlite3.Connection, user: dict[str, Any], conversation_id: str) -> dict[str, Any]:
    conversation = _conversation(conn, conversation_id)
    shared = bool(conversation["shared_with_medical_officer"])
    base = {**conversation, "flagged": bool(conversation["flagged"]), "shared_with_medical_officer": shared,
            "safety_note": SAFETY_NOTE, "privacy_note": PRIVACY_NOTE}
    is_reviewer = user.get("role_name") in permissions.WELLBEING_REVIEW_ROLES
    if not is_reviewer:
        if _astronaut_for(conn, user) != conversation["astronaut_id"]:
            raise PermissionDenied("This conversation belongs to someone else")
    elif not shared:  # the medical officer knows it exists, but the words stay with the astronaut
        count = conn.execute("SELECT COUNT(*) FROM wellbeing_messages WHERE conversation_id = ?",
                             (conversation_id,)).fetchone()[0]
        return {**base, "private": True, "message_count": count, "messages": [],
                "note": "The astronaut has not shared this conversation, so its messages are private. "
                        "Risk flags, if any, are listed under /wellbeing/risk-flags."}
    else:  # shared personal conversation read by staff: always on record
        write_audit(conn, user_id=user["user_id"], action_type="read_wellbeing_conversation",
                    entity_type="wellbeing_conversation", entity_id=conversation_id, action_result="success",
                    change_summary=f"shared conversation of {conversation['astronaut_id']}")
    messages = [_message(r) for r in conn.execute(
        "SELECT * FROM wellbeing_messages WHERE conversation_id = ? ORDER BY created_at, rowid", (conversation_id,))]
    if not is_reviewer:  # the astronaut sees the conversation, not the internal check details
        for m in messages:
            m.pop("check_problems", None)
    return {**base, "private": False, "message_count": len(messages), "messages": messages}


def share_conversation(conn: sqlite3.Connection, user: dict[str, Any], conversation_id: str,
                       shared: bool) -> dict[str, Any]:
    """The astronaut lets the medical officer read this conversation, or takes that back."""
    conversation = _conversation(conn, conversation_id)
    if _astronaut_for(conn, user) != conversation["astronaut_id"]:
        raise PermissionDenied("This conversation belongs to someone else")
    conn.execute("UPDATE wellbeing_conversations SET shared_with_medical_officer = ?, shared_at = ? "
                 "WHERE conversation_id = ?", (int(shared), to_iso(utcnow()) if shared else None, conversation_id))
    write_audit(conn, user_id=user["user_id"], action_type="share_wellbeing_conversation" if shared
                else "unshare_wellbeing_conversation", entity_type="wellbeing_conversation",
                entity_id=conversation_id, action_result="success", commit=False)
    conn.commit()
    return get_conversation(conn, user, conversation_id)


def review_conversation(conn: sqlite3.Connection, user: dict[str, Any], conversation_id: str,
                        note: str) -> dict[str, Any]:
    """The medical officer records that a flagged conversation has been followed up."""
    auth_service.require_role(user, *permissions.WELLBEING_REVIEW_ROLES)
    if not (note or "").strip():
        raise ValidationFailed("Write a short note on the follow-up")
    conversation = _conversation(conn, conversation_id)
    if not conversation["flagged"]:
        raise ValidationFailed("Only flagged conversations need a review")
    conn.execute("UPDATE wellbeing_conversations SET reviewed_by_user_id = ?, reviewed_at = ?, review_note = ? "
                 "WHERE conversation_id = ?", (user["user_id"], to_iso(utcnow()), note.strip()[:500], conversation_id))
    write_audit(conn, user_id=user["user_id"], action_type="review_wellbeing_conversation",
                entity_type="wellbeing_conversation", entity_id=conversation_id, action_result="success",
                change_summary=note.strip()[:200], commit=False)
    conn.commit()
    return get_conversation(conn, user, conversation_id)
