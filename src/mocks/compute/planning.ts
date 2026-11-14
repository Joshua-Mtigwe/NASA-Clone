/** Mock stand-ins for backend schedule checks and crew operational status. */
import type { AssessmentCurrency, CrewOverviewRow, ScheduleIssue } from '@/api/types';
import type { TaskAssignmentsRow } from '@/types/tables';
import { table } from '../db';
import { missionNow } from './mission';

export async function scheduleIssues(
  assignments: TaskAssignmentsRow[],
  taskSetId: string | null,
): Promise<ScheduleIssue[]> {
  const [requirements, qualifications, tasks] = await Promise.all([
    table('task_requirements'),
    table('astronaut_qualifications'),
    table('mission_tasks'),
  ]);
  const issues: ScheduleIssue[] = [];

  // Overlapping assignments for the same astronaut.
  const byAstronaut = new Map<string, TaskAssignmentsRow[]>();
  for (const a of assignments) {
    const list = byAstronaut.get(a.astronaut_id) ?? [];
    list.push(a);
    byAstronaut.set(a.astronaut_id, list);
  }
  for (const [astronautId, list] of byAstronaut) {
    const sorted = [...list].sort((a, b) => a.planned_start.localeCompare(b.planned_start));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.planned_start < prev.planned_end) {
        issues.push({
          kind: 'conflict',
          task_id: cur.task_id,
          astronaut_id: astronautId,
          reason: `Overlaps ${prev.task_id} (${prev.planned_start.slice(11, 16)}-${prev.planned_end.slice(11, 16)} UTC).`,
        });
      }
    }
  }

  // Required certification not held (or not valid) by the assigned astronaut.
  for (const a of assignments) {
    for (const req of requirements.filter((r) => r.task_id === a.task_id)) {
      const held = qualifications.some(
        (q) =>
          q.astronaut_id === a.astronaut_id &&
          q.qualification_code === req.required_certification &&
          q.valid_from <= a.planned_start.slice(0, 10) &&
          q.valid_until >= a.planned_start.slice(0, 10),
      );
      if (!held) {
        issues.push({
          kind: 'missing_qualification',
          task_id: a.task_id,
          astronaut_id: a.astronaut_id,
          reason: `Requires ${req.required_certification}, not held by ${a.astronaut_id} on this date.`,
        });
      }
    }
  }

  // Tasks in the set with no assignment.
  if (taskSetId) {
    const assigned = new Set(assignments.map((a) => a.task_id));
    for (const t of tasks.filter((t) => t.task_set_id === taskSetId && !assigned.has(t.task_id))) {
      issues.push({
        kind: 'unassigned',
        task_id: t.task_id,
        astronaut_id: null,
        reason: 'No crew member assigned.',
      });
    }
  }
  return issues;
}

export async function crewOverview(): Promise<CrewOverviewRow[]> {
  const now = await missionNow();
  const [astronauts, readiness, qualifications, comparisons] = await Promise.all([
    table('astronauts'),
    table('crew_readiness'),
    table('astronaut_qualifications'),
    table('cognitive_comparisons'),
  ]);
  return astronauts.map((astronaut) => {
    const mine = readiness
      .filter(
        (r) => r.astronaut_id === astronaut.astronaut_id && r.assessment_date <= now.slice(0, 10),
      )
      .sort((a, b) => b.assessment_date.localeCompare(a.assessment_date));
    const current = mine[0] ?? null;
    const flaggedToday = comparisons.some(
      (c) =>
        c.astronaut_id === astronaut.astronaut_id &&
        c.reference_range_status === 'outside_reference' &&
        c.calculated_at.slice(0, 10) === now.slice(0, 10),
    );
    let status: AssessmentCurrency = 'no_current_assessment';
    if (
      current &&
      current.valid_until >= now &&
      current.assessment_completion_status === 'completed'
    ) {
      status = flaggedToday ? 'review_pending' : 'assessment_current';
    }
    return {
      astronaut,
      readiness: current,
      qualifications: qualifications.filter((q) => q.astronaut_id === astronaut.astronaut_id),
      assessment_status: status,
    };
  });
}
