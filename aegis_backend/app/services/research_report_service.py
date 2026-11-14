"""Research reports (Phase 5): a written summary of one completed analysis job, and its review.

A report is drafted from the job's stored results by a fixed template. No AI model writes it
(that is Phase 6), so model_id is empty. The draft records a hash of the evidence it was written
from. Review checks that hash again, so a report can never be approved after its numbers changed.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from typing import Any

from app.core.errors import Conflict, NotFound, PermissionDenied, ValidationFailed
from app.services import research_service
from app.services.audit_service import write_audit
from app.utils.timestamps import to_iso, utcnow

DECISIONS = {"approve": "approved", "reject": "rejected"}
DATA_CLASSIFICATION = "synthetic_demo"


def evidence_hash(conn: sqlite3.Connection, job_id: str) -> str:
    """SHA-256 of everything the report rests on: the question, the job's settings and its results."""
    job = research_service.get_job(conn, job_id)
    analysis = dict(conn.execute("SELECT * FROM research_analyses WHERE analysis_id = ?",
                                 (job["analysis_id"],)).fetchone())
    evidence = {"analysis": analysis, "job_id": job_id, "simulation_run_id": job["simulation_run_id"],
                "method": job["method"], "parameters": job["parameters"], "results": job["results"]}
    return hashlib.sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _report_text(analysis: dict[str, Any], job: dict[str, Any]) -> str:
    summary, window = job["summary"], job["summary"]["window"]
    lines = [
        f"Question: {analysis['research_question']}",
        f"Variables: {analysis['independent_variable']} (independent) and {analysis['dependent_variable']} (dependent).",
        f"Method: {job['method']}. {research_service.METHODS[job['method']]}",
        f"Data: mission days {window['start']} to {window['end']}, using only data before {window['data_before']}, "
        f"from simulation run {job['simulation_run_id']}. {summary['pairs']} paired astronaut-days from "
        f"{summary['astronauts']} astronauts.",
        "",
        "Results:",
    ]
    lines += [f"- {r['interpretation']}" for r in job["results"]]
    if summary.get("excluded_astronauts"):
        lines.append(f"- Left out for too few paired days: {', '.join(summary['excluded_astronauts'])}.")
    lines += ["", "Per astronaut (their own days only):"]
    lines += [f"- {a['astronaut_id']}: {a['n']} days, mean {analysis['independent_variable']} {a['x_mean']}, "
              f"mean {analysis['dependent_variable']} {a['y_mean']}, r = {a['r']}" for a in summary["per_astronaut"]]
    lines += ["", f"Limits: {research_service.CAVEAT}",
              "Written from the stored results by a fixed template (no AI model). Draft until reviewed."]
    return "\n".join(lines)


