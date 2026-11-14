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
    assert client.get(f"{API}/wellbeing/conversations/{cid}", headers=as_("medical_officer")).status_code == 200
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


def test_bad_input(client):
    assert client.post(f"{API}/wellbeing/chat", json={"message": ""}, headers=as_("crew1")).status_code == 422
    assert client.post(f"{API}/wellbeing/chat", json={"message": "x" * 1001}, headers=as_("crew1")).status_code == 422
