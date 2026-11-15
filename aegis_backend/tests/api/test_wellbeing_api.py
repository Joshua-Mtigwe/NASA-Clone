"""Wellbeing chat over HTTP (open demo mode personas)."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import gemma_client  # noqa: E402

API = "/api/v1"


class FakeModel:
    model = "gemma-test:1b"

    def generate(self, system, prompt, max_tokens=400):
        return "Thank you for telling me. If you feel worse or unsure, please talk to the medical officer."

    def generate_json(self, system, prompt, schema, max_tokens=500):
        return {"mood_valence": "neutral", "themes": [], "stress_triggers": [], "cognitive_distortions": [],
                "crisis_markers": []}

    def status(self):
        return {"reachable": True, "model_installed": True, "model": self.model}


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setattr(gemma_client, "get_client", lambda: FakeModel())
    with TestClient(app) as c:
        yield c


def as_(persona):
    return {"X-AEGIS-User": persona}


def test_chat_round_trip(client):
    r = client.post(f"{API}/wellbeing/chat", json={"message": "A bit tired today."}, headers=as_("crew2"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"]["source"] == "gemma" and body["safety_note"]
    cid = body["conversation_id"]
    again = client.post(f"{API}/wellbeing/chat", json={"message": "Better now.", "conversation_id": cid},
                        headers=as_("crew2")).json()
    assert again["conversation_id"] == cid
    listed = client.get(f"{API}/wellbeing/conversations", headers=as_("crew2")).json()
    assert len(listed) == 1 and listed[0]["message_count"] == 4
    convo = client.get(f"{API}/wellbeing/conversations/{cid}", headers=as_("crew2")).json()
    assert [m["sender"] for m in convo["messages"]] == ["astronaut", "assistant", "astronaut", "assistant"]


def test_access_rules(client):
    cid = client.post(f"{API}/wellbeing/chat", json={"message": "Tired."}, headers=as_("crew2")).json()[
        "conversation_id"]
    assert client.get(f"{API}/wellbeing/conversations/{cid}", headers=as_("crew3")).status_code == 403
    assert client.get(f"{API}/wellbeing/conversations/{cid}", headers=as_("mission_leader")).status_code == 403
    hidden = client.get(f"{API}/wellbeing/conversations/{cid}", headers=as_("medical_officer"))
    assert hidden.status_code == 200 and hidden.json()["private"] is True and hidden.json()["messages"] == []
    assert client.post(f"{API}/wellbeing/conversations/{cid}/share", headers=as_("crew3")).status_code == 403
    assert client.post(f"{API}/wellbeing/conversations/{cid}/share", headers=as_("crew2")).status_code == 200
    opened = client.get(f"{API}/wellbeing/conversations/{cid}", headers=as_("medical_officer")).json()
    assert opened["private"] is False and opened["messages"][0]["text"] == "Tired."
    assert client.post(f"{API}/wellbeing/conversations/{cid}/share", json={"shared": False},
                       headers=as_("crew2")).json()["shared_with_medical_officer"] is False
    assert client.post(f"{API}/wellbeing/chat", json={"message": "hi"}, headers=as_("medical_officer")).status_code == 403


def test_urgent_flag_and_review(client):
    body = client.post(f"{API}/wellbeing/chat", json={"message": "I have chest pain"}, headers=as_("crew1")).json()
    assert body["flagged"] and body["reply"]["source"] == "escalation"
    officer = as_("medical_officer")
    flagged = client.get(f"{API}/wellbeing/conversations?flagged=true", headers=officer).json()
    assert [c["conversation_id"] for c in flagged] == [body["conversation_id"]]
    r = client.post(f"{API}/wellbeing/conversations/{body['conversation_id']}/review",
                    json={"note": "Checked in person; fine."}, headers=officer)
    assert r.status_code == 200 and r.json()["review_note"] == "Checked in person; fine."
    # the risk flag: indicator only, visible to the medical officer and to the astronaut concerned
    assert body["medical_officer_alerted"] == "immediate" and body["privacy_note"]
    flags = client.get(f"{API}/wellbeing/risk-flags?open_only=true", headers=officer).json()
    assert flags["open_count"] == 1 and flags["flags"][0]["astronaut_id"] == "AST-001"
    assert flags["flags"][0]["indicators"] == [{"marker": "urgent_physical_symptom",
                                                "meaning": "an urgent physical symptom"}]
    assert "chest pain" not in str(flags)
    fid = flags["flags"][0]["flag_id"]
    assert client.get(f"{API}/wellbeing/risk-flags", headers=as_("crew1")).json()["open_count"] == 1
    assert client.get(f"{API}/wellbeing/risk-flags", headers=as_("crew2")).json()["flags"] == []
    assert client.get(f"{API}/wellbeing/risk-flags", headers=as_("mission_leader")).status_code == 403
    assert client.post(f"{API}/wellbeing/risk-flags/{fid}/acknowledge", json={"note": "Seen."},
                       headers=as_("crew1")).status_code == 403
    done = client.post(f"{API}/wellbeing/risk-flags/{fid}/acknowledge", json={"note": "Seen in person."},
                       headers=officer)
    assert done.status_code == 200 and done.json()["open"] is False
    assert client.post(f"{API}/wellbeing/risk-flags/{fid}/acknowledge", json={"note": "Again."},
                       headers=officer).status_code == 409


def test_bad_input(client):
    assert client.post(f"{API}/wellbeing/chat", json={"message": ""}, headers=as_("crew1")).status_code == 422
    assert client.post(f"{API}/wellbeing/chat", json={"message": "x" * 1001}, headers=as_("crew1")).status_code == 422
