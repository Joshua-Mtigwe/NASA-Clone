"""Phase 6 HTTP tests with a fake model: routes, roles, and that everything answers when the model is off."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import gemma_client  # noqa: E402

API = "/api/v1"


class FakeModel:
    model = "gemma-test:1b"

    def __init__(self):
        self.reply, self.error = "A Sleep preparation is suggested.", None

    def generate(self, system, prompt, max_tokens=400):
        if self.error:
            raise self.error
        return self.reply

    def status(self):
        return {"url": "http://127.0.0.1:11434", "model": self.model, "reachable": True, "model_installed": True,
                "model_version": "abc", "installed_models": [self.model], "error": None}


@pytest.fixture
def model(monkeypatch):
    fake = FakeModel()
    monkeypatch.setattr(gemma_client, "get_client", lambda: fake)
    return fake


@pytest.fixture
def client(db_path):
    with TestClient(app) as c:
        yield c


def login(client, username):
    """Open demo mode: act as this persona. No password or token."""
    return {"X-AEGIS-User": username}


def test_ai_routes_over_http(client, model):
    leader, officer, researcher, crew4, crew1 = (login(client, u) for u in (
        "mission_leader", "medical_officer", "researcher", "crew4", "crew1"))
    client.post(f"{API}/simulation/runs/RUN-DEMO-001/jump", json={"mission_day": 10, "hour": 10}, headers=leader)
    made = client.post(f"{API}/recovery/recommendations/generate", headers=officer).json()
    rid = next(a for a in made["astronauts"] if a["astronaut_id"] == "AST-004")["recommendations"][0][
        "recommendation_id"]
    url = f"{API}/ai/recovery-recommendations/{rid}/explain"

    for who in (leader, researcher, crew4):
        assert client.post(url, headers=who).status_code == 403
    assert client.post(url, headers=login(client, "nobody")).status_code == 401  # unknown persona
    good = client.post(url, headers=officer)
    assert good.status_code == 200 and good.json()["source"] == "gemma"

    read = f"{API}/ai/explanations/recovery_recommendation/{rid}"
    assert client.get(read, headers=crew4).json()["text"] == "A Sleep preparation is suggested."
    assert client.get(read, headers=crew1).status_code == 403
    assert client.get(f"{API}/ai/explanations/nonsense/{rid}", headers=officer).status_code == 422
    assert client.post(f"{API}/ai/recovery-recommendations/RCR-AST-001-001/explain", headers=officer).status_code == 409

    # model off: still 200, with the rule-based text
    model.error = gemma_client.ModelUnavailable("model_unreachable", "Cannot reach the model server")
    off = client.post(url, headers=officer)
    assert off.status_code == 200 and off.json()["inference"]["status"] == "failed"
    assert off.json()["source"] == "gemma"  # the earlier checked answer is still shown

    # tasks
    plan = client.post(f"{API}/planning/optimize", json={"task_set_id": "SET-010", "solver": "builtin"},
                       headers=leader).json()
    version = client.get(f"{API}/planning/schedule-versions/{plan['schedule_version_id']}", headers=leader).json()
    aid = version["assignments"][0]["task_assignment_id"]
    assert client.post(f"{API}/ai/task-assignments/{aid}/explain", headers=officer).status_code == 403
    task = client.post(f"{API}/ai/task-assignments/{aid}/explain", headers=leader)
    assert task.status_code == 200 and task.json()["source"] == "rules" and "Chosen by" in task.json()["text"]
    assert client.post(f"{API}/ai/task-assignments/TA-010-01/explain", headers=leader).status_code == 409

    # reports
    job = client.post(f"{API}/research/analyses/ANL-001/run", headers=researcher,
                      json={"as_of": "2027-05-29T23:00:00Z"}).json()
    assert client.post(f"{API}/ai/reports", json={"job_id": job["job_id"]}, headers=officer).status_code == 403
    report = client.post(f"{API}/ai/reports", json={"job_id": job["job_id"]}, headers=researcher)
    assert report.status_code == 201 and report.json()["source"] == "template" and report.json()["status"] == "draft"

    # admin
    assert client.get(f"{API}/admin/ai-inferences", headers=researcher).status_code == 403
    log = client.get(f"{API}/admin/ai-inferences", headers=leader).json()
    assert log["counts_by_status"] == {"succeeded": 1, "failed": 3}
    assert {i["purpose"] for i in log["inferences"]} == {"recovery_explanation", "task_explanation", "research_report"}
    status = client.get(f"{API}/admin/model-status", headers=officer).json()
    assert status["ready"] is True and status["model"] == "gemma-test:1b"
    assert status["last_inference"]["status"] == "failed"


def test_everything_answers_with_no_model_installed(client, monkeypatch):
    """No fake here: the real client points at a port where nothing listens."""
    monkeypatch.setenv("AEGIS_GEMMA_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("AEGIS_GEMMA_TIMEOUT_SECONDS", "2")
    leader, officer = login(client, "mission_leader"), login(client, "medical_officer")
    client.post(f"{API}/simulation/runs/RUN-DEMO-001/jump", json={"mission_day": 10, "hour": 10}, headers=leader)
    made = client.post(f"{API}/recovery/recommendations/generate", headers=officer).json()
    rec = next(a for a in made["astronauts"] if a["astronaut_id"] == "AST-004")["recommendations"][0]
    out = client.post(f"{API}/ai/recovery-recommendations/{rec['recommendation_id']}/explain", headers=officer)
    assert out.status_code == 200 and out.json()["source"] == "rules" and out.json()["text"] == rec["reason"]
    status = client.get(f"{API}/admin/model-status", headers=leader).json()
    assert status["ready"] is False and status["reachable"] is False and "Start Ollama" in status["how_to_fix"]
