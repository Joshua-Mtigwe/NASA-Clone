"""Health serialization for the preserved dashboard using stored measurements."""

import statistics
from datetime import timedelta
from app.api.console import rows, one, now, history, page, access
from app.core.errors import NotFound, ValidationFailed
from app.utils.timestamps import parse_iso, to_iso

SENSORS = ["heart_rate", "hrv_rmssd", "spo2", "respiratory_rate", "body_temperature"]


def summary(c, aid):
    measurements = []

    def add(measure, table, time, value, unit, source, extra="", args=()):
        data = history(c, table, aid, time, {}, extra, args)
        r = data[-1] if data else None
        measurements.append(
            dict(
                measure=measure,
                value=r.get(value) if r else None,
                unit=r.get(unit) if r and unit else ("min" if r else None),
                measured_at=r[time] if r else None,
                source_id=r.get(source) if r else None,
                source_type=(r.get("source_type") or r.get("data_source"))
                if r
                else None,
                quality_status=r.get("quality_status") if r else None,
                provenance="measured" if r else None,
                source_table=table if r else None,
            )
        )

    for m in SENSORS + ["blood_pressure"]:
        add(
            m,
            "sensor_readings",
            "timestamp_utc",
            "measurement_value",
            "measurement_unit",
            "sensor_id",
            "AND measurement_type = ?",
            (m,),
        )
    add(
        "sleep_duration",
        "sleep_records",
        "sleep_end",
        "total_sleep_minutes",
        None,
        "sleep_id",
    )
    add(
        "radiation_dose_rate",
        "radiation_readings",
        "timestamp_utc",
        "dose_rate",
        "dose_rate_unit",
        "sensor_id",
    )
    add(
        "physical_activity",
        "activity_records",
        "end_time",
        "duration_minutes",
        None,
        "activity_id",
    )
    return dict(astronaut_id=aid, as_of=now(c), measurements=measurements)


def schedule(c, aid, day):
    items = []

    def add(
        kind,
        ref,
        title,
        start,
        end,
        duration=None,
        priority=None,
        category=None,
        status=None,
        approval=None,
    ):
        if start[:10] != day:
            return
        if duration is None and end:
            duration = (parse_iso(end) - parse_iso(start)).total_seconds() / 60
        items.append(
            dict(
                kind=kind,
                ref_id=ref,
                title=title,
                start_time=start,
                end_time=end,
                duration_minutes=duration,
                priority=priority,
                workload_category=category,
                completion_status=status,
                approval_status=approval,
            )
        )

    for r in rows(
        c,
        """SELECT a.*, t.task_title, t.priority, t.task_category FROM task_assignments a
        JOIN mission_tasks t ON t.task_id=a.task_id JOIN schedule_versions v ON v.schedule_version_id=a.schedule_version_id
        WHERE a.astronaut_id=? AND v.simulation_run_id='RUN-DEMO-001' AND v.status IN ('approved','published')""",
        (aid,),
    ):
        add(
            "task",
            r["task_assignment_id"],
            r["task_title"],
            r["planned_start"],
            r["planned_end"],
            priority=r["priority"],
            category=r["task_category"],
            status=r["assignment_status"],
            approval=r["approval_status"],
        )
    for r in rows(
        c,
        """SELECT d.*, r.activity_name, s.completion_status FROM daily_schedules d
        LEFT JOIN scheduled_recovery s ON s.schedule_id=d.schedule_id
        LEFT JOIN recovery_activities r ON r.recovery_activity_id=s.recovery_activity_id
        WHERE d.astronaut_id=? AND d.activity_type='recovery' AND d.schedule_status='published'
        AND d.approval_status='approved' AND COALESCE(d.simulation_run_id,'RUN-DEMO-001')='RUN-DEMO-001' """,
        (aid,),
    ):
        add(
            "recovery",
            r["schedule_id"],
            r["activity_name"] or "Supportive routine",
            r["start_time"],
            r["end_time"],
            status=r["completion_status"],
            approval=r["approval_status"],
        )
    for r in rows(
        c,
        "SELECT a.*,p.protocol_name,p.duration_seconds FROM assessment_assignments a JOIN assessment_protocols p ON p.protocol_id=a.protocol_id WHERE a.astronaut_id=?",
        (aid,),
    ):
        add(
            "assessment",
            r["assignment_id"],
            r["protocol_name"],
            r["scheduled_at"],
            None,
            r["duration_seconds"] / 60,
            status=r["access_status"],
        )
    for r in history(c, "activity_records", aid, "end_time", {}):
        add(
            "exercise",
            r["activity_id"],
            r["activity_type"],
            r["start_time"],
            r["end_time"],
            r["duration_minutes"],
        )
    for r in history(c, "sleep_records", aid, "sleep_end", {}):
        add("sleep", r["sleep_id"], "Sleep", r["sleep_start"], r["sleep_end"])
    return dict(
        astronaut_id=aid, date=day, items=sorted(items, key=lambda i: i["start_time"])
    )