def get_report(conn: sqlite3.Connection, report_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM research_reports WHERE report_id = ?", (report_id,)).fetchone()
    if row is None:
        raise NotFound(f"Report {report_id} not found")
    report = dict(row)
    details = conn.execute("SELECT job_id, created_by_user_id, review_comment FROM research_report_details "
                           "WHERE report_id = ?", (report_id,)).fetchone()
    report.update(dict(details) if details else {"job_id": None, "created_by_user_id": None, "review_comment": None})
    return report


def list_reports(conn: sqlite3.Connection, *, analysis_id: str | None = None, status: str | None = None,
                 simulation_run_id: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT report_id, analysis_id, simulation_run_id, title, status, model_id, evidence_hash, created_at,
                  reviewed_by_user_id, reviewed_at, data_classification FROM research_reports
           WHERE (:a IS NULL OR analysis_id = :a) AND (:s IS NULL OR status = :s)
             AND (:r IS NULL OR simulation_run_id = :r) ORDER BY created_at DESC, rowid DESC""",
        {"a": analysis_id, "s": status, "r": simulation_run_id}).fetchall()
    return [dict(r) for r in rows]


def create_report(conn: sqlite3.Connection, *, actor_user_id: str, job_id: str | None = None,
                  analysis_id: str | None = None, title: str | None = None,
                  report_text: str | None = None, model_id: str | None = None) -> dict[str, Any]:
    """Draft a report from a completed job (or from an analysis's latest completed job).

    `report_text` and `model_id` are set only by the AI service, after its checks; otherwise the fixed
    template writes the text and model_id stays empty."""
    if not job_id:
        if not analysis_id:
            raise ValidationFailed("Give a job_id or an analysis_id")
        job_id = research_service.latest_job_id(conn, analysis_id)
    job = research_service.get_job(conn, job_id)
    if job["status"] != "completed":
        raise ValidationFailed(f"Job {job_id} is '{job['status']}'; only a completed job can be reported",
                               {"error_message": job["error_message"]})
    if analysis_id and analysis_id != job["analysis_id"]:
        raise ValidationFailed(f"Job {job_id} belongs to analysis {job['analysis_id']}, not {analysis_id}")
    analysis = dict(conn.execute("SELECT * FROM research_analyses WHERE analysis_id = ?",
                                 (job["analysis_id"],)).fetchone())
    report_id = f"RPT-{uuid.uuid4().hex[:12].upper()}"
    conn.execute(
        """INSERT INTO research_reports (report_id, analysis_id, simulation_run_id, title, status, model_id,
               evidence_hash, report_text, created_at, reviewed_by_user_id, reviewed_at, data_classification)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, NULL, NULL, ?)""",
        (report_id, analysis["analysis_id"], job["simulation_run_id"],
         (title or "").strip() or f"{analysis['independent_variable']} and {analysis['dependent_variable']}: "
                                  f"{job['method']} analysis",
         model_id, evidence_hash(conn, job_id), report_text or _report_text(analysis, job), to_iso(utcnow()),
         DATA_CLASSIFICATION))
    conn.execute("INSERT INTO research_report_details (report_id, job_id, created_by_user_id, review_comment) "
                 "VALUES (?, ?, ?, NULL)", (report_id, job_id, actor_user_id))
    write_audit(conn, user_id=actor_user_id, action_type="create_report", entity_type="research_report",
                entity_id=report_id, action_result="success", change_summary=f"draft from {job_id}", commit=False)
    conn.commit()
    return get_report(conn, report_id)


def review_report(conn: sqlite3.Connection, report_id: str, reviewer: dict[str, Any], decision: str,
                  comment: str = "") -> dict[str, Any]:
    """Approve or reject a draft. The evidence is re-hashed first; the reviewer must not have run the job or drafted the report."""
    if decision not in DECISIONS:
        raise ValidationFailed("decision must be 'approve' or 'reject'")
    report = get_report(conn, report_id)

    def refuse(error: Exception) -> None:
        write_audit(conn, user_id=reviewer["user_id"], action_type=f"{decision}_report",
                    entity_type="research_report", entity_id=report_id, action_result="denied",
                    change_summary=str(error)[:200])
        raise error

    if report["status"] != "draft":
        refuse(Conflict(f"Report {report_id} is already '{report['status']}'"))
    if not report["job_id"]:
        refuse(Conflict(f"Report {report_id} has no recorded analysis job, so its evidence cannot be checked"))
    job = research_service.get_job(conn, report["job_id"])
    if reviewer["user_id"] in (job["requested_by_user_id"], report["created_by_user_id"]):
        refuse(PermissionDenied("You ran this analysis or drafted this report, so someone else must review it"))
    if decision == "approve" and evidence_hash(conn, report["job_id"]) != report["evidence_hash"]:
        refuse(Conflict("The analysis results changed after this report was drafted. Draft a new report."))
    conn.execute("UPDATE research_reports SET status = ?, reviewed_by_user_id = ?, reviewed_at = ? WHERE report_id = ?",
                 (DECISIONS[decision], reviewer["user_id"], to_iso(utcnow()), report_id))
    conn.execute("UPDATE research_report_details SET review_comment = ? WHERE report_id = ?",
                 (comment.strip()[:500], report_id))
    write_audit(conn, user_id=reviewer["user_id"], action_type=f"{decision}_report", entity_type="research_report",
                entity_id=report_id, action_result="success", change_summary=comment.strip()[:500], commit=False)
    conn.commit()
    return get_report(conn, report_id)
