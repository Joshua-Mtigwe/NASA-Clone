"""Planning adapters delegate assignment and clearance to the constraint engine."""

import json
import uuid
from datetime import timedelta
from app.api.console import (
    rows,
    one,
    now,
    history,
    access,
    staff,
    leader,
    mission_state,
)
from app.core.errors import ValidationFailed, Conflict, NotFound
from app.services import (
    task_service,
    schedule_service,
    scheduling_optimizer,
    auth_service,
    recovery_service,
)
from app.services.console_health import schedule, readiness
from app.utils.timestamps import parse_iso, to_iso


def task(c, tid):
    proposed = None
    if c.execute(
        "SELECT 1 FROM sqlite_master WHERE name='console_task_details'"
    ).fetchone():
        row = c.execute(
            "SELECT proposed_json FROM console_task_details WHERE task_id=?", (tid,)
        ).fetchone()
        if row:
            proposed = json.loads(row[0])
    return dict(
        task=one(c, "mission_tasks", "task_id", tid),
        requirements=rows(c, "SELECT * FROM task_requirements WHERE task_id=?", (tid,)),
        dependencies=rows(c, "SELECT * FROM task_dependencies WHERE task_id=?", (tid,)),
        proposed=proposed,
    )


def schedule_detail(c, vid):
    version = schedule_service.get_schedule_version(c, vid)
    assignments = version.pop("assignments")
    problems = schedule_service.validate_schedule_version(
        c, {**version, "assignments": assignments}
    )
    req = rows(
        c,
        """SELECT r.* FROM task_requirements r JOIN mission_tasks t ON t.task_id=r.task_id WHERE t.task_set_id=?""",
        (version["task_set_id"],),
    )
    duty = []
    for aid in sorted({a["astronaut_id"] for a in assignments}):
        ready = readiness(c, aid)
        limit = ready[-1]["workload_limit_minutes"] if ready else None
        minutes = sum(
            (
                parse_iso(a["planned_end"]) - parse_iso(a["planned_start"])
            ).total_seconds()
            / 60
            for a in assignments
            if a["astronaut_id"] == aid
        )
        duty.append(
            dict(
                astronaut_id=aid,
                scheduled_minutes=minutes,
                workload_limit_minutes=limit,
                over_limit=limit is not None and minutes > limit,
            )
        )
    return dict(
        version=version,
        assignments=assignments,
        recommendations=rows(
            c,
            """SELECT r.* FROM ai_task_recommendations r
        JOIN task_assignments a ON a.recommendation_id=r.recommendation_id WHERE a.schedule_version_id=?""",
            (vid,),
        ),
        issues=[
            dict(kind="conflict", task_id="", astronaut_id=None, reason=p)
            for p in problems
        ],
        duty=duty,
        safety_critical_task_ids=[
            r["task_id"]
            for r in req
            if r["safety_classification"] not in ("standard", "standard_demo")
        ],
    )


def published(c, aid, day):
    out = []
    for r in rows(
        c,
        """SELECT d.*,s.scheduled_recovery_id,s.completion_status,s.recovery_activity_id FROM daily_schedules d
        JOIN scheduled_recovery s ON s.schedule_id=d.schedule_id WHERE d.astronaut_id=? AND d.schedule_date=?
        AND d.activity_type='recovery' AND d.schedule_status='published' AND d.approval_status='approved' """,
        (aid, day),
    ):
        out.append(
            dict(
                schedule_id=r["schedule_id"],
                scheduled_recovery_id=r["scheduled_recovery_id"],
                recommendation_id=r["activity_reference_id"],
                astronaut_id=aid,
                scheduled_start=r["start_time"],
                scheduled_end=r["end_time"],
                completion_status=r["completion_status"],
                activity=one(
                    c,
                    "recovery_activities",
                    "recovery_activity_id",
                    r["recovery_activity_id"],
                ),
                published_by_user_id=r["approved_by_user_id"],
            )
        )
    return out


