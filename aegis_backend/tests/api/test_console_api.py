"""Regression tests exercise the preserved frontend's live API contract."""

import pytest
from fastapi.testclient import TestClient
from app.main import app

BASE = "/api/v1/console/"


@pytest.fixture
def client(db_path, conn):
    from app.services.mission_simulator import jump_to_mission_day

    jump_to_mission_day(conn, "RUN-DEMO-001", 25, actor_user_id="USR-006", hour=9)
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize(
    "path",
    [
        "missions/current/state",
        "auth/demo-accounts",
        "astronauts",
        "astronauts/AST-001",
        "astronauts/AST-001/health/summary",
        "astronauts/AST-001/readiness/summary",
        "astronauts/AST-001/baselines",
        "astronauts/AST-001/schedule",
        "vitals/history?astronaut_id=AST-001&measurement_type=heart_rate",
        "vitals/reference?astronaut_id=AST-001&measurement_type=heart_rate",
        "vitals/environment",
        "vitals/sensors",
        "vitals/activity?astronaut_id=AST-001",
        "sleep?astronaut_id=AST-001",
        "radiation?astronaut_id=AST-001",
        "radiation/organ-dose?astronaut_id=AST-001",
        "radiation/reference",
        "assessments/protocols",
        "assessments/metric-definitions",
        "assessments/schedule-templates",
        "assessments/due?astronaut_id=AST-001",
        "assessments/sessions?astronaut_id=AST-001",
        "assessments/assignments?astronaut_id=AST-001",
        "assessments/mission-mind/summary?astronaut_id=AST-001",
        "cognition/daily-results?astronaut_id=AST-001",
        "cognition/comparisons?astronaut_id=AST-001",
        "cognition/summary?astronaut_id=AST-001",
        "planning/overview",
        "planning/task-sets",
        "planning/task-sets/SET-001",
        "planning/crew-overview",
        "planning/schedules",
        "planning/recovery/catalogue",
        "recovery/recommendations?astronaut_id=AST-001",
        "recovery/published?astronaut_id=AST-001&date=2027-03-25",
        "recovery/scheduled?astronaut_id=AST-001",
        "research/overview",
        "research/variables",
        "research/analyses",
        "research/planning-comparison",
    ],
)
def test_dashboard_reads(client, path):
    response = client.get(BASE + path, headers={"X-AEGIS-User": "USR-006"})
    assert response.status_code == 200, response.text


def test_demo_identity_and_permissions(client, conn):
    a = dict(
        conn.execute(
            "SELECT a.*,u.username FROM astronauts a JOIN users u ON u.user_id=a.user_id LIMIT 1"
        ).fetchone()
    )
    response = client.post(BASE + "auth/demo-session", json={"username": a["username"]})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["astronaut_id"] == a["astronaut_id"]
    acting = {"X-AEGIS-User": a["user_id"]}
    assert len(client.get(BASE + "astronauts", headers=acting).json()) == 1
    other = conn.execute(
        "SELECT astronaut_id FROM astronauts WHERE astronaut_id!=? LIMIT 1",
        (a["astronaut_id"],),
    ).fetchone()[0]
    assert (
        client.get(
            BASE + f"astronauts/{other}/health/summary", headers=acting
        ).status_code
        == 403
    )
    assert client.get(BASE + "assessments/oversight", headers=acting).status_code == 403


def test_measurements_are_deterministic_and_clamped(client):
    first = client.get(BASE + "astronauts/AST-001/health/summary").json()
    assert first == client.get(BASE + "astronauts/AST-001/health/summary").json()
    assert (
        next(m for m in first["measurements"] if m["measure"] == "blood_pressure")[
            "value"
        ]
        is None
    )
    for endpoint, time in [
        ("vitals/history", "timestamp_utc"),
        ("sleep", "sleep_end"),
        ("radiation", "timestamp_utc"),
        ("radiation/organ-dose", "timestamp_utc"),
    ]:
        data = client.get(
            BASE + endpoint + "?astronaut_id=AST-001&to=2099-01-01&limit=10000"
        ).json()
        if isinstance(data, dict):
            data = data["items"]
        assert data
        assert all(r[time] <= first["as_of"] for r in data)


def staff_header(c, role):
    return {
        "X-AEGIS-User": c.execute(
            "SELECT u.user_id FROM users u JOIN roles r ON r.role_id=u.role_id WHERE r.role_name=? LIMIT 1",
            (role,),
        ).fetchone()[0]
    }


