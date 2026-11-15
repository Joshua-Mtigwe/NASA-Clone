"""Dashboard research views: numerical results come only from backend services."""

from collections import Counter
from app.api.console import rows, one, now, staff, mission_state
from app.core.errors import NotFound, ValidationFailed
from app.services import research_service as service, auth_service
from app.schemas.research import CreateAnalysisRequest


def pseudonyms(c):
    return {
        a["astronaut_id"]: f"P{i:02d}"
        for i, a in enumerate(
            rows(c, "SELECT astronaut_id FROM astronauts ORDER BY astronaut_id"), 1
        )
    }


def dispatch(c, u, method, path, q, b):
    if not path.startswith("research/"):
        return NotImplemented
    staff(u)
    p = path.split("/")
    mapping = pseudonyms(c)
    if method == "POST" and path == "research/analyses":
        auth_service.require_role(u, "medical_researcher")
        # Unsupported filters are rejected explicitly rather than silently ignored.
        if b.get("mission_phase") not in (None, "", "inflight") or b.get(
            "quality_status"
        ) not in (None, "", "valid"):
            raise ValidationFailed(
                "This backend supports valid inflight paired analyses; domain/phase filters require a matching supported variable"
            )
        domain = b.get("cognitive_domain")
        if domain:
            matching = {
                "median_reaction_time_ms": "vigilance",
                "nback_accuracy_percent": "working_memory",
                "stroop_accuracy_percent": "attention",
            }
            if matching.get(b.get("dependent_variable")) != domain:
                raise ValidationFailed(
                    "Select a dependent variable matching the requested cognitive domain"
                )
        request = CreateAnalysisRequest.model_validate(b)
        analysis = service.create_analysis(
            c, actor_user_id=u["user_id"], **request.model_dump()
        )
        ids = b.get("astronaut_id")
        if ids:
            reverse = {v: k for k, v in mapping.items()}
            if any(a not in reverse for a in ids):
                raise ValidationFailed("Unknown participant identifier")
            ids = [reverse[a] for a in ids]
        job = service.run_analysis_job(
            c,
            analysis["analysis_id"],
            actor_user_id=u["user_id"],
            astronaut_ids=ids,
            lag_days=1 if b.get("analysis_type") == "lagged_comparison" else 0,
        )
        if job["status"] == "completed":
            from app.services.research_report_service import create_report

            create_report(c, actor_user_id=u["user_id"], job_id=job["job_id"])
        return job
    if method != "GET":
        return NotImplemented
    if path == "research/overview":
        counts = Counter(
            r["quality_status"]
            for r in rows(
                c,
                "SELECT quality_status FROM assessment_sessions WHERE started_at<=?",
                (now(c),),
            )
        )
        state = mission_state(c)
        return dict(
            participants=len(mapping),
            participant_ids=list(mapping.values()),
            assessment_sessions=sum(counts.values()),
            mission_days=state["mission_day"],
            sessions_by_quality=dict(counts),
        )
    if path == "research/variables":
        tables = {
            "vitals": "sensor_readings",
            "sleep": "sleep_records",
            "activity": "activity_records",
            "radiation": "radiation_readings",
            "cognition": "daily_cognitive_results",
            "self_report": "assessment_context",
        }
        domains = {
            "median_reaction_time_ms": "vigilance",
            "nback_accuracy_percent": "working_memory",
            "stroop_accuracy_percent": "attention",
        }
        return [
            dict(
                variable=r["variable"],
                source_table=tables.get(r["category"], "sensor_readings"),
                unit=r["unit"],
                provenance="measured",
                cognitive_domain=domains.get(r["variable"]),
            )
            for r in service.list_variables()["variables"]
        ]
    if path == "research/analyses":
        return service.list_analyses(c)
    if len(p) >= 3 and p[1] == "analyses":
        aid = p[2]
        analysis = service.get_analysis(c, aid)
        jobs = service.list_jobs(c, analysis_id=aid)
        if len(p) == 3:
            return dict(analysis=analysis, job=jobs[-1] if jobs else None)
        jid = service.latest_job_id(c, aid)
        if p[3] == "results":
            data = service.job_results(c, jid)
            for r in data:
                for old, new in mapping.items():
                    r["interpretation"] = r["interpretation"].replace(old, new)
            return data
        if p[3] == "charts":
            from app.services.console_charts import charts

            return charts(c, analysis, jid, q.get("view", "within_person"))
        if p[3] == "report":
            reports = rows(
                c,
                "SELECT * FROM research_reports WHERE analysis_id=? ORDER BY created_at DESC",
                (aid,),
            )
            if not reports:
                raise NotFound("No report has been drafted for this analysis")
            report = reports[0]
            for old, new in mapping.items():
                report["report_text"] = report["report_text"].replace(old, new)
            return report
    if path == "research/planning-comparison":
        state = mission_state(c)
        cutoff = now(c)
        aa = rows(
            c,
            """SELECT a.*,t.task_category FROM task_assignments a JOIN mission_tasks t ON t.task_id=a.task_id
            JOIN schedule_versions v ON v.schedule_version_id=a.schedule_version_id
            WHERE a.planned_start<=? AND v.status IN ('approved','published') AND v.simulation_run_id='RUN-DEMO-001' """,
            (cutoff,),
        )
        from app.utils.timestamps import parse_iso

        workloads = {}
        categories = {}
        adherence = {}
        for a in aa:
            participant = mapping[a["astronaut_id"]]
            day = a["planned_start"][:10]
            minutes = (
                parse_iso(a["planned_end"]) - parse_iso(a["planned_start"])
            ).total_seconds() / 60
            workloads[(participant, day)] = (
                workloads.get((participant, day), 0) + minutes
            )
            categories[(participant, a["task_category"])] = (
                categories.get((participant, a["task_category"]), 0) + minutes
            )
            item = adherence.setdefault(
                day, dict(date=day, scheduled_tasks=0, completed_tasks=0)
            )
            item["scheduled_tasks"] += 1
            item["completed_tasks"] += int(a["assignment_status"] == "completed")
        effects = rows(
            c,
            "SELECT * FROM planning_effectiveness WHERE evaluation_period_end<=?",
            (cutoff[:10],),
        )
        import statistics
        from collections import defaultdict

        by_domain = defaultdict(lambda: defaultdict(list))
        for r in rows(
            c,
            "SELECT * FROM daily_cognitive_results WHERE calculated_at<=? AND valid_trials>0",
            (cutoff,),
        ):
            if r["daily_median"] is not None:
                by_domain[(r["cognitive_domain"], r["metric_unit"])][
                    r["assessment_date"]
                ].append(r["daily_median"])
        trends = []
        for (domain, unit), dates in by_domain.items():
            bases = [
                r["median_value"]
                for r in rows(
                    c,
                    "SELECT median_value FROM cognitive_baselines WHERE cognitive_domain=? AND calculated_at<=?",
                    (domain, cutoff),
                )
            ]
            trends.append(
                dict(
                    cognitive_domain=domain,
                    metric_unit=unit,
                    points=[
                        dict(
                            date=d,
                            crew_inflight_median=statistics.median(v),
                            preflight_reference_median=statistics.median(bases)
                            if bases
                            else None,
                        )
                        for d, v in sorted(dates.items())
                    ],
                )
            )
        return {
            "from": state["mission"]["launch_date"][:10],
            "to": cutoff[:10],
            "operational": dict(
                workload_heatmap=[
                    dict(astronaut_id=a, date=d, scheduled_minutes=m)
                    for (a, d), m in workloads.items()
                ],
                workload_by_category=[
                    dict(astronaut_id=a, task_category=t, scheduled_minutes=m)
                    for (a, t), m in categories.items()
                ],
                schedule_adherence=list(adherence.values()),
                comparisons=effects,
            ),
            "health_hypotheses": dict(domain_trends=trends, comparisons=effects)
            if u["role_name"] != "mission_leader"
            else None,
        }
    return NotImplemented