def publish(c, u, rid, b):
    leader(u)
    # Serialize revalidation and promotion, including competing retries from offline devices.
    c.execute("BEGIN IMMEDIATE")
    try:
        rec = one(c, "recovery_recommendations", "recommendation_id", rid)
        a = one(
            c,
            "recovery_activities",
            "recovery_activity_id",
            rec["recovery_activity_id"],
        )
        astronaut = one(c, "astronauts", "astronaut_id", rec["astronaut_id"])
        state = mission_state(c)
        day = to_iso(
            parse_iso(state["mission"]["launch_date"])
            + timedelta(days=rec["mission_day"] - 1)
        )[:10]
        old = c.execute(
            "SELECT * FROM daily_schedules WHERE activity_type='recovery' AND activity_reference_id=?",
            (rid,),
        ).fetchone()
        old = dict(old) if old else None
        booked = (
            c.execute(
                "SELECT * FROM scheduled_recovery WHERE schedule_id=?",
                (old["schedule_id"],),
            ).fetchone()
            if old
            else None
        )
        booked = dict(booked) if booked else None
        already = bool(
            old
            and old["schedule_status"] == "published"
            and old["approval_status"] == "approved"
        )
        duration = a["recommended_duration_minutes"]
        committed = schedule(c, rec["astronaut_id"], day)["items"]
        # Also reserve protected sleep/exercise windows even when their measurements are later than now.
        for table, kind, ts, te, title in [
            ("sleep_records", "sleep", "sleep_start", "sleep_end", "Sleep"),
            (
                "activity_records",
                "exercise",
                "start_time",
                "end_time",
                "Physical activity",
            ),
        ]:
            committed.extend(
                dict(kind=kind, title=title, start_time=r[ts], end_time=r[te])
                for r in rows(
                    c,
                    f"SELECT * FROM {table} WHERE astronaut_id=? AND substr({ts},1,10)=?",
                    (rec["astronaut_id"], day),
                )
            )

        def conflicts(start):
            end = start + timedelta(minutes=duration)
            return [
                dict(
                    kind=i["kind"],
                    title=i["title"],
                    start_time=i["start_time"],
                    end_time=i["end_time"],
                )
                for i in committed
                if i.get("ref_id") != (old["schedule_id"] if old else None)
                and parse_iso(i["start_time"]) < end
                and (
                    parse_iso(i["end_time"])
                    if i["end_time"]
                    else parse_iso(i["start_time"])
                    + timedelta(minutes=i.get("duration_minutes") or 15)
                )
                > start
            ]

        raw = (
            old["start_time"]
            if already
            else b.get("scheduled_start")
            or (old["start_time"] if old else day + "T15:00:00Z")
        )
        start = parse_iso(raw)
        if not already and not b.get("scheduled_start"):
            if conflicts(start):
                start = parse_iso(day + "T06:00:00Z")
            start = max(start, parse_iso(now(c)))
            while (
                to_iso(start)[:10] == day
                and (conflicts(start) or start.hour < 6)
                and start.hour < 22
            ):
                start += timedelta(minutes=15)
        end = start + timedelta(minutes=duration)
        reasons = []
        clashes = [] if already else conflicts(start)
        if not already:
            if rec["created_at"] > now(c):
                reasons.append("Recommendation is not available at the mission clock")
            if a["approval_status"] != "approved":
                reasons.append("Routine catalogue activity is not approved")
            if rec["approval_status"] == "rejected":
                reasons.append("Recommendation was rejected")
            if to_iso(start)[:10] != day or to_iso(end)[:10] != day:
                reasons.append("Routine must remain on the recommended mission day")
            if start < parse_iso(now(c)):
                reasons.append("Routine cannot start before the mission clock")
            if start.hour < 6 or end.hour > 22 or (end.hour == 22 and end.minute > 0):
                reasons.append("Routine must fit between 06:00 and 22:00 UTC")
            if clashes:
                reasons.append("Routine overlaps existing commitments")
        result = dict(
            recommendation=rec,
            activity=a,
            state="published"
            if already
            else ("unable_to_schedule" if reasons else "ready_to_publish"),
            scheduled_start=to_iso(start),
            scheduled_end=to_iso(end),
            duration_minutes=duration,
            conflicts=clashes,
            reasons=reasons,
            schedule_id=old["schedule_id"] if already else None,
            scheduled_recovery_id=booked["scheduled_recovery_id"]
            if already and booked
            else None,
            already_published=already,
        )
        if already or reasons or b.get("dry_run"):
            c.rollback()
            return result
        sid = old["schedule_id"] if old else "SCH-" + uuid.uuid4().hex[:12]
        bid = (
            booked["scheduled_recovery_id"]
            if booked
            else "SRC-" + uuid.uuid4().hex[:12]
        )
        if old:
            c.execute(
                "UPDATE daily_schedules SET start_time=?,end_time=?,schedule_status='published',approval_status='approved',approved_by_user_id=? WHERE schedule_id=?",
                (to_iso(start), to_iso(end), u["user_id"], sid),
            )
        else:
            c.execute(
                """INSERT INTO daily_schedules (schedule_id,astronaut_id,mission_id,schedule_date,activity_type,activity_reference_id,start_time,end_time,schedule_status,approved_by_user_id,simulation_run_id,approval_status)
                VALUES (?,?,?,?,'recovery',?,?,?,'published',?,'RUN-DEMO-001','approved')""",
                (
                    sid,
                    rec["astronaut_id"],
                    astronaut["mission_id"],
                    day,
                    rid,
                    to_iso(start),
                    to_iso(end),
                    u["user_id"],
                ),
            )
        if booked:
            c.execute(
                "UPDATE scheduled_recovery SET scheduled_start=?,scheduled_end=?,completion_status='planned' WHERE scheduled_recovery_id=?",
                (to_iso(start), to_iso(end), bid),
            )
        else:
            c.execute(
                """INSERT INTO scheduled_recovery (scheduled_recovery_id,astronaut_id,mission_id,recovery_activity_id,schedule_id,scheduled_start,scheduled_end,completion_status)
                VALUES (?,?,?,?,?,?,?,'planned')""",
                (
                    bid,
                    rec["astronaut_id"],
                    astronaut["mission_id"],
                    a["recovery_activity_id"],
                    sid,
                    to_iso(start),
                    to_iso(end),
                ),
            )
        from app.services.audit_service import write_audit

        write_audit(
            c,
            user_id=u["user_id"],
            action_type="publish_supportive_routine",
            entity_type="recovery_recommendation",
            entity_id=rid,
            action_result="success",
            change_summary="Published non-clinical supportive routine",
            commit=False,
        )
        c.execute("UPDATE recovery_recommendations SET approval_status='published' WHERE recommendation_id=?",(rid,))
        c.commit()
        return {
            **result,
            "state": "published",
            "schedule_id": sid,
            "scheduled_recovery_id": bid,
        }
    except Exception:
        c.rollback()
        raise


