"""Research chart formatting. All numbers derive from the stored job's data cutoff."""

import statistics
from datetime import timedelta
from collections import defaultdict
from app.api.console import rows
from app.core.errors import ValidationFailed
from app.services import research_service as research
from app.utils.statistics import correlation
from app.utils.timestamps import parse_iso, to_iso


def charts(c, analysis, jid, view):
    if view not in ("within_person", "pooled"):
        raise ValidationFailed("Unknown research view")
    job = research.get_job(c, jid)
    cutoff = parse_iso(job["parameters"]["as_of"])
    start = parse_iso(analysis["date_range_start"])
    end = parse_iso(analysis["date_range_end"]) + timedelta(days=1)
    mapping = {
        r["astronaut_id"]: f"P{i:02d}"
        for i, r in enumerate(
            rows(c, "SELECT astronaut_id FROM astronauts ORDER BY astronaut_id"), 1
        )
    }
    allowed = job["parameters"].get("astronaut_ids") or list(mapping)
    xs = {
        a: research.daily_values(
            c,
            analysis["independent_variable"],
            a,
            start - timedelta(days=1),
            end,
            cutoff,
            job["simulation_run_id"],
        )
        for a in allowed
    }
    ys = {
        a: research.daily_values(
            c,
            analysis["dependent_variable"],
            a,
            start,
            end,
            cutoff,
            job["simulation_run_id"],
        )
        for a in allowed
    }
    kind = analysis["analysis_type"]
    points = []
    chart_type = "scatter"
    total = missing = 0
    if kind == "domain_heatmap":
        chart_type = "heatmap"
        data = rows(
            c,
            """SELECT d.* FROM daily_cognitive_results d WHERE assessment_date>=? AND assessment_date<? AND calculated_at<=?
            AND COALESCE((SELECT simulation_run_id FROM daily_result_runs x WHERE x.daily_result_id=d.daily_result_id),'RUN-DEMO-001')=?""",
            (
                analysis["date_range_start"],
                to_iso(end)[:10],
                to_iso(cutoff),
                job["simulation_run_id"],
            ),
        )
        groups = defaultdict(list)
        for r in data:
            if r["astronaut_id"] in allowed and r["daily_median"] is not None:
                groups[(r["astronaut_id"], r["cognitive_domain"])].append(
                    r["daily_median"]
                )
        points = [
            dict(x=domain, y=statistics.median(values), astronaut_id=mapping[a])
            for (a, domain), values in groups.items()
        ]
        total = sum(len(v) for v in groups.values())
    elif kind == "paired_preflight_inflight":
        chart_type = "bar"
        protocol = research._COGNITIVE.get(analysis["dependent_variable"])
        if not protocol:
            raise ValidationFailed(
                "Paired preflight/inflight charts require a cognitive dependent variable"
            )
        for aid in allowed:
            pre = rows(
                c,
                """SELECT r.metric_value FROM assessment_results r JOIN assessment_sessions s ON s.session_id=r.session_id
                WHERE s.astronaut_id=? AND s.protocol_id=? AND s.mission_phase='preflight' AND s.session_status='completed'
                AND s.quality_status='valid' AND r.calculated_at<=?""",
                (aid, protocol[0], to_iso(cutoff)),
            )
            inflight = list(ys[aid].values())
            if pre and inflight:
                points.extend(
                    [
                        dict(
                            x=mapping[aid],
                            y=statistics.median(r["metric_value"] for r in pre),
                            astronaut_id=mapping[aid],
                            group="preflight",
                        ),
                        dict(
                            x=mapping[aid],
                            y=statistics.median(inflight),
                            astronaut_id=mapping[aid],
                            group="inflight",
                        ),
                    ]
                )
                total += len(pre) + len(inflight)
    elif kind in ("longitudinal", "individual_trajectories"):
        chart_type = "line"
        if kind == "longitudinal" and view == "pooled":
            dates = sorted({d for values in ys.values() for d in values})
            points = [
                dict(
                    x=d,
                    y=statistics.median(v[d] for v in ys.values() if d in v),
                    astronaut_id=None,
                )
                for d in dates
            ]
        else:
            for aid, values in ys.items():
                mean = statistics.mean(values.values()) if values else 0
                points.extend(
                    dict(
                        x=d,
                        y=y - mean if view == "within_person" else y,
                        astronaut_id=mapping[aid],
                    )
                    for d, y in values.items()
                )
            points.sort(key=lambda p: p["x"])
        total = sum(len(v) for v in ys.values())
    else:
        lag = 1 if kind == "lagged_comparison" else 0
        for aid, values in ys.items():
            for day, y in values.items():
                total += 1
                previous = to_iso(parse_iso(day) - timedelta(days=lag))[:10]
                x = xs[aid].get(previous)
                if x is None:
                    missing += 1
                    continue
                points.append(dict(x=x, y=y, astronaut_id=mapping[aid]))
        if view == "within_person":
            for pid in {p["astronaut_id"] for p in points}:
                group = [p for p in points if p["astronaut_id"] == pid]
                mx = statistics.mean(p["x"] for p in group)
                my = statistics.mean(p["y"] for p in group)
                for p in group:
                    p["x"] -= mx
                    p["y"] -= my
    stats = None
    if chart_type == "scatter" and len(points) >= research.MIN_PAIRS:
        groups = len({p["astronaut_id"] for p in points})
        df = len(points) - groups - 1 if view == "within_person" else len(points) - 2
        stats = correlation([p["x"] for p in points], [p["y"] for p in points], df=df)
    return [
        dict(
            chart_id=jid + "-" + kind,
            chart_type=chart_type,
            title=kind.replace("_", " ").title(),
            x=dict(
                variable="assessment_date"
                if chart_type == "line"
                else analysis["independent_variable"],
                unit=None
                if chart_type == "line"
                else research.VARIABLES[analysis["independent_variable"]]["unit"],
            ),
            y=dict(
                variable=analysis["dependent_variable"],
                unit=research.VARIABLES[analysis["dependent_variable"]]["unit"],
            ),
            points=points,
            sample_size=total - missing,
            effect_estimate=stats["r"] if stats else None,
            confidence_interval_lower=stats["ci_lower"] if stats else None,
            confidence_interval_upper=stats["ci_upper"] if stats else None,
            missing=dict(n_missing=missing, n_total=total),
            view=view,
        )
    ]
