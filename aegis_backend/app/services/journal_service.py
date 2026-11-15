"""Mission journal with the AEGIS Reflective Coach.

An astronaut writes a private entry. The coach analyses it (fixed labels, each backed by a quote that
code checks is really in the entry), compares the entry's themes with that astronaut's OWN earlier
entries, and writes a short reflection with one reframing question and a prompt for next time.
It is a guided-journaling tool, not a therapist or a doctor.

Privacy
-------
* An entry is private to its astronaut. The medical officer can read it only if the astronaut shares
  that entry (every such read is audited).
* Break-glass (wellbeing_risk_service): immediate danger, or the same crisis marker in 3 of the last 5
  writings, raises a risk flag that carries the indicator only, never the text.
* Research: crew-level counts of THEMES (never text, never per person) are available only from
  astronauts who have given consent, and only when at least MIN_CONSENTING of them have.
* Synthetic demo entries are fiction, labelled as such, and never count toward flags.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from collections import Counter
from datetime import datetime, timedelta
from typing import Any

from app.core import permissions
from app.core.config import get_settings
from app.core.errors import NotFound, PermissionDenied, ValidationFailed
from app.services import ai_service, auth_service, coach_service, wellbeing_risk_service, wellbeing_service
from app.services.audit_service import write_audit
from app.services.health_context import mission_launch, resolve_as_of
from app.utils.timestamps import to_iso, utcnow

MAX_ENTRY_CHARS = 4000
RECENT_ENTRIES = 5  # "recently" = the astronaut's last five entries
MIN_EARLIER = 3  # earlier entries needed before a pattern means anything
RISING_SHARE = 0.3  # a theme is "rising" when its share of recent entries is this much above its earlier share
MIN_CONSENTING = 3  # crew-level research counts are hidden below this many consenting astronauts
SYNTHETIC = "synthetic_demo"

SAFETY_NOTE = wellbeing_service.SAFETY_NOTE
PRIVACY_NOTE = wellbeing_risk_service.PRIVACY_NOTE
ESCALATION = wellbeing_service.ESCALATION_SELF_HARM
ESCALATION_PHYSICAL = wellbeing_service.ESCALATION_PHYSICAL


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12].upper()}"


def _astronaut_for(conn: sqlite3.Connection, user: dict[str, Any]) -> sqlite3.Row:
    auth_service.require_role(user, *permissions.WELLBEING_CHAT_ROLES)
    row = conn.execute("SELECT * FROM astronauts WHERE user_id = ?", (user["user_id"],)).fetchone()
    if row is None:
        raise PermissionDenied("This account has no astronaut profile")
    return row


# --------------------------------------------------------------------------- patterns against own baseline

def _analyses(conn: sqlite3.Connection, astronaut_id: str) -> list[dict[str, Any]]:
    """Every entry's analysis for one astronaut, oldest first."""
    rows = conn.execute("SELECT entry_id, mission_day, mission_time, analysis_json FROM journal_entries "
                        "WHERE astronaut_id = ? ORDER BY mission_time, created_at, rowid", (astronaut_id,)).fetchall()
    return [{"entry_id": r["entry_id"], "mission_day": r["mission_day"], "mission_time": r["mission_time"],
             "analysis": json.loads(r["analysis_json"]) if r["analysis_json"] else {}} for r in rows]


