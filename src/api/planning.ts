import type {
  DailyTaskSetsRow,
  OptimizationRunsRow,
  RecoveryActivitiesRow,
  ScheduleVersionsRow,
  TaskAssignmentsRow,
  TaskRequirementsRow,
} from '@/types/tables';
import { callEndpoint } from './client';
import type {
  ApproveScheduleRequest,
  CrewOverviewRow,
  PlannerOverview,
  PlanningTaskInput,
  OptimizationRunDetail,
  OptimizeRequest,
  PlanningTask,
  ScheduleDetail,
  ScheduleOverrideRequest,
  TaskRequirementsInput,
  TaskSetDetail,
} from './types';

export const planningApi = {
  explainAssignment: (assignmentId: string) =>
    callEndpoint<{
      entity_id: string;
      source: 'gemma' | 'rules';
      text: string;
      model_id: string | null;
      note?: string;
    }>('ai.explainTask', { assignmentId }),
  listTaskSets: (query: { mission_day?: number } = {}) =>
    callEndpoint<DailyTaskSetsRow[]>('planning.listTaskSets', {}, { query }),
  getTaskSet: (taskSetId: string) =>
    callEndpoint<TaskSetDetail>('planning.getTaskSet', { taskSetId }),
  overview: (date?: string) =>
    callEndpoint<PlannerOverview>('planning.overview', {}, { query: { date } }),
  createTask: (body: PlanningTaskInput) =>
    callEndpoint<PlanningTask>('planning.createTask', {}, { body }),
  updateTask: (taskId: string, body: PlanningTaskInput) =>
    callEndpoint<PlanningTask>('planning.updateTask', { taskId }, { body }),
  /** Demand profile edits by the leader. */
  updateRequirements: (taskId: string, body: TaskRequirementsInput) =>
    callEndpoint<TaskRequirementsRow>('planning.updateRequirements', { taskId }, { body }),
  crewOverview: () => callEndpoint<CrewOverviewRow[]>('planning.crewOverview'),

  optimize: (body: OptimizeRequest) =>
    callEndpoint<OptimizationRunsRow>('planning.optimize', {}, { body }),
  optimizeStatus: (runId: string) =>
    callEndpoint<OptimizationRunDetail>('planning.optimizeStatus', { runId }),

  listSchedules: (query: { task_set_id?: string } = {}) =>
    callEndpoint<ScheduleVersionsRow[]>('planning.listSchedules', {}, { query }),
  getSchedule: (scheduleVersionId: string) =>
    callEndpoint<ScheduleDetail>('planning.getSchedule', { scheduleVersionId }),
  overrideSchedule: (scheduleVersionId: string, body: ScheduleOverrideRequest) =>
    callEndpoint<TaskAssignmentsRow>('planning.overrideSchedule', { scheduleVersionId }, { body }),
  approveSchedule: (scheduleVersionId: string, body: ApproveScheduleRequest) =>
    callEndpoint<ScheduleVersionsRow>('planning.approveSchedule', { scheduleVersionId }, { body }),

  recoveryCatalogue: () => callEndpoint<RecoveryActivitiesRow[]>('planning.recoveryCatalogue'),
};