def reference(c, aid, measure):
    astronaut = one(c, "astronauts", "astronaut_id", aid)
    mission = one(c, "missions", "mission_id", astronaut["mission_id"])
    end = to_iso(parse_iso(mission["launch_date"]) + timedelta(days=7))
    if now(c) < end:
        raise NotFound("Personal reference needs seven completed mission days")
    if measure == "sleep_duration":
        data = [
            dict(
                timestamp_utc=r["sleep_end"],
                measurement_value=r["total_sleep_minutes"],
                measurement_unit="min",
            )
            for r in history(
                c, "sleep_records", aid, "sleep_end", {}, "AND quality_status='valid'"
            )
        ]
    elif measure == "radiation_dose_rate":
        data = [
            dict(
                timestamp_utc=r["timestamp_utc"],
                measurement_value=r["dose_rate"],
                measurement_unit=r["dose_rate_unit"],
            )
            for r in history(c, "radiation_readings", aid, "timestamp_utc", {})
        ]
    else:
        data = history(
            c,
            "sensor_readings",
            aid,
            "timestamp_utc",
            {},
            "AND measurement_type=? AND quality_status='valid'",
            (measure,),
        )
    data = [
        r
        for r in data
        if mission["launch_date"] <= r["timestamp_utc"] < end
        and r["measurement_value"] is not None
    ]
    if len(data) < 2:
        raise NotFound("No personal reference for this measurement")
    vals = [r["measurement_value"] for r in data]
    mean = statistics.mean(vals)
    sd = statistics.stdev(vals)
    return dict(
        astronaut_id=aid,
        measurement_type=measure,
        metric_unit=data[0]["measurement_unit"],
        median_value=statistics.median(vals),
        mean_value=mean,
        standard_deviation=sd,
        reference_lower=mean - 2 * sd,
        reference_upper=mean + 2 * sd,
        sample_size=len(vals),
        reference_method="personal_first_seven_days_mean_2sd",
        baseline_version="mission_week_1",
        calculated_at=end,
    )


def readiness(c, aid):
    return rows(
        c,
        "SELECT * FROM crew_readiness WHERE astronaut_id=? AND assessment_date<=? ORDER BY assessment_date",
        (aid, now(c)[:10]),
    )


