"""Validated persistence for dashboard programmes and task forms."""

import json
import uuid
from datetime import timedelta
from pydantic import BaseModel, Field
from app.api.console import rows, one, now, access, leader
from app.core.errors import ValidationFailed, Conflict
from app.services import auth_service, task_service
from app.utils.timestamps import parse_iso, to_iso


def ident(prefix):
    return prefix + "-" + uuid.uuid4().hex[:12]


def ensure_protocols(c):
    protocols = [
        (
            "SYMBOL",
            "Symbol-Digit Matching",
            90,
            "correct_responses_per_minute",
            "processing_speed",
            "per_min",
        ),
        (
            "ROTATION",
            "Navigation Challenge",
            120,
            "accuracy_percent",
            "spatial_reasoning",
            "percent",
        ),
        (
            "REASONING",
            "Logical Reasoning",
            300,
            "accuracy_percent",
            "reasoning",
            "percent",
        ),
        (
            "SWITCH",
            "Command Switch",
            180,
            "accuracy_percent",
            "cognitive_flexibility",
            "percent",
        ),
    ]
    for pid, title, duration, metric, domain, unit in protocols:
        c.execute(
            """INSERT OR IGNORE INTO assessment_protocols VALUES (?,?,?,'v1',?,?,?,'True')""",
            (
                pid,
                title,
                pid,
                duration,
                "Prototype battery: follow the preserved frontend instructions.",
                metric,
            ),
        )
        c.execute(
            """INSERT OR IGNORE INTO metric_definitions VALUES (?,?,?,?,'higher_is_better','v1',
            'context_matched_personal_baseline','false','prototype_definition')""",
            ("MET-CONSOLE-" + pid, metric, domain, unit),
        )
    c.commit()


class Template(BaseModel):
    mission_phase: str
    assessment_condition: str
    local_hour: int = Field(ge=0, le=23)
    protocol_ids: str = Field(min_length=1)
    recurrence: str
    description: str = ""
    collection_start: str | None = None
    collection_end: str | None = None


class Assignment(BaseModel):
    astronaut_ids: list[str] = Field(min_length=1, max_length=100)
    template_id: str
    scheduled_at: str


