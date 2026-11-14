"""Scheduling optimiser (plan section 3, Phase 4).

Assigns one day's tasks to astronauts and times, with HARD constraints that are never relaxed:
  * only eligible astronauts (qualification, readiness, restrictions: crew_readiness_service);
  * the required number of crew per task;
  * no overlaps with each other or with existing commitments (morning tests, exercise,
    recovery, protected sleep) and nothing before the workday starts;
  * finish-to-start dependencies (a task can only be scheduled if what it depends on is);
  * deadlines;
  * each astronaut's approved workload limit.

Tasks that cannot be fitted are left unscheduled and explained (explain_infeasible_schedule).
With require_full_coverage=True the run is 'infeasible' instead of partial.

Objective (higher is better), identical for both solvers, in order of importance:
    1,000,000 x sum(priority weight of scheduled tasks)    task coverage first
  -    20,000 x high-demand tasks given to astronauts with a worse-than-usual cognitive result that day
                                                           (outweighs any workload imbalance)
  -        10 x (busiest - least busy astronaut, minutes)  workload balance
  -         1 x sum(start minutes)                         earlier is better (tie-break)
The cognitive term is a preference, never a gate: if only a flagged astronaut is qualified,
the task still goes to them.

Solvers:
  * 'cp-sat'  : Google OR-Tools CP-SAT (pip install ortools). Optimal for any dependency graph.
  * 'builtin' : exact search over assignments with earliest-start timing. Optimal when each
                day's dependencies form chains (as in the AEGIS seed data); a heuristic otherwise.
  * 'auto'    : CP-SAT if installed, else builtin.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import sqlite3
import uuid
from datetime import timedelta
from typing import Any

from app.core.errors import ValidationFailed
from app.services import crew_readiness_service as readiness
from app.services import mission_simulator
from app.services.audit_service import write_audit
from app.services.task_service import PRIORITY_WEIGHT, get_task_planning_payload
from app.utils.timestamps import parse_iso, to_iso, utcnow

OBJECTIVE_VERSION = "v1"
BUILTIN_VERSION = "aegis-builtin-exact-v1"
W_COVERAGE, W_COGNITIVE, W_BALANCE, W_START = 1_000_000, 20_000, 10, 1
ASSESSMENT_BLOCK_MINUTES = 30
DAY = 24 * 60


def ortools_available() -> bool:
    try:
        import ortools.sat.python.cp_model  # noqa: F401
        return True
    except ImportError:
        return False


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


# --------------------------------------------------------------------------- building the problem

def _minutes(day_start, iso: str) -> int:
    return int((parse_iso(iso) - day_start).total_seconds() // 60)


def _blocked_intervals(conn: sqlite3.Connection, astronaut_id: str, day: str, day_start,
                       workday_start_hour: int) -> list[list]:
    """Fixed commitments for one astronaut on one day, in minutes after 00:00 UTC, clipped to the day."""
    day_end = day_start + timedelta(days=1)
    lo, hi = to_iso(day_start), to_iso(day_end)
    blocks: list[list] = []
    if workday_start_hour > 0:
        blocks.append([0, workday_start_hour * 60, "before workday"])

    def add(start_iso: str, end_iso: str, label: str) -> None:
        s, e = max(0, _minutes(day_start, start_iso)), min(DAY, _minutes(day_start, end_iso))
        if e > s:
            blocks.append([s, e, label])

    for r in conn.execute("SELECT sleep_start, sleep_end FROM sleep_records WHERE astronaut_id = ? "
                          "AND sleep_start < ? AND sleep_end > ?", (astronaut_id, hi, lo)):
        add(r[0], r[1], "protected sleep")
    for r in conn.execute("SELECT start_time, end_time, activity_type FROM activity_records WHERE astronaut_id = ? "
                          "AND start_time < ? AND end_time > ?", (astronaut_id, hi, lo)):
        add(r[0], r[1], r[2] or "activity")
    for r in conn.execute("SELECT scheduled_start, scheduled_end FROM scheduled_recovery WHERE astronaut_id = ? "
                          "AND scheduled_start < ? AND scheduled_end > ?", (astronaut_id, hi, lo)):
        add(r[0], r[1], "recovery")
    for (hour,) in conn.execute("SELECT DISTINCT local_hour FROM assessment_schedule_templates "
                                "WHERE mission_phase = 'inflight'"):
        start = day_start + timedelta(hours=int(hour))
        add(to_iso(start), to_iso(start + timedelta(minutes=ASSESSMENT_BLOCK_MINUTES)), "cognitive assessments")
    return sorted(blocks)


def build_scheduling_problem(conn: sqlite3.Connection, task_set_id: str, simulation_run_id: str, *,
                             workday_start_hour: int = 9, require_full_coverage: bool = False) -> dict[str, Any]:
    """A self-contained, JSON-serialisable description of one day's planning problem."""
    if not 0 <= workday_start_hour <= 23:
        raise ValidationFailed("workday_start_hour must be between 0 and 23")
    mission_simulator.get_simulation_state(conn, simulation_run_id)  # run must exist
    payload = get_task_planning_payload(conn, task_set_id)
    day = payload["task_set"]["task_date"]
    day_start = parse_iso(day)
    at = readiness.readiness_time_for(day, workday_start_hour)
    matrix = build_eligibility_matrix(conn, payload["tasks"], at, payload["task_set"]["mission_id"], simulation_run_id)

    astronauts = []
    for astronaut_id, info in matrix["astronauts"].items():
        astronauts.append({
            "astronaut_id": astronaut_id, "workload_limit": info["workload_limit_minutes"] or 0,
            "readiness_id": info["readiness_id"], "cognitive_flags": info["cognitive_flags"],
            "blocked": _blocked_intervals(conn, astronaut_id, day, day_start, workday_start_hour),
        })
    flagged = {a["astronaut_id"] for a in astronauts if a["cognitive_flags"]}
    tasks, eligible, reasons, penalties, flags = [], {}, {}, {}, {}
    for t in payload["tasks"]:
        row = matrix["matrix"][t["task_id"]]
        eligible[t["task_id"]] = [a for a, e in row.items() if e["eligible"]]
        reasons[t["task_id"]] = {a: e["reasons"] for a, e in row.items() if not e["eligible"]}
        flags[t["task_id"]] = {a: e["flags"] for a, e in row.items() if e["eligible"] and e["flags"]}
        demanding = max(t["cognitive_demand_score"] or 0, t["attention_demand_score"] or 0) >= readiness.HIGH_DEMAND
        penalties[t["task_id"]] = {a: int(demanding and a in flagged) for a in eligible[t["task_id"]]}
        tasks.append({
            "task_id": t["task_id"], "title": t["task_title"], "duration": int(t["estimated_duration_minutes"]),
            "deadline": min(DAY, _minutes(day_start, t["deadline"])) if t["deadline"] else DAY,
            "priority": t["priority"], "weight": PRIORITY_WEIGHT.get(t["priority"], 1),
            "crew_count": int(t["required_crew_count"] or 1), "depends_on": t["depends_on"],
            "required_certification": t["required_certification"],
            "safety_critical": readiness.is_safety_critical(t),
        })
    problem = {
        "task_set_id": task_set_id, "task_date": day[:10], "day_start": to_iso(day_start),
        "simulation_run_id": simulation_run_id, "workday_start_hour": workday_start_hour,
        "require_full_coverage": require_full_coverage, "objective_version": OBJECTIVE_VERSION,
        "tasks": tasks, "astronauts": astronauts, "eligible": eligible, "ineligible_reasons": reasons,
        "eligibility_flags": flags, "penalties": penalties,
    }
    problem["input_hash"] = hashlib.sha256(json.dumps(problem, sort_keys=True).encode()).hexdigest()
    return problem


