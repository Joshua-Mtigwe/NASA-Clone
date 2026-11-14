"""Mission journal over HTTP (open demo mode personas), with a fake model."""
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
        return "It sounds like a full day. What stood out most for you?"

    def generate_json(self, system, prompt, schema, max_tokens=500):
        return {"mood_valence": "neutral", "themes": [], "stress_triggers": [], "cognitive_distortions": [],
                "crisis_markers": []}

    def status(self):
        return {"reachable": True, "model_installed": True, "model": self.model}


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setattr(gemma_client, "get_client", lambda: FakeModel())
    with TestClient(app) as c:
        c.post(f"{API}/simulation/runs/RUN-DEMO-001/jump", json={"mission_day": 20, "hour": 20},
               headers={"X-AEGIS-User": "mission_leader"})
        yield c


def as_(persona):
    return {"X-AEGIS-User": persona}


def test_write_read_share(client):
    r = client.post(f"{API}/journal/entries", json={"text": "Long day, but dinner with the crew was good."},
                    headers=as_("crew2"))
    assert r.status_code == 201, r.text
    body = r.json()
    entry = body["entry"]
    assert entry["reflection_source"] == "gemma" and entry["writing_prompt"] and body["privacy_note"]
    assert "medical officer" in entry["reflection_text"] and entry["mission_day"] == 20
    eid = entry["entry_id"]

    assert [e["entry_id"] for e in client.get(f"{API}/journal/entries", headers=as_("crew2")).json()] == [eid]
    assert client.get(f"{API}/journal/entries", headers=as_("crew3")).json() == []
    assert client.get(f"{API}/journal/entries", headers=as_("medical_officer")).json() == []
    for persona in ("crew3", "medical_officer", "mission_leader", "researcher"):
        assert client.get(f"{API}/journal/entries/{eid}", headers=as_(persona)).status_code == 403
    assert client.get(f"{API}/journal/entries", headers=as_("mission_leader")).status_code == 403

    assert client.post(f"{API}/journal/entries/{eid}/share", headers=as_("crew3")).status_code == 403
    assert client.post(f"{API}/journal/entries/{eid}/share", headers=as_("crew2")).status_code == 200
    seen = client.get(f"{API}/journal/entries/{eid}", headers=as_("medical_officer"))
    assert seen.status_code == 200 and seen.json()["text"].startswith("Long day")
    client.post(f"{API}/journal/entries/{eid}/share", json={"shared": False}, headers=as_("crew2"))
    assert client.get(f"{API}/journal/entries/{eid}", headers=as_("medical_officer")).status_code == 403


def test_urgent_entry_and_bad_input(client):
    r = client.post(f"{API}/journal/entries", json={"text": "I want to end my life."}, headers=as_("crew1"))
    assert r.status_code == 201 and r.json()["entry"]["reflection_source"] == "escalation"
    assert r.json()["medical_officer_alerted"] == "immediate"
    flags = client.get(f"{API}/wellbeing/risk-flags", headers=as_("medical_officer")).json()
    assert flags["open_count"] == 1 and flags["flags"][0]["source"] == "journal"
    assert "end my life" not in str(flags)
    assert client.post(f"{API}/journal/entries", json={"text": ""}, headers=as_("crew1")).status_code == 422
    assert client.post(f"{API}/journal/entries", json={"text": "x" * 4001}, headers=as_("crew1")).status_code == 422
    assert client.post(f"{API}/journal/entries", json={"text": "hi"}, headers=as_("medical_officer")).status_code == 403
    assert client.get(f"{API}/journal/entries/JRN-NOPE", headers=as_("crew1")).status_code == 404


def test_demo_entries_trends_consent_and_research(client):
    for persona in ("crew1", "crew2", "crew3"):
        made = client.post(f"{API}/journal/demo-entries", json={"days": 14}, headers=as_(persona))
        assert made.status_code == 201 and made.json()["created"] == 14
    assert client.post(f"{API}/journal/demo-entries", headers=as_("mission_leader")).status_code == 403

    trends = client.get(f"{API}/journal/trends", headers=as_("crew1")).json()
    assert trends["entries"] == 14 and trends["by_week"] and "compared_with_your_own_earlier_entries" in trends
    assert client.get(f"{API}/journal/trends", headers=as_("medical_officer")).status_code == 403

    assert client.get(f"{API}/journal/consent", headers=as_("crew1")).json()["research_consent"] is False
    summary = f"{API}/journal/research-summary?include_synthetic=true"
    assert client.get(summary, headers=as_("researcher")).json()["available"] is False
    for persona in ("crew1", "crew2", "crew3"):
        r = client.put(f"{API}/journal/consent", json={"research_consent": True}, headers=as_(persona))
        assert r.status_code == 200 and r.json()["research_consent"] is True
    shown = client.get(summary, headers=as_("researcher")).json()
    assert shown["available"] is True and shown["entries"] == 42 and shown["themes"]
    assert client.get(f"{API}/journal/research-summary", headers=as_("medical_officer")).json()["entries"] == 0
    for persona in ("mission_leader", "crew1"):
        assert client.get(summary, headers=as_(persona)).status_code == 403
    assert client.put(f"{API}/journal/consent", json={"research_consent": True},
                      headers=as_("medical_officer")).status_code == 403