def dispatch(c, u, method, path, q, b):
    p = path.split("/")
    if path.startswith("recovery/"):
        if (
            len(p) == 4
            and p[1] == "recommendations"
            and p[3] == "publish"
            and method == "POST"
        ):
            return publish(c, u, p[2], b)
        aid = q.get("astronaut_id") or b.get("astronaut_id")
        if aid:
            access(c, u, aid)
        if path == "recovery/published" and method == "GET":
            return published(c, aid, q.get("date", now(c)[:10]))
        if path == "recovery/scheduled" and method == "GET":
            if not aid:
                raise ValidationFailed("astronaut_id is required")
            return rows(
                c,
                """SELECT s.* FROM scheduled_recovery s JOIN daily_schedules d ON d.schedule_id=s.schedule_id
                WHERE s.astronaut_id=? AND d.schedule_status='published' AND d.approval_status='approved'
                AND s.scheduled_start>=? AND s.scheduled_start<=? ORDER BY s.scheduled_start""",
                (aid, q.get("from", "0000"), q.get("to", "9999")),
            )
        if path == "recovery/recommendations" and method == "GET":
            if not aid:
                raise ValidationFailed("astronaut_id is required")
            return rows(
                c,
                "SELECT * FROM recovery_recommendations WHERE astronaut_id=? AND (? IS NULL OR mission_day=?) AND created_at<=?",
                (aid, q.get("mission_day"), q.get("mission_day"), now(c)),
            )
        if path == "recovery/recommend" and method == "POST":
            leader(u)
            if b.get("mission_day") != mission_state(c)["mission_day"]:
                raise ValidationFailed(
                    "Recommendations can only be generated for the active mission day"
                )
            result = recovery_service.generate_recommendations(
                c,
                actor_user_id=u["user_id"],
                astronaut_ids=[aid],
                as_of=parse_iso(now(c)),
            )
            return [r for a in result["astronauts"] for r in a["recommendations"]]
    if not path.startswith("planning/"):
        return NotImplemented
    if path == "planning/recovery/catalogue" and method == "GET":
        return recovery_service.list_activities(c)
    staff(u)
    from app.services.console_records import task_records

    result = task_records(c, u, method, path, q, b)
    if result is not NotImplemented:
        return result
    if method == "GET":
        if path == "planning/recovery/catalogue":
            return recovery_service.list_activities(c)
        if path == "planning/task-sets":
            day = int(q["mission_day"]) if q.get("mission_day") else None
            return task_service.get_available_task_sets(c, from_day=day, to_day=day)
        if len(p) == 3 and p[1] == "task-sets":
            payload = task_service.get_task_planning_payload(c, p[2])
            return dict(
                task_set=payload["task_set"],
                tasks=[task(c, t["task_id"]) for t in payload["tasks"]],
            )
        if path == "planning/crew-overview":
            result = []
            for a in rows(c, "SELECT * FROM astronauts"):
                ready = readiness(c, a["astronaut_id"])
                valid = history(
                    c,
                    "assessment_sessions",
                    a["astronaut_id"],
                    "completed_at",
                    {"from": to_iso(parse_iso(now(c)) - timedelta(days=1))},
                    "AND quality_status='valid'",
                )
                result.append(
                    dict(
                        astronaut=a,
                        readiness=ready[-1] if ready else None,
                        qualifications=rows(
                            c,
                            "SELECT * FROM astronaut_qualifications WHERE astronaut_id=?",
                            (a["astronaut_id"],),
                        ),
                        assessment_status="assessment_current"
                        if valid
                        else "no_current_assessment",
                    )
                )
            return result
        if path == "planning/schedules":
            return schedule_service.list_schedule_versions(
                c, "RUN-DEMO-001", q.get("task_set_id")
            )
        if len(p) == 3 and p[1] == "schedules":
            return schedule_detail(c, p[2])
        if len(p) == 3 and p[1] == "optimize":
            run = scheduling_optimizer.get_optimization_run(c, p[2])
            versions = rows(
                c,
                "SELECT * FROM schedule_versions WHERE optimization_run_id=?",
                (p[2],),
            )
            run = {
                **run,
                "solver_status": run["status"],
                "status": "completed"
                if run["status"] in ("complete", "partial")
                else "failed",
            }
            return dict(
                run=run,
                stages=[
                    dict(
                        stage=s,
                        status="completed"
                        if run["status"] == "completed"
                        else "failed",
                    )
                    for s in ["constraint_checks", "optimisation"]
                ],
                schedule_version_id=versions[-1]["schedule_version_id"]
                if versions
                else None,
            )
        if path == "planning/overview":
            state = mission_state(c)
            day = q.get("date", state["mission_time"][:10])
            sets = rows(c, "SELECT * FROM daily_task_sets WHERE task_date=?", (day,))
            tid = sets[0]["task_set_id"] if sets else None
            tasks = rows(c, "SELECT * FROM mission_tasks WHERE task_set_id=?", (tid,))
            versions = (
                schedule_service.list_schedule_versions(c, "RUN-DEMO-001", tid)
                if tid
                else []
            )
            version = versions[-1] if versions else None
            aa = (
                rows(
                    c,
                    "SELECT * FROM task_assignments WHERE schedule_version_id=?",
                    (version["schedule_version_id"],),
                )
                if version
                else []
            )
            return dict(
                date=day,
                mission_day=(
                    parse_iso(day) - parse_iso(state["mission"]["launch_date"])
                ).days
                + 1,
                task_set_id=tid,
                crew_members=c.execute("SELECT COUNT(*) FROM astronauts").fetchone()[0],
                tasks_submitted=len(tasks),
                pending_review=c.execute(
                    "SELECT COUNT(*) FROM task_requirements r JOIN mission_tasks t ON t.task_id=r.task_id WHERE t.task_set_id=? AND r.review_status NOT IN ('approved','reviewed','leader_reviewed')",
                    (tid,),
                ).fetchone()[0],
                scheduled_minutes=sum(
                    (
                        parse_iso(a["planned_end"]) - parse_iso(a["planned_start"])
                    ).total_seconds()
                    / 60
                    for a in aa
                ),
                schedule_version_id=version["schedule_version_id"] if version else None,
            )
    if method == "POST" and path == "planning/optimize":
        leader(u)
        result = scheduling_optimizer.plan_task_set(
            c,
            task_set_id=b.get("task_set_id"),
            actor_user_id=u["user_id"],
            simulation_run_id="RUN-DEMO-001",
        )
        return scheduling_optimizer.get_optimization_run(
            c, result["optimization_run_id"]
        )
    if len(p) == 4 and p[1] == "schedules" and method == "POST":
        leader(u)
        vid = p[2]
        detail = schedule_detail(c, vid)
        if p[3] == "approve":
            if not set(detail["safety_critical_task_ids"]) <= set(
                b.get("confirmed_safety_critical", [])
            ):
                raise ValidationFailed(
                    "Every safety-critical task needs explicit confirmation"
                )
            if detail["version"]["status"] == "draft":
                schedule_service.approve_schedule_version(c, vid, u)
            version = schedule_service.get_schedule_version(c, vid)
            if version["status"] == "approved":
                version = schedule_service.publish_approved_schedule(c, vid, u)
            if version["status"] != "published":
                raise Conflict("Only approved schedules may be published")
            version.pop("assignments", None)
            return version
        if p[3] == "overrides":
            if detail["version"]["status"] != "draft":
                raise Conflict("Only a draft can be overridden")
            if not isinstance(b.get("reason"), str) or not b["reason"].strip():
                raise ValidationFailed("An override reason is required")
            a = one(
                c, "task_assignments", "task_assignment_id", b.get("task_assignment_id")
            )
            if a["schedule_version_id"] != vid:
                raise ValidationFailed("Assignment does not belong to this schedule")
            values = {
                key: b.get(key, a[key])
                for key in ["astronaut_id", "planned_start", "planned_end"]
            }
            access(c, u, values["astronaut_id"])
            if parse_iso(values["planned_end"]) <= parse_iso(values["planned_start"]):
                raise ValidationFailed("End must follow start")
            original_task = one(c, "mission_tasks", "task_id", a["task_id"])
            duration = (
                parse_iso(values["planned_end"]) - parse_iso(values["planned_start"])
            ).total_seconds() / 60
            if duration < original_task["estimated_duration_minutes"]:
                raise ValidationFailed(
                    "Override cannot shorten the required task duration"
                )
            if (
                values["planned_start"][:10] != original_task["task_date"][:10]
                or values["planned_end"][:10] != original_task["task_date"][:10]
            ):
                raise ValidationFailed("Override must remain on the task date")
            c.execute("SAVEPOINT manual_override")
            try:
                c.execute(
                    "UPDATE task_assignments SET astronaut_id=?,planned_start=?,planned_end=? WHERE task_assignment_id=?",
                    (*values.values(), a["task_assignment_id"]),
                )
                errors = schedule_service.validate_schedule_version(
                    c, schedule_service.get_schedule_version(c, vid)
                )
                if errors:
                    raise Conflict("Override violates schedule constraints", errors)
                from app.services.audit_service import write_audit

                write_audit(
                    c,
                    user_id=u["user_id"],
                    action_type="manual_schedule_override",
                    entity_type="task_assignment",
                    entity_id=a["task_assignment_id"],
                    action_result="success",
                    change_summary=b["reason"][:500],
                    commit=False,
                )
                c.execute("RELEASE manual_override")
                c.commit()
            except Exception:
                c.execute("ROLLBACK TO manual_override")
                c.execute("RELEASE manual_override")
                raise
            return one(
                c, "task_assignments", "task_assignment_id", a["task_assignment_id"]
            )
    return NotImplemented