def build_eligibility_matrix(conn: sqlite3.Connection, tasks: list[dict], at, mission_id: str,
                             simulation_run_id: str) -> dict[str, Any]:
    return readiness.build_crew_planning_matrix(conn, tasks, at, mission_id, simulation_run_id)


# --------------------------------------------------------------------------- shared scoring

def score_solution(problem: dict[str, Any], assignments: list[dict[str, Any]]) -> dict[str, int]:
    tasks = {t["task_id"]: t for t in problem["tasks"]}
    coverage = sum(tasks[a["task_id"]]["weight"] for a in assignments)
    penalty = sum(problem["penalties"][a["task_id"]].get(x, 0) for a in assignments for x in a["astronaut_ids"])
    balance_pool = sorted({x for ids in problem["eligible"].values() for x in ids})
    loads = {x: 0 for x in balance_pool}
    for a in assignments:
        for x in a["astronaut_ids"]:
            loads[x] = loads.get(x, 0) + tasks[a["task_id"]]["duration"]
    imbalance = (max(loads.values()) - min(loads.values())) if loads else 0
    starts = sum(a["start"] for a in assignments)
    return {"objective": W_COVERAGE * coverage - W_COGNITIVE * penalty - W_BALANCE * imbalance - W_START * starts,
            "coverage_weight": coverage, "cognitive_penalties": penalty, "workload_imbalance_minutes": imbalance,
            "sum_start_minutes": starts, "loads": loads}


