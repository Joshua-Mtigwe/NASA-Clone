"""Wellbeing chat: replies use the astronaut's own metrics, are checked, and are stored; urgent
messages go to the medical officer, never the model. A fake model stands in for Gemma."""
import json

import pytest

from app.core.errors import NotFound, PermissionDenied, ValidationFailed
from app.services import gemma_client
from app.services import mission_simulator as sim
from app.services import wellbeing_service as wb
from app.utils.timestamps import parse_iso

CREW4 = {"user_id": "USR-004", "role_name": "astronaut"}
CREW1 = {"user_id": "USR-001", "role_name": "astronaut"}
LEADER = {"user_id": "USR-006", "role_name": "mission_leader"}
OFFICER = {"user_id": "USR-008", "role_name": "medical_officer"}
DAY10 = parse_iso("2027-03-10T10:00:00Z")


class FakeModel:
    model = "gemma-test:1b"

    def __init__(self):
        self.reply, self.error, self.calls = None, None, []

    def generate(self, system, prompt, max_tokens=400):
        self.calls.append((system, prompt))
        if self.error:
            raise self.error
        facts = json.loads(prompt.split("Facts (JSON):\n", 1)[1])
        return self.reply(facts) if callable(self.reply) else self.reply

    def status(self):
        return {"reachable": True, "model_installed": True, "model": self.model}


@pytest.fixture
def model(monkeypatch):
    fake = FakeModel()
    fake.reply = lambda f: ("Thank you for telling me. Your total sleep last night was "
                            f"{f['unusual_today'][0]['today']} minutes, lower than your usual "
                            f"{f['unusual_today'][0]['own_usual']}. A "
                            f"{f['approved_activities'][0]['duration_minutes']}-minute "
                            f"{f['approved_activities'][0]['name']} could be a good fit right now. If you feel worse "
                            "or unsure, please talk to the medical officer.")
    monkeypatch.setattr(gemma_client, "get_client", lambda: fake)
    return fake


@pytest.fixture
def day10(conn):
    """Day 10, 10:00: in the seed AST-004 slept less than usual and reports more fatigue."""
    sim.jump_to_mission_day(conn, "RUN-DEMO-001", 10, actor_user_id="USR-006", hour=10)
    return conn


# --------------------------------------------------------------------------- urgent messages

@pytest.mark.parametrize("text,kind", [
    ("I have chest pain", "physical"), ("I can't breathe properly", "physical"), ("I feel faint", "physical"),
    ("I passed out earlier", "physical"), ("I've been thinking about suicide", "self_harm"),
    ("I want to hurt myself", "self_harm"), ("I don't want to wake up tomorrow", "self_harm"),
    ("I feel tired and a bit stressed", None), ("The breathing exercise was nice", None),
])
def test_urgent_detection(text, kind):
    assert wb.urgent_kind(text) == kind


def test_urgent_message_never_reaches_the_model(day10, model):
    out = wb.send_message(day10, CREW4, "I have chest pain and feel dizzy")
    assert model.calls == []
    assert out["reply"]["source"] == "escalation" and "medical officer now" in out["reply"]["text"]
    assert out["flagged"] is True
    audit = day10.execute("SELECT action_type FROM audit_logs WHERE action_type = 'wellbeing_escalation'").fetchall()
    assert len(audit) == 1


def test_self_harm_reply_points_to_real_help(day10, model):
    out = wb.send_message(day10, CREW4, "Some days I feel like I want to end my life")
    assert out["reply"]["source"] == "escalation" and "crisis line" in out["reply"]["text"]
    assert wb.list_conversations(day10, OFFICER, flagged=True)[0]["flag_reason"] == "urgent: self_harm"


# --------------------------------------------------------------------------- the facts

def test_facts_are_the_astronauts_own_picture(day10):
    facts = wb.build_facts(day10, "AST-004", DAY10, "RUN-DEMO-001")
    sleep = facts["measurements"]["total_sleep_minutes"]
    assert sleep["what"] == "total sleep last night" and sleep["unusual_for_them"] is True
    assert sleep["difference_from_usual"] == round(sleep["today"] - sleep["own_usual"], 1)
    assert facts["vitals_now"] and all("usual range" in v["compared_with_your_usual_range"] for v in facts["vitals_now"])
    assert facts["radiation"]["unit"] == "uSv/h"
    assert {a["name"] for a in facts["approved_activities"]} and "today_schedule" in facts
    assert len(json.dumps(facts)) < 4000  # a compact packet, never raw tables


