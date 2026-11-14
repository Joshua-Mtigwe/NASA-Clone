"""Phase 5 HTTP tests: research routes and who may use them."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

API = "/api/v1"
END = "2027-05-29T23:00:00Z"


@pytest.fixture
def client(db_path, with_passwords):
    with TestClient(app) as c:
        yield c


def login(client, username):
    r = client.post(f"{API}/auth/login", json={"username": username, "password": "test-password-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_research_flow_over_http(client):
    researcher, officer = login(client, "researcher"), login(client, "medical_officer")
    assert len(client.get(f"{API}/research/analyses", headers=researcher).json()) == 3
    assert client.get(f"{API}/research/variables", headers=researcher).json()["variables"]

    created = client.post(f"{API}/research/analyses", headers=researcher, json={
        "research_question": "Does sleep quality go with next-day fatigue?",
        "independent_variable": "sleep_quality_score", "dependent_variable": "fatigue_score"})
    assert created.status_code == 201, created.text
    aid = created.json()["analysis_id"]

    # Demo run is still at day 1: the job is kept but fails with a clear message.
    early = client.post(f"{API}/research/analyses/{aid}/run", headers=researcher)
    assert early.status_code == 201 and early.json()["status"] == "failed"
    assert client.get(f"{API}/research/analyses/{aid}/results", headers=researcher).status_code == 404

    job = client.post(f"{API}/research/analyses/{aid}/run", headers=researcher, json={"as_of": END}).json()
    assert job["status"] == "completed" and job["results"][-1]["metric_name"] == "within_person_r"
    assert client.get(f"{API}/research/jobs/{job['job_id']}", headers=officer).json()["summary"]["pairs"] == 450
    assert client.get(f"{API}/research/analyses/{aid}/results", headers=officer).json()["job_id"] == job["job_id"]
    chart = client.get(f"{API}/research/analyses/{aid}/chart", headers=officer).json()
    assert len(chart["points"]) == 450 and chart["lines"]
    assert len(client.get(f"{API}/research/jobs", params={"analysis_id": aid}, headers=officer).json()) == 2

    report = client.post(f"{API}/research/reports", headers=researcher, json={"analysis_id": aid})
    assert report.status_code == 201, report.text
    rid = report.json()["report_id"]
    assert client.get(f"{API}/research/reports", params={"status": "draft"}, headers=officer).json()[0]["report_id"] == rid
    reviewed = client.post(f"{API}/research/reports/{rid}/review", headers=officer,
                           json={"decision": "approve", "comment": "ok"})
    assert reviewed.status_code == 200 and reviewed.json()["status"] == "approved"
    again = client.post(f"{API}/research/reports/{rid}/review", headers=officer, json={"decision": "reject"})
    assert again.status_code == 409

    evaluated = client.post(f"{API}/research/planning-effectiveness/evaluate", headers=researcher,
                            json={"period_start": "2027-03-01", "period_end": "2027-03-07"})
    assert evaluated.status_code == 201 and evaluated.json()["evaluations"][0]["planning_method"] == "preloaded_demo"
    assert len(client.get(f"{API}/research/planning-effectiveness", headers=officer).json()) == 1


def test_research_roles(client):
    crew, leader, officer, researcher = (login(client, u) for u in
                                         ("crew1", "mission_leader", "medical_officer", "researcher"))
    # astronauts see nothing; signed-out users are rejected
    for path in ("/research/analyses", "/research/variables", "/research/jobs", "/research/reports",
                 "/research/planning-effectiveness", "/research/analyses/ANL-001"):
        assert client.get(f"{API}{path}", headers=crew).status_code == 403, path
        assert client.get(f"{API}{path}").status_code == 401, path
        assert client.get(f"{API}{path}", headers=leader).status_code == 200, path
    # only the researcher runs things
    for who in (crew, leader, officer):
        assert client.post(f"{API}/research/analyses/ANL-001/run", headers=who).status_code == 403
        assert client.post(f"{API}/research/reports", headers=who, json={"analysis_id": "ANL-001"}).status_code == 403
        assert client.post(f"{API}/research/planning-effectiveness/evaluate", headers=who, json={
            "period_start": "2027-03-01", "period_end": "2027-03-02"}).status_code == 403
    # only the medical officer reviews
    job = client.post(f"{API}/research/analyses/ANL-001/run", headers=researcher, json={"as_of": END}).json()
    rid = client.post(f"{API}/research/reports", headers=researcher, json={"job_id": job["job_id"]}).json()["report_id"]
    for who in (crew, leader, researcher):
        r = client.post(f"{API}/research/reports/{rid}/review", headers=who, json={"decision": "approve"})
        assert r.status_code == 403


def test_research_errors(client):
    researcher = login(client, "researcher")
    assert client.get(f"{API}/research/analyses/ANL-NOPE", headers=researcher).status_code == 404
    assert client.get(f"{API}/research/jobs/JOB-NOPE", headers=researcher).status_code == 404
    assert client.get(f"{API}/research/reports/RPT-NOPE", headers=researcher).status_code == 404
    bad = client.post(f"{API}/research/analyses", headers=researcher, json={
        "research_question": "q??", "independent_variable": "nope", "dependent_variable": "fatigue_score"})
    assert bad.status_code == 422
    assert client.post(f"{API}/research/analyses/ANL-001/run", headers=researcher,
                       json={"as_of": "yesterday"}).status_code == 422
    assert client.post(f"{API}/research/reports", headers=researcher, json={}).status_code == 422
    # the Phase 2 radiation series still lives under /research
    assert client.get(f"{API}/research/radiation-series", headers=researcher).status_code == 200