def _status(problem: dict[str, Any], assignments: list[dict]) -> str:
    return "complete" if len(assignments) == len(problem["tasks"]) else "partial"


# --------------------------------------------------------------------------- built-in exact solver

def add_non_overlap_constraints(busy: list[list], start: int, duration: int) -> bool:
    """True if [start, start+duration) overlaps nothing in busy."""
    end = start + duration
    return all(end <= s or start >= e for s, e, *_ in busy)


def add_task_dependency_constraints(task: dict[str, Any], scheduled: dict[str, dict]) -> int | None:
    """Earliest start allowed by finish-to-start dependencies, or None if a dependency is unscheduled."""
    if any(d not in scheduled for d in task["depends_on"]):
        return None
    return max([scheduled[d]["end"] for d in task["depends_on"]], default=0)


def _earliest_slot(busy_lists: list[list[list]], lower: int, duration: int, deadline: int) -> int | None:
    candidates = sorted({lower} | {e for busy in busy_lists for _, e, *_ in busy if e > lower})
    for start in candidates:
        if start + duration > deadline:
            return None
        if all(add_non_overlap_constraints(busy, start, duration) for busy in busy_lists):
            return start
    return None


def _solve_builtin(problem: dict[str, Any]) -> dict[str, Any]:
    tasks = problem["tasks"]
    crew = {a["astronaut_id"]: a for a in problem["astronauts"]}
    remaining_weight = [sum(t["weight"] for t in tasks[i:]) for i in range(len(tasks) + 1)]
    best: dict[str, Any] = {"score": None, "assignments": None}

    def dfs(i: int, busy: dict[str, list], loads: dict[str, int], scheduled: dict[str, dict], coverage: int) -> None:
        if best["score"] is not None and coverage + remaining_weight[i] < best["score"]["coverage_weight"]:
            return  # cannot beat the best coverage found so far
        if i == len(tasks):
            assignments = list(scheduled.values())
            score = score_solution(problem, assignments)
            if best["score"] is None or score["objective"] > best["score"]["objective"]:
                best["score"], best["assignments"] = score, [dict(a) for a in assignments]
            return
        task = tasks[i]
        lower = add_task_dependency_constraints(task, scheduled)
        if lower is not None:
            for team in itertools.combinations(problem["eligible"][task["task_id"]], task["crew_count"]):
                if any(loads[x] + task["duration"] > crew[x]["workload_limit"] for x in team):
                    continue
                start = _earliest_slot([busy[x] for x in team], lower, task["duration"], task["deadline"])
                if start is None:
                    continue
                entry = {"task_id": task["task_id"], "astronaut_ids": list(team), "start": start,
                         "end": start + task["duration"]}
                for x in team:
                    busy[x].append([start, entry["end"], task["task_id"]])
                    loads[x] += task["duration"]
                scheduled[task["task_id"]] = entry
                dfs(i + 1, busy, loads, scheduled, coverage + task["weight"])
                del scheduled[task["task_id"]]
                for x in team:
                    busy[x].pop()
                    loads[x] -= task["duration"]
        if not problem["require_full_coverage"]:
            dfs(i + 1, busy, loads, scheduled, coverage)  # leave this task unscheduled

    dfs(0, {a: [list(b) for b in crew[a]["blocked"]] for a in crew}, {a: 0 for a in crew}, {}, 0)
    if best["assignments"] is None:
        return {"status": "infeasible", "assignments": [], "score": None, "solver_version": BUILTIN_VERSION}
    assignments = sorted(best["assignments"], key=lambda a: (a["start"], a["task_id"]))
    return {"status": _status(problem, assignments), "assignments": assignments, "score": best["score"],
            "solver_version": BUILTIN_VERSION}


