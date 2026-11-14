/**
 * Mock stand-ins for the backend planning service: task CRUD with demand profile,
 * per-day schedule versions, a staged optimiser, duty-limit checks and approval.
 */
import type {
  DutyRow,
  OptimizationRunDetail,
  PipelineStage,
  PlannerOverview,
  PlanningTask,
  PlanningTaskInput,
  ProposedTaskFields,
  ScheduleDetail,
} from '@/api/types';
import type { MissionTasksRow, TaskAssignmentsRow } from '@/types/tables';
import { mockState, nextId, table } from '../db';
import { fieldError, HttpError, notFound } from '../route';
import { currentMissionState, minutesBetween } from './mission';
import { scheduleIssues } from './planning';

export const DEMO_VERSION = 'SV-DEMO-001';
const STAGES: PipelineStage[] = [
  'task_interpretation',
  'constraint_checks',
  'optimisation',
  'explanation',
];

interface PlanningRuntime {
  proposed: Map<string, ProposedTaskFields>;
  progress: Map<string, number>;
}
const runtime = new WeakMap<object, PlanningRuntime>();
function rt(): PlanningRuntime {
  let r = runtime.get(mockState);
  if (!r) {
    r = { proposed: new Map(), progress: new Map() };
    runtime.set(mockState, r);
  }
  return r;
}

export async function planningTask(task: MissionTasksRow): Promise<PlanningTask> {
  const [requirements, dependencies] = await Promise.all([
    table('task_requirements'),
    table('task_dependencies'),
  ]);
  return {
    task,
    requirements: requirements.filter((r) => r.task_id === task.task_id),
    dependencies: dependencies.filter((d) => d.task_id === task.task_id),
    proposed: rt().proposed.get(task.task_id) ?? null,
  };
}

const SCORE_FIELDS = [
  'cognitive_demand_score',
  'physical_demand_score',
  'attention_demand_score',
  'time_pressure_score',
] as const;

function validate(body: Partial<PlanningTaskInput>) {
  const t = body.task;
  if (!t?.task_title?.trim()) throw fieldError('task.task_title', 'Title is required');
  if (!t.task_set_id) throw fieldError('task.task_set_id', 'Field required');
  if (!t.estimated_duration_minutes || t.estimated_duration_minutes <= 0) {
    throw fieldError('task.estimated_duration_minutes', 'Duration must be greater than zero');
  }
  if (!t.required_crew_count || t.required_crew_count < 1) {
    throw fieldError('task.required_crew_count', 'At least one crew member');
  }
  for (const k of SCORE_FIELDS) {
    const v = body.requirements?.[k];
    if (v !== undefined && (v < 0 || v > 5))
      throw fieldError(`requirements.${k}`, 'Must be between 0 and 5');
  }
  for (const k of ['working_memory_demand_score', 'procedural_complexity_score'] as const) {
    const v = body.proposed?.[k];
    if (v !== null && v !== undefined && (v < 0 || v > 5))
      throw fieldError(`proposed.${k}`, 'Must be between 0 and 5');
  }
}

/** Create (no taskId) or replace a task with its requirements, dependencies and proposed fields. */
export async function upsertTask(
  body: Partial<PlanningTaskInput>,
  userId: string,
  taskId?: string,
): Promise<PlanningTask> {
  validate(body);
  const input = body.task!;
  const tasks = await table('mission_tasks');
  const taskSet = (await table('daily_task_sets')).find((s) => s.task_set_id === input.task_set_id);
  if (!taskSet) throw notFound('Task set');
  const { mission_time: now } = await currentMissionState();

  let task = taskId ? tasks.find((t) => t.task_id === taskId) : undefined;
  if (taskId && !task) throw notFound('Task');
  if (!task) {
    task = {
      ...input,
      task_id: nextId('TSK'),
      mission_id: input.mission_id || taskSet.mission_id,
      task_date: input.task_date || taskSet.task_date,
      created_by_user_id: userId,
      created_at: now,
    };
    tasks.push(task);
  } else {
    Object.assign(task, input);
  }

  const requirements = await table('task_requirements');
  let req = requirements.find((r) => r.task_id === task.task_id);
  if (!req) {
    req = {
      requirement_id: nextId('REQ'),
      task_id: task.task_id,
      required_specialization: '',
      required_certification: '',
      cognitive_demand_score: 0,
      physical_demand_score: 0,
      attention_demand_score: 0,
      time_pressure_score: 0,
      safety_classification: 'standard_demo',
      review_status: 'proposed',
      reviewed_by_user_id: '',
    };
    requirements.push(req);
  }
  Object.assign(req, body.requirements ?? {}, { reviewed_by_user_id: userId });

  if (body.depends_on_task_ids) {
    const deps = await table('task_dependencies');
    for (let i = deps.length - 1; i >= 0; i -= 1)
      if (deps[i]!.task_id === task.task_id) deps.splice(i, 1);
    for (const dep of body.depends_on_task_ids) {
      if (dep === task.task_id)
        throw fieldError('depends_on_task_ids', 'A task cannot depend on itself');
      deps.push({
        dependency_id: nextId('DEP'),
        task_id: task.task_id,
        depends_on_task_id: dep,
        dependency_type: 'finish_to_start',
      });
    }
  }
  if (body.proposed) rt().proposed.set(task.task_id, body.proposed);
  return planningTask(task);
}

