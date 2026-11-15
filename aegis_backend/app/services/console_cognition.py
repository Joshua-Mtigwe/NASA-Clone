"""Assessment adapters preserve backend ownership, windows, scoring and quality rules."""

import json
import statistics
import uuid
from datetime import timedelta
from app.api.console import rows, one, now, history, page, access, staff
from app.core.errors import ValidationFailed, Conflict, NotFound
from app.services import (
    assessment_service as service,
    cognitive_scoring as scoring,
    auth_service,
)
from app.schemas.assessment import SubmitTrialsRequest, SurveyAnswers
from app.utils.timestamps import parse_iso, to_iso


def _tables(c):
    c.execute(
        "CREATE TABLE IF NOT EXISTS console_practice (session_id TEXT REFERENCES assessment_sessions(session_id), payload TEXT, UNIQUE(session_id,payload))"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS console_assessment_metadata (session_id TEXT PRIMARY KEY REFERENCES assessment_sessions(session_id), payload TEXT)"
    )


def assignments(c, u, q):
    aid = q.get("astronaut_id")
    ids = [aid] if aid else auth_service.get_permitted_astronauts(c, u)
    result = []
    for target in ids:
        access(c, u, target)
        result.extend(service.list_assignments(c, target)["assignments"])
    if q.get("access_status"):
        result = [a for a in result if a["access_status"] == q["access_status"]]
    return result


def daily(c, aid, q):
    return history(
        c,
        "daily_cognitive_results",
        aid,
        "calculated_at",
        {},
        "AND assessment_date>=? AND assessment_date<=? AND (? IS NULL OR cognitive_domain=?) AND COALESCE((SELECT simulation_run_id FROM daily_result_runs x WHERE x.daily_result_id=daily_cognitive_results.daily_result_id),'RUN-DEMO-001')='RUN-DEMO-001'",
        (
            q.get("from", "0000")[:10],
            q.get("to", now(c))[:10],
            q.get("cognitive_domain"),
            q.get("cognitive_domain"),
        ),
    )


def comparisons(c, aid, q):
    result = []
    for d in daily(c, aid, q):
        for cmp in rows(
            c,
            "SELECT * FROM cognitive_comparisons WHERE daily_result_id=? AND calculated_at<=?",
            (d["daily_result_id"], now(c)),
        ):
            base = one(c, "cognitive_baselines", "baseline_id", cmp["baseline_id"])
            result.append(dict(comparison=cmp, daily_result=d, baseline=base))
    return result


def summary(c, aid, q):
    data = daily(c, aid, q)
    cmp = comparisons(c, aid, q)
    domains = []
    for domain in sorted({r["cognitive_domain"] for r in data}):
        group = [r for r in data if r["cognitive_domain"] == domain]
        inflight = [r["daily_median"] for r in group if r["daily_median"] is not None]
        pre = [
            r["metric_value"]
            for r in rows(
                c,
                """SELECT r.* FROM assessment_results r JOIN assessment_sessions s ON s.session_id=r.session_id
            WHERE s.astronaut_id=? AND s.mission_phase='preflight' AND s.session_status='completed' AND s.quality_status='valid'
            AND r.cognitive_domain=? AND r.calculated_at<=?""",
                (aid, domain, now(c)),
            )
        ]
        refs = [
            r["median_value"]
            for r in rows(
                c,
                "SELECT * FROM cognitive_baselines WHERE astronaut_id=? AND cognitive_domain=? AND calculated_at<=?",
                (aid, domain, now(c)),
            )
        ]
        statuses = [
            r["comparison"]["reference_range_status"]
            for r in cmp
            if r["daily_result"]["cognitive_domain"] == domain
        ]
        domains.append(
            dict(
                cognitive_domain=domain,
                metric_name=group[0]["metric_name"],
                metric_unit=group[0]["metric_unit"],
                preflight_reference_median=statistics.median(refs) if refs else None,
                inflight_median=statistics.median(inflight) if inflight else None,
                preflight_sd=statistics.stdev(pre) if len(pre) > 1 else None,
                inflight_sd=statistics.stdev(inflight) if len(inflight) > 1 else None,
                n_preflight=len(pre),
                n_inflight=len(inflight),
                within_reference=statuses.count("within_reference"),
                outside_reference=statuses.count("outside_reference"),
                preflight_values=pre,
                inflight_values=inflight,
            )
        )
    completed = history(
        c,
        "assessment_sessions",
        aid,
        "completed_at",
        q,
        "AND mission_phase='inflight' AND session_status='completed'",
    )
    days = sorted({r["assessment_date"] for r in data})
    completion = [
        dict(
            date=d,
            sessions_completed=sum(s["completed_at"][:10] == d for s in completed),
            sessions_expected=c.execute(
                "SELECT COUNT(*) FROM assessment_assignments WHERE astronaut_id=? AND substr(scheduled_at,1,10)=?",
                (aid, d),
            ).fetchone()[0],
        )
        for d in days
    ]
    return dict(
        astronaut_id=aid,
        **{"from": q.get("from"), "to": min(q.get("to", now(c)[:10]), now(c)[:10])},
        domains=domains,
        completion_by_day=completion,
    )