def test_only_approved_activities_are_offered(day10):
    day10.execute("UPDATE recovery_activities SET approval_status = 'withdrawn' WHERE recovery_activity_id = 'REC-005'")
    day10.commit()
    names = {a["name"] for a in wb.build_facts(day10, "AST-004", DAY10, "RUN-DEMO-001")["approved_activities"]}
    assert "Mindfulness break" not in names


# --------------------------------------------------------------------------- replies and storage

def test_reply_is_checked_stored_with_its_facts(day10, model):
    out = wb.send_message(day10, CREW4, "I feel tired and foggy this morning.")
    reply = out["reply"]
    assert reply["source"] == "gemma" and reply["inference_id"] and "medical officer" in reply["text"]
    assert reply["facts"]["all"]["measurements"]["total_sleep_minutes"]["today"] > 0  # full picture kept
    assert reply["facts"]["shown_to_model"]["unusual_today"]  # and exactly what the model was given
    assert out["message"]["sender"] == "astronaut" and out["message"]["text"] == "I feel tired and foggy this morning."
    assert out["safety_note"] == wb.SAFETY_NOTE
    stored = day10.execute("SELECT sender, source FROM wellbeing_messages ORDER BY rowid").fetchall()
    assert [tuple(r) for r in stored] == [("astronaut", None), ("assistant", "gemma")]
    log = day10.execute("SELECT purpose, prompt_template_version, status FROM ai_inference_logs").fetchone()
    assert tuple(log) == ("wellbeing_chat", "wellbeing_v2", "succeeded")


def test_conversation_continues_with_history(day10, model):
    first = wb.send_message(day10, CREW4, "I slept badly.")
    wb.send_message(day10, CREW4, "Still tired now.", conversation_id=first["conversation_id"])
    facts = json.loads(model.calls[1][1].split("Facts (JSON):\n", 1)[1])
    assert facts["astronaut_says"] == "Still tired now."
    assert [m["text"] for m in facts["recent_conversation"]][0] == "I slept badly."
    assert len(wb.get_conversation(day10, CREW4, first["conversation_id"])["messages"]) == 4


@pytest.mark.parametrize("reply,problem", [
    ("You could take some ibuprofen for that.", "medication"),
    ("This sounds like a sleep disorder.", "disorder"),
    ("You slept 200 minutes less than usual.", "number 200"),
])
def test_bad_model_reply_is_replaced_by_rules(day10, model, reply, problem):
    model.reply = reply
    out = wb.send_message(day10, CREW4, "Should I take ibuprofen? I think I have a disorder.")
    assert out["reply"]["source"] == "rules" and "Thank you for telling me" in out["reply"]["text"]
    assert any(problem in p for p in out["reply"]["check_problems"])


def test_model_offline_uses_rule_reply(day10, model):
    model.error = gemma_client.ModelUnavailable("model_unreachable", "down")
    out = wb.send_message(day10, CREW4, "Feeling low today.")
    assert out["reply"]["source"] == "rules"
    assert "lower than your usual" in out["reply"]["text"] and "medical officer" in out["reply"]["text"]


def test_rule_reply_when_nothing_is_unusual():
    facts = {"measurements": {}, "vitals_now": [], "approved_activities": [], "rules_suggest": []}
    assert "within your own usual range" in wb.rule_based_reply(facts)


def test_message_validation(day10, model):
    with pytest.raises(ValidationFailed):
        wb.send_message(day10, CREW4, "   ")
    with pytest.raises(ValidationFailed):
        wb.send_message(day10, CREW4, "x" * 1001)
    with pytest.raises(NotFound):
        wb.send_message(day10, CREW4, "hello", conversation_id="CHT-NOPE")


# --------------------------------------------------------------------------- who can see what

def test_only_astronauts_chat(day10, model):
    for user in (LEADER, OFFICER):
        with pytest.raises(PermissionDenied):
            wb.send_message(day10, user, "testing")