# --------------------------------------------------------------------------- OR-Tools CP-SAT solver

def _solve_cp_sat(problem: dict[str, Any], time_limit_seconds: float = 10.0) -> dict[str, Any]:
    from ortools import __version__ as ortools_version
    from ortools.sat.python import cp_model

    model = cp_model.CpModel()
    tasks = problem["tasks"]
    crew = {a["astronaut_id"]: a for a in problem["astronauts"]}
    assigned, start, end, presence = {}, {}, {}, {}
    intervals: dict[str, list] = {a: [] for a in crew}
    effective_start = []

    for t in tasks:
        tid, dur = t["task_id"], t["duration"]
        assigned[tid] = model.NewBoolVar(f"assigned_{tid}")
        start[tid] = model.NewIntVar(0, DAY, f"start_{tid}")
        end[tid] = model.NewIntVar(0, DAY + dur, f"end_{tid}")
        model.Add(end[tid] == start[tid] + dur)
        model.Add(end[tid] <= t["deadline"]).OnlyEnforceIf(assigned[tid])
        pres = []
        for a in problem["eligible"][tid]:
            p = model.NewBoolVar(f"p_{tid}_{a}")
            presence[(tid, a)] = p
            pres.append(p)
            intervals[a].append(model.NewOptionalIntervalVar(start[tid], dur, end[tid], p, f"i_{tid}_{a}"))
        model.Add(sum(pres) == t["crew_count"] * assigned[tid]) if pres else model.Add(assigned[tid] == 0)
        eff = model.NewIntVar(0, DAY, f"eff_start_{tid}")
        model.Add(eff == start[tid]).OnlyEnforceIf(assigned[tid])
        model.Add(eff == 0).OnlyEnforceIf(assigned[tid].Not())
        effective_start.append(eff)
        if problem["require_full_coverage"]:
            model.Add(assigned[tid] == 1)

    for t in tasks:
        for dep in t["depends_on"]:
            model.AddImplication(assigned[t["task_id"]], assigned[dep])
            model.Add(start[t["task_id"]] >= end[dep]).OnlyEnforceIf(assigned[t["task_id"]])

    loads = {}
    for a, info in crew.items():
        merged_blocked: list[list[int]] = []
        for s, e, *_ in sorted((b[0], b[1]) for b in info["blocked"] if b[1] > b[0]):
            if merged_blocked and s <= merged_blocked[-1][1]:
                merged_blocked[-1][1] = max(merged_blocked[-1][1], e)
            else:
                merged_blocked.append([s, e])
        fixed = [model.NewIntervalVar(s, e - s, e, f"blocked_{a}_{k}") for k, (s, e) in enumerate(merged_blocked)]
        model.AddNoOverlap(intervals[a] + fixed)
        load = model.NewIntVar(0, DAY, f"load_{a}")
        model.Add(load == sum(t["duration"] * presence[(t["task_id"], a)]
                              for t in tasks if (t["task_id"], a) in presence))
        model.Add(load <= info["workload_limit"])
        loads[a] = load

    pool = sorted({x for ids in problem["eligible"].values() for x in ids})
    imbalance = model.NewIntVar(0, DAY, "imbalance")
    if pool:
        hi, lo = model.NewIntVar(0, DAY, "max_load"), model.NewIntVar(0, DAY, "min_load")
        model.AddMaxEquality(hi, [loads[a] for a in pool])
        model.AddMinEquality(lo, [loads[a] for a in pool])
        model.Add(imbalance == hi - lo)
    else:
        model.Add(imbalance == 0)
    model.Maximize(
        W_COVERAGE * sum(t["weight"] * assigned[t["task_id"]] for t in tasks)
        - W_COGNITIVE * sum(problem["penalties"][tid].get(a, 0) * p for (tid, a), p in presence.items())
        - W_BALANCE * imbalance
        - W_START * sum(effective_start))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.num_workers = 1  # deterministic
    solver.parameters.random_seed = 0
    code = solver.Solve(model)
    version = f"ortools-cp-sat-{ortools_version}"
    if code == cp_model.INFEASIBLE:
        return {"status": "infeasible", "assignments": [], "score": None, "solver_version": version}
    if code not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": "failed", "assignments": [], "score": None, "solver_version": version,
                "error": solver.StatusName(code)}
    assignments = []
    for t in tasks:
        tid = t["task_id"]
        if solver.Value(assigned[tid]):
            team = [a for a in problem["eligible"][tid] if solver.Value(presence[(tid, a)])]
            s = solver.Value(start[tid])
            assignments.append({"task_id": tid, "astronaut_ids": team, "start": s, "end": s + t["duration"]})
    assignments.sort(key=lambda a: (a["start"], a["task_id"]))
    return {"status": _status(problem, assignments), "assignments": assignments,
            "score": score_solution(problem, assignments), "solver_version": version,
            "proven_optimal": code == cp_model.OPTIMAL}