def test_assessment_trials_retries_and_results(client, conn):
    medical = staff_header(conn, "medical_officer")
    when = client.get(BASE + "missions/current/state").json()["mission_time"]
    template = client.post(
        BASE + "assessments/schedule-templates",
        headers=medical,
        json=dict(
            mission_phase="inflight",
            assessment_condition="morning",
            local_hour=8,
            protocol_ids="NBACK",
            recurrence="on_demand",
            description="Integration regression",
        ),
    )
    assert template.status_code == 200, template.text
    assigned = client.post(
        BASE + "assessments/assignments",
        headers=medical,
        json=dict(
            astronaut_ids=["AST-001"],
            template_id=template.json()["template_id"],
            scheduled_at=when,
        ),
    )
    assert assigned.status_code == 200, assigned.text
    actor = {
        "X-AEGIS-User": conn.execute(
            "SELECT user_id FROM astronauts WHERE astronaut_id='AST-001'"
        ).fetchone()[0]
    }
    start = client.post(
        BASE + "assessments/sessions",
        headers=actor,
        json={"assignment_id": assigned.json()[0]["assignment_id"]},
    )
    assert start.status_code == 200, start.text
    sid = start.json()["session_id"]
    trials = [
        dict(
            trial_number=i,
            stimulus_type="letter",
            stimulus_value="A",
            expected_response="match",
            actual_response="match",
            reaction_time_ms=300,
            trial_timestamp=when,
        )
        for i in range(1, 11)
    ]
    assert (
        client.post(
            BASE + f"assessments/sessions/{sid}/trials",
            headers=actor,
            json={"trials": trials, "phase": "practice"},
        ).status_code
        == 200
    )
    assert (
        conn.execute(
            "SELECT COUNT(*) FROM assessment_trials WHERE session_id=?", (sid,)
        ).fetchone()[0]
        == 0
    )
    for _ in range(2):
        response = client.post(
            BASE + f"assessments/sessions/{sid}/trials",
            headers=actor,
            json={"trials": trials, "phase": "test"},
        )
        assert response.status_code == 200, response.text
    assert (
        conn.execute(
            "SELECT COUNT(*) FROM assessment_trials WHERE session_id=?", (sid,)
        ).fetchone()[0]
        == 10
    )
    done = client.post(
        BASE + f"assessments/sessions/{sid}/complete",
        headers=actor,
        json={"completed_at": when},
    )
    assert done.status_code == 200, done.text
    assert done.json()["results"][0]["metric_value"] == 100
    assert (
        client.post(
            BASE + f"assessments/sessions/{sid}/complete", headers=actor, json={}
        ).json()["results"]
        == done.json()["results"]
    )
    trends = client.get(
        BASE + "cognition/daily-results?astronaut_id=AST-001", headers=actor
    ).json()
    assert any(
        r["protocol_id"] == "NBACK" and r["assessment_date"] == when[:10]
        for r in trends
    )


def test_schedule_approval_and_astronaut_calendar(client, conn):
    state = client.get(BASE + "missions/current/state").json()
    task_set = conn.execute(
        "SELECT task_set_id FROM daily_task_sets WHERE task_date=?",
        (state["mission_time"][:10],),
    ).fetchone()[0]
    result = client.post(BASE + "planning/optimize", json={"task_set_id": task_set})
    assert result.status_code == 200, result.text
    run = client.get(
        BASE + "planning/optimize/" + result.json()["optimization_run_id"]
    ).json()
    assert run["run"]["status"] == "completed", run
    vid = run["schedule_version_id"]
    assert vid
    detail = client.get(BASE + "planning/schedules/" + vid).json()
    result = client.post(
        BASE + f"planning/schedules/{vid}/approve",
        json={"confirmed_safety_critical": detail["safety_critical_task_ids"]},
    )
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "published"
    for a in detail["assignments"]:
        calendar = client.get(
            BASE
            + f"astronauts/{a['astronaut_id']}/schedule?date={a['planned_start'][:10]}"
        ).json()
        assert any(i["ref_id"] == a["task_assignment_id"] for i in calendar["items"])
    assert (
        client.post(
            BASE + f"planning/schedules/{vid}/approve",
            json={"confirmed_safety_critical": detail["safety_critical_task_ids"]},
        ).status_code
        == 200
    )
    assert conn.execute(
        "SELECT COUNT(*) FROM daily_schedules WHERE schedule_version_id=?", (vid,)
    ).fetchone()[0] == len(detail["assignments"])