def condition_reason(c, assignment):
    # Preserve the existing frontend scheduler's condition windows on the server.
    timestamp = now(c)
    hour = parse_iso(timestamp).hour
    windows = {
        "morning": (5, 13, "05:00–13:00 UTC"),
        "afternoon": (12, 18, "12:00–18:00 UTC"),
        "evening": (18, 22, "18:00–22:00 UTC"),
        "night": (20, 5, "20:00–05:00 UTC"),
    }
    condition = assignment["assessment_condition"]
    aid = assignment["astronaut_id"]
    if condition in windows:
        start, end, label = windows[condition]
        inside = start <= hour < end if start < end else hour >= start or hour < end
        return None if inside else f"Available {label}."
    if condition == "after_physical_work":
        done = c.execute(
            "SELECT 1 FROM activity_records WHERE astronaut_id=? AND substr(end_time,1,10)=? AND end_time<=? LIMIT 1",
            (aid, timestamp[:10], timestamp),
        ).fetchone()
        return None if done else "Available after today’s exercise is recorded."
    if condition == "after_mental_work":
        done = c.execute(
            "SELECT 1 FROM task_assignments WHERE astronaut_id=? AND substr(planned_end,1,10)=? AND planned_end<=? LIMIT 1",
            (aid, timestamp[:10], timestamp),
        ).fetchone()
        return None if done else "Available after a scheduled task is finished."
    if condition == "weekly_extended":
        from app.api.console import mission_state

        return (
            None
            if mission_state(c)["mission_day"] % 7 == 0
            else "Runs on the weekly extended session day (every 7th mission day)."
        )
    return None