def solve_schedule(problem: dict[str, Any], solver: str = "auto") -> dict[str, Any]:
    if solver not in ("auto", "cp-sat", "builtin"):
        raise ValidationFailed("solver must be 'auto', 'cp-sat' or 'builtin'")
    if solver == "cp-sat" and not ortools_available():
        raise ValidationFailed("OR-Tools is not installed (pip install ortools); use solver='builtin'")
    use_cp_sat = solver == "cp-sat" or (solver == "auto" and ortools_available())
    result = _solve_cp_sat(problem) if use_cp_sat else _solve_builtin(problem)
    result["unscheduled"] = explain_infeasible_schedule(problem, result["assignments"])
    return result


# --------------------------------------------------------------------------- explanations

def explain_infeasible_schedule(problem: dict[str, Any], assignments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """For every task left unscheduled, say why in plain words."""
    scheduled = {a["task_id"]: a for a in assignments}
    crew = {a["astronaut_id"]: a for a in problem["astronauts"]}
    busy = {x: [list(b) for b in crew[x]["blocked"]] for x in crew}
    loads = {x: 0 for x in crew}
    tasks = {t["task_id"]: t for t in problem["tasks"]}
    for a in assignments:
        for x in a["astronaut_ids"]:
            busy[x].append([a["start"], a["end"], a["task_id"]])
            loads[x] += tasks[a["task_id"]]["duration"]

    out = []
    for t in problem["tasks"]:
        tid = t["task_id"]
        if tid in scheduled:
            continue
        reasons: list[str] = []
        eligible = problem["eligible"][tid]
        missing_deps = [d for d in t["depends_on"] if d not in scheduled]
        if not eligible:
            reasons.append("No eligible astronaut")
            for x, why in problem["ineligible_reasons"][tid].items():
                reasons.append(f"{x}: {'; '.join(why)}")
        elif missing_deps:
            reasons.append(f"Waits for {', '.join(missing_deps)}, which could not be scheduled")
        else:
            earliest = max([scheduled[d]["end"] for d in t["depends_on"]], default=0)
            for x in eligible:
                if loads[x] + t["duration"] > crew[x]["workload_limit"]:
                    reasons.append(f"{x}: would exceed the workload limit of {crew[x]['workload_limit']} min "
                                   f"({loads[x]} min already planned)")
                    continue
                if _earliest_slot([busy[x]], earliest, t["duration"], t["deadline"]) is None:
                    reasons.append(f"{x}: no free {t['duration']}-minute slot between {hhmm(earliest)} and "
                                   f"{hhmm(t['deadline'])}; {_blocking_summary(busy[x], earliest, t['deadline'])}")
            if not reasons:
                reasons.append("Could fit on its own, but was left out so higher-priority tasks fit")
        out.append({"task_id": tid, "title": t["title"], "duration": t["duration"], "reasons": reasons})
    return out


def _blocking_summary(busy: list[list], lo: int, hi: int) -> str:
    parts = [f"{label} {hhmm(s)}-{hhmm(e)}" for s, e, label in sorted(busy) if e > lo and s < hi]
    return "busy with " + ", ".join(parts) if parts else "no time left before the deadline"


# --------------------------------------------------------------------------- records

def create_optimization_run(conn: sqlite3.Connection, problem: dict[str, Any], *, actor_user_id: str | None,
                            solver_version: str) -> str:
    run_id = f"OPT-{uuid.uuid4().hex[:12].upper()}"
    conn.execute(
        """INSERT INTO optimization_runs (optimization_run_id, simulation_run_id, task_set_id, requested_by_user_id,
               solver_version, objective_version, status, started_at, input_hash)
           VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)""",
        (run_id, problem["simulation_run_id"], problem["task_set_id"], actor_user_id, solver_version,
         OBJECTIVE_VERSION, to_iso(utcnow()), problem["input_hash"]))
    return run_id


def save_solver_result(conn: sqlite3.Connection, optimization_run_id: str, result: dict[str, Any]) -> None:
    reason = None
    if result["unscheduled"]:
        reason = json.dumps([{"task_id": u["task_id"], "reasons": u["reasons"]} for u in result["unscheduled"]])
    conn.execute(
        """UPDATE optimization_runs SET status = ?, finished_at = ?, objective_value = ?, infeasibility_reason = ?,
               solver_version = ? WHERE optimization_run_id = ?""",
        (result["status"], to_iso(utcnow()), result["score"]["objective"] if result["score"] else None, reason,
         result["solver_version"], optimization_run_id))


def get_optimization_run(conn: sqlite3.Connection, optimization_run_id: str) -> dict[str, Any]:
    from app.core.errors import NotFound

    row = conn.execute("SELECT * FROM optimization_runs WHERE optimization_run_id = ?",
                       (optimization_run_id,)).fetchone()
    if row is None:
        raise NotFound(f"Optimization run {optimization_run_id} not found")
    run = dict(row)
    run["unscheduled"] = json.loads(run["infeasibility_reason"]) if run["infeasibility_reason"] else []
    version = conn.execute("SELECT schedule_version_id, status FROM schedule_versions WHERE optimization_run_id = ?",
                           (optimization_run_id,)).fetchone()
    run["schedule_version"] = dict(version) if version else None
    return run


def plan_task_set(conn: sqlite3.Connection, *, task_set_id: str, simulation_run_id: str, actor_user_id: str | None,
                  workday_start_hour: int = 9, require_full_coverage: bool = False,
                  solver: str = "auto") -> dict[str, Any]:
    """Build, solve and record one day's plan. A draft schedule version is created when anything is scheduled."""
    from app.services import schedule_service  # avoid import cycle

    problem = build_scheduling_problem(conn, task_set_id, simulation_run_id, workday_start_hour=workday_start_hour,
                                       require_full_coverage=require_full_coverage)
    planned_solver = "cp-sat" if solver == "cp-sat" or (solver == "auto" and ortools_available()) else "builtin"
    try:
        opt_id = create_optimization_run(conn, problem, actor_user_id=actor_user_id, solver_version=planned_solver)
        result = solve_schedule(problem, solver)
        save_solver_result(conn, opt_id, result)
        version = None
        if result["assignments"]:
            version = schedule_service.create_schedule_draft(conn, problem, result, optimization_run_id=opt_id,
                                                             actor_user_id=actor_user_id)
        write_audit(conn, user_id=actor_user_id, action_type="optimize_schedule", entity_type="task_set",
                    entity_id=task_set_id, action_result=result["status"],
                    change_summary=f"{opt_id}: {len(result['assignments'])}/{len(problem['tasks'])} tasks scheduled",
                    commit=False)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {
        "optimization_run_id": opt_id, "status": result["status"], "solver_version": result["solver_version"],
        "task_set_id": task_set_id, "task_date": problem["task_date"], "simulation_run_id": simulation_run_id,
        "scheduled": [{**a, "start_time": hhmm(a["start"]), "end_time": hhmm(a["end"])} for a in result["assignments"]],
        "unscheduled": result["unscheduled"], "score": result["score"],
        "schedule_version_id": version["schedule_version_id"] if version else None,
        "warnings": _warnings(problem, result),
    }


def _warnings(problem: dict[str, Any], result: dict[str, Any]) -> list[str]:
    flags = {f for a in result["assignments"] for x in a["astronaut_ids"]
             for f in problem["eligibility_flags"].get(a["task_id"], {}).get(x, [])}
    notes = []
    if "qualification_not_verified" in flags:
        notes.append("Some assignments rely on demo qualifications that are NOT verified.")
    if "readiness_is_synthetic_demo" in flags:
        notes.append("Readiness records are synthetic demo data, not real medical clearance.")
    if not ortools_available():
        notes.append("OR-Tools is not installed; the built-in solver was used (optimal for chained daily tasks).")
    return notes