def assessment_records(c, u, method, path, q, b):
    if method != "POST":
        return NotImplemented
    if path == "assessments/schedule-templates":
        auth_service.require_role(u, "medical_officer")
        t = Template.model_validate(b)
        if t.mission_phase not in ("preflight", "inflight"):
            raise ValidationFailed("Unknown mission phase")
        for pid in t.protocol_ids.split("|"):
            one(c, "assessment_protocols", "protocol_id", pid)
        tid = ident("TPL")
        if (
            t.collection_start
            and t.collection_end
            and parse_iso(t.collection_start) > parse_iso(t.collection_end)
        ):
            raise ValidationFailed("Collection end must follow start")
        c.execute(
            "INSERT INTO assessment_schedule_templates VALUES (?,?,?,?,?,?,?)",
            (
                tid,
                t.mission_phase,
                t.assessment_condition,
                t.local_hour,
                t.protocol_ids,
                t.recurrence,
                t.description,
            ),
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS console_programme_details (template_id TEXT PRIMARY KEY REFERENCES assessment_schedule_templates(template_id), collection_start TEXT, collection_end TEXT)"
        )
        c.execute(
            "INSERT INTO console_programme_details VALUES (?,?,?)",
            (tid, t.collection_start, t.collection_end),
        )
        c.commit()
        return one(c, "assessment_schedule_templates", "template_id", tid)
    if path == "assessments/assignments":
        auth_service.require_role(u, "medical_officer")
        request = Assignment.model_validate(b)
        template = one(
            c, "assessment_schedule_templates", "template_id", request.template_id
        )
        when = parse_iso(request.scheduled_at)
        end = when + timedelta(hours=1)
        if c.execute(
            "SELECT 1 FROM sqlite_master WHERE name='console_programme_details'"
        ).fetchone():
            details = c.execute(
                "SELECT * FROM console_programme_details WHERE template_id=?",
                (request.template_id,),
            ).fetchone()
            if details:
                if details["collection_start"] and when < parse_iso(
                    details["collection_start"]
                ):
                    raise ValidationFailed(
                        "Assignment precedes programme collection window"
                    )
                if (
                    details["collection_end"]
                    and to_iso(when)[:10] > details["collection_end"][:10]
                ):
                    raise ValidationFailed(
                        "Assignment follows programme collection window"
                    )
        if end <= parse_iso(now(c)):
            raise ValidationFailed("Cannot assign an already expired window")
        result = []
        try:
            for aid in set(request.astronaut_ids):
                access(c, u, aid)
                astronaut = one(c, "astronauts", "astronaut_id", aid)
                mission = one(c, "missions", "mission_id", astronaut["mission_id"])
                if template["mission_phase"] == "preflight" and when >= parse_iso(
                    mission["launch_date"]
                ):
                    raise ValidationFailed("Preflight assessments must precede launch")
                if template["mission_phase"] == "inflight" and not parse_iso(
                    mission["launch_date"]
                ) <= when < parse_iso(mission["planned_end_date"]):
                    raise ValidationFailed(
                        "Inflight assessment must be inside mission dates"
                    )
                for pid in template["protocol_ids"].split("|"):
                    existing = c.execute(
                        "SELECT assignment_id FROM assessment_assignments WHERE astronaut_id=? AND protocol_id=? AND scheduled_at=? AND schedule_template_id=?",
                        (aid, pid, to_iso(when), request.template_id),
                    ).fetchone()
                    if existing:
                        result.append(
                            one(
                                c,
                                "assessment_assignments",
                                "assignment_id",
                                existing[0],
                            )
                        )
                        continue
                    assignment_id = ident("ASN")
                    c.execute(
                        """INSERT INTO assessment_assignments (assignment_id,astronaut_id,protocol_id,schedule_template_id,scheduled_at,assessment_condition,access_status,access_expires_at,assigned_by_user_id,assignment_source,simulation_run_id)
                        VALUES (?,?,?,?,?,?,'available',?,?,'medical_officer','RUN-DEMO-001')""",
                        (
                            assignment_id,
                            aid,
                            pid,
                            request.template_id,
                            to_iso(when),
                            template["assessment_condition"],
                            to_iso(end),
                            u["user_id"],
                        ),
                    )
                    result.append(
                        one(c, "assessment_assignments", "assignment_id", assignment_id)
                    )
            c.commit()
        except Exception:
            c.rollback()
            raise
        return result
    return NotImplemented


class TaskInput(BaseModel):
    mission_id: str
    task_set_id: str
    task_date: str
    task_title: str = Field(min_length=1, max_length=200)
    task_description: str = ""
    task_category: str
    priority: str
    estimated_duration_minutes: int = Field(ge=1, le=1440)
    required_crew_count: int = Field(ge=1, le=100)
    deadline: str
    task_status: str


class Requirements(BaseModel):
    required_specialization: str | None = None
    required_certification: str | None = None
    cognitive_demand_score: float = Field(0, ge=0, le=5)
    physical_demand_score: float = Field(0, ge=0, le=5)
    attention_demand_score: float = Field(0, ge=0, le=5)
    time_pressure_score: float = Field(0, ge=0, le=5)
    safety_classification: str = "standard"
    review_status: str = "pending_review"