def test_routine_publish_persistence_and_idempotency(client, conn):
    state = client.get(BASE + "missions/current/state").json()
    rid = conn.execute(
        "SELECT recommendation_id FROM recovery_recommendations WHERE mission_day=? LIMIT 1",
        (state["mission_day"],),
    ).fetchone()[0]
    check = client.post(
        BASE + f"recovery/recommendations/{rid}/publish", json={"dry_run": True}
    )
    assert check.status_code == 200, check.text
    assert check.json()["state"] == "ready_to_publish", check.text
    result = client.post(
        BASE + f"recovery/recommendations/{rid}/publish",
        json={"scheduled_start": check.json()["scheduled_start"]},
    )
    assert result.status_code == 200, result.text
    assert result.json()["state"] == "published", result.text
    retried = client.post(
        BASE + f"recovery/recommendations/{rid}/publish", json={}
    ).json()
    assert retried["already_published"] is True
    assert result.json()["schedule_id"] == retried["schedule_id"]
    published = client.get(
        BASE + "recovery/published",
        params={
            "astronaut_id": retried["recommendation"]["astronaut_id"],
            "date": retried["scheduled_start"][:10],
        },
    ).json()
    assert any(p["schedule_id"] == retried["schedule_id"] for p in published)


def test_numerical_research(client, conn):
    researcher = staff_header(conn, "medical_researcher")
    response = client.post(
        BASE + "research/analyses",
        headers=researcher,
        json=dict(
            research_question="Does sleep vary with reaction time?",
            independent_variable="total_sleep_minutes",
            dependent_variable="median_reaction_time_ms",
            analysis_method="within_person",
            date_range_start="2027-03-01",
            date_range_end="2027-05-29",
            mission_phase="inflight",
            quality_status="valid",
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed", response.text
    aid = response.json()["analysis_id"]
    assert client.get(
        BASE + f"research/analyses/{aid}/results", headers=researcher
    ).json()
    chart = client.get(BASE + f"research/analyses/{aid}/charts", headers=researcher)
    assert chart.status_code == 200, chart.text
    assert chart.json()[0]["points"]
    assert all(p["astronaut_id"].startswith("P") for p in chart.json()[0]["points"])


@pytest.mark.parametrize(
    "protocol,metric",
    [
        ("SWITCH", "accuracy_percent"),
        ("SYMBOL", "correct_responses_per_minute"),
        ("ROTATION", "accuracy_percent"),
        ("REASONING", "accuracy_percent"),
    ],
)
def test_extended_battery_uses_backend_scoring(client, conn, protocol, metric):
    medical = staff_header(conn, "medical_officer")
    when = client.get(BASE + "missions/current/state").json()["mission_time"]
    template = client.post(
        BASE + "assessments/schedule-templates",
        headers=medical,
        json=dict(
            mission_phase="inflight",
            assessment_condition="morning",
            local_hour=9,
            protocol_ids=protocol,
            recurrence="on_demand",
        ),
    ).json()
    assignment = client.post(
        BASE + "assessments/assignments",
        headers=medical,
        json=dict(
            astronaut_ids=["AST-001"],
            template_id=template["template_id"],
            scheduled_at=when,
        ),
    )
    assert assignment.status_code == 200, assignment.text
    actor = {"X-AEGIS-User": "USR-001"}
    start = client.post(
        BASE + "assessments/sessions",
        headers=actor,
        json={"assignment_id": assignment.json()[0]["assignment_id"]},
    )
    assert start.status_code == 200, start.text
    sid = start.json()["session_id"]
    trials = [
        dict(
            trial_number=i,
            stimulus_type="prototype",
            stimulus_value="1",
            expected_response="1",
            actual_response="1",
            reaction_time_ms=1000,
            trial_timestamp=when,
        )
        for i in range(1, 11)
    ]
    uploaded = client.post(
        BASE + f"assessments/sessions/{sid}/trials",
        headers=actor,
        json={"trials": trials, "phase": "test"},
    )
    assert uploaded.status_code == 200, uploaded.text
    complete = client.post(
        BASE + f"assessments/sessions/{sid}/complete", headers=actor, json={}
    )
    assert complete.status_code == 200, complete.text
    assert complete.json()["results"][0]["metric_name"] == metric
    assert complete.json()["results"][0]["metric_value"] == (
        60 if protocol == "SYMBOL" else 100
    )
    comparisons = client.get(
        BASE + "cognition/comparisons?astronaut_id=AST-001", headers=actor
    ).json()
    assert not any(v["daily_result"]["protocol_id"] == protocol for v in comparisons), (
        "Do not invent a personal baseline for an extended test"
    )


def test_task_form_persistence_and_dependency_validation(client, conn):
    detail = client.get(BASE + "planning/task-sets/SET-025").json()["tasks"][0]
    original = detail["task"]
    payload = {
        "task": {
            k: v
            for k, v in original.items()
            if k not in ("task_id", "created_by_user_id", "created_at")
        },
        "requirements": {
            k: v
            for k, v in detail["requirements"][0].items()
            if k not in ("requirement_id", "task_id", "reviewed_by_user_id")
        },
        "depends_on_task_ids": [original["task_id"]],
        "proposed": dict(
            working_memory_demand_score=3,
            procedural_complexity_score=2,
            equipment_and_location="Lab",
            scheduling_constraints="After briefing",
            schedule_flexibility="flexible",
        ),
    }
    payload["task"]["task_title"] = "Integration task form persistence"
    created = client.post(BASE + "planning/tasks", json=payload)
    assert created.status_code == 200, created.text
    tid = created.json()["task"]["task_id"]
    fetched = client.get(BASE + "planning/task-sets/SET-025").json()
    saved = next(t for t in fetched["tasks"] if t["task"]["task_id"] == tid)
    assert saved["proposed"] == payload["proposed"]
    payload["depends_on_task_ids"] = [tid]
    invalid = client.patch(BASE + "planning/tasks/" + tid, json=payload)
    assert invalid.status_code == 422, invalid.text
    assert (
        conn.execute(
            "SELECT depends_on_task_id FROM task_dependencies WHERE task_id=?", (tid,)
        ).fetchone()[0]
        == original["task_id"]
    )


@pytest.mark.parametrize(
    "kind,expected",
    [
        ("scatter", "scatter"),
        ("longitudinal", "line"),
        ("individual_trajectories", "line"),
        ("domain_heatmap", "heatmap"),
        ("paired_preflight_inflight", "bar"),
        ("lagged_comparison", "scatter"),
    ],
)
def test_research_chart_types_and_snapshot(client, conn, kind, expected):
    researcher = staff_header(conn, "medical_researcher")
    job = client.post(
        BASE + "research/analyses",
        headers=researcher,
        json=dict(
            analysis_type=kind,
            research_question="Integration chart data verification",
            independent_variable="total_sleep_minutes",
            dependent_variable="median_reaction_time_ms",
            analysis_method="descriptive",
            date_range_start="2027-03-01",
            date_range_end="2027-03-25",
        ),
    )
    assert job.status_code == 200, job.text
    aid = job.json()["analysis_id"]
    charts = client.get(
        BASE + f"research/analyses/{aid}/charts?view=within_person", headers=researcher
    )
    assert charts.status_code == 200, charts.text
    assert charts.json()[0]["chart_type"] == expected
    assert charts.json()[0]["points"]
    assert (
        client.get(
            BASE + f"research/analyses/{aid}/report", headers=researcher
        ).status_code
        == 200
    )


def test_condition_windows_are_enforced_by_backend(client, conn):
    medical = staff_header(conn, "medical_officer")
    when = client.get(BASE + "missions/current/state").json()["mission_time"]
    template = client.post(
        BASE + "assessments/schedule-templates",
        headers=medical,
        json=dict(
            mission_phase="inflight",
            assessment_condition="night",
            local_hour=9,
            protocol_ids="NBACK",
            recurrence="on_demand",
        ),
    ).json()
    created = client.post(
        BASE + "assessments/assignments",
        headers=medical,
        json=dict(
            astronaut_ids=["AST-001"],
            template_id=template["template_id"],
            scheduled_at=when,
        ),
    )
    assert created.status_code == 200, created.text
    aid = created.json()[0]["assignment_id"]
    actor = {"X-AEGIS-User": "USR-001"}
    due = client.get(BASE + "assessments/due", headers=actor).json()
    pending = next(d for d in due if d["assignment"]["assignment_id"] == aid)
    assert pending["authorized"] is True
    assert pending["conditions_met"] is False
    assert "20:00" in pending["blocking_reason"]
    assert (
        client.post(
            BASE + "assessments/sessions", headers=actor, json={"assignment_id": aid}
        ).status_code
        == 409
    )