async function taskIdsOf(taskSetId: string): Promise<Set<string>> {
  return new Set(
    (await table('mission_tasks')).filter((t) => t.task_set_id === taskSetId).map((t) => t.task_id),
  );
}

/** Per-day versions: the first is a copy of the preloaded demo draft for that day. */
export async function ensureDayVersion(taskSetId: string): Promise<void> {
  const versions = await table('schedule_versions');
  if (versions.some((v) => v.task_set_id === taskSetId)) return;
  const ids = await taskIdsOf(taskSetId);
  const assignments = await table('task_assignments');
  const versionId = `SV-${taskSetId}-1`;
  const { mission_time: now } = await currentMissionState();
  assignments.push(
    ...assignments
      .filter((a) => a.schedule_version_id === DEMO_VERSION && ids.has(a.task_id))
      .map((a) => ({ ...a, task_assignment_id: nextId('TA'), schedule_version_id: versionId })),
  );
  const set = (await table('daily_task_sets')).find((s) => s.task_set_id === taskSetId);
  versions.push({
    schedule_version_id: versionId,
    simulation_run_id: 'RUN-DEMO-001',
    mission_id: set?.mission_id ?? 'MIS-001',
    task_set_id: taskSetId,
    version_number: 1,
    status: 'demo_unapproved',
    created_by_user_id: null,
    approved_by_user_id: null,
    created_at: now,
    approved_at: null,
    optimization_run_id: null,
  });
}

/** The version the crew sees for a day: the latest approved one, else the preloaded draft. */
export async function visibleAssignments(date: string): Promise<TaskAssignmentsRow[]> {
  const sets = (await table('daily_task_sets')).filter((s) => s.task_date === date);
  const versions = await table('schedule_versions');
  const assignments = await table('task_assignments');
  const out: TaskAssignmentsRow[] = [];
  for (const set of sets) {
    const approved = versions
      .filter((v) => v.task_set_id === set.task_set_id && v.status === 'approved')
      .sort((a, b) => String(b.approved_at).localeCompare(String(a.approved_at)))[0];
    const ids = await taskIdsOf(set.task_set_id);
    out.push(
      ...assignments.filter((a) =>
        approved
          ? a.schedule_version_id === approved.schedule_version_id
          : a.schedule_version_id === DEMO_VERSION && ids.has(a.task_id),
      ),
    );
  }
  return out;
}

export async function plannerOverview(date: string | undefined): Promise<PlannerOverview> {
  const state = await currentMissionState();
  const day = date ?? state.mission_time.slice(0, 10);
  const set = (await table('daily_task_sets')).find((s) => s.task_date === day) ?? null;
  const tasks = set
    ? (await table('mission_tasks')).filter((t) => t.task_set_id === set.task_set_id)
    : [];
  const ids = new Set(tasks.map((t) => t.task_id));
  const requirements = (await table('task_requirements')).filter((r) => ids.has(r.task_id));
  const visible = await visibleAssignments(day);
  const versionId = visible[0]?.schedule_version_id ?? null;
  return {
    date: day,
    mission_day: set?.mission_day ?? state.mission_day,
    task_set_id: set?.task_set_id ?? null,
    crew_members: (await table('astronauts')).length,
    tasks_submitted: tasks.length,
    pending_review: tasks.filter(
      (t) => !requirements.some((r) => r.task_id === t.task_id && r.review_status === 'reviewed'),
    ).length,
    scheduled_minutes: visible.reduce(
      (sum, a) => sum + (minutesBetween(a.planned_start, a.planned_end) ?? 0),
      0,
    ),
    schedule_version_id: versionId,
  };
}

export async function startOptimisation(taskSetId: string, userId: string | null) {
  const set = (await table('daily_task_sets')).find((s) => s.task_set_id === taskSetId);
  if (!set) throw notFound('Task set');
  await ensureDayVersion(taskSetId);
  const { mission_time: now } = await currentMissionState();
  const run = {
    optimization_run_id: nextId('OPT'),
    simulation_run_id: mockState.selectedRunId ?? 'RUN-DEMO-001',
    task_set_id: taskSetId,
    requested_by_user_id: userId,
    solver_version: 'mock_stub_v1',
    objective_version: 'mock_stub_v1',
    status: 'running',
    started_at: now,
    finished_at: null as string | null,
    objective_value: null,
    infeasibility_reason: null,
    input_hash: null,
  };
  (await table('optimization_runs')).push(run);
  rt().progress.set(run.optimization_run_id, 0);
  return run;
}