def test_privacy_between_astronauts_and_staff(day10, model):
    cid = wb.send_message(day10, CREW4, "I feel tired.")["conversation_id"]
    with pytest.raises(PermissionDenied):
        wb.get_conversation(day10, CREW1, cid)
    with pytest.raises(PermissionDenied):
        wb.send_message(day10, CREW1, "hi", conversation_id=cid)
    with pytest.raises(PermissionDenied):
        wb.get_conversation(day10, LEADER, cid)  # mission leader: not a medical role
    assert wb.list_conversations(day10, CREW1) == []
    mine = wb.get_conversation(day10, CREW4, cid)
    assert "check_problems" not in mine["messages"][1]  # internal check details stay with staff


def test_medical_officer_reads_are_audited_and_reviews_flags(day10, model):
    cid = wb.send_message(day10, CREW4, "I feel faint")["conversation_id"]
    seen = wb.get_conversation(day10, OFFICER, cid)
    assert seen["flagged"] and seen["messages"][1]["source"] == "escalation"
    reads = day10.execute("SELECT COUNT(*) FROM audit_logs WHERE action_type = 'read_wellbeing_conversation'").fetchone()
    assert reads[0] == 1
    with pytest.raises(ValidationFailed):
        wb.review_conversation(day10, OFFICER, cid, " ")
    with pytest.raises(PermissionDenied):
        wb.review_conversation(day10, LEADER, cid, "checked")
    done = wb.review_conversation(day10, OFFICER, cid, "Spoke with the crew member; resting.")
    assert done["reviewed_by_user_id"] == "USR-008"
    calm = wb.send_message(day10, CREW4, "I feel calmer.")["conversation_id"]
    with pytest.raises(ValidationFailed):
        wb.review_conversation(day10, OFFICER, calm, "nothing to review")


# --------------------------------------------------------------------------- what the model is shown

def test_model_sees_only_unusual_values(day10):
    facts = wb.build_facts(day10, "AST-004", DAY10, "RUN-DEMO-001")
    seen = wb.model_facts(facts, "I feel tired.")
    assert seen["unusual_today"] and all(u.get("what") for u in seen["unusual_today"])
    assert seen["everything_else"] == "within your own usual range"
    normal_values = {v["value"] for v in facts["vitals_now"]
                     if v["compared_with_your_usual_range"] == "within your usual range"}
    assert not any(str(v) in __import__("json").dumps(seen) for v in normal_values)  # no normal numbers to echo
    assert "radiation" not in seen  # only when they ask about it
    assert "radiation" in wb.model_facts(facts, "Is my radiation dose ok?")


def test_topic_guidance_goes_into_the_instructions(day10, model):
    wb.send_message(day10, CREW4, "Should I take a sleeping pill?")
    _system, prompt = model.calls[0]
    instructions = prompt.split("Facts (JSON):", 1)[0]
    assert "For this message:" in instructions and "can't advise on that" in instructions
    assert "guidance" not in prompt.split("Facts (JSON):", 1)[1]


@pytest.mark.parametrize("text,expected", [
    ("Should I take melatonin?", "taking something"), ("Is my radiation dose ok?", "radiation"),
    ("What is wrong with me?", "what is wrong"), ("I feel fine", None)])
def test_chat_guidance_topics(text, expected):
    from app.services import ai_service

    notes = ai_service.chat_guidance(text)
    assert (expected is None and notes == []) or any(expected in n for n in notes)


def test_rule_reply_reads_naturally():
    facts = {"measurements": {"fatigue_score": {"what": "self-reported fatigue", "unit": "1-9", "today": 5.8,
                                                "own_usual": 2.7, "compared_with_usual": "higher",
                                                "unusual_for_them": True}},
             "vitals_now": [], "rules_suggest": ["Guided paced breathing"],
             "approved_activities": [{"name": "Guided paced breathing", "duration_minutes": 8}]}
    text = wb.rule_based_reply(facts)
    assert "5.8, higher" in text and "1-9" not in text and "An 8-minute Guided paced breathing" in text


def test_nothing_unusual_instruction(day10, model):
    facts = wb.build_facts(day10, "AST-001", DAY10, "RUN-DEMO-001")
    calm = {**wb.model_facts(facts, "I feel fine"), "unusual_today": []}
    assert wb.NOTHING_UNUSUAL in wb._instructions("I feel fine", calm)
    assert wb.NOTHING_UNUSUAL not in wb._instructions("I feel fine", {"unusual_today": [{"what": "x"}]})