def patterns(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """Themes in the last RECENT_ENTRIES entries compared with the same astronaut's earlier entries.

    Pure function. Counts only; no judgement about what a pattern means."""
    recent, earlier = entries[-RECENT_ENTRIES:], entries[:-RECENT_ENTRIES]
    out: dict[str, Any] = {"recent_entries": len(recent), "earlier_entries": len(earlier), "rising_themes": [],
                           "recent_mood": dict(Counter(e["analysis"].get("mood_valence") or "unknown"
                                                       for e in recent))}
    if len(earlier) < MIN_EARLIER:
        out["note"] = "Not enough earlier entries yet to compare with."
        return out

    def counts(group: list[dict[str, Any]]) -> Counter:
        return Counter(label for e in group for label in set(coach_service.labels(e["analysis"], "themes")))

    now, before = counts(recent), counts(earlier)
    for theme, n in sorted(now.items(), key=lambda kv: (-kv[1], kv[0])):
        if n >= 2 and n / len(recent) - before[theme] / len(earlier) >= RISING_SHARE:
            out["rising_themes"].append({"theme": coach_service.THEMES[theme], "recent_count": n,
                                         "of_recent_entries": len(recent), "earlier_count": before[theme],
                                         "of_earlier_entries": len(earlier)})
    return out


def model_patterns(pattern: dict[str, Any]) -> dict[str, Any]:
    """What the model is told about patterns: rising themes only, and nothing at all when there are none.
    Given "not enough earlier entries" or mood counts, a small model repeats them back to the writer."""
    rising = pattern.get("rising_themes") or []
    return {"rising_themes": rising} if rising else {}


# --------------------------------------------------------------------------- reflection

def rule_based_reflection(analysis: dict[str, Any], pattern: dict[str, Any], question: str | None) -> str:
    """The reflection used when the model is off or its text failed a check. Built only from the analysis."""
    brief = coach_service.coach_brief(analysis)
    parts = ["Thank you for writing this down."]
    if brief["themes"]:
        parts.append("This entry touches on " + ", ".join(brief["themes"][:3]) + ".")
    for rising in pattern.get("rising_themes", [])[:1]:
        parts.append(f"{rising['theme'].capitalize()} came up in {rising['recent_count']} of your last "
                     f"{rising['of_recent_entries']} entries, more often than before; that may be worth noticing.")
    if question:
        parts.append(f"One question to sit with: {question}")
    return " ".join(parts)


def _entry(row: sqlite3.Row, *, for_owner: bool) -> dict[str, Any]:
    e = dict(row)
    analysis = json.loads(e.pop("analysis_json")) if e.get("analysis_json") else None
    e["coach_summary"] = coach_service.coach_brief(analysis) if analysis else None
    e["shared_with_medical_officer"] = bool(e["shared_with_medical_officer"])
    e["is_synthetic_demo"] = e["origin"] == SYNTHETIC
    if not for_owner:
        e.pop("analysis_inference_id", None)
    return e


def _row(conn: sqlite3.Connection, entry_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM journal_entries WHERE entry_id = ?", (entry_id,)).fetchone()
    if row is None:
        raise NotFound(f"Journal entry {entry_id} not found")
    return row


def write_entry(conn: sqlite3.Connection, user: dict[str, Any], text: str, *, simulation_run_id: str | None = None,
                as_of: datetime | None = None) -> dict[str, Any]:
    """Store an entry, analyse it, apply the break-glass checks and write a reflection."""
    astronaut = _astronaut_for(conn, user)
    astronaut_id = astronaut["astronaut_id"]
    text = (text or "").strip()
    if not text:
        raise ValidationFailed("Write something first")
    if len(text) > MAX_ENTRY_CHARS:
        raise ValidationFailed(f"Keep an entry under {MAX_ENTRY_CHARS} characters")
    run_id = simulation_run_id or get_settings().default_template_run_id
    now = as_of or resolve_as_of(conn, None, run_id)
    mission_day = (now - mission_launch(conn, astronaut["mission_id"])).days + 1

    kind = wellbeing_service.urgent_kind(text)
    if kind:  # caught by keywords: the model is not used at all
        analysis = {**coach_service.keyword_analysis(text), "source": "keywords"}
    else:
        analysis = coach_service.analyse(conn, text, simulation_run_id=run_id, purpose="journal_analysis")
    entry_id = _id("JRN")
    conn.execute(
        """INSERT INTO journal_entries (entry_id, astronaut_id, user_id, simulation_run_id, created_at, mission_time,
               mission_day, text, analysis_json, analysis_source, analysis_inference_id, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'astronaut')""",
        (entry_id, astronaut_id, user["user_id"], run_id, to_iso(utcnow()), to_iso(now), mission_day, text,
         json.dumps(analysis), analysis.get("source"), analysis.get("inference_id")))
    risk = wellbeing_risk_service.evaluate(conn, astronaut_id, analysis, source="journal", mission_time=to_iso(now),
                                           urgent_physical=kind == "physical")
    conn.commit()

    pattern = patterns(_analyses(conn, astronaut_id))
    question = coach_service.reframe_question(analysis)
    inference_id = None
    if risk["level"] == "immediate":
        reflection, source = (ESCALATION_PHYSICAL if kind == "physical" else ESCALATION), "escalation"
        write_audit(conn, user_id=user["user_id"], action_type="wellbeing_escalation", entity_type="journal_entry",
                    entity_id=entry_id, action_result="flagged",
                    change_summary=f"urgent journal entry from {astronaut_id}; no model-written reflection",
                    commit=False)
    else:
        packet = {"coach_brief": coach_service.coach_brief(analysis), "reframe_question": question,
                  "astronaut_says": text, **model_patterns(pattern)}
        result = ai_service.run_inference(conn, purpose="journal_reflection", packet=packet,
                                          simulation_run_id=run_id, allowed_astronauts={astronaut_id})
        inference_id = result["inference_id"]
        if result["status"] == "succeeded":
            reflection, source = result["text"], "gemma"
        else:
            reflection, source = rule_based_reflection(analysis, pattern, question), "rules"
        reflection = coach_service.finish_reply(reflection, analysis)
    conn.execute("UPDATE journal_entries SET reflection_text = ?, reflection_source = ?, "
                 "reflection_inference_id = ?, writing_prompt = ? WHERE entry_id = ?",
                 (reflection, source, inference_id, coach_service.writing_prompt(analysis), entry_id))
    conn.commit()
    return {"entry": _entry(_row(conn, entry_id), for_owner=True), "your_patterns": pattern,
            "medical_officer_alerted": risk["level"], "safety_note": SAFETY_NOTE, "privacy_note": PRIVACY_NOTE}


# --------------------------------------------------------------------------- reading and sharing

def list_entries(conn: sqlite3.Connection, user: dict[str, Any], *, astronaut_id: str | None = None,
                 from_day: int | None = None, to_day: int | None = None) -> list[dict[str, Any]]:
    """An astronaut gets their own entries. The medical officer gets only entries shared with them."""
    if user.get("role_name") in permissions.WELLBEING_REVIEW_ROLES:
        rows = conn.execute(
            """SELECT * FROM journal_entries WHERE shared_with_medical_officer = 1
                  AND (:a IS NULL OR astronaut_id = :a) AND (:f IS NULL OR mission_day >= :f)
                  AND (:t IS NULL OR mission_day <= :t) ORDER BY mission_time DESC, rowid DESC""",
            {"a": astronaut_id, "f": from_day, "t": to_day}).fetchall()
        if rows:
            write_audit(conn, user_id=user["user_id"], action_type="read_shared_journal_entries",
                        entity_type="journal_entry", entity_id=None, action_result="success",
                        change_summary=f"{len(rows)} shared entries listed")
        return [_entry(r, for_owner=False) for r in rows]
    mine = _astronaut_for(conn, user)["astronaut_id"]
    if astronaut_id and astronaut_id != mine:
        raise PermissionDenied("You can only see your own journal")
    rows = conn.execute(
        """SELECT * FROM journal_entries WHERE astronaut_id = :a AND (:f IS NULL OR mission_day >= :f)
              AND (:t IS NULL OR mission_day <= :t) ORDER BY mission_time DESC, rowid DESC""",
        {"a": mine, "f": from_day, "t": to_day}).fetchall()
    return [_entry(r, for_owner=True) for r in rows]


def get_entry(conn: sqlite3.Connection, user: dict[str, Any], entry_id: str) -> dict[str, Any]:
    row = _row(conn, entry_id)
    if user.get("role_name") in permissions.WELLBEING_REVIEW_ROLES:
        if not row["shared_with_medical_officer"]:
            raise PermissionDenied("The astronaut has not shared this entry")
        write_audit(conn, user_id=user["user_id"], action_type="read_shared_journal_entry",
                    entity_type="journal_entry", entity_id=entry_id, action_result="success",
                    change_summary=f"shared entry of {row['astronaut_id']}")
        return _entry(row, for_owner=False)
    if _astronaut_for(conn, user)["astronaut_id"] != row["astronaut_id"]:
        raise PermissionDenied("This entry belongs to someone else")
    return _entry(row, for_owner=True)


def share_entry(conn: sqlite3.Connection, user: dict[str, Any], entry_id: str, shared: bool) -> dict[str, Any]:
    """The astronaut lets the medical officer read this entry, or takes that back."""
    row = _row(conn, entry_id)
    if _astronaut_for(conn, user)["astronaut_id"] != row["astronaut_id"]:
        raise PermissionDenied("This entry belongs to someone else")
    conn.execute("UPDATE journal_entries SET shared_with_medical_officer = ?, shared_at = ? WHERE entry_id = ?",
                 (int(shared), to_iso(utcnow()) if shared else None, entry_id))
    write_audit(conn, user_id=user["user_id"], action_type="share_journal_entry" if shared
                else "unshare_journal_entry", entity_type="journal_entry", entity_id=entry_id,
                action_result="success", commit=False)
    conn.commit()
    return _entry(_row(conn, entry_id), for_owner=True)


def get_trends(conn: sqlite3.Connection, user: dict[str, Any]) -> dict[str, Any]:
    """The astronaut's own journal over time: themes and mood by mission week, and what is rising lately."""
    astronaut_id = _astronaut_for(conn, user)["astronaut_id"]
    entries = _analyses(conn, astronaut_id)
    weeks: dict[int, dict[str, Any]] = {}
    for e in entries:
        week = ((e["mission_day"] or 1) - 1) // 7 + 1
        w = weeks.setdefault(week, {"mission_week": week, "entries": 0, "themes": Counter(), "mood": Counter()})
        w["entries"] += 1
        w["themes"].update(set(coach_service.labels(e["analysis"], "themes")))
        w["mood"][e["analysis"].get("mood_valence") or "unknown"] += 1
    by_week = [{"mission_week": w["mission_week"], "entries": w["entries"],
                "themes": {coach_service.THEMES[k]: v for k, v in sorted(w["themes"].items())},
                "mood": dict(w["mood"])} for _, w in sorted(weeks.items())]
    return {"astronaut_id": astronaut_id, "entries": len(entries), "by_week": by_week,
            "compared_with_your_own_earlier_entries": patterns(entries),
            "note": "Counts of what you wrote about, compared only with your own earlier entries. "
                    "A pattern is something to notice, not a diagnosis.", "privacy_note": PRIVACY_NOTE}


# --------------------------------------------------------------------------- research consent and counts

def get_consent(conn: sqlite3.Connection, user: dict[str, Any]) -> dict[str, Any]:
    astronaut_id = _astronaut_for(conn, user)["astronaut_id"]
    row = conn.execute("SELECT * FROM wellbeing_consent WHERE astronaut_id = ?", (astronaut_id,)).fetchone()
    return {"astronaut_id": astronaut_id, "research_consent": bool(row["research_consent"]) if row else False,
            "updated_at": row["updated_at"] if row else None,
            "what_this_means": "If you agree, the THEMES of your journal entries (for example 'sleep'), never "
                               "the text, are added to crew-level counts for research. Nothing is shown per "
                               f"person, and nothing at all unless at least {MIN_CONSENTING} crew members agree. "
                               "You can change your mind at any time."}


def set_consent(conn: sqlite3.Connection, user: dict[str, Any], research_consent: bool) -> dict[str, Any]:
    astronaut_id = _astronaut_for(conn, user)["astronaut_id"]
    conn.execute(
        """INSERT INTO wellbeing_consent (astronaut_id, research_consent, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(astronaut_id) DO UPDATE SET research_consent = excluded.research_consent,
               updated_at = excluded.updated_at""", (astronaut_id, int(research_consent), to_iso(utcnow())))
    write_audit(conn, user_id=user["user_id"], action_type="set_journal_research_consent",
                entity_type="astronaut", entity_id=astronaut_id, action_result="success",
                change_summary="consent given" if research_consent else "consent withdrawn", commit=False)
    conn.commit()
    return get_consent(conn, user)


def research_summary(conn: sqlite3.Connection, user: dict[str, Any], *, from_day: int | None = None,
                     to_day: int | None = None, include_synthetic: bool = False) -> dict[str, Any]:
    """Crew-level theme counts from consenting astronauts. Never text, never per astronaut."""
    auth_service.require_role(user, *permissions.JOURNAL_RESEARCH_ROLES)
    consenting = [r[0] for r in conn.execute("SELECT astronaut_id FROM wellbeing_consent WHERE research_consent = 1")]
    base = {"consenting_astronauts": len(consenting), "minimum_required": MIN_CONSENTING,
            "window": {"from_day": from_day, "to_day": to_day},
            "note": "Counts of journal themes across consenting crew. No text and no per-person figures are "
                    "available here by design."}
    if len(consenting) < MIN_CONSENTING:
        return {**base, "available": False, "entries": None, "themes": None, "mood": None, "by_week": None,
                "reason": f"Fewer than {MIN_CONSENTING} crew members have given consent, so nothing is shown: "
                          "small counts could point to one person."}
    marks = ",".join("?" * len(consenting))
    rows = conn.execute(
        f"""SELECT mission_day, analysis_json FROM journal_entries WHERE astronaut_id IN ({marks})
            AND (? IS NULL OR mission_day >= ?) AND (? IS NULL OR mission_day <= ?) AND (? OR origin = 'astronaut')""",
        (*consenting, from_day, from_day, to_day, to_day, include_synthetic)).fetchall()
    themes, mood, weeks = Counter(), Counter(), Counter()
    for r in rows:
        analysis = json.loads(r["analysis_json"]) if r["analysis_json"] else {}
        themes.update(set(coach_service.labels(analysis, "themes")))
        mood[analysis.get("mood_valence") or "unknown"] += 1
        weeks[((r["mission_day"] or 1) - 1) // 7 + 1] += 1
    write_audit(conn, user_id=user["user_id"], action_type="read_journal_research_summary",
                entity_type="journal_entry", entity_id=None, action_result="success",
                change_summary=f"{len(rows)} entries from {len(consenting)} consenting astronauts; counts only")
    return {**base, "available": True, "entries": len(rows), "includes_synthetic_demo": include_synthetic,
            "themes": {coach_service.THEMES[k]: v for k, v in themes.most_common()}, "mood": dict(mood),
            "by_week": [{"mission_week": w, "entries": n} for w, n in sorted(weeks.items())]}


# --------------------------------------------------------------------------- synthetic demo entries

_DEMO_TEXTS = (
    "Long day on the maintenance checklist, but the pump repair finally held. Shared dinner with the crew after.",
    "Slept badly again and felt tired through the morning tasks. A nap after lunch helped a little.",
    "Good call with the ground today. I miss my family, but hearing about home made the evening lighter.",
    "The experiment ran late and the schedule felt tight. Frustrating, though my crewmates helped me catch up.",
    "Quiet day. Read a book, listened to music and watched the stars for a while. Feeling calm.",
    "Getting used to the routine now. Breakfast with the crew is becoming the best part of the day.",
    "Felt a bit alone this afternoon. Talked with a crewmate over coffee and it helped.",
    "Headache in the morning, better after exercise. The work went well and I am proud of the sample run.",
)


def seed_demo_entries(conn: sqlite3.Connection, user: dict[str, Any], *, simulation_run_id: str | None = None,
                      days: int = 14) -> dict[str, Any]:
    """Fill the signed-in astronaut's own journal with labelled, fictional entries for the days before
    the run's mission time, so the trends screens have something to show. Safe to repeat."""
    astronaut = _astronaut_for(conn, user)
    astronaut_id = astronaut["astronaut_id"]
    if not 1 <= days <= 90:
        raise ValidationFailed("days must be between 1 and 90")
    run_id = simulation_run_id or get_settings().default_template_run_id
    now = resolve_as_of(conn, None, run_id)
    launch = mission_launch(conn, astronaut["mission_id"])
    today = (now - launch).days + 1
    offset = sum(ord(c) for c in astronaut_id)  # each astronaut gets a different, repeatable sequence
    created = 0
    for day in range(max(1, today - days), today):
        if conn.execute("SELECT 1 FROM journal_entries WHERE astronaut_id = ? AND mission_day = ? AND origin = ?",
                        (astronaut_id, day, SYNTHETIC)).fetchone():
            continue
        text = _DEMO_TEXTS[(offset + day * 3) % len(_DEMO_TEXTS)]
        analysis = {**coach_service.keyword_analysis(text), "source": SYNTHETIC}
        analysis["crisis_markers"] = []  # fiction never carries a crisis marker
        when = to_iso(launch + timedelta(days=day - 1, hours=20))
        conn.execute(
            """INSERT INTO journal_entries (entry_id, astronaut_id, user_id, simulation_run_id, created_at,
                   mission_time, mission_day, text, analysis_json, analysis_source, reflection_text,
                   reflection_source, writing_prompt, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (_id("JRN"), astronaut_id, user["user_id"], run_id, to_iso(utcnow()), when, day, text,
             json.dumps(analysis), SYNTHETIC,
             coach_service.finish_reply(rule_based_reflection(analysis, {}, None), analysis), SYNTHETIC,
             coach_service.writing_prompt(analysis), SYNTHETIC))
        created += 1
    conn.commit()
    return {"astronaut_id": astronaut_id, "created": created, "through_mission_day": today - 1,
            "note": "Fictional entries, labelled synthetic_demo. They are private like any entry, never count "
                    "toward risk flags, and are left out of research counts unless asked for."}