def task_records(c, u, method, path, q, b):
    p = path.split("/")
    if not path.startswith("planning/tasks"):
        return NotImplemented
    leader(u)
    if method not in ("POST", "PATCH", "PUT"):
        return NotImplemented
    tid = p[2] if len(p) > 2 else ident("TASK")
    if len(p) == 4 and p[3] == "requirements" and method == "PUT":
        existing = one(c, "task_requirements", "task_id", tid)
        data = Requirements.model_validate({**existing, **b})
        # Demands are planner inputs; only a qualified medical review can authorize safety-critical requirements.
        if (
            data.safety_classification not in ("standard", "standard_demo")
            and data.review_status == "approved"
        ):
            raise ValidationFailed(
                "Safety-critical requirement approval requires the medical review workflow"
            )
        fields = data.model_dump()
        c.execute(
            "UPDATE task_requirements SET "
            + ",".join(k + "=?" for k in fields)
            + " WHERE task_id=?",
            (*fields.values(), tid),
        )
        c.commit()
        return one(c, "task_requirements", "task_id", tid)
    data = TaskInput.model_validate(b.get("task", {}))
    req = Requirements.model_validate(b.get("requirements", {}))
    task_set = one(c, "daily_task_sets", "task_set_id", data.task_set_id)
    if (
        data.mission_id != task_set["mission_id"]
        or data.task_date[:10] != task_set["task_date"][:10]
    ):
        raise ValidationFailed("Task must match its mission task set and date")
    if data.priority not in ("low", "medium", "high"):
        raise ValidationFailed("Unknown priority")
    if parse_iso(data.deadline) < parse_iso(data.task_date):
        raise ValidationFailed("Deadline precedes task date")
    if (
        req.safety_classification not in ("standard", "standard_demo")
        and req.review_status == "approved"
    ):
        raise ValidationFailed("Safety-critical requirements need medical review")
    deps = b.get("depends_on_task_ids", [])
    if not isinstance(deps, list) or any(not isinstance(d, str) for d in deps):
        raise ValidationFailed("Invalid dependencies")
    for dep in deps:
        if one(c, "mission_tasks", "task_id", dep)["task_set_id"] != data.task_set_id:
            raise ValidationFailed("Dependencies must belong to the task set")
    if method == "PATCH":
        one(c, "mission_tasks", "task_id", tid)
        if c.execute(
            "SELECT 1 FROM task_assignments WHERE task_id=? AND approval_status='approved'",
            (tid,),
        ).fetchone():
            raise Conflict("Cannot edit a task in an approved schedule")
    try:
        fields = data.model_dump()
        if method == "POST":
            fields.update(
                task_id=tid, created_by_user_id=u["user_id"], created_at=now(c)
            )
            c.execute(
                "INSERT INTO mission_tasks ("
                + ",".join(fields)
                + ") VALUES ("
                + ",".join("?" for _ in fields)
                + ")",
                tuple(fields.values()),
            )
        else:
            c.execute(
                "UPDATE mission_tasks SET "
                + ",".join(k + "=?" for k in fields)
                + " WHERE task_id=?",
                (*fields.values(), tid),
            )
        c.execute("DELETE FROM task_dependencies WHERE task_id=?", (tid,))
        for dep in set(deps):
            c.execute(
                "INSERT INTO task_dependencies (dependency_id,task_id,depends_on_task_id,dependency_type) VALUES (?,?,?,?)",
                (ident("DEP"), tid, dep, "finish_to_start"),
            )
        existing = c.execute(
            "SELECT requirement_id FROM task_requirements WHERE task_id=?", (tid,)
        ).fetchone()
        r = req.model_dump()
        if existing:
            c.execute(
                "UPDATE task_requirements SET "
                + ",".join(k + "=?" for k in r)
                + " WHERE task_id=?",
                (*r.values(), tid),
            )
        else:
            r.update(requirement_id=ident("REQ"), task_id=tid)
            c.execute(
                "INSERT INTO task_requirements ("
                + ",".join(r)
                + ") VALUES ("
                + ",".join("?" for _ in r)
                + ")",
                tuple(r.values()),
            )
        task_service.validate_task_dependencies(
            task_service.get_tasks_for_task_set(c, data.task_set_id)
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS console_task_details (task_id TEXT PRIMARY KEY REFERENCES mission_tasks(task_id), proposed_json TEXT NOT NULL)"
        )
        proposed = b.get("proposed")
        c.execute(
            "INSERT OR REPLACE INTO console_task_details VALUES (?,?)",
            (tid, json.dumps(proposed)),
        )
        c.commit()
    except Exception:
        c.rollback()
        raise
    from app.services.console_planning import task

    return task(c, tid)