def dispatch(c, u, method, path, q, b):
    if method != "GET":
        return NotImplemented
    parts = path.split("/")
    if len(parts) >= 3 and parts[0] == "astronauts":
        aid = parts[1]
        access(c, u, aid)
        feature = "/".join(parts[2:])
        if feature == "health/summary":
            return summary(c, aid)
        if feature == "schedule":
            return schedule(c, aid, q.get("date", now(c)[:10]))
        if feature == "baselines":
            return rows(
                c,
                "SELECT * FROM cognitive_baselines WHERE astronaut_id=? AND calculated_at<=?",
                (aid, now(c)),
            )
        if feature == "readiness":
            return readiness(c, aid)
        if feature == "readiness/summary":
            factors = []
            for m in summary(c, aid)["measurements"]:
                try:
                    ref = reference(c, aid, m["measure"])
                except NotFound:
                    ref = None
                value = m["value"]
                factors.append(
                    dict(
                        factor=m["measure"],
                        kind="sleep"
                        if m["measure"] == "sleep_duration"
                        else "physiological",
                        value=value,
                        unit=m["unit"],
                        measured_at=m["measured_at"],
                        reference_lower=ref["reference_lower"] if ref else None,
                        reference_upper=ref["reference_upper"] if ref else None,
                        reference_range_status=(
                            "within_reference"
                            if ref["reference_lower"] <= value <= ref["reference_upper"]
                            else "outside_reference"
                        )
                        if ref and value is not None
                        else "no_data",
                        source_table=m["source_table"],
                    )
                )
            from app.services.console_cognition import comparisons

            latest = {}
            for view in comparisons(c, aid, {}):
                domain = view["daily_result"]["cognitive_domain"]
                if domain == "subjective_fatigue":
                    continue
                if (
                    domain not in latest
                    or view["comparison"]["calculated_at"]
                    > latest[domain]["comparison"]["calculated_at"]
                ):
                    latest[domain] = view
            for domain, view in latest.items():
                base = view["baseline"]
                cmp = view["comparison"]
                factors.append(
                    dict(
                        factor=domain,
                        kind="cognitive",
                        value=cmp["inflight_value"],
                        unit=view["daily_result"]["metric_unit"],
                        measured_at=cmp["calculated_at"],
                        reference_lower=base["reference_lower"] if base else None,
                        reference_upper=base["reference_upper"] if base else None,
                        reference_range_status=cmp["reference_range_status"],
                        source_table="cognitive_comparisons",
                    )
                )
            ready = readiness(c, aid)
            ready = [
                r for r in ready if r["valid_until"] and r["valid_until"] >= now(c)
            ]
            return dict(
                astronaut_id=aid,
                as_of=now(c),
                operational=ready[-1] if ready else None,
                factors=factors,
            )
    if path == "astronauts":
        from app.services.auth_service import get_permitted_astronauts

        ids = get_permitted_astronauts(c, u)
        return [
            r for r in rows(c, "SELECT * FROM astronauts") if r["astronaut_id"] in ids
        ]
    if len(parts) == 2 and parts[0] == "astronauts":
        aid = parts[1]
        access(c, u, aid)
        return dict(
            astronaut=one(c, "astronauts", "astronaut_id", aid),
            qualifications=rows(
                c, "SELECT * FROM astronaut_qualifications WHERE astronaut_id=?", (aid,)
            ),
        )
    tables = {
        "vitals/history": ("sensor_readings", "timestamp_utc", True),
        "vitals/activity": ("activity_records", "end_time", False),
        "sleep": ("sleep_records", "sleep_end", False),
        "radiation": ("radiation_readings", "timestamp_utc", False),
        "radiation/organ-dose": ("organ_dose_estimates", "timestamp_utc", False),
        "vitals/environment": ("environment_readings", "timestamp_utc", True),
    }
    if path in tables:
        aid = q.get("astronaut_id")
        if path != "vitals/environment":
            if not aid:
                raise ValidationFailed("astronaut_id is required")
            access(c, u, aid)
        table, time, paginated = tables[path]
        extra = "AND measurement_type=?" if q.get("measurement_type") else ""
        data = history(
            c, table, aid, time, q, extra, (q["measurement_type"],) if extra else ()
        )
        return page(data, q) if paginated else data
    if path == "vitals/sensors":
        return rows(c, "SELECT * FROM sensors")
    if path == "vitals/reference":
        access(c, u, q.get("astronaut_id"))
        return reference(c, q["astronaut_id"], q.get("measurement_type"))
    if path == "radiation/reference":
        return history(
            c,
            "radiation_readings",
            None,
            "timestamp_utc",
            q,
            "AND astronaut_id IS NULL",
        )
    return NotImplemented