def dispatch(c, u, method, path, q, b):
    parts = path.split("/")
    if path.startswith("cognition/"):
        aid = q.get("astronaut_id")
        access(c, u, aid)
        if method == "GET" and path == "cognition/daily-results":
            return daily(c, aid, q)
        if method == "GET" and path == "cognition/comparisons":
            return comparisons(c, aid, q)
        if method == "GET" and path == "cognition/summary":
            return summary(c, aid, q)
    if not path.startswith("assessments/"):
        return NotImplemented
    from app.services.console_records import assessment_records, ensure_protocols

    ensure_protocols(c)
    result = assessment_records(c, u, method, path, q, b)
    if result is not NotImplemented:
        return result
    if method == "GET":
        if path == "assessments/protocols":
            return rows(c, "SELECT * FROM assessment_protocols")
        if path == "assessments/metric-definitions":
            return scoring.list_metric_definitions(c)
        if path == "assessments/schedule-templates":
            staff(u)
            return rows(c, "SELECT * FROM assessment_schedule_templates")
        if path == "assessments/assignments":
            return page(assignments(c, u, q), q)
        if path == "assessments/due":
            aid = q.get("astronaut_id") or service.astronaut_id_for_user(c, u)
            access(c, u, aid)
            result = []
            for a in service.get_due_assessments(c, aid)["due"]:
                p = one(c, "assessment_protocols", "protocol_id", a["protocol_id"])
                t = one(
                    c,
                    "assessment_schedule_templates",
                    "template_id",
                    a["schedule_template_id"],
                )
                reason = None
                try:
                    scoring.validate_scoring_protocol(
                        c, p["protocol_id"], extended=True
                    )
                except (ValidationFailed, NotFound) as exc:
                    reason = exc.message
                if a["effective_status"] == "in_progress":
                    reason = "An assessment session is already in progress."
                result.append(
                    dict(
                        assignment=a,
                        protocol=p,
                        authorized=reason is None,
                        conditions_met=condition_reason(c, a) is None,
                        blocking_reason=reason or condition_reason(c, a),
                        mission_phase=t["mission_phase"],
                    )
                )
            return result
        if path == "assessments/sessions":
            ids = auth_service.get_permitted_astronauts(c, u)
            if q.get("astronaut_id"):
                access(c, u, q["astronaut_id"])
                ids = [q["astronaut_id"]]
            data = [
                r
                for r in rows(
                    c,
                    "SELECT * FROM assessment_sessions WHERE started_at<=? ORDER BY started_at DESC",
                    (now(c),),
                )
                if r["astronaut_id"] in ids
            ]
            for key in ("protocol_id", "mission_phase"):
                if q.get(key):
                    data = [r for r in data if r[key] == q[key]]
            return page(data, q)
        if len(parts) == 4 and parts[1] == "sessions":
            s = service.get_session(c, parts[2])
            access(c, u, s["astronaut_id"])
            if parts[3] == "trials":
                return page(s["trials"], q)
            if parts[3] == "results":
                return [s["result"]] if s["result"] else []
        if path == "assessments/flagged":
            ids = (
                [q["astronaut_id"]]
                if q.get("astronaut_id")
                else auth_service.get_permitted_astronauts(c, u)
            )
            out = []
            for aid in ids:
                access(c, u, aid)
                out.extend(
                    v["comparison"]
                    for v in comparisons(c, aid, {})
                    if v["comparison"]["reference_range_status"] == "outside_reference"
                )
            return out
        if path == "assessments/oversight":
            auth_service.require_role(u, "medical_officer")
            out = []
            for a in rows(c, "SELECT * FROM astronauts"):
                ss = history(
                    c, "assessment_sessions", a["astronaut_id"], "started_at", {}
                )
                out.append(
                    dict(
                        astronaut_id=a["astronaut_id"],
                        sessions_total=len(ss),
                        sessions_completed=sum(
                            s["session_status"] == "completed" for s in ss
                        ),
                        sessions_valid=sum(s["quality_status"] == "valid" for s in ss),
                        flagged_for_review=sum(
                            v["comparison"]["reference_range_status"]
                            == "outside_reference"
                            for v in comparisons(c, a["astronaut_id"], {})
                        ),
                    )
                )
            return out
        if path == "assessments/mission-mind/summary":
            aid = q.get("astronaut_id")
            access(c, u, aid)
            today = now(c)[:10]
            aa = [
                a
                for a in assignments(c, u, {"astronaut_id": aid})
                if a["scheduled_at"][:10] == today
            ]
            ss = history(
                c,
                "assessment_sessions",
                aid,
                "started_at",
                {},
                "AND session_status='completed'",
            )
            games = []
            for p in rows(
                c,
                "SELECT * FROM assessment_protocols WHERE protocol_id IN ('PVT','NBACK','STROOP','ROTATION','SWITCH')",
            ):
                a = next((a for a in aa if a["protocol_id"] == p["protocol_id"]), None)
                games.append(
                    dict(
                        protocol_id=p["protocol_id"],
                        protocol_name=p["protocol_name"],
                        cognitive_domain={
                            **scoring.PROTOCOL_DOMAIN,
                            **scoring.EXTENDED_DOMAIN,
                        }.get(p["protocol_id"], "unknown"),
                        scheduled_today=a is not None,
                        completed_today=bool(a and a["access_status"] == "completed"),
                        assignment_id=a["assignment_id"] if a else None,
                        sessions_completed_total=sum(
                            s["protocol_id"] == p["protocol_id"] for s in ss
                        ),
                    )
                )
            results = rows(
                c,
                """SELECT r.* FROM assessment_results r JOIN assessment_sessions s ON s.session_id=r.session_id
                WHERE s.astronaut_id=? AND substr(s.started_at,1,10)=? AND r.calculated_at<=?""",
                (aid, today, now(c)),
            )
            streak = 0
            d = parse_iso(today)
            dates = {s["started_at"][:10] for s in ss}
            while to_iso(d)[:10] in dates:
                streak += 1
                d -= timedelta(days=1)
            return dict(
                astronaut_id=aid,
                date=today,
                estimate_seconds=sum(
                    one(c, "assessment_protocols", "protocol_id", a["protocol_id"])[
                        "duration_seconds"
                    ]
                    for a in aa
                ),
                sessions_scheduled_today=len(aa),
                sessions_completed_today=sum(
                    a["access_status"] == "completed" for a in aa
                ),
                streak_days=streak,
                games=games,
                results_today=results,
            )
    if method == "POST":
        if path == "assessments/sessions":
            assignment = service._assignment(c, b.get("assignment_id"))
            service._require_owner(
                assignment["astronaut_id"], service.astronaut_id_for_user(c, u)
            )
            reason = condition_reason(c, assignment)
            if reason:
                raise Conflict(reason)
            result = service.start_assessment_session(
                c,
                b.get("assignment_id"),
                actor_astronaut_id=service.astronaut_id_for_user(c, u),
                actor_user_id=u["user_id"],
                extended=True,
            )
            return result
        if len(parts) == 4 and parts[1] == "sessions":
            sid = parts[2]
            s = service.get_session(c, sid)
            service._require_owner(
                s["astronaut_id"], service.astronaut_id_for_user(c, u)
            )
            if parts[3] == "trials":
                _tables(c)
                metadata = {
                    k: b.get(k) for k in ("phase", "input_device", "test_version")
                }
                c.execute(
                    "INSERT OR REPLACE INTO console_assessment_metadata VALUES (?,?)",
                    (sid, json.dumps(metadata, sort_keys=True)),
                )
                if b.get("phase") == "practice":
                    validated = SubmitTrialsRequest.model_validate(b)
                    c.execute(
                        "INSERT OR IGNORE INTO console_practice VALUES (?,?)",
                        (sid, json.dumps(b, sort_keys=True)),
                    )
                    c.commit()
                    return {"accepted": len(validated.trials)}
                validated = SubmitTrialsRequest.model_validate(b)
                trials = [t.model_dump() for t in validated.trials]
                stored = {t["trial_number"]: t for t in s["trials"]}
                fresh = []
                for t in trials:
                    old = stored.get(t["trial_number"])
                    if old:
                        if any(
                            old[k] != t[k]
                            for k in (
                                "stimulus_type",
                                "stimulus_value",
                                "expected_response",
                                "actual_response",
                                "reaction_time_ms",
                            )
                        ):
                            raise Conflict("A trial retry changed recorded values")
                    else:
                        fresh.append(t)
                if fresh:
                    service.submit_assessment_trials(
                        c,
                        sid,
                        fresh,
                        actor_astronaut_id=s["astronaut_id"],
                        extended=True,
                    )
                return {"accepted": len(trials)}
            if parts[3] == "complete":
                _tables(c)
                prior = c.execute(
                    "SELECT payload FROM console_assessment_metadata WHERE session_id=?",
                    (sid,),
                ).fetchone()
                metadata = json.loads(prior[0]) if prior else {}
                metadata.update(
                    completed_at=b.get("completed_at"),
                    interruption_count=b.get("interruption_count", 0),
                )
                c.execute(
                    "INSERT OR REPLACE INTO console_assessment_metadata VALUES (?,?)",
                    (sid, json.dumps(metadata, sort_keys=True)),
                )
                if s["session_status"] != "completed":
                    survey = None
                    if s["protocol_id"] == "SURVEY":
                        context = one(
                            c, "assessment_context", "context_id", s["context_id"]
                        )
                        survey = SurveyAnswers.model_validate(context).model_dump()
                    service.complete_assessment_session(
                        c,
                        sid,
                        actor_astronaut_id=s["astronaut_id"],
                        actor_user_id=u["user_id"],
                        survey=survey,
                        extended=True,
                    )
                s = service.get_session(c, sid)
                return dict(session=s, results=[s["result"]] if s["result"] else [])
        if path == "assessments/context":
            aid = b.get("astronaut_id")
            service._require_owner(aid, service.astronaut_id_for_user(c, u))
            s = c.execute(
                "SELECT * FROM assessment_sessions WHERE astronaut_id=? AND session_status='in_progress' ORDER BY started_at DESC LIMIT 1",
                (aid,),
            ).fetchone()
            if s is None:
                raise ValidationFailed("No active assessment session")
            survey = SurveyAnswers.model_validate(b)
            c.execute(
                "UPDATE assessment_context SET fatigue_score=?,sleepiness_score=?,perceived_workload=? WHERE context_id=?",
                (
                    survey.fatigue_score,
                    survey.sleepiness_score,
                    survey.perceived_workload,
                    s["context_id"],
                ),
            )
            c.commit()
            return one(c, "assessment_context", "context_id", s["context_id"])
        if (
            len(parts) == 4
            and parts[1] == "assignments"
            and parts[3] in ("grant", "revoke")
        ):
            auth_service.require_role(u, "medical_officer")
            a = one(c, "assessment_assignments", "assignment_id", parts[2])
            if a["access_status"] in ("completed", "in_progress"):
                raise Conflict("Cannot change a started assessment")
            expires = to_iso(parse_iso(b.get("access_expires_at", now(c))))
            if parts[3] == "grant" and expires <= now(c):
                raise ValidationFailed("Access expiry must be in the future")
            c.execute(
                "UPDATE assessment_assignments SET access_status=?,access_expires_at=?,assigned_by_user_id=? WHERE assignment_id=?",
                (
                    "available" if parts[3] == "grant" else "expired",
                    expires,
                    u["user_id"],
                    parts[2],
                ),
            )
            c.commit()
            return one(c, "assessment_assignments", "assignment_id", parts[2])
    return NotImplemented