/**
 * Each status poll advances the stub pipeline one stage. On completion it creates a new
 * version: an alternative that rotates the crew assignment of the day's draft by one place.
 */
export async function optimisationStatus(runId: string): Promise<OptimizationRunDetail> {
  const run = (await table('optimization_runs')).find((r) => r.optimization_run_id === runId);
  if (!run) throw notFound('Optimisation run');
  const versions = await table('schedule_versions');
  let progress = rt().progress.get(runId) ?? STAGES.length;
  if (run.status === 'running') {
    progress += 1;
    rt().progress.set(runId, progress);
    if (progress >= STAGES.length) {
      const taskSetId = run.task_set_id!;
      const { mission_time: now } = await currentMissionState();
      const dayVersions = versions.filter((v) => v.task_set_id === taskSetId);
      const number = dayVersions.length + 1;
      const versionId = `SV-${taskSetId}-${number}`;
      const base = dayVersions.find((v) => v.version_number === 1)!;
      const astronauts = (await table('astronauts')).map((a) => a.astronaut_id);
      const assignments = await table('task_assignments');
      assignments.push(
        ...assignments
          .filter((a) => a.schedule_version_id === base.schedule_version_id)
          .map((a) => ({
            ...a,
            task_assignment_id: nextId('TA'),
            schedule_version_id: versionId,
            astronaut_id:
              astronauts[(astronauts.indexOf(a.astronaut_id) + number - 1) % astronauts.length]!,
            assignment_status: 'draft',
            approval_status: 'demo_unapproved',
            approved_at: null,
          })),
      );
      versions.push({
        ...base,
        schedule_version_id: versionId,
        version_number: number,
        status: 'demo_unapproved',
        created_by_user_id: run.requested_by_user_id,
        created_at: now,
        approved_by_user_id: null,
        approved_at: null,
        optimization_run_id: runId,
      });
      run.status = 'completed';
      run.finished_at = now;
    }
  }
  const done = run.status === 'completed';
  return {
    run,
    stages: STAGES.map((stage, i) => ({
      stage,
      status: done || i < progress ? 'completed' : i === progress ? 'running' : 'pending',
    })),
    schedule_version_id:
      versions.find((v) => v.optimization_run_id === runId)?.schedule_version_id ?? null,
  };
}

export async function scheduleDetail(versionId: string): Promise<ScheduleDetail> {
  const version = (await table('schedule_versions')).find(
    (v) => v.schedule_version_id === versionId,
  );
  if (!version) throw notFound('Schedule version');
  const [assignments, recommendations, requirements, readiness, astronauts] = await Promise.all([
    table('task_assignments'),
    table('ai_task_recommendations'),
    table('task_requirements'),
    table('crew_readiness'),
    table('astronauts'),
  ]);
  const ids = version.task_set_id ? await taskIdsOf(version.task_set_id) : null;
  const mine = assignments.filter(
    (a) => a.schedule_version_id === versionId && (!ids || ids.has(a.task_id)),
  );
  const recIds = new Set(mine.map((a) => a.recommendation_id));
  const date = mine[0]?.planned_start.slice(0, 10) ?? '';

  const duty: DutyRow[] = astronauts.map((a) => {
    const minutes = mine
      .filter((x) => x.astronaut_id === a.astronaut_id)
      .reduce((sum, x) => sum + (minutesBetween(x.planned_start, x.planned_end) ?? 0), 0);
    const limit =
      readiness.find((r) => r.astronaut_id === a.astronaut_id && r.assessment_date === date)
        ?.workload_limit_minutes ?? null;
    return {
      astronaut_id: a.astronaut_id,
      scheduled_minutes: minutes,
      workload_limit_minutes: limit,
      over_limit: limit !== null && minutes > limit,
    };
  });

  return {
    version,
    assignments: mine,
    recommendations: recommendations.filter((r) => recIds.has(r.recommendation_id)),
    issues: await scheduleIssues(mine, version.task_set_id),
    duty,
    safety_critical_task_ids: [
      ...new Set(
        requirements
          .filter(
            (r) =>
              mine.some((a) => a.task_id === r.task_id) &&
              r.safety_classification !== 'standard_demo',
          )
          .map((r) => r.task_id),
      ),
    ],
  };
}

export async function approveSchedule(
  versionId: string,
  confirmed: string[],
  userId: string | null,
) {
  const detail = await scheduleDetail(versionId);
  const missing = detail.safety_critical_task_ids.filter((t) => !confirmed.includes(t));
  if (missing.length > 0) {
    throw new HttpError(
      409,
      `Confirm each safety-critical assignment before approval: ${missing.join(', ')}.`,
    );
  }
  const { mission_time: now } = await currentMissionState();
  const version = detail.version;
  version.status = 'approved';
  version.approved_by_user_id = userId;
  version.approved_at = now;
  for (const a of detail.assignments) {
    a.approval_status = 'approved';
    a.approved_at = now;
  }
  return version;
}
